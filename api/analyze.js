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

    // 가장 똑똑한 Gemini 3 Pro 모델을 사용하여 브랜드명을 정밀 분석합니다.
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } },
          { text: `너는 '공간:결' 시스템의 최고 물품 인식 전문가야. 
          1. 브랜드명 읽기: 겉면에 적힌 글자를 끝까지 읽어. '페브리즈'가 보이면 '생활:페브리즈'라고 해. 뭉뚱그린 이름은 절대 금지야.
          2. 카테고리: 휴지/물티슈/칫솔은 '위생', 소화기는 '안전'으로 분류해.
          3. 지어내지 마: 사진에 없는 건 절대 적지 마.
          4. 형식: '카테고리:제품명'들만 쉼표로 나열해. 다른 말은 일절 하지 마.` }
        ]}]
      })
    });

    const data = await response.json();
    const botText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const rawItems = botText.split(",").map(s => s.replace(/[\[\]\n`*]/g, "").trim()).filter(it => it.includes(":") && it.length > 3);
    return res.status(200).json({ items: [...new Set(rawItems)] });
  } catch (err) {
    return res.status(500).json({ error: "분석 오류" });
  }
}
