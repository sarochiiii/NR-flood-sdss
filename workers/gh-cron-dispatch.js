// gh-cron-dispatch · Cloudflare Worker (v1.0)
// สั่งรัน workflow region-live ของ GitHub ทุกชั่วโมงด้วย Cron Trigger ของ Cloudflare
// เหตุผล: schedule ของ GitHub Actions ไม่ตรงเวลา (ตรวจ 30 รอบ 5–9 ต.ค. 69: ห่างกันเฉลี่ย 3.9 ชม. นานสุด 8.8 ชม.)
//        schedule เดิมใน .github/workflows/region-live.yml ยังคงไว้เป็นสำรอง · concurrency group live-data กันรันซ้อน
// ตั้งค่าใน Cloudflare → Worker → Settings
//   GH_TOKEN  (Secret)  GitHub fine-grained token: เฉพาะ repo NR-flood-sdss · สิทธิ์ Actions = Read and write (อย่างอื่นไม่ต้อง)
//   REPO      (Text)    sarochiiii/NR-flood-sdss          (ไม่ตั้ง = ค่านี้)
//   WORKFLOW  (Text)    region-live.yml                   (ไม่ตั้ง = ค่านี้)
//   Triggers → Cron Triggers → 15 * * * *   (ทุกชั่วโมง นาทีที่ 15 · เวลา UTC)
// เปิด URL ของ Worker ในเบราว์เซอร์ = ดูว่าตั้งค่าครบหรือไม่ (ไม่สั่งรัน · ไม่แสดง token)

const DEF_REPO = 'sarochiiii/NR-flood-sdss', DEF_WF = 'region-live.yml';

/** @param {any} env */
async function dispatch(env) {
  const repo = env.REPO || DEF_REPO, wf = env.WORKFLOW || DEF_WF;
  if (!env.GH_TOKEN) return { ok: false, status: 0, detail: 'not_configured: ไม่มี GH_TOKEN' };
  const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${wf}/dispatches`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.GH_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'nr-flood-sdss-cron',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ ref: 'main' })
  });
  // 204 = สำเร็จ · ไม่ส่งข้อความตอบกลับของ GitHub ต่อทั้งก้อน (ตัดสั้น ไม่มี token อยู่แล้ว)
  return { ok: r.status === 204, status: r.status, detail: r.status === 204 ? 'dispatched' : (await r.text()).slice(0, 200) };
}

export default {
  /** @param {any} event @param {any} env @param {any} ctx */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(dispatch(env).then(res => {
      if (res.ok) console.log('region-live dispatched', event.cron);
      else console.error('dispatch failed', res.status, res.detail);
    }));
  },
  /** @param {Request} req @param {any} env */
  async fetch(req, env) {
    // หน้าสถานะ: ไม่สั่งรัน (กันคนภายนอกกดเรียกถี่ ๆ) · บอกเฉพาะว่าตั้งค่าครบหรือไม่
    const body = { worker: 'gh-cron-dispatch v1.0', repo: env.REPO || DEF_REPO, workflow: env.WORKFLOW || DEF_WF,
      token_set: !!env.GH_TOKEN, note: 'สั่งรันผ่าน Cron Trigger เท่านั้น — ดูผลที่ GitHub → Actions → region-live (event: workflow_dispatch)' };
    return new Response(JSON.stringify(body, null, 2), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
};
