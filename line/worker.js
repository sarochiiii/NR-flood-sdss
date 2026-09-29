/**
 * line-hub — Cloudflare Worker สำหรับ LINE OA "เฝ้าระวังน้ำ โนนไทย–โนนสูง" (ระยะ P1)
 *
 *  POST /webhook        รับเหตุการณ์จาก LINE (ตรวจลายเซ็น x-line-signature)
 *  POST /api/register   ลงทะเบียนตำบล/บทบาทจาก LIFF (ตรวจ ID token กับ LINE)
 *  POST /api/me         ดูข้อมูลที่ลงทะเบียน · POST /api/unregister ลบข้อมูล
 *  scheduled (cron)     สรุปประจำวัน D1 ให้ ADM ทุกตำบล (ตั้ง cron 0 0 * * * = 07:00 น.)
 *
 * ข้อมูลสถานการณ์อ่านจากเว็บสาธารณะ (GitHub Pages) — Worker ไม่เก็บข้อมูลน้ำเอง
 * ข้อมูลผู้ใช้ (userId, ตำบล, บทบาท) อยู่ใน D1 เท่านั้น
 *
 * ตัวแปร (Settings → Variables and Secrets)
 *   LINE_CHANNEL_SECRET, LINE_CHANNEL_TOKEN   (Secret · Messaging API channel)
 *   LINE_LOGIN_CHANNEL_ID                     (Text · LINE Login channel ที่มี LIFF)
 *   LIFF_ID                                   (Text · เช่น 2000000000-AbCdEfGh)
 *   DATA_BASE     (Text · ไม่ใส่ = https://sarochiiii.github.io/NR-flood-sdss/region/)
 *   ALLOWED_ORIGIN (Text · ไม่ใส่ = https://sarochiiii.github.io)
 *   ADMIN_KEY     (Secret · ใช้เรียก POST /admin/daily เพื่อทดสอบสรุปประจำวัน)
 * Binding: D1 database ชื่อ DB
 */

// ---------- ข้อมูลคงที่ที่ทีมต้องเติม (ห้ามเดา) ----------
const EMERGENCY = [
  ['สายด่วนนิรภัย ปภ.', '1784'],
  ['เจ็บป่วยฉุกเฉิน', '1669'],
  ['เหตุด่วนเหตุร้าย', '191'],
  // ['อบต.จันอัด', '0xx-xxx-xxxx'],   ← ทีมเติมเบอร์ อบต./อำเภอ ที่ยืนยันแล้ว
];
const SHELTERS = [
  // ['ต.จันอัด', 'ชื่อศูนย์พักพิง', 'หมู่ที่']   ← ทีมเติมจากแผนของ อบต./อำเภอ
];
const DISCLAIMER = 'ข้อมูลเพื่อเฝ้าระวัง ไม่ใช่ประกาศเตือนภัยทางการ ติดตามประกาศจาก ปภ. อำเภอ และ อบต.';
const TZ = 'Asia/Bangkok';

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const origin = env.ALLOWED_ORIGIN || 'https://sarochiiii.github.io';
    const cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (req.method === 'GET' && url.pathname === '/api/reports') return Response.json(await publicReports(env), { headers: Object.assign({ 'Cache-Control': 'public, max-age=120' }, cors) });
    if (req.method === 'GET' && url.pathname === '/api/help/summary') return Response.json(await helpSummary(env), { headers: Object.assign({ 'Cache-Control': 'public, max-age=120' }, cors) });
    try {
      if (url.pathname === '/webhook' && req.method === 'POST') return await webhook(req, env, ctx);
      if (url.pathname === '/admin/daily' && req.method === 'POST') {          // ทดสอบส่งสรุปประจำวันทันที
        if (!env.ADMIN_KEY || req.headers.get('x-admin-key') !== env.ADMIN_KEY) return new Response('forbidden', { status: 403 });
        await dailySummary(env);
        return new Response('sent');
      }
      if (url.pathname.startsWith('/api/') && req.method === 'POST') {
        const res = await api(url.pathname, await req.json(), env);
        return Response.json(res.body, { status: res.status, headers: cors });
      }
      return new Response('line-hub ok');
    } catch (e) {
      console.error('fetch error', e && e.stack || e);
      return new Response('error', { status: 500, headers: cors });
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(Promise.all([dailySummary(env), cleanup(env)]));
  }
};

