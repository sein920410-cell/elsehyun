// api/analyze.js
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const BRAND_MAP = {
  "bebeen": "베베앙", "bébéen": "베베앙", "bebien": "베베앙",
  "febreze": "페브리즈", "febr eze": "페브리즈",
  "pigeon": "피죤", "downy": "다우니", "tide": "타이드",
  "ryo": "려", "ryoe": "려",
  "illiyoon": "일리윤", "ilyoon": "일리윤",
  "dr.g": "닥터지", "drg": "닥터지", "dr g": "닥터지",
  "now": "나우", "now foods": "나우푸드",
  "magic bright": "매직브라이트", "magicbright": "매직브라이트",
  "pantene": "팬틴", "head&shoulders": "헤드앤숄더",
  "dove": "도브", "lux": "럭스", "lifebuoy": "라이프보이",
  "dettol": "데톨", "lysol": "라이솔",
  "scotch brite": "스카치브라이트", "scotchbrite": "스카치브라이트",
  "pledge": "플레지", "windex": "윈덱스",
  "aveeno": "아비노", "cetaphil": "세타필", "eucerin": "유세린",
  "neutrogena": "뉴트로지나", "vaseline": "바세린",
  "nivea": "니베아", "garnier": "가르니에",
  "sunplay": "선플레이", "anessa": "아네사",
  "mama bear": "마마베어", "huggies": "하기스", "pampers": "팸퍼스",
  "kleenex": "클리넥스", "bounty": "바운티",
  "cottonelle": "코토넬", "charmin": "챠민",
  "ziploc": "지퍼락", "glad": "글래드",
  "energizer": "에너자이저", "duracell": "듀라셀",
  "3m": "쓰리엠", "command": "커맨드",
};

const PRODUCT_TYPE_MAP = {
  "wipes": "물티슈", "wet wipes": "물티슈", "baby wipes": "아기물티슈",
  "shampoo": "샴푸", "conditioner": "컨디셔너", "treatment": "트리트먼트",
  "body wash": "바디워시", "shower gel": "샤워젤",
  "lotion": "로션", "cream": "크림", "serum": "세럼", "essence": "에센스",
  "sunscreen": "선크림", "sun cream": "선크림", "spf": "선크림",
  "toner": "토너", "emulsion": "에멀젼",
  "detergent": "세제", "laundry": "세탁세제", "fabric softener": "섬유유연제",
  "cleaner": "클리너", "spray": "스프레이", "disinfectant": "소독제",
  "toothpaste": "치약", "toothbrush": "칫솔", "mouthwash": "구강청결제",
  "tissue": "화장지", "toilet paper": "화장지", "paper towel": "키친타올",
  "mask": "마스크", "cotton": "면봉", "band aid": "반창고",
  "supplement": "영양제", "vitamin": "비타민", "capsule": "캡슐",
  "hair loss": "탈모", "scalp": "두피", "hair care": "헤어케어",
  "deodorant": "데오드란트", "perfume": "향수",
  "dishwashing": "주방세제", "dish soap": "주방세제",
  "bleach": "락스", "toilet cleaner": "변기세정제",
};

