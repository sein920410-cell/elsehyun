import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  
  // 기존 drawer.html이 보내는 형식을 그대로 받습니다.
  const { filePath, mimeType } = req.body;

  try {
    if (!filePath) return res.status(400).json({ error: "파일 경로가 없습니다." });

    // 1. Supabase에서 이미지 가져오기
    const { data: signedData } = await supa.storage.from('user_uploads').createSignedUrl(filePath, 60);
    const imgResp = await fetch(signedData.signedUrl);
    const b64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");

    // 2. 제미나이 2.0 모델 호출
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
    
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } },
          { text: "이미지 속 물건들의 이름을 한국어로 분석하세요. 결과는 오직 물건 이름만 콤마로 구분해서 나열하세요. 예: 라면, 망치, 가위. 설명은 절대 하지 마세요." }
        ]}]
      })
    });

    const data = await response.json();

    // 429 에러(한도 초과) 등이 나면 그대로 화면에 뿌려줍니다. [cite: 2026-01-22]
    if (data.error) {
      return res.status(200).json({ error: `제미나이 에러: ${data.error.message}` });
    }

    const botText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    // 3. 기존 UI가 기대하는 배열 형식으로 반환
    const items = botText.split(",").map(s => s.trim()).filter(it => it.length > 0);

    return res.status(200).json({ items });

  } catch (err) {
    return res.status(500).json({ error: "서버 분석 오류 발생" });
  }
}
