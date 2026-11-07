// 매주 월요일 오전 10시(한국 시간) 자동 추첨
// 지난 7일 동안 후기를 남긴 사람 중 1명을 뽑아요. 한 사람(기기)당 한 번만 응모돼요.
// 30일이 지난 휴대폰 번호는 여기서 자동으로 지워요.
import { getStore } from "@netlify/blobs";

export default async () => {
  const gb = getStore({ name: "guestbook", consistency: "strong" });
  const prize = getStore({ name: "prize", consistency: "strong" });
  const claims = getStore({ name: "prize-claims", consistency: "strong" });
  const now = Date.now();

  // 30일 지난 번호 삭제
  const { blobs } = await claims.list();
  for (const b of blobs) {
    const c = await claims.get(b.key, { type: "json" });
    if (!c || !c.agreedAt || now - Date.parse(c.agreedAt) > 30 * 864e5) await claims.delete(b.key);
  }

  const entries = (await gb.get("entries", { type: "json" })) || [];
  const recent = entries.filter(e => e.tk && now - e.t < 7 * 864e5);
  const byPerson = new Map();
  for (const e of recent) byPerson.set(e.tk, e); // 한 사람당 마지막 후기 하나
  const pool = [...byPerson.values()];
  if (!pool.length) return;

  const pick = pool[crypto.getRandomValues(new Uint32Array(1))[0] % pool.length];
  const kst = new Date(now + 9 * 3600e3);
  const week = `${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일`;
  const winners = (await prize.get("winners", { type: "json" })) || [];
  winners.push({ week, entryId: pick.id, name: pick.name, msg: pick.msg, tk: pick.tk, t: now, claimed: false });
  while (winners.length > 60) winners.shift();
  await prize.setJSON("winners", winners);
};

// 월요일 01:00 UTC = 한국 시간 월요일 오전 10시
export const config = { schedule: "0 1 * * 1" };
