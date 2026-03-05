// api/analyze.js
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const { filePath, mimeType } = req.body;

  try {
    const { data: signedData } = await supa.storage.from('user_uploads').createSignedUrl(filePath, 60);
    const imgResp = await fetch(signedData.signedUrl);
    const b64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");

    // Vercel 설정값(gemini-3-flash)을 그대로 가져와서 똑똑하게 분석합니다.
    const modelName = process.env.GEMINI_MODEL || "gemini-3-flash";
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } },
          { text: `너는 '공간:결'의 최고 수준 물품 인식 전문가야. 사진을 정밀 스캔해서 목록을 작성해.
지침:
1. 브랜드명/글자 읽기 최우선: '듀라셀 건전지', '일리윤 연고'처럼 브랜드와 제품명을 정확히 읽어.
2. 꼼꼼한 전수 조사: 가위, 머리끈, 실타래 등 아주 작은 물건까지 하나도 빼놓지 마.
3. 응답 형식: 오직 '카테고리:제품명'들만 쉼표로 나열해. (예: 생활:듀라셀 건전지, 문구:가위, 생활:무지개실타래)` }
        ]}]
      })
    });

    const data = await response.json();
    const botText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const rawItems = botText.split(",").map(s => s.replace(/[\[\]\n`*]/g, "").trim()).filter(it => it.includes(":") && it.length > 2);
    return res.status(200).json({ items: [...new Set(rawItems)] });
  } catch (err) { return res.status(500).json({ error: "분석 오류" }); }
}
