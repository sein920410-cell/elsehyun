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

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } },
          { text: `너는 공간:결 시스템의 물품 인식 전문가야. 엉뚱한 물건을 절대 지어내지 말고 아래 규칙을 무조건 지켜.

1. 없는 물건 창조 금지: 억지로 추측해서 지어내지 마.
2. 보이는 글자 그대로 읽기: 겉면에 적힌 한국어와 숫자를 그대로 읽어. (예: '맘스 크린장갑', '가성비 칫솔', '면봉 1000')
3. 추측 금지: 이름표나 글자가 안 보여서 뭔지 확실히 모르는 비닐이나 상자는 '기타:내용물을 알 수 없는 비닐', '기타:상자' 정도로만 적어.
4. 응답 형식: 오직 '카테고리:물품명' 형식으로만 결과만 쉼표로 나열해. (예: 생활:맘스 크린장갑, 생활:가성비 칫솔, 생활:면봉)` }
        ]}]
        ]}]
      })
    });

    const data = await response.json();
    const botText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    // 대괄호를 제거하고 형식에 맞는 데이터만 리스트로 반환 [cite: 2026-03-04]
    const items = botText.split(",").map(s => s.trim().replace(/\[|\]/g, "")).filter(it => it.includes(":"));
    return res.status(200).json({ items });
  } catch (err) {
    return res.status(500).json({ error: "분석 오류" });
  }
}
