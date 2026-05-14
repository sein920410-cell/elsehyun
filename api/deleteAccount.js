import { createClient } from "@supabase/supabase-js";

// SERVICE_ROLE_KEY: 관리자 권한으로 모든 데이터 접근 가능
const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  // 1. JWT 검증 — Authorization 헤더에서 토큰 추출
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return res.status(401).json({ error: "인증 토큰 없음" });

  const { data: { user }, error: authErr } = await supa.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: "유효하지 않은 토큰" });

  const email = user.email;
  const now = new Date().toISOString();

  try {
    // 2. 패키지 태그 코드 목록 수집 (삭제 전에 먼저 조회)
    const { data: serialRows } = await supa
      .from("serials")
      .select("set_number")
      .eq("used_by", email);

    const tagCodes = [];
    if (serialRows && serialRows.length > 0) {
      const setNums = [...new Set(serialRows.map(r => r.set_number))];
      setNums.forEach(n => {
        tagCodes.push(`GYEOL-${n}-MAIN`);
        tagCodes.push(`GYEOL-${n}-DR1`);
        tagCodes.push(`GYEOL-${n}-DR2`);
      });
    }

    // 3. 단품 태그 코드 목록 수집
    const { data: singleRows } = await supa
      .from("single_serials")
      .select("item_number")
      .eq("used_by", email);

    if (singleRows && singleRows.length > 0) {
      singleRows.forEach(r => tagCodes.push(`GYEOL-S-${r.item_number}`));
    }

    // 4. Storage 사진/영상 삭제 — 각 태그 폴더의 파일 전부 삭제
    for (const tagCode of tagCodes) {
      const { data: files } = await supa.storage
        .from("user_uploads")
        .list(tagCode);

      if (files && files.length > 0) {
        const paths = files.map(f => `${tagCode}/${f.name}`);
        await supa.storage.from("user_uploads").remove(paths);
      }
    }

    // 5. serials — used_by NULL 초기화 + 14일 유예 기록
    await supa
      .from("serials")
      .update({ used_by: null, deleted_at: now, original_owner: email })
      .eq("used_by", email);

    // 6. single_serials — used_by NULL 초기화
    await supa
      .from("single_serials")
      .update({ used_by: null, used_at: null })
      .eq("used_by", email);

    // 7. Auth 계정 완전 삭제
    await supa.auth.admin.deleteUser(user.id);

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error("deleteAccount error:", err);
    return res.status(500).json({ error: "계정 삭제 중 오류가 발생했어요." });
  }
}
