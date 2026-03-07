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

  // 1차: 전체 JSON 파싱 시도
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    // { items: [...] } 또는 { data: [...] } 형태 대응
    if (parsed && typeof parsed === "object") {
      const key = Object.keys(parsed).find((k) => Array.isArray(parsed[k]));
      if (key) return parsed[key];
    }
    return [];
  } catch (_) {}

  // 2차: 배열 부분만 잘라서 파싱
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];

  try {
    const sliced = text.slice(start, end + 1);
    const parsed = JSON.parse(sliced);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error("JSON 파싱 최종 실패:", e, "\n원본:", raw);
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

    const geminiPrompt = `당신은 창고·서랍 재고 목록을 만드는 전문 분류 AI입니다.
사진 속 모든 물건을 하나도 빠짐없이 찾아내고, 아래 규칙을 100% 준수하여 JSON 배열만 출력하세요.

━━━ 필수 규칙 ━━━
[규칙1] 브랜드명이 보이면 반드시 앞에 붙이세요. (예: 페브리즈 섬유탈취제, 일리윤 세라마이드 로션)
[규칙2] 브랜드가 안 보이면 형태+용도로 작성하세요. (예: 파란 물티슈, 흰 스프레이통)
[규칙3] 수량은 실제 보이는 개수를 숫자로만 기입하세요. (묶음 1봉 = qty:1)
[규칙4] category는 반드시 아래 5가지 중 하나만 사용하세요:
  - "위생" : 물티슈, 화장지, 생리대, 면봉, 마스크
  - "청소" : 세제, 락스, 섬유유연제, 청소포, 탈취제, 행주
  - "케어" : 화장품, 로션, 선크림, 샴푸, 헤어, 바디워시, 치약
  - "생활" : 건전지, 라이터, 테이프, 비닐봉지, 지퍼백, 기타 생활잡화
  - "기타" : 위 4가지에 해당하지 않는 모든 물건
[규칙5] name은 브랜드+제품종류 위주로 2~4단어로 간결하게. 광고문구·성분명 제외.
[규칙6] 사진에 물건이 1개라도 있으면 반드시 1개 이상 출력하세요. 빈 배열 [] 금지.
[규칙7] 오직 JSON 배열만 출력. 설명문·마크다운·코드블럭 일체 금지.

━━━ 출력 형식 ━━━
[
  {"category": "위생", "name": "베베앙 물티슈", "qty": 2},
  {"category": "케어", "name": "일리윤 세라마이드 로션", "qty": 1},
  {"category": "청소", "name": "페브리즈 섬유탈취제", "qty": 1}
]`;

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
            maxOutputTokens: 2048
            // response_mime_type 제거 → Gemini 오동작 원인이었음
          }
        })
      }
    );

    const data = await response.json();

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
