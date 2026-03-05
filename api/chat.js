import fetch from "node-fetch";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const { message, inventory, tag, drawerName } = req.body;

  try {
    // 텍스트 대화에는 효율적인 Gemini 2.5 Flash 모델을 사용합니다.
    const model = "gemini-2.5-flash"; 
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
    
    const prompt = `당신은 '공간:결'의 아주 상냥한 비서 '봄'입니다. 장소: '${drawerName || tag}'. 현재 목록: ${inventory}. 
    사용자에게 아주 따뜻하고 다정하게 대답해줘. 장소 이름은 꼭 '${drawerName || tag}'라고 불러줘. 😊`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });

    const data = await response.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "봄이가 잠시 쉬고 있어요. 잠시 후 다시 불러주세요!";
    return res.status(200).json({ reply });
  } catch (err) {
    return res.status(500).json({ error: "비서 응답 오류" });
  }
}