// ---------- webhook ----------
async function webhook(req, env, ctx) {
  const body = await req.text();
  if (!await verifySignature(body, req.headers.get('x-line-signature'), env.LINE_CHANNEL_SECRET)) {
    return new Response('bad signature', { status: 401 });
  }
  const { events = [] } = JSON.parse(body);
  ctx.waitUntil(Promise.all(events.map(ev => handleEvent(ev, env).catch(e => console.error('event', e && e.stack || e)))));
  return new Response('OK');   // ตอบ LINE ทันที ประมวลผลต่อเบื้องหลัง
}

export async function verifySignature(body, sig, secret) {
  if (!sig || !secret) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  const b64 = btoa(String.fromCharCode(...mac));
  if (b64.length !== sig.length) return false;
  let d = 0; for (let i = 0; i < b64.length; i++) d |= b64.charCodeAt(i) ^ sig.charCodeAt(i);
  return d === 0;
}

async function handleEvent(ev, env) {
  const uid = ev.source && ev.source.userId;
  if (ev.type === 'unfollow' && uid) {                       // เลิกติดตาม → ลบข้อมูลทันที
    await env.DB.prepare('DELETE FROM users WHERE user_id = ?').bind(uid).run();
    return;
  }
  if (!ev.replyToken) return;
  const liff = `https://liff.line.me/${env.LIFF_ID}`;
  if (ev.type === 'follow') {
    return reply(env, ev.replyToken, [welcome(liff)]);
  }
  if (ev.type === 'message' && ev.message.type === 'location') {   // ส่งตำแหน่ง → สถานการณ์ตำบลนั้น (ไม่ต้องลงทะเบียน)
    const data = await loadData(env);
    const t = tambonAt(data, ev.message.latitude, ev.message.longitude);
    if (!t) return reply(env, ev.replyToken, [text('ตำแหน่งนี้อยู่นอกพื้นที่ อ.โนนไทย–โนนสูง ระบบยังไม่มีข้อมูลรายตำบลสำหรับพื้นที่นี้')]);
    return reply(env, ev.replyToken, [statusFlex(data, t.tcode, env, 'ตามตำแหน่งที่ส่งมา')]);
  }
  if (ev.type === 'message' && ev.message.type === 'text') {
    const m = ev.message.text.trim();
    if (/สถานการณ์|ตำบลฉัน|ระดับน้ำ/.test(m)) {
      const u = uid && await env.DB.prepare('SELECT tcode FROM users WHERE user_id = ?').bind(uid).first();
      if (!u) return reply(env, ev.replyToken, [needRegister(liff)]);
      const data = await loadData(env);
      return reply(env, ev.replyToken, [statusFlex(data, u.tcode, env)]);
    }
    if (/เบอร์|ฉุกเฉิน|โทร/.test(m)) return reply(env, ev.replyToken, [text(emergencyText())]);
    if (/พักพิง|อพยพ/.test(m)) return reply(env, ev.replyToken, [text(shelterText())]);
    if (/ประกาศ/.test(m)) return reply(env, ev.replyToken, [text('ยังไม่มีประกาศจากหน่วยงานในระบบนี้\nประกาศทางการติดตามได้จาก ปภ. (สายด่วน 1784) ที่ว่าการอำเภอ และ อบต. ในพื้นที่\n\n' + DISCLAIMER)]);
    if (/ลงทะเบียน|ตั้งค่า|เปลี่ยนตำบล/.test(m)) return reply(env, ev.replyToken, [needRegister(liff, true)]);
    return reply(env, ev.replyToken, [text('กดเมนูด้านล่างเพื่อดูสถานการณ์น้ำ เบอร์ฉุกเฉิน หรือศูนย์พักพิง\nหรือส่ง "ตำแหน่ง" (Location) เพื่อดูสถานการณ์ของตำบล ณ จุดนั้น')]);
  }
}

