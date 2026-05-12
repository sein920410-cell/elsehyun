import fetch from "node-fetch";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  
  const { message, inventory, tag, drawerName, history = [] } = req.body;

  try {
    const model = process.env.GEMINI_MODEL || "gemini-3-flash-preview";
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
    
    const location = drawerName || tag;
    const systemPrompt = `너는 수납 비서 '봄'이야.
지금 대화 중인 수납 공간 이름: ${location}
현재 보관된 물품 목록: ${inventory}

[말투 규칙]
- 반말 금지. 존댓말을 쓰되 딱딱하지 않고 편안하게.
- 인사(안녕하세요, 반갑습니다 등) 절대 금지. 이미 대화 중이야.
- "제가 도움이 되길 바랍니다", "더 궁금한 점 있으시면 말씀해 주세요" 같은 마무리 멘트 금지.
- 이모지 과다 사용 금지 (필요할 때 1개 정도만).
- 답변은 짧고 핵심만. 2~4문장이면 충분해.
- 물건 찾기: 목록에 있으면 "있어요", 없으면 "목록에는 없네요"로 바로 답해.
- 정리 제안 등 의견은 간단히 1~2가지만.`;

    // Gemini는 반드시 user 턴으로 시작해야 함
    // bot 인사말 등 앞쪽 bot 메시지는 제거하고 user 턴부터 시작
    const filtered = (history || []).filter(m => m.role === 'user' || m.role === 'bot');
    const firstUserIdx = filtered.findIndex(m => m.role === 'user');
    const validHistory = firstUserIdx >= 0 ? filtered.slice(firstUserIdx) : [];

    const contents = [];

    if (validHistory.length > 0) {
      validHistory.forEach((m, idx) => {
        if (m.role === 'user') {
          // 첫 번째 user 메시지에만 시스템 프롬프트 붙이기
          const text = idx === 0 ? `${systemPrompt}\n\n사용자: ${m.text}` : m.text;
          contents.push({ role: 'user', parts: [{ text }] });
        } else {
          contents.push({ role: 'model', parts: [{ text: m.text }] });
        }
      });
      contents.push({ role: 'user', parts: [{ text: message }] });
    } else {
      contents.push({ role: 'user', parts: [{ text: `${systemPrompt}\n\n사용자: ${message}` }] });
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents })
    });

    const data = await
