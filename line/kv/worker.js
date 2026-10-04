/**
 * LINE OA Webhook — จันอัดบ้านฉัน (Provider: NRRU-IDRM)
 * Cloudflare Worker · v4.4 (รายงานบนแผนที่เว็บ /api/reports · ปุ่มบนเว็บเปิดแชทพร้อมคำสั่ง · ทางลัดขอความช่วยเหลือ · ADM ต้องใช้รหัสเชิญ · ขอความยินยอม · ลบข้อมูลตามกำหนด · สถานการณ์น้ำจริง · สถิติผู้ใช้ · รายงานเข้ากลุ่ม LINE ของ ADM)
 * แก้จาก v3: เดิมใครก็พิมพ์ "ลงทะเบียน ADM" แล้วได้รับทุกรายงาน (รวมคำขอความช่วยเหลือ) → ปิดช่องโหว่นี้
 *
 * Bindings
 *   LINE_CHANNEL_SECRET  (Secret)
 *   LINE_CHANNEL_TOKEN   (Secret)
 *   USERS                (KV namespace → LINE_USERS)
 *   STATS_KEY            (Secret · ใหม่ v4.1 · ตั้งเอง ≥ 24 ตัวอักษร) ใช้เปิด /stats ดูสถิติผู้ใช้สำหรับรายงานความก้าวหน้า
 *   DAILY_GROUP_PUSH     (Text · ใหม่ v4.2) "on" = ส่งสรุปสถานการณ์น้ำเข้ากลุ่มที่เปิดไว้ทุกเช้า (ต้องตั้ง Cron 0 0 * * * = 07:00 น.)
 *                        ไม่ตั้ง/อื่น ๆ = ไม่ส่งอัตโนมัติ (กลุ่มยังพิมพ์ "สถานการณ์น้ำ" ขอดูเองได้ ไม่เสียโควตา)
 *
 * กลุ่ม LINE ของ ADM (v4.2)
 *   1) เชิญบัญชี OA เข้ากลุ่ม  2) ADM ที่ลงทะเบียนด้วยรหัสเชิญแล้ว พิมพ์ในกลุ่ม: เปิดรายงานประจำวัน
 *   คำสั่งในกลุ่ม: สถานการณ์น้ำ · เปิดรายงานประจำวัน · ปิดรายงานประจำวัน — ข้อความอื่นในกลุ่มระบบไม่อ่าน/ไม่เก็บ/ไม่ตอบ
 *   KV: group:<groupId> = { approved, daily, approved_by, joined }
 *
 * Key ที่ใช้ใน KV
 *   user:<userId>     สถานะผู้ใช้ {role, joined, active}
 *   index:adm         รายการ userId ของ ADM (ใช้ส่งแจ้งเตือน)
 *   session:<userId>  ขั้นตอนรายงานที่ค้างอยู่ (หมดอายุเอง 30 นาที)
 *   report:<id>       รายงานเหตุที่ยืนยันแล้ว (หมดอายุเอง 90 วัน)
 *   invite:<CODE>     รหัสเชิญ ADM ใช้ครั้งเดียว — สร้างใน Cloudflare: Workers KV → LINE_USERS → Add entry
 *                     key: invite:CHANAT-7K2Q   value: {"note":"ADM จันอัด ชุด 1"}   (ห้ามใส่ชื่อ/เบอร์โทร)
 *   index:adm2        รายชื่อ ADM ที่ยืนยันด้วยรหัสเชิญแล้ว (แทน index:adm เดิมที่ไม่ปลอดภัย)
 *
 * โควตา: ตอบกลับผู้ใช้ใช้ Reply API (ไม่นับโควตา)
 *        แจ้ง ADM ใช้ Multicast = นับ 1 ข้อความต่อ ADM 1 คน
 */

// ─── ค่าที่ต้องยืนยันก่อนใช้งานจริง ───────────────────────────────
const SITE_URL = 'https://sarochiiii.github.io/NR-flood-sdss/';
const ABT_PHONE = '';   // เบอร์ อบต.จันอัด ที่ยืนยันแล้ว เช่น '044xxxxxx' (ว่าง = ยังไม่ยืนยัน)
const VILLAGES = [];    // รายชื่อหมู่บ้านสำหรับปุ่มเลือก ไม่เกิน 12 รายการ (ว่าง = ให้พิมพ์เอง)
// ─────────────────────────────────────────────────────────────────

const DISCLAIMER =
  'ระบบนี้เป็นเครื่องมือสนับสนุนการตัดสินใจของโครงการวิจัย ' +
  'ไม่ใช่การประกาศเตือนภัยอย่างเป็นทางการ โปรดติดตามประกาศจาก ปภ. และ อบต.';