// ---------- API สำหรับ LIFF ----------
async function api(path, b, env) {
  const uid = await verifyIdToken(b.idToken, env);
  if (!uid) return { status: 401, body: { error: 'ยืนยันตัวตนไม่สำเร็จ กรุณาเปิดจากแอป LINE อีกครั้ง' } };
  const now = new Date().toISOString();
  if (path === '/api/me') {
    const u = await env.DB.prepare('SELECT tcode, role, consent_at FROM users WHERE user_id = ?').bind(uid).first();
    return { status: 200, body: { user: u || null } };
  }
  if (path === '/api/unregister') {
    await env.DB.prepare('DELETE FROM users WHERE user_id = ?').bind(uid).run();
    return { status: 200, body: { ok: true } };
  }
  if (path.startsWith('/api/report') || path.startsWith('/api/help') || path.startsWith('/api/staff')) return reportApi(path, b, uid, env, now);
  if (path === '/api/register') {
    if (!b.consent) return { status: 400, body: { error: 'ต้องยินยอมก่อนลงทะเบียน' } };
    if (!/^30(09|10)\d{2}$/.test(String(b.tcode || ''))) return { status: 400, body: { error: 'ตำบลไม่ถูกต้อง' } };
    let role = 'public', tcode = String(b.tcode);
    const prev = await env.DB.prepare('SELECT role FROM users WHERE user_id = ?').bind(uid).first();
    if (prev && prev.role !== 'public') role = prev.role;               // เปลี่ยนตำบลไม่ทำให้เสียบทบาท
    if (b.invite) {
      const inv = await env.DB.prepare('SELECT * FROM invites WHERE code = ?').bind(String(b.invite).trim().toUpperCase()).first();
      if (!inv || (inv.used_by && inv.used_by !== uid)) return { status: 400, body: { error: 'รหัสเชิญไม่ถูกต้องหรือถูกใช้แล้ว' } };
      role = inv.role; if (inv.tcode) tcode = inv.tcode;
      await env.DB.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE code = ?').bind(uid, now, inv.code).run();
    }
    await env.DB.prepare(`INSERT INTO users (user_id, tcode, role, consent_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET tcode = excluded.tcode, role = excluded.role, consent_at = excluded.consent_at, updated_at = excluded.updated_at`)
      .bind(uid, tcode, role, now, now, now).run();
    return { status: 200, body: { ok: true, tcode, role } };
  }
  return { status: 404, body: { error: 'not found' } };
}

async function verifyIdToken(idToken, env) {
  if (!idToken || !env.LINE_LOGIN_CHANNEL_ID) return null;
  const r = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: env.LINE_LOGIN_CHANNEL_ID })
  });
  if (!r.ok) return null;
  const j = await r.json();
  return j.sub || null;
}

// ---------- สรุปประจำวัน (D1) ----------
export async function dailySummary(env) {
  const data = await loadData(env);
  const rows = (await env.DB.prepare("SELECT user_id, tcode FROM users WHERE role IN ('adm','staff')").all()).results || [];
  const byT = {};
  rows.forEach(r => (byT[r.tcode] = byT[r.tcode] || []).push(r.user_id));
  for (const [tcode, ids] of Object.entries(byT)) {
    const msg = statusFlex(data, tcode, env, 'สรุปประจำวัน 07:00');
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const ok = await push(env, chunk, [msg]);
      await env.DB.prepare('INSERT INTO send_log (kind, tcode, n, ok, sent_at) VALUES (?, ?, ?, ?, ?)')
        .bind('D1', tcode, chunk.length, ok ? 1 : 0, new Date().toISOString()).run();
    }
  }
}

