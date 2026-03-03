import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const { filePath, mimeType } = req.body;

  try {
    if (!filePath) return res.status(400).json({ error: "파일 경로가 없습니다." });

    // 1. Supabase에서 이미지 데이터 가져오기
    const { data: signedData } = await supa.storage.from('user_uploads').createSignedUrl(filePath, 60);
    const imgResp = await fetch(signedData.signedUrl);
    const b64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");

    // 2. [3중 안전장치] 1.5(쓰레기) 제외, 오직 2.0 최신 모델들로만 뚫기 시도 [cite: 2026-03-02]
    // 각 모델은 독립된 무료 한도를 가질 확률이 매우 높습니다.
    const modelStack = [
      "gemini-2.0-flash", 
      "gemini-2.0-pro-exp-02-05", // 가장 똑똑하고 한도가 따로 노는 모델
      "gemini-2.0-flash-lite-preview-02-05"
    ];
    
    let lastError = "";

    for (const modelName of modelStack) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`;
      
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

      // 성공하면 즉시 결과를 기존 UI 형식에 맞춰 반환합니다.
      if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
        const botText = data.candidates[0].content.parts[0].text;
        const items = botText.split(",").map(s => s.trim()).filter(it => it.length > 0);
        return res.status(200).json({ items });
      }
      
      lastError = data.error ? data.error.message : "알 수 없는 오류";
    }

    // 모든 2.0 모델이 다 막혔을 때만 에러 보고 [cite: 2026-01-22]
    return res.status(200).json({ error: `2.0 시리즈 전체 한도 초과: ${lastError}` });

  } catch (err) {
    return res.status(500).json({ error: "서버 내부 연결 오류" });
  }
}
