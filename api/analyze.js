import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const { filePath, mimeType } = req.body;

  // 비즈니스 안정성을 위한 모델 리스트 (버전에 맞는 주소 매칭)
  const modelConfig = [
    { name: "gemini-2.0-flash", version: "v1beta" },
    { name: "gemini-2.0-flash-lite", version: "v1beta" },
    { name: "gemini-1.5-flash", version: "v1" }, // 1.5는 v1에서 가장 안정적임
    { name: "gemini-3-flash-preview", version: "v1beta" }
  ];

  try {
    const { data: signedData } = await supa.storage.from('user_uploads').createSignedUrl(filePath, 60);
    const imgResp = await fetch(signedData.signedUrl);
    const b64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");

    let lastError = "";

    for (const config of modelConfig) {
      const endpoint = `https://generativelanguage.googleapis.com/${config.version}/models/${config.name}:generateContent?key=${process.env.GEMINI_API_KEY}`;
      
      try {
        const gResp = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [
              { inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } },
              { text: "이미지 속 물건의 브랜드와 이름을 한국어 콤마로만 구분해서 나열하세요. 설명은 생략합니다." }
            ]}]
          })
        });

        const gData = await gResp.json();

        // 한도 초과(429) 또는 모델 없음 에러 시 다음 후보로 즉시 전환
        if (gData.error) {
          lastError = gData.error.message;
          console.warn(`${config.name} 실패: ${lastError}`);
          continue; 
        }

        const botText = gData.candidates?.[0]?.content?.parts?.[0]?.text || "";
        const items = botText.replace(/```[a-z]*|```/gi, "").split(",").map(s => s.trim()).filter(it => it.length > 1);
        
        // 결과가 나오면 즉시 반환하여 사용자 대기 시간 최소화
        return res.status(200).json({ items });

      } catch (innerErr) {
        lastError = innerErr.message;
        continue;
      }
    }

    // 모든 시도가 실패했을 때만 에러 반환
    return res.status(429).json({ error: "현재 시스템 점검 중입니다. 잠시 후 다시 시도해 주세요." });

  } catch (err) {
    return res.status(500).json({ error: "서버 오류 발생" });
  }
}
