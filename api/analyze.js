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

    // Vercel 환경 변수에 설정된 gemini-3-flash를 가져옵니다.
    const modelName = process.env.GEMINI_MODEL || "gemini-3-flash";
    const apiKey = process.env.GEMINI_API_KEY;

    // 모델 이름을 변수로 처리하여 설정값이 즉시 반영되도록 수정했습니다.
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } },
          { text: "너는 물품 인식 전문가야. 사진 속 물건을 하나하나 찾아서 '카테고리:물건명' 형식으로 쉼표로 나열해줘." }
        ]}]
      })
    });

    const data = await response.json();
    const botText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const items = botText.split(/,|\n/).map(s => s.trim()).filter(s => s.includes(":")).map(s => s.replace(/^[-\s*]+/, ""));
    
    return res.status(200).json({ items: [...new Set(items)] });
  } catch (err) { return res.status(500).json({ error: "분석 실패" }); }
}
