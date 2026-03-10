import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const VALID_CATS = ["의류", "위생", "청소", "케어", "생활", "기타"];
function normCat(c) {
  if (!c) return "기타";
  return VALID_CATS.includes(String(c).trim()) ? String(c).trim() : "기타";
}

// JSON 파싱 로직을 더 유연하게 개선
function safeParseItems(raw) {
  if (!raw || typeof raw !== "string") return [];
  let text = raw.trim().replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : (parsed.items || []);
  } catch (_) {
    const start = text.indexOf("["), end = text.lastIndexOf("]");
    if (start !== -1 && end > start) {
      try { return JSON.parse(text.slice(start, end + 1)); } catch (__) {}
    }
  }
  return [];
}

function deduplicateItems(items) {
  const seen = new Map();
  for (const item of items) {
    const key = `${item.category}__${item.name.toLowerCase().replace(/\s/g, "")}`;
    if (seen.has(key)) {
      seen.get(key).qty += (item.qty || 1);
    } else {
      seen.set(key, { ...item, qty: item.qty || 1 });
    }
  }
  return Array.from(seen.values());
}

async function callGemini(parts, temperature = 0) { // 온도를 0으로 낮춰 더 정확하게 설정
  const model = process.env.GEMINI_MODEL || "gemini-3-flash-preview";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature, maxOutputTokens: 8192 }
      })
    }
  );
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API ${response.status}: ${err.slice(0, 200)}`);
  }
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const { filePath, mimeType, userCorrections } = req.body || {};

  try {
    const { data: signedData, error: signedErr } = await supa
      .storage.from("user_uploads").createSignedUrl(filePath, 60);
    if (signedErr || !signedData?.signedUrl) throw new Error("URL 생성 실패");

    const imgResp = await fetch(signedData.signedUrl);
    const b64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");

    const corrHint = userCorrections?.length > 0
      ? `\n[사용자 교정 내역: 다음은 과거에 틀렸던 사례이니 참고하세요]\n${userCorrections.map(c => `"${c.original}"은 "${c.corrected}"임`).join(", ")}\n`
      : "";

    // 🌟 프롬프트를 '추론 중심'으로 대폭 강화
    const scanPrompt = `당신은 물품 관리 전문가입니다. 사진 속 수납장 안의 물건을 분석하여 JSON 배열로 출력하세요.

${corrHint}

━━ 필수 분석 단계 (출력하지 말고 내부적으로만 수행) ━━
1. 각 물건의 '라벨(글자)'을 가장 먼저 확인합니다.
2. 읽은 글자가 실제 존재하는 브랜드나 제품명인지 검증하세요. (예: '케케라' 같은 단어는 존재하지 않음)
3. 브랜드명을 읽을 수 없다면 억지로 지어내지 말고, '색상+용도'로만 명명하세요. (예: "하얀색 통")
4. '크림'이라고 판단했다면 왜 크림인지(용기 모양, 라벨 내용) 확인하고 확실치 않으면 '미확인 용기'로 분류하세요.

━━ 출력 규칙 ━━
- 형식: [{"category": "카테고리", "name": "제품명", "qty": 개수}, ...]
- 카테고리: 의류, 위생, 청소, 케어, 생활, 기타 중 택 1
- 이름 짓기: 브랜드명(한글) + 제품명을 원칙으로 함 (예: "일리윤 여성청결제")
- ⚠️ 절대 금지: '케케라', '나우크림' 등 사진에 없는 단어 창조 금지.
- ⚠️ 추론 금지: 배경에 있다고 해서 보이지 않는 세제나 봉투를 목록에 넣지 마세요.

눈에 보이는 '팩트'만 기록하세요.`;

    const scanText = await callGemini([
      { inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } },
      { text: scanPrompt }
    ]);

    const rawItems = safeParseItems(scanText);
    const items = deduplicateItems(
      rawItems
        .filter(it => it?.name && String(it.name).length > 1)
        .map(it => ({
          category: normCat(it.category),
          name: String(it.name).trim().slice(0, 25),
          qty: Math.max(1, Number(it.qty) || 1)
        }))
    );

    return res.status(200).json({ items, reviewItems: [], lowItems: [] });
  } catch (err) {
    return res.status(500).json({ error: "분석 실패", details: err.message });
  }
}
