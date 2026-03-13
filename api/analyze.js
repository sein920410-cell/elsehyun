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
    return [];
  } catch (_) {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start !== -1 && end > start) {
      try { return JSON.parse(text.slice(start, end + 1)); } catch (e) {}
    }
    return [];
  }
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

async function callGemini(parts) {
  // 1. 모델명을 gemini-3.1-pro-preview로 변경하여 추론 능력을 극대화합니다.
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { 
          temperature: 0.7, // 너무 낮으면 인식이 경직되므로 적절히 유지
          maxOutputTokens: 8000,
          responseMimeType: "application/json" // JSON 출력을 강제하여 파싱 오류 방지
        }
      })
    }
  );
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API 오류: ${err.slice(0, 200)}`);
  }
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
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
    const b64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");
    const mime = mimeType || "image/jpeg";

    const corrHint = userCorrections?.length > 0
      ? `\n[사용자 교정 데이터: 이 명칭을 우선적으로 적용해]\n${userCorrections.map(c => `"${c.original}"→"${c.corrected}"`).join(", ")}\n`
      : "";

    const scanPrompt = `사진 속 수납공간의 물건 목록을 분석하여 JSON 배열로 출력하세요. ${corrHint}
라벨을 꼼꼼하게 읽고 실제 존재하는 물건만 기록하세요.

━━ 카테고리 ━━
"의류", "위생", "청소", "케어", "생활", "기타"

━━ 규칙 ━━
1. 이름 짓기: 라벨에 적힌 이름을 그대로 사용하세요 (예: "가성비UP 칫솔"). 절대 '칫솔'로 줄이지 마세요.
2. 브랜드명: 영어 브랜드는 한국어로 번환하세요 (예: RYO -> 려).
3. 마케팅 문구 제거: "NEW", "Premium", "온가족" 등은 삭제하세요.
4. 환각 방지: 눈에 명확히 보이지 않는 물건을 상상해서 넣지 마세요.
5. 구조물 제외: 수납장의 문, 경첩, 레일, 바구니 틀 자체는 목록에 넣지 마세요.

━━ 출력 예시 ━━
[{"category":"위생","name":"려 루트젠 샴푸","qty":1}]`;

    const scanText = await callGemini([
      { inline_data: { mime_type: mime, data: b64 } },
      { text: scanPrompt }
    ]);

    const rawItems = safeParseItems(scanText);
    const items = deduplicateItems(
      rawItems
        .filter(it => it?.name && String(it.name).trim().length > 1)
        .map(it => ({
          category: normCat(it.category),
          name: String(it.name).trim().slice(0, 20),
          qty: Math.max(1, Number(it.qty) || 1)
        }))
    );

    return res.status(200).json({ items, reviewItems: [], lowItems: [] });

  } catch (err) {
    console.error("분석 오류:", err.message);
    return res.status(500).json({ error: "분석 오류", details: err.message });
  }
}
