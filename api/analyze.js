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
        generationConfig: { temperature, maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 8000 } }
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
    const scanPrompt = `당신은 사진 속 물건을 빠짐없이 목록화하는 전문가입니다.

[임무] 사진을 구역별로(왼쪽→오른쪽, 위→아래) 스캔하여 보이는 모든 물건을 번호 붙여 나열하세요.

[절대 규칙]
1. 사진에 실제로 보이는 물건만. 추측·추론·상상 절대 금지.
2. 라벨/텍스트 보이면 읽어서 그대로 적는다. 예: "라벨: Febreze FABRIC"
3. 라벨 없으면 형태 설명만. 색상은 의류/신발/가방처럼 색이 중요한 것에만 기재. 가구/전자기기/콘센트/세제 등엔 색상 표현 불필요.
4. 절대 "이 공간에 있을 법한" 물건을 상상해서 추가하지 않는다. 선풍기, 에어컨 등은 실제 화면에 명확히 보일 때만.
5. 여러 개면 (×N개) 표시.
6. 달력은 보이는 월(月)만 적고 연도는 절대 판단하지 않는다. 예: "7월 달력"
7. 반드시 제외: 신분증, 주민등록증, 운전면허증, 여권, 현금(지폐/동전), 통장, 신용카드, 체크카드 — 보여도 목록 미포함.
8. JSON 아님, 번호 목록으로만 응답.`;

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
- "브랜드 제품유형" 형식, 20자 이내
- 라벨 텍스트 있으면: 읽은 텍스트 기반으로 정확하게
- 라벨 없으면: 한국어 형태 설명 (예: "플라스틱 바구니", "접이식 의자") — 색상 prefix 불필요
- 색상은 의류/신발/가방/모자처럼 색상이 구별에 의미있는 경우에만 이름 앞에 기재. 가구/전자기기/콘센트/세제/식기/수납용품/청소도구는 색상 절대 붙이지 않는다.
  ✅ 좋은 예: "검정 후드티", "베이지 스니커즈"
  ❌ 나쁜 예: "흰색 콘센트", "아이보리색 식탁", "회색 세탁기"
- 영양제: 라벨 성분명 그대로 (아르기닌≠비타민, 오메가3≠비타민, 콜라겐≠비타민)
- 신발: "슬리퍼", "운동화", "샌들" 등 실제 보이는 형태로
- 세제: 라벨 읽은 것만, 보이지 않으면 "세탁세제" 아닌 "세제 용기"
- 달력: "○월 달력" 형식만 사용. 연도 절대 표기 금지. (예: "1월 달력", "7월 달력")
- 목록에 신분증/여권/현금/통장/카드류가 있어도 JSON에 포함하지 않는다.

[출력 — JSON 배열만, 다른 텍스트 없이]
[{"category":"카테고리","name":"상품명","qty":1},...]`;

    const jsonText = await callGemini([{ text: jsonPrompt }]);
    console.log("JSON 응답:", jsonText.slice(0, 500));

    const rawItems = safeParseItems(jsonText);
    console.log("파싱 수:", rawItems.length);

    const items = deduplicateItems(
      rawItems
        .filter(it => it?.name && String(it.name).trim().length > 1)
        .map(it => ({
          category: normCat(it.category),
          name: String(it.name).trim().slice(0, 25),
          qty: Math.max(1, Number(it.qty) || 1),
        }))
    );

    console.log(`최종: ${items.length}개`);
    return res.status(200).json({ items, reviewItems: [], lowItems: [] });

  } catch (err) {
    console.error("분석 오류:", err.message);
    return res.status(500).json({ error: "분석 오류", details: err.message });
  }
}
