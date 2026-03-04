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
          { text: `너는 사업용 수납 관리 시스템 '공간:결'의 전문가야. 절대 장난질하지 마.

1. 이름 지어내지 마: 확실히 안 보이면 브랜드 쓰지 마. 모르면 '펌프 용기', '스프레이 병'처럼 생김새로 이름 지어. [cite: 2026-03-04]
2. 누락 방지: 콘센트(멀티탭), 마우스패드, 구석의 파일 뭉치까지 꼼꼼하게 다 찾아내. [cite: 2026-03-04]
3. 분류: 애매하면 무조건 '기타' 카테고리로 넣어. [cite: 2026-03-04]
4. 응답 형식: '카테고리:이름' 형식으로 결과만 쉼표로 나열해. "내용이 없다" 같은 말 절대 하지 마.` }
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
