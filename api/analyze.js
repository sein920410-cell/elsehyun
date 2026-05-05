import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ── 모델 버전 한 곳에서 관리 ──────────────────────────────────────────────────
const GEMINI_MODEL = "gemini-2.0-flash"; // lite → flash로 업그레이드

const VALID_CATS = ["의류", "위생", "청소", "케어", "생활", "기타"];
function normCat(c) {
  if (!c) return "기타";
  return VALID_CATS.includes(String(c).trim()) ? String(c).trim() : "기타";
}

function safeParseItems(raw) {
  if (!raw || typeof raw !== "string") return [];
  let text = raw.trim().replace(/`json\s*/gi, "").replace(/`\s*/gi, "").trim();
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") {
      const key = Object.keys(parsed).find(k => Array.isArray(parsed[k]));
      if (key) return parsed[key];
    }
  } catch (_) {}
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start !== -1 && end > start) {
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
      try { const obj = JSON.parse(match[0]); if (obj?.name) results.push(obj); } catch (_) {}
    }
    if (results.length > 0) return results;
  }
  console.error("JSON 파싱 실패:", raw.slice(0, 300));
  return [];
}

function deduplicateItems(items) {
  const seen = new Map();
  for (const item of items) {
    const key = `${item.category}__${item.name.toLowerCase().replace(/\s/g, "")}`;
    if (seen.has(key)) seen.get(key).qty += item.qty;
    else seen.set(key, { ...item });
  }
  return Array.from(seen.values());
}

// ── 이미지 분석: base64 inline_data 방식 ──────────────────────────────────────
async function callGeminiImage(b64, mimeType, prompt, temperature = 0.05) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: mimeType, data: b64 } },
            { text: prompt }
          ]
        }],
        generationConfig: { temperature, maxOutputTokens: 6000 }
      })
    }
  );
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API ${response.status}: ${err.slice(0, 200)}`);
  }
  const data = await response.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.filter(p => p.text && !p.thought).map(p => p.text).join("") || "";
}

// ── 영상 분석: Gemini File API 3단계 방식 ─────────────────────────────────────
// 영상은 크기 제한 때문에 base64로 바로 못 보내고,
// 1단계: File API에 업로드
// 2단계: 처리 완료(ACTIVE)까지 폴링
// 3단계: file_uri 참조로 분석 요청
async function callGeminiVideo(videoBuffer, mimeType, prompt, temperature = 0.05) {
  const apiKey = process.env.GEMINI_API_KEY;

  // 1단계: multipart 업로드 (메타데이터 + 바이너리 한 요청)
  const boundary = "---GeminiUploadBoundary";
  const metaPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ file: { display_name: "video_upload", mimeType } })}\r\n`;
  const dataPart = `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const endPart = `\r\n--${boundary}--`;

  const body = Buffer.concat([
    Buffer.from(metaPart),
    Buffer.from(dataPart),
    videoBuffer,
    Buffer.from(endPart)
  ]);

  const uploadResp = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=multipart&key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": `multipart/related; boundary=${boundary}`,
        "Content-Length": body.length
      },
      body
    }
  );

  if (!uploadResp.ok) {
    const err = await uploadResp.text();
    throw new Error(`File API 업로드 실패 ${uploadResp.status}: ${err.slice(0, 200)}`);
  }

  const uploadData = await uploadResp.json();
  const fileName = uploadData.file?.name; // e.g. "files/abc123"
  const fileUri = uploadData.file?.uri;
  if (!fileName || !fileUri) throw new Error("File API 응답에서 파일 정보 없음");
  console.log("영상 업로드 완료:", fileName);

  // 2단계: ACTIVE 될 때까지 폴링 (최대 60초)
  const maxWait = 60;
  for (let i = 0; i < maxWait; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const stateResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${apiKey}`
    );
    const stateData = await stateResp.json();
    const state = stateData.file?.state;
    console.log(`폴링 ${i + 1}s: state=${state}`);
    if (state === "ACTIVE") break;
    if (state === "FAILED") throw new Error("Gemini File API 영상 처리 실패");
    if (i === maxWait - 1) throw new Error("영상 처리 시간 초과 (60초)");
  }

  // 3단계: file_uri 참조로 분석 요청
  const analyzeResp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { file_data: { mime_type: mimeType, file_uri: fileUri } },
            { text: prompt }
          ]
        }],
        generationConfig: { temperature, maxOutputTokens: 6000 }
      })
    }
  );

  if (!analyzeResp.ok) {
    const err = await analyzeResp.text();
    throw new Error(`Gemini 분석 요청 실패 ${analyzeResp.status}: ${err.slice(0, 200)}`);
  }

  const analyzeData = await analyzeResp.json();
  const parts = analyzeData.candidates?.[0]?.content?.parts || [];
  return parts.filter(p => p.text && !p.thought).map(p => p.text).join("") || "";
}

