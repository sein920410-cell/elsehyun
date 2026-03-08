import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ── 브랜드 사전 (소문자 키 → 한글) ──
const BRAND_MAP = {
  // 생활/세정
  "bebeen": "베베앙", "bébéen": "베베앙", "bebien": "베베앙",
  "febreze": "페브리즈", "febreeze": "페브리즈",
  "pigeon": "피죤", "downy": "다우니", "tide": "타이드",
  "ryo": "려", "ryoe": "려",
  "illiyoon": "일리윤", "ilyoon": "일리윤",
  "dr.g": "닥터지", "drg": "닥터지", "dr g": "닥터지",
  "pantene": "팬틴", "head&shoulders": "헤드앤숄더", "head & shoulders": "헤드앤숄더",
  "dove": "도브", "lux": "럭스", "lifebuoy": "라이프보이",
  "dettol": "데톨", "lysol": "라이솔",
  "scotch brite": "스카치브라이트", "scotchbrite": "스카치브라이트",
  "aveeno": "아비노", "cetaphil": "세타필", "eucerin": "유세린",
  "neutrogena": "뉴트로지나", "vaseline": "바세린",
  "nivea": "니베아", "garnier": "가르니에",
  "anessa": "아네사", "sunplay": "선플레이",
  "huggies": "하기스", "pampers": "팸퍼스", "mama bear": "마마베어",
  "kleenex": "클리넥스", "ziploc": "지퍼락",
  "energizer": "에너자이저", "duracell": "듀라셀",
  "3m": "쓰리엠",
  // 전자
  "hp": "HP", "samsung": "삼성", "lg": "LG", "apple": "애플",
  "sony": "소니", "panasonic": "파나소닉", "philips": "필립스",
  "dyson": "다이슨", "xiaomi": "샤오미", "anker": "앙커",
  // 주방
  "tefal": "테팔", "lock&lock": "락앤락", "lock & lock": "락앤락",
  // 세제
  "omo": "오모", "surf": "서프", "skip": "스킵",
  "bounce": "바운스", "gain": "게인",
  "mr.muscle": "미스터머슬", "mr muscle": "미스터머슬",
  "finish": "피니쉬", "cascade": "캐스케이드",
  // 뷰티/스킨케어
  "burt's bees": "버츠비", "burts bees": "버츠비",
  "weleda": "벨레다", "la mer": "라메르", "lamer": "라메르",
  "laneige": "라네즈", "sulwhasoo": "설화수", "whoo": "후",
  "innisfree": "이니스프리", "etude": "에뛰드", "tonymoly": "토니모리",
  "missha": "미샤", "clio": "클리오", "rom&nd": "롬앤",
  "mediheal": "메디힐", "cosrx": "코스알엑스",
  // 구강
  "oral-b": "오랄비", "colgate": "콜게이트", "sensodyne": "센소다인",
  "listerine": "리스테린",
  // 방향제
  "glade": "글레이드", "airwick": "에어윅",
  // 영양제 브랜드 (★ 중요: 브랜드명만 → 제품명은 별도 사전으로)
  "now foods": "나우푸드", "now": "나우푸드",
  "naturesplus": "네이처스플러스", "nature's plus": "네이처스플러스",
  "solgar": "솔가", "jamieson": "재미슨",
  "gnc": "GNC", "blackmores": "블랙모어스",
  "garden of life": "가든오브라이프",
  "doctor's best": "닥터베스트", "doctors best": "닥터베스트",
  "nordic naturals": "노르딕내추럴스",
  "life extension": "라이프익스텐션",
  "thorne": "쏜리서치", "kirkland": "커클랜드",
  "swisse": "스위스", "centrum": "센트룸",
  "emergen-c": "에머전씨",
};

