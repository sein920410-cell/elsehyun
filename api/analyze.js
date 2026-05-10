import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

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

// 융통성을 주어 다양하게 찾도록 하되(0.4), 무리한 환각은 막습니다.
const BASE_GEN_CONFIG = {
  temperature: 0.4, 
  maxOutputTokens: 2000,
  response_mime_type: "application/json",
  response_schema: RESPONSE_SCHEMA
};

async function callGeminiImage(b64, mimeType, prompt, temperature = 0.4) {
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

async function callGeminiVideoFrames(frames, prompt, temperature = 0.4) {
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

async function callGeminiVideo(videoBuffer, mimeType, prompt, temperature = 0.4) {
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

// 구역 탐색을 강제하여 꼼꼼히 찾게 하되, 환각(없는 물건 지어내기)은 절대 못 하도록 막은 프롬프트
function buildScanPrompt(isVideo, userCorrections) {
  const corrHint = userCorrections?.length > 0
    ? `\n사용자 교정: ${userCorrections.map(c => `"${c.original}"→"${c.corrected}"`).join(", ")}`
    : "";

  const mediaHint = isVideo
    ? "영상 전체를 처음부터 끝까지 보고"
    : "사진 전체를 위에서 아래까지 빠짐없이 보고";

  return `${mediaHint} 눈에 보이는 물건을 꼼꼼하게 찾아서 모두 JSON 배열로 출력하세요.${corrHint}

규칙:
- [중요] 가장 크고 눈에 띄는 메인 물건(예: 노트북, 모니터 등) 딱 하나만 찾고 탐색을 멈추는 것을 절대 금지합니다.
- 화면을 왼쪽, 가운데, 오른쪽, 앞쪽, 뒤쪽으로 구역을 나누어 샅샅이 살펴보고, 작은 물건(펜, 화장품, 스마트 기기, 바구니 안의 상자 등)도 빠짐없이 각각 독립된 항목으로 찾으세요.
- [중요] 구석구석 최대한 많이 찾아내되, 절대 사진에 없는 물건을 상상해서 지어내지 마세요. (환각 현상 방지)
- 직접 눈에 보이는 것만 포함. 보이지 않는 물건 추측 금지.
- 카테고리: 의류 / 위생 / 청소 / 케어 / 생활 / 전자 / 주방 / 공구 / 기타
- 라벨이 보이면 제품명 그대로, 없으면 특징을 살려서 정확히 적어주세요 (예: 민트색 상자, 스마트워치, 하얀색 바구니, 다용도 꽂이함)
- 수납장 문/선반/벽/바닥은 제외`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const { filePath, mimeType, userCorrections, userEmail, videoFrames } = req.body || {};
  if (!filePath) return res.status(400).json({ error: "filePath 누락" });
  if (!userEmail) return res.status(400).json({ error: "userEmail 누락" });

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

    console.log("Gemini 결과:", scanText.slice(0, 800));

    // 결과가 비정상적으로 짧거나 없으면 크레딧을 아낍니다.
    if (!scanText || scanText.trim().length < 10) {
      return res.status(200).json({ items: [], reviewItems: [], lowItems: [] });
    }

    const rawItems = safeParseItems(scanText);
    console.log("파싱 수:", rawItems.length);

    // 꼭 필요한 금지어만 남겨서 정답이 지워지는 현상 방지
    const BAD_KEYWORDS = ["불명 물체", "경첩", "선반 지지", "캐비닛 문", "캐비닛 선반", "서랍틀", "금속 경첩", "원형 범퍼", "걸이 레일"];
    
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

    // 물건을 아예 못 찾았을 때는 크레딧을 차감하지 않고 반환하여 돈 낭비를 막습니다.
    if (items.length === 0) {
      console.log("인식된 물건 없음 → 크레딧 차감 안 함");
      return res.status(200).json({
        items: [],
        reviewItems: [],
        lowItems: [],
        creditsRemaining: serialRow.ai_credits
      });
    }

    // 정상적으로 물건을 1개 이상 찾았을 때만 크레딧 차감
    const { error: deductErr } = await supa
      .from("serials")
      .update({ ai_credits: serialRow.ai_credits - 1 })
      .eq("used_by", userEmail);

    if (deductErr) {
      console.error("크레딧 차감 오류:", deductErr.message);
    } else {
      console.log(`크레딧 차감 완료: ${serialRow.ai_credits} → ${serialRow.ai_credits - 1}`);
    }

    console.log(`최종: ${items.length}개`);
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
