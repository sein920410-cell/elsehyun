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
  "omo": "오모", "surf": "서프", "skip": "스킵",
  "burt's bees": "버츠비", "burts bees": "버츠비",
  "weleda": "벨레다", "la mer": "라메르", "lamer": "라메르",
  "laneige": "라네즈", "sulwhasoo": "설화수", "whoo": "후",
  "innisfree": "이니스프리", "etude": "에뛰드", "tonymoly": "토니모리",
  "missha": "미샤", "clio": "클리오", "rom&nd": "롬앤",
  "mediheal": "메디힐", "cosrx": "코스알엑스",
  "oral-b": "오랄비", "colgate": "콜게이트", "sensodyne": "센소다인",
  "listerine": "리스테린",
  "glade": "글레이드", "airwick": "에어윅",
  "bounce": "바운스", "gain": "게인",
  "mr.muscle": "미스터머슬", "mr muscle": "미스터머슬",
  "finish": "피니쉬", "cascade": "캐스케이드",
};

const PRODUCT_TYPE_MAP = {
  "wipes": "물티슈", "wet wipes": "물티슈", "baby wipes": "아기물티슈",
  "shampoo": "샴푸", "conditioner": "컨디셔너", "treatment": "트리트먼트",
  "body wash": "바디워시", "shower gel": "샤워젤",
  "lotion": "로션", "cream": "크림", "serum": "세럼", "essence": "에센스",
  "sunscreen": "선크림", "sun cream": "선크림", "sunblock": "선블록",
  "toner": "토너", "mist": "미스트",
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
  "humidifier": "가습기", "dehumidifier": "제습기",
  "mask": "마스크", "gloves": "장갑",
  "sponge": "스펀지", "scrub": "수세미",
  "soap": "비누", "hand wash": "핸드워시", "hand sanitizer": "손소독제",
  "razor": "면도기", "shaving": "면도",
  "cotton": "면봉", "cotton pad": "화장솜",
  "hair dryer": "헤어드라이어", "straightener": "고데기",
  "supplement": "영양제", "vitamin": "비타민", "omega": "오메가",
  "medicine": "약", "tablet": "알약", "capsule": "캡슐",
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

  if (n.length > 22) {
    const words = n.split(" ");
    let result = words[0];
    for (let i = 1; i < words.length; i++) {
      if ((result + " " + words[i]).length <= 22) result += " " + words[i];
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

    const geminiPrompt = `당신은 재고 분류 전문 AI입니다. 사진 속 물건을 빠짐없이 분석하여 목록을 생성하세요.
${correctionHint}

━━━ 핵심 목표: 모든 물건을 빠짐없이 기록 ━━━
사진에 보이는 모든 물건을 빠짐없이 목록화하는 것이 최우선입니다.
좌상단 → 우상단 → 중간 → 하단 순서로 체계적으로 스캔하세요.
숨겨져 있거나 일부만 보이더라도 식별 가능하면 반드시 포함하세요.
같은 제품이 여러 개라면 qty로 통합하세요.

━━━ confidence(확신도) 기준 ━━━
[80~100] 브랜드+제품유형 모두 명확히 식별
         → confidence:85
[65~79]  브랜드 OR 제품유형 하나는 확실
         → confidence:72
[40~64]  물건은 보이나 브랜드/유형 불확실 (candidates 2~3개 제공)
         → confidence:50, candidates:["후보1","후보2"]
[0~39]   형태만 보여 정확한 식별 불가
         → confidence:25, name:"스프레이류"

━━━ 브랜드 인식 규칙 (OCR 최우선) ━━━
패키지 텍스트를 반드시 OCR로 읽으세요:
Febreze→페브리즈, RYO/려→려, Illiyoon→일리윤, Bebeen→베베앙
Dove→도브, Pantene→팬틴, Dettol→데톨, Pigeon→피죤
Downy→다우니, Scotch-Brite→스카치브라이트, Neutrogena→뉴트로지나

━━━ 상품명 규칙 ━━━
✅ "페브리즈 섬유탈취제", "려 탈모샴푸", "하기스 물티슈"
✅ 브랜드 없으면 제품유형만: "세탁세제", "바디워시"
❌ "세정제류" 같은 모호한 분류 지양 (더 구체적으로)
- 2~5단어, 22자 이내

━━━ 카테고리 ━━━
"의류" / "위생" / "청소" / "케어" / "생활" / "기타"

의류: 옷, 속옷, 양말, 신발, 가방, 모자, 벨트
위생: 샴푸, 바디워시, 치약, 칫솔, 비누, 물티슈, 화장품, 구강용품, 면도용품
청소: 세탁세제, 섬유유연제, 주방세제, 청소용 스프레이, 수세미, 청소도구
케어: 비타민, 영양제, 의약품, 의료기기, 마스크팩, 스킨케어
생활: 전자기기, 배터리, 충전기, 수납용품, 문구류, 식품, 주방용품
기타: 위 카테고리에 해당하지 않는 물건

━━━ 출력 형식 ━━━
confidence 65 이상:
{"category":"카테고리","name":"제품명","qty":숫자,"confidence":숫자}

confidence 40~64:
{"category":"카테고리","name":"가장 가능한 이름","qty":숫자,"confidence":숫자,"candidates":["후보1","후보2","후보3"]}

confidence 40 미만:
{"category":"카테고리","name":"일반 유형명","qty":숫자,"confidence":숫자}

JSON 배열만 출력. 설명 텍스트 없음. 최대한 많은 물건을 포함하세요.`;

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
            maxOutputTokens: 8192,
            thinkingConfig: { thinkingBudget: 8000 }
          }
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = await response.json();
    // thinkingConfig 사용 시 parts가 여러 개일 수 있으므로 text 파트만 추출
    const parts = data.candidates?.[0]?.content?.parts || [];
    let botText = parts.filter(p => p.text && !p.thought).map(p => p.text).join("") || "[]";
    console.log("Gemini 응답 앞 500자:", botText.slice(0, 500));

    const rawItems = safeParseItems(botText);
    console.log("파싱 아이템 수:", rawItems.length);

    // ── confidence에 따라 세 그룹 분류 ──
    // 65 이상 → 자동 등록 (기존 80에서 하향)
    // 40~64 → 사용자 확인 (기존 40~79)
    // 40 미만 → 저확신 등록
    const autoItems = [];
    const reviewItems = [];
    const lowItems = [];

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

      if (conf >= 65) {
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
