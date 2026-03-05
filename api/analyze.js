// api/analyze.js 수정본
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

    // 가장 똑똑한 Gemini 3 Flash 사용 (남은 한도 5회 집중 투입)
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } },
          { text: `너는 '공간:결'의 물품 인식 전문가야. 사진 속 모든 물건을 아주 작은 것 하나까지 찾아내야 해.
지침:
1. 브랜드명/글자 읽기: 건전지의 브랜드(듀라셀 등), 연고 이름, 펜의 종류까지 보이는 글자는 다 읽어.
2. 꼼꼼한 전수 조사: 서랍 구석에 있는 테이프, 머리끈, 실타래, 가위 같은 작은 소모품도 절대 놓치지 마.
3. 카테고리 분류: '위생', '문구', '공구', '생활' 등으로 명확히 나눠.
4. 출력 형식: 오직 '카테고리:제품명'들만 쉼표로 나열해. (예: 문구:네임펜, 공구:줄자, 생활:무지개실타래) [cite: 2026-03-04]` }
        ]}]
      })
    });

    const data = await response.json();
    const botText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const rawItems = botText.split(",").map(s => s.replace(/[\[\]\n`*]/g, "").trim()).filter(it => it.includes(":") && it.length > 2);
    const uniqueItems = [...new Set(rawItems)];
    
    return res.status(200).json({ items: uniqueItems });
  } catch (err) {
    return res.status(500).json({ error: "분석 오류" });
  }
}