const EMERGENCY = 'กรณีฉุกเฉินต่อชีวิต โทร 1669 (การแพทย์ฉุกเฉิน) หรือ 1784 (ปภ.) ทันที';
const TYPES = ['น้ำท่วมบ้าน', 'ถนนน้ำท่วม/ขาด', 'ขอความช่วยเหลือ'];
const SESSION_TTL = 1800;
const REPORT_TTL = 90 * 86400;      // เก็บรายงานไว้ 90 วัน แล้ว KV ลบเอง
const PRIVACY =
  'การใช้ข้อมูล: ระบบเก็บรหัสผู้ใช้ LINE ประเภทผู้ใช้ และรายงานที่ท่านส่ง (ตำแหน่ง/หมู่บ้าน/รายละเอียด) ' +
  'เพื่อแจ้ง ADM และติดตามสถานการณ์เท่านั้น ไม่เผยแพร่ชื่อผู้รายงาน รายงานลบอัตโนมัติใน 90 วัน ' +
  'พิมพ์ "ลบข้อมูลของฉัน" หรือเลิกติดตามบัญชีเพื่อลบข้อมูลได้ทุกเมื่อ';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/stats') return stats(env, url);
    if (request.method === 'GET' && url.pathname === '/api/reports') return publicReports(env);
    if (request.method !== 'POST') return new Response('OK');

    const body = await request.text();
    const sig = request.headers.get('x-line-signature') || '';
    if (!(await verifySignature(body, sig, env.LINE_CHANNEL_SECRET))) {
      console.warn('signature mismatch');
      return new Response('Invalid signature', { status: 401 });
    }

    const { events = [] } = JSON.parse(body);
    for (const ev of events) {
      try {
        await handleEvent(ev, env);
      } catch (err) {
        console.error('event error', ev.type, err && err.message);
      }
    }
    return new Response('OK');
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(dailyGroupPush(env));
  },
};

// ─── Event router ────────────────────────────────────────────────
async function handleEvent(ev, env) {
  if (ev.source && (ev.source.type === 'group' || ev.source.type === 'room')) return handleGroup(ev, env);
  const userId = ev.source && ev.source.userId;
  if (!userId || ev.source.type !== 'user') return;

  if (ev.type === 'follow') {
    const user = await getUser(env, userId);
    await putUser(env, userId, {
      role: user ? user.role : null,
      joined: user ? user.joined : nowIso(),
      active: true,
    });
    return reply(ev, env, [askRole()]);
  }

  if (ev.type === 'unfollow') {
    await env.USERS.delete(`user:${userId}`);
    await env.USERS.delete(`session:${userId}`);
    await setAdmIndex(env, userId, false);
    return;
  }

  if (ev.type !== 'message') return;
  await touch(env, userId);

  if (ev.message.type === 'location') {
    const s = await getSession(env, userId);
    if (s && s.step === 'location') {
      s.lat = ev.message.latitude;
      s.lon = ev.message.longitude;
      s.address = ev.message.address || '';
      s.step = 'note';
      await putSession(env, userId, s);
      return reply(ev, env, [askNote()]);
    }
    return reply(ev, env, [text('ได้รับตำแหน่งแล้ว หากต้องการรายงานเหตุ กดเมนู "รายงานเหตุ" ก่อน')]);
  }

  if (ev.message.type === 'text') {
    return handleText(ev, env, userId, ev.message.text.trim());
  }
}

