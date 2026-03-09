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
    const scanPrompt = `당신은 사진 속 물건을 하나도 빠짐없이 세는 전문가입니다.

[임무] 사진을 좌→우, 위→아래로 구역별 격자 스캔하여 눈에 보이는 모든 물건에 번호를 붙여 나열하세요.
밀집된 공간일수록 더 꼼꼼히 보세요. 작은 물건, 부분적으로 보이는 물건도 포함.

[규칙]
1. 화면에 실제로 보이는 물건만. 추측·상상 절대 금지.
2. 라벨/브랜드명 보이면 읽어서 기재. 예: "라벨: RYO ROOTGEN"
3. 라벨 없으면 형태 설명. 예: "원통형 플라스틱 용기"
4. 의류·신발·가방에만 색상 기재. 가전·가구·세제 등은 색상 불필요.
5. 여러 개면 (×N개) 표시.
6. 달력은 월(月)만, 연도 판단 금지. 예: "1월 달력"
7. 절대 제외: 신분증, 여권, 현금, 통장, 카드류.
8. JSON 아님, 번호 목록만.`;

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

[이름 규칙] — 고객이 쉽게 찾을 수 있는 자연스러운 한국어 이름
- 형식: "브랜드 제품종류", 최대 15자
- 라벨에 브랜드명 있으면: 한국어 통용 표기로 변환 후 제품 종류 붙이기
  예: "Bébéen" → "베베앙", "ILLIYOON" → "일리윤", "RYO" → "려", "Febreze" → "페브리즈"
- 제품 종류는 라벨+형태로 추론. 예: 펌프형 용기+위생 → "샴푸/바디워시/폼클렌저"
  "베베앙 물티슈", "일리윤 여성청결제", "려 샴푸", "만능클리너 스프레이"
- 마케팅 문구 제거: "온 가족", "My baby's First", "Premium", "NEW" 등 제외
- 라벨 없으면: 형태 설명. 예: "플라스틱 바구니", "접이식 의자" (색상 prefix 불필요)
- 색상은 의류/신발/가방에만. ✅ "검정 후드티" ❌ "흰색 식탁" "아이보리 콘센트"
- 영양제: 성분명 그대로 (아르기닌≠비타민, 오메가3≠비타민)
- 달력: "N월 달력"만, 연도 절대 금지
- 민감정보(신분증/여권/현금/카드) JSON 포함 금지

[출력 — JSON 배열만, 다른 텍스트 없이]
[{"category":"카테고리","name":"상품명","qty":1},...]`;

    const jsonText = await callGemini([{ text: jsonPrompt }]);
    console.log("JSON 응답:", jsonText.slice(0, 500));

    const rawItems = safeParseItems(jsonText);
    console.log("파싱 수:", rawItems.length);

    const COLOR_RE = /^(흰색?|화이트|검정|검은|블랙|회색?|그레이|아이보리|베이지|갈색|브라운|노란?|파란?|블루|빨간?|레드|초록|녹색|그린|핑크|분홍|보라|퍼플|은색|실버|금색|골드|투명)\s+/u;
    const NO_COLOR_CATS = new Set(["생활","청소","위생","기타"]);
    const items = deduplicateItems(
      rawItems
        .filter(it => it?.name && String(it.name).trim().length > 1)
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
