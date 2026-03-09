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
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature, maxOutputTokens: 6000 }
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

    // ══ 1단계: 이미지 직접 스캔 → 물건 목록 (텍스트) ══
    console.log("1단계: 이미지 스캔");
    const scanPrompt = `당신은 가정 수납공간을 촬영한 사진에서 보관된 물건만 정확히 목록화하는 전문가입니다.

[임무] 사진을 좌→우, 위→아래로 꼼꼼히 스캔하여 눈에 보이는 물건을 번호 붙여 나열하세요.

[포함해야 할 것]
- 수납장/서랍 안에 보관된 물건 (제품, 용기, 의류, 도구 등)
- 라벨/브랜드가 보이면 그대로 기재. 예: "라벨: RYO ROOTGEN", "라벨: 만능클리너"
- 여러 개면 (xN개) 표시

[절대 제외할 것 — 아래 항목은 목록에 넣지 말 것]
- 수납가구 자체의 구조: 문, 선반, 경첩, 손잡이, 레일, 범퍼, 서랍틀, 캐비닛 본체
- 벽, 바닥, 천장, 배경
- 사진 속 공간·장소 자체 (예: "주방 싱크대", "욕실 선반")
- 없는 물건 상상 추가 절대 금지

[색상 표기]
- 의류·신발·가방에만 색상 기재
- 가전·가구·세제·용기 등에는 색상 불필요

[기타 규칙]
- 달력: 월(月)만 기재, 연도 판단 금지. 예: "1월 달력"
- 절대 제외: 신분증, 여권, 현금, 통장, 카드류
- JSON 아님, 번호 목록만`;

    const scanText = await callGemini([
      { inline_data: { mime_type: mime, data: b64 } },
      { text: scanPrompt }
    ]);
    console.log("스캔 결과:", scanText.slice(0, 600));

    if (!scanText || scanText.trim().length < 10) {
      return res.status(200).json({ items: [], reviewItems: [], lowItems: [] });
    }

    // ══ 2단계: 스캔 결과 → JSON 변환 ══
    console.log("2단계: JSON 변환");
    const corrHint = userCorrections?.length > 0
      ? `\n[사용자 교정 우선 적용]\n${userCorrections.map(c => `"${c.original}"→"${c.corrected}"`).join(", ")}\n`
      : "";

    const jsonPrompt = `다음은 사진 속 물건 목록입니다. 이것만 JSON으로 변환하세요. 목록에 없는 물건 추가 금지.
주의: 수납장 문, 경첩, 선반, 손잡이, 범퍼, 서랍틀 같은 가구 구조물은 JSON에 포함하지 마세요.
${corrHint}
[물건 목록]
${scanText}

[카테고리]
"의류" — 옷, 신발, 가방, 모자, 벨트, 양말, 속옷
"위생" — 샴푸, 컨디셔너, 바디워시, 치약, 칫솔, 비누, 면도용품, 물티슈
"청소" — 세탁세제, 섬유유연제, 청소세제, 청소도구, 수세미, 스프레이
"케어" — 영양제, 보충제, 의약품, 스킨케어(로션/세럼/크림), 마스크팩
"생활" — 전자기기, 배터리, 충전기, 가구, 수납용품, 문구, 식품
"기타" — 위 해당 없음

[이름 규칙] — 고객이 바로 알아볼 수 있는 자연스러운 한국어
- 형식: "브랜드 제품종류", 최대 15자
- 브랜드명은 한국어 통용 표기로 변환
  RYO → 려 / ILLIYOON → 일리윤 / Bébéen → 베베앙 / Febreze → 페브리즈
  LG생활건강, 아모레퍼시픽 브랜드도 통용명으로
- 제품 종류는 라벨+형태로 정확히 판단
  펌프형 용기 = 샴푸 또는 바디워시 (라벨로 구분)
  튜브형 = 크림 또는 치약 (라벨로 구분)
  스프레이 캔 = 스프레이 (라벨 브랜드 붙이기)
- 마케팅 문구 제거: "온 가족", "My baby's First", "Premium", "NEW", "특허" 등 제외
- 수납함·바구니 안 물건은 각각 별도 항목으로
- 라벨 없으면 형태만: "플라스틱 바구니", "노트" (색상 불필요)
- 색상은 의류/신발/가방에만 ✅ "검정 후드티" ❌ "흰색 식탁" "은색 경첩"
- 영양제: 성분명 그대로 (아르기닌≠비타민)
- 달력: "N월 달력"만, 연도 금지
- 수납장 구조물(문/선반/경첩/손잡이)은 JSON에 절대 포함하지 않는다
- 민감정보(신분증/여권/현금/카드) JSON 포함 금지

[출력 — JSON 배열만, 다른 텍스트 없이]
[{"category":"카테고리","name":"상품명","qty":1},...]`;

    const jsonText = await callGemini([{ text: jsonPrompt }]);
    console.log("JSON 응답:", jsonText.slice(0, 500));

    const rawItems = safeParseItems(jsonText);
    console.log("파싱 수:", rawItems.length);

    // 가구 구조물 필터 (프롬프트 뚫렸을 때 최후 방어선)
    const STRUCTURE_KEYWORDS = ["캐비닛 문","캐비닛 선반","캐비닛 본체","서랍 선반","서랍틀","금속 경첩","경첩","원형 범퍼","플라스틱 범퍼","손잡이 레일","선반 지지","싱크대 문","수납장 문","수납장 선반"];
    const isStructure = (name) => STRUCTURE_KEYWORDS.some(k => name.includes(k));

    // 비의류 색상 prefix 제거
    const COLOR_RE = /^(흰색?|화이트|검정|검은|블랙|회색?|그레이|아이보리|베이지|갈색|브라운|노란?|파란?|블루|빨간?|레드|초록|녹색|그린|핑크|분홍|보라|퍼플|은색|실버|금색|골드|투명)\s+/u;
    const NO_COLOR_CATS = new Set(["생활","청소","위생","기타"]);

    const items = deduplicateItems(
      rawItems
        .filter(it => it?.name && String(it.name).trim().length > 1)
        .filter(it => !isStructure(String(it.name).trim()))
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
