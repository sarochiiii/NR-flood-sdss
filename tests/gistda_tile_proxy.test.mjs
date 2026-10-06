// ทดสอบ workers/gistda-tile-proxy.js ด้วย caches.default และ fetch จำลอง:  node --no-warnings tests/gistda_tile_proxy.test.mjs
import assert from 'node:assert/strict';
import w from '../workers/gistda-tile-proxy.js';

const store = new Map(), seen = [];
globalThis.caches = { default: { match: async (r) => store.get(r.url)?.clone(), put: async (r, res) => { store.set(r.url, res); } } };
globalThis.fetch = async (u, o) => { seen.push({ u: String(u), key: o.headers['API-Key'] });
  return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'Content-Type': 'image/png' } }); };
const waits = [], ctx = { waitUntil: (p) => waits.push(p) };
const env = { GISTDA_API_KEY: 'k-test', UPSTREAM: 'https://up.example/t/{z}/{x}/{y}', ALLOWED_ORIGIN: 'https://sarochiiii.github.io' };
const go = (p, e = env, m = 'GET') => w.fetch(new Request('https://wk.example' + p, { method: m }), e, ctx);

// tile บ้านด่านติง z14 x12840 y7494 (คำนวณจาก 15.142°N 102.134°E)
let r = await go('/floodfreq/14/12840/7494.png');
assert.equal(r.status, 200); assert.equal(r.headers.get('X-Cache'), 'MISS');
assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://sarochiiii.github.io');
assert.equal(seen.at(-1).u, 'https://up.example/t/14/12840/7494'); assert.equal(seen.at(-1).key, 'k-test');
await Promise.all(waits);
r = await go('/floodfreq/14/12840/7494.png'); assert.equal(r.status, 200); assert.equal(r.headers.get('X-Cache'), 'HIT');
assert.equal(seen.length, 1, 'HIT ต้องไม่เรียก upstream');
// SWAP_XY
r = await go('/floodfreq/14/12841/7494.png', { ...env, SWAP_XY: 'true' }); assert.equal(seen.at(-1).u, 'https://up.example/t/14/7494/12841');
// TMS_Y: y_tms = 2^14 − 1 − 7494 = 8889 · รวมกับ SWAP_XY
r = await go('/floodfreq/14/12842/7494.png', { ...env, TMS_Y: 'true' }); assert.equal(seen.at(-1).u, 'https://up.example/t/14/12842/8889');
r = await go('/floodfreq/14/12843/7494.png', { ...env, TMS_Y: 'true', SWAP_XY: 'true' }); assert.equal(seen.at(-1).u, 'https://up.example/t/14/8889/12843');
// นอก bbox → 204 · zoom เกิน → 400 · path ผิด → 404 · ไม่ตั้งค่า → 500 · method → 405 · OPTIONS → 204
assert.equal((await go('/floodfreq/14/0/0.png')).status, 204);
assert.equal((await go('/floodfreq/18/205440/119904.png')).status, 400);
assert.equal((await go('/floodfreq/7/100/60.png')).status, 400);
assert.equal((await go('/other/14/12840/7494.png')).status, 404);
r = await go('/floodfreq/14/12840/7495.png', { ALLOWED_ORIGIN: env.ALLOWED_ORIGIN }); assert.equal(r.status, 500); assert.equal(await r.text(), 'not_configured');
assert.equal((await go('/floodfreq/14/12840/7494.png', env, 'POST')).status, 405);
assert.equal((await go('/floodfreq/14/12840/7494.png', env, 'OPTIONS')).status, 204);
// upstream ไม่ใช่ภาพ → 502 ไม่ส่งข้อความต่อ
globalThis.fetch = async () => new Response('{"error":"bad key k-test"}', { status: 401, headers: { 'Content-Type': 'application/json' } });
r = await go('/floodfreq/14/12839/7494.png'); assert.equal(r.status, 502); assert.ok(!(await r.text()).includes('k-test'));
console.log('gistda_tile_proxy: ผ่านทุกกรณี');
