import { createClient } from "@supabase/supabase-js";

// Vercel 환경 변수 로드
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  
  const { filePath, mimeType } = req.body;

  try {
    // 1. 보안 정책(RLS)을 우회하기 위해 Signed URL 생성
    const { data: signedData, error: sError } = await supa.storage.from('user_uploads').createSignedUrl(filePath, 60);
    if (sError) throw new Error(`스토리지 접근 실패: ${sError.message}`);

    // 2. 이미지 데이터 다운로드 및 Base64 변환
    const imgResp = await fetch(signedData.signedUrl);
    const buffer = await imgResp.arrayBuffer();
    const b64 = Buffer.from(buffer).toString("base64");

    // 3. Gemini 2.0 Flash Lite용 v1beta 엔드포인트 호출
    const model = process.env.GEMINI_MODEL || "gemini-2.0-flash-lite";
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const gResp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } },
          { text: "물류 분석 전문가로서 이미지 속 물건의 '브랜드명 상세이름'을 한국어로 찾으세요. 결과는 오직 이름들만 콤마(,)로 구분해 출력하고 마크다운이나 설명은 절대 하지 마세요." }
        ]}]
      })
    });

    const gData = await gResp.json();
    if (gData.error) throw new Error(`AI 분석 실패: ${gData.error.message}`);

    let botText = gData.candidates?.[0]?.content?.parts?.[0]?.text || "";
    // 불필요한 기호 및 공백 정제
    botText = botText.replace(/```[a-z]*|```|[#*]/gi, "").trim();
    
    const items = botText ? botText.split(",").map(s => s.trim()).filter(it => it.length > 0) : [];
    
    return res.status(200).json({ items });

  } catch (err) {
    console.error("[분석 에러]", err.message);
    return res.status(500).json({ error: err.message });
  }
}
