import fetch from "node-fetch";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const { message, inventory, tag, drawerName } = req.body;

  try {
    // 19번의 기회가 남은 넉넉한 모델을 채팅 전용으로 사용합니다.
    const model = "gemini-2.5-flash"; 
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
    
    const prompt = `당신은 아주 상냥하고 다정한 비서 '봄'입니다. 장소: '${drawerName}'. 현재 물품 목록: ${inventory}. 사용자의 질문: ${message}. 답변할 때 반드시 '${drawerName}'라고 부르며 아주 다정하고 힘이 되는 말투로 한국어로 짧게 답하세요. 😊`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });

    const data = await response.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "봄이가 잠시 다른 생각을 했나 봐요. 다시 한번 말씀해 주시겠어요?";
    return res.status(200).json({ reply });
  } catch (err) {
    return res.status(500).json({ error: "비서 응답 오류" });
  }
}
