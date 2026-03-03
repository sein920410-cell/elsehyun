import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  
  // filePath(기존 방식)와 images(신규 방식)를 동시에 지원하여 충돌 방지
  const { filePath, images, mimeType } = req.body;

  try {
    let finalImages = [];

    // 1. 데이터 추출 로직 (어떤 방식의 요청이 와도 대응)
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

    // 2. 세인 님 계정에서 확인된 '실제 작동 모델' 리스트 (1.5-flash 제거)
    const modelStack = ["gemini-2.0-flash", "gemini-2.0-flash-lite-preview-02-05"];

    const contents = [{
      parts: [
        ...finalImages.map(b64 => ({ inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } })),
        { text: "물류 분석가로서 이미지 속 물건들을 '카테고리:물품명' 형식으로 분석하세요. 결과는 오직 한국어와 콤마로만 구분하세요. 예: 식품:진라면, 도구:망치" }
      ]
    }];

    for (const modelName of modelStack) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`;
      
      try {
        const gResp = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents })
        });

        const gData = await gResp.json();

        // 3. 할당량 초과 시 '치명적 오류' 대신 명확한 안내 전송
        if (gData.error) {
          if (gData.error.code === 429) continue; // 다음 모델로 재시도
          console.warn(`${modelName} 실패: ${gData.error.message}`);
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

    // 모든 모델이 막혔을 때의 최종 안내 [cite: 2026-02-18]
    return res.status(429).json({ error: "오늘의 무료 분석 한도가 모두 소진되었습니다. 한국 시간 오후 5시 이후에 다시 시도해 주세요." });

  } catch (err) {
    return res.status(500).json({ error: "서버 내부 연결 오류", detail: err.message });
  }
}
