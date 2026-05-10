import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3-flash-preview";

const VALID_CATS = ["의류", "위생", "청소", "케어", "생활", "전자", "주방", "공구", "기타"];
function normCat(c) {
  if (!c) return "기타";
  return VALID_CATS.includes(String(c).trim()) ? String(c).trim() : "기타";
}

// 결과물에서 목록만 정확하게 뽑아내는 함수 (이중 안전장치)
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

// 핵심 기술: AI가 결과부터 뱉지 않고, 'reasoning'에서 먼저 꼼꼼하게 상황을 파악하도록 강제합니다.
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    reasoning: { 
      type: "STRING",
      description: "화면을 구역별로 나누어 숨어있는 작은 물건들까지 샅샅이 눈으로 훑듯이 묘사한 내용"
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

// 환각 방지 및 꼼꼼함을 강제하는 최종 프롬프트입니다.
function buildScanPrompt(isVideo, userCorrections) {
  const corrHint = userCorrections?.length > 0
    ? `\n사용자 교정: ${userCorrections.map(c => `"${c.original}"→"${c.corrected}"`).join(", ")}`
    : "";

  const mediaHint = isVideo
    ? "영상 전체를 처음부터 끝까지 보고"
    : "사진 전체를 위에서 아래까지 빠짐없이 보고";

  return `${mediaHint} 눈에 보이는 모든 물건을 찾아 JSON 형식으로 출력하세요.${corrHint}

[최종 규칙]
1. 당신은 완벽한 재물조사(Inventory) 담당자입니다. 사진에 있는 '모든' 물건을 빠짐없이 찾아내야 합니다.
2. 절대 노트북이나 모니터 같은 눈에 띄는 큰 물건 1~2개만 찾고 탐색을 종료하지 마세요.
3. 반드시 'reasoning' 필드에 화면을 5개 구역(왼쪽, 오른쪽, 중앙, 앞쪽, 뒤쪽)으로 나누어 무엇이 있는지 먼저 눈으로 훑듯이 아주 상세하게 묘사하세요. (예: "왼쪽 바구니 안에는 민트색 상자가 있고, 그 옆에는 둥근 통이 있다. 책상 오른쪽 연필꽂이에는 빨간 펜과 핸드크림이 꽂혀있다...")
4. 묘사가 끝나면, 묘사했던 모든 물건들을 'items' 배열에 빠짐없이 각각 독립된 항목으로 등록하세요.
5. 작은 상자, 펜, 화장품, 스마트 기기 등 자잘한 물건들도 전부 개별 물건으로 인식해야 합니다.
6. 없는 물건을 지어내지 마세요. 눈에 확실히 보이는 것만 정확하게 적으세요.
7. 카테고리: 의류 / 위생 / 청소 / 케어 / 생활 / 전자 / 주방 / 공구 / 기타
8. 수납장 문/선반/벽/바닥은 제외`;
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

    console.log("Gemini 전체 응답:", scanText.slice(0, 800));

    if (!scanText || scanText.trim().length < 10) {
      return res.status(200).json({ items: [], reviewItems: [], lowItems: [] });
    }

    const rawItems = safeParseItems(scanText);
    console.log("파싱된 물건 수:", rawItems.length);

    // 정답을 날려버리지 않도록 최소한의 금지어만 유지합니다.
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

    // 물건을 아예 찾지 못했을 때는 크레딧(돈)을 차감하지 않고 보호합니다.
    if (items.length === 0) {
      console.log("인식된 물건 없음 → 크레딧 차감 안 함");
      return res.status(200).json({
        items: [],
        reviewItems: [],
        lowItems: [],
        creditsRemaining: serialRow.ai_credits
      });
    }

    // 정상적으로 물건을 찾아냈을 때만 크레딧을 1회 차감합니다.
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
