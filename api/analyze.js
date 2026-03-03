import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  
  // 기존 drawer.html에서 보내는 데이터 형식(filePath)을 그대로 사용합니다.
  const { filePath, mimeType } = req.body;

  try {
    if (!filePath) return res.status(400).json({ error: "파일 경로가 없습니다." });

    // Supabase에서 이미지 데이터 가져오기
    const { data: signedData } = await supa.storage.from('user_uploads').createSignedUrl(filePath, 60);
    const imgResp = await fetch(signedData.signedUrl);
    const b64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");

    // 계정에서 확인된 사용 가능한 모델 리스트 (v1beta 고정)
    const modelStack = [
      "gemini-2.0-flash",
      "gemini-2.0-flash-lite-preview-02-05"
    ];

    for (const modelName of modelStack) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`;
      
      try {
        const gResp = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [
              { inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } },
              { text: "이미지 속 물건들의 이름을 한국어로 분석하세요. 결과는 오직 물건 이름만 콤마로 구분해서 나열하세요. 예: 라면, 망치, 가위. 설명은 하지 마세요." }
            ]}]
          })
        });

        const gData = await gResp.json();

        // 한도 초과(429) 시 다음 모델로 넘어가고, 성공 시 즉시 반환
        if (gData.error) continue;

        const botText = gData.candidates?.[0]?.content?.parts?.[0]?.text || "";
        // 기존 drawer.html이 기대하는 문자열 배열 형식으로 변환
        const items = botText.split(",").map(s => s.trim()).filter(it => it.length > 0);

        return res.status(200).json({ items });
      } catch (innerErr) { continue; }
    }

    // 모든 모델이 실패한 경우 (주로 일일 한도 초과)
    return res.status(429).json({ error: "구글 무료 한도가 소진되었습니다. 오후 5시 이후에 다시 시도해 주세요." });

  } catch (err) {
    return res.status(500).json({ error: "서버 분석 오류 발생" });
  }
}
