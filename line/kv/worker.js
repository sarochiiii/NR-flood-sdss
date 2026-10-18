/**
 * LINE OA Webhook — จันอัดบ้านฉัน (Provider: NRRU-IDRM)
 * Cloudflare Worker · v4.13 (ทุกคนรายงานเหตุ/ขอความช่วยเหลือได้ไม่ต้องลงทะเบียน · ขอความช่วยเหลือแสดงตำแหน่งจริงบนแผนที่สาธารณะ · หน้าติดตามของ อบต. /api/monitor (MONITOR_KEY) · ผู้รายงานพิมพ์ "ปิดเหตุ" ได้ · v4.12 รหัสเชิญกลุ่ม max_uses · ลิงก์แผนที่อยู่ก่อนหมายเหตุ/ที่มาในรายงาน · รายงานบ้านด่านติง: น้ำท่วมซ้ำซากจาก API GISTDA ปี 2554–2566 แทน FloodGCS · รายงาน SDSS บ้านด่านติง "รายงานบ้านด่านติง" แทนปุ่มติดต่อ อบต. ใน rich menu · รายงาน: ตัดฝนสถานี 24 ชม. · รายงาน: พยากรณ์ ECMWF · อ่าง/GISTDA เฉพาะลำเชียงไกร/จันอัด · ปิดติดต่อ อบต./ขอความช่วยเหลือชั่วคราว · รายงานเหตุต้องแชร์ตำแหน่ง ไม่ส่งถึง ADM แสดงบนแผนที่ · รายงานสถานการณ์น้ำครบ 4 ชั้นข้อมูล รูปแบบเดียวกับเว็บ · รายงานบนแผนที่เว็บ /api/reports · ปุ่มบนเว็บเปิดแชทพร้อมคำสั่ง · ทางลัดขอความช่วยเหลือ · ADM ต้องใช้รหัสเชิญ · ขอความยินยอม · ลบข้อมูลตามกำหนด · สถานการณ์น้ำจริง · สถิติผู้ใช้ · รายงานเข้ากลุ่ม LINE ของ ADM)
 * แก้จาก v3: เดิมใครก็พิมพ์ "ลงทะเบียน ADM" แล้วได้รับทุกรายงาน (รวมคำขอความช่วยเหลือ) → ปิดช่องโหว่นี้
 *
 * Bindings
 *   LINE_CHANNEL_SECRET  (Secret)
 *   LINE_CHANNEL_TOKEN   (Secret)
 *   USERS                (KV namespace → LINE_USERS)
 *   STATS_KEY            (Secret · ใหม่ v4.1 · ตั้งเอง ≥ 24 ตัวอักษร) ใช้เปิด /stats ดูสถิติผู้ใช้สำหรับรายงานความก้าวหน้า
 *   MONITOR_KEY          (Secret · ใหม่ v4.13 · ≥ 24 ตัวอักษร · ใส่หลายรหัสคั่นด้วย , ได้) ใช้เปิดหน้าติดตามเหตุของ อบต.
 *                        region/monitor.html#k=<รหัส> → GET /api/monitor · POST /api/monitor/status (header X-Monitor-Key)
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
 *   report:<id>       รายงานเหตุที่ยืนยันแล้ว (หมดอายุเอง 90 วัน) · status new → ack (อบต. รับทราบ) → closed (อบต./ผู้รายงานปิด)
 *   invite:<CODE>     รหัสเชิญ ADM — สร้างใน Cloudflare: Workers KV → LINE_USERS → Add entry (ห้ามใส่ชื่อ/เบอร์โทร)
 *                     รายคน (ใช้ครั้งเดียว): key invite:CHANAT-7K2Q   value {"note":"ADM จันอัด ชุด 1"}
 *                     รหัสกลุ่ม (v4.12):    key invite:CHANAT-ADM32  value {"note":"ADM จันอัด 32 คน","max_uses":32}
 *   index:adm2        รายชื่อ ADM ที่ยืนยันด้วยรหัสเชิญแล้ว (แทน index:adm เดิมที่ไม่ปลอดภัย)
 *
 * โควตา: ตอบกลับผู้ใช้ใช้ Reply API (ไม่นับโควตา)
 *        แจ้ง ADM ใช้ Multicast = นับ 1 ข้อความต่อ ADM 1 คน
 */

// ─── ค่าที่ต้องยืนยันก่อนใช้งานจริง ───────────────────────────────
const SITE_URL = 'https://sarochiiii.github.io/NR-flood-sdss/';
const ABT_PHONE = '';   // เบอร์ อบต.จันอัด ที่ยืนยันแล้ว เช่น '044xxxxxx' (ว่าง = ยังไม่ยืนยัน)
const VILLAGES = [];    // รายชื่อหมู่บ้านสำหรับปุ่มเลือก ไม่เกิน 12 รายการ (ว่าง = ให้พิมพ์เอง)
// v4.13 เปิด "ขอความช่วยเหลือ" ตามคำแนะนำผู้ทรงคุณวุฒิ: ทุกคนส่งได้ ทุกคนเห็นตำแหน่ง ไม่ผ่าน ADM · อบต. ติดตามที่หน้า monitor
// (false = ปิดทั้ง "ติดต่อ อบต." และ "ขอความช่วยเหลือ" แบบ v4.6–v4.12)
const HELP_ENABLED = true;
const HELP = 'ขอความช่วยเหลือ';
// รายงาน SDSS บ้านด่านติง — ข้อความที่ปุ่มที่ 4 ของ rich menu ส่ง (แทน "ติดต่อ อบต." เดิม) + คำพิมพ์อื่นที่ยอมรับ
const SANDBOX_CMDS = ['รายงานบ้านด่านติง', 'รายงานด่านติง', 'บ้านด่านติง'];
// ─────────────────────────────────────────────────────────────────

