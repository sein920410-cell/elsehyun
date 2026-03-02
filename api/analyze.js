import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  
  // drawer.html에서 보낸 mimeType을 여기서 정확히 받아야 함
  const { filePath, mimeType } = req.body;

  try {
    const { data: signedData } = await supa.storage.from('user_uploads').createSignedUrl(filePath, 60);
    const imgResp = await fetch(signedData.signedUrl);
    const b64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");

    // 한도 초과를 대비해 여러 모델을 순차적으로 시도함
    const modelStack = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-flash-8b"];
    let lastError = "";

    for (const model of modelStack) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
      
      const gResp = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [
            { inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } },
            { text: "물류 분석가로서 이미지 속 물건의 '브랜드명 상세이름'을 한국어로 찾으세요. 결과는 오직 이름들만 콤마(,)로 구분해 출력하세요." }
          ]}]
        })
      });

      const gData = await gResp.json();

      // 한도 초과(429) 에러가 나면 다음 모델로 넘어감
      if (gData.error) {
        lastError = gData.error.message;
        if (gData.error.code === 429) continue;
        throw new Error(lastError);
      }

      // 성공 시 데이터 반환
      const botText = gData.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const items = botText.replace(/```/g, "").split(",").map(s => s.trim()).filter(it => it.length > 1);
      return res.status(200).json({ items });
    }

    // 모든 모델이 실패한 경우
    throw new Error(`모든 AI 모델의 한도가 초과되었습니다: ${lastError}`);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
