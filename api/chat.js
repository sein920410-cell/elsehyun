import fetch from "node-fetch";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  
  // drawerName을 추가로 받습니다.
  const { message, inventory, tag, drawerName } = req.body;

  try {
    const model = "gemini-2.5-flash-lite";
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
    
    // 장소 이름을 tag(코드) 대신 사용자가 설정한 이름(drawerName)으로 우선 사용합니다.
    const location = drawerName || tag;
    const prompt = `당신은 비서 '봄'입니다. 장소: '${location}'. 현재 물품: ${inventory}. 질문: ${message}. 답변할 때 장소 이름을 언급해야 한다면 반드시 '${location}'라고 부르세요. 짧고 친절하게 한국어로 답하세요.`;

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
