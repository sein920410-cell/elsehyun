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

    // [중요] Vercel 설정(gemini-3-flash)을 가져오거나, 없으면 직접 지정합니다.
    const modelName = process.env.GEMINI_MODEL || "gemini-3-flash";
    const apiKey = process.env.GEMINI_API_KEY;

    console.log(`사용 모델: ${modelName}`); // Vercel 로그에서 확인용

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } },
          { text: `너는 '공간:결'의 최고 수준 물품 인식 전문가야. 사진을 정밀 스캔해서 목록을 작성해.
지침:
1. 브랜드명/글자 읽기 최우선: 모든 글자를 읽어서 '카테고리:브랜드명 제품명' 형식으로 적어.
2. 꼼꼼한 전수 조사: 아주 작은 소모품(가위, 건전지, 머리끈 등)도 절대 놓치지 마.
3. 응답 형식: 오직 '카테고리:제품명'들만 쉼표로 나열해. 인사말은 절대 금지.` }
        ]}]
      })
    });

    const data = await response.json();

    // API 응답에 에러가 있는지 로그로 남깁니다.
    if (data.error) {
      console.error("Gemini API 에러:", data.error.message);
      return res.status(500).json({ error: data.error.message });
    }

    const botText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    console.log("Gemini가 인식한 글자:", botText);

    const rawItems = botText.split(",")
      .map(s => s.replace(/[\[\]\n`*]/g, "").trim())
      .filter(it => it.includes(":") && it.length > 2); // 필터링 조건을 살짝 완화했습니다.
    
    const uniqueItems = [...new Set(rawItems)];
    
    return res.status(200).json({ items: uniqueItems });
  } catch (err) {
    console.error("서버 내부 오류:", err);
    return res.status(500).json({ error: "분석 중 오류 발생" });
  }
}