// ---------- อ่านข้อมูลสาธารณะจากเว็บ ----------
export async function loadData(env) {
  const base = env.DATA_BASE || 'https://sarochiiii.github.io/NR-flood-sdss/region/';
  const get = (p) => fetch(base + p, { cf: { cacheTtl: 300 } }).then(r => r.ok ? r.json() : null).catch(() => null);
  const [cfg, tambon, rain, tw, prov, flood] = await Promise.all([
    get('config.json'), get('data/tambon.geojson'), get('data/live/rain_region.json'),
    get('data/live/thaiwater_region.json'), get('data/live/tw_province.json'), get('data/live/gistda_flood_7d.geojson')]);
  return { cfg, tambon, rain, tw, prov, flood };
}

function tambonAt(data, la, lo) {
  const inRing = (x, y, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  for (const f of (data.tambon && data.tambon.features) || []) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    if (polys.some(p => inRing(lo, la, p[0]) && !p.slice(1).some(h => inRing(lo, la, h)))) return f.properties;
  }
  return null;
}

const km = (a, b, c, d) => { const r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
const f1 = (v, d = 1) => v == null || Number.isNaN(+v) ? '—' : Number(v).toFixed(d);
const thTime = (iso) => { try { return new Date(iso).toLocaleString('th-TH', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return '—'; } };
const stTime = (s) => s ? String(s).slice(5, 16).replace(/^(\d\d)-(\d\d) /, (m, mo, d) => `${+d}/${+mo} `) : '—';

function bankStatus(cfg, pct) {
  const lv = cfg && cfg.bank && cfg.bank.levels;
  if (pct == null || !lv) return { label: 'ไม่มีข้อมูล', color: '#94A3B8', key: 'na' };
  return lv.find(l => pct >= l.min);
}

// ---------- ข้อความ ----------
export function statusFlex(data, tcode, env, subtitle) {
  const cfg = data.cfg || {};
  const t = ((data.tambon && data.tambon.features) || []).map(f => f.properties).find(p => p.tcode === tcode);
  if (!t) return text('ไม่พบข้อมูลตำบลที่ลงทะเบียน กรุณาลงทะเบียนใหม่');
  const r = ((data.rain && data.rain.tambon) || []).find(x => x.tcode === tcode);
  const wl = ((data.tw && data.tw.waterlevel) || []).filter(s => s.storage_pct != null)
    .map(s => ({ s, d: km(t.lat, t.lon, s.lat, s.lon) })).sort((a, b) => a.d - b.d)[0];
  const lck = ((data.tw && data.tw.waterlevel) || []).find(s => s.code === 'M.188A');
  const up = ((data.prov && data.prov.dams) || []).find(d => d.name === 'อ่างเก็บน้ำลำเชียงไกรตอนบน' && !d.stale);
  const fl = data.flood && data.flood.status === 'ok' ? Math.round((data.flood.by_tambon || {})[tcode] || 0) : null;
  const st = wl ? bankStatus(cfg, wl.s.storage_pct) : { label: 'ไม่มีข้อมูล', color: '#94A3B8' };
  const heavy = r && Math.max(r.rain_24h_mm, r.rain_next24h_mm) >= ((cfg.rain && cfg.rain.tmd_24h_mm && cfg.rain.tmd_24h_mm.heavy) || 35.1);
  const row = (k, v, col) => ({ type: 'box', layout: 'horizontal', spacing: 'sm', contents: [
    { type: 'text', text: k, size: 'sm', color: '#64748B', flex: 5, wrap: true },
    { type: 'text', text: v, size: 'sm', color: col || '#0F172A', flex: 6, wrap: true, align: 'end' }] });
  const body = [
    { type: 'text', text: 'ฝน (แบบจำลอง Open-Meteo)', size: 'xs', color: '#64748B', weight: 'bold' },
    row('24 ชม. ที่ผ่านมา', r ? `${f1(r.rain_24h_mm)} มม.` : '—'),
    row('คาดการณ์ 24 ชม.', r ? `${f1(r.rain_next24h_mm)} มม.` : '—', heavy ? '#B91C1C' : null),
    row('สะสม 7 วัน', r ? `${f1(r.rain_7d_mm, 0)} มม.` : '—'),
    { type: 'separator', margin: 'md' },
    { type: 'text', text: 'ระดับน้ำ (สสน. ThaiWater)', size: 'xs', color: '#64748B', weight: 'bold', margin: 'md' },
    row('สถานีใกล้สุด', wl ? `${wl.s.name} (${f1(wl.d, 0)} กม.)` : '—'),
    row('เทียบตลิ่ง', wl ? `${f1(wl.s.storage_pct, 0)}% · ${st.label}` : '—', st.color === '#F4D03F' ? '#A16207' : st.color),
    row('ลำเชียงไกร M.188A', lck && lck.storage_pct != null ? `${f1(lck.storage_pct, 0)}% · ${bankStatus(cfg, lck.storage_pct).label}` : '—'),
    row('อ่างลำเชียงไกรตอนบน', up ? `${f1(up.pct, 0)}%${up.pct >= 100 ? ' เกินความจุ' : ''}` : '—', up && up.pct >= 100 ? '#B91C1C' : null),
    row('น้ำท่วมตรวจพบ 7 วัน', fl == null ? '—' : `${fl.toLocaleString('th-TH')} ไร่ (GISTDA)`),
    { type: 'text', text: `ฝน ณ ${r ? thTime(data.rain.updated_at) : '—'} · ระดับน้ำ ณ ${wl ? stTime(wl.s.measured_at) : '—'}`, size: 'xxs', color: '#94A3B8', margin: 'md', wrap: true }
  ];
  const web = (env.DATA_BASE || 'https://sarochiiii.github.io/NR-flood-sdss/region/') + `#t=${tcode}`;
  return {
    type: 'flex',
    altText: `สถานการณ์น้ำ ต.${t.name}: สถานีใกล้สุด ${wl ? f1(wl.s.storage_pct, 0) + '% ' + st.label : 'ไม่มีข้อมูล'}${heavy ? ' · คาดฝนหนัก' : ''}`,
    contents: { type: 'bubble',
      header: { type: 'box', layout: 'vertical', backgroundColor: st.color, paddingAll: '14px', contents: [
        { type: 'text', text: subtitle || 'สถานการณ์น้ำตอนนี้', size: 'xs', color: '#FFFFFF' },
        { type: 'text', text: `ต.${t.name} อ.${t.amphoe}`, size: 'lg', weight: 'bold', color: '#FFFFFF', wrap: true }] },
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: body },
      footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
        { type: 'button', style: 'link', height: 'sm', action: { type: 'uri', label: 'ดูแผนที่', uri: web } },
        { type: 'text', text: DISCLAIMER, size: 'xxs', color: '#94A3B8', wrap: true }] } }
  };
}