// ─── Text commands ───────────────────────────────────────────────
async function handleText(ev, env, userId, t) {
  // คำสั่งหลัก ใช้ได้ทุกเวลา
  if (t === 'ยกเลิก') {
    await env.USERS.delete(`session:${userId}`);
    return reply(ev, env, [text('ยกเลิกรายการแล้ว')]);
  }

  if (t === 'ลงทะเบียน ประชาชน') {
    const user = (await getUser(env, userId)) || { joined: nowIso() };
    await putUser(env, userId, { ...user, role: 'public', adm: false, active: true, consent: nowIso() });
    await setAdmIndex(env, userId, false);
    return reply(ev, env, [text(`ลงทะเบียนเป็นประชาชนเรียบร้อยแล้ว\n\n${PRIVACY}\n\n${DISCLAIMER}`)]);
  }

  if (t === 'ลงทะเบียน ADM') {      // ต้องมีรหัสเชิญจากทีมวิจัย
    await putSession(env, userId, { step: 'invite', started: nowIso() });
    return reply(ev, env, [{ type: 'text', text: 'ลงทะเบียน ADM\nพิมพ์รหัสเชิญที่ได้รับจากทีมวิจัย (เช่น CHANAT-7K2Q)\nหากยังไม่มีรหัส ให้ลงทะเบียนเป็นประชาชนก่อน',
      quickReply: { items: [qr('ประชาชน', 'ลงทะเบียน ประชาชน'), qr('ยกเลิก')] } }]);
  }

  if (t === 'ลบข้อมูลของฉัน') {
    await env.USERS.delete(`user:${userId}`);
    await env.USERS.delete(`session:${userId}`);
    await setAdmIndex(env, userId, false);
    return reply(ev, env, [text('ลบข้อมูลการลงทะเบียนของท่านแล้ว (รายงานที่ส่งไปแล้วจะหมดอายุเองภายใน 90 วัน)')]);
  }

  if (t === 'สถานการณ์น้ำ') {
    let msg;
    try { msg = await waterStatus(); } catch (e) { console.error('water', e && e.message); msg = 'ดึงข้อมูลสถานการณ์ไม่สำเร็จชั่วคราว'; }
    return reply(ev, env, [text(`${msg}\n\nดูแผนที่: ${SITE_URL}region/\n\n${DISCLAIMER}`)]);
  }

  if (t === 'ติดต่อ อบต.') {
    return reply(ev, env, [text(ABT_PHONE
      ? `อบต.จันอัด โทร ${ABT_PHONE}\n\n${EMERGENCY}`
      : `อยู่ระหว่างยืนยันเบอร์ติดต่อ อบต.จันอัด\n\n${EMERGENCY}`)]);
  }

  if (t === 'รายงานเหตุ') {
    const user = await getUser(env, userId);
    if (!user || !user.role) {
      return reply(ev, env, [
        text('กรุณาลงทะเบียนก่อนรายงานเหตุ'),
        askRole(),
      ]);
    }
    await putSession(env, userId, { step: 'type', started: nowIso() });
    return reply(ev, env, [askType()]);
  }

  // ทางลัด "ขอความช่วยเหลือ" (จากปุ่มบนเว็บ) → ข้ามขั้นเลือกประเภท · ถ้ากำลังอยู่ในขั้นตอนอื่น ให้ถือเป็นการตอบขั้นนั้น
  const s = await getSession(env, userId);
  if (t === 'ขอความช่วยเหลือ' && !s) {
    const user = await getUser(env, userId);
    if (!user || !user.role) return reply(ev, env, [text('กรุณาลงทะเบียนก่อนขอความช่วยเหลือ\nหากมีอันตรายต่อชีวิต โทร 1669 · 1784 · 191 ทันที'), askRole()]);
    await putSession(env, userId, { step: 'village', type: 'ขอความช่วยเหลือ', started: nowIso() });
    return reply(ev, env, [text('🆘 ขอความช่วยเหลือ\nหากมีอันตรายต่อชีวิต โทรทันที: 1669 (เจ็บป่วยฉุกเฉิน) · 1784 (ปภ.) · 191\nระบบนี้ส่งเรื่องถึง ADM ไม่ใช่ศูนย์สั่งการ'), askVillage()]);
  }
  if (s && s.step === 'invite') return handleInvite(ev, env, userId, t);
  if (s) return handleReportStep(ev, env, userId, s, t);

  return reply(ev, env, [text('กดปุ่มในเมนูด้านล่าง หรือพิมพ์ "สถานการณ์น้ำ" / "รายงานเหตุ"')]);
}

// ─── รหัสเชิญ ADM ─────────────────────────────────────────────────
async function handleInvite(ev, env, userId, t) {
  const code = t.trim().toUpperCase().replace(/\s+/g, '');
  const key = `invite:${code}`;
  const inv = code.length >= 6 ? await env.USERS.get(key, 'json') : null;
  if (!inv || (inv.used_by && inv.used_by !== userId)) {
    return reply(ev, env, [{ type: 'text', text: 'รหัสเชิญไม่ถูกต้องหรือถูกใช้แล้ว ลองพิมพ์ใหม่ หรือติดต่อทีมวิจัย',
      quickReply: { items: [qr('ประชาชน', 'ลงทะเบียน ประชาชน'), qr('ยกเลิก')] } }]);
  }
  await env.USERS.put(key, JSON.stringify({ ...inv, used_by: userId, used_at: nowIso() }));
  const user = (await getUser(env, userId)) || { joined: nowIso() };
  await putUser(env, userId, { ...user, role: 'adm', adm: true, invite: code, active: true, consent: nowIso() });
  await setAdmIndex(env, userId, true);
  await env.USERS.delete(`session:${userId}`);
  return reply(ev, env, [text(`ลงทะเบียนเป็น ADM เรียบร้อยแล้ว ท่านจะได้รับแจ้งเมื่อมีรายงานเหตุ\n\nข้อมูลในรายงานเป็นข้อมูลส่วนบุคคล ใช้เพื่อช่วยเหลือเท่านั้น ห้ามส่งต่อ\n\n${PRIVACY}`)]);
}

