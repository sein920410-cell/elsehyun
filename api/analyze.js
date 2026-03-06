import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  
  try {
    const { filePath, mimeType } = req.body;
    const { data: signedData } = await supa.storage.from('user_uploads').createSignedUrl(filePath, 60);
    const imgResp = await fetch(signedData.signedUrl);
    const b64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");

    const prompt = `사진 속 물건들 JSON 배열로: ["상품1","상품2"]`;
    
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } }, { text: prompt }] }],
        generationConfig: { response_mime_type: "application/json", temperature: 0.1 }
      })
    });

    const text = await response.text();
    let items = [];
    
    try {
      const data = JSON.parse(text);
      const botText = data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
      items = JSON.parse(botText.replace(/```json|```/g, "").replace(/,\s*]/g, "]"));
    } catch(e) {
      items = [];
    }

    return res.status(200).json({ items });
  } catch(err) {
    return res.status(500).json({ error: "분석 실패" });
  }
}
