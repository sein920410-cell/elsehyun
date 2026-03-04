import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const { filePath, mimeType } = req.body;

  try {
    const { data: signedData } = await supa.storage.from('user_uploads').createSignedUrl(filePath, 60);
    const imgResp = await fetch(signedData.signedUrl);
    const b64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");

    // ... (api/analyze.js 상단 로직 동일) ...

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } },
          { text: `너는 사업용 스마트 수납 관리 시스템 '공간:결'의 물품 인식 전문가야. 사진 속 물건을 분석할 때 다음 규칙을 엄격히 지켜.

1. 브랜드 우선 식별: 노트북은 'HP 노트북', 마우스는 '로지텍 마우스', 충전기는 '맥세이프 충전기'처럼 브랜드 로고가 보이면 [브랜드명+물품종류]로 정확히 써. 확실하지 않은 상세 모델명은 억지로 지어내지 마.
2. 주변 기기 누락 금지: 책상 위나 서랍 주변의 '콘센트(멀티탭)', '마우스패드', 수납함 내부의 '파일/서류' 등 작은 물건까지 하나도 놓치지 말고 다 찾아내.
3. 정확한 명칭: 키보드와 마우스 등을 절대 헷갈리지 마. 애플워치는 '애플워치'라고 명확히 분류해.
4. 응답 형식: 오직 '카테고리:브랜드 상품명' 형식으로만 나열하고 결과만 쉼표(,)로 구분해.

예시: 가전:HP 노트북, 가전:애플워치, 가전:맥세이프 충전기, 생활:멀티탭, 사무:마우스패드, 사무:L자 파일` }
        ]}]
      })
    });

// ... (이하 결과 처리 로직 동일) ...
    const data = await response.json();
    const botText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    // 대괄호를 제거하고 형식에 맞는 데이터만 리스트로 반환 [cite: 2026-03-04]
    const items = botText.split(",").map(s => s.trim().replace(/\[|\]/g, "")).filter(it => it.includes(":"));
    return res.status(200).json({ items });
  } catch (err) {
    return res.status(500).json({ error: "분석 오류" });
  }
}
