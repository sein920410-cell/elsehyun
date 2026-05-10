import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ── 모델 버전 한 곳에서 관리 ──────────────────────────────────────────────────
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3-flash-preview";

const VALID_CATS = ["의류", "위생", "청소", "케어", "생활", "전자", "주방", "공구", "기타"];
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
// response_schema: 모델이 반드시 이 JSON 구조만 출력하도록 강제
const RESPONSE_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      category: { type: "STRING" },
      name: { type: "STRING" },
      qty: { type: "INTEGER" }
    },
    required: ["category", "name", "qty"]
  }
};

const BASE_GEN_CONFIG = {
  temperature: 0,
  maxOutputTokens: 1000,
  response_mime_type: "application/json",
  response_schema: RESPONSE_SCHEMA
};

async function callGeminiImage(b64, mimeType, prompt, temperature = 0) {
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
        generationConfig: { ...BASE_GEN_CONFIG, temperature }
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

// 영상 프레임 배열(base64 JPEG)을 이미지 여러 장으로 전송 → File API 불필요
async function callGeminiVideoFrames(frames, prompt, temperature = 0) {
  const imageParts = frames.map(b64 => ({
    inline_data: { mime_type: "image/jpeg", data: b64 }
  }));
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            ...imageParts,
            { text: prompt }
          ]
        }],
        generationConfig: { ...BASE_GEN_CONFIG, temperature }
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
async function callGeminiVideo(videoBuffer, mimeType, prompt, temperature = 0) {
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
        generationConfig: { ...BASE_GEN_CONFIG, temperature }
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
    : `사진 전체를 위에서 아래까지, 모든 선반·칸·구역을 빠짐없이 스캔하여 화면에 보이는 모든 물건의 목록을 JSON으로 출력하세요.
특정 선반 한 곳에만 집중하지 말고 위 칸·중간 칸·아래 칸 전체의 물건을 모두 포함하라.${corrHint}`;

  return `${mediaInstruction}

━━ [최우선 원칙] 보이는 것은 반드시 포함, 안 보이는 것은 절대 추가 금지 ━━
명확히 눈으로 보이는 물건은 빠짐없이 기록한다. 잘 보이는 물건을 누락하는 것도 오류다.
단, 어둡거나 가려지거나 흐릿해서 종류·이름을 확정할 수 없는 물건은 제외한다.
"이 공간에 있을 것 같다"는 추론으로 물건을 추가하는 것은 절대 금지다.

━━ 출력 형식 (JSON 배열만, 다른 텍스트 없이) ━━
[{"category":"카테고리","name":"물건이름","qty":개수},...]

━━ 카테고리 ━━
"의류" → 옷, 신발, 가방, 모자, 양말, 속옷, 벨트
"위생" → 샴푸, 린스, 바디워시, 물티슈, 치약, 칫솔, 비누, 여성청결제, 면도용품
"청소" → 세탁세제, 섬유유연제, 청소세제, 밀대, 대걸레, 빗자루, 수세미, 청소솔, 스프레이
"케어" → 영양제, 의약품, 로션, 크림, 세럼, 마스크팩, 연고
"생활" → 우산, 소화기, 배터리, 충전기, 가위, 테이프, 노트, 볼펜, 수납함, 바구니
"전자" → 노트북, 모니터, 키보드, 마우스, 스피커, 이어폰, 헤드폰, 충전기, 태블릿, 카메라, TV, 리모컨
"주방" → 냄비, 프라이팬, 식기, 컵, 칼, 도마, 주방 도구류
"공구" → 드라이버, 망치, 렌치, 줄자, 공구류
"기타" → 위에 해당 없음

━━ 이름 짓는 법 ━━
라벨에 쓰인 제품명을 최대한 그대로 읽어라. 절대 축약하지 마라.

  ✅ "가성비UP 칫솔" / "맘스크린장갑" / "굴곡면봉" / "바티스트 드라이샴푸"
  ❌ 라벨 있는데 "칫솔", "면봉", "장갑"처럼 한 단어로 축약 금지

라벨 없으면 기능/용도로 (형태 묘사 금지)
  ✅ "밀대", "우산", "소화기"   ❌ "긴 손잡이 도구", "플라스틱 용기"

브랜드명 한국어 변환: RYO→려 / ILLIYOON→일리윤 / Bébéen→베베앙 / Febreze→페브리즈
브랜드 로고/상표명(NOW, RYO, LANEIGE 등)은 영문 그대로 유지하되, 그 뒤에 오는 영문 제품 설명은 한글로 변환:
  ROOT:GEN FOR WOMEN→루트젠 포 우먼 / Double Strength→더블스트렝스 / Moisture Barrier→모이스처 배리어 / For Women→포 우먼 / Magic Bright→매직브라이트
  ✅ "NOW 더블스트렝스"  ✅ "려 루트젠 포 우먼"  ❌ "NOW Double Strength"  ❌ "ROOT:GEN FOR WOMEN"
마케팅 문구 제거: "온 가족", "Premium", "NEW" 등 — 이것만 제거, 나머지는 그대로

하나의 물건은 하나로 (부품 쪼개기 금지) / 묶음은 qty로 표현

━━ 공간 추론 절대 금지 ━━
눈에 직접 보이는 것만 목록에 넣는다. 공간 유형 보고 "있을 법한 물건" 상상 추가 절대 금지.
흐릿하거나 가려져서 정확히 식별할 수 없는 물건은 목록에서 제외하라. 추측으로 이름 붙이지 마라.

━━ 절대 목록에 넣지 말 것 ━━
수납장 부품(문/선반/경첩/손잡이/레일/범퍼/서랍틀) / 배경(벽/바닥/천장)
신분증, 여권, 현금, 통장, 카드류

━━ 의류 인식 특별 규칙 (가장 중요) ━━
의류는 반드시 아래 조건을 모두 만족할 때만 기록한다:
  조건 1. 옷의 앞면 또는 라벨이 명확히 보여서 종류를 특정할 수 있어야 한다.
  조건 2. 색상이 사진에서 명확하게 확인되어야 한다 (어두워서 색이 불분명하면 제외).
  조건 3. 다른 옷에 완전히 가려진 경우 제외. 일부만 보이더라도 종류·색이 확실할 때만 포함.
  ❌ 걸려있는 옷들이 겹쳐서 뭉쳐 보이거나, 어두워서 색상 확인이 안 되는 경우 → 전부 제외
  ❌ 색상이 "아마 파란색 같다", "어두워서 검정인 것 같다" 수준이면 제외
색상 + 구체적인 종류를 반드시 함께 표기. "자켓", "셔츠", "바지"처럼 상위 개념만 쓰지 말 것.
  ✅ "검은색 가죽자켓" / "베이지색 항공점퍼" / "흰색 반팔 티셔츠" / "청바지" / "회색 후드집업"
  ❌ "파란색 자켓" / "흰색 셔츠" / "검은색 바지" (종류가 너무 넓음)
종류 예시: 반팔 티셔츠 / 긴팔 티셔츠 / 맨투맨 / 후드티 / 후드집업 / 셔츠 / 니트 / 가디건 / 청바지 / 슬랙스 / 반바지 / 레깅스 / 원피스 / 패딩 / 롱패딩 / 코트 / 항공점퍼 / 가죽자켓 / 청자켓 / 트렌치코트 / 수영복 / 속옷류
달력: "N월 달력" (연도 표기 금지)`;
}

