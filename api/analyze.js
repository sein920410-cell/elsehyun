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
          { text: "사진 속 물건을 추출해. 1.글자가 써진 물건은 반드시 그 글자를 읽어서 이름으로 정해(예: 맘스 크린장갑). 2.비슷한 물건은 하나로 합쳐서 중복 없이 리스트를 만들어. 3.글자가 없는 잡동사니는 '기타:상자', '기타:비닐' 식으로 딱 한 번씩만 포함하고 100개씩 만들지 마. 4.응답은 반드시 '카테고리:물품명' 형식으로 쉼표로만 구분해. 예: 생활:맘스 크린장갑, 생활:가성비 칫솔, 기타:비닐" }
        ]}]
      })
    });

    const data = await response.json();
    const botText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    // 중복 제거 로직 추가
    const rawItems = botText.split(",").map(s => s.replace(/\[|\]|\n|`|\*/g, "").trim());
    const uniqueItems = [...new Set(rawItems)].filter(it => it.includes(":") && it.length > 3);
    
    return res.status(200).json({ items: uniqueItems });
  } catch (err) {
    return res.status(500).json({ error: "분석 오류" });
  }
}
