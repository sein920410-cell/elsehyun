// api/analyze.js
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function safeParseItems(raw) {
  if (!raw || typeof raw !== "string") return [];

  let text = raw.trim();
  text = text.replace(/```json[\s\S]*?```/gi, (m) =>
    m.replace(/```json/i, "").replace(/```/g, "")
  ).trim();
  text = text.replace(/```/g, "").trim();

  // 1차: 전체 정상 파싱
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") {
      const key = Object.keys(parsed).find((k) => Array.isArray(parsed[k]));
      if (key) return parsed[key];
    }
    return [];
  } catch (_) {}

  // 2차: [ ] 사이 슬라이스 파싱
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start !== -1 && end !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch (_) {}
  }

  // 3차: JSON이 중간에 잘린 경우 → 완성된 객체만 추출
  if (start !== -1) {
    const results = [];
    const fragment = text.slice(start);
    const objRegex = /\{[^{}]+\}/g;
    let match;
    while ((match = objRegex.exec(fragment)) !== null) {
      try {
        const obj = JSON.parse(match[0]);
        if (obj && obj.name) results.push(obj);
      } catch (_) {}
    }
    if (results.length > 0) {
      console.log(`[복구] 잘린 JSON에서 ${results.length}개 객체 복구`);
      return results;
    }
  }

  console.error("JSON 파싱 최종 실패. 원본:", raw);
  return [];
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const { filePath, mimeType } = req.body || {};

  if (!filePath) {
    return res.status(400).json({ error: "filePath 누락" });
  }

  try {
    // 1. Supabase Signed URL 생성
    const { data: signedData, error: signedErr } = await supa
      .storage
      .from("user_uploads")
      .createSignedUrl(filePath, 60);

    if (signedErr || !signedData?.signedUrl) {
      console.error("Signed URL 오류:", signedErr);
      return res.status(500).json({ error: "이미지 URL 생성 오류" });
    }

    // 2. 이미지 base64 변환
    const imgResp = await fetch(signedData.signedUrl);
    const arrayBuf = await imgResp.arrayBuffer();
    const b64 = Buffer.from(arrayBuf).toString("base64");

    // 3. 프롬프트
    const geminiPrompt = `당신은 전문 재고 분류 AI입니다. 사진 속 물건을 아래 규칙대로 100% 정확하게 분류하세요.

━━━ 절대 금지 규칙 ━━━
[금지1] 사진에 없는 물건을 절대 추가하지 마세요. 반드시 보이는 것만 적으세요.
[금지2] 브랜드명을 추측하거나 지어내지 마세요. 글자가 명확히 보일 때만 적으세요.
[금지3] 빈 배열 [] 절대 금지. 물건이 보이면 반드시 1개 이상 출력하세요.
[금지4] JSON 외 설명문, 마크다운, 코드블럭 출력 금지.

━━━ 상품 인식 규칙 ━━━
[규칙1] 제품에 브랜드·상품명 글자가 보이면 반드시 그대로 읽어서 적으세요.
        예) "FEBREZE" 보임 → name: "페브리즈 섬유탈취제"
        예) "PIGEON" 보임 → name: "피죤 섬유유연제"
        예) "일리윤" 보임 → name: "일리윤 세라마이드 로션"
[규칙2] 브랜드 글자가 전혀 안 보이면 색상+형태+용도로 적으세요.
        예) 빨간 원통형 캔, 흰색 펌프형 세제통, 투명 스프레이통
[규칙3] 수량은 실제 보이는 개수만 숫자로 적으세요. 추측 금지.

━━━ 의류 인식 규칙 ━━━
의류는 종류별로 나눠서 각각 별도 항목으로 출력하세요.
아래 종류 기준으로 분류하고, qty는 해당 종류의 개수를 세세요.

의류 종류 목록:
코트 / 패딩 / 자켓·점퍼 / 가디건 / 스웨터·니트 / 후드티 / 맨투맨 /
티셔츠·반팔 / 셔츠·남방 / 블라우스 / 바지·슬랙스 / 청바지 / 치마 /
원피스 / 운동복·트레이닝 / 양말 / 브라·속옷상의 / 팬티·트렁크 /
스타킹·레깅스 / 넥타이 / 스카프·머플러

예시) 옷걸이에 자켓 3벌, 코트 2벌, 티셔츠 5벌이 보이면:
{"category": "의류", "name": "자켓·점퍼", "qty": 3},
{"category": "의류", "name": "코트", "qty": 2},
{"category": "의류", "name": "티셔츠·반팔", "qty": 5}

━━━ 카테고리 분류 기준 ━━━
"의류"  - 옷, 속옷, 양말, 넥타이, 스카프 등 모든 의류·패션 아이템
"위생"  - 물티슈, 화장지, 생리대, 면봉, 마스크
"청소"  - 세제, 락스, 섬유유연제, 청소포, 탈취제, 행주
"케어"  - 화장품, 로션, 선크림, 샴푸, 헤어제품, 바디워시, 치약
"생활"  - 가방, 캐리어, 선풍기, 수납함, 건전지, 공구, 가전, 기타 생활용품
"기타"  - 위 5가지에 해당하지 않는 물건

━━━ 출력 형식 (반드시 준수) ━━━
[
  {"category": "카테고리", "name": "물건이름", "qty": 숫자},
  {"category": "카테고리", "name": "물건이름", "qty": 숫자}
]`;

    // 4. Gemini 호출
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
            temperature: 0.1,
            maxOutputTokens: 8192
          }
        })
      }
    );

    const data = await response.json();

    // 5. 응답 텍스트 추출
    let botText = "";
    if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
      botText = data.candidates[0].content.parts[0].text;
    } else if (Array.isArray(data)) {
      botText = JSON.stringify(data);
    } else if (typeof data === "object") {
      botText = JSON.stringify(data);
    } else {
      botText = "[]";
    }

    console.log("Gemini 원본 응답:", botText);

    const rawItems = safeParseItems(botText);
    console.log("파싱된 아이템:", rawItems);

    // 6. 데이터 정리
    const items = rawItems
      .filter((it) => it && it.name)
      .map((it) => ({
        category: it.category || "기타",
        name: it.name,
        qty: Number(it.qty) || 1
      }));

    return res.status(200).json({ items });

  } catch (err) {
    console.error("분석 오류:", err);
    return res.status(500).json({ error: "분석 오류", details: err.message });
  }
}
