import { createClient } from "@supabase/supabase-js";

// Vercel Node 18+ 환경에서는 내장 fetch를 사용하는 것이 가장 안정적입니다.
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  
  const { filePath, mimeType } = req.body;

  try {
    // 1. Supabase 서명된 URL 생성
    const { data: signedData, error: sError } = await supa.storage.from('user_uploads').createSignedUrl(filePath, 60);
    if (sError) {
      console.error("Supabase Error:", sError.message);
      throw new Error("이미지 접근 권한이 없습니다.");
    }

    // 2. 이미지 데이터 가져오기
    const imgResp = await fetch(signedData.signedUrl);
    const buffer = await imgResp.arrayBuffer();
    const b64 = Buffer.from(buffer).toString("base64");

    // 3. Gemini API 호출 (2.0 Flash Lite는 v1beta 필수)
    const model = process.env.GEMINI_MODEL || "gemini-2.0-flash-lite";
    const apiKey = process.env.GEMINI_API_KEY;
    
    if (!apiKey) throw new Error("GEMINI_API_KEY 환경변수가 설정되지 않았습니다.");

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const gResp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } },
          { text: "물류 전문가로서 이미지 속 물건들을 분석하세요. 결과는 오직 한국어 물품 이름들만 콤마(,)로 구분해서 출력하고, 마크다운이나 다른 설명은 절대 하지 마세요. 예: '진라면 매운맛, 삼다수 2L'" }
        ]}]
      })
    });

    const gData = await gResp.json();
    
    // API 에러 응답 처리 (로그 기록)
    if (gData.error) {
      console.error("Gemini API Error Detail:", gData.error);
      throw new Error(`AI 분석 오류: ${gData.error.message}`);
    }

    let botText = gData.candidates?.[0]?.content?.parts?.[0]?.text || "";
    // 불필요한 찌꺼기 제거
    botText = botText.replace(/```[a-z]*|```|[#*]/gi, "").trim();
    
    const items = botText ? botText.split(",").map(s => s.trim()).filter(it => it.length > 0) : [];
    
    return res.status(200).json({ items });

  } catch (err) {
    // Vercel 대시보드 로그에서 이 에러 메시지를 확인할 수 있습니다.
    console.error("서버 내부 에러:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
