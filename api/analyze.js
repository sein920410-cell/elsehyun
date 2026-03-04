import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const { filePath, mimeType } = req.body;

  try {
    if (!filePath) return res.status(400).json({ error: "파일 경로 누락" });

    // 1. Supabase 이미지 가져오기
    const { data: signedData } = await supa.storage.from('user_uploads').createSignedUrl(filePath, 60);
    const imgResp = await fetch(signedData.signedUrl);
    const b64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");

// ... (상단 코드 유지)
    // [수정] 한도가 따로 노는 Experimental(실험용) 모델을 최우선으로 배치
    const modelStack = ["gemini-2.0-flash-exp", "gemini-2.0-flash"];
    let finalItems = [];
    let lastError = "";

    for (const modelName of modelStack) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`;
// ... (하단 코드 유지)
      
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [
            { inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } },
            { text: "이미지 속 물건 이름을 한국어로 분석하세요. 결과는 오직 물건 이름만 콤마로 구분해서 나열하세요. 예: 라면, 망치. 설명 금지." }
          ]}]
        })
      });

      const data = await response.json();

      if (!data.error) {
        const botText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        finalItems = botText.split(",").map(s => s.trim()).filter(it => it.length > 0);
        break; 
      }
      lastError = data.error.message;
    }

    // 3. 결과 반환
    if (finalItems.length > 0) {
      return res.status(200).json({ items: finalItems });
    } else {
      return res.status(200).json({ error: `2.0 라인 한도 초과: ${lastError}` });
    }

  } catch (err) {
    return res.status(500).json({ error: "서버 내부 오류" });
  }
}
