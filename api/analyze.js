import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const { filePath, mimeType } = req.body;

  const modelConfig = [
    { name: "gemini-2.0-flash", version: "v1beta" },
    { name: "gemini-2.0-flash-lite", version: "v1beta" },
    { name: "gemini-1.5-flash", version: "v1" }, 
    { name: "gemini-3-flash-preview", version: "v1beta" }
  ];

  try {
    const { data: signedData } = await supa.storage.from('user_uploads').createSignedUrl(filePath, 60);
    const imgResp = await fetch(signedData.signedUrl);
    const b64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");

    for (const config of modelConfig) {
      const endpoint = `https://generativelanguage.googleapis.com/${config.version}/models/${config.name}:generateContent?key=${process.env.GEMINI_API_KEY}`;
      try {
        const gResp = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [
              { inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } },
              { text: "이미지 속 물건들을 '카테고리:물품명' 형식으로 분석하세요. 예: 식품:진라면, 도구:망치. 결과는 오직 한국어와 콤마로만 구분하고 설명은 절대 생략하세요." }
            ]}]
          })
        });
        const gData = await gResp.json();
        if (gData.error) continue; 

        const botText = gData.candidates?.[0]?.content?.parts?.[0]?.text || "";
        const items = botText.split(",").map(pair => {
            const [cat, name] = pair.split(":").map(s => s.trim());
            return { n: name, cat: cat || "기타", q: 1 };
        }).filter(it => it.n);
        return res.status(200).json({ items });
      } catch (err) { continue; }
    }
    return res.status(429).json({ error: "시스템 점검 중" });
  } catch (err) { return res.status(500).json({ error: "서버 오류" }); }
}