// ─── Report flow: type → village → location → note → confirm ─────
async function handleReportStep(ev, env, userId, s, t) {
  if (s.step === 'type') {
    if (!TYPES.includes(t)) return reply(ev, env, [askType()]);
    s.type = t;
    s.step = 'village';
    await putSession(env, userId, s);
    return reply(ev, env, [askVillage()]);
  }

  if (s.step === 'village') {
    s.village = t.slice(0, 60);
    s.step = 'location';
    await putSession(env, userId, s);
    return reply(ev, env, [askLocation()]);
  }

  if (s.step === 'location') {
    if (t !== 'ข้าม') return reply(ev, env, [askLocation()]);
    s.step = 'note';
    await putSession(env, userId, s);
    return reply(ev, env, [askNote()]);
  }

  if (s.step === 'note') {
    s.note = t === 'ข้าม' ? '' : t.slice(0, 500);
    s.step = 'confirm';
    await putSession(env, userId, s);
    return reply(ev, env, [askConfirm(s)]);
  }

  if (s.step === 'confirm') {
    if (t !== 'ยืนยัน') return reply(ev, env, [askConfirm(s)]);
    return submitReport(ev, env, userId, s);
  }
}

async function submitReport(ev, env, userId, s) {
  const id = 'R' + Date.now().toString(36).toUpperCase().slice(-6);
  const user = await getUser(env, userId);
  const report = {
    id,
    type: s.type,
    village: s.village,
    lat: s.lat ?? null,
    lon: s.lon ?? null,
    address: s.address || '',
    note: s.note || '',
    reporter: userId,               // ข้อมูลส่วนบุคคล เก็บใน KV เท่านั้น
    reporter_role: user ? user.role : null,
    created_at: nowIso(),
    status: 'new',
  };
  await env.USERS.put(`report:${id}`, JSON.stringify(report), { expirationTtl: REPORT_TTL });
  await env.USERS.delete(`session:${userId}`);

  // แจ้ง ADM ทุกคน ยกเว้นผู้รายงานเอง
  const targets = (await getAdmIds(env)).filter((u) => u !== userId);

  const ack = `รับรายงานแล้ว รหัส ${id}\n` + (targets.length
    ? `ส่งแจ้งเตือนถึง ADM ${targets.length} คนแล้ว`
    : 'บันทึกรายงานแล้ว แต่ยังไม่มี ADM ในระบบที่รับแจ้งได้');
  await reply(ev, env, [text(s.type === 'ขอความช่วยเหลือ' ? `${ack}\n\n${EMERGENCY}` : ack)]);
  if (targets.length) {
    /** @type {any[]} */
    const msgs = [text(
      `[รายงานเหตุใหม่] ${report.type}\n` +
      `หมู่บ้าน: ${report.village}\n` +
      (report.note ? `รายละเอียด: ${report.note}\n` : '') +
      `เวลา: ${thaiTime()}\n` +
      `รหัส: ${id}`)];
    if (report.lat != null) {
      msgs.push({
        type: 'location',
        title: `${report.type} · ${report.village}`.slice(0, 100),
        address: (report.address || 'ตำแหน่งที่ผู้รายงานแชร์').slice(0, 100),
        latitude: report.lat,
        longitude: report.lon,
      });
    }
    await multicast(env, targets, msgs);
  }
}

// ─── Message builders ────────────────────────────────────────────
function text(t) { return { type: 'text', text: t }; }

function qr(label, t) {
  return { type: 'action', action: { type: 'message', label: label.slice(0, 20), text: t || label } };
}

function askRole() {
  return {
    type: 'text',
    text: 'ยินดีต้อนรับสู่ จันอัดบ้านฉัน\nกรุณาเลือกประเภทผู้ใช้ (ADM ต้องมีรหัสเชิญจากทีมวิจัย)\n\n' + PRIVACY,
    quickReply: { items: [qr('ADM', 'ลงทะเบียน ADM'), qr('ประชาชน', 'ลงทะเบียน ประชาชน')] },
  };
}

