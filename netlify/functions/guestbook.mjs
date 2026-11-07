// 방명록 서버: 모든 플레이어가 같은 방명록을 보고 쓸 수 있어요.
// 글은 Netlify Blobs("guestbook" 저장소, "entries")에 저장돼요.
// Netlify 대시보드 > Data & storage > Blobs 에서 확인·삭제할 수 있어요.
//
// 검열
//  - 욕설·비하·성적 표현: 띄어쓰기나 기호, 숫자를 섞어 써도 걸러서 글을 거절해요 (닉네임은 "익명"으로 바꿔요)
//  - 링크, 전화번호, 이메일, 카톡 아이디 같은 광고·연락처 거절
//  - 같은 글 반복, 한 글자 도배 거절
//  - 30초에 1개, 하루 5개까지
//  - 신고 3번(서로 다른 사람) 받으면 자동으로 숨김
//  - 직접 숨기기: entries 에서 그 글에 "hidden": true 를 넣거나 글을 지우면 돼요
import { getStore } from "@netlify/blobs";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

// 비교할 때는 공백·기호·숫자를 모두 지운 글자만 봐요 ("시 1 발", "ㅅ.ㅂ" 도 잡혀요)
const BANNED = [
  // 욕설
  "씨발", "시발", "씨바", "시바", "씨빨", "시빨", "쒸발", "씹", "ㅅㅂ", "ㅆㅂ", "ㅅㅃ", "ㅆㅃ", "tlqkf", "sibal", "ssibal",
  "병신", "븅신", "빙신", "ㅂㅅ", "ㅄ", "qudtls",
  "지랄", "ㅈㄹ", "좆", "ㅈ같", "존나같", "ㅈ까", "개새끼", "개새", "개색", "개세끼", "개쉐", "개섀", "ㄱㅅㄲ", "니새끼", "느그", "새끼야",
  "닥쳐", "뒈져",
  // 패드립
  "니애미", "니미", "느금", "애미", "애비", "엠창", "니엄마", "니아빠", "ㄴㄱㅁ", "ㄴㅇㅁ",
  // 성적 표현
  "섹스", "자지", "보지", "ㅂㅈ", "야동", "야스", "딸딸", "자위", "꼴리", "따먹", "강간",
  // 비하·혐오
  "장애인새", "애자", "한남충", "한녀", "김치녀", "맘충", "틀딱", "급식충", "홍어", "쪽바리", "짱깨", "깜둥", "흑형", "게이새", "운지",
  // 영어
  "fuck", "fck", "fuk", "shit", "bitch", "cunt", "nigger", "nigga", "faggot", "porn", "pussy", "dick", "asshole", "whore", "slut",
];
// 정상 단어 안에 우연히 들어간 경우는 봐줘요
const ALLOW = ["시발점", "시바견", "시바이누", "새끼고양이", "새끼를", "새끼가", "보지마", "보지않", "보지못", "보지도", "자지마", "자지않", "애비게일", "애자일", "운지법", "개새로"];

function squash(s) {
  return s.toLowerCase().normalize("NFC").replace(/[^0-9a-z가-힣ㄱ-ㅎㅏ-ㅣ]/g, "").replace(/[0-9]/g, "");
}
function hasBanned(s) {
  let t = squash(s);
  for (const a of ALLOW) t = t.split(a).join("");
  return BANNED.some(w => t.includes(w));
}
function hasContact(s) {
  const t = s.toLowerCase();
  if (/https?:|www\.|\.(com|net|kr|io|me|gg|org|xyz|site|link|app)\b|bit\.ly|open\.kakao|discord\.gg|t\.me/.test(t)) return true;
  if (/0\s*1\s*[016789][\s.-]*\d{3,4}[\s.-]*\d{4}/.test(t)) return true;
  if (/[\w.+-]+@[\w-]+\.\w+/.test(t)) return true;
  if (/(카톡|카카오톡|텔레|텔레그램|라인|디코|디스코드|인스타)\s*(아이디|id|:)/i.test(t)) return true;
  return false;
}
function isSpam(s) {
  const t = s.replace(/\s/g, "");
  if (/(.)\1{7,}/.test(t)) return true; // 같은 글자 8번 이상
  const counts = {};
  for (const ch of t) counts[ch] = (counts[ch] || 0) + 1;
  return t.length >= 10 && Math.max(...Object.values(counts)) / t.length > 0.5;
}

