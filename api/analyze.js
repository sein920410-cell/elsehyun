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

    // 2. OpenRouter 호출 (가장 안정적인 무료 모델로 교체)
    // 'User not found' 에러 방지를 위해 헤더를 더 엄격하게 작성했습니다.
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY.trim()}`, // 혹시 모를 공백 제거
        "Content-Type": "application/json",
        "HTTP-Referer": "https://qr-test-sage.vercel.app", // 실제 로그에 찍힌 도메인으로 수정
        "X-Title": "Gonggan Gyeol"
      },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-exp:free", // 현재 가장 호환성 좋은 무료 모델
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "이미지 속 물건 이름을 한국어로 분석하세요. 결과는 오직 물건 이름만 콤마로 구분해서 나열하세요. 사진에 없는 물건은 절대 말하지 마세요." },
            { type: "image_url", image_url: { url: `data:${mimeType || 'image/jpeg'};base64,${b64}` } }
          ]
        }]
      })
    });

    const data = await response.json();
    
    // 3. 에러 발생 시 상세 정보 반환 (디버깅용) [cite: 2026-01-22]
    if (data.error) {
      console.error("OpenRouter API Error:", data.error);
      return res.status(200).json({ error: `OpenRouter 에러: ${data.error.message || '인증 실패'}` });
    }

    const botText = data.choices?.[0]?.message?.content || "";
    
    // 4. 기존 UI(drawer.html)가 기대하는 배열 형식으로 반환
    const items = botText.split(",").map(s => s.trim()).filter(it => it.length > 0);

    return res.status(200).json({ items });

  } catch (err) {
    return res.status(500).json({ error: "서버 내부 분석 오류" });
  }
}