function askType() {
  return {
    type: 'text',
    text: 'รายงานเหตุ (1/4)\nเลือกประเภทเหตุการณ์',
    quickReply: { items: [...TYPES.map((x) => qr(x)), qr('ยกเลิก')] },
  };
}

function askVillage() {
  const msg = { type: 'text', text: 'รายงานเหตุ (2/4)\nเกิดเหตุที่หมู่บ้านใด' };
  if (VILLAGES.length) {
    msg.quickReply = { items: [...VILLAGES.slice(0, 12).map((v) => qr(v)), qr('ยกเลิก')] };
  } else {
    msg.text += '\nพิมพ์ชื่อหมู่บ้านหรือหมู่ที่ เช่น "หมู่ 5 บ้านด่านติง"';
  }
  return msg;
}

function askLocation() {
  return {
    type: 'text',
    text: 'รายงานเหตุ (3/4)\nกดปุ่ม "ส่งตำแหน่ง" เพื่อแชร์ตำแหน่งที่เกิดเหตุ หรือกด "ข้าม"',
    quickReply: {
      items: [
        { type: 'action', action: { type: 'location', label: 'ส่งตำแหน่ง' } },
        qr('ข้าม'),
        qr('ยกเลิก'),
      ],
    },
  };
}

function askNote() {
  return {
    type: 'text',
    text: 'รายงานเหตุ (4/4)\nพิมพ์รายละเอียดเพิ่มเติม เช่น ระดับน้ำ จำนวนคน ผู้ป่วย/ผู้สูงอายุ หรือกด "ข้าม"',
    quickReply: { items: [qr('ข้าม'), qr('ยกเลิก')] },
  };
}

function askConfirm(s) {
  return {
    type: 'text',
    text:
      'ตรวจสอบข้อมูลก่อนส่ง\n' +
      `ประเภท: ${s.type}\n` +
      `หมู่บ้าน: ${s.village}\n` +
      `ตำแหน่ง: ${s.lat != null ? 'แชร์แล้ว' : 'ไม่ได้แชร์'}\n` +
      `รายละเอียด: ${s.note || '-'}`,
    quickReply: { items: [qr('ยืนยัน'), qr('ยกเลิก')] },
  };
}

// ─── KV helpers ──────────────────────────────────────────────────
async function getUser(env, id) { return env.USERS.get(`user:${id}`, 'json'); }
async function putUser(env, id, v) { return env.USERS.put(`user:${id}`, JSON.stringify(v)); }
async function getSession(env, id) { return env.USERS.get(`session:${id}`, 'json'); }
async function putSession(env, id, v) {
  return env.USERS.put(`session:${id}`, JSON.stringify(v), { expirationTtl: SESSION_TTL });
}

async function getAdmIds(env) {
  const idx = await env.USERS.get('index:adm2', 'json');
  if (idx) return idx;
  // ครั้งแรก: สร้าง index จากผู้ใช้ที่ลงทะเบียนไว้ก่อนหน้า
  const ids = [];
  let cursor;
  do {
    const page = await env.USERS.list({ prefix: 'user:', cursor });
    for (const k of page.keys) {
      const u = await env.USERS.get(k.name, 'json');
      if (u && u.role === 'adm' && u.adm === true) ids.push(k.name.slice(5));   // เฉพาะ ADM ที่ใช้รหัสเชิญ
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  await env.USERS.put('index:adm2', JSON.stringify(ids));
  return ids;
}

async function setAdmIndex(env, id, isAdm) {
  const ids = await getAdmIds(env);
  const next = isAdm ? [...new Set([...ids, id])] : ids.filter((x) => x !== id);
  await env.USERS.put('index:adm2', JSON.stringify(next));
}

// ─── LINE API ────────────────────────────────────────────────────
async function reply(ev, env, messages) {
  return callLine(env, 'https://api.line.me/v2/bot/message/reply',
    { replyToken: ev.replyToken, messages }, 'reply');
}

async function multicast(env, to, messages) {
  for (let i = 0; i < to.length; i += 500) {
    await callLine(env, 'https://api.line.me/v2/bot/message/multicast',
      { to: to.slice(i, i + 500), messages }, 'multicast');
  }
}

async function callLine(env, url, payload, label) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.LINE_CHANNEL_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) console.error(`${label} failed`, res.status, await res.text());
}

// ─── Utils ───────────────────────────────────────────────────────
function nowIso() { return new Date().toISOString(); }

function thaiTime() {
  return new Date().toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short',
  });
}