const DISCLAIMER =
  'ระบบนี้เป็นเครื่องมือสนับสนุนการตัดสินใจของโครงการวิจัย ' +
  'ไม่ใช่การประกาศเตือนภัยอย่างเป็นทางการ โปรดติดตามประกาศจาก ปภ. และ อบต.';
const EMERGENCY = 'กรณีฉุกเฉินต่อชีวิต โทร 1669 (การแพทย์ฉุกเฉิน) หรือ 1784 (ปภ.) ทันที';
const TYPES = ['น้ำท่วมบ้าน', 'ถนนน้ำท่วม/ขาด', ...(HELP_ENABLED ? [HELP] : [])];
const HELP_NOTE = 'คำขอนี้ไม่ผ่าน ADM — แสดงบนแผนที่ให้ทุกคนเห็น และเจ้าหน้าที่ อบต. ติดตามจากแผนที่ ระบบนี้ไม่ใช่ศูนย์สั่งการ';
const HELP_OFF = 'ปิดใช้งานชั่วคราว — ยังไม่เปิดช่องทางติดต่อ อบต./ขอความช่วยเหลือผ่านระบบนี้\n\n' + EMERGENCY;
const SESSION_TTL = 1800;
const REPORT_TTL = 90 * 86400;      // เก็บรายงานไว้ 90 วัน แล้ว KV ลบเอง
const PRIVACY =
  'การใช้ข้อมูล: ระบบเก็บรหัสผู้ใช้ LINE ประเภทผู้ใช้ และรายงานที่ท่านส่ง (ตำแหน่ง/หมู่บ้าน/รายละเอียด) ' +
  'เพื่อแสดงจุดแจ้งเหตุบนแผนที่สาธารณะ (น้ำท่วม/ถนน ปัดตำแหน่ง ~100 ม. · ขอความช่วยเหลือ แสดงตำแหน่งจริงเพื่อให้ อบต. และเพื่อนบ้านเข้าช่วยได้) ' +
  'ไม่เผยแพร่ชื่อผู้รายงานและรายละเอียด (รายละเอียดเห็นเฉพาะเจ้าหน้าที่ อบต. ที่ติดตามเหตุ) รายงานลบอัตโนมัติใน 90 วัน ' +
  'พิมพ์ "ลบข้อมูลของฉัน" หรือเลิกติดตามบัญชีเพื่อลบข้อมูลได้ทุกเมื่อ';
const REPORT_ID = /^R[0-9A-Z]{1,10}$/;
const MONITOR_DAYS = 14;            // หน้าติดตามของ อบต. แสดงเหตุย้อนหลัง 14 วัน (รวมที่ปิดแล้ว)

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/stats') return stats(env, url);
    if (request.method === 'GET' && url.pathname === '/api/reports') return publicReports(env);
    if (url.pathname === '/api/monitor' || url.pathname === '/api/monitor/status') return monitor(request, env, url);
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
      return reply(ev, env, [askNote(s)]);
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

  if (t === 'ปิดเหตุ' || /^ปิดเหตุ\s+R[0-9A-Z]+$/i.test(t)) return closeByReporter(ev, env, userId, t);

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
    try { msg = await waterStatus(); } catch (e) { console.error('water', e && e.message); msg = `ดึงข้อมูลสถานการณ์ไม่สำเร็จชั่วคราว\nดูแผนที่: ${SITE_URL}region/\n\n${DISCLAIMER}`; }
    return reply(ev, env, [text(msg)]);
  }

  if (SANDBOX_CMDS.includes(t)) {                           // ตอบกลับ = ไม่เสียโควตา · เฉพาะแชท 1:1 (กลุ่มยังตอบเฉพาะ 3 คำสั่งเดิม)
    let msg;
    try { msg = await sandboxStatus(); } catch (e) { console.error('sandbox', e && e.message); msg = `ดึงข้อมูลรายงานบ้านด่านติงไม่สำเร็จชั่วคราว\nดูแผนที่: ${SITE_URL}chanat/\n\n${DISCLAIMER}`; }
    return reply(ev, env, [text(msg)]);
  }

  if (t === 'ติดต่อ อบต.') {
    if (!HELP_ENABLED) return reply(ev, env, [text(HELP_OFF)]);
    return reply(ev, env, [text(ABT_PHONE
      ? `อบต.จันอัด โทร ${ABT_PHONE}\n\n${EMERGENCY}`
      : `อยู่ระหว่างยืนยันเบอร์ติดต่อ อบต.จันอัด\n\n${EMERGENCY}`)]);
  }

  if (t === 'รายงานเหตุ') {                 // v4.13 ไม่ต้องลงทะเบียน — ประกาศการใช้ข้อมูลในขั้นแรก · กด "ยืนยัน" = ยินยอม
    await putSession(env, userId, { step: 'type', started: nowIso() });
    return reply(ev, env, [askType()]);
  }

  // ทางลัด "ขอความช่วยเหลือ" (จากปุ่มบนเว็บ) → ข้ามขั้นเลือกประเภท · ถ้ากำลังอยู่ในขั้นตอนอื่น ให้ถือเป็นการตอบขั้นนั้น
  const s = await getSession(env, userId);
  if (t === HELP && !s) {
    if (!HELP_ENABLED) return reply(ev, env, [text(HELP_OFF)]);
    await putSession(env, userId, { step: 'village', type: HELP, started: nowIso() });
    return reply(ev, env, [text('🆘 ขอความช่วยเหลือ\nหากมีอันตรายต่อชีวิต โทรทันที: 1669 (เจ็บป่วยฉุกเฉิน) · 1784 (ปภ.) · 191\n' + HELP_NOTE + '\n\n' + PRIVACY), askVillage()]);
  }
  if (s && s.step === 'invite') return handleInvite(ev, env, userId, t);
  if (s) return handleReportStep(ev, env, userId, s, t);

  return reply(ev, env, [text('กดปุ่มในเมนูด้านล่าง หรือพิมพ์ "สถานการณ์น้ำ" / "รายงานบ้านด่านติง" / "รายงานเหตุ"' + (HELP_ENABLED ? ' / "ขอความช่วยเหลือ"' : '') + ' / "ปิดเหตุ"')]);
}

