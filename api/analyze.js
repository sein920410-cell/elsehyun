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

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mimeType || "image/jpeg", data: b64 } },
          { text: `너는 공간:결 시스템의 최고 수준 물품 인식 전문가야. 다음 지침을 엄격히 따라서 사진 속 모든 물건을 단 하나도 빠짐없이 추출해.

1. 무조건 전체 스캔: 구석에 있거나 겹쳐서 일부만 보이는 아주 작은 물건도 전부 다 찾아내.
2. 상표명 완벽 읽기: 겉면에 적힌 글자를 끝까지 읽어서 '려 트리트먼트', '베베앙 물티슈', '일리윤 여성청결제' 등 상표명 그대로 정확히 적어.
3. 모르는 건 기타 처리: 이름이나 용도를 100% 확신할 수 없거나 잘 안 보이는 물건은 억지로 추측하지 말고 '기타:하얀색 펌프 용기', '기타:파란색 뚜껑 상자'처럼 눈에 보이는 형태 그대로 '기타' 카테고리에 넣어.
4. 응답 형식: 다른 설명은 절대 쓰지 말고 오직 '카테고리:물품명' 형식으로만 결과만 쉼표로 나열해. (예: 생활:려 트리트먼트, 유아:베베앙 물티슈, 기타:투명한 플라스틱 통)` }
        ]}]
      })
    });

    const data = await response.json();
    const botText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    // 대괄호를 제거하고 형식에 맞는 데이터만 리스트로 반환 [cite: 2026-03-04]
    const items = botText.split(",").map(s => s.trim().replace(/\[|\]/g, "")).filter(it => it.includes(":"));
    return res.status(200).json({ items });
  } catch (err) {
    return res.status(500).json({ error: "분석 오류" });
  }
}
