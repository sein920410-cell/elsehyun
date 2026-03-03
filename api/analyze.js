import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const { filePath, mimeType } = req.body;

  try {
    if (!filePath) return res.status(400).json({ error: "파일 경로 누락" });

    // 1. Supabase에서 이미지 데이터 가져오기
    const { data: signedData } = await supa.storage.from('user_uploads').createSignedUrl(filePath, 60);
    const imgResp = await fetch(signedData.signedUrl);
    const b64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");

    // 2. [이중 안전장치] 1.5(쓰레기) 없이 2.0 모델들로만 순차적 시도
    // 2.0-flash가 한도에 걸리면 2.0-flash-lite-preview가 바로 투입됩니다.
    const modelStack = ["gemini-2.0-flash", "gemini-2.0-flash-lite-preview-02-05"];
    let finalItems = [];
    let lastErrorMessage = "";

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

      // 성공하면 바로 반복문을 빠져나옵니다.
      if (!data.error) {
        const botText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        finalItems = botText.split(",").map(s => s.trim()).filter(it => it.length > 0);
        break; 
      }
      lastErrorMessage = data.error.message;
    }

    // 3. 결과 반환
    if (finalItems.length > 0) {
      return res.status(200).json({ items: finalItems });
    } else {
      // 모든 모델이 막혔을 때만 사실대로 보고
      return res.status(200).json({ error: `현재 2.0 모델들의 무료 한도가 모두 소진되었습니다: ${lastErrorMessage}` });
    }

  } catch (err) {
    return res.status(500).json({ error: "서버 내부 연결 오류" });
  }
}
