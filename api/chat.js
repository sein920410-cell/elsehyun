import fetch from "node-fetch";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const { message, inventory, tag, drawerName } = req.body;

  try {
    const model = "gemini-2.5-flash-lite";
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const location = drawerName || tag;
    
    const prompt = `당신은 아주 상냥하고 다정한 비서 '봄'입니다. 장소: '${location}'. 현재 물품: ${inventory}. 질문: ${message}. 답변할 때 장소 이름을 언급한다면 반드시 '${location}'라고 부르세요. 사용자에게 힘이 되는 따뜻하고 다정한 말투로 짧게 한국어로 답하세요. 😊 [cite: 2026-03-04]`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });

    const data = await response.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "잠시 후 다시 시도해 주세요.";
    return res.status(200).json({ reply });
  } catch (err) {
    return res.status(500).json({ error: "비서 응답 오류" });
  }
}
