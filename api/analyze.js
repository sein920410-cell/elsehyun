import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  
  // 기존 drawer.html의 filePath 방식을 그대로 따릅니다.
  const { filePath, mimeType } = req.body;

  try {
    if (!filePath) return res.status(400).json({ error: "파일 경로가 없습니다." });

    // 1. Supabase에서 이미지 데이터 가져오기
    const { data: signedData } = await supa.storage.from('user_uploads').createSignedUrl(filePath, 60);
    const imgResp = await fetch(signedData.signedUrl);
    const b64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");

    // 2. OpenRouter 무료 비전 모델 호출 (구글 한도 영향 없음)
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://gonggan-gyeol.vercel.app",
        "X-Title": "Gonggan Gyeol"
      },
      body: JSON.stringify({
        model: "google/gemma-3-27b-it:free", 
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "물품 분석가로서 이미지 속 물건들을 한국어로 분석하세요. 결과는 오직 물건 이름만 콤마로 구분해서 나열하세요. 사진에 없는 물건은 절대 말하지 마세요. 예: 라면, 망치, 가위" },
            { type: "image_url", image_url: { url: `data:${mimeType || 'image/jpeg'};base64,${b64}` } }
          ]
        }]
      })
    });

    const data = await response.json();
    const botText = data.choices?.[0]?.message?.content || "";
    
    // 3. 기존 UI가 기대하는 ["물건1", "물건2"] 배열 형식으로 반환
    const items = botText.split(",").map(s => s.trim()).filter(it => it.length > 0);

    return res.status(200).json({ items });

  } catch (err) {
    return res.status(500).json({ error: "분석 서버 연결 실패" });
  }
}
