// ทดสอบ Message Gateway ใน line/kv/worker.js (v4.15) ด้วย KV และ LINE API จำลอง:  node --no-warnings tests/gateway.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import w from '../line/kv/worker.js';

const GW = globalThis.__chanatGateway;
const store = new Map();
const KV = { get: async (k, t) => { const v = store.get(k); return v == null ? null : (t === 'json' ? JSON.parse(v) : v); },
  put: async (k, v) => { store.set(k, String(v)); }, delete: async (k) => { store.delete(k); },
  list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) };

// LINE API จำลอง: โควตา Q · ใช้ไปแล้ว U · กลุ่มมีสมาชิก N · Free ปฏิเสธ (429) เมื่อเกินโควตา
const L = { Q: 300, U: 0, N: 7, plan: 'free', quotaFail: false };
const calls = [];
const live = { tw: JSON.parse(fs.readFileSync('region/data/live/thaiwater_region.json', 'utf8')) };
globalThis.fetch = async (u, o = {}) => {
  u = String(u);
  const json = (b, ok = true, status = 200) => ({ ok, status, json: async () => b, text: async () => JSON.stringify(b) });
  if (u.includes('github.io')) {                                   // ไฟล์ข้อมูลของเว็บ → ไฟล์ใน repo (thaiwater แก้ค่าได้ในทดสอบ)
    const p = u.split('/NR-flood-sdss/')[1];
    if (p === 'region/data/live/thaiwater_region.json') return json(live.tw);
    return fs.existsSync(p) ? json(JSON.parse(fs.readFileSync(p, 'utf8'))) : json(null, false, 404);
  }
  if (u.endsWith('/message/quota')) return L.quotaFail ? json(null, false, 500) : json({ type: 'limited', value: L.Q });
  if (u.endsWith('/quota/consumption')) return L.quotaFail ? json(null, false, 500) : json({ totalUsage: L.U });
  if (u.includes('/members/count')) return json({ count: L.N });
  const b = JSON.parse(o.body), kind = u.split('/').pop();
  const cost = kind === 'reply' ? 0 : kind === 'multicast' ? b.to.length : String(b.to).startsWith('C') ? L.N : 1;
  if (cost && L.plan === 'free' && L.U + cost > L.Q) { calls.push({ kind, b, rejected: true }); return json({ message: 'quota' }, false, 429); }
  L.U += cost; calls.push({ kind, b });
  return json({});
};
const env = { USERS: KV, LINE_CHANNEL_SECRET: 's', LINE_CHANNEL_TOKEN: 't', STATS_KEY: 'k'.repeat(24), DAILY_GROUP_PUSH: 'on' };
const reset = (o = {}) => { store.clear(); calls.length = 0; Object.assign(L, { Q: 300, U: 0, N: 7, plan: 'free', quotaFail: false }, o); };
const pushes = () => calls.filter((c) => c.kind !== 'reply' && !c.rejected);
const stat = async () => JSON.parse(store.get(`gw:stat:${new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7)}`) || '{}');
const T = (s) => ({ type: 'text', text: s });
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('s'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
async function U(id, text) {
  const b = JSON.stringify({ events: [{ type: 'message', replyToken: 'r', source: { type: 'user', userId: id }, message: { type: 'text', text } }] });
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(b)))));
  await w.fetch(new Request('https://x', { method: 'POST', body: b, headers: { 'x-line-signature': sig } }), env);
  return calls.filter((c) => c.kind === 'reply').at(-1).b.messages;
}
const cron = (c) => new Promise((res) => w.scheduled({ cron: c }, env, { waitUntil: (p) => p.then(res) }));

// 1) P1 ส่งเสมอแม้โควตาหมด · Free: API ปฏิเสธ → log/นับ + เก็บ inbox ไว้แนบ reply
reset({ U: 300 });
let r = await GW.send(env, 'U1', [T('อพยพ')], { priority: 1, category: 'evacuation' });
assert.equal(calls.filter((c) => c.kind === 'push').length, 1, 'P1 ต้องพยายาม push แม้โควตาหมด');
assert.equal(r.status, 'failed');
assert.equal((await stat()).p1_over_quota, 1);
assert.equal(JSON.parse(store.get('inbox:U1')).length, 1);
reset({ U: 300, plan: 'basic' });                                  // Basic: API รับ (ส่วนเกิน)
r = await GW.send(env, 'U1', [T('อพยพ')], { priority: 1, category: 'evacuation' });
assert.equal(r.status, 'sent'); assert.equal((await stat()).sent_p1, 1);

