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
          { text: `너는 '공간:결' 시스템의 최고 수준 물품 인식 전문가야. 사진을 정밀 스캔해서 목록을 작성해.

지침:
1. 브랜드명/글자 읽기 최우선: 물건 표면에 적힌 모든 글자를 읽어. '페브리즈'가 써 있으면 반드시 '생활:페브리즈'라고 해야 해. '분무기'라고 뭉뚱그리지 마.
2. 위생 카테고리 적극 분류: '깨끗한나라 롤휴지', '베베앙 물티슈', '일리윤 여성청결제', '칫솔', '면봉' 등은 무조건 '위생' 카테고리로 분류해.
3. 환각 절대 금지: 사진에 없는 물건은 단 하나도 적지 마. 눈에 보이는 것만 적어.
4. 응답 형식: 오직 '카테고리:제품명'들만 쉼표로 나열해. 인사말이나 다른 설명은 단 한 글자도 적지 마. (예: 위생:깨끗한나라 롤휴지, 생활:페브리즈, 위생:베베앙 물티슈)` }
        ]}]
      })
    });

    const data = await response.json();
    const botText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    // 분석 결과에서 불필요한 기호나 인사말을 싹 제거하고 순수 목록만 추출
    const items = botText.split(",")
      .map(s => s.replace(/[\[\]\n`*]/g, "").trim())
      .filter(it => {
        const parts = it.split(":");
        return parts.length === 2 && parts[0].length > 0 && parts[1].length > 0;
      });
    
    return res.status(200).json({ items });
  } catch (err) {
    return res.status(500).json({ error: "분석 오류" });
  }
}
