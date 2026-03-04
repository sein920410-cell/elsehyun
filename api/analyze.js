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
          { text: `너는 사업용 수납 관리 시스템 '공간:결'의 전문가야. 사진을 분석할 때 다음 규칙을 죽어도 지켜.

1. 브랜드/이름 지어내지 마: 확실히 보이지 않는 브랜드는 절대 쓰지 마. 모르면 그냥 물건 종류만 써 (예: HP 노트북, 애플워치).
2. 외형 위주 명칭: 브랜드나 이름을 모르면 '펌프 용기', '스프레이 병', '분무기' 같이 눈에 보이는 생김새로 이름 지어.
3. 누락 방지: 책상 위 콘센트(멀티탭), 마우스패드, 수납함 옆 파일 등 작은 물건까지 꼼꼼하게 다 찾아내.
4. 분류가 애매하면 '기타': 용도가 불분명하면 카테고리를 '기타'로 분류해.
5. 응답 형식: 오직 '카테고리:이름' 형식으로만 결과만 쉼표(,)로 나열해. 예: 기타:펌프 용기, 가전:HP 노트북, 생활:멀티탭, 사무:마우스패드.` }
        ]}]
      })
    });

    const data = await response.json();
    const botText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    // 대괄호나 다른 문자가 섞여도 이름만 잘 나오도록 가공 [cite: 2026-03-04]
    const items = botText.split(",").map(s => s.trim().replace(/\[|\]/g, "")).filter(it => it.includes(":"));

    return res.status(200).json({ items });
  } catch (err) {
    return res.status(500).json({ error: "분석 오류" });
  }
}
