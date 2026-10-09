/* รายงานสถานการณ์น้ำ ต.จันอัด สำหรับ LINE — ข้อความเดียวกันทั้งปุ่มบนเว็บ และคำสั่ง "สถานการณ์น้ำ" ใน LINE OA
   ฟังก์ชันระหว่างเครื่องหมาย >>> / <<< ต้องเหมือนกับใน line/kv/worker.js ทุกตัวอักษร (tests/report.test.mjs ตรวจให้)
   ข้อมูลเข้า = ไฟล์ snapshot ที่ Actions เขียนทุกชั่วโมง: thaiwater_region.json · rid_reservoir.json · gistda_flood_7d.geojson · ecmwf.json · config.json */
(function () {
  'use strict';
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
  // รายงาน SDSS บ้านด่านติง (คำสั่ง "รายงานบ้านด่านติง" ใน LINE OA + ปุ่มในหน้า /chanat/) — ต้องเหมือนใน line/kv/worker.js เช่นกัน
  // sb = region/data/sandbox/summary.json (scripts/region/build_sandbox_summary.py · วิธีเดียวกับแผง SDSS) · ที่เหลือ = ไฟล์ live ชุดเดียวกับ situationReport
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
  window.SDSS_REPORT = { situationReport, sandboxReport };

  /* ---------- ปุ่มบนเว็บ: สร้าง → คัดลอก / แชร์เข้า LINE (ไม่ผ่าน OA จึงไม่เสียโควตา) ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    const $ = (id) => document.getElementById(id), btn = $('btn-lrep');
    if (!btn) return;
    const get = (p) => fetch(p, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null);
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = 'กำลังสร้างรายงาน…';
      const [tw, rid, gf, ec, cfg] = await Promise.all(['data/live/thaiwater_region.json', 'data/live/rid_reservoir.json',
        'data/live/gistda_flood_7d.geojson', 'data/live/ecmwf.json', 'config.json'].map(get));
      const txt = situationReport({ tw, rid, gf, ec, cfg });
      $('lrep-text').textContent = txt;
      $('lrep-share').href = 'https://line.me/R/share?text=' + encodeURIComponent(txt);
      $('lrep').hidden = false;
      btn.disabled = false; btn.textContent = '📋 สร้างรายงานใหม่';
    };
    $('lrep-copy').onclick = async () => {
      const t = $('lrep-text').textContent;
      try { await navigator.clipboard.writeText(t); }
      catch (e) { const r = document.createRange(); r.selectNodeContents($('lrep-text')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.execCommand('copy'); }
      $('lrep-copy').textContent = 'คัดลอกแล้ว ✓'; setTimeout(() => $('lrep-copy').textContent = 'คัดลอกข้อความ', 2000);
    };
  });
})();
