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

    // 2. 이름 짧게 짓기 지시문
    const geminiPrompt = `사진 속 모든 물건을 찾으세요. 핵심 이름만 짧게 만듭니다.
- 규칙: [브랜드명 + 이름] (예: 려 트리트먼트, 일리윤 청결제)
- 금지어: 루트젠, 더블, 스트렝스, 아르기닌, 젠틀, 클리너 등 모든 수식어 삭제!
- 형식: JSON 배열만 출력하세요: ["상품1", "상품2"]`;

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

    // 🚨 핵심 수정: 응답 상태부터 철저히 검증
    if (!response.ok) {
      throw new Error(`Gemini API 에러: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    // 안전장치 1: candidates/content 경로 안전확인
    let botText = "[]"; // 기본값 빈 배열
    if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
      botText = data.candidates[0].content.parts[0].text;
    } else {
      console.warn("Gemini 응답 구조 이상:", JSON.stringify(data, null, 2));
    }

    // 안전장치 2: 완전 방어적 JSON 파싱
    let items = [];
    try {
      // 텍스트가 비어있거나 null이면 바로 빈 배열 반환
      if (!botText || botText.trim() === "") {
        console.warn("Gemini 응답 텍스트가 비어있음");
        return res.status(200).json({ items: [] });
      }

      let cleanedText = botText.trim();
      
      // 마크다운 제거
      cleanedText = cleanedText.replace(/```json|```|```/g, "").trim();
      
      // JSON 배열 추출 (안전하게)
      const startIdx = cleanedText.indexOf("[");
      const endIdx = cleanedText.lastIndexOf("]");
      if (startIdx !== -1 && endIdx > startIdx) {
        cleanedText = cleanedText.substring(startIdx, endIdx + 1);
      }
      
      // 트레일링 콤마 제거
      cleanedText = cleanedText.replace(/,\s*([\]}])/g, "$1");
      
      console.log("파싱할 JSON:", cleanedText); // 디버깅용
      
      items = JSON.parse(cleanedText);
      
      // 배열이 아닌 경우에도 배열로 강제 변환
      if (!Array.isArray(items)) {
        items = [items].filter(Boolean);
      }
      
    } catch (parseError) {
      console.error("JSON 파싱 실패 - 원본:", botText);
      console.error("파싱 에러:", parseError.message);
      items = []; // 안전하게 빈 배열 반환
    }

    return res.status(200).json({ items });
    
  } catch (err) {
    console.error("서버 내부 오류:", err);
    return res.status(500).json({ error: "분석 실패", details: err.message });
  }
}
