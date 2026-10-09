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
// v4.6: ติดต่อ อบต./ขอความช่วยเหลือ ปิดชั่วคราว → ตอบเบอร์ฉุกเฉิน ไม่เปิด session
assert.match(await U('UC', 'ขอความช่วยเหลือ'), /ปิดใช้งานชั่วคราว[\s\S]*1669/);
assert.match(await U('UC', 'ติดต่อ อบต.'), /ปิดใช้งานชั่วคราว/);
assert.equal(store.get('session:UC'), undefined);
// รายงานเหตุ: ไม่มีตัวเลือกขอความช่วยเหลือ · ต้องแชร์ตำแหน่ง · ไม่ส่งถึง ADM
assert.doesNotMatch(JSON.stringify((await U('UC', 'รายงานเหตุ'), sent.at(-1).b)), /ขอความช่วยเหลือ/);
assert.match(await U('UC', 'ขอความช่วยเหลือ'), /ประเภทเหตุการณ์/);
await U('UC', 'น้ำท่วมบ้าน'); await U('UC', 'หมู่ 5');
assert.match(await U('UC', 'ข้าม'), /ต้องแชร์ตำแหน่ง/);
await send({ type: 'message', replyToken: 'r', source: { type: 'user', userId: 'UC' }, message: { type: 'location', latitude: 15.156789, longitude: 102.157891, address: 'x' } });
await U('UC', 'บ้านเลขที่ทดสอบ');
const nSent = sent.length;
assert.match(await U('UC', 'ยืนยัน'), /รับรายงานแล้ว[\s\S]*แผนที่/);
assert.equal(sent.slice(nSent).filter(s => s.u.includes('multicast') || s.u.includes('/push')).length, 0);
// กลุ่ม: ข้อความทั่วไปไม่ตอบ · ผู้ไม่มีรหัสเปิดรายงานไม่ได้
await send({ type: 'join', replyToken: 'r', source: { type: 'group', groupId: 'G1' } });
assert.equal(await G('UC', 'สวัสดี'), '');
assert.match(await G('UC', 'เปิดรายงานประจำวัน'), /เฉพาะ ADM/);
assert.match(await G('UA', 'เปิดรายงานประจำวัน'), /เปิดรายงาน/);
// /api/reports สาธารณะ: ไม่มีรายละเอียด/ผู้รายงาน · ขอความช่วยเหลือเป็นจำนวนเท่านั้น
const pr = await (await w.fetch(new Request('https://x/api/reports'), env)).json();
assert.equal(pr.items.length, 1);
assert.deepEqual([pr.items[0].lat, pr.items[0].lon, pr.items[0].type], [15.157, 102.158, 'น้ำท่วมบ้าน']);
assert.ok(!JSON.stringify(pr).includes('ทดสอบ') && !JSON.stringify(pr).includes('UC'));
// /stats ต้องใช้ key
assert.equal((await w.fetch(new Request('https://x/stats'), env)).status, 403);
console.log('worker_kv: ผ่านทุกกรณี');
