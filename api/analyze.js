import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const { filePath, mimeType } = req.body;

  try {
    if (!filePath) return res.status(400).json({ error: "파일 경로 누락" });

    const { data: signedData } = await supa.storage.from('user_uploads').createSignedUrl(filePath, 60);
    const imgResp = await fetch(signedData.signedUrl);
    const b64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");

    const model = "gemini-2.5-flash-lite"; // RPM 10 적용
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
    
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } },
          { text: "이미지 속 모든 물건을 아주 꼼꼼하게 분석해. 브랜드와 정확한 상품명을 식별하고, '카테고리:브랜드 상품명' 형식으로만 나열해. 예: 위생:베베앙 물티슈, 생활:비에르 화장솜. 잇지도 않은 물건은 절대 지어내지 마." }
        ]}]
      })
    });

    const data = await response.json();
    const botText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    // 쉼표로 구분된 목록을 배열로 변환
    const items = botText.split(",").map(s => s.trim()).filter(it => it.includes(":"));

    return res.status(200).json({ items });
  } catch (err) {
    return res.status(500).json({ error: "분석 오류" });
  }
}