async function verifySignature(body, signature, secret) {
  if (!signature || !secret) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}


// ─── สถานการณ์น้ำ ต.จันอัด จากเว็บ SDSS (ไฟล์เดียวกับหน้าเว็บ) ─────────
const DATA = SITE_URL + 'region/';
const TCODE = '301010';
async function getJson(p) {
  const r = await fetch(DATA + p);
  return r.ok ? r.json() : null;
}
function bankLabel(pct) {
  if (pct == null) return 'ไม่มีข้อมูล';
  return pct >= 100 ? 'ล้นตลิ่ง' : pct >= 90 ? 'ใกล้ล้นตลิ่ง' : pct >= 70 ? 'ค่อนข้างสูง' : 'ปกติ';
}
const f0 = (v) => v == null ? '—' : Math.round(v);
const f1 = (v) => v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1);
async function waterStatus() {
  const [tw, rid, br, gf] = await Promise.all([
    getJson('data/live/thaiwater_region.json'), getJson('data/live/rid_reservoir.json'),
    getJson('data/live/basin_rain.json'), getJson('data/live/gistda_flood_7d.geojson')]);
  const st = tw && (tw.waterlevel || []).find(x => x.code === 'M.188A');
  const items = (rid && rid.items) || [], up = items.find(i => i.code === 'rsv300'), lo = items.find(i => i.code === 'rsv292');
  const hist = (rid && rid.hist && rid.hist.rsv292) || [], d = hist.length > 1 ? hist[hist.length - 1][2] - hist[hist.length - 2][2] : null;
  const b = br && br.basins && br.basins.LCK;
  const fl = gf && gf.status === 'ok' ? Math.round((gf.by_tambon || {})[TCODE] || 0) : null;
  return [
    `สถานการณ์น้ำ ต.จันอัด · ${thaiTime()}`,
    `ลำเชียงไกร (M.188A บ้านเพิ่ม): ${st && st.storage_pct != null ? `${f0(st.storage_pct)}% ของตลิ่ง · ${bankLabel(st.storage_pct)}` : 'ไม่มีข้อมูล'}`,
    `อ่างลำเชียงไกรตอนบน: ${up && up.pct != null ? `${f0(up.pct)}%${up.pct >= 100 ? ' (เกินความจุ)' : ''}` : '—'}`,
    `อ่างลำเชียงไกรตอนล่าง: ${lo && lo.pct != null ? `${f0(lo.pct)}%${d != null ? ` (${d > 0 ? 'เพิ่ม' : 'ลด'} ${f1(Math.abs(d))}% จากเมื่อวาน)` : ''}` : '—'}`,
    `ฝนเฉลี่ยลุ่มลำเชียงไกร 24 ชม.: ${b ? `${f1(b.past24)} มม. · คาดการณ์ 24 ชม. ${f1(b.next24)} มม.` : '—'}`,
    `น้ำท่วมตรวจพบในตำบล (GISTDA 7 วัน): ${fl == null ? '—' : fl ? `${fl} ไร่` : 'ไม่พบ'}`,
    'ที่มา: สสน. · กรมชลประทาน · GISTDA · Open-Meteo'
  ].join('\n');
}

// ─── ผู้ใช้ที่ใช้งาน (สำหรับนับผู้ใช้จริง) ─────────────────────────────
async function touch(env, userId) {
  const u = await getUser(env, userId);
  if (!u) return;
  const today = nowIso().slice(0, 10);
  if (u.last_active === today) return;                 // เขียน KV ไม่เกินวันละครั้งต่อคน
  await putUser(env, userId, { ...u, last_active: today });
}

