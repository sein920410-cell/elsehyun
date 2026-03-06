import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch"; 

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const { filePath, mimeType } = req.body;

  try {
    // 1. Supabase 이미지 다운로드 및 Base64 변환
    const { data: signedData } = await supa.storage.from('user_uploads').createSignedUrl(filePath, 60);
    const imgResp = await fetch(signedData.signedUrl);
    const b64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");

    // 2. [핵심] 이름 짧게 짓기 지시문 강화 [cite: 2026-02-08, 2026-01-22]
    const geminiPrompt = `사진 속 모든 물건을 꼼꼼하게 찾으세요. 
단, 상품 이름은 반드시 아래 규칙을 지키세요.

✅ 이름 규칙 (어기면 안 됨):
1. 무조건 [브랜드명 + 핵심이름] (예: 려 트리트먼트, 일리윤 청결제)
2. '루트젠', '더블', '스트렝스', '아르기닌', '젠틀', '클리너' 등 수식어는 전부 삭제! [cite: 2026-02-08]
3. 없는 이름을 지어내지 말고 용기에 크게 써진 핵심 브랜드와 이름만 쓰세요. [cite: 2026-01-22]

✅ 형식: JSON 배열만 출력 (설명 금지)
[
  {"category": "케어", "name": "려 트리트먼트", "qty": 1},
  {"category": "케어", "name": "일리윤 청결제", "qty": 1}
]`;

    // 3. Gemini API 호출 (2.5 Flash 사용)
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
            response_mime_type: "application/json", // JSON으로 강제 고정
            temperature: 0.1, // 창의성 배제, 일관성 유지
            maxOutputTokens: 2048
          }
        })
      }
    );

    const data = await response.json();
    let botText = data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";

    // 4. 데이터 파싱 및 응답
    let items = [];
    try {
        items = JSON.parse(botText);
    } catch (e) {
        console.error("JSON 파싱 에러:", e);
        items = [];
    }

    // 최종 결과 반환
    return res.status(200).json({ items });
  } catch (err) {
    console.error("서버 분석 오류:", err);
    return res.status(500).json({ error: "분석 오류", details: err.message });
  }
}
