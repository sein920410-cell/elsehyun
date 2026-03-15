import fetch from "node-fetch";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  
  const { message, inventory, tag, drawerName } = req.body;

  try {
    const model = "gemini-3.1-flash-preview";
    // 🚀 여기를 'GEMINI_API_KEY_CHAT'으로 바꿔서 분석용 키와 충돌나지 않게 합니다.
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
    
    const location = drawerName || tag;
    const prompt = `당신은 상냥한 비서 '봄'입니다. 장소: '${location}'. 현재 물품: ${inventory}. 질문: ${message}. 답변할 때 장소 이름을 언급해야 한다면 반드시 '${location}'라고 부르세요. 친절하게 한국어로 답하세요.`;

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
