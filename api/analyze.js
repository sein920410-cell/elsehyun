import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const VALID_CATS = ["의류", "위생", "청소", "케어", "생활", "기타"];
function normCat(c) {
  if (!c) return "기타";
  return VALID_CATS.includes(String(c).trim()) ? String(c).trim() : "기타";
}

function safeParseItems(raw) {
  if (!raw || typeof raw !== "string") return [];
  let text = raw.trim().replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") {
      const key = Object.keys(parsed).find(k => Array.isArray(parsed[k]));
      if (key) return parsed[key];
    }
  } catch (_) {}
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch (_) {}
  }
  if (start !== -1) {
    const results = [];
    const objRegex = /\{[^{}]+\}/g;
    let match;
    while ((match = objRegex.exec(text.slice(start))) !== null) {
      try { const obj = JSON.parse(match[0]); if (obj?.name) results.push(obj); } catch (_) {}
    }
    if (results.length > 0) return results;
  }
  console.error("JSON 파싱 실패:", raw.slice(0, 300));
  return [];
}

function deduplicateItems(items) {
  const seen = new Map();
  for (const item of items) {
    const key = `${item.category}__${item.name.toLowerCase().replace(/\s/g, "")}`;
    if (seen.has(key)) seen.get(key).qty += item.qty;
    else seen.set(key, { ...item });
  }
  return Array.from(seen.values());
}

async function callGemini(parts, temperature = 0.05) {
  // ✅ gemini-2.5-pro: 무료 티어 지원 (하루 100건, 분당 5건) — Flash보다 인식 품질 우수
  const model = "gemini-2.5-pro";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature,
          maxOutputTokens: 6000,
          // ✅ thinking 비활성화: JSON 정확도 향상 + 토큰 낭비 방지
          thinkingConfig: { thinkingBudget: 0 }
        }
      })
    }
  );
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API ${response.status}: ${err.slice(0, 200)}`);
  }
  const data = await response.json();
  const resParts = data.candidates?.[0]?.content?.parts || [];
  return resParts.filter(p => p.text && !p.thought).map(p => p.text).join("") || "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const { filePath, mimeType, userCorrections } = req.body || {};
  if (!filePath) return res.status(400).json({ error: "filePath 누락" });

  try {
    const { data: signedData, error: signedErr } = await supa
      .storage.from("user_uploads").createSignedUrl(filePath, 60);
    if (signedErr || !signedData?.signedUrl)
      return res.status(500).json({ error: "이미지 URL 생성 오류" });

    const imgResp = await fetch(signedData.signedUrl);
    if (!imgResp.ok) throw new Error(`이미지 fetch 실패: ${imgResp.status}`);
    const b64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");
    const mime = mimeType || "image/jpeg";

    // ══ 이미지 → JSON 직접 출력 ══
    console.log("이미지 → JSON 직접 변환");
    const corrHint = userCorrections?.length > 0
      ? `\n[사용자 교정]\n${userCorrections.map(c => `"${c.original}"→"${c.corrected}"`).join(", ")}\n`
      : "";

    const scanPrompt = `사진 속 수납공간에 보관된 물건 목록을 JSON으로 출력하세요.${corrHint}

━━ 출력 형식 (JSON 배열만, 다른 텍스트 없이) ━━
[{"category":"카테고리","name":"물건이름","qty":개수},...]

━━ 카테고리 ━━
"의류" → 옷, 신발, 가방, 모자, 양말, 속옷, 벨트
"위생" → 샴푸, 린스, 바디워시, 물티슈, 치약, 칫솔, 비누, 여성청결제, 면도용품
"청소" → 세탁세제, 섬유유연제, 청소세제, 밀대, 대걸레, 빗자루, 수세미, 청소솔, 스프레이
"케어" → 영양제, 의약품, 로션, 크림, 세럼, 마스크팩, 연고
"생활" → 우산, 소화기, 배터리, 충전기, 가위, 테이프, 노트, 볼펜, 수납함, 바구니
"기타" → 위에 해당 없음

━━ 이름 짓는 법 ━━
라벨에 쓰인 제품명을 최대한 그대로 읽어라. 절대 축약하지 마라.

  ✅ 라벨에 "가성비UP 칫솔" 써있으면 → "가성비UP 칫솔"  (칫솔로 줄이지 말 것)
  ✅ 라벨에 "맘스크린장갑" 써있으면 → "맘스크린장갑"  (일회용 장갑으로 바꾸지 말 것)
  ✅ 라벨에 "굴곡면봉" 써있으면 → "굴곡면봉"  (면봉으로 줄이지 말 것)
  ✅ 라벨에 "쿨링 스프레이" 써있으면 → "쿨링 스프레이"
  ✅ 라벨에 "Batiste Dry Shampoo" → "바티스트 드라이샴푸"
  ✅ 라벨에 "ILLIYOON 여성청결제" → "일리윤 여성청결제"
  ✅ 라벨에 "RYO ROOTGEN" → "려 루트젠 샴푸" (샴푸/트리트먼트는 라벨로만 구분)
  ❌ 절대 금지: 라벨이 있는데 "칫솔", "면봉", "장갑", "세제"처럼 한 단어로 축약

