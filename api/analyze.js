import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ── 브랜드 사전 ──
const BRAND_MAP = {
  "bebeen": "베베앙", "bébéen": "베베앙", "bebien": "베베앙",
  "febreze": "페브리즈", "feb reze": "페브리즈",
  "pigeon": "피죤", "downy": "다우니", "tide": "타이드",
  "ryo": "려", "ryoe": "려",
  "illiyoon": "일리윤", "ilyoon": "일리윤",
  "dr.g": "닥터지", "drg": "닥터지", "dr g": "닥터지",
  "now foods": "나우푸드", "now": "나우",
  "pantene": "팬틴", "head&shoulders": "헤드앤숄더", "head & shoulders": "헤드앤숄더",
  "dove": "도브", "lux": "럭스", "lifebuoy": "라이프보이",
  "dettol": "데톨", "lysol": "라이솔",
  "scotch brite": "스카치브라이트", "scotchbrite": "스카치브라이트",
  "aveeno": "아비노", "cetaphil": "세타필", "eucerin": "유세린",
  "neutrogena": "뉴트로지나", "vaseline": "바세린",
  "nivea": "니베아", "garnier": "가르니에",
  "anessa": "아네사", "sunplay": "선플레이",
  "huggies": "하기스", "pampers": "팸퍼스", "mama bear": "마마베어",
  "kleenex": "클리넥스",
  "ziploc": "지퍼락",
  "energizer": "에너자이저", "duracell": "듀라셀",
  "3m": "쓰리엠",
  "hp": "HP", "samsung": "삼성", "lg": "LG", "apple": "애플",
  "sony": "소니", "panasonic": "파나소닉", "philips": "필립스",
  "dyson": "다이슨", "xiaomi": "샤오미", "anker": "앙커",
  "tefal": "테팔", "lock&lock": "락앤락", "lock & lock": "락앤락",
};

const PRODUCT_TYPE_MAP = {
  "wipes": "물티슈", "wet wipes": "물티슈", "baby wipes": "아기물티슈",
  "shampoo": "샴푸", "conditioner": "컨디셔너", "treatment": "트리트먼트",
  "body wash": "바디워시", "shower gel": "샤워젤",
  "lotion": "로션", "cream": "크림", "serum": "세럼", "essence": "에센스",
  "sunscreen": "선크림", "sun cream": "선크림",
  "toner": "토너",
  "detergent": "세제", "laundry detergent": "세탁세제", "fabric softener": "섬유유연제",
  "cleaner": "클리너", "spray": "스프레이", "disinfectant": "소독제",
  "toothpaste": "치약", "toothbrush": "칫솔", "mouthwash": "구강청결제",
  "tissue": "화장지", "toilet paper": "화장지", "paper towel": "키친타올",
  "hair loss": "탈모", "scalp care": "두피케어",
  "deodorant": "데오드란트", "air freshener": "방향제",
  "dishwashing": "주방세제", "dish soap": "주방세제",
  "laptop": "노트북", "notebook": "노트북",
  "monitor": "모니터", "keyboard": "키보드", "mouse": "마우스",
  "speaker": "스피커", "headphone": "헤드폰", "earphone": "이어폰",
  "charger": "충전기", "adapter": "어댑터",
  "vacuum": "청소기", "air purifier": "공기청정기",
  "humidifier": "가습기",
};

function preprocessProductName(name) {
  if (!name || typeof name !== "string") return name;
  let n = name.trim();
  n = n.replace(/[\d,]+\s*원/g, "");
  n = n.replace(/\d+(\.\d+)?\s*(ml|mL|l|L|g|G|kg|KG|oz|OZ|mg|MG|매|개입|정|캡슐|포|팩|장|겹)\b/gi, "");
  n = n.replace(/(할인|행사|증정|무료배송|이벤트|특가|세일|SALE|NEW|한정|베스트|추천|인기)/gi, "");
  n = n.replace(/[(\[【][^\)）\]】]*[\)）\]】]/g, "");
  n = n.replace(/[_\-–—·•|]{2,}/g, " ");
  n = n.replace(/\s{2,}/g, " ").trim();

  let lower = n.toLowerCase();
  for (const [eng, kor] of Object.entries(BRAND_MAP)) {
    if (lower.startsWith(eng + " ") || lower === eng) {
      n = kor + n.slice(eng.length);
      lower = n.toLowerCase();
      break;
    }
  }

  lower = n.toLowerCase();
  for (const [eng, kor] of Object.entries(PRODUCT_TYPE_MAP)) {
    const regex = new RegExp(`\\b${eng}\\b`, "gi");
    n = n.replace(regex, kor);
  }

  n = n.split(" ").filter(w => w.length > 1 && !/^\d+$/.test(w)).join(" ").trim();

  if (n.length > 20) {
    const words = n.split(" ");
    let result = words[0];
    for (let i = 1; i < words.length; i++) {
      if ((result + " " + words[i]).length <= 20) result += " " + words[i];
      else break;
    }
    n = result;
  }

  return n.trim() || name.trim();
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
  let text = raw.trim()
    .replace(/```json[\s\S]*?```/gi, m => m.replace(/```json/i, "").replace(/```/g, ""))
    .replace(/```/g, "").trim();

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
      try {
        const obj = JSON.parse(match[0]);
        if (obj?.name) results.push(obj);
      } catch (_) {}
    }
    if (results.length > 0) return results;
  }

  console.error("JSON 파싱 실패:", raw.slice(0, 300));
  return [];
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const { filePath, mimeType, userCorrections } = req.body || {};
  if (!filePath) return res.status(400).json({ error: "filePath 누락" });

  try {
    const { data: signedData, error: signedErr } = await supa
      .storage.from("user_uploads").createSignedUrl(filePath, 60);
    if (signedErr || !signedData?.signedUrl)
      return res.status(500).json({ error: "이미지 URL 생성 오류" });

    const imgResp = await fetch(signedData.signedUrl);
    if (!imgResp.ok) throw new Error(`이미지 fetch 실패: ${imgResp.status}`);
    const b64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");

    const correctionHint = userCorrections?.length > 0
      ? `\n━━━ 사용자 교정 데이터 (최우선 적용) ━━━\n${userCorrections.map(c => `- "${c.original}" → "${c.corrected}"`).join("\n")}\n`
      : "";

    const geminiPrompt = `당신은 재고 분류 AI입니다. 사진 속 물건을 분석하여 목록을 생성하세요.
${correctionHint}

━━━ 핵심 원칙: 보이는 것만 기록 ━━━
절대로 추측하거나 없는 물건을 만들어 내지 마세요.
사진에서 명확하게 보이지 않는 물건은 목록에 넣지 마세요.

━━━ confidence(확신도) 기준 ━━━
각 물품을 인식할 때 아래 기준으로 confidence를 0~100 사이 숫자로 설정하세요:

[90~100] 브랜드 텍스트가 명확히 읽히고 제품 유형도 확실한 경우
         예) 페브리즈 로고 + 스프레이 형태 → confidence:95
         
