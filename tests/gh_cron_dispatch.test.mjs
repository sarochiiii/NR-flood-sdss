// Worker gh-cron-dispatch: cron → POST workflow_dispatch ไปที่ GitHub · หน้า GET ไม่สั่งรันและไม่แสดง token
//   node --no-warnings tests/gh_cron_dispatch.test.mjs
import assert from 'node:assert/strict';
const calls = [];
globalThis.fetch = async (u, o = {}) => { calls.push({ u: String(u), o }); return { status: 204, text: async () => '' }; };
const { default: w } = await import('../workers/gh-cron-dispatch.js');
const waits = []; const ctx = { waitUntil: p => waits.push(p) };

// ไม่มี token → ไม่เรียก GitHub
await w.scheduled({ cron: '15 * * * *' }, {}, ctx); await Promise.all(waits);
assert.equal(calls.length, 0);

// มี token → POST dispatches ของ region-live.yml บน main
await w.scheduled({ cron: '15 * * * *' }, { GH_TOKEN: 'tok123' }, ctx); await Promise.all(waits);
assert.equal(calls.length, 1);
assert.equal(calls[0].u, 'https://api.github.com/repos/sarochiiii/NR-flood-sdss/actions/workflows/region-live.yml/dispatches');
assert.equal(calls[0].o.method, 'POST');
assert.equal(calls[0].o.headers.Authorization, 'Bearer tok123');
assert.ok(calls[0].o.headers['User-Agent']);
assert.deepEqual(JSON.parse(calls[0].o.body), { ref: 'main' });

// ตั้ง REPO/WORKFLOW เองได้
await w.scheduled({}, { GH_TOKEN: 't', REPO: 'a/b', WORKFLOW: 'x.yml' }, ctx); await Promise.all(waits);
assert.equal(calls.at(-1).u, 'https://api.github.com/repos/a/b/actions/workflows/x.yml/dispatches');

// หน้า GET: ไม่สั่งรัน · ไม่แสดง token
const n = calls.length;
const r = await w.fetch(new Request('https://x/'), { GH_TOKEN: 'secret-xyz' });
const t = await r.text();
assert.equal(calls.length, n); assert.ok(!t.includes('secret-xyz')); assert.ok(JSON.parse(t).token_set);
console.log('gh_cron_dispatch: ผ่านทุกกรณี');