라벨 없으면 → 기능/용도로 (형태 묘사 금지)
  ✅ "밀대", "우산", "소화기", "수납 바구니"
  ❌ "긴 손잡이 도구", "직사각형 물체", "플라스틱 용기"

브랜드명 한국어 변환: RYO→려 / ILLIYOON→일리윤 / Bébéen→베베앙 / Febreze→페브리즈
마케팅 문구 제거: "온 가족", "My baby's First", "Premium", "NEW" — 이것만 제거, 나머지는 그대로

하나의 물건은 하나로 → 밀대 손잡이+헤드 = "밀대" 1개 (부품으로 쪼개지 말 것)
묶음은 하나로 → 우산 3개 = {"name":"우산","qty":3}

━━ 공간 추론 절대 금지 ━━
사진 공간이 무엇인지 보고 "있을 법한 물건"을 상상해서 추가하지 마라
  신발장처럼 보인다 → 리모컨, TV, 에어컨 추가 금지
  주방처럼 보인다 → 없는 냄비, 식기, 조미료 추가 금지
  눈에 직접 보이는 것만 목록에 넣는다

━━ 절대 목록에 넣지 말 것 ━━
- 수납장/캐비닛의 부품: 문, 선반, 경첩, 손잡이, 레일, 범퍼, 서랍틀, 걸이
- 배경: 벽, 바닥, 천장
- 없는 물건 상상 추가 절대 금지 — 공간 유형(신발장, 주방, 욕실 등)을 보고 "있을 법한 물건" 추가 금지
  ❌ 신발장 사진에 TV 리모컨 추가 금지 / 주방 사진에 선풍기 추가 금지
- 신분증, 여권, 현금, 통장, 카드류
- 수납함/바구니 안 물건이 안 보이면 "수납 바구니"만 (안에 뭐가 있겠지 추측 금지)

━━ 이름 다듬기 ━━
- 브랜드 마케팅 문구 제거: "온 가족", "My baby's First", "Premium", "NEW" 등
- 의류/신발/가방에만 색상. 그 외엔 색상 표현 금지
  ✅ "검정 우산" (우산은 색으로 구분 가능) → OK
  ❌ "흰색 바구니", "빨간 세제통" → 색상 제거
- 달력이면: "N월 달력" (연도 표기 금지)`;

    const scanText = await callGemini([
      { inline_data: { mime_type: mime, data: b64 } },
      { text: scanPrompt }
    ]);
    console.log("직접 JSON 결과:", scanText.slice(0, 800));

    if (!scanText || scanText.trim().length < 10) {
      return res.status(200).json({ items: [], reviewItems: [], lowItems: [] });
    }

    const rawItems = safeParseItems(scanText);
    console.log("파싱 수:", rawItems.length);

    // 최후 방어: 형태 묘사 및 구조물 필터
    const BAD_KEYWORDS = ["손잡이 도구","직사각형 도구","직사각형 물체","플라스틱 용기","검정 물건","긴 막대","직사각형 포장","작은 상자","큰 상자","원형 물체","불명 물체","경첩","선반 지지","캐비닛 문","캐비닛 선반","서랍틀","금속 경첩","원형 범퍼","플라스틱 범퍼","걸이 레일","TV 리모컨","리모컨","에어컨 리모컨","선풍기 리모컨"];
    const isBadItem = (name) => BAD_KEYWORDS.some(k => name.includes(k));
    const COLOR_RE = /^(흰색?|화이트|검정|검은|블랙|회색?|그레이|아이보리|베이지|갈색|브라운|노란?|파란?|블루|빨간?|레드|초록|녹색|그린|핑크|분홍|보라|퍼플|은색|실버|금색|골드|투명)\s+/u;
    const NO_COLOR_CATS = new Set(["생활","청소","위생","케어","기타"]);

    const items = deduplicateItems(
      rawItems
        .filter(it => it?.name && String(it.name).trim().length > 1)
        .filter(it => !isBadItem(String(it.name).trim()))
        .map(it => {
          const category = normCat(it.category);
          let name = String(it.name).trim().slice(0, 20);
          if (NO_COLOR_CATS.has(category)) name = name.replace(COLOR_RE, "");
          return { category, name, qty: Math.max(1, Number(it.qty) || 1) };
        })
    );

    console.log(`최종: ${items.length}개`);
    return res.status(200).json({ items, reviewItems: [], lowItems: [] });

  } catch (err) {
    console.error("분석 오류:", err.message);
    return res.status(500).json({ error: "분석 오류", details: err.message });
  }
}
