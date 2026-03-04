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
          { text: `너는 '공간:결'의 정리 전문가 비어야. 사진 속 물건을 분석할 때 다음 규칙을 죽어도 지켜.

1. 절대 지어내지 마: 확실히 보이지 않는 브랜드나 상품명은 절대 쓰지 마.
2. 외형 위주 명칭: 브랜드가 안 보이면 '펌프 용기', '스프레이 병', '분무기' 같이 눈에 보이는 생김새로 이름 지어.
3. 기타 분류: 용도가 애매하거나 명확하지 않으면 카테고리를 '기타'로 분류해.
4. 응답 형식: 무조건 '카테고리:이름' 형식으로만 결과만 쉼표(,)로 나열해. 예: 기타:펌프 용기, 가전:노트북, 기타:스프레이.` }
        ]}]
      })
    });

    const data = await response.json();
    const botText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    // 형식이 틀린 데이터가 들어와도 리스트에 들어갈 수 있게 가공 로직 강화 [cite: 2026-03-04]
    const items = botText.split(",")
      .map(s => s.trim().replace(/\[|\]/g, ""))
      .filter(it => it.includes(":"));

    return res.status(200).json({ items });
  } catch (err) {
    return res.status(500).json({ error: "분석 오류" });
  }
}