// ── 제품 유형 사전 ──
// ★ 핵심 규칙: 영양제 계열은 절대 "비타민"으로 통합하지 않음
//   → 라벨에 적힌 성분명을 그대로 사용
const PRODUCT_TYPE_MAP = {
  // 헤어케어
  "shampoo": "샴푸",
  "conditioner": "컨디셔너",
  "treatment": "트리트먼트",       // ★ treatment → 트리트먼트 (샴푸 아님)
  "hair treatment": "트리트먼트",
  "hair mask": "헤어마스크",
  "scalp tonic": "두피토닉",
  "hair tonic": "헤어토닉",
  "hair loss": "탈모",
  "scalp care": "두피케어",
  "hair dryer": "헤어드라이어",
  "straightener": "고데기",
  // 바디케어
  "body wash": "바디워시",
  "shower gel": "샤워젤",
  "body lotion": "바디로션",
  "hand cream": "핸드크림",
  "hand wash": "핸드워시",
  "hand sanitizer": "손소독제",
  // 세안/스킨케어
  "face wash": "폼클렌저",
  "cleanser": "클렌저",
  "foam cleanser": "폼클렌저",
  "toner": "토너",
  "lotion": "로션",
  "cream": "크림",
  "serum": "세럼",
  "essence": "에센스",
  "mist": "미스트",
  "sunscreen": "선크림",
  "sun cream": "선크림",
  "sunblock": "선블록",
  "mask pack": "마스크팩",
  "sheet mask": "시트마스크",
  // 구강
  "toothpaste": "치약",
  "toothbrush": "칫솔",
  "mouthwash": "구강청결제",
  "dental floss": "치실",
  // 면도
  "razor": "면도기",
  "shaving cream": "쉐이빙크림",
  "shaving foam": "쉐이빙폼",
  "deodorant": "데오드란트",
  // 세탁/청소
  "detergent": "세제",
  "laundry detergent": "세탁세제",
  "fabric softener": "섬유유연제",
  "dishwashing liquid": "주방세제",
  "dish soap": "주방세제",
  "cleaner": "클리너",
  "disinfectant": "소독제",
  "air freshener": "방향제",
  // 잡화
  "tissue": "화장지",
  "toilet paper": "화장지",
  "paper towel": "키친타올",
  "wet wipes": "물티슈",
  "wipes": "물티슈",
  "baby wipes": "아기물티슈",
  "cotton pad": "화장솜",
  "cotton swab": "면봉",
  "sponge": "스펀지",
  "scrub": "수세미",
  "soap": "비누",
  // 전자
  "laptop": "노트북",
  "monitor": "모니터",
  "keyboard": "키보드",
  "mouse": "마우스",
  "speaker": "스피커",
  "headphone": "헤드폰",
  "earphone": "이어폰",
  "earbuds": "이어버즈",
  "charger": "충전기",
  "vacuum": "청소기",
  "air purifier": "공기청정기",
  "humidifier": "가습기",
  // 의약/영양제 ── ★ 각 성분별 개별 등록, 절대 "비타민"으로 통합하지 않음
  "arginine": "아르기닌",
  "l-arginine": "아르기닌",
  "collagen": "콜라겐",
  "omega-3": "오메가3",
  "omega 3": "오메가3",
  "fish oil": "피쉬오일",
  "vitamin c": "비타민C",
  "vitamin d": "비타민D",
  "vitamin d3": "비타민D3",
  "vitamin b": "비타민B",
  "vitamin b12": "비타민B12",
  "vitamin e": "비타민E",
  "vitamin a": "비타민A",
  "vitamin k": "비타민K",
  "multivitamin": "멀티비타민",
  "multi vitamin": "멀티비타민",
  "zinc": "아연",
  "magnesium": "마그네슘",
  "calcium": "칼슘",
  "iron": "철분",
  "probiotics": "프로바이오틱스",
  "probiotic": "프로바이오틱스",
  "lutein": "루테인",
  "glucosamine": "글루코사민",
  "coenzyme q10": "코엔자임Q10",
  "coq10": "코엔자임Q10",
  "biotin": "비오틴",
  "melatonin": "멜라토닌",
  "turmeric": "강황",
  "curcumin": "커큐민",
  "protein": "프로틴",
  "whey protein": "유청단백질",
  "creatine": "크레아틴",
  "bcaa": "BCAA",
  "eaa": "EAA",
  "glutamine": "글루타민",
  "inositol": "이노시톨",
  "folic acid": "엽산",
  "folate": "엽산",
  "niacin": "나이아신",
  "resveratrol": "레스베라트롤",
  "astaxanthin": "아스타잔틴",
  "spirulina": "스피루리나",
  "chlorella": "클로렐라",
  "milk thistle": "밀크씨슬",
  "ginkgo": "징코",
  "ginseng": "홍삼",
  "red ginseng": "홍삼",
  "hyaluronic acid": "히알루론산",
  "supplement": "영양제",   // ★ 최후 fallback — 위 성분명이 없을 때만 사용
  "medicine": "약",
  "tablet": "정제",         // ★ "알약"으로 퉁치지 않음
  "capsule": "캡슐",
  "softgel": "소프트젤",
};