// ─── สถิติสำหรับรายงานความก้าวหน้า (ไม่มีข้อมูลส่วนบุคคล) ─────────────
async function stats(env, url) {
  const key = url.searchParams.get('key') || '';
  if (!env.STATS_KEY || key !== env.STATS_KEY) return new Response('forbidden', { status: 403 });
  const all = async (prefix) => { const out = []; let cursor;
    do { const page = await env.USERS.list({ prefix, cursor }); for (const k of page.keys) out.push(await env.USERS.get(k.name, 'json'));
      cursor = page.list_complete ? undefined : page.cursor; } while (cursor);
    return out.filter(Boolean); };
  const users = await all('user:'), reports = await all('report:'), groups = await all('group:');
  const since = (days) => new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const cnt = (arr, f) => arr.reduce((m, x) => { const k = f(x) || 'ไม่ระบุ'; m[k] = (m[k] || 0) + 1; return m; }, {});
  const body = {
    generated_at: nowIso(),
    users: {
      registered: users.filter(u => u.role).length,
      by_role: cnt(users.filter(u => u.role), u => u.role === 'adm' ? (u.adm ? 'adm' : 'adm_ไม่มีรหัสเชิญ') : u.role),
      not_registered_yet: users.filter(u => !u.role).length,          // เพิ่มเพื่อนแล้วแต่ยังไม่เลือกประเภท
      active_7d: users.filter(u => u.last_active && u.last_active >= since(7)).length,
      active_30d: users.filter(u => u.last_active && u.last_active >= since(30)).length,
      joined_by_month: cnt(users, u => (u.joined || '').slice(0, 7))
    },
    groups: { joined: groups.length, approved: groups.filter(g => g.approved).length, daily_on: groups.filter(g => g.daily).length,
      members_last_push: groups.reduce((a, g) => a + (g.members || 0), 0) },
    reports: { total_90d: reports.length, by_type: cnt(reports, r => r.type), by_month: cnt(reports, r => (r.created_at || '').slice(0, 7)) },
    note: 'นับจาก KV ของระบบ (ผู้ที่เลิกติดตามถูกลบแล้ว) · จำนวนเพื่อนทั้งหมดดูที่ LINE OA Manager → Insights'
  };
  return new Response(JSON.stringify(body, null, 2), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}


// ─── กลุ่ม LINE ของ ADM ─────────────────────────────────────────
const GROUP_CMDS = ['สถานการณ์น้ำ', 'เปิดรายงานประจำวัน', 'ปิดรายงานประจำวัน'];
async function handleGroup(ev, env) {
  const gid = ev.source.groupId || ev.source.roomId;
  if (!gid) return;
  const key = `group:${gid}`;
  if (ev.type === 'join') {
    await env.USERS.put(key, JSON.stringify({ approved: false, daily: false, joined: nowIso() }));
    return reply(ev, env, [text('สวัสดีครับ บัญชี "จันอัดบ้านฉัน" เข้ากลุ่มแล้ว\n\n' +
      'พิมพ์ "สถานการณ์น้ำ" เพื่อดูสรุปสถานการณ์ได้ทุกเมื่อ\n' +
      'ให้ ADM ที่ลงทะเบียนด้วยรหัสเชิญแล้ว พิมพ์ "เปิดรายงานประจำวัน" เพื่อรับสรุปทุกเช้า 07:00 น.\n\n' +
      'ระบบตอบเฉพาะคำสั่งข้างต้น และไม่เก็บข้อความอื่นในกลุ่ม\n\n' + DISCLAIMER)]);
  }
  if (ev.type === 'leave') { await env.USERS.delete(key); return; }
  if (ev.type !== 'message' || ev.message.type !== 'text') return;
  const t = ev.message.text.trim();
  if (!GROUP_CMDS.includes(t)) return;                      // ไม่อ่าน/ไม่เก็บข้อความอื่นในกลุ่ม
  const g = (await env.USERS.get(key, 'json')) || { approved: false, daily: false, joined: nowIso() };

  if (t === 'สถานการณ์น้ำ') {                               // ตอบกลับ = ไม่เสียโควตา
    let msg;
    try { msg = await waterStatus(); } catch (e) { msg = 'ดึงข้อมูลสถานการณ์ไม่สำเร็จชั่วคราว'; }
    return reply(ev, env, [text(`${msg}\n\nดูแผนที่: ${SITE_URL}region/\n\n${DISCLAIMER}`)]);
  }
  // เปิด/ปิดรายงานประจำวัน: เฉพาะ ADM ที่ลงทะเบียนด้วยรหัสเชิญ
  const uid = ev.source.userId;
  const u = uid ? await getUser(env, uid) : null;
  if (!u || u.role !== 'adm' || u.adm !== true) {
    return reply(ev, env, [text('คำสั่งนี้ใช้ได้เฉพาะ ADM ที่ลงทะเบียนด้วยรหัสเชิญแล้ว\n(เพิ่มเพื่อน "จันอัดบ้านฉัน" แล้วพิมพ์ "ลงทะเบียน ADM" ในแชทส่วนตัวก่อน)')]);
  }
  const on = t === 'เปิดรายงานประจำวัน';
  await env.USERS.put(key, JSON.stringify({ ...g, approved: true, daily: on, approved_by: uid.slice(-6), updated: nowIso() }));
  const auto = env.DAILY_GROUP_PUSH === 'on';
  return reply(ev, env, [text(on
    ? `เปิดรายงานสถานการณ์น้ำประจำวันสำหรับกลุ่มนี้แล้ว${auto ? ' จะส่งทุกเช้า 07:00 น.' : '\n(ขณะนี้ผู้ดูแลระบบยังปิดการส่งอัตโนมัติไว้ เพื่อรักษาโควตาข้อความ — พิมพ์ "สถานการณ์น้ำ" ดูได้ทุกเมื่อ)'}`
    : 'ปิดรายงานประจำวันสำหรับกลุ่มนี้แล้ว (ยังพิมพ์ "สถานการณ์น้ำ" ดูได้)')]);
}

async function lineGet(env, url) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${env.LINE_CHANNEL_TOKEN}` } });
  return r.ok ? r.json() : null;
}

// ส่งสรุปเข้ากลุ่มทุกเช้า — ตรวจโควตาก่อนส่ง (ข้อความเข้ากลุ่มนับตามจำนวนสมาชิกในกลุ่ม)
async function dailyGroupPush(env) {
  if (env.DAILY_GROUP_PUSH !== 'on') return;
  const groups = [];
  let cursor;
  do { const page = await env.USERS.list({ prefix: 'group:', cursor });
    for (const k of page.keys) { const g = await env.USERS.get(k.name, 'json'); if (g && g.approved && g.daily) groups.push({ id: k.name.slice(6), g }); }
    cursor = page.list_complete ? undefined : page.cursor; } while (cursor);
  if (!groups.length) return;
  const quota = await lineGet(env, 'https://api.line.me/v2/bot/message/quota');
  const used = await lineGet(env, 'https://api.line.me/v2/bot/message/quota/consumption');
  let left = quota && quota.type === 'limited' ? quota.value - ((used && used.totalUsage) || 0) : Infinity;
  let msg;
  try { msg = await waterStatus(); } catch (e) { console.error('daily water', e && e.message); return; }
  for (const { id, g } of groups) {
    const mc = await lineGet(env, `https://api.line.me/v2/bot/group/${id}/members/count`);
    const n = (mc && mc.count) || 0;
    if (n > left) { console.warn('daily push skipped: quota', { left, n }); continue; }
    await callLine(env, 'https://api.line.me/v2/bot/message/push',
      { to: id, messages: [text(`☀️ รายงานประจำวัน\n${msg}\n\nดูแผนที่: ${SITE_URL}region/\n\n${DISCLAIMER}`)] }, 'push-group');
    left -= n;
    await env.USERS.put(`group:${id}`, JSON.stringify({ ...g, last_push: nowIso(), members: n }));
  }
}