const text = (t) => ({ type: 'text', text: t });
function welcome(liff) {
  return { type: 'flex', altText: 'ยินดีต้อนรับ · ลงทะเบียนตำบลเพื่อรับข้อมูลน้ำ',
    contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', spacing: 'md', contents: [
      { type: 'text', text: 'เฝ้าระวังน้ำ โนนไทย–โนนสูง', weight: 'bold', size: 'lg', wrap: true },
      { type: 'text', text: 'ข้อมูลฝน ระดับน้ำ อ่างเก็บน้ำ และน้ำท่วมจากดาวเทียม รวมจากหลายหน่วยงาน โดยโครงการวิจัย มรภ.นครราชสีมา', size: 'sm', wrap: true, color: '#475569' },
      { type: 'text', text: 'ลงทะเบียนตำบลของท่านเพื่อดูสถานการณ์ของพื้นที่ตนเองจากเมนูด้านล่าง', size: 'sm', wrap: true },
      { type: 'text', text: DISCLAIMER, size: 'xxs', color: '#94A3B8', wrap: true }] },
      footer: { type: 'box', layout: 'vertical', contents: [
        { type: 'button', style: 'primary', color: '#0E7C7B', action: { type: 'uri', label: 'ลงทะเบียนตำบล', uri: liff } }] } } };
}
function needRegister(liff, change) {
  return { type: 'template', altText: 'ลงทะเบียนตำบล', template: { type: 'buttons',
    text: change ? 'ตั้งค่าหรือเปลี่ยนตำบลของท่าน' : 'ยังไม่ได้ลงทะเบียนตำบล กรุณาลงทะเบียนก่อน หรือส่ง "ตำแหน่ง" เพื่อดูสถานการณ์ ณ จุดนั้น',
    actions: [{ type: 'uri', label: 'ลงทะเบียน/ตั้งค่า', uri: liff }] } };
}
const emergencyText = () => 'เบอร์ฉุกเฉิน\n' + EMERGENCY.map(([n, t]) => `• ${n} ${t}`).join('\n');
const shelterText = () => SHELTERS.length
  ? 'ศูนย์พักพิง\n' + SHELTERS.map(([t, n, m]) => `• ${t}: ${n} ${m || ''}`).join('\n')
  : 'ยังไม่มีข้อมูลศูนย์พักพิงในระบบ กรุณาสอบถาม อบต. ในพื้นที่ หรือสายด่วน ปภ. 1784';

