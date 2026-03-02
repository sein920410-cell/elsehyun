import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";
import { Buffer } from "buffer";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const { filePath, mimeType } = req.body;

  try {
    const { data: signedData, error: sError } = await supa.storage.from('user_uploads').createSignedUrl(filePath, 60);
    if (sError) throw sError;

    const imgResp = await fetch(signedData.signedUrl);
    const buffer = await imgResp.arrayBuffer();
    const b64 = Buffer.from(buffer).toString("base64");

    // Vercel에서 설정한 모델명을 가져옵니다. (없으면 기본값 사용)
    const model = process.env.GEMINI_MODEL || "gemini-2.0-flash-lite";
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const gResp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } },
          { text: "물류 분석가로서 이미지 속 물건의 '브랜드 제품명'을 찾으세요. 결과는 오직 한국어 물품명만 콤마(,)로 구분해 출력하세요. 다른 설명이나 마크다운은 절대 금지합니다." }
        ]}]
      })
    });

    const gData = await gResp.json();
    if (gData.error) throw new Error(gData.error.message);

    let botText = gData.candidates?.[0]?.content?.parts?.[0]?.text || "";
    // 특수문자 및 마크다운 완벽 제거
    botText = botText.replace(/```[a-z]*|```|[*]/gi, "").trim();
    
    const items = botText ? botText.split(",").map(s => s.trim()).filter(it => it.length > 1) : [];
    
    return res.status(200).json({ items });
  } catch (err) {
    return res.status(500).json({ error: "분석 서버 오류", details: err.message });
  }
}
