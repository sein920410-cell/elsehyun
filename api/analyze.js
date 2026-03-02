import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  
  // drawer.html에서 보낸 filePath와 mimeType을 정확히 받습니다.
  const { filePath, mimeType } = req.body;

  try {
    const { data: signedData } = await supa.storage.from('user_uploads').createSignedUrl(filePath, 60);
    const imgResp = await fetch(signedData.signedUrl);
    const b64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");

    // 한도 초과(429) 에러 발생 시 순차적으로 시도할 모델 리스트
    // 2.0-flash-lite가 한도가 가장 넉넉해서 백업으로 넣었습니다.
    const models = ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-flash"];
    let lastErrorMessage = "";

    for (const model of models) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
      
      const gResp = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [
            { inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } },
            { text: "물류 분석가로서 이미지 속 물건의 '브랜드명 상세제품명'을 한국어 콤마로만 구분해서 출력해. 다른 설명은 절대 하지 마." }
          ]}]
        })
      });

      const gData = await gResp.json();

      // 한도 초과 에러(429)가 나면 다음 모델로 넘어감
      if (gData.error) {
        lastErrorMessage = gData.error.message;
        if (gData.error.code === 429) continue;
        throw new Error(lastErrorMessage);
      }

      // 성공 시 데이터 정제 후 반환
      const botText = gData.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const items = botText.replace(/```[a-z]*|```/gi, "").split(",").map(s => s.trim()).filter(it => it.length > 1);
      
      return res.status(200).json({ items });
    }

    // 모든 모델이 실패했을 때
    return res.status(429).json({ error: "모든 모델의 사용 한도가 초과되었습니다. 1분 뒤에 다시 시도해 주세요!" });

  } catch (err) {
    console.error("분석 에러:", err.message);
    return res.status(500).json({ error: "분석 중 오류 발생", details: err.message });
  }
}
