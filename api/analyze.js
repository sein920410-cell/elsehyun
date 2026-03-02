import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";
import { Buffer } from "buffer";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const { filePath } = req.body;

  try {
    const { data: signedData } = await supa.storage.from('user_uploads').createSignedUrl(filePath, 60);
    const imgResp = await fetch(signedData.signedUrl);
    const b64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");

    const endpoint = `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const gResp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: "image/jpeg", data: b64 } },
          { text: `
            당신은 물류 관리 전문가입니다. 이미지 속 물건들을 정밀 분석하세요.
            1. 제품 패키지에 적힌 '브랜드명'과 '상세 제품명'을 반드시 하나로 합쳐서 출력하세요. (예: '베베앙 아기물티슈', '로지텍 M331 마우스')
            2. 포장지에 적힌 작은 글자라도 읽어서 제품을 구체적으로 구분해야 합니다. 단순히 '물티슈'라고만 적는 것은 절대 금지합니다.
            3. 이미지에 보이는 물품을 최대한 많이 찾아내세요.
            4. 결과는 오직 한국어 물품 이름들만 콤마(,)로 구분해서 출력하고, 다른 설명은 절대 하지 마세요.
          ` }
        ]}]
      })
    });

    const gData = await gResp.json();
    const botText = gData.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const items = botText.split(",").map(s => s.trim()).filter(it => it);
    return res.status(200).json({ items });
  } catch (err) {
    return res.status(500).json({ error: "서버 분석 오류" });
  }
}