// 2) P2 เข้า inbox เมื่อคงเหลือหลังส่ง < สำรอง P1 (300 × 0.2 = 60)
reset({ U: 250 });
r = await GW.send(env, 'U2', [T('งานด่วน')], { priority: 2, category: 'repair_report' });
assert.equal(r.status, 'inboxed'); assert.equal(pushes().length, 0);
assert.equal(JSON.parse(store.get('gw:pending')).length, 1);
reset({ U: 0 });                                                   // คงเหลือพอ → ส่ง
r = await GW.send(env, 'U2', [T('งานด่วน')], { priority: 2, category: 'repair_report' });
assert.equal(r.status, 'sent'); assert.equal((await stat())['cat:repair_report'], 1);

// 3) รวมหลายข้อความถึงผู้รับเดียวกัน: 7 object = 2 คำขอ (5 + 2) = ต้นทุน 2
reset();
r = await GW.send(env, 'U3', Array.from({ length: 7 }, (_, i) => T('m' + i)), { priority: 2, category: 'x' });
assert.equal(r.cost, 2); assert.deepEqual(pushes().map((c) => c.b.messages.length), [5, 2]);

// 4) งบรายวัน (pacing): budget = (คงเหลือ + ใช้วันนี้ − สำรอง) / วันที่เหลือ · ใช้ครบงบแล้ว → P2 เข้า inbox
reset({ U: 0 });
const days = GW.daysLeftInMonth(), budget = Math.floor((300 - 60) / days);
store.set(`gw:spent:${new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)}`, String(budget));
L.U = budget;
r = await GW.send(env, 'U4', [T('x')], { priority: 2, category: 'x' });
assert.equal(r.status, 'inboxed', `งบวันนี้ ${budget} ใช้ครบแล้ว`);

// 5) P3 ไม่ push ทันที → inbox (ไม่ลง pending) · piggyback แนบกับ reply (รวม ≤ 5) แล้วลบ inbox
reset();
for (let i = 0; i < 6; i++) await GW.send(env, 'U5', [T('ข่าว ' + i)], { priority: 3, category: 'info' });
assert.equal(pushes().length, 0); assert.equal(store.get('gw:pending'), undefined);
let msgs = await U('U5', 'ยกเลิก');
assert.equal(msgs.length, 5); assert.equal(msgs[0].text, 'ยกเลิกรายการแล้ว'); assert.equal(msgs[1].text, 'ข่าว 0');
assert.equal(JSON.parse(store.get('inbox:U5')).length, 2);         // เหลือ 2 รายการรอรอบถัดไป
msgs = await U('U5', 'ยกเลิก');
assert.equal(msgs.length, 3); assert.equal(store.get('inbox:U5'), undefined);
assert.equal((await stat()).piggybacked, 6);
msgs = await U('U5', 'ยกเลิก');                                    // inbox ว่าง = reply เหมือนเดิม
assert.deepEqual(msgs.map((m) => m.text), ['ยกเลิกรายการแล้ว']);

// 6) escalation: P2 ค้างเกิน ESCALATE_AFTER_H → push รอบ cron ถัดไป · ที่ยังไม่ถึงเวลาไม่ส่ง
reset({ U: 250 });
await GW.send(env, 'U6', [T('ต้องลงมือ')], { priority: 2, category: 'drought_request' });
await GW.send(env, 'U7', [T('ต้องลงมือ')], { priority: 2, category: 'drought_request' });
const old = new Date(Date.now() - 7 * 3600e3).toISOString();
store.set('gw:pending', JSON.stringify(JSON.parse(store.get('gw:pending')).map((p) => p.t === 'U6' ? { ...p, created: old } : p)));
await cron('5 * * * *');
assert.deepEqual(pushes().map((c) => c.b.to), ['U6']);
assert.equal(store.get('inbox:U6'), undefined); assert.ok(store.get('inbox:U7'));
assert.equal(JSON.parse(store.get('gw:pending')).length, 1); assert.equal((await stat()).escalated, 1);
reset({ U: 300 });                                                 // Free โควตาหมด: escalate ไม่ส่งเกินโควตา
await GW.send(env, 'U8', [T('x')], { priority: 2, category: 'x' });
store.set('gw:pending', JSON.stringify(JSON.parse(store.get('gw:pending')).map((p) => ({ ...p, created: old }))));
await cron('5 * * * *');
assert.equal(calls.length, 0); assert.ok(store.get('inbox:U8'));

