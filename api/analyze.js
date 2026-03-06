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

    // 2. 인식률을 최대치로 높인 지시문
const geminiPrompt = `사진 속 모든 물건을 찾아내되, 이름은 브랜드명과 핵심 상품명만 딱 쓰세요.
- 예: 려 트리트먼트, 일리윤 청결제
- 절대 금지: '아르기닌', '스트렝스', '스킨 베리어' 같은 홍보 문구 다 빼세요.
- 형식: [{"category": "분류", "name": "이름", "qty": 개수}]`;

    // 3. AI에게 요청 (결과를 무조건 JSON으로 고정)
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
            maxOutputTokens: 2048 // 더 많은 물건을 쓸 수 있게 늘렸습니다.
          }
        })
      }
    );

    const data = await response.json();
    let botText = data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";

    // 4. 데이터 정리 및 전송
    let items = [];
    try {
      items = JSON.parse(botText);
    } catch (e) {
      console.error("파싱 에러:", e);
      items = [];
    }

    // 프론트엔드에서 바로 쓸 수 있게 이름 뒤에 x수량을 붙인 문자열도 같이 보냅니다.
    const result = {
      items: items.map(it => ({
        category: it.category || "기타",
        name: it.qty > 1 ? `${it.name}x${it.qty}` : it.name,
        qty: it.qty || 1
      }))
    };

    return res.status(200).json(result);
  } catch (err) {
    console.error("분석 오류:", err);
    return res.status(500).json({ error: "분석 오류", details: err.message });
  }
}