function preprocessProductName(name) {
  if (!name || typeof name !== "string") return name;
  let n = name.trim();

  n = n.replace(/[\d,]+\s*원/g, "");
  n = n.replace(/\d+(\.\d+)?\s*(ml|mL|ML|l|L|g|G|kg|KG|oz|OZ|mg|MG|매|개입|정|캡슐|포|팩|장|겹)\b/gi, "");
  n = n.replace(/(할인|행사|증정|무료배송|이벤트|특가|세일|SALE|NEW|신상|\d+%\s*(off|할인)|한정|품절임박|베스트|추천|인기)/gi, "");
  n = n.replace(/[(\[【][^\)）\]】]*[\)）\]】]/g, "");
  n = n.replace(/\s*\/\s*(for|care|with|plus|premium|special|original|classic|natural|organic|gentle|mild|sensitive)[^\/]*/gi, "");
  n = n.replace(/[_\-–—·•|]{2,}/g, " ");
  n = n.replace(/\s{2,}/g, " ").trim();

  let lower = n.toLowerCase();
  for (const [eng, kor] of Object.entries(BRAND_MAP)) {
    if (lower.startsWith(eng)) {
      n = kor + n.slice(eng.length);
      lower = n.toLowerCase();
      break;
    }
    const idx = lower.indexOf(eng);
    if (idx !== -1) {
      n = n.slice(0, idx) + kor + n.slice(idx + eng.length);
      lower = n.toLowerCase();
    }
  }

  lower = n.toLowerCase();
  for (const [eng, kor] of Object.entries(PRODUCT_TYPE_MAP)) {
    const regex = new RegExp(`\\b${eng}\\b`, 'gi');
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
    if (results.length > 0) {
      console.log(`[복구] 잘린 JSON에서 ${results.length}개 객체 복구`);
      return results;
    }
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
    if (signedErr || !signedData?.signedUrl) {
      return res.status(500).json({ error: "이미지 URL 생성 오류" });
    }

    const imgResp = await fetch(signedData.signedUrl);
    if (!imgResp.ok) throw new Error(`이미지 fetch 실패: ${imgResp.status}`);
    const b64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");

    const correctionHint = userCorrections?.length > 0
      ? `\n━━━ 사용자 교정 데이터 (최우선 적용) ━━━\n이전 사용자가 직접 수정한 상품명입니다. 동일 제품 발견 시 반드시 아래 이름을 사용하세요:\n${userCorrections.map(c => `- "${c.original}" → "${c.corrected}"`).join("\n")}\n`
      : "";

    const geminiPrompt = `당신은 전문 재고 분류 AI입니다. 사진을 보고 아래 규칙을 100% 준수하여 물건을 분류하세요.
${correctionHint}
━━━ 핵심 원칙: 사용자 친화적 상품명 ━━━
OCR로 읽은 영문 원문을 그대로 쓰지 마세요.
한국 소비자가 실제로 부르는 이름으로 변환하세요.

변환 예시:
❌ "Bébéen Ry My baby's First Wipes BEBEEN ROYAL"
✅ "베베앙 물티슈"

❌ "RYO ROOTGEN HAIR LOSS CARE TREATMENT 480ml"
✅ "려 탈모 트리트먼트"

❌ "Magic Bright 만능 클리너 500ml 99% 항균"
✅ "매직브라이트 만능 클리너"

❌ "NOW ULTRA OMEGA-3 180 Softgels Fish Oil"
✅ "나우 오메가3"

━━━ 상품명 작성 규칙 ━━━
[규칙1] 브랜드명은 한국에서 부르는 이름으로 변환 (영어→한글)
        FEBREZE→페브리즈, PIGEON→피죤, RYO→려, ILLIYOON→일리윤
[규칙2] 브랜드명 + 핵심 제품명만 남기고 나머지 제거
[규칙3] 용량(ml/g/L), 성분명, 광고문구, 효능설명 제거
[규칙4] 최종 상품명은 2~5단어, 20자 이내
[규칙5] 텍스트가 보이지 않으면 패키지 색상/형태/용도로 판단
[규칙6] 같은 제품이 여러 개면 qty 숫자로 표현 (별도 항목 금지)

━━━ 제품 식별 방법 ━━━
1. 텍스트와 이미지 특징을 함께 분석
2. 패키지 디자인/색상/형태로 제품 카테고리 판단
3. 부분적으로만 보이는 텍스트도 문맥으로 유추
4. 텍스트 없이 이미지만 보이면 외형으로 판단

━━━ 의류 분류 ━━━
종류별 개별 항목으로 출력, qty는 해당 종류 수량:
코트/패딩/자켓·점퍼/가디건/스웨터·니트/후드티/맨투맨/
티셔츠·반팔/셔츠·남방/바지·슬랙스/청바지/치마/원피스/
운동복/양말/브라·속옷상의/팬티·트렁크/스타킹·레깅스/넥타이/모자

━━━ 카테고리 분류 ━━━
"의류"  - 모든 의류, 속옷, 양말, 모자, 넥타이
"위생"  - 물티슈, 화장지, 생리대, 면봉, 마스크
"청소"  - 세제, 락스, 유연제, 청소포, 탈취제, 행주
"케어"  - 화장품, 로션, 선크림, 샴푸, 트리트먼트, 바디워시, 치약, 영양제
"생활"  - 캐리어, 가방, 선풍기, 수납함, 건전지, 공구, 생활용품
"기타"  - 위 5가지 외 모든 물건

━━━ 절대 금지 ━━━
- 사진에 없는 물건 추가 금지
- 빈 배열 [] 금지
- JSON 외 설명문, 마크다운, 코드블럭 금지
- 영어 원문 상품명 그대로 출력 금지

━━━ 출력 형식 ━━━
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
          generationConfig: { temperature: 0.1, maxOutputTokens: 8192 }
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = await response.json();

    let botText = "";
    if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
      botText = data.candidates[0].content.parts[0].text;
    } else if (data.candidates?.[0]?.finishReason === "MAX_TOKENS") {
      console.warn("[경고] MAX_TOKENS 도달");
      botText = data.candidates[0]?.content?.parts?.[0]?.text || "[]";
    } else {
      botText = "[]";
    }

    console.log("Gemini 응답 앞 500자:", botText.slice(0, 500));

    const rawItems = safeParseItems(botText);
    console.log("파싱 아이템 수:", rawItems.length);

    const items = deduplicateItems(
      rawItems
        .filter(it => it?.name && String(it.name).length > 1)
        .map(it => ({
          category: it.category || "기타",
          name: preprocessProductName(String(it.name)),
          qty: Math.max(1, Number(it.qty) || 1)
        }))
        .filter(it => it.name?.length > 1)
    );

    console.log("최종 아이템 수:", items.length);
    return res.status(200).json({ items });

  } catch (err) {
    console.error("분석 오류:", err.message);
    return res.status(500).json({ error: "분석 오류", details: err.message });
  }
}
