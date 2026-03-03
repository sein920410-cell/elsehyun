import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const { images, mimeType } = req.body;

  // 모든 모델 주소를 v1beta로 통일하여 경로 에러 방지
  const modelConfig = [
    { name: "gemini-2.0-flash-exp", version: "v1beta" }, // 실험용 버전까지 추가
    { name: "gemini-1.5-flash-latest", version: "v1beta" }, // v1 대신 v1beta 사용
    { name: "gemini-2.0-flash-lite", version: "v1beta" },
    { name: "gemini-1.5-pro-latest", version: "v1beta" } // 유료급 모델을 마지막 보루로 배치
  ];

  try {
    const contents = [{
      parts: [
        ...images.map(b64 => ({ inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } })),
        { text: "이미지 속 물건들을 '카테고리:물품명' 형식으로 분석하세요. 결과는 오직 한국어와 콤마로만 구분하세요." }
      ]
    }];

    for (const config of modelConfig) {
      const endpoint = `https://generativelanguage.googleapis.com/${config.version}/models/${config.name}:generateContent?key=${process.env.GEMINI_API_KEY}`;
      
      try {
        const gResp = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents })
        });

        const gData = await gResp.json();

        // 한도 초과(429)나 모델 없음(404) 에러 시 즉시 다음 모델로 전환
        if (gData.error) {
          console.warn(`${config.name} 시도 실패: ${gData.error.message}`);
          continue; 
        }

        const botText = gData.candidates?.[0]?.content?.parts?.[0]?.text || "";
        const items = botText.split(",").map(pair => {
            const [cat, name] = pair.split(":").map(s => s.trim());
            return { n: name, cat: cat || "기타", q: 1 };
        }).filter(it => it.n);

        return res.status(200).json({ items });
      } catch (innerErr) { continue; }
    }

    return res.status(429).json({ error: "현재 구글 서버 전체가 매우 혼잡합니다. 1분 뒤 다시 시도해 주세요." });
  } catch (err) { return res.status(500).json({ error: "분석 서버 치명적 오류" }); }
}
