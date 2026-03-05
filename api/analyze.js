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

    // 고난도 분석을 위해 모델을 Gemini 3 Pro로 명시했습니다.
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } },
          { text: `너는 '공간:결' 시스템의 최고 수준 물품 인식 전문가야. 사진을 정밀 스캔해서 목록을 작성해.

지침:
1. 브랜드명/글자 읽기 최우선: 물건 표면에 적힌 모든 글자를 정밀하게 읽어. '페브리즈'가 써 있으면 반드시 '생활:페브리즈'라고 해야 해. 절대 '분무기'라고 뭉뚱그리지 마.
2. 위생 카테고리 적극 분류: '깨끗한나라 롤휴지', '베베앙 물티슈', '일리윤 여성청결제', '칫솔', '면봉' 등은 무조건 '위생' 카테고리로 분류해.
3. 안전 카테고리 생성: '소화기', '구급상자' 등이 보이면 '안전' 카테고리를 만들어 넣어줘.
4. 환각 절대 금지: 사진에 없는 물건은 단 하나도 적지 마. 눈에 보이는 것만 적어.
5. 응답 형식: 오직 '카테고리:제품명'들만 쉼표로 나열해. 인사말이나 다른 설명은 절대 적지 마.` }
        ]}]
      })
    });

    const data = await response.json();
    const botText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    const rawItems = botText.split(",")
      .map(s => s.replace(/[\[\]\n`*]/g, "").trim())
      .filter(it => it.includes(":") && it.length > 3);
    
    const uniqueItems = [...new Set(rawItems)];
    
    return res.status(200).json({ items: uniqueItems });
  } catch (err) {
    return res.status(500).json({ error: "분석 오류" });
  }
}
