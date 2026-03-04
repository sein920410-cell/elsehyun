import fetch from "node-fetch";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const { message, inventory, tag } = req.body;

  try {
    // 2.0 라인 중 대화에 최적화된 모델 2개를 순차적으로 찌릅니다. [cite: 2026-03-02]
    const chatModels = ["gemini-2.0-flash-lite", "gemini-2.0-flash"];
    let finalReply = "";

    for (const model of chatModels) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
      const prompt = `당신은 비서 '봄'입니다. 장소: ${tag}. 현재 물품: ${inventory}. 질문: ${message}. 짧고 친절하게 한국어로 답하세요.`;

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });

      const data = await response.json();

      // 응답이 성공적으로 오면 바로 중단하고 답장을 보냅니다. [cite: 2026-03-02]
      if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
        finalReply = data.candidates[0].content.parts[0].text;
        break;
      }
    }

    return res.status(200).json({ reply: finalReply || "봄이가 잠시 자리를 비웠어요. 잠시 후 다시 물어봐 주세요!" });

  } catch (err) {
    return res.status(500).json({ error: "비서 시스템 연결 오류" });
  }
}
