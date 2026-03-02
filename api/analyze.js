import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  
  // drawer.html에서 보낸 mimeType을 여기서 받아서 써야 함!
  const { filePath, mimeType } = req.body;

  try {
    const { data: signedData } = await supa.storage.from('user_uploads').createSignedUrl(filePath, 60);
    const imgResp = await fetch(signedData.signedUrl);
    const b64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");

    // 2.0 Flash (일반) 모델과 v1beta 엔드포인트 사용 (한도 에러 방지)
    const apiKey = process.env.GEMINI_API_KEY;
    const model = "gemini-2.0-flash"; 
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const gResp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } },
          { text: "이미지 속 물건의 브랜드와 상세 이름을 한국어 콤마로만 구분해서 나열해줘. 다른 설명은 절대 금지." }
        ]}]
      })
    });

    const gData = await gResp.json();
    if (gData.error) throw new Error(gData.error.message);

    const botText = gData.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const items = botText.replace(/```/g, "").split(",").map(s => s.trim()).filter(it => it.length > 0);
    
    return res.status(200).json({ items });
  } catch (err) {
    console.error("분석 실패:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