// ─── รหัสเชิญ ADM ─────────────────────────────────────────────────
async function handleInvite(ev, env, userId, t) {
  const code = t.trim().toUpperCase().replace(/\s+/g, '');
  const key = `invite:${code}`;
  const inv = code.length >= 6 ? await env.USERS.get(key, 'json') : null;
  // v4.12 รหัสกลุ่ม: value {"note":"…","max_uses":32} = ใช้ได้ไม่เกิน 32 คน (ไม่ใส่ max_uses = 1 คน แบบเดิม)
  // รายชื่อผู้ใช้รหัสเก็บใน KV เท่านั้น (used_list) · KV ไม่รับประกันการเขียนพร้อมกัน จำนวนจริงอาจเกินเล็กน้อยถ้าลงทะเบียนพร้อมกันวินาทีเดียว
  const max = inv ? Math.max(1, Math.floor(Number(inv.max_uses) || 1)) : 1;
  const used = inv ? (Array.isArray(inv.used_list) ? inv.used_list : inv.used_by ? [inv.used_by] : []) : [];
  if (!inv || (!used.includes(userId) && used.length >= max)) {
    return reply(ev, env, [{ type: 'text', text: inv && max > 1 ? 'รหัสเชิญนี้มีผู้ลงทะเบียนครบจำนวนแล้ว กรุณาติดต่อทีมวิจัย'
      : 'รหัสเชิญไม่ถูกต้องหรือถูกใช้แล้ว ลองพิมพ์ใหม่ หรือติดต่อทีมวิจัย',
      quickReply: { items: [qr('ประชาชน', 'ลงทะเบียน ประชาชน'), qr('ยกเลิก')] } }]);
  }
  const list = used.includes(userId) ? used : [...used, userId];
  await env.USERS.put(key, JSON.stringify(max > 1 ? { ...inv, used_list: list, used_count: list.length, used_at: nowIso() }
    : { ...inv, used_by: userId, used_at: nowIso() }));
  const user = (await getUser(env, userId)) || { joined: nowIso() };
  await putUser(env, userId, { ...user, role: 'adm', adm: true, invite: code, active: true, consent: nowIso() });
  await setAdmIndex(env, userId, true);
  await env.USERS.delete(`session:${userId}`);
  return reply(ev, env, [text(`ลงทะเบียนเป็น ADM เรียบร้อยแล้ว (เปิด/ปิดรายงานประจำวันในกลุ่ม LINE ได้) · รายงานเหตุจากประชาชนดูได้บนแผนที่ ${SITE_URL}region/\n\n${PRIVACY}`)]);
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
    return reply(ev, env, [askLocation(false, s)]);
  }

  if (s.step === 'location') {                 // ต้องแชร์ตำแหน่งเท่านั้น (ข้อความใดก็ตามจะถามซ้ำ)
    return reply(ev, env, [askLocation(true, s)]);
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
  // v4.13 ไม่ต้องลงทะเบียนก่อน: กด "ยืนยัน" หลังเห็นประกาศการใช้ข้อมูล = ยินยอม → บันทึกเป็นผู้ใช้ประเภทประชาชน (ถ้ายังไม่มีประเภท)
  if (!user || !user.role || !user.consent) {
    await putUser(env, userId, { ...(user || {}), role: (user && user.role) || 'public', adm: !!(user && user.adm),
      joined: (user && user.joined) || nowIso(), active: true, consent: (user && user.consent) || nowIso() });
  }

  // v4.6: ไม่ส่งถึง ADM (ไม่ใช้โควตา push) — จุดแจ้งเหตุแสดงบนแผนที่ผ่าน /api/reports · อบต. ติดตามที่หน้า monitor (v4.13)
  const help = s.type === HELP;
  await reply(ev, env, [text((help
    ? `รับคำขอความช่วยเหลือแล้ว รหัส ${id}\nตำแหน่งแสดงบนแผนที่ให้ อบต. และเพื่อนบ้านเห็นภายในไม่กี่นาที\n${SITE_URL}region/\n${HELP_NOTE}`
    : `รับรายงานแล้ว รหัส ${id}\nจุดแจ้งเหตุจะแสดงบนแผนที่ภายในไม่กี่นาที\n${SITE_URL}region/`) +
    `\nเมื่อ${help ? 'ได้รับความช่วยเหลือแล้ว' : 'น้ำลดแล้ว'} พิมพ์ "ปิดเหตุ" เพื่อเอาจุดออกจากแผนที่\n\n${EMERGENCY}`)]);
}

