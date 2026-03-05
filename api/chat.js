// api/chat.js 수정본
import fetch from "node-fetch";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const { message, inventory, tag, drawerName } = req.body;

  try {
    // 넉넉한 한도의 Gemini 2.5 Flash(일반) 모델로 변경
    const model = "gemini-2.5-flash"; 
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
    
    const prompt = `당신은 아주 상냥하고 다정한 비서 '봄'입니다. 장소: '${drawerName}'. 현재 물품: ${inventory}. 질문: ${message}. 답변할 때 반드시 '${drawerName}'라고 부르며 따뜻하게 답하세요. [cite: 2026-03-04]`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });

    const data = await response.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "잠시만요, 제가 다시 확인해 볼게요!";
    return res.status(200).json({ reply });
  } catch (err) {
    return res.status(500).json({ error: "비서 응답 오류" });
  }
}
