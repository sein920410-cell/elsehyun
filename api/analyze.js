import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  
  const { filePath, images, mimeType } = req.body;

  try {
    let finalImages = [];
    if (images && Array.isArray(images)) {
      finalImages = images;
    } else if (filePath) {
      const { data: signedData } = await supa.storage.from('user_uploads').createSignedUrl(filePath, 60);
      const imgResp = await fetch(signedData.signedUrl);
      const b64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");
      finalImages = [b64];
    } else {
      return res.status(400).json({ error: "분석할 데이터가 없습니다." });
    }

    // 모델 이름을 가장 표준적인 것으로 수정 (v1beta에서 확실히 작동하는 이름들)
    const modelStack = [
      "gemini-1.5-flash", // 1.5-flash-latest 대신 표준 이름 사용
      "gemini-2.0-flash-lite-preview-02-05", // Lite 모델의 구체적 이름
      "gemini-2.0-flash",
      "gemini-1.5-pro"
    ];

    const contents = [{
      parts: [
        ...finalImages.map(b64 => ({ inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } })),
        { text: "물류 전문가로서 물건을 '카테고리:물품명'으로 분석해. 오직 한국어 콤마로만 구분해." }
      ]
    }];

    for (const modelName of modelStack) {
      // 모든 주소를 v1beta로 통일
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`;
      
      try {
        const gResp = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents }) });
        const gData = await gResp.json();

        if (gData.error) {
          console.warn(`${modelName} 시도 실패: ${gData.error.message}`);
          continue; 
        }

        const botText = gData.candidates?.[0]?.content?.parts?.[0]?.text || "";
        const items = botText.split(",").map(pair => {
            const [cat, name] = pair.split(":").map(s => s.trim());
            return { n: name, cat: cat || "기타", q: 1 };
        }).filter(it => it.n);

        return res.status(200).json({ items });
      } catch (err) { continue; }
    }

    return res.status(429).json({ error: "모든 모델의 할당량이 초과되었습니다. 1분 뒤에 다시 시도해 주세요." });
  } catch (err) { return res.status(500).json({ error: "분석 서버 치명적 오류", detail: err.message }); }
}
