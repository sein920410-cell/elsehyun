import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const { filePath, mimeType } = req.body;

  try {
    if (!filePath) return res.status(400).json({ error: "파일 경로 누락" });

    const { data: signedData } = await supa.storage.from('user_uploads').createSignedUrl(filePath, 60);
    const imgResp = await fetch(signedData.signedUrl);
    const b64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");

    // 한도가 19회 남은 2.5 모델로 정확히 연결합니다.
    const model = "gemini-2.5-flash";
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
    
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } },
          { text: "이미지 속 물건 이름을 한국어로 분석해. 콤마로만 구분해. 예: 라면, 망치. 설명 금지." }
        ]}]
      })
    });

    const data = await response.json();

    if (data.error) {
      return res.status(200).json({ error: `구글 에러: ${data.error.message}` });
    }

    const botText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const items = botText.split(",").map(s => s.trim()).filter(it => it.length > 0);

    return res.status(200).json({ items });

  } catch (err) {
    return res.status(500).json({ error: "서버 연결 오류" });
  }
}