// ─── v4.13 ผู้รายงานปิดเหตุของตนเอง ("ปิดเหตุ" → เลือก · "ปิดเหตุ R…" → ปิด) ─────
async function closeByReporter(ev, env, userId, t) {
  const m = t.match(/R[0-9A-Z]+$/i);
  if (m) {
    const id = m[0].toUpperCase();
    const r = REPORT_ID.test(id) ? await env.USERS.get(`report:${id}`, 'json') : null;
    if (!r || r.reporter !== userId) return reply(ev, env, [text(`ไม่พบเหตุรหัส ${id} ที่ท่านรายงาน`)]);
    if (r.status === 'closed') return reply(ev, env, [text(`เหตุ ${id} ปิดแล้ว`)]);
    await saveReport(env, { ...r, status: 'closed', status_at: nowIso(), closed_by: 'reporter' });
    return reply(ev, env, [text(`ปิดเหตุ ${id} (${r.type}) แล้ว — จุดจะหายจากแผนที่ภายในไม่กี่นาที ขอบคุณที่แจ้งครับ`)]);
  }
  const mine = (await listReports(env, REPORT_TTL / 86400)).filter((r) => r.reporter === userId && r.status !== 'closed');
  if (!mine.length) return reply(ev, env, [text('ไม่มีเหตุที่ท่านรายงานและยังเปิดอยู่')]);
  return reply(ev, env, [{ type: 'text', text: 'เลือกเหตุที่ต้องการปิด (น้ำลดแล้ว/ได้รับความช่วยเหลือแล้ว)\n' +
      mine.slice(0, 12).map((r) => `${r.id} · ${r.type} · ${r.village}`).join('\n'),
    quickReply: { items: [...mine.slice(0, 12).map((r) => qr(`${r.id} ${r.type}`, `ปิดเหตุ ${r.id}`)), qr('ยกเลิก')] } }]);
}

// เขียนรายงานกลับโดยคงวันหมดอายุเดิม (put ใหม่โดยไม่ใส่ expirationTtl = ไม่หมดอายุ)
async function saveReport(env, r) {
  const left = Math.floor(REPORT_TTL - (Date.now() - Date.parse(r.created_at)) / 1000);
  await env.USERS.put(`report:${r.id}`, JSON.stringify(r), { expirationTtl: Math.max(60, left) });
}