export async function hashToken(t) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("dusk-line-token:" + t));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function hashIp(ip) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("dusk-line:" + ip));
  return [...new Uint8Array(buf)].slice(0, 8).map(b => b.toString(16).padStart(2, "0")).join("");
}
const pub = ({ tk, rp, hidden, ...rest }) => rest; // 응모권·신고자·숨김 정보는 밖으로 안 나가요

export default async (req, context) => {
  const store = getStore({ name: "guestbook", consistency: "strong" });

  if (req.method === "GET") {
    const list = (await store.get("entries", { type: "json" })) || [];
    return json(list.filter(e => !e.hidden).slice(-100).reverse().map(pub));
  }
  if (req.method !== "POST") return json({ error: "지원하지 않는 요청이에요" }, 405);

  let body = {};
  try { body = await req.json(); } catch (e) { /* 빈 요청 */ }
  const now = Date.now();
  const who = await hashIp(context.ip || req.headers.get("x-nf-client-connection-ip") || "unknown");

  // 신고: 서로 다른 3명이 신고하면 숨겨요
  if (body.action === "report") {
    const list = (await store.get("entries", { type: "json" })) || [];
    const e = list.find(x => x.id === String(body.id || ""));
    if (!e) return json({ error: "없는 글이에요" }, 404);
    e.rp = e.rp || [];
    if (!e.rp.includes(who)) e.rp.push(who);
    if (e.rp.length >= 3) e.hidden = true;
    await store.setJSON("entries", list);
    return json({ ok: true, hidden: !!e.hidden });
  }

  const clean = v => String(v || "").replace(/[\u0000-\u001f​-‏⁠﻿]/g, " ").replace(/\s+/g, " ").trim();
  let name = clean(body.name).slice(0, 12) || "익명";
  const msg = clean(body.msg).slice(0, 200);
  const meta = clean(body.meta).slice(0, 40);
  const rating = Math.min(5, Math.max(1, parseInt(body.rating, 10) || 5));
  if (msg.length < 2) return json({ error: "후기를 두 글자 이상 써주세요" }, 400);
  if (hasBanned(msg)) return json({ error: "부적절한 표현이 있어서 올릴 수 없어요" }, 400);
  if (hasContact(msg) || hasContact(name)) return json({ error: "링크나 연락처는 쓸 수 없어요" }, 400);
  if (isSpam(msg)) return json({ error: "같은 글자를 너무 많이 반복했어요" }, 400);
  if (hasBanned(name)) name = "익명";

  // 도배 방지: 30초에 1개, 하루 5개
  const rl = (await store.get("ratelimit", { type: "json" })) || {};
  for (const k in rl) { rl[k] = (Array.isArray(rl[k]) ? rl[k] : [rl[k]]).filter(t => now - t < 864e5); if (!rl[k].length) delete rl[k]; }
  const mine = rl[who] || [];
  if (mine.length && now - mine[mine.length - 1] < 30e3) return json({ error: "잠시 후에 다시 써주세요" }, 429);
  if (mine.length >= 5) return json({ error: "오늘은 후기를 더 쓸 수 없어요. 내일 다시 써주세요" }, 429);

  const list = (await store.get("entries", { type: "json" })) || [];
  const sq = squash(msg);
  if (sq.length >= 4 && list.slice(-30).some(e => squash(e.msg) === sq)) return json({ error: "같은 내용은 다시 올릴 수 없어요" }, 400);

  mine.push(now); rl[who] = mine;
  await store.setJSON("ratelimit", rl);

  // 기프티콘 추첨용 익명 응모권: 기기 토큰의 해시만 저장하고 밖으로 보내지 않아요
  const token = String(body.token || "").slice(0, 64);
  const tk = /^[0-9a-f]{20,64}$/.test(token) ? await hashToken(token) : null;
  const entry = { id: now.toString(36) + Math.random().toString(36).slice(2, 6), name, msg, rating, meta, t: now, tk };
  list.push(entry);
  while (list.length > 500) list.shift();
  await store.setJSON("entries", list);
  return json(pub(entry), 201);
};

export const config = { path: "/api/guestbook" };
