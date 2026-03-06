import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch"; 

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const { filePath, mimeType } = req.body;

  try {
    // 1. Supabase 이미지 다운로드
    const { data: signedData } = await supa.storage.from('user_uploads').createSignedUrl(filePath, 60);
    const imgResp = await fetch(signedData.signedUrl);
    const b64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");

    // 2. 개선된 프롬프트
    const geminiPrompt = `사진 속 모든 물건 카운트해서 목록 만들어.

✅ 정확 규칙:
1. 브랜드: "베베앙","페브리즈","일리윤" 앞에 무조건
2. 수량: "물티슈 3개" → 물티슈x3 (x1은 생략)
3. 카테고리: 위생/청소/케어/생활/기타
4. 형식: "카테고리:브랜드상품x수량"

📋 예시 (딱 이렇게):
["위생:베베앙 물티슈x3","청소:페브리즈 분무기","생활:크린장갑x4"]

설명 없이 배열로만 출력!`;

    // 3. Gemini 2.5 Flash + JSON 강제
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
            maxOutputTokens: 1024
          }
        })
      }
    );

    const data = await response.json();
    let botText = data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";

    // 4. JSON 파싱 + 기존 형식 완벽 호환
    let items = [];
    try {
      items = JSON.parse(botText);
    } catch {
      // Fallback: 텍스트 파싱
      const rawItems = botText.split(",").map(s => s.trim()).filter(s => s.includes(":"));
      items = rawItems.map(s => {
        const [category, name] = s.split(":");
        return { category: category || "기타", name: name || "알수없음" };
      });
    }

    // 5. 기존 프론트엔드 완벽 호환 응답
    const result = {
      items: items,                           // 새 JSON 형식
      items_string: items.map(item => `${item.category}:${item.name}`).join(',')  // 기존 문자열 형식
    };

    return res.status(200).json(result);
  } catch (err) {
    console.error("분석 오류:", err);
    return res.status(500).json({ error: "분석 오류", details: err.message });
  }
}
