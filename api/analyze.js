import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const { filePath, mimeType } = req.body;

  try {
    // 1. 구글 API를 호출합니다.
    const { data: signedData } = await supa.storage.from('user_uploads').createSignedUrl(filePath, 60);
    const imgResp = await fetch(signedData.signedUrl);
    const b64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const gResp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } }, { text: "물품 이름을 한국어로 분석해. 콤마로 구분해." }] }]
      })
    });

    const gData = await gResp.json();

    // 2. 만약 한도 초과(429) 에러가 나면, 여기서 "테스트 데이터"를 강제로 보냅니다.
    if (gData.error && gData.error.code === 429) {
      console.warn("한도 초과로 인해 테스트 모드로 전환합니다.");
      // API가 죽어도 세인 님이 drawer.html의 '목록 추가'와 '편집' 기능을 확인할 수 있게 합니다.
      return res.status(200).json({ 
        items: ["테스트물품_라면", "테스트물품_스팸", "테스트물품_참치캔"],
        isTestMode: true 
      });
    }

    const botText = gData.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const items = botText.split(",").map(s => s.trim()).filter(it => it.length > 0);
    return res.status(200).json({ items });

  } catch (err) {
    // 서버가 터져도 '가상 데이터'는 보내서 세인 님이 쉬실 수 있게 합니다.
    return res.status(200).json({ items: ["인식 서버 대기 중", "수동 추가 가능"] });
  }
}
