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
          { text: `너는 '공간:결' 시스템의 최고 전문가야. 사진 속 물건들의 브랜드명을 정확히 읽어서 '카테고리:제품명' 형식으로 쉼표로 나열해. 없는 물건은 절대 지어내지 마.'
지침:
1. 브랜드명/글자 읽기 최우선: 물건 표면에 적힌 모든 글자를 읽어. '페브리즈'가 써 있으면 반드시 '생활:페브리즈'라고 해야 해. '분무기'라고 뭉뚱그리지 마. [cite: 2026-03-04]
2. 위생 카테고리 적극 분류: '깨끗한나라 롤휴지', '베베앙 물티슈', '일리윤 여성청결제', '칫솔', '면봉' 등은 무조건 '위생' 카테고리로 분류해. [cite: 2026-03-04]
3. 환각 절대 금지: 사진에 없는 물건은 단 하나도 적지 마. 눈에 보이는 것만 적어. [cite: 2026-03-04]
4. 응답 형식: 오직 '카테고리:제품명'들만 쉼표로 나열해. 인사말이나 설명은 절대 적지 마. (예: 위생:깨끗한나라 롤휴지, 생활:페브리즈, 위생:베베앙 물티슈)` }
        ]}]
      })
    });

    const data = await response.json();
    const botText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    // 불필요한 기호 제거 및 중복 제거 로직
    const rawItems = botText.split(",")
      .map(s => s.replace(/[\[\]\n`*]/g, "").trim())
      .filter(it => it.includes(":") && it.length > 3);
    
    const uniqueItems = [...new Set(rawItems)];
    
    return res.status(200).json({ items: uniqueItems });
  } catch (err) {
    return res.status(500).json({ error: "분석 오류" });
  }
}
