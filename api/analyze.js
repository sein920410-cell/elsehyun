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

    // Vercel 설정(gemini-3-flash)을 정확히 사용합니다.
    const modelName = process.env.GEMINI_MODEL || "gemini-3-flash";
    
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } },
          { text: "너는 '공간:결'의 물품 인식 전문가야. 사진 속 물건을 하나하나 찾아서 '카테고리:물건명' 형식으로 쉼표로 나열해줘. 예) 위생:치약, 생활:가위" }
        ]}]
      })
    });

    const data = await response.json();
    const botText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    // AI가 뭐라고 답하든 목록만 쏙 뽑아내는 강력한 필터입니다.
    const items = botText.split(/,|\n/)
      .map(s => s.trim())
      .filter(s => s.includes(":"))
      .map(s => s.replace(/^[-\s*]+/, ""));
    
    return res.status(200).json({ items: [...new Set(items)] });
  } catch (err) {
    return res.status(500).json({ error: "분석 실패" });
  }
}
