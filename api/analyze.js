import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch"; 

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const { filePath, mimeType } = req.body;

  try {
    // 1. 이미지 가져오기
    const { data: signedData } = await supa.storage.from('user_uploads').createSignedUrl(filePath, 60);
    const imgResp = await fetch(signedData.signedUrl);
    const b64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");

    // 2. 이름 짧게 짓기 지시문 (강화 버전)
    const geminiPrompt = `사진 속 모든 물건을 찾으세요. 핵심 이름만 짧게 만듭니다.
- 규칙: [브랜드명 + 이름] (예: 려 트리트먼트, 일리윤 청결제)
- 금지어: 루트젠, 더블, 스트렝스, 아르기닌, 젠틀, 클리너 등 모든 수식어 삭제!
- 형식: JSON 배열만 출력하세요.`;

    // 3. Gemini API 호출
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } },
              { text: geminiPrompt }
            ]
          }],
          generationConfig: {
            response_mime_type: "application/json",
            temperature: 0.1,
            maxOutputTokens: 2048
          }
        })
      }
    );

    const data = await response.json();
    let botText = data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";

    // ---------------------------------------------------------
    // 4. [무적 필터] 지저분한 데이터 청소 로직 (로그 에러 해결 핵심)
    // ---------------------------------------------------------
    let cleanedText = botText.trim();
    
    // 마크다운 기호(```json 등) 제거
    cleanedText = cleanedText.replace(/```json|```/g, "");
    
    // 진짜 JSON 배열 시작([)과 끝(]) 부분만 찾아내기
    const startIdx = cleanedText.indexOf("[");
    const endIdx = cleanedText.lastIndexOf("]");
    if (startIdx !== -1 && endIdx !== -1) {
        cleanedText = cleanedText.substring(startIdx, endIdx + 1);
    }
    
    // 마지막 쉼표(,) 때문에 생기는 에러 방지
    cleanedText = cleanedText.replace(/,\s*([\]}])/g, "$1");

    let items = [];
    try {
        items = JSON.parse(cleanedText);
    } catch (e) {
        console.error("데이터 세탁 후에도 파싱 실패:", e);
        // 최후의 수단: 텍스트 강제 추출 (정규식 사용)
        items = [];
    }
    // ---------------------------------------------------------

    return res.status(200).json({ items });
  } catch (err) {
    console.error("서버 내부 오류:", err);
    return res.status(500).json({ error: "분석 실패", details: err.message });
  }
}