async function listReports(env, days) {
  const since = new Date(Date.now() - days * 864e5).toISOString(), out = [];
  let cursor;
  do {
    const page = await env.USERS.list({ prefix: 'report:', cursor });
    for (const k of page.keys) {
      const r = await env.USERS.get(k.name, 'json');
      if (r && r.created_at && r.created_at >= since) out.push(r);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

// ─── Message builders ────────────────────────────────────────────
function text(t) { return { type: 'text', text: t }; }

function qr(label, t) {
  return { type: 'action', action: { type: 'message', label: label.slice(0, 20), text: t || label } };
}

function askRole() {
  return {
    type: 'text',
    text: 'ยินดีต้อนรับสู่ จันอัดบ้านฉัน\nกรุณาเลือกประเภทผู้ใช้ (ADM ต้องมีรหัสเชิญจากทีมวิจัย)\nรายงานเหตุ/ขอความช่วยเหลือได้ทันทีโดยไม่ต้องลงทะเบียน\n\n' + PRIVACY,
    quickReply: { items: [qr('ADM', 'ลงทะเบียน ADM'), qr('ประชาชน', 'ลงทะเบียน ประชาชน')] },
  };
}

function askType() {
  return {
    type: 'text',
    text: 'รายงานเหตุ (1/4)\nเลือกประเภทเหตุการณ์\n\n' + PRIVACY,
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

function askLocation(again, s) {
  const help = s && s.type === HELP;
  return {
    type: 'text',
    text: (again ? 'ต้องแชร์ตำแหน่งที่เกิดเหตุจึงจะส่งรายงานได้\n' : '') +
      `${help ? 'ขอความช่วยเหลือ' : 'รายงานเหตุ'} (3/4)\nกดปุ่ม "ส่งตำแหน่ง" แล้วเลื่อนหมุดไปที่จุด${help ? 'ที่ต้องการความช่วยเหลือ' : 'เกิดเหตุ'}\n` +
      (help ? 'จุดนี้จะแสดงบนแผนที่สาธารณะตามตำแหน่งจริง ให้ อบต. และเพื่อนบ้านเห็น (ไม่แสดงชื่อและรายละเอียด)'
        : 'จุดนี้จะแสดงบนแผนที่สาธารณะ (ปัด ~100 ม. ไม่แสดงชื่อและรายละเอียด)'),
    quickReply: {
      items: [
        { type: 'action', action: { type: 'location', label: 'ส่งตำแหน่ง' } },
        qr('ยกเลิก'),
      ],
    },
  };
}

function askNote(s) {
  const help = s && s.type === HELP;
  return {
    type: 'text',
    text: help
      ? 'ขอความช่วยเหลือ (4/4)\nพิมพ์สิ่งที่ต้องการ เช่น จำนวนคน ผู้ป่วย/ผู้สูงอายุ/เด็ก ระดับน้ำ เบอร์ติดต่อกลับ (ถ้าสะดวก) หรือกด "ข้าม"\nรายละเอียดนี้เห็นเฉพาะเจ้าหน้าที่ อบต. ไม่แสดงบนแผนที่สาธารณะ'
      : 'รายงานเหตุ (4/4)\nพิมพ์รายละเอียดเพิ่มเติม เช่น ระดับน้ำ จำนวนคน ผู้ป่วย/ผู้สูงอายุ หรือกด "ข้าม"\nรายละเอียดนี้เห็นเฉพาะเจ้าหน้าที่ อบต.',
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
      `รายละเอียด: ${s.note || '-'}\n\nกด "ยืนยัน" = ยินยอมให้ใช้ข้อมูลตามประกาศการใช้ข้อมูลในขั้นแรก`,
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
async function getJson(p) {
  const r = await fetch(DATA + p);
  return r.ok ? r.json() : null;
}
async function waterStatus() {
  const [tw, rid, gf, ec, cfg] = await Promise.all(['data/live/thaiwater_region.json', 'data/live/rid_reservoir.json',
    'data/live/gistda_flood_7d.geojson', 'data/live/ecmwf.json', 'config.json'].map(p => getJson(p).catch(() => null)));
  if (!tw && !rid && !gf) throw new Error('no data');
  return situationReport({ tw, rid, gf, ec, cfg });
}
// รูปแบบรายงานเดียวกับปุ่ม "สร้างรายงานสถานการณ์สำหรับ LINE" บนเว็บ — แก้ที่ region/js/report.js แล้วคัดลอกมาทั้งฟังก์ชัน
// >>> situationReport
function situationReport(D) {
  const tw = D.tw || {}, rid = D.rid || {}, gf = D.gf || {}, ec = D.ec || {}, cfg = D.cfg || {};
  const TCODE = '301010', SITE = 'https://sarochiiii.github.io/NR-flood-sdss/region/';
  const f0 = (v) => v == null ? '—' : String(Math.round(v)), f1 = (v) => v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1);
  const tt = (s) => { if (!s) return '—';
    const d = new Date(/T/.test(s) ? s : String(s).replace(' ', 'T') + (String(s).length <= 10 ? 'T00:00' : '') + ':00+07:00');
    return isNaN(d.getTime()) ? String(s) : d.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' น.'; };
  const dd = (s) => s ? new Date(s + 'T00:00:00+07:00').toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short' }) : '—';
  const bank = (p) => p == null ? 'ไม่มีข้อมูล' : p >= 100 ? 'ล้นตลิ่ง' : p >= 90 ? 'ใกล้ล้นตลิ่ง' : p >= 70 ? 'ค่อนข้างสูง' : 'ปกติ';
  const out = ['📋 รายงานสถานการณ์น้ำ ต.จันอัด อ.โนนสูง', `ข้อมูลรวบรวม ณ ${tt(tw.updated_at)}`];
  // ① พยากรณ์อากาศ ECMWF IFS ที่ ต.จันอัด (Open-Meteo · ดึงโดย Actions ทุก 3 ชม.)
  out.push('', `🌦 พยากรณ์อากาศ ECMWF ต.จันอัด (ดึงเมื่อ ${tt(ec.updated_at)}${ec.status === 'error' ? ' · รอบล่าสุดดึงไม่สำเร็จ' : ''})`);
  const ed = (ec.days || []).filter(x => x[1] != null);
  if (ed.length) {
    out.push(`• ฝน 24 ชม. ข้างหน้า ${f1(ec.next24_mm)} มม. · 72 ชม. ${f1(ec.next72_mm)} มม.`);
    out.push(...ed.slice(0, 3).map(x => `• ${dd(x[0])}: ฝน ${f1(x[1])} มม. · อุณหภูมิ ${f0(x[3])}–${f0(x[2])}°C`));
  } else out.push('• ไม่มีข้อมูล');
  // ② ระดับน้ำสถานีตรวจวัด (% ของตลิ่ง ThaiWater)
  const wl = (tw.waterlevel || []).filter(s => s.storage_pct != null).sort((a, b) => b.storage_pct - a.storage_pct);
  const m = (tw.waterlevel || []).find(s => s.code === 'M.188A');
  out.push('', '🌊 ระดับน้ำสถานีตรวจวัด (% ของตลิ่ง)');
  out.push(`• ลำเชียงไกร M.188A ${m ? m.name : ''}: ${m && m.storage_pct != null ? `${f0(m.storage_pct)}% · ${bank(m.storage_pct)} (${tt(m.measured_at)})` : 'ไม่มีข้อมูล'}`);
  const hi = wl.filter(s => s.storage_pct >= 90);
  out.push(hi.length ? `• ใกล้/ล้นตลิ่ง ≥ 90%: ${hi.slice(0, 4).map(s => `${s.code} ${s.name} อ.${s.amphoe} ${f0(s.storage_pct)}%`).join(' · ')}${hi.length > 4 ? ` และอีก ${hi.length - 4} สถานี` : ''}`
    : `• ไม่มีสถานีใกล้/ล้นตลิ่ง (จาก ${wl.length} สถานี)`);
  // ③ อ่างเก็บน้ำ — เฉพาะอ่างลำเชียงไกรตอนบน/ตอนล่าง (กรมชลประทาน)
  const items = rid.status === 'ok' ? (rid.items || []) : [];
  // อ่างลำเชียงไกร: ค่าล่าสุดใน hist ([วันที่, ล้าน ลบ.ม., %, ...]) เพราะค่าของวันนี้ใน items มักยังว่างจนกรมชลประทานรายงาน
  const lck = (code) => { const h = ((rid.hist || {})[code] || []).filter(r => r[2] != null), i = items.find(x => x.code === code);
    if (i && i.pct != null && (!h.length || i.date >= h[h.length - 1][0])) return { pct: i.pct, date: i.date };
    return h.length ? { pct: h[h.length - 1][2], date: h[h.length - 1][0] } : null; };
  const up = lck('rsv300'), lo = lck('rsv292');
  out.push('', `🏞 อ่างเก็บน้ำ (ข้อมูลวันที่ ${dd((lo && lo.date) || (up && up.date))})`);
  out.push(`• ลำเชียงไกรตอนบน ${up ? `${f0(up.pct)}%${up.pct > 100 ? ' เกินความจุ' : ''}` : '—'}`);
  out.push(`• ลำเชียงไกรตอนล่าง ${lo ? `${f0(lo.pct)}%${lo.pct > 100 ? ' เกินความจุ' : ''}` : '—'}`);
  // ④ น้ำท่วมตรวจพบ (GISTDA 7 วัน) — เฉพาะ ต.จันอัด
  out.push('', `🛰 น้ำท่วมตรวจพบจากดาวเทียม (GISTDA 7 วัน · ${tt(gf.updated_at)})`);
  if (gf.status === 'ok') {
    const bt = gf.by_tambon || {}, c = Math.round(bt[TCODE] || 0);
    out.push(`• ต.จันอัด: ${c ? `${c.toLocaleString('th-TH')} ไร่` : 'ไม่พบ'}`);
  } else out.push('• ไม่มีข้อมูล');
  out.push('', `🗺 แผนที่: ${SITE}`);
  out.push('', `⚠️ ${(cfg.bank || {}).verified ? '' : 'เกณฑ์ตลิ่ง 70/90% ยังไม่ยืนยันกับหน่วยงาน · '}ไม่ใช่ประกาศเตือนภัยทางการ โปรดติดตามประกาศจาก ปภ. และ อบต.`,
    'ที่มา: สสน. (ThaiWater) · ECMWF ผ่าน Open-Meteo · กรมชลประทาน · GISTDA');
  return out.join('\n');
}
// <<< situationReport

// รายงาน SDSS บ้านด่านติง (คำสั่ง "รายงานบ้านด่านติง" · ปุ่มที่ 4 ของ rich menu) — แก้ที่ region/js/report.js แล้วคัดลอกมาทั้งฟังก์ชัน
async function sandboxStatus() {
  const [sb, tw, rid, gf, ec, cfg] = await Promise.all(['data/sandbox/summary.json', 'data/live/thaiwater_region.json', 'data/live/rid_reservoir.json',
    'data/live/gistda_flood_7d.geojson', 'data/live/ecmwf.json', 'config.json'].map(p => getJson(p).catch(() => null)));
  if (!sb && !tw && !rid) throw new Error('no data');
  return sandboxReport({ sb, tw, rid, gf, ec, cfg });
}
// >>> sandboxReport
function sandboxReport(D) {
  const sb = D.sb || {}, tw = D.tw || {}, rid = D.rid || {}, gf = D.gf || {}, ec = D.ec || {}, cfg = D.cfg || {};
  const TCODE = '301010', SITE = 'https://sarochiiii.github.io/NR-flood-sdss/chanat/';
  const n0 = (v) => v == null ? '—' : Math.round(v).toLocaleString('th-TH'), f1 = (v) => v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1);
  const tt = (s) => { if (!s) return '—';
    const d = new Date(/T/.test(s) ? s : String(s).replace(' ', 'T') + (String(s).length <= 10 ? 'T00:00' : '') + ':00+07:00');
    return isNaN(d.getTime()) ? String(s) : d.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' น.'; };
  const dd = (s) => { if (!s) return '—'; const d = new Date(/T/.test(s) ? s : s + 'T00:00:00+07:00');
    return isNaN(d.getTime()) ? String(s) : d.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: '2-digit' }); };
  const bank = (p) => p >= 100 ? 'ล้นตลิ่ง' : p >= 90 ? 'ใกล้ล้นตลิ่ง' : p >= 70 ? 'ค่อนข้างสูง' : 'ปกติ';
  const out = ['📋 รายงาน SDSS บ้านด่านติง ต.จันอัด อ.โนนสูง', `ข้อมูลรวบรวม ณ ${tt(tw.updated_at)}`];
  // ① อาคารที่สัมผัสภัย (ข้อมูลคงที่ คำนวณล่วงหน้า)
  const v = sb.village, t = sb.tambon, nr = (o, k) => o && o.near_river ? o.near_river[k] : null, fg = (o, k) => o && o.ff_ge ? o.ff_ge[k] : null;
  out.push('', `🏘 อาคารรอบบ้านด่านติง (รัศมี ${sb.radius_km || '—'} กม.) ${v ? n0(v.n) + ' หลัง' : '— ยังไม่มีข้อมูลสรุปอาคาร'}`);
  if (v) {
    out.push(`• ใกล้แม่น้ำ/ลำน้ำสายหลัก ≤ 100 ม.: ${n0(nr(v, '100'))} หลัง · ≤ 300 ม.: ${n0(nr(v, '300'))} หลัง`);
    if (v.ff_ge) {
      out.push(`• เคยท่วม ≥ 1 ครั้ง: ${n0(fg(v, '1'))} หลัง · ≥ 2 ครั้ง: ${n0(fg(v, '2'))} หลัง · ≥ 3 ครั้ง: ${n0(fg(v, '3'))} หลัง`);
      out.push(`• ใกล้ลำน้ำ ≤ 300 ม. และเคยท่วม: ${n0(v.near300_ff1)} หลัง (ควรตรวจสอบก่อน)`);
    } else out.push('• ยังไม่มีชั้นน้ำท่วมซ้ำซาก');
  }
  if (t) out.push(`• ทั้ง ต.จันอัด ${n0(t.n)} หลัง: เคยท่วม ${n0(fg(t, '1'))} หลัง · ใกล้ลำน้ำ ≤ 300 ม. และเคยท่วม ${n0(t.near300_ff1)} หลัง`);
  if (v || t) out.push(`(ข้อมูลคงที่ · น้ำท่วมซ้ำซาก GISTDA ปี 2554–2566 ดึงเมื่อ ${dd((sb.inputs || {}).floodfreq_updated_at)} · คำนวณ ${dd(sb.updated_at)})`);
  // ② สถานการณ์ลำเชียงไกรตอนนี้ (ไฟล์ live ชุดเดียวกับ "สถานการณ์น้ำ")
  const m = (tw.waterlevel || []).find(s => s.code === 'M.188A');
  const lck = (code) => { const h = ((rid.hist || {})[code] || []).filter(r => r[2] != null), i = (rid.status === 'ok' ? rid.items || [] : []).find(x => x.code === code);
    if (i && i.pct != null && (!h.length || i.date >= h[h.length - 1][0])) return { pct: i.pct, date: i.date };
    return h.length ? { pct: h[h.length - 1][2], date: h[h.length - 1][0] } : null; };
  const up = lck('rsv300'), lo = lck('rsv292'), ed = (ec.days || []).filter(x => x[1] != null);
  out.push('', '🌊 สถานการณ์ลำเชียงไกรตอนนี้');
  out.push(`• ระดับน้ำ M.188A${m ? ' ' + m.name : ''}: ${m && m.storage_pct != null ? `${n0(m.storage_pct)}% ของตลิ่ง · ${bank(m.storage_pct)} (${tt(m.measured_at)})` : 'ไม่มีข้อมูล'}`);
  out.push(`• อ่างลำเชียงไกรตอนบน ${up ? n0(up.pct) + '%' : '—'} · ตอนล่าง ${lo ? n0(lo.pct) + '%' : '—'} (ข้อมูลวันที่ ${dd((lo && lo.date) || (up && up.date))})`);
  out.push(`• ฝนข้างหน้า ECMWF: 24 ชม. ${ed.length ? f1(ec.next24_mm) : '—'} มม. · 72 ชม. ${ed.length ? f1(ec.next72_mm) : '—'} มม.`);
  out.push(`• น้ำท่วมตรวจพบ ต.จันอัด (GISTDA 7 วัน): ${gf.status === 'ok' ? (Math.round((gf.by_tambon || {})[TCODE] || 0) ? `${n0((gf.by_tambon || {})[TCODE])} ไร่` : 'ไม่พบ') : 'ไม่มีข้อมูล'}`);
  out.push('', `🗺 แผนที่ Sandbox: ${SITE}`);
  out.push('', '⚠️ อาคารคือรูปหลังคาจากภาพดาวเทียม ไม่ใช่ครัวเรือน · ตำแหน่งบ้านด่านติงประมาณจากกลุ่มอาคาร ยังไม่ยืนยันกับ อบต. · '
    + `${(cfg.bank || {}).verified ? '' : 'เกณฑ์ตลิ่ง 70/90% ยังไม่ยืนยันกับหน่วยงาน · '}ไม่ใช่ประกาศเตือนภัยทางการ โปรดติดตามประกาศจาก ปภ. และ อบต.`,
    'ที่มา: Google Open Buildings · OpenStreetMap · GISTDA · สสน. (ThaiWater) · กรมชลประทาน · ECMWF');
  return out.join('\n');
}
// <<< sandboxReport

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
    reports: { total_90d: reports.length, by_type: cnt(reports, r => r.type), by_status: cnt(reports, r => r.status || 'new'), by_month: cnt(reports, r => (r.created_at || '').slice(0, 7)) },
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
    try { msg = await waterStatus(); } catch (e) { msg = `ดึงข้อมูลสถานการณ์ไม่สำเร็จชั่วคราว\nดูแผนที่: ${SITE_URL}region/\n\n${DISCLAIMER}`; }
    return reply(ev, env, [text(msg)]);
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
      { to: id, messages: [text(`☀️ รายงานประจำวัน\n${msg}`)] }, 'push-group');
    left -= n;
    await env.USERS.put(`group:${id}`, JSON.stringify({ ...g, last_push: nowIso(), members: n }));
  }
}