// 7) สรุป 07:00: นับผู้รับตามสมาชิกกลุ่ม · ส่งเฉพาะวันที่สถานะเปลี่ยน
reset({ N: 7 });
store.set('group:C1', JSON.stringify({ approved: true, daily: true, kind: 'group' }));
store.set('group:R1', JSON.stringify({ approved: true, daily: true, kind: 'room' }));   // room นับสมาชิกไม่ได้ → ไม่ส่ง
store.set('group:C2', JSON.stringify({ approved: true, daily: false }));                // ปิดรายงานประจำวัน
await cron('0 0 * * *');
assert.deepEqual(pushes().map((c) => c.b.to), ['C1']);
assert.match(pushes()[0].b.messages[0].text, /รายงานประจำวัน[\s\S]*ไม่ใช่ประกาศเตือนภัยทางการ/);
assert.equal((await stat()).sent_p3, 7); assert.equal(JSON.parse(store.get('group:C1')).members, 7);
assert.equal((await stat()).skipped_unknown_recipients, 1);
calls.length = 0;
await cron('0 0 * * *');                                           // วันถัดไป สถานะเท่าเดิม → ไม่ส่ง
assert.equal(pushes().length, 0); assert.equal((await stat()).digest_skipped_nochange, 1);
const m = live.tw.waterlevel.find((s) => s.code === 'M.188A');
const saved = m.storage_pct; m.storage_pct = 101;                  // M.188A เปลี่ยนระดับ (ล้นตลิ่ง) → ส่ง
await cron('0 0 * * *');
assert.equal(pushes().length, 1);
m.storage_pct = saved;
calls.length = 0; L.U = 300 - 60 - 6;                              // คงเหลือ 66 − 7 < สำรอง 60 → ไม่ส่ง (ไม่เกินโควตา)
await cron('0 0 * * *');
assert.equal(pushes().length, 0); assert.ok((await stat()).blocked_quota >= 1);
calls.length = 0; L.U = 0; L.quotaFail = true; m.storage_pct = 50;  // ตรวจโควตาไม่ได้ → ไม่ส่ง (เดิมถือว่าไม่จำกัด)
await cron('0 0 * * *');
assert.equal(pushes().length, 0);
m.storage_pct = saved;
const sig1 = GW.digestSignature({ tw: live.tw, cfg: JSON.parse(fs.readFileSync('region/config.json', 'utf8')) });
assert.ok(!/\d{2}:\d{2}|measured/.test(sig1), 'signature ไม่ควรมีเวลาวัด (มิฉะนั้นเปลี่ยนทุกวัน)');

// 8) /stats: ตัวเลขรวมเท่านั้น ไม่มี userId/groupId
reset();
await GW.send(env, 'Uabc123', [T('x')], { priority: 2, category: 'drought_request' });
await GW.send(env, { group: 'Cgroup999' }, [T('x')], { priority: 3, category: 'info', digest: true });
await GW.send(env, 'Uabc123', [T('y')], { priority: 3, category: 'info' });
const st = await (await w.fetch(new Request(`https://x/stats?key=${'k'.repeat(24)}`), env)).json();
const g = st.gateway;
assert.equal(g.this_month.sent_p2, 1); assert.equal(g.this_month.sent_p3, 7); assert.equal(g.this_month.inboxed, 1);
assert.equal(g.this_month.by_category.drought_request, 1); assert.equal(g.quota.limit, 300);
assert.ok(!/Uabc123|Cgroup999/.test(JSON.stringify(st)), '/stats ต้องไม่มี userId/groupId');
console.log('gateway: ผ่านทุกกรณี');
