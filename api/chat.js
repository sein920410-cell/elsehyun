import fetch from "node-fetch";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const { message, inventory, tag } = req.body;

  try {
    // OpenRouter의 무료 모델을 사용하여 비서 '봄'의 페르소나를 유지합니다.
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "google/gemma-3-27b-it:free",
        messages: [{
          role: "system",
          content: `당신은 비서 '봄'입니다. 장소: ${tag}. 현재 물품: ${inventory}. 짧고 친절하게 한국어로 답하세요.`
        }, {
          role: "user",
          content: message
        }]
      })
    });

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || "잠시 후 다시 시도해 주세요.";
    return res.status(200).json({ reply });
  } catch (err) {
    return res.status(500).json({ error: "비서 응답 오류" });
  }
}
