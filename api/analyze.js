import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const { filePath, mimeType } = req.body;

  try {
    const { data: signedData } = await supa.storage.from('user_uploads').createSignedUrl(filePath, 60);
    const imgResp = await fetch(signedData.signedUrl);
    const b64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } },
          { text: `너는 사업용 수납 관리 시스템 '공간:결'의 물품 인식 전문가야. 사진을 보고 물품을 추출할 때 다음 지침을 엄격히 따라.

1. 브랜드명 정확히 인식: 'HP 노트북', '로지텍 마우스', '애플워치' 등 로고가 보이는 물건은 반드시 브랜드명을 포함해. [cite: 2026-03-04]
2. 주변 기기 누락 금지: 책상 위 콘센트(멀티탭), 마우스패드, 수납함 옆 서류 등 작은 물건까지 하나하나 꼼꼼하게 다 찾아내. [cite: 2026-03-04]
3. 추측 금지: 확실하지 않으면 '펌프 용기'처럼 보이는 대로만 적어. [cite: 2026-03-04]
4. 응답 형식: 오직 '카테고리:물품명' 형식으로만 결과만 쉼표로 나열해. (예: 가전:HP 노트북, 가전:애플워치, 생활:멀티탭)` }
        ]}]
      })
    });

    const data = await response.json();
    const botText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    // 대괄호를 제거하고 형식에 맞는 데이터만 리스트로 반환 [cite: 2026-03-04]
    const items = botText.split(",").map(s => s.trim().replace(/\[|\]/g, "")).filter(it => it.includes(":"));
    return res.status(200).json({ items });
  } catch (err) {
    return res.status(500).json({ error: "분석 오류" });
  }
}