// ── 메인 핸들러 ────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  // userEmail 추가: 프론트에서 현재 로그인 유저 이메일을 함께 보내야 함
  const { filePath, mimeType, userCorrections, userEmail, videoFrames } = req.body || {};
  if (!filePath) return res.status(400).json({ error: "filePath 누락" });
  if (!userEmail) return res.status(400).json({ error: "userEmail 누락" });

  // videoFrames가 있으면 영상을 File API로 전송하지 않고 프레임 이미지 배열로 처리
  const isVideo = mimeType?.startsWith("video/");
  const useFrames = isVideo && Array.isArray(videoFrames) && videoFrames.length > 0;
  console.log(`분석 시작: ${isVideo ? (useFrames ? `영상프레임(${videoFrames.length}장)` : "영상(FileAPI)") : "이미지"} / ${mimeType} / ${userEmail}`);

  try {
    // ── 이용권 확인 (분석 시작 전에 크레딧 조회) ──────────────────────────────
    // serials 테이블에서 해당 유저의 ai_credits를 조회
    // 0이면 Gemini API를 호출하지 않고 바로 에러 반환 → 불필요한 비용 차단
    // .maybeSingle() 대신 .limit(1) 사용
    // serials 테이블에는 세트당 MAIN/DR1/DR2 세 row가 있어서
    // .maybeSingle()은 "결과가 여러 개" 에러를 냄 → 배열로 받아 첫 번째만 사용
    const { data: rows, error: creditErr } = await supa
      .from("serials")
      .select("ai_credits")
      .eq("used_by", userEmail)
      .limit(1);
    const serialRow = rows?.[0];

    if (creditErr) {
      console.error("크레딧 조회 오류:", creditErr.message);
      return res.status(500).json({ error: "이용권 확인 오류" });
    }
    if (!serialRow) {
      return res.status(403).json({ error: "등록된 시리얼이 없습니다." });
    }
    if (serialRow.ai_credits <= 0) {
      // 크레딧이 0이면 충전 안내와 함께 차단
      return res.status(402).json({
        error: "이용권이 모두 소진되었습니다.",
        credits: 0,
        message: "마이페이지에서 이용권을 충전해주세요."
      });
    }

    console.log(`크레딧 확인: ${serialRow.ai_credits}건 남음`);

    // ── 파일 다운로드 및 분석 ─────────────────────────────────────────────────
    const { data: signedData, error: signedErr } = await supa
      .storage.from("user_uploads").createSignedUrl(filePath, 120);
    if (signedErr || !signedData?.signedUrl)
      return res.status(500).json({ error: "파일 URL 생성 오류" });

    const fileResp = await fetch(signedData.signedUrl);
    if (!fileResp.ok) throw new Error(`파일 fetch 실패: ${fileResp.status}`);
    const fileBuffer = Buffer.from(await fileResp.arrayBuffer());

    const prompt = buildScanPrompt(isVideo, userCorrections);
    let scanText;

    if (useFrames) {
      // 프레임 배열로 분석 (File API 우회 → 빠르고 저렴)
      scanText = await callGeminiVideoFrames(videoFrames, prompt);
    } else if (isVideo) {
      // 프레임 미전달 시 기존 File API 방식 폴백
      console.log(`영상 크기: ${(fileBuffer.length / 1024 / 1024).toFixed(1)}MB`);
      scanText = await callGeminiVideo(fileBuffer, mimeType, prompt);
    } else {
      const b64 = fileBuffer.toString("base64");
      scanText = await callGeminiImage(b64, mimeType || "image/jpeg", prompt);
    }

    console.log("Gemini 결과:", scanText.slice(0, 800));

    if (!scanText || scanText.trim().length < 10) {
      // 분석 결과가 없으면 크레딧 차감 안 함 (빈 결과는 모델 문제이지 사용자 소비가 아님)
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

    // ── 이용권 차감 (물건이 1개 이상 인식됐을 때만 차감) ─────────────────────
    if (items.length === 0) {
      // 물건을 하나도 못 찾은 경우 → 크레딧 차감 없이 빈 결과 반환
      console.log("인식된 물건 없음 → 크레딧 차감 안 함");
      return res.status(200).json({
        items: [],
        reviewItems: [],
        lowItems: [],
        creditsRemaining: serialRow.ai_credits
      });
    }

    const { error: deductErr } = await supa
      .from("serials")
      .update({ ai_credits: serialRow.ai_credits - 1 })
      .eq("used_by", userEmail);

    if (deductErr) {
      // 차감 실패는 로그만 남기고 결과는 정상 반환
      // (유저 경험 우선 — 분석은 됐는데 차감 오류로 에러 내면 혼란)
      console.error("크레딧 차감 오류:", deductErr.message);
    } else {
      console.log(`크레딧 차감 완료: ${serialRow.ai_credits} → ${serialRow.ai_credits - 1}`);
    }

    console.log(`최종: ${items.length}개`);
    // 응답에 남은 크레딧도 함께 전달 → 프론트에서 실시간으로 잔여 건수 표시 가능
    return res.status(200).json({
      items,
      reviewItems: [],
      l
