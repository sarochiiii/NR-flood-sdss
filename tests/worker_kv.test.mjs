// ทดสอบ line/kv/worker.js ด้วย KV และ LINE API จำลอง:  node --no-warnings tests/worker_kv.test.mjs
import assert from 'node:assert/strict';
import w from '../line/kv/worker.js';

const store = new Map();
const KV = { get: async (k, t) => { const v = store.get(k); return v == null ? null : (t === 'json' ? JSON.parse(v) : v); },
  put: async (k, v) => { store.set(k, v); }, delete: async k => { store.delete(k); },
  list: async ({ prefix }) => ({ keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }) };
const sent = [];
globalThis.fetch = async (u, o = {}) => { u = String(u);
  if (u.includes('github.io')) return { ok: false };                        // ข้อมูลสถานการณ์น้ำ — ไม่ทดสอบที่นี่
  if (u.endsWith('/quota')) return { ok: true, json: async () => ({ type: 'limited', value: 300 }) };
  if (u.endsWith('/consumption')) return { ok: true, json: async () => ({ totalUsage: 0 }) };
  if (u.includes('/members/count')) return { ok: true, json: async () => ({ count: 5 }) };
  sent.push({ u, b: JSON.parse(o.body) }); return { ok: true, status: 200, text: async () => '' }; };
const env = { USERS: KV, LINE_CHANNEL_SECRET: 's', LINE_CHANNEL_TOKEN: 't', STATS_KEY: 'k'.repeat(24), DAILY_GROUP_PUSH: 'on' };
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('s'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
async function send(ev) {
  const b = JSON.stringify({ events: [ev] });
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(b)))));
  const n = sent.length;
  const r = await w.fetch(new Request('https://x', { method: 'POST', body: b, headers: { 'x-line-signature': sig } }), env);
  assert.equal(r.status, 200);
  return sent.length > n ? sent.at(-1).b.messages.map(m => m.text || m.type).join(' | ') : '';
}
const U = (id, text) => send({ type: 'message', replyToken: 'r', source: { type: 'user', userId: id }, message: { type: 'text', text } });
const G = (id, text) => send({ type: 'message', replyToken: 'r', source: { type: 'group', groupId: 'G1', userId: id }, message: { type: 'text', text } });

