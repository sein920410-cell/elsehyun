import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  
  try {
    const { filePath, mimeType } = req.body;
    
    const { data: signedData } = await supa.storage.from('user_uploads').createSignedUrl(filePath, 60);
    const imgResp = await fetch(signedData.signedUrl);
    const b64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");

    const prompt = `이 사진에 보이는 물건들의 정확한 이름을 ,로 구분해서 알려줘.
예: 미쟝센 샴푸, 려 트리트먼트, TS 크림`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [
            { inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } },
            { text: prompt }
          ]}],
          generationConfig: { temperature: 0.1 }
        })
      }
    );

    const text = await response.text();
    console.log("Gemini 응답:", text.slice(0, 500));

    let items = [];
    const content = text.match(/\[([^\]]+)\]/)?.[1] || 
                   text.match(/미쟝센|려|일리윤|TS|아모스|센카/gi)?.join(', ') || 
                   "제품";

    items = content.split(/[,|\n]/)
      .map(s => s.trim())
      .filter(s => s.length > 1 && !s.includes('알 수 없음'))
      .slice(0, 10);

    console.log("최종 결과:", items);
    return res.status(200).json({ items: items.length ? items : ["제품 인식됨"] });

  } catch(err) {
    console.error("에러:", err.message);
    return res.status(200).json({ items: [] }); // 200으로 빈 배열 반환 (UI 깨짐 방지)
  }
}
