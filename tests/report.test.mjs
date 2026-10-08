// รายงานสถานการณ์สำหรับ LINE: ฟังก์ชันในเว็บ (region/js/report.js) กับใน worker ต้องเหมือนกัน และสร้างข้อความจากข้อมูลจริงได้
//   node --no-warnings tests/report.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const R = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const cut = (s, fn = 'situationReport') => { const a = s.indexOf('// >>> ' + fn), b = s.indexOf('// <<< ' + fn);
  assert.ok(a >= 0 && b > a, 'ไม่พบเครื่องหมาย >>> / <<< ของ ' + fn);
  return s.slice(a, b).split('\n').map(l => l.trim()).join('\n'); };
const web = R('region/js/report.js'), wk = R('line/kv/worker.js');
for (const fn of ['situationReport', 'sandboxReport'])
  assert.equal(cut(web, fn), cut(wk, fn), `${fn} ใน report.js กับ worker.js ไม่ตรงกัน — คัดลอกทั้งฟังก์ชันอีกครั้ง`);

// รันฝั่งเว็บด้วยข้อมูลใน region/data
const ctx = { window: {}, document: { addEventListener() {} } }; vm.createContext(ctx); vm.runInContext(web, ctx);
// ecmwf.json สร้างโดย Actions — ถ้ายังไม่มีในเครื่อง ใช้ค่าจำลองรูปแบบเดียวกับ scripts/region/fetch_ecmwf.py
const EC = { status: 'ok', updated_at: '2026-10-05T06:00:00+00:00', model: 'ecmwf_ifs025', next24_mm: 12.3, next72_mm: 40.1,
  days: [['2026-10-05', 10.2, 31.4, 23.9], ['2026-10-06', 25.0, 30.1, 23.5], ['2026-10-07', 4.9, 32.0, 24.1], ['2026-10-08', 0, 33, 24]] };
const J = (p) => { try { return JSON.parse(R('region/' + p)); } catch (e) { if (p.endsWith('ecmwf.json')) return EC; throw e; } };
const D = { tw: J('data/live/thaiwater_region.json'), rid: J('data/live/rid_reservoir.json'),
  gf: J('data/live/gistda_flood_7d.geojson'), ec: J('data/live/ecmwf.json'), cfg: J('config.json') };
const txt = ctx.window.SDSS_REPORT.situationReport(D);
for (const k of ['พยากรณ์อากาศ ECMWF', 'ฝน 24 ชม. ข้างหน้า', 'ระดับน้ำสถานีตรวจวัด', 'M.188A', 'อ่างเก็บน้ำ', 'ลำเชียงไกรตอนบน', 'ลำเชียงไกรตอนล่าง', 'GISTDA', 'ต.จันอัด:', 'ไม่ใช่ประกาศเตือนภัยทางการ']) assert.ok(txt.includes(k), 'ไม่มี ' + k);
assert.ok(!/undefined|NaN|null/.test(txt), 'มีค่า undefined/NaN/null ในข้อความ');
assert.ok(txt.length < 5000, 'ยาวเกินข้อจำกัด LINE 5000 ตัวอักษร');
// อ่าง: เฉพาะลำเชียงไกร 2 อ่าง · GISTDA: เฉพาะ ต.จันอัด
const sec = (h) => txt.split('\n\n').find(b => b.includes(h)).split('\n');
assert.equal(sec('🏞').length, 3); assert.equal(sec('🛰').length, 2);
assert.ok(!/ในจังหวัด|26 ตำบล|จากวันก่อน|ฝนสถานีตรวจวัด/.test(txt));
// ข้อมูลว่างทั้งหมดต้องไม่ error
assert.ok(!/undefined|NaN/.test(ctx.window.SDSS_REPORT.situationReport({})));

