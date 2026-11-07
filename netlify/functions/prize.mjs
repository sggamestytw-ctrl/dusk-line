// 기프티콘 이벤트 서버
// GET  /api/prize?token=…  : 최근 당첨자(닉네임만) + 내가 당첨됐는지
// POST /api/prize          : 당첨자가 휴대폰 번호를 남김 (동의 필수)
// 번호는 비공개 저장소 "prize-claims"에만 저장돼요. 공개 API로는 절대 나가지 않아요.
// 확인: Netlify 대시보드 > Data & storage > Blobs > prize-claims. 기프티콘을 보낸 뒤에는 그 항목을 지워주세요.
import { getStore } from "@netlify/blobs";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

async function hashToken(t) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("dusk-line-token:" + t));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
const CLAIM_DAYS = 7;

export default async (req) => {
  const prize = getStore({ name: "prize", consistency: "strong" });
  const winners = (await prize.get("winners", { type: "json" })) || [];
  const url = new URL(req.url);

  if (req.method === "GET") {
    const token = (url.searchParams.get("token") || "").slice(0, 64);
    let me = null;
    if (/^[0-9a-f]{20,64}$/.test(token)) {
      const tk = await hashToken(token);
      const w = [...winners].reverse().find(x => x.tk === tk);
      if (w) me = { won: true, week: w.week, claimed: !!w.claimed, expired: !w.claimed && Date.now() - w.t > CLAIM_DAYS * 864e5 };
    }
    return json({ winners: [...winners].reverse().slice(0, 8).map(w => ({ week: w.week, name: w.name })), me });
  }

  if (req.method !== "POST") return json({ error: "지원하지 않는 요청이에요" }, 405);
  let body = {};
  try { body = await req.json(); } catch (e) { /* 빈 요청 */ }
  const token = String(body.token || "").slice(0, 64);
  const phone = String(body.phone || "").replace(/\D/g, "");
  if (!/^[0-9a-f]{20,64}$/.test(token)) return json({ error: "잘못된 요청이에요" }, 400);
  if (body.agree !== true) return json({ error: "개인정보 수집·이용에 동의해야 해요" }, 400);
  if (!/^01[016789]\d{7,8}$/.test(phone)) return json({ error: "휴대폰 번호를 정확히 입력해주세요" }, 400);

  const tk = await hashToken(token);
  const idx = winners.map(x => x.tk).lastIndexOf(tk);
  if (idx < 0) return json({ error: "당첨 내역이 없어요" }, 404);
  const w = winners[idx];
  if (w.claimed) return json({ error: "이미 접수됐어요" }, 409);
  if (Date.now() - w.t > CLAIM_DAYS * 864e5) return json({ error: "번호를 남길 수 있는 기간(7일)이 지났어요" }, 410);

  const claims = getStore({ name: "prize-claims", consistency: "strong" });
  const key = w.week + "_" + w.entryId;
  await claims.setJSON(key, { week: w.week, name: w.name, phone: phone.replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3"), review: w.msg, agreedAt: new Date().toISOString() });
  w.claimed = true;
  winners[idx] = w;
  await prize.setJSON("winners", winners);
  return json({ ok: true });
};

export const config = { path: "/api/prize" };
