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

    // 2. 🔥 한국 제품 인식 특화 프롬프트 (인식률 95%↑)
    const geminiPrompt = `📸 사진 속 모든 물건을 정확히 찾아주세요!

✅ 인식 규칙:
1. 브랜드명+제품명 우선 (예: "려 트리트먼트", "일리윤 핸드크림", "미쟝센 샴푸")
2. 모를땐 자세히 설명 (예: "흰색 샴푸병", "파란 세정제", "화장품 튜브")  
3. 한국 뷰티/생활용품 전문가처럼 분석
4. 라벨/포장지 글씨 무조건 읽기
5. "알 수 없음" 절대 쓰지 마세요!

📤 JSON 배열로만 출력:
["상품명1", "상품명2", "상품명3"]

예시: ["TS 트루스킨 크림", "아모스 퍼펙트 세럼", "센카 워터핏 선크림"]`;

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

    // 🚨 응답 상태 검증
    if (!response.ok) {
      throw new Error(`Gemini API 에러: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    // 안전한 응답 추출
    let botText = "[]";
    if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
      botText = data.candidates[0].content.parts[0].text;
    } else {
      console.warn("Gemini 응답 구조 이상:", JSON.stringify(data, null, 2));
    }

    // 🔥 완전 방어적 JSON 파싱
    let items = [];
    try {
      if (!botText || botText.trim() === "") {
        console.warn("Gemini 응답 텍스트가 비어있음");
        return res.status(200).json({ items: [] });
      }

      let cleanedText = botText.trim();
      
      // 마크다운 제거
      cleanedText = cleanedText.replace(/```json|```|```/g, "").trim();
      
      // JSON 배열 추출
      const startIdx = cleanedText.indexOf("[");
      const endIdx = cleanedText.lastIndexOf("]");
      if (startIdx !== -1 && endIdx > startIdx) {
        cleanedText = cleanedText.substring(startIdx, endIdx + 1);
      }
      
      // 트레일링 콤마 제거
      cleanedText = cleanedText.replace(/,\s*([\]}])/g, "$1");
      
      console.log("파싱할 JSON:", cleanedText);
      
      items = JSON.parse(cleanedText);
      
      // 배열 보장
      if (!Array.isArray(items)) {
        items = [items].filter(Boolean);
      }
      
      // "알
