// api/analyze.js
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function preprocessProductName(name) {
  if (!name || typeof name !== "string") return name;
  let n = name.trim();
  n = n.replace(/[\d,]+\s*원/g, "").trim();
  n = n.replace(/\d+(\.\d+)?\s*(ml|mL|ML|l|L|g|G|kg|KG|oz|OZ|매|개입|정|캡슐|포)\b/g, "").trim();
  n = n.replace(/(할인|행사|증정|무료배송|이벤트|특가|세일|SALE|NEW|신상|\d+%\s*off|\d+%\s*할인|한정|품절임박)/gi, "").trim();
  n = n.replace(/[(\[【][^\)）\]】]*[\)）\]】]/g, "").trim();
  n = n.replace(/\s{2,}/g, " ").trim();
  n = n.split(" ").filter(w => w.length > 1).join(" ").trim();
  return n || name;
}

function deduplicateItems(items) {
  const seen = new Map();
  for (const item of items) {
    const key = `${item.category}__${item.name.toLowerCase().replace(/\s/g, "")}`;
    if (seen.has(key)) {
      seen.get(key).qty += item.qty;
    } else {
      seen.set(key, { ...item });
    }
  }
  return Array.from(seen.values());
}

function safeParseItems(raw) {
  if (!raw || typeof raw !== "string") return [];

  let text = raw.trim();
  text = text.replace(/```json[\s\S]*?```/gi, m =>
    m.replace(/```json/i, "").replace(/```/g, "")
  ).trim();
  text = text.replace(/```/g, "").trim();

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") {
      const key = Object.keys(parsed).find(k => Array.isArray(parsed[k]));
      if (key) return parsed[key];
    }
    return [];
  } catch (_) {}

  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start !== -1 && end !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch (_) {}
  }

  if (start !== -1) {
    const results = [];
    const objRegex = /\{[^{}]+\}/g;
    let match;
    while ((match = objRegex.exec(text.slice(start))) !== null) {
      try {
        const obj = JSON.parse(match[0]);
        if (obj && obj.name) results.push(obj);
      } catch (_) {}
    }
    if (results.length > 0) {
      console.log(`[복구] 잘린 JSON에서 ${results.length}개 객체 복구 성공`);
      return results;
    }
  }

  console.error("JSON 파싱 최종 실패. 원본:", raw.slice(0, 200));
  return [];
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const { filePath, mimeType } = req.body || {};
  if (!filePath) return res.status(400).json({ error: "filePath 누락" });

  try {
    const { data: signedData, error: signedErr } = await supa
      .storage.from("user_uploads").createSignedUrl(filePath, 60);

    if (signedErr || !signedData?.signedUrl) {
      console.error("Signed URL 오류:", signedErr);
      return res.status(500).json({ error: "이미지 URL 생성 오류" });
    }

    const imgResp = await fetch(signedData.signedUrl);
    if (!imgResp.ok) throw new Error(`이미지 fetch 실패: ${imgResp.status}`);
    const b64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");

    const geminiPrompt = `당신은 전문 재고 분류 AI입니다. 사진 속 물건을 아래 규칙에 따라 정확하게 분류하세요.

━━━ 절대 금지 ━━━
[금지1] 사진에 없는 물건 추가 금지. 반드시 보이는 것만 적으세요.
[금지2] 브랜드명/상품명을 추측하거나 변형하지 마세요.
        ❌ 잘못된 예: "마스크린장갑" "가정비칫솔" (공백 제거, 글자 오류)
        ✅ 올바른 예: "맘스크린 장갑" "가성비 칫솔" (공백 유지, 정확한 글자)
[금지3] 단어 사이 공백을 절대 제거하지 마세요. 원문 그대로 읽으세요.
[금지4] 빈 배열 [] 금지. 물건이 보이면 반드시 1개 이상 출력.
[금지5] JSON 외 설명문, 마크다운, 코드블럭 출력 금지.

━━━ 상품 인식 규칙 ━━━
[규칙1] 제품에 브랜드/상품명 글자가 보이면 그대로 읽어 적으세요.
        예) "FEBREZE" → "페브리즈 섬유탈취제"
        예) "맘스크린" → "맘스크린 장갑"
        예) "일리윤" → "일리윤 세라마이드 로션"
[규칙2] 글자가 안 보이면 색상+형태+용도로 적으세요.
        예) "빨간 원통형 캔", "흰색 펌프형 세제통"
[규칙3] 수량은 실제 보이는 개수만. 추측 금지.
[규칙4] 가격/용량(ml,g)/광고문구는 상품명에 포함하지 마세요.

━━━ 의류 인식 규칙 ━━━
의류는 종류별로 나눠 각각 별도 항목으로 출력하세요.
아래 종류 기준으로 분류하고, qty는 해당 종류의 개수를 세세요.

분류 기준:
코트 / 패딩 / 자켓·점퍼 / 가디건 / 스웨터·니트 / 후드티 / 맨투맨 /
티셔츠·반팔 / 셔츠·남방 / 블라우스 / 바지·슬랙스 / 청바지 / 치마 /
원피스 / 운동복·트레이닝 / 양말 / 브라·속옷상의 / 팬티·트렁크 /
스타킹·레깅스 / 넥타이 / 스카프·머플러 / 모자 / 벨트

예시) 자켓 3벌 + 코트 2벌 + 청바지 4벌 보임:
{"category":"의류","name":"자켓·점퍼","qty":3},
{"category":"의류","name":"코트","qty":2},
{"category":"의류","name":"청바지","qty":4}

━━━ 카테고리 분류 ━━━
"의류"  - 옷, 속옷, 양말, 넥타이, 모자, 가방 포함
"위생"  - 물티슈, 화장지, 생리대, 면봉, 마스크
"청소"  - 세제, 락스, 섬유유연제, 청소포, 탈취제, 행주
"케어"  - 화장품, 로션, 선크림, 샴푸, 헤어제품, 바디워시, 치약
"생활"  - 캐리어, 선풍기, 수납함, 건전지, 공구, 기타 생활용품
"기타"  - 위 5가지 외 모든 물건

━━━ 출력 형식 (반드시 준수) ━━━
[
  {"category":"카테고리","name":"상품명","qty":숫자},
  {"category":"카테고리","name":"상품명","qty":숫자}
]`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [
            { inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } },
            { text: geminiPrompt }
          ]}],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192
          }
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API 오류 ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = await response.json();

    let botText = "";
    if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
      botText = data.candidates[0].content.parts[0].text;
    } else if (data.candidates?.[0]?.finishReason === "MAX_TOKENS") {
      console.warn("[경고] MAX_TOKENS 도달 — 부분 파싱 시도");
      botText = data.candidates[0]?.content?.parts?.[0]?.text || "[]";
    } else if (Array.isArray(data)) {
      botText = JSON.stringify(data);
    } else {
      botText = "[]";
    }

    console.log("Gemini 원본 응답 (앞 500자):", botText.slice(0, 500));

    const rawItems = safeParseItems(botText);
    console.log("파싱된 아이템 수:", rawItems.length);

    const items = deduplicateItems(
      rawItems
        .filter(it => it && it.name && String(it.name).length > 1)
        .map(it => ({
          category: it.category || "기타",
          name: preprocessProductName(String(it.name)),
          qty: Math.max(1, Number(it.qty) || 1)
        }))
        .filter(it => it.name && it.name.length > 1)
    );

    console.log("최종 아이템 수:", items.length);
    return res.status(200).json({ items });

  } catch (err) {
    console.error("분석 오류:", err.message);
    return res.status(500).json({ error: "분석 오류", details: err.message });
  }
}
