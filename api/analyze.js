import { createClient } from "@supabase/supabase-js";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const { filePath, mimeType } = req.body;

  // 1.5가 안 보이니까, 목록에 있는 2.0 일반 모델과 3-Flash를 사용함
  const models = ["gemini-2.0-flash", "gemini-3-flash-preview"];

  try {
    const { data: signedData } = await supa.storage.from('user_uploads').createSignedUrl(filePath, 60);
    const imgResp = await fetch(signedData.signedUrl);
    const b64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");

    for (const modelName of models) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`;
      
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
      if (gData.error && gData.error.code === 429) continue; 
      if (gData.error) throw new Error(gData.error.message);

      const botText = gData.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const items = botText.replace(/```/g, "").split(",").map(s => s.trim()).filter(it => it);
      return res.status(200).json({ items });
    }

    return res.status(429).json({ error: "사용 가능한 모든 모델의 한도가 초과됐어. 잠시 후 다시 시도해줘!" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