[70~89]  브랜드 OR 제품 유형 중 하나는 확실한 경우
         예) 브랜드는 읽히지만 제품 유형이 약간 불확실 → confidence:75

[40~69]  물건이 보이지만 브랜드도 모르고 제품 유형도 비슷한 것이 여럿인 경우
         이 경우 candidates 배열에 가능한 이름 2~3개를 함께 제공하세요.
         name에는 가장 가능성 높은 것을 쓰세요.
         예) 스프레이 형태이나 브랜드 불명 → confidence:55, candidates:["탈취 스프레이","방향제","청소 스프레이"]

[0~39]   형태만 보이고 정확히 무엇인지 모르는 경우
         name에 일반 유형만 쓰고 브랜드는 쓰지 마세요.
         예) 용기인데 내용물 불명 → confidence:25, name:"스프레이류"

━━━ 브랜드 인식 규칙 (OCR 우선) ━━━
패키지에 브랜드 텍스트가 보이면 반드시 OCR로 읽어 한글로 변환하세요:
HP→HP, Samsung/삼성→삼성, LG→LG, Febreze→페브리즈
RYO/려→려, Illiyoon→일리윤, Bebeen/베베앙→베베앙
Dove→도브, Pantene→팬틴, Dettol→데톨

━━━ 상품명 작성 규칙 ━━━
✅ 올바른 예: "HP 노트북", "삼성 모니터", "페브리즈 섬유탈취제", "려 탈모 샴푸"
❌ 잘못된 예: "노트북"(브랜드 생략), "청소 스프레이"(추측), "벽걸이 가방"(없는 물건)

규칙1: 브랜드가 보이면 반드시 한글 브랜드 + 제품 유형 형태
규칙2: 브랜드가 없으면 제품 유형만 (추측 금지)
규칙3: 2~5단어, 20자 이내
규칙4: 같은 제품 여러 개면 qty로 표현

━━━ 카테고리 ━━━
"의류" "위생" "청소" "케어" "생활" "기타"

━━━ 출력 형식 ━━━
confidence 70 이상:
{"category":"카테고리","name":"브랜드 제품명","qty":숫자,"confidence":숫자}

confidence 40~69:
{"category":"카테고리","name":"가장 가능한 이름","qty":숫자,"confidence":숫자,"candidates":["후보1","후보2","후보3"]}

confidence 40 미만:
{"category":"카테고리","name":"일반 유형명","qty":숫자,"confidence":숫자}

전체를 JSON 배열로만 출력. 설명문 없음.`;

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
          generationConfig: { temperature: 0.05, maxOutputTokens: 8192 }
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = await response.json();
    let botText = data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
    console.log("Gemini 응답 앞 500자:", botText.slice(0, 500));

    const rawItems = safeParseItems(botText);
    console.log("파싱 아이템 수:", rawItems.length);

    // confidence에 따라 세 그룹으로 분류
    const autoItems = [];   // confidence >= 80 → 자동 등록
    const reviewItems = []; // confidence 40~79 → 사용자 확인
    const lowItems = [];    // confidence < 40 → 일반 유형으로만

    for (const it of rawItems) {
      if (!it?.name || String(it.name).length <= 1) continue;

      const conf = Number(it.confidence) || 50;
      const base = {
        category: it.category || "기타",
        name: preprocessProductName(String(it.name)),
        qty: Math.max(1, Number(it.qty) || 1),
        confidence: conf,
      };

      if (base.name.length <= 1) continue;

      if (conf >= 80) {
        autoItems.push(base);
      } else if (conf >= 40) {
        reviewItems.push({
          ...base,
          candidates: (it.candidates || []).map(c => preprocessProductName(String(c))).filter(c => c.length > 1),
        });
      } else {
        lowItems.push(base);
      }
    }

    const items = deduplicateItems(autoItems);
    console.log(`최종: 자동${items.length} 검토${reviewItems.length} 저확신${lowItems.length}`);

    return res.status(200).json({ items, reviewItems, lowItems });

  } catch (err) {
    console.error("분석 오류:", err.message);
    return res.status(500).json({ error: "분석 오류", details: err.message });
  }
}
