import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const { filePath, mimeType } = req.body;

  try {
    if (!filePath) return res.status(400).json({ error: "파일 경로 누락" });

    const { data: signedData } = await supa.storage.from('user_uploads').createSignedUrl(filePath, 60);
    const imgResp = await fetch(signedData.signedUrl);
    const b64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");

    const model = "gemini-2.5-flash-lite"; 
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
    
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } },
          { text: `너는 사업용 스마트 수납 관리 시스템 '공간:결'의 물품 인식 전문가야. 사진 속 모든 물건을 아주 꼼꼼하게 분석해서 [카테고리: 브랜드명 상품명 상세모델] 형식으로만 답해. 

[필수 지침]
1. 브랜드 우선 식별: 노트북은 'HP 노트북', 마우스는 '로지텍 마우스', 충전기는 '맥세이프 충전기'처럼 로고가 보이면 [브랜드+상품종류]로 써. 모델명을 억지로 지어내지 마.
2. 주변 기기 누락 금지: 책상 위나 서랍 주변의 '멀티탭', '마우스패드', 수납함 내부의 '파일/서류' 등 작은 물건까지 하나도 놓치지 마.
3. 응답 형식: 오직 '카테고리:브랜드 상품명' 형식으로만 나열하고 결과만 쉼표(,)로 구분해. 예: 가전:HP 노트북, 가전:애플워치, 생활:멀티탭, 사무:마우스패드` }
        ]}]
      })
    });

    const data = await response.json();
    const botText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const items = botText.split(",").map(s => s.trim().replace(/\[|\]/g, "")).filter(it => it.includes(":"));

    return res.status(200).json({ items });
  } catch (err) {
    return res.status(500).json({ error: "분석 오류" });
  }
}