// ── 상품명 전처리 ──
function preprocessProductName(name) {
  if (!name || typeof name !== "string") return name;
  let n = name.trim();

  // 가격/용량 제거
  n = n.replace(/[\d,]+\s*원/g, "");
  n = n.replace(/\d+(\.\d+)?\s*(ml|mL|l|L|g|G|kg|KG|oz|OZ|mg|MG|mcg|IU|매|개입|정|캡슐|포|팩|장|겹|count|ct|serving|servings)\b/gi, "");

  // 마케팅 문구 제거
  n = n.replace(/(할인|행사|증정|무료배송|이벤트|특가|세일|SALE|NEW|한정|베스트|추천|인기|best seller|new arrival)/gi, "");

  // 괄호 제거
  n = n.replace(/[(\[【][^\)）\]】]*[\)）\]】]/g, "");

  // 중복 구분자 정리
  n = n.replace(/[_\-–—·•|]{2,}/g, " ").replace(/\s{2,}/g, " ").trim();

  // 1) 브랜드 사전 치환 (앞에서만 매칭)
  let lower = n.toLowerCase();
  for (const [eng, kor] of Object.entries(BRAND_MAP)) {
    if (lower.startsWith(eng + " ") || lower === eng) {
      n = kor + n.slice(eng.length);
      lower = n.toLowerCase();
      break;
    }
  }

  // 2) 제품 유형 사전 치환
  //    ★ 단, 브랜드가 없는 pure 영어 단어일 때만 치환
  //    이미 한글이 포함된 경우 영어 성분명 치환 생략 방지
  lower = n.toLowerCase();
  // 긴 것 먼저 매칭 (greedy 방지)
  const sortedTypes = Object.entries(PRODUCT_TYPE_MAP).sort((a, b) => b[0].length - a[0].length);
  for (const [eng, kor] of sortedTypes) {
    const regex = new RegExp(`\\b${eng.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    n = n.replace(regex, kor);
  }

  // 한 글자 토큰·숫자만인 토큰 제거
  n = n.split(" ").filter(w => w.length > 1 && !/^\d+$/.test(w)).join(" ").trim();

  // 22자 초과 시 단어 단위로 자르기
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

// ── 중복 제거 ──
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

// ── JSON 안전 파싱 ──
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

// ════════════════════════════════════════
//  메인 핸들러
// ════════════════════════════════════════
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

    // 교정 데이터 힌트
    const correctionHint = userCorrections?.length > 0
      ? `\n[사용자 교정 데이터 — 아래 항목이 이미지에 있으면 이 이름 그대로 사용]\n${userCorrections.map(c => `  "${c.original}" → "${c.corrected}"`).join("\n")}\n`
      : "";

    // ══════════════════════════════════════
    //  프롬프트 — 핵심 원칙: 라벨을 읽어라, 추론/해석 금지
    // ══════════════════════════════════════
    const geminiPrompt = `당신은 서랍/수납함 재고 목록 생성 전문가입니다.
사진 속 물건을 하나도 빠짐없이 식별하여 JSON 목록을 만드세요.
${correctionHint}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[절대 원칙 — 반드시 준수]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

① 라벨에 적힌 글자를 OCR로 정확히 읽어라
   - 패키지에 쓰인 브랜드명 + 제품명을 그대로 가져온다
   - 절대 카테고리나 브랜드 이미지로 제품명을 추론/유추하지 않는다
   - 예시: 라벨에 "L-Arginine"이 적혀 있으면 → "나우푸드 아르기닌" (비타민이 아님)
   - 예시: 라벨에 "Treatment"가 있으면 → "트리트먼트" (샴푸가 아님)
   - 예시: 라벨에 "Conditioner"가 있으면 → "컨디셔너" (샴푸가 아님)
   - 예시: 라벨에 "Omega-3"이 있으면 → "오메가3" (비타민이 아님)
   - 예시: 라벨에 "Collagen"이 있으면 → "콜라겐" (영양제가 아님)

② 사진에 보이는 모든 물건을 목록에 포함한다
   - 왼쪽 위 → 오른쪽 위 → 중간 → 아래 순으로 스캔
   - 뒤에 가려져 일부만 보여도 식별 가능하면 포함
   - 같은 제품이 여러 개면 qty로 묶기

③ 없는 물건을 만들어내지 않는다
   - 사진에 없는 물건은 절대 추가하지 않는다
   - 라벨 텍스트를 읽을 수 없으면 보이는 형태/용기로만 설명

④ 영양제·보충제 규칙
   - 병/통에 적힌 성분명을 정확히 읽어라
   - Arginine/아르기닌, Collagen/콜라겐, Omega-3/오메가3, Zinc/아연,
     Magnesium/마그네슘, Biotin/비오틴, Probiotics/프로바이오틱스 등
     각각 다른 제품이다 — 절대 "비타민"으로 통합하지 않는다
   - "Vitamin C", "Vitamin D"처럼 명확히 비타민이라 쓰여 있을 때만 비타민으로 기록

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[confidence 기준]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
80~100: 브랜드 + 제품명 텍스트 모두 명확히 읽힘 → confidence:85
65~79:  브랜드 또는 제품명 중 하나만 읽힘 → confidence:72
40~64:  물건은 보이지만 텍스트 판독 어려움 → confidence:52, candidates:["후보1","후보2"]
0~39:   형태/색상만 보임 → confidence:25, name:"흰색 플라스틱 용기"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[카테고리]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"의류"  — 옷, 속옷, 양말, 신발, 가방, 모자, 벨트
"위생"  — 샴푸, 컨디셔너, 트리트먼트, 바디워시, 치약, 칫솔, 비누, 물티슈, 면도용품
"청소"  — 세탁세제, 섬유유연제, 주방세제, 청소스프레이, 수세미, 청소도구
"케어"  — 영양제, 보충제, 의약품, 마스크팩, 스킨케어 (로션/세럼/크림 등)
"생활"  — 전자기기, 배터리, 충전기, 수납용품, 문구류, 식품, 주방용품
"기타"  — 위 분류에 해당하지 않는 물건

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[출력 형식 — JSON 배열만 출력, 설명 텍스트 없음]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
confidence 65 이상:
{"category":"카테고리","name":"브랜드 제품명","qty":숫자,"confidence":숫자}

confidence 40~64:
{"category":"카테고리","name":"가장 가능성 높은 이름","qty":숫자,"confidence":숫자,"candidates":["후보1","후보2"]}

confidence 39 이하:
{"category":"기타","name":"형태 설명","qty":숫자,"confidence":숫자}

[상품명 규칙]
- "브랜드명 + 제품유형/성분명" 형식
- 2~5단어, 22자 이내
- ✅ "나우푸드 아르기닌", "려 트리트먼트", "코스알엑스 세럼", "다우니 섬유유연제"
- ❌ "나우푸드 비타민" (아르기닌인데 비타민으로 기재 — 오류)
- ❌ "려 샴푸" (트리트먼트인데 샴푸로 기재 — 오류)
- ❌ "영양제류" (모호한 묶음 — 오류)`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } },
              { text: geminiPrompt }
            ]
          }],
          generationConfig: {
            temperature: 0.05,      // ★ 낮게 유지 — 창의적 해석 최소화
            maxOutputTokens: 8192,
            thinkingConfig: { thinkingBudget: 10000 }  // ★ 충분한 분석 예산
          }
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    // thinking 파트 제외하고 text만 추출
    let botText = parts.filter(p => p.text && !p.thought).map(p => p.text).join("") || "[]";
    console.log("Gemini 응답 앞 500자:", botText.slice(0, 500));

    const rawItems = safeParseItems(botText);
    console.log("파싱 아이템 수:", rawItems.length);

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
          candidates: (it.candidates || [])
            .map(c => preprocessProductName(String(c)))
            .filter(c => c.length > 1),
        });
      } else {
        lowItems.push(base);
      }
    }

    const items = deduplicateItems(autoItems);
    console.log(`최종: 자동${items.length}개 검토${reviewItems.length}개 저확신${lowItems.length}개`);

    return res.status(200).json({ items, reviewItems, lowItems });

  } catch (err) {
    console.error("분석 오류:", err.message);
    return res.status(500).json({ error: "분석 오류", details: err.message });
  }
}
