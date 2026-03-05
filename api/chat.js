import fetch from "node-fetch";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const { message, inventory, tag, drawerName } = req.body;

  try {
    // 한도가 넉넉한 Gemini 2.5 Flash 모델을 사용합니다.
    const model = "gemini-2.5-flash"; 
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const prompt = `당신은 상냥한 비서 '봄'입니다. 장소: '${drawerName}'. 물품: ${inventory}. 질문: ${message}. 사장님께 따뜻하고 다정하게 한국어로 짧게 답하세요. 😊`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });

    const data = await response.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "봄이가 다시 확인해 드릴게요!";
    return res.status(200).json({ reply });
  } catch (err) { return res.status(500).json({ error: "채팅 오류" }); }
}