// ── 프롬프트 빌더 ─────────────────────────────────────────────────────────────
// isVideo=true면 "영상 전체를 스캔하여" 지시를 앞에 추가해서
// Gemini가 특정 프레임만 보지 않고 전체 타임라인을 통합하도록 유도
function buildScanPrompt(isVideo, userCorrections) {
  const corrHint = userCorrections?.length > 0
    ? `\n[사용자 교정]\n${userCorrections.map(c => `"${c.original}"→"${c.corrected}"`).join(", ")}\n`
    : "";

  const mediaInstruction = isVideo
    ? `영상 전체를 처음부터 끝까지 스캔하여 모든 프레임에 걸쳐 보이는 물건을 하나의 목록으로 통합하세요.${corrHint}`
    : `사진 속 수납공간에 보관된 물건 목록을 JSON으로 출력하세요.${corrHint}`;

  return `${mediaInstruction}

━━ 출력 형식 (JSON 배열만, 다른 텍스트 없이) ━━
[{"category":"카테고리","name":"물건이름","qty":개수},...]

━━ 카테고리 ━━
"의류" → 옷, 신발, 가방, 모자, 양말, 속옷, 벨트
"위생" → 샴푸, 린스, 바디워시, 물티슈, 치약, 칫솔, 비누, 여성청결제, 면도용품
"청소" → 세탁세제, 섬유유연제, 청소세제, 밀대, 대걸레, 빗자루, 수세미, 청소솔, 스프레이
"케어" → 영양제, 의약품, 로션, 크림, 세럼, 마스크팩, 연고
"생활" → 우산, 소화기, 배터리, 충전기, 가위, 테이프, 노트, 볼펜, 수납함, 바구니
"기타" → 위에 해당 없음

━━ 이름 짓는 법 ━━
라벨에 쓰인 제품명을 최대한 그대로 읽어라. 절대 축약하지 마라.

  ✅ "가성비UP 칫솔" / "맘스크린장갑" / "굴곡면봉" / "바티스트 드라이샴푸"
  ❌ 라벨 있는데 "칫솔", "면봉", "장갑"처럼 한 단어로 축약 금지

라벨 없으면 기능/용도로 (형태 묘사 금지)
  ✅ "밀대", "우산", "소화기"   ❌ "긴 손잡이 도구", "플라스틱 용기"

브랜드명 한국어 변환: RYO→려 / ILLIYOON→일리윤 / Bébéen→베베앙 / Febreze→페브리즈
마케팅 문구 제거: "온 가족", "Premium", "NEW" 등 — 이것만 제거, 나머지는 그대로

하나의 물건은 하나로 (부품 쪼개기 금지) / 묶음은 qty로 표현

━━ 공간 추론 절대 금지 ━━
눈에 직접 보이는 것만 목록에 넣는다. 공간 유형 보고 "있을 법한 물건" 상상 추가 절대 금지.

━━ 절대 목록에 넣지 말 것 ━━
수납장 부품(문/선반/경첩/손잡이/레일/범퍼/서랍틀) / 배경(벽/바닥/천장)
신분증, 여권, 현금, 통장, 카드류

━━ 이름 다듬기 ━━
의류/신발/가방에만 색상 표기. 그 외 색상 표현 금지.
달력: "N월 달력" (연도 표기 금지)`;
}

