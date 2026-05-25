import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// 분석(비전) 전용 모델 — 채팅/검색용 GEMINI_MODEL과 분리하여 비용 격리
const GEMINI_MODEL = process.env.GEMINI_VISION_MODEL || process.env.GEMINI_MODEL || "gemini-3-flash-preview";
// 비전 해상도: medium(작은 물건 인식 + 비용 절감 균형). 환경변수로 조절 가능
const MEDIA_RESOLUTION = process.env.GEMINI_MEDIA_RESOLUTION || "media_resolution_medium";
// thinking 레벨: low(목록화는 복잡한 추론 불필요 → 토큰·비용 절감, 출력 공간 확보)
const THINKING_LEVEL = process.env.GEMINI_THINKING_LEVEL || "low";

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
  maxOutputTokens: 6144, // thinking을 low로 줄였으므로 출력 공간 충분히 확보
  thinkingConfig: { thinkingLevel: THINKING_LEVEL },  // 핵심: thinking이 출력 토큰을 잠식하지 않게 제어
  mediaResolution: MEDIA_RESOLUTION.toUpperCase(),    // 비전 해상도 (전역)
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

  return `당신은 정리수납 전문가입니다. ${mediaHint} 보이는 물건을 "하나도 빠짐없이" 찾아 JSON으로 출력하세요.${corrHint}

[가장 중요한 원칙]
★ 최대한 많이, 개별로 잡으세요. 작은 물건·뒤쪽 물건·일부만 보이는 물건도 모두 포함합니다.
★ 흔한 실수: 큰 물건·앞쪽 물건 몇 개만 잡고 끝내는 것. 화면에 10개가 있으면 10개를 다 찾아야 합니다.
★ 수납장이 여러 칸(선반)으로 나뉘어 있으면 맨 위 칸부터 맨 아래 칸까지 칸마다 따로 훑으세요. 특히 어둡거나 깊숙한 아래 칸을 빠뜨리지 마세요. (예: 소화기, 우산, 밀대걸레, 청소도구 등 바닥 쪽 물건)
★ 억지로 묶지 마세요. 서로 다른 물건은 각각 별도 항목으로 출력합니다.

[물건 이름 작성 규칙]

규칙 1 — 브랜드/로고/글자가 보이면 그대로 이름에 포함
  로고나 라벨의 글자가 식별되면 그 이름을 살립니다. (예: "HP 노트북", "로지텍 무선 키보드", "RYO 트리트먼트")
  전체 이름은 20자 이내로 간결하게. 긴 설명 불필요.

규칙 2 — 브랜드가 안 보이면 색·형태·용도로 짧게
  (예: "주황색 커팅 매트", "탁상용 미니 선풍기", "원형 탁상 거울", "연필꽂이")
  라벨에 용도가 보이면 명시. (예: 살균 스프레이, 유리 세정제, 손 세정제)

규칙 3 — 같은 종류가 여러 개일 때만 위치/특징으로 구별
  같은 물건이 1개면 위치 태그 없이 그냥 이름. (키보드 1개 → "로지텍 무선 키보드")
  같은 종류가 2개 이상일 때만 구별: "왼쪽 두꺼운 청바지", "오른쪽 흰 니트"

규칙 4 — 옷·천류는 개수 파악
  옷이 겹쳐 있으면 보이는 만큼 개수(qty)에 반영. 명확히 다른 옷은 따로 항목으로.

[정확도 안전장치]
- 확실하지 않으면 형태 그대로 묘사하되, 물건 자체는 빠뜨리지 말 것.
- 없는 물건을 지어내지 말 것. (휴지통을 휴지로 적는 식의 오인 금지)
- 물티슈 캡·그림자를 스마트폰·리모컨으로 착각하지 말 것.
- 수납장 문·선반·벽·바닥·옷걸이 자체는 제외.

[카테고리] 의류 / 위생 / 청소 / 케어 / 생활 / 전자 / 주방 / 공구 / 기타

[reasoning] 화면을 칸(선반)별로 또는 좌·우·중앙·앞·뒤로 나누어, 각 구역에서 찾은 물건을 짧게 나열하세요. 특히 맨 아래 칸·구석을 점검해 빠진 물건이 없는지 스스로 확인하세요. (간결하게)

[개인정보 보호 — 절대 필수] 아래 목록 중 하나라도 사진·영상에 보이면 items를 반드시 빈 배열([])로 반환하고 reasoning 첫 줄 첫 단어로 "PRIVATE_INFO_DETECTED" 기재할 것.
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

    // 조건부 차감: 읽은 시점의 크레딧 값과 동일할 때만 차감 (동시 요청 이중차감 방지)
    const { data: deducted, error: deductErr } = await supa
      .from("serials")
      .update({ ai_credits: serialRow.ai_credits - 1 })
      .eq("used_by", userEmail)
      .eq("ai_credits", serialRow.ai_credits)
      .select("ai_credits");

    if (deductErr) {
      console.error("크레딧 차감 오류:", deductErr.message);
    } else if (!deducted || deducted.length === 0) {
      // 그 사이 다른 요청이 먼저 차감함 → 안전하게 거절
      console.warn("동시 요청 감지: 차감 실패(이미 변경됨)");
      return res.status(409).json({ error: "이용권 처리가 겹쳤습니다. 다시 시도해 주세요." });
    } else {
      console.log(`크레딧 차감 완료: ${serialRow.ai_credits} → ${deducted[0].ai_credits}`);
    }

    const creditsRemaining = deducted?.[0]?.ai_credits ?? (serialRow.ai_credits - 1);
    console.log(`최종 도출된 물건 개수: ${items.length}개`);
    return res.status(200).json({
      items,
      reviewItems: [],
      lowItems: [],
      creditsRemaining
    });

  } catch (err) {
    console.error("분석 오류:", err.message);
    return res.status(500).json({ error: "분석 오류", details: err.message });
  }
}