// ─── รายงานสำหรับแผนที่เว็บ (สาธารณะ · ไม่มีข้อมูลส่วนบุคคล) ─────────────
// แสดงเฉพาะ "น้ำท่วมบ้าน" และ "ถนนน้ำท่วม/ขาด" ที่แชร์ตำแหน่ง · ย้อนหลัง 7 วัน
// ตำแหน่งปัดเป็นทศนิยม 3 ตำแหน่ง (~100 ม.) · ไม่ส่งรายละเอียด/ที่อยู่/ผู้รายงาน
// "ขอความช่วยเหลือ" ไม่แสดงตำแหน่ง — ส่งเป็นจำนวนรายหมู่บ้านเท่านั้น
const PUBLIC_DAYS = 7;
async function publicReports(env) {
  const since = new Date(Date.now() - PUBLIC_DAYS * 864e5).toISOString();
  const items = [], help = {}, noLoc = {};
  let cursor;
  do {
    const page = await env.USERS.list({ prefix: 'report:', cursor });
    for (const k of page.keys) {
      const r = await env.USERS.get(k.name, 'json');
      if (!r || !r.created_at || r.created_at < since) continue;
      const village = String(r.village || 'ไม่ระบุ').slice(0, 40);
      if (r.type === 'ขอความช่วยเหลือ') { help[village] = (help[village] || 0) + 1; continue; }
      if (r.lat == null || r.lon == null) { noLoc[village] = (noLoc[village] || 0) + 1; continue; }
      items.push({ type: r.type, village, lat: Math.round(r.lat * 1000) / 1000, lon: Math.round(r.lon * 1000) / 1000,
        created_at: r.created_at, by: r.reporter_role === 'adm' ? 'adm' : 'public', status: r.status || 'new' });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  items.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return new Response(JSON.stringify({ updated_at: nowIso(), days: PUBLIC_DAYS, items, help_by_village: help, no_location_by_village: noLoc }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': 'https://sarochiiii.github.io', 'Cache-Control': 'public, max-age=120' } });
}
