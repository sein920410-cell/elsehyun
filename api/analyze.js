import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  
  // filePath(기존 방식)와 images(신규 방식)를 모두 지원하도록 설계
  const { filePath, images, mimeType } = req.body;

  try {
    let finalImages = [];

    // 1. 이미지가 배열(Base64)로 들어온 경우
    if (images && Array.isArray(images)) {
      finalImages = images;
    } 
    // 2. 파일 경로(Supabase)만 들어온 경우 (원점으로 돌린 drawer.html 호환)
    else if (filePath) {
      const { data: signedData } = await supa.storage.from('user_uploads').createSignedUrl(filePath, 60);
      const imgResp = await fetch(signedData.signedUrl);
      const b64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");
      finalImages = [b64];
    } else {
      return res.status(400).json({ error: "분석할 사진 정보가 부족합니다." });
    }

    // 모든 경로를 v1beta로 통일하여 1.5 모델 'Not Found' 에러 방지
    const modelStack = [
      { name: "gemini-1.5-flash-latest", ver: "v1beta" }, // 가성비 끝판왕을 최우선 배치
      { name: "gemini-2.0-flash-lite", ver: "v1beta" },
      { name: "gemini-2.0-flash", ver: "v1beta" }
    ];

    const contents = [{
      parts: [
        ...finalImages.map(b64 => ({ inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } })),
        { text: "물품 분석가로서 '카테고리:물품명' 형식으로 분석하세요. 결과는 오직 한국어 콤마로만 구분하세요." }
      ]
    }];

    for (const config of modelStack) {
      const endpoint = `https://generativelanguage.googleapis.com/${config.ver}/models/${config.name}:generateContent?key=${process.env.GEMINI_API_KEY}`;
      const gResp = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents }) });
      const gData = await gResp.json();
      
      if (gData.error) {
        console.warn(`${config.name} 실패: ${gData.error.message}`);
        continue;
      }

      const botText = gData.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const items = botText.split(",").map(pair => {
          const [cat, name] = pair.split(":").map(s => s.trim());
          return { n: name, cat: cat || "기타", q: 1 };
      }).filter(it => it.n);

      return res.status(200).json({ items });
    }
    return res.status(429).json({ error: "모든 모델의 할당량이 초과되었습니다. 1분 뒤에 다시 시도해 주세요." });

  } catch (err) {
    return res.status(500).json({ error: "서버 내부 오류", detail: err.message });
  }
}
