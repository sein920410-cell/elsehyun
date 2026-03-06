// api/analyze.js
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch"; 

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// 순수 JSON 배열 부분만 뽑아서 파싱하는 헬퍼
function safeParseItems(raw) {
  if (!raw || typeof raw !== "string") return [];

  // ```json ... ``` 같은 코드블럭 제거
  let text = raw.trim();
  text = text.replace(/```json/gi, "").replace(/```/g, "").trim();

  // 첫 '['와 마지막 ']' 사이만 잘라오기
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];

  const jsonSlice = text.slice(start, end + 1);

  try {
    const parsed = JSON.parse(jsonSlice);
    // 배열만 허용
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error("JSON 파싱 에러:", e, "원본:", raw);
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const { filePath, mimeType } = req.body || {};

  if (!filePath) {
    return res.status(400).json({ error: "filePath 누락" });
  }

  try {
    // 1. 이미지 가져오기
    const { data: signedData, error: signedErr } = await supa
      .storage
      .from("user_uploads")
      .createSignedUrl(filePath, 60);

    if (signedErr || !signedData?.signedUrl) {
      console.error("Signed URL 오류:", signedErr);
      return res.status(500).json({ error: "이미지 URL 생성 오류" });
    }

    const imgResp = await fetch(signedData.signedUrl);
    const arrayBuf = await imgResp.arrayBuffer();
    const b64 = Buffer.from(arrayBuf).toString("base64");

    // 2. 프롬프트 (그대로 유지)
    const geminiPrompt = `사진 속 모든 물건을 아주 정확하고 꼼꼼하게 하나도 빠짐없이 찾아내세요.
상단 선반의 작은 병들, 구석에 있는 물건들까지 전부 목록으로 만듭니다.

✅ 반드시 지킬 규칙:
1. 브랜드가 보이면 상품명 앞에 꼭 붙이세요 (예: 일리윤, 베베앙, 페브리즈 등).
2. 수량은 보이는 대로 숫자로만 추출하세요. (예: 물티슈 2개면 qty는 2)
3. 카테고리는 [위생, 청소, 케어, 생활, 기타] 중 하나로 분류하세요.
4. 형식은 반드시 아래 JSON 배열 형식을 지키세요.
5. 상품명은 사진에 실제로 보이는 글자를 그대로 읽어 작성하세요. 추측하거나 일반화하지 마세요.
6. 설명, 문장, 부가 텍스트 없이 결과 JSON만 출력하세요.
7. 상품명은 브랜드 + 제품 종류 중심으로 간결하게 작성하세요.
8. 광고 문구, 기능 설명, 성분명, 슬로건은 상품명에 포함하지 마세요.
9. 상품명은 최대 2~4단어로 작성하세요.

응답 예시:
[
  {"category": "위생", "name": "베베앙 물티슈", "qty": 2},
  {"category": "케어", "name": "일리윤 여성청결제", "qty": 1},
  {"category": "케어", "name": "닥터지 선크림", "qty": 1}
]

설명은 절대 하지 말고 오직 JSON 데이터만 출력하세요.`;

    // 3. Gemini 호출
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } },
                { text: geminiPrompt }
              ]
            }
          ],
          generationConfig: {
            response_mime_type: "application/json",
            temperature: 0.1,
            maxOutputTokens: 2048
          }
        })
      }
    );

    const data = await response.json();

    // Gemini 응답이 이미 JSON 객체일 수도 있음
    let botText = "";

    if (Array.isArray(data)) {
      // 이미 배열인 경우
      botText = JSON.stringify(data);
    } else if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
      botText = data.candidates[0].content.parts[0].text;
    } else if (typeof data === "object") {
      // 혹시 모델이 바로 JSON 배열을 content로 준 경우 대비
      botText = JSON.stringify(data);
    } else {
      botText = "[]";
    }

    const rawItems = safeParseItems(botText);

    // 4. 데이터 정리 및 전송 (기존 로직 유지)
    const items = rawItems.map((it) => ({
      category: it.category || "기타",
      name: it.qty > 1 ? `${it.name}x${it.qty}` : it.name,
      qty: it.qty || 1
    }));

    return res.status(200).json({ items });
  } catch (err) {
    console.error("분석 오류:", err);
    return res.status(500).json({ error: "분석 오류", details: err.message });
  }
}
