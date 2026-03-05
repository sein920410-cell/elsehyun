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

    // 사용 가능한 가장 강력한 모델인 Gemini 3 Flash를 호출합니다.
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } },
          { text: `너는 '공간:결'의 최고 수준 물품 인식 전문가야. 사진을 현미경으로 보듯 정밀 스캔해.

지침:
1. 브랜드명 추출 (필수): '페브리즈', '깨끗한나라', '베베앙' 등 물건에 적힌 브랜드명을 무조건 읽어. '분무기', '휴지'라고만 적으면 실패로 간주한다.
2. 위생/안전 카테고리: 휴지, 물티슈, 칫솔 등은 '위생'으로, 소화기나 구급함은 '안전' 카테고리로 묶어.
3. 절대 환각 금지: 사진에 글자가 안 보이거나 없는 물건은 지어내지 마.
4. 응답 형식: 다른 말 없이 오직 '카테고리:제품명'들만 쉼표로 나열해. (예: 생활:페브리즈 강력탈취, 위생:깨끗한나라 롤휴지, 위생:베베앙 물티슈)` }
        ]}]
      })
    });

    const data = await response.json();
    const botText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    // 결과값에서 불필요한 공백과 기호를 제거하고 정확히 분리합니다.
    const items = botText.split(",")
      .map(s => s.replace(/[\[\]\n`*]/g, "").trim())
      .filter(it => it.includes(":") && it.split(":")[1].length > 0);
    
    return res.status(200).json({ items: [...new Set(items)] });
  } catch (err) {
    return res.status(500).json({ error: "분석 오류" });
  }
}
