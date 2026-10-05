/* รายงานสถานการณ์น้ำ ต.จันอัด สำหรับ LINE — ข้อความเดียวกันทั้งปุ่มบนเว็บ และคำสั่ง "สถานการณ์น้ำ" ใน LINE OA
   ฟังก์ชันระหว่างเครื่องหมาย >>> / <<< ต้องเหมือนกับใน line/kv/worker.js ทุกตัวอักษร (tests/report.test.mjs ตรวจให้)
   ข้อมูลเข้า = ไฟล์ snapshot ที่ Actions เขียนทุกชั่วโมง: thaiwater_region.json · tw_province.json · rid_reservoir.json · gistda_flood_7d.geojson · config.json */
(function () {
  'use strict';
  // >>> situationReport
  function situationReport(D) {
    const tw = D.tw || {}, prov = D.prov || {}, rid = D.rid || {}, gf = D.gf || {}, cfg = D.cfg || {};
    const AREA = ['โนนไทย', 'โนนสูง'], TCODE = '301010', SITE = 'https://sarochiiii.github.io/NR-flood-sdss/region/';
    const f0 = (v) => v == null ? '—' : String(Math.round(v)), f1 = (v) => v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1);
    const tt = (s) => { if (!s) return '—';
      const d = new Date(/T/.test(s) ? s : String(s).replace(' ', 'T') + (String(s).length <= 10 ? 'T00:00' : '') + ':00+07:00');
      return isNaN(d.getTime()) ? String(s) : d.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' น.'; };
    const dd = (s) => s ? new Date(s + 'T00:00:00+07:00').toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short' }) : '—';
    const bank = (p) => p == null ? 'ไม่มีข้อมูล' : p >= 100 ? 'ล้นตลิ่ง' : p >= 90 ? 'ใกล้ล้นตลิ่ง' : p >= 70 ? 'ค่อนข้างสูง' : 'ปกติ';
    const out = ['📋 รายงานสถานการณ์น้ำ ต.จันอัด อ.โนนสูง', `ข้อมูลรวบรวม ณ ${tt(tw.updated_at)}`];
    // ① ฝนสถานีตรวจวัด 24 ชม. (ThaiWater) — ในพื้นที่ = สถานีใน อ.โนนไทย/โนนสูง
    const rain = (tw.rain || []).filter(s => s.rain_24h != null).sort((a, b) => b.rain_24h - a.rain_24h);
    const rIn = rain.filter(s => AREA.includes(s.amphoe)), rOut = rain.filter(s => !AREA.includes(s.amphoe));
    const rT = rain.map(s => s.time).filter(Boolean).sort().pop();
    out.push('', `🌧 ฝนสถานีตรวจวัด 24 ชม. (ถึง ${tt(rT)})`);
    out.push(rIn.length ? `• สูงสุดในพื้นที่: ${rIn[0].name} อ.${rIn[0].amphoe} ${f1(rIn[0].rain_24h)} มม.` : '• ไม่มีข้อมูลสถานีในพื้นที่');
    out.push(`• ฝนหนัก ≥ 35.1 มม.: ในพื้นที่ ${rIn.filter(s => s.rain_24h >= 35.1).length}/${rIn.length} สถานี · รอบพื้นที่ ${rOut.filter(s => s.rain_24h >= 35.1).length}/${rOut.length} สถานี`);
    if (rOut.length && rOut[0].rain_24h >= 10.1) out.push(`• สูงสุดรอบพื้นที่: ${rOut[0].name} อ.${rOut[0].amphoe} ${f1(rOut[0].rain_24h)} มม.`);
    // ② ระดับน้ำสถานีตรวจวัด (% ของตลิ่ง ThaiWater)
    const wl = (tw.waterlevel || []).filter(s => s.storage_pct != null).sort((a, b) => b.storage_pct - a.storage_pct);
    const m = (tw.waterlevel || []).find(s => s.code === 'M.188A');
    out.push('', '🌊 ระดับน้ำสถานีตรวจวัด (% ของตลิ่ง)');
    out.push(`• ลำเชียงไกร M.188A ${m ? m.name : ''}: ${m && m.storage_pct != null ? `${f0(m.storage_pct)}% · ${bank(m.storage_pct)} (${tt(m.measured_at)})` : 'ไม่มีข้อมูล'}`);
    const hi = wl.filter(s => s.storage_pct >= 90);
    out.push(hi.length ? `• ใกล้/ล้นตลิ่ง ≥ 90%: ${hi.slice(0, 4).map(s => `${s.code} ${s.name} อ.${s.amphoe} ${f0(s.storage_pct)}%`).join(' · ')}${hi.length > 4 ? ` และอีก ${hi.length - 4} สถานี` : ''}`
      : `• ไม่มีสถานีใกล้/ล้นตลิ่ง (จาก ${wl.length} สถานี)`);
    // ③ อ่างเก็บน้ำ — ลำเชียงไกรจากกรมชลประทาน · ทั้งจังหวัดจาก ThaiWater + กรมชลประทาน
    const items = rid.status === 'ok' ? (rid.items || []) : [];
    // อ่างลำเชียงไกร: ค่าล่าสุดใน hist ([วันที่, ล้าน ลบ.ม., %, ...]) เพราะค่าของวันนี้ใน items มักยังว่างจนกรมชลประทานรายงาน
    const lck = (code) => { const h = ((rid.hist || {})[code] || []).filter(r => r[2] != null), i = items.find(x => x.code === code);
      if (i && i.pct != null && (!h.length || i.date >= h[h.length - 1][0])) return { pct: i.pct, date: i.date, d: h.length && h[h.length - 1][0] < i.date ? i.pct - h[h.length - 1][2] : null };
      return h.length ? { pct: h[h.length - 1][2], date: h[h.length - 1][0], d: h.length > 1 ? h[h.length - 1][2] - h[h.length - 2][2] : null } : null; };
    const ch = (x) => x.d != null && Math.abs(x.d) >= 0.05 ? ` (${x.d > 0 ? 'เพิ่ม' : 'ลด'} ${f1(Math.abs(x.d))}% จากวันก่อน)` : '';
    const up = lck('rsv300'), lo = lck('rsv292');
    out.push('', `🏞 อ่างเก็บน้ำ (ข้อมูลวันที่ ${dd((lo && lo.date) || (up && up.date))})`);
    out.push(`• ลำเชียงไกรตอนบน ${up ? `${f0(up.pct)}%${up.pct > 100 ? ' เกินความจุ' : ''}${ch(up)}` : '—'}`);
    out.push(`• ลำเชียงไกรตอนล่าง ${lo ? `${f0(lo.pct)}%${lo.pct > 100 ? ' เกินความจุ' : ''}${ch(lo)}` : '—'}`);
    const norm = (x) => String(x || '').replace(/\s+/g, '').replace(/^อ่างเก็บน้ำ/, '');
    const dams = new Map();
    (prov.dams || []).filter(d => !d.stale && d.pct != null).forEach(d => dams.set(norm(d.name), { name: d.name, pct: d.pct }));
    items.filter(i => i.pct != null).forEach(i => dams.set(norm(i.name), { name: i.name.replace(/\s+/g, ''), pct: i.pct }));
    const full = [...dams.values()].filter(d => d.pct >= 80).sort((a, b) => b.pct - a.pct);
    out.push(full.length ? `• อ่างในจังหวัด ≥ 80%: ${full.length} แห่ง · ${full.slice(0, 3).map(d => `${d.name} ${f0(d.pct)}%`).join(' · ')}` : `• ไม่มีอ่างในจังหวัด ≥ 80% (จาก ${dams.size} อ่าง)`);
    // ④ น้ำท่วมตรวจพบ (GISTDA 7 วัน)
    out.push('', `🛰 น้ำท่วมตรวจพบจากดาวเทียม (GISTDA 7 วัน · ${tt(gf.updated_at)})`);
    if (gf.status === 'ok') {
      const bt = gf.by_tambon || {}, c = Math.round(bt[TCODE] || 0);
      out.push(`• ต.จันอัด: ${c ? `${c.toLocaleString('th-TH')} ไร่` : 'ไม่พบ'} · 26 ตำบล: ${Math.round(gf.total_rai || 0).toLocaleString('th-TH')} ไร่ (${Object.keys(bt).length} ตำบล)`);
    } else out.push('• ไม่มีข้อมูล');
    out.push('', `⚠️ ${(cfg.bank || {}).verified ? '' : 'เกณฑ์ตลิ่ง 70/90% ยังไม่ยืนยันกับหน่วยงาน · '}ไม่ใช่ประกาศเตือนภัยทางการ โปรดติดตามประกาศจาก ปภ. และ อบต.`,
      'ที่มา: สสน. (ThaiWater) · กรมชลประทาน · GISTDA', `แผนที่: ${SITE}`);
    return out.join('\n');
  }
  // <<< situationReport
  window.SDSS_REPORT = { situationReport };

  /* ---------- ปุ่มบนเว็บ: สร้าง → คัดลอก / แชร์เข้า LINE (ไม่ผ่าน OA จึงไม่เสียโควตา) ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    const $ = (id) => document.getElementById(id), btn = $('btn-lrep');
    if (!btn) return;
    const get = (p) => fetch(p, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null);
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = 'กำลังสร้างรายงาน…';
      const [tw, prov, rid, gf, cfg] = await Promise.all(['data/live/thaiwater_region.json', 'data/live/tw_province.json',
        'data/live/rid_reservoir.json', 'data/live/gistda_flood_7d.geojson', 'config.json'].map(get));
      const txt = situationReport({ tw, prov, rid, gf, cfg });
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
