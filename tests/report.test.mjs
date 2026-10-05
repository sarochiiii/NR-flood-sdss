// รายงานสถานการณ์สำหรับ LINE: ฟังก์ชันในเว็บ (region/js/report.js) กับใน worker ต้องเหมือนกัน และสร้างข้อความจากข้อมูลจริงได้
//   node --no-warnings tests/report.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const R = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const cut = (s) => { const a = s.indexOf('// >>> situationReport'), b = s.indexOf('// <<< situationReport');
  assert.ok(a >= 0 && b > a, 'ไม่พบเครื่องหมาย >>> / <<<');
  return s.slice(a, b).split('\n').map(l => l.trim()).join('\n'); };
const web = R('region/js/report.js'), wk = R('line/kv/worker.js');
assert.equal(cut(web), cut(wk), 'situationReport ใน report.js กับ worker.js ไม่ตรงกัน — คัดลอกทั้งฟังก์ชันอีกครั้ง');

// รันฝั่งเว็บด้วยข้อมูลใน region/data
const ctx = { window: {}, document: { addEventListener() {} } }; vm.createContext(ctx); vm.runInContext(web, ctx);
const J = (p) => JSON.parse(R('region/' + p));
const D = { tw: J('data/live/thaiwater_region.json'), prov: J('data/live/tw_province.json'), rid: J('data/live/rid_reservoir.json'),
  gf: J('data/live/gistda_flood_7d.geojson'), cfg: J('config.json') };
const txt = ctx.window.SDSS_REPORT.situationReport(D);
for (const k of ['ฝนสถานีตรวจวัด', 'ระดับน้ำสถานีตรวจวัด', 'M.188A', 'อ่างเก็บน้ำ', 'ลำเชียงไกรตอนบน', 'GISTDA', 'ไม่ใช่ประกาศเตือนภัยทางการ']) assert.ok(txt.includes(k), 'ไม่มี ' + k);
assert.ok(!/undefined|NaN|null/.test(txt), 'มีค่า undefined/NaN/null ในข้อความ');
assert.ok(txt.length < 5000, 'ยาวเกินข้อจำกัด LINE 5000 ตัวอักษร');
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
console.log(txt + '\n\nreport: ผ่านทุกกรณี');
