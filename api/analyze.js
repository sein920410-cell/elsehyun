import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const { filePath, mimeType } = req.body;

  try {
    const { data: signedData } = await supa.storage.from('user_uploads').createSignedUrl(filePath, 60);
    const imgResp = await fetch(signedData.signedUrl);
    const b64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");

    // 1. Gemini 프롬프트 수정: JSON+구조 강제
    const geminiPrompt = `
사진 속 물건을 추출해.

반드시 다음 규칙만 따를 것:
- 글자가 써진 물건은 반드시 그 글자를 읽어 이름으로 정해 (예: 맘스 크린장갑).
- 비슷한 물건은 하나로 합쳐서 중복 없이 리스트를 만들어.
- 글자가 없는 잡동사니는 '기타:상자', '기타:비닐' 식으로 딱 한 번씩만 포함. 100개씩 만들지 말고, 실제로 있는 것만.
- 설명, 문단, 예시, '카테고리:' 서식 설명, '예:' 문장은 전혀 붙이지 말고, 오직 '카테고리:물품명' 형식으로만 쉼표로 구분.
- 아무 문장 설명 없이, 오직 물품 리스트만 생성.

예시처럼 시작:
생활:맘스 크린장갑,생활:가성비 칫솔,기타:비닐
`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } },
                { text: geminiPrompt },
              ],
            },
          ],
        }),
      }
    );

    const data = await response.json();
    let botText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // 2. Gemini 응답에서 정말 '리스트 문자열'만 남기기
    // - 줄바꿈, ``, `**`, `##` 같은 거 정리
    botText = botText
      .replace(/\\n|\\t/g, " ")
      .replace(/\*\*.*?\*\*/g, "") // bold 제거
      .replace(/`.*?`/g, "")       // code 제거
      .replace(/\*\*(.*?)\*\*/g, "$1") // bold 문장만 텍스트만 남김
      .trim();

    // 3. ',' 기준으로 자르고, 
    //    - '카테고리:물품명' 형식만 허용
    const rawItems = botText.split(",").map((s) => s.trim());
    const uniqueItems = [];

    for (const item of rawItems) {
      // "카테고리:물품명" 형식만 허용
      if (item.includes(":") && item.length > 3) {
        // 앞뒤 공백·기호 정리
        const clean = item.replace(/^[^\w가-힣:]+|[^\w가-힣:]+$/g, "").trim();
        if (clean && !uniqueItems.includes(clean)) {
          uniqueItems.push(clean);
        }
      }
    }

    return res.status(200).json({ items: uniqueItems });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "분석 오류" });
  }
}
