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
          { text: `사진에 보이는 글씨('맘스 크린장갑', '가성비 칫솔', '면봉 1000' 등)를 빠짐없이 그대로 읽어. 글자가 안 보이는 비닐이나 상자는 억지로 지어내지 말고 '기타:비닐', '기타:상자'로 써. 대답은 반드시 '카테고리:물품명' 형식으로만 하고 쉼표로 구분해. 다른 말은 단 한 글자도 적지 마.` }
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
