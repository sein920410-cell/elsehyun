import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const { filePath, mimeType } = req.body;

  try {
    if (!filePath) return res.status(400).json({ error: "파일 경로 누락" });

    // 1. Supabase에서 사진 가져오기
    const { data: signedData } = await supa.storage.from('user_uploads').createSignedUrl(filePath, 60);
    const imgResp = await fetch(signedData.signedUrl);
    const b64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");

    // 2. OpenRouter 호출 (가장 안정적인 gemma-3 무료 모델 사용)
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "google/gemma-3-27b-it:free", 
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "이미지 속 물건 이름을 한국어로 분석해. 콤마로만 구분해서 답해. 예: 라면, 망치" },
            { type: "image_url", image_url: { url: `data:${mimeType || 'image/jpeg'};base64,${b64}` } }
          ]
        }]
      })
    });

    const data = await response.json();

    // 3. 에러 발생 시 숨기지 않고 바로 세인 님께 알림 [cite: 2026-01-22]
    if (data.error) {
      const errorMsg = data.error.message || JSON.stringify(data.error);
      return res.status(200).json({ error: `OpenRouter 에러: ${errorMsg}` });
    }

    const botText = data.choices?.[0]?.message?.content || "";
    
    // 4. 결과 정리해서 보내기
    const items = botText.split(",").map(s => s.trim()).filter(it => it.length > 0);

    return res.status(200).json({ items });

  } catch (err) {
    return res.status(200).json({ error: "서버 내부 연결 실패" });
  }
}