// ─── รายงานสำหรับแผนที่เว็บ (สาธารณะ · ไม่มีข้อมูลส่วนบุคคล) ─────────────
// แสดงเฉพาะ "น้ำท่วมบ้าน" และ "ถนนน้ำท่วม/ขาด" ที่แชร์ตำแหน่ง · ย้อนหลัง 7 วัน
// ไม่ส่งรายละเอียด/ที่อยู่/ผู้รายงาน · เหตุที่ปิดแล้ว (status closed) ไม่แสดง
// น้ำท่วม/ถนน: ปัดตำแหน่งทศนิยม 3 ตำแหน่ง (~100 ม.)
// ขอความช่วยเหลือ (v4.13 ตามคำแนะนำผู้ทรงคุณวุฒิ): ตำแหน่งจริง (ทศนิยม 5 ตำแหน่ง ~1 ม.) ให้ทุกคนเห็น · help_by_village = เฉพาะคำขอเก่าที่ไม่มีตำแหน่ง
const PUBLIC_DAYS = 7;
async function publicReports(env) {
  const items = [], help = {}, noLoc = {};
  for (const r of await listReports(env, PUBLIC_DAYS)) {
    if (r.status === 'closed') continue;
    const village = String(r.village || 'ไม่ระบุ').slice(0, 40), isHelp = r.type === HELP;
    if (r.lat == null || r.lon == null) { const m = isHelp ? help : noLoc; m[village] = (m[village] || 0) + 1; continue; }
    const d = isHelp ? 1e5 : 1e3;
    items.push({ id: r.id, type: r.type, village, lat: Math.round(r.lat * d) / d, lon: Math.round(r.lon * d) / d, precise: isHelp,
      created_at: r.created_at, by: r.reporter_role === 'adm' ? 'adm' : 'public', status: r.status || 'new' });
  }
  return new Response(JSON.stringify({ updated_at: nowIso(), days: PUBLIC_DAYS, items, help_by_village: help, no_location_by_village: noLoc }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': 'https://sarochiiii.github.io', 'Cache-Control': 'public, max-age=120' } });
}

// ─── v4.13 หน้าติดตามเหตุของ อบต. (region/monitor.html) ─────────────────
// ต้องมี header X-Monitor-Key ตรงกับ Secret MONITOR_KEY (หลายรหัสคั่นด้วย , ได้ · แต่ละรหัส ≥ 24 ตัวอักษร)
// ส่งตำแหน่งจริงและรายละเอียดให้ อบต. · ไม่ส่งรหัสผู้ใช้ LINE ของผู้รายงาน
const STATUSES = ['new', 'ack', 'closed'];
function sameKey(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function monitor(request, env, url) {
  const cors = { 'Access-Control-Allow-Origin': 'https://sarochiiii.github.io', 'Access-Control-Allow-Headers': 'Content-Type, X-Monitor-Key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Max-Age': '600' };
  const res = (b, status = 200) => new Response(JSON.stringify(b), { status,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const keys = String(env.MONITOR_KEY || '').split(',').map((k) => k.trim()).filter((k) => k.length >= 24);
  if (!keys.length) return res({ error: 'not_configured' }, 503);
  const k = (request.headers.get('x-monitor-key') || '').trim();
  if (!keys.some((x) => sameKey(x, k))) return res({ error: 'forbidden' }, 403);

  if (request.method === 'GET' && url.pathname === '/api/monitor') {
    const items = (await listReports(env, MONITOR_DAYS)).map((r) => ({ id: r.id, type: r.type, village: r.village || '',
      lat: r.lat ?? null, lon: r.lon ?? null, address: r.address || '', note: r.note || '', created_at: r.created_at,
      status: r.status || 'new', status_at: r.status_at || null, closed_by: r.closed_by || null,
      by: r.reporter_role === 'adm' ? 'adm' : 'public' }));
    return res({ updated_at: nowIso(), days: MONITOR_DAYS, items });
  }
  if (request.method === 'POST' && url.pathname === '/api/monitor/status') {
    let b;
    try { b = await request.json(); } catch { return res({ error: 'bad_json' }, 400); }
    const id = String((b && b.id) || '').toUpperCase(), st = String((b && b.status) || '');
    if (!REPORT_ID.test(id) || !STATUSES.includes(st)) return res({ error: 'bad_request' }, 400);
    const r = await env.USERS.get(`report:${id}`, 'json');
    if (!r) return res({ error: 'not_found' }, 404);
    const next = { ...r, status: st, status_at: nowIso(), closed_by: st === 'closed' ? 'abt' : null };
    await saveReport(env, next);
    return res({ ok: true, id, status: st, status_at: next.status_at });
  }
  return res({ error: 'not_found' }, 404);
}