// worker: คำสั่ง "สถานการณ์น้ำ" ต้องได้ข้อความเดียวกับเว็บ
const sent = [];
globalThis.fetch = async (u, o = {}) => { u = String(u);
  if (u.includes('github.io')) { const p = u.split('/region/')[1]; return { ok: true, json: async () => J(p) }; }
  sent.push(JSON.parse(o.body)); return { ok: true, status: 200, text: async () => '' }; };
const { default: w } = await import('../line/kv/worker.js');
const store = new Map([['user:U1', JSON.stringify({ role: 'citizen' })]]);
const env = { USERS: { get: async (k, t) => { const v = store.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; },
  put: async (k, v) => store.set(k, v), delete: async k => store.delete(k), list: async () => ({ keys: [], list_complete: true }) },
  LINE_CHANNEL_SECRET: 's', LINE_CHANNEL_TOKEN: 't' };
const body = JSON.stringify({ events: [{ type: 'message', replyToken: 'r', source: { type: 'user', userId: 'U1' }, message: { type: 'text', text: 'สถานการณ์น้ำ' } }] });
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('s'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))));
await w.fetch(new Request('https://x', { method: 'POST', body, headers: { 'x-line-signature': sig } }), env, { waitUntil() {} });
assert.equal(sent.at(-1).messages[0].text, txt);

// รายงาน SDSS บ้านด่านติง: ข้อความจากข้อมูลจริง · ข้อมูลว่างไม่ error · คำสั่ง LINE ได้ข้อความเดียวกับเว็บ
const SB = { ...D, sb: J('data/sandbox/summary.json') };
const sbt = ctx.window.SDSS_REPORT.sandboxReport(SB);
for (const k of ['บ้านด่านติง', 'อาคารรอบบ้านด่านติง', 'ท่วมซ้ำ ≥ 3 ครั้ง', 'ทั้ง ต.จันอัด', 'M.188A', 'ลำเชียงไกรตอนบน', 'ECMWF', 'GISTDA 7 วัน', 'ไม่ใช่ครัวเรือน', 'ไม่ใช่ประกาศเตือนภัยทางการ', '/chanat/'])
  assert.ok(sbt.includes(k), 'รายงานบ้านด่านติงไม่มี ' + k);
assert.ok(!/undefined|NaN|null/.test(sbt), 'รายงานบ้านด่านติงมี undefined/NaN/null'); assert.ok(sbt.length < 5000);
assert.ok(!/undefined|NaN/.test(ctx.window.SDSS_REPORT.sandboxReport({})));
for (const cmd of ['รายงานบ้านด่านติง', 'รายงานด่านติง']) {
  const b2 = JSON.stringify({ events: [{ type: 'message', replyToken: 'r2', source: { type: 'user', userId: 'U1' }, message: { type: 'text', text: cmd } }] });
  const s2 = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(b2)))));
  await w.fetch(new Request('https://x', { method: 'POST', body: b2, headers: { 'x-line-signature': s2 } }), env, { waitUntil() {} });
  assert.equal(sent.at(-1).messages[0].text, sbt, `คำสั่ง "${cmd}" ได้ข้อความไม่ตรงกับเว็บ`);
}
// ในกลุ่ม LINE คำสั่งนี้ต้องไม่ตอบ (กลุ่มตอบเฉพาะ 3 คำสั่ง)
const n0 = sent.length;
const b3 = JSON.stringify({ events: [{ type: 'message', replyToken: 'r3', source: { type: 'group', groupId: 'G1', userId: 'U1' }, message: { type: 'text', text: 'รายงานบ้านด่านติง' } }] });
const s3 = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(b3)))));
await w.fetch(new Request('https://x', { method: 'POST', body: b3, headers: { 'x-line-signature': s3 } }), env, { waitUntil() {} });
assert.equal(sent.length, n0, 'กลุ่ม LINE ไม่ควรตอบคำสั่งรายงานบ้านด่านติง');
console.log(txt + '\n\n' + sbt + '\n\nreport: ผ่านทุกกรณี');
