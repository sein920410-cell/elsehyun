import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  
  const { filePath, mimeType } = req.body;

  try {
    if (!filePath) return res.status(400).json({ error: "파일 경로가 없습니다." });

    // 1. Supabase에서 이미지 가져오기
    const { data: signedData } = await supa.storage.from('user_uploads').createSignedUrl(filePath, 60);
    const imgResp = await fetch(signedData.signedUrl);
    const b64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");

    // 2. OpenRouter 무료 비전 모델(Pixtral 12B) 호출
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://gonggan-gyeol.vercel.app",
        "X-Title": "Gonggan Gyeol"
      },
      body: JSON.stringify({
        model: "mistralai/pixtral-12b:free", // 무료이면서 이미지 인식 성능이 검증된 모델
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "이미지 속 물건들의 이름을 한국어로 분석하세요. 오직 물건 이름만 콤마로 구분해서 나열하세요. 사진에 없는 것은 말하지 마세요. 예: 라면, 망치, 가위" },
            { type: "image_url", image_url: { url: `data:${mimeType || 'image/jpeg'};base64,${b64}` } }
          ]
        }]
      })
    });

    const data = await response.json();
    
    // 에러 발생 시 상세 메시지 전달 [cite: 2026-01-22]
    if (data.error) {
      return res.status(200).json({ error: `서버 메시지: ${data.error.message || '인증 실패'}` });
    }

    let botText = data.choices?.[0]?.message?.content || "";
    
    // 분석 결과에서 불필요한 서술어 제거 및 정리 [cite: 2026-02-18]
    const items = botText
      .replace(/물건들은|입니다|분석한 결과|다음은/g, "") // 사족 제거
      .split(/[,|\n]/) // 콤마나 줄바꿈으로 분리
      .map(s => s.replace(/^[0-9.]+|[-*]/g, "").trim()) // 번호나 기호 제거
      .filter(it => it.length > 0 && it.length < 20); // 너무 긴 문장은 제외

    return res.status(200).json({ items });

  } catch (err) {
    return res.status(500).json({ error: "분석 과정에서 연결 오류가 발생했습니다." });
  }
}
