import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// GEMINI_MODEL을 환경변수로 관리 (하드코딩 제거)
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

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

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    reasoning: {
      type: "STRING",
      description: "화면을 5개 구역으로 나누어 각 구역에 있는 물건을 짧게 나열"
    },
    items: {
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
    }
  },
  required: ["reasoning", "items"]
};

const BASE_GEN_CONFIG = {
  temperature: 0,        // 정확도 최우선 (변경 금지)
  maxOutputTokens: 8192,
  responseMimeType: "application/json",
  responseSchema: RESPONSE_SCHEMA
};

async function callGeminiImage(b64, mimeType, prompt) {
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
        generationConfig: BASE_GEN_CONFIG
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

async function callGeminiVideoFrames(frames, prompt) {
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
        generationConfig: BASE_GEN_CONFIG
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

async function callGeminiVideo(videoBuffer, mimeType, prompt) {
  const apiKey = process.env.GEMINI_API_KEY;

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
  const fileName = uploadData.file?.name;
  const fileUri = uploadData.file?.uri;
  if (!fileName || !fileUri) throw new Error("File API 응답에서 파일 정보 없음");
  console.log("영상 업로드 완료:", fileName);

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
        generationConfig: BASE_GEN_CONFIG
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

// ─────────────────────────────────────────────────────────────────────
// 개선된 AI 프롬프트
// 핵심 변경: ① 위치 묘사 우선, ② 브랜드 먼저 읽기, ③ 구별 불가 항목 묶음 처리
// ─────────────────────────────────────────────────────────────────────
function buildScanPrompt(isVideo, userCorrections) {
  const corrHint = userCorrections?.length > 0
    ? `\n참고 교정 이력 (유사한 물건명 인식 시 활용): ${userCorrections.map(c => `"${c.original}"→"${c.corrected}"`).join(", ")}`
    : "";

  const mediaHint = isVideo
    ? "영상 전체 프레임에 걸쳐"
    : "사진 전체를 좌상→우상→좌하→우하→중앙 순으로 빠짐없이";

  return `${mediaHint} 눈에 보이는 모든 물건을 찾아 JSON으로 출력하세요.${corrHint}

[물건 이름 작성 3대 규칙]

★ 규칙 A — 위치+소재로 구별 (반드시 같은 종류가 2개 이상일 때만)
  같은 종류가 1개뿐이면 위치 태그 붙이지 말 것. 키보드가 1개면 그냥 "로지텍 무선 키보드".
  같은 종류가 2개 이상일 때만 위치·소재로 구별하세요.
  위치 표현: 왼쪽 앞 / 오른쪽 뒤 / 가운데 / 위쪽 / 아래쪽
  소재·특징 힌트: 두꺼운 / 얇은 / 니트 / 면 / 후리스 / 줄무늬 / 체크 / 민소매
  예시 (옷이 여러 벌): "왼쪽 앞 두꺼운 청바지", "오른쪽 뒤 흰 니트 티"
  예시 (1개뿐): "로지텍 무선 키보드" (위치 태그 없음)

★ 규칙 B — 브랜드 이름을 가장 먼저 (로고·라벨이 보이면 무조건)
  영어 브랜드: NIKE, Adidas, New Balance, Uniqlo, ZARA (최대 10자 그대로)
  한글 브랜드: 베베앙리, 일리윤, RYO, NOW, 아성다이소 (그대로)
  전체 이름은 20자 이내 유지.
  예시: "NIKE 기능성 반팔", "New Balance 두꺼운 패딩", "RYO 트리트먼트", "베베앙리 물티슈"

★ 규칙 C — 구별 불가한 물건은 묶음으로 처리 (억지 구분 금지)
  흐리거나 접혀 있거나 비슷한 물건이 뭉쳐 있어 개별 구분이 불가능한 경우
  → qty에 개수 반영하고 하나의 항목으로 묶으세요.
  예시: qty:3 name:"비슷한 검정 옷 묶음", qty:2 name:"얇은 흰 티 묶음", qty:5 name:"양말 묶음"

[추가 규칙]
4. 제품 겉면 라벨이 보이면 반드시 용도를 명시하세요. (예: 살균 스프레이, 유리 세정제, 손 세정제)
5. 전자기기 로고가 보이면 브랜드 포함. (예: 로지텍 무선 키보드, HP 노트북)
6. 서류·책자 → "서류"로 통일. 수납 도구 → "수납 바구니", "연필꽂이" 등 쉬운 우리말.
7. reasoning: 화면을 5구역으로 나누어 각 구역 물건을 짧게 나열 (검색 키워드 수준으로 간결하게)
8. 카테고리: 의류 / 위생 / 청소 / 케어 / 생활 / 전자 / 주방 / 공구 / 기타
9. 수납장 문·선반·벽·바닥·옷걸이 자체는 제외
10. 물티슈 캡(뚜껑)·그림자를 스마트폰·리모컨 등으로 착각하지 마세요. 불분명하면 형태 그대로 묘사.
11. [개인정보 보호 — 절대 필수] 아래 목록 중 하나라도 사진·영상에 보이면 items를 반드시 빈 배열([])로 반환하고 reasoning 첫 줄 첫 단어로 "PRIVATE_INFO_DETECTED" 기재할 것.
    차단 대상 문서·정보:
    ▸ 신원 증명: 주민등록증, 운전면허증, 여권, 외국인등록증, 학생증
    ▸ 주소·가족 증명: 주민등록등본/초본, 가족관계증명서, 기본증명서, 출생증명서
    ▸ 금융: 통장(계좌번호 노출), 신용카드/체크카드(카드번호), 인터넷뱅킹 화면, 금융 거래내역서
    ▸ 의료: 처방전, 진단서, 입퇴원 확인서, 의무기록, 검사 결과지
    ▸ 계약: 각종 계약서(부동산·고용·서비스·금융 등), 전세계약서, 근로계약서, 개인정보 동의서
    ▸ 법적 문서: 판결문, 고소장, 소장, 영장, 공증 문서
    ▸ 세금·공공: 납세증명서, 소득증명서, 건강보험료 납부확인서, 급여명세서, 원천징수영수증
    ▸ 기타 민감 정보: 타인이 식별 가능한 사진(얼굴 클로즈업 등), 비밀번호·PIN이 적힌 메모
    → 위 항목이 '일부라도' 화면에 보이면 즉시 차단. 부분 가림이 있어도 차단.`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  // JWT 토큰으로 서버에서 직접 사용자 검증 (클라이언트 userEmail 신뢰 안 함)
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return res.status(401).json({ error: "인증 토큰 없음" });

  const { data: { user }, error: authErr } = await supa.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: "유효하지 않은 토큰" });

  const userEmail = user.email;

  const { filePath, mimeType, userCorrections, videoFrames } = req.body || {};
  if (!filePath) return res.status(400).json({ error: "filePath 누락" });

  const isVideo = mimeType?.startsWith("video/");
  const useFrames = isVideo && Array.isArray(videoFrames) && videoFrames.length > 0;
  console.log(`분석 시작: ${isVideo ? (useFrames ? `영상프레임(${videoFrames.length}장)` : "영상(FileAPI)") : "이미지"} / ${mimeType} / ${userEmail}`);

  try {
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
      return res.status(402).json({
        error: "이용권이 모두 소진되었습니다.",
        credits: 0,
        message: "마이페이지에서 이용권을 충전해주세요."
      });
    }

    console.log(`크레딧 확인: ${serialRow.ai_credits}건 남음`);

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
      scanText = await callGeminiVideoFrames(videoFrames, prompt);
    } else if (isVideo) {
      console.log(`영상 크기: ${(fileBuffer.length / 1024 / 1024).toFixed(1)}MB`);
      scanText = await callGeminiVideo(fileBuffer, mimeType, prompt);
    } else {
      const b64 = fileBuffer.toString("base64");
      scanText = await callGeminiImage(b64, mimeType || "image/jpeg", prompt);
    }

    console.log("Gemini 전체 응답:", scanText.slice(0, 800));

    if (!scanText || scanText.trim().length < 10) {
      return res.status(200).json({ items: [], reviewItems: [], lowItems: [] });
    }

    // ── 개인정보 감지 체크 ────────────────────────────────────────────
    let parsedFull = null;
    try {
      const cleaned = scanText.trim().replace(/`json\s*/gi, "").replace(/`\s*/gi, "").trim();
      parsedFull = JSON.parse(cleaned);
    } catch (_) {}
    const reasoning = parsedFull?.reasoning || "";
    if (reasoning.includes("PRIVATE_INFO_DETECTED")) {
      console.log("개인정보 감지 → 크레딧 차감 안 함, 빈 목록 반환");
      return res.status(200).json({
        items: [],
        reviewItems: [],
        privateInfoDetected: true,
        message: "개인정보가 포함된 사진으로 AI 분석에서 제외되었습니다.",
        creditsRemaining: serialRow.ai_credits
      });
    }
    // ─────────────────────────────────────────────────────────────────

    const rawItems = safeParseItems(scanText);
    console.log("파싱된 물건 수:", rawItems.length);

    const BAD_KEYWORDS = ["불명 물체", "경첩", "선반 지지", "캐비닛 문", "캐비닛 선반", "서랍틀", "금속 경첩", "원형 범퍼", "걸이 레일"];
    const isBadItem = (name) => BAD_KEYWORDS.some(k => name.includes(k));
    const COLOR_RE = /^(흰색?|화이트|검정|검은|블랙|회색?|그레이|아이보리|베이지|갈색|브라운|노란?|파란?|블루|빨간?|레드|초록|녹색|그린|핑크|분홍|보라|퍼플|은색|실버|금색|골드|투명)\s+/u;
    const NO_COLOR_CATS = new Set(["생활", "청소", "위생", "케어", "기타"]);

    const items = deduplicateItems(
      rawItems
        .filter(it => it?.name && String(it.name).trim().length > 1)
        .filter(it => !isBadItem(String(it.name).trim()))
        .map(it => {
          const category = normCat(it.category);
          let name = String(it.name).trim().slice(0, 20);
          if (NO_COLOR_CATS.has(category) && !/^[A-Za-z가-힣]+$/.test(name.split(" ")[0])) {
            name = name.replace(COLOR_RE, "");
          }
          return { category, name, qty: Math.max(1, Number(it.qty) || 1) };
        })
    );

    if (items.length === 0) {
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
      console.error("크레딧 차감 오류:", deductErr.message);
    } else {
      console.log(`크레딧 차감 완료: ${serialRow.ai_credits} → ${serialRow.ai_credits - 1}`);
    }

    console.log(`최종 도출된 물건 개수: ${items.length}개`);
    return res.status(200).json({
      items,
      reviewItems: [],
      lowItems: [],
      creditsRemaining: serialRow.ai_credits - 1
    });

  } catch (err) {
    console.error("분석 오류:", err.message);
    return res.status(500).json({ error: "분석 오류", details: err.message });
  }
}
