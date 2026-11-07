// 방명록 서버: 모든 플레이어가 같은 방명록을 보고 쓸 수 있어요.
// 글은 Netlify Blobs("guestbook" 저장소)에 저장돼요. Netlify 대시보드의 Data & storage > Blobs 에서 확인·삭제할 수 있어요.
import { getStore } from "@netlify/blobs";

const BAD = ["시발", "씨발", "ㅅㅂ", "병신", "ㅂㅅ", "좆", "개새끼", "새끼", "fuck", "shit"];
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

async function hashIp(ip) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("dusk-line:" + ip));
  return [...new Uint8Array(buf)].slice(0, 8).map(b => b.toString(16).padStart(2, "0")).join("");
}

export default async (req, context) => {
  const store = getStore({ name: "guestbook", consistency: "strong" });

  if (req.method === "GET") {
    const list = (await store.get("entries", { type: "json" })) || [];
    return json(list.slice(-100).reverse());
  }
  if (req.method !== "POST") return json({ error: "지원하지 않는 요청이에요" }, 405);

  let body = {};
  try { body = await req.json(); } catch (e) { /* 빈 요청 */ }
  const clean = v => String(v || "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  const name = clean(body.name).slice(0, 12) || "익명";
  let msg = clean(body.msg).slice(0, 200);
  const meta = clean(body.meta).slice(0, 40);
  const rating = Math.min(5, Math.max(1, parseInt(body.rating, 10) || 5));
  if (msg.length < 2) return json({ error: "후기를 두 글자 이상 써주세요" }, 400);
  for (const w of BAD) msg = msg.split(w).join("♥".repeat(w.length));

  // 같은 사람이 30초 안에 연달아 쓰지 못하게 해요 (IP는 해시로만 잠깐 보관)
  const now = Date.now();
  const who = await hashIp(context.ip || req.headers.get("x-nf-client-connection-ip") || "unknown");
  const rl = (await store.get("ratelimit", { type: "json" })) || {};
  for (const k in rl) if (now - rl[k] > 3600e3) delete rl[k];
  if (rl[who] && now - rl[who] < 30e3) return json({ error: "잠시 후에 다시 써주세요" }, 429);
  rl[who] = now;
  await store.setJSON("ratelimit", rl);

  const list = (await store.get("entries", { type: "json" })) || [];
  const entry = { id: now.toString(36) + Math.random().toString(36).slice(2, 6), name, msg, rating, meta, t: now };
  list.push(entry);
  while (list.length > 500) list.shift();
  await store.setJSON("entries", list);
  return json(entry, 201);
};

export const config = { path: "/api/guestbook" };