store.set('invite:CHANAT-TEST1', JSON.stringify({ note: 'test' }));
assert.match(await U('UA', 'ลงทะเบียน ADM'), /รหัสเชิญ/);
assert.match(await U('UA', 'WRONG1'), /ไม่ถูกต้อง/);
assert.match(await U('UA', 'chanat-test1'), /ลงทะเบียนเป็น ADM เรียบร้อย/);
assert.match(await (U('UB', 'ลงทะเบียน ADM'), U('UB', 'CHANAT-TEST1')), /ถูกใช้แล้ว/);
// v4.12 รหัสกลุ่ม: ใช้ได้ไม่เกิน max_uses คน · คนเดิมลงทะเบียนซ้ำได้ · คนที่ 3 ถูกปฏิเสธ
store.set('invite:CHANAT-GRP2', JSON.stringify({ note: 'group', max_uses: 2 }));
await U('UG1', 'ลงทะเบียน ADM'); assert.match(await U('UG1', 'CHANAT-GRP2'), /ลงทะเบียนเป็น ADM เรียบร้อย/);
await U('UG2', 'ลงทะเบียน ADM'); assert.match(await U('UG2', 'chanat-grp2'), /ลงทะเบียนเป็น ADM เรียบร้อย/);
await U('UG1', 'ลงทะเบียน ADM'); assert.match(await U('UG1', 'CHANAT-GRP2'), /ลงทะเบียนเป็น ADM เรียบร้อย/);
await U('UG3', 'ลงทะเบียน ADM'); assert.match(await U('UG3', 'CHANAT-GRP2'), /ครบจำนวน/);
assert.equal(JSON.parse(store.get('invite:CHANAT-GRP2')).used_count, 2);
assert.ok(JSON.parse(store.get('user:UG2')).adm && !store.get('user:UG3'));
assert.match(await U('UC', 'ลงทะเบียน ประชาชน'), /ประชาชน/);
const loc = (id, lat, lon) => send({ type: 'message', replyToken: 'r', source: { type: 'user', userId: id }, message: { type: 'location', latitude: lat, longitude: lon, address: 'x' } });
// v4.13 รายงานเหตุ: ไม่ต้องลงทะเบียน (ประกาศการใช้ข้อมูลในขั้นแรก) · มีตัวเลือกขอความช่วยเหลือ · ต้องแชร์ตำแหน่ง · ไม่ส่งถึง ADM
assert.match(await U('UC', 'รายงานเหตุ'), /ประเภทเหตุการณ์[\s\S]*การใช้ข้อมูล/);
assert.match(JSON.stringify(sent.at(-1).b), /ขอความช่วยเหลือ/);
// v4.14 ปุ่มเลือก ม.1–ม.8 (ยังพิมพ์ชื่อหมู่บ้านอื่นเองได้)
assert.match(await U('UC', 'น้ำท่วมบ้าน'), /หมู่บ้านใด[\s\S]*พิมพ์ชื่อหมู่บ้านเอง/);
const qv = sent.at(-1).b.messages.at(-1).quickReply.items.map(i => i.action.text);
assert.deepEqual([qv.length, qv[0], qv[4], qv[7]], [9, 'ม.1 สำโรง', 'ม.5 ด่านติง', 'ม.8 โค้งกระพี้']);
await U('UC', 'หมู่ 5');
assert.match(await U('UC', 'ข้าม'), /ต้องแชร์ตำแหน่ง/);
await loc('UC', 15.156789, 102.157891);
await U('UC', 'บ้านเลขที่ทดสอบ');
const nSent = sent.length;
assert.match(await U('UC', 'ยืนยัน'), /รับรายงานแล้ว[\s\S]*แผนที่[\s\S]*ปิดเหตุ/);
assert.equal(sent.slice(nSent).filter(s => s.u.includes('multicast') || s.u.includes('/push')).length, 0);
// ผู้ไม่เคยลงทะเบียนขอความช่วยเหลือได้ทันที (ทางลัด) → ตำแหน่งจริง · กด "ยืนยัน" แล้วถูกบันทึกเป็นประชาชนที่ยินยอม
assert.equal(store.get('user:UN'), undefined);
assert.match(await U('UN', 'ขอความช่วยเหลือ'), /ไม่ผ่าน ADM[\s\S]*การใช้ข้อมูล[\s\S]*หมู่บ้านใด/);
assert.match(await U('UN', 'ม.3 เหล่า'), /ตำแหน่งจริง/);
await loc('UN', 15.1612345, 102.1498765);
assert.match(await U('UN', 'ผู้สูงอายุติดเตียง 1 คน'), /ยินยอม/);
assert.match(await U('UN', 'ยืนยัน'), /รับคำขอความช่วยเหลือแล้ว/);
const un = JSON.parse(store.get('user:UN'));
assert.ok(un.role === 'public' && un.consent && !un.adm);
// ติดต่อ อบต.: ยังไม่มีเบอร์ที่ยืนยัน → ตอบเบอร์ฉุกเฉิน
assert.match(await U('UC', 'ติดต่อ อบต.'), /อยู่ระหว่างยืนยัน[\s\S]*1669/);
// กลุ่ม: ข้อความทั่วไปไม่ตอบ · ผู้ไม่มีรหัสเปิดรายงานไม่ได้
await send({ type: 'join', replyToken: 'r', source: { type: 'group', groupId: 'G1' } });
assert.equal(await G('UC', 'สวัสดี'), '');
assert.match(await G('UC', 'เปิดรายงานประจำวัน'), /เฉพาะ ADM/);
assert.match(await G('UA', 'เปิดรายงานประจำวัน'), /เปิดรายงาน/);
// /api/reports สาธารณะ: ไม่มีรายละเอียด/ผู้รายงาน · น้ำท่วมปัด ~100 ม. · ขอความช่วยเหลือตำแหน่งจริง
const pub = async () => (await w.fetch(new Request('https://x/api/reports'), env)).json();
let pr = await pub();
assert.equal(pr.items.length, 2);
const fl = pr.items.find(i => i.type === 'น้ำท่วมบ้าน'), hp = pr.items.find(i => i.type === 'ขอความช่วยเหลือ');
assert.deepEqual([fl.lat, fl.lon, fl.precise], [15.157, 102.158, false]);
assert.deepEqual([hp.lat, hp.lon, hp.precise], [15.16123, 102.14988, true]);
assert.ok(!/ทดสอบ|ติดเตียง|"UC"|"UN"|reporter|note|address/.test(JSON.stringify(pr)));
// หน้าติดตาม อบต.: ต้องมี MONITOR_KEY · เห็นรายละเอียด ไม่เห็นรหัสผู้ใช้ LINE
const MK = 'm'.repeat(24), mon = (path, o = {}) => w.fetch(new Request('https://x' + path, o), env);
assert.equal((await mon('/api/monitor')).status, 503);
env.MONITOR_KEY = 'short, ' + MK;
assert.equal((await mon('/api/monitor', { headers: { 'X-Monitor-Key': 'short' } })).status, 403);
assert.equal((await mon('/api/monitor', { method: 'OPTIONS' })).status, 204);
const md = await (await mon('/api/monitor', { headers: { 'X-Monitor-Key': MK } })).json();
assert.equal(md.items.length, 2);
assert.ok(JSON.stringify(md).includes('ติดเตียง') && !/"UC"|"UN"|reporter/.test(JSON.stringify(md)));
assert.equal(md.items.find(i => i.type === 'ขอความช่วยเหลือ').lat, 15.1612345);
const st = (id, status, k = MK) => mon('/api/monitor/status', { method: 'POST', headers: { 'X-Monitor-Key': k, 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) });
assert.equal((await st(hp.id, 'ack', 'x'.repeat(24))).status, 403);
assert.equal((await st('BAD', 'ack')).status, 400);
assert.equal((await st(hp.id, 'ack')).status, 200);
assert.equal((await pub()).items.find(i => i.id === hp.id).status, 'ack');
assert.equal((await st(hp.id, 'closed')).status, 200);
assert.equal(JSON.parse(store.get('report:' + hp.id)).closed_by, 'abt');
assert.equal((await pub()).items.length, 1);                                        // ปิดแล้วหายจากแผนที่สาธารณะ
// ผู้รายงานปิดเหตุของตนเอง · ปิดของคนอื่นไม่ได้
assert.match(await U('UN', 'ปิดเหตุ'), /ไม่มีเหตุ/);
assert.match(await U('UN', 'ปิดเหตุ ' + fl.id), /ไม่พบเหตุ/);
assert.match(await U('UC', 'ปิดเหตุ'), new RegExp(fl.id));
assert.match(await U('UC', 'ปิดเหตุ ' + fl.id.toLowerCase()), /ปิดเหตุ .* แล้ว/);
assert.equal((await pub()).items.length, 0);
assert.equal(JSON.parse(store.get('report:' + fl.id)).closed_by, 'reporter');
// /stats ต้องใช้ key
assert.equal((await w.fetch(new Request('https://x/stats'), env)).status, 403);
console.log('worker_kv: ผ่านทุกกรณี');
