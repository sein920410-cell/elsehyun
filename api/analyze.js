import { createClient } from "@supabase/supabase-js";
import { Buffer } from "buffer";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  
  // 클라이언트에서 보낸 mimeType을 받습니다.
  const { filePath, mimeType = "image/jpeg" } = req.body;

  try {
    const { data: signedData, error: sError } = await supa.storage.from('user_uploads').createSignedUrl(filePath, 60);
    if (sError) throw sError;

    const imgResp = await fetch(signedData.signedUrl);
    const arrayBuffer = await imgResp.arrayBuffer();
    const b64 = Buffer.from(arrayBuffer).toString("base64");

    const endpoint = `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const gResp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mimeType, data: b64 } },
          { text: `
            당신은 물류 관리 전문가입니다. 이미지 속 물건들을 정밀 분석하세요.
            1. 제품 패키지에 적힌 '브랜드명'과 '상세 제품명'을 반드시 하나로 합쳐서 출력하세요.
            2. 결과는 오직 한국어 물품 이름들만 콤마(,)로 구분해서 출력하고, 다른 설명이나 마크다운 형식은 절대 하지 마세요.
            3. 만약 물건이 없다면 빈 칸으로 출력하세요.
          ` }
        ]}]
      })
    });

    const gData = await gResp.json();
    let botText = gData.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    // AI가 마크다운이나 불필요한 문자를 포함했을 경우를 대비해 정제합니다.
    botText = botText.replace(/```[a-z]*|```/g, '').trim();
    
    const items = botText ? botText.split(",").map(s => s.trim()).filter(it => it) : [];
    
    return res.status(200).json({ items });
  } catch (err) {
    console.error("분석 에러 상세:", err); // Vercel 로그에서 확인 가능
    return res.status(500).json({ error: "서버 분석 오류", details: err.message });
  }
}
