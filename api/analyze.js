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
        generationConfig: { temperature, maxOutputTokens: 4096 }
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
    const scanPrompt = `당신은 사진 속 물건을 정확하게 목록화하는 전문가입니다.

[임무] 사진을 왼쪽→오른쪽, 위→아래 순서로 스캔하여 눈에 보이는 물건을 번호 붙여 나열하세요.

[절대 규칙]
1. 사진에 실제로 명확히 보이는 물건만. 추측·추론·상상·유추 절대 금지.
   예: "부엌이니까 선풍기가 있겠지" 같은 추론 금지. 화면에 선명히 보여야 포함.
2. 라벨/텍스트 보이면 그대로 읽는다. 예: "라벨: Febreze FABRIC"
3. 라벨 없으면 형태 설명만. 예: "직사각형 플라스틱 바구니"
   색상은 의류·신발·가방처럼 색이 식별에 필수적인 경우에만 기재.
   콘센트, 식탁, 가전, 세제통, 수납함 등에는 색상 표현 불필요.
4. 여러 개면 (xN개) 표시.
5. 달력은 보이는 월(月)만 적고 연도 판단 절대 금지. 예: "1월 달력"
6. 절대 제외(보여도 목록 미포함): 신분증, 주민등록증, 운전면허증, 여권, 현금(지폐·동전), 통장, 신용카드, 체크카드.
7. JSON 아님, 번호 목록으로만 응답.`;

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

[이름 규칙]
- "브랜드 제품유형" 형식, 20자 이내. 목록에 없는 물건 절대 추가 금지.
- 라벨 텍스트 있으면: 읽은 텍스트 기반으로 정확하게
- 라벨 없으면: 한국어 형태 설명 (예: "플라스틱 바구니", "접이식 의자") — 색상 prefix 불필요
- 색상은 의류/신발/가방/모자에만 붙인다. ✅ "검정 후드티" / ❌ "흰색 콘센트" "아이보리 식탁"
- 영양제: 라벨 성분명 그대로 (아르기닌≠비타민, 오메가3≠비타민, 콜라겐≠비타민)
- 신발: "슬리퍼", "운동화", "샌들" 등 실제 보이는 형태로
- 세제: 라벨 읽은 것만, 보이지 않으면 "세탁세제" 아닌 "세제 용기"
- 달력: "N월 달력" 형식만. 연도 표기 절대 금지. ✅ "1월 달력" / ❌ "2020년 1월 달력"
- 민감정보(신분증/여권/현금/통장/카드류)는 JSON에 포함하지 않는다.

[출력 — JSON 배열만, 다른 텍스트 없이]
[{"category":"카테고리","name":"상품명","qty":1},...]`;

    const jsonText = await callGemini([{ text: jsonPrompt }]);
    console.log("JSON 응답:", jsonText.slice(0, 500));

    const rawItems = safeParseItems(jsonText);
    console.log("파싱 수:", rawItems.length);

    // 비의류 카테고리 색상 prefix 안전망 제거
    const COLOR_RE = /^(흰색|흰|화이트|검정|검은|블랙|회색|회|그레이|아이보리|베이지|갈색|브라운|노란|노랑|파란|파랑|블루|빨간|빨강|레드|초록|녹색|그린|핑크|분홍|보라|퍼플|은색|실버|금색|골드|투명)\s+/u;
    const NO_COLOR_CATS = new Set(["생활", "청소", "위생", "기타"]);

    const items = deduplicateItems(
      rawItems
        .filter(it => it?.name && String(it.name).trim().length > 1)
        .map(it => {
          const category = normCat(it.category);
          let name = String(it.name).trim().slice(0, 25);
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