// ── 메인 핸들러 ────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const { filePath, mimeType, userCorrections } = req.body || {};
  if (!filePath) return res.status(400).json({ error: "filePath 누락" });

  const isVideo = mimeType?.startsWith("video/");
  console.log(`분석 시작: ${isVideo ? "영상" : "이미지"} / ${mimeType}`);

  try {
    // Supabase Storage에서 파일 다운로드 (영상은 처리 시간 여유 있게 2분)
    const { data: signedData, error: signedErr } = await supa
      .storage.from("user_uploads").createSignedUrl(filePath, 120);
    if (signedErr || !signedData?.signedUrl)
      return res.status(500).json({ error: "파일 URL 생성 오류" });

    const fileResp = await fetch(signedData.signedUrl);
    if (!fileResp.ok) throw new Error(`파일 fetch 실패: ${fileResp.status}`);
    const fileBuffer = Buffer.from(await fileResp.arrayBuffer());

    const prompt = buildScanPrompt(isVideo, userCorrections);
    let scanText;

    if (isVideo) {
      console.log(`영상 크기: ${(fileBuffer.length / 1024 / 1024).toFixed(1)}MB`);
      scanText = await callGeminiVideo(fileBuffer, mimeType, prompt);
    } else {
      const b64 = fileBuffer.toString("base64");
      scanText = await callGeminiImage(b64, mimeType || "image/jpeg", prompt);
    }

    console.log("Gemini 결과:", scanText.slice(0, 800));

    if (!scanText || scanText.trim().length < 10) {
      return res.status(200).json({ items: [], reviewItems: [], lowItems: [] });
    }

    const rawItems = safeParseItems(scanText);
    console.log("파싱 수:", rawItems.length);

    const BAD_KEYWORDS = ["손잡이 도구","직사각형 도구","직사각형 물체","플라스틱 용기","검정 물건","긴 막대","직사각형 포장","작은 상자","큰 상자","원형 물체","불명 물체","경첩","선반 지지","캐비닛 문","캐비닛 선반","서랍틀","금속 경첩","원형 범퍼","플라스틱 범퍼","걸이 레일","TV 리모컨","리모컨","에어컨 리모컨","선풍기 리모컨"];
    const isBadItem = (name) => BAD_KEYWORDS.some(k => name.includes(k));
    const COLOR_RE = /^(흰색?|화이트|검정|검은|블랙|회색?|그레이|아이보리|베이지|갈색|브라운|노란?|파란?|블루|빨간?|레드|초록|녹색|그린|핑크|분홍|보라|퍼플|은색|실버|금색|골드|투명)\s+/u;
    const NO_COLOR_CATS = new Set(["생활","청소","위생","케어","기타"]);

    const items = deduplicateItems(
      rawItems
        .filter(it => it?.name && String(it.name).trim().length > 1)
        .filter(it => !isBadItem(String(it.name).trim()))
        .map(it => {
          const category = normCat(it.category);
          let name = String(it.name).trim().slice(0, 20);
          if (NO_COLOR_CATS.has(category)) name = name.replace(COLOR_RE, "");
          return { category, name, qty: Math.max(1, Number(it.qty) || 1) };
        })
    );

    console.log(`최종: ${items.length}개`);
    return res.status(200).json({ items, reviewItems: [], lowItems: [] });

  } catch (err) {
    console.error("분석 오류:", err.message);
    return res.status(500).json({ error: "분석 오류", details: err.message });
  }
}
