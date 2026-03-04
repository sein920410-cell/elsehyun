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

    // [수정] 'is not found' 에러 방지를 위해 가장 확실한 정식 모델명으로 교체
    // 2.0-flash를 먼저 쓰고, 한도 초과 시 2.0-flash-lite로 딱 한 번만 더 시도합니다.
    const reliableModels = ["gemini-2.0-flash", "gemini-2.0-flash-lite"];
    let finalItems = [];
    let lastError = "";

    for (const model of reliableModels) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
      
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [
            { inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } },
            { text: "이미지 속 물건 이름을 한국어로 분석해. 콤마로만 구분해서 나열해. 예: 라면, 망치. 설명 금지." }
          ]}]
        })
      });

      const data = await response.json();

      if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
        const botText = data.candidates[0].content.parts[0].text;
        finalItems = botText.split(",").map(s => s.trim()).filter(it => it.length > 0);
        break; 
      }
      lastError = data.error ? data.error.message : "알 수 없는 오류";
    }

    if (finalItems.length > 0) {
      return res.status(200).json({ items: finalItems });
    } else {
      return res.status(200).json({ error: `구글 한도 소진 또는 오류: ${lastError}` });
    }

  } catch (err) {
    return res.status(500).json({ error: "서버 내부 오류" });
  }
}