// ---------- LINE API ----------
async function reply(env, token, messages) {
  const r = await fetch('https://api.line.me/v2/bot/message/reply', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.LINE_CHANNEL_TOKEN}` },
    body: JSON.stringify({ replyToken: token, messages }) });
  if (!r.ok) console.error('reply', r.status, (await r.text()).slice(0, 300));
}
async function push(env, to, messages) {
  const r = await fetch('https://api.line.me/v2/bot/message/multicast', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.LINE_CHANNEL_TOKEN}` },
    body: JSON.stringify({ to, messages }) });
  if (!r.ok) console.error('multicast', r.status, (await r.text()).slice(0, 300));
  return r.ok;
}

// ======================= รายงานสถานการณ์ · ขอความช่วยเหลือ =======================
const CATS = ['flood', 'road', 'power', 'landslide', 'tree', 'building', 'other'];
const DEPTHS = ['ankle', 'knee', 'waist', 'chest', 'over'];
const KINDS = ['evac', 'patient', 'food', 'medicine', 'other'];
const KIND_TH = { evac: 'อพยพ/ติดค้าง', patient: 'ผู้ป่วย/ผู้ติดเตียง', food: 'อาหาร/น้ำดื่ม', medicine: 'ยา', other: 'อื่น ๆ' };
const clean = (t, n) => String(t || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const okNum = (v) => Number.isFinite(+v);

async function reportApi(path, b, uid, env, now) {
  const me = await env.DB.prepare('SELECT tcode, role FROM users WHERE user_id = ?').bind(uid).first();
  if (!me) return { status: 403, body: { error: 'ต้องลงทะเบียนตำบลก่อน (เมนูลงทะเบียนใน LINE)' } };
  const staff = me.role === 'staff', adm = me.role === 'adm';

  if (path === '/api/report' || path === '/api/help') {
    if (!okNum(b.lat) || !okNum(b.lon)) return { status: 400, body: { error: 'ไม่มีตำแหน่ง' } };
    const data = await loadData(env), t = tambonAt(data, +b.lat, +b.lon);
    if (!t) return { status: 400, body: { error: 'ตำแหน่งอยู่นอกพื้นที่ อ.โนนไทย–โนนสูง' } };
    const lat = Math.round(+b.lat * 1e5) / 1e5, lon = Math.round(+b.lon * 1e5) / 1e5;
    if (path === '/api/report') {
      if (!b.consent) return { status: 400, body: { error: 'ต้องยอมรับเงื่อนไขการเผยแพร่' } };
      const cats = [].concat(b.cats || []).filter(c => CATS.includes(c));
      if (!cats.length) return { status: 400, body: { error: 'เลือกหมวดอย่างน้อย 1 หมวด' } };
      const n = await env.DB.prepare("SELECT COUNT(*) c FROM reports WHERE user_id = ? AND created_at > ?").bind(uid, new Date(Date.now() - 3600e3).toISOString()).first();
      if (n.c >= 10) return { status: 429, body: { error: 'ส่งรายงานเกิน 10 ครั้งใน 1 ชั่วโมง' } };
      const depth = DEPTHS.includes(b.depth) ? b.depth : null;
      const r = await env.DB.prepare('INSERT INTO reports (user_id, tcode, lat, lon, cats, depth, note, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(uid, t.tcode, lat, lon, cats.join(','), depth, clean(b.note, 500), 'unverified', now, now).run();
      return { status: 200, body: { ok: true, id: r.meta && r.meta.last_row_id, tambon: t.name } };
    }
    // /api/help
    if (!b.consent) return { status: 400, body: { error: 'ต้องยินยอมให้ส่งข้อมูลถึงผู้ช่วยเหลือ' } };
    const kinds = [].concat(b.kind || []).filter(k => KINDS.includes(k));
    if (!kinds.length) return { status: 400, body: { error: 'เลือกประเภทความช่วยเหลือ' } };
    const phone = clean(b.phone, 20).replace(/[^\d+]/g, '');
    if (phone.length < 9) return { status: 400, body: { error: 'ใส่เบอร์ติดต่อกลับ' } };
    const n = await env.DB.prepare("SELECT COUNT(*) c FROM help_requests WHERE user_id = ? AND created_at > ?").bind(uid, new Date(Date.now() - 3600e3).toISOString()).first();
    if (n.c >= 3) return { status: 429, body: { error: 'ส่งคำขอเกิน 3 ครั้งใน 1 ชั่วโมง — โปรดโทร 1784 หรือ 1669' } };
    const ref = 'H-' + Array.from(crypto.getRandomValues(new Uint8Array(5)), x => 'ACDEFGHJKLMNPQRTUVWXY3479'[x % 25]).join('');
    const people = Math.max(0, Math.min(999, parseInt(b.people, 10) || 0)), vul = b.vulnerable ? 1 : 0, note = clean(b.note, 500);
    await env.DB.prepare('INSERT INTO help_requests (ref, user_id, tcode, lat, lon, kind, people, vulnerable, phone, note, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(ref, uid, t.tcode, lat, lon, kinds.join(','), people, vul, phone, note, 'new', now, now).run();
    // แจ้ง ADM ของตำบลนั้นและเจ้าหน้าที่ทั้งหมด (ต้องมี LINE OA · ไม่รวมผู้ขอเอง)
    const rows = (await env.DB.prepare("SELECT user_id FROM users WHERE (role = 'adm' AND tcode = ?) OR role = 'staff'").bind(t.tcode).all()).results || [];
    const to = [...new Set(rows.map(r => r.user_id))].filter(x => x !== uid);
    if (to.length) {
      const staffUrl = `https://liff.line.me/${env.LIFF_ID}/staff.html`;
      const msg = { type: 'text', text: `🆘 คำขอความช่วยเหลือ ${ref}\nต.${t.name} อ.${t.amphoe}\nประเภท: ${kinds.map(k => KIND_TH[k]).join(', ')}\nจำนวน ${people || '—'} คน${vul ? ' · มีผู้ป่วย/ผู้สูงอายุ/ผู้พิการ' : ''}\nโทร ${phone}\nตำแหน่ง: https://maps.google.com/?q=${lat},${lon}\n${note ? 'รายละเอียด: ' + note + '\n' : ''}จัดการ: ${staffUrl}\n(ข้อมูลส่วนบุคคล ใช้เพื่อช่วยเหลือเท่านั้น ห้ามส่งต่อ)` };
      for (let i = 0; i < to.length; i += 500) {
        const ok = await push(env, to.slice(i, i + 500), [msg]);
        await env.DB.prepare('INSERT INTO send_log (kind, tcode, n, ok, sent_at) VALUES (?, ?, ?, ?, ?)').bind('HELP', t.tcode, Math.min(500, to.length - i), ok ? 1 : 0, now).run();
      }
    }
    return { status: 200, body: { ok: true, ref, tambon: t.name, notified: to.length } };
  }

  if (path === '/api/help/mine') {       // ผู้ขอดูสถานะของตัวเอง
    const rows = (await env.DB.prepare('SELECT ref, tcode, kind, status, created_at, updated_at FROM help_requests WHERE user_id = ? ORDER BY id DESC LIMIT 10').bind(uid).all()).results || [];
    return { status: 200, body: { items: rows } };
  }

  // ---------- เจ้าหน้าที่ (staff ทุกตำบล · adm เฉพาะตำบลของตน) ----------
  if (!staff && !adm) return { status: 403, body: { error: 'เฉพาะ ADM และเจ้าหน้าที่' } };
  const scope = staff ? '' : ' AND tcode = ?';
  const bindScope = (st, ...a) => staff ? st.bind(...a) : st.bind(...a, me.tcode);
  if (path === '/api/staff/help') {
    const rows = (await bindScope(env.DB.prepare(`SELECT id, ref, tcode, lat, lon, kind, people, vulnerable, phone, note, status, handled_by, created_at, updated_at FROM help_requests WHERE created_at > ?${scope} ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, id DESC LIMIT 200`),
      new Date(Date.now() - 30 * 864e5).toISOString()).all()).results || [];
    return { status: 200, body: { role: me.role, items: rows } };
  }
  if (path === '/api/staff/help/update') {
    if (!['new', 'in_progress', 'done'].includes(b.status)) return { status: 400, body: { error: 'สถานะไม่ถูกต้อง' } };
    const r = await bindScope(env.DB.prepare(`UPDATE help_requests SET status = ?, handled_by = ?, updated_at = ? WHERE id = ?${scope}`), b.status, uid.slice(-6), now, +b.id).run();
    return { status: 200, body: { ok: (r.meta && r.meta.changes) > 0 } };
  }
  if (path === '/api/staff/reports') {
    const rows = (await bindScope(env.DB.prepare(`SELECT id, tcode, lat, lon, cats, depth, note, status, created_at FROM reports WHERE created_at > ?${scope} ORDER BY id DESC LIMIT 300`),
      new Date(Date.now() - 30 * 864e5).toISOString()).all()).results || [];
    return { status: 200, body: { role: me.role, items: rows } };
  }
  if (path === '/api/staff/report/update') {
    if (!['unverified', 'verified', 'hidden'].includes(b.status)) return { status: 400, body: { error: 'สถานะไม่ถูกต้อง' } };
    const r = await bindScope(env.DB.prepare(`UPDATE reports SET status = ?, checked_by = ?, updated_at = ? WHERE id = ?${scope}`), b.status, uid.slice(-6), now, +b.id).run();
    return { status: 200, body: { ok: (r.meta && r.meta.changes) > 0 } };
  }
  return { status: 404, body: { error: 'not found' } };
}

export async function publicReports(env) {   // 30 วัน · ไม่มีรหัสผู้ใช้
  const rows = (await env.DB.prepare("SELECT id, tcode, lat, lon, cats, depth, note, status, created_at FROM reports WHERE status != 'hidden' AND created_at > ? ORDER BY id DESC LIMIT 1000")
    .bind(new Date(Date.now() - 30 * 864e5).toISOString()).all()).results || [];
  return { updated_at: new Date().toISOString(), items: rows.map(r => Object.assign(r, { cats: r.cats.split(',') })) };
}
export async function helpSummary(env) {     // จำนวนคำขอที่ยังเปิดอยู่รายตำบล (7 วัน) · ไม่มีรายละเอียด
  const rows = (await env.DB.prepare("SELECT tcode, COUNT(*) n FROM help_requests WHERE status != 'done' AND created_at > ? GROUP BY tcode")
    .bind(new Date(Date.now() - 7 * 864e5).toISOString()).all()).results || [];
  return { updated_at: new Date().toISOString(), by_tambon: Object.fromEntries(rows.map(r => [r.tcode, r.n])) };
}
async function cleanup(env) {                // เก็บข้อมูลเท่าที่จำเป็น
  const d30 = new Date(Date.now() - 30 * 864e5).toISOString(), d90 = new Date(Date.now() - 90 * 864e5).toISOString();
  await env.DB.prepare('DELETE FROM reports WHERE created_at < ?').bind(d30).run();
  await env.DB.prepare("UPDATE help_requests SET phone = NULL, note = NULL WHERE status = 'done' AND updated_at < ?").bind(d90).run();
}
