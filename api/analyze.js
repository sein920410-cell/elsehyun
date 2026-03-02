import { createClient } from "@supabase/supabase-js";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  
  const { filePath, mimeType } = req.body;

  try {
    const { data: signedData } = await supa.storage.from('user_uploads').createSignedUrl(filePath, 60);
    const imgResp = await fetch(signedData.signedUrl);
    const b64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");

    // 네가 설정한 2.0 Flash Lite 모델과 v1beta 엔드포인트 사용
    const apiKey = process.env.GEMINI_API_KEY;
    const model = "gemini-2.0-flash-lite"; 
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const gResp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } },
          { text: "이미지 속 물건의 브랜드와 이름을 한국어 콤마로만 구분해서 나열해줘." }
        ]}]
      })
    });

    const gData = await gResp.json();
    
    // 한도 초과 시 사용자에게 정확한 상황을 알림
    if (gData.error) {
      if (gData.error.code === 429) {
        return res.status(429).json({ error: "현재 AI 사용량이 많아 잠시 막혔어. 1분 뒤에 다시 시도해줘!" });
      }
      throw new Error(gData.error.message);
    }

    const botText = gData.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const items = botText.replace(/```/g, "").split(",").map(s => s.trim()).filter(it => it);
    
    return res.status(200).json({ items });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
