/* เลเยอร์เพิ่มเติมจากหลายแหล่ง — โหลดเมื่อผู้ใช้เปิดเท่านั้น (lazy) เพื่อไม่ให้หน้าแรกช้า
   แหล่งที่เรียกจากเบราว์เซอร์ตรง: ThaiWater public API, RainViewer
   แหล่งที่ผ่าน GitHub Actions (ต้องใช้ key): GISTDA flood 7 วัน, Sentinel-1 (Earth Engine) */
document.addEventListener('sdss:ready', async () => {
  'use strict';
  const { map, cfg, hex } = window.SDSS;
  const L_ = cfg.layers;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v)) ? '—' : Number(v).toFixed(d);
  const tTime = (s) => s ? new Date(String(s).replace(' ', 'T') + (/[zZ+]/.test(s) ? '' : '+07:00'))
    .toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—';

  async function json(url, opt) {
    const r = await fetch(url, Object.assign({ cache: 'no-cache' }, opt || {}));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  /* ---------- ThaiWater: เรียกตรง ถ้าไม่ได้ใช้ snapshot ---------- */
  let twCache = null;
  function bbox() {
    const b = L.geoJSON(window.SDSS.amphoe || window.SDSS.tambon).getBounds(), d = L_.station_buffer_deg;
    return [b.getWest() - d, b.getSouth() - d, b.getEast() + d, b.getNorth() + d];
  }
  const MARK = {};   // key → circleMarker สำหรับกดจากรายการสถานี
  // จุดอยู่ในขอบเขตสองอำเภอหรือไม่ (ray casting บน amphoe.geojson)
  const AREA = (window.SDSS.amphoe || window.SDSS.tambon).features.flatMap(f =>
    f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates);
  function inRing(x, y, r) {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  const inArea = (la, lo) => AREA.some(p => inRing(lo, la, p[0]) && !p.slice(1).some(h => inRing(lo, la, h)));
  // ในพื้นที่ = อยู่ในสองอำเภอ · ใกล้เคียง = อยู่ใน buffer รอบพื้นที่ · นอกพื้นที่ = ไกลกว่านั้น (ข้อมูลระดับจังหวัด)
  // ลุ่มน้ำต้นทาง (HydroBASINS L12 ตรวจกับ D.A กรมชลประทานแล้ว): LCK = ลำเชียงไกรเหนือ M.188A · MUN_UP = มูลเหนือ M.2A
  // TAK = ลำตะคองเหนือ M.164 · STUDY = ทั้งหมดเหนือ M.195 (ลำเชียงไกรบรรจบมูลระหว่าง M.194 กับ M.195)
  const BAS = await fetch('data/basins.geojson', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null);
  const BP = {}; (BAS ? BAS.features : []).forEach(f => BP[f.properties.id] = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates);
  const inPolys = (la, lo, P) => (P || []).some(p => inRing(lo, la, p[0]) && !p.slice(1).some(h => inRing(lo, la, h)));
  const basinOf = (la, lo) => inPolys(la, lo, BP.LCK) ? 'LCK' : inPolys(la, lo, BP.MUN_UP) ? 'MUN_UP' : inPolys(la, lo, BP.TAK) ? 'TAK'
    : inPolys(la, lo, BP.STUDY) ? 'STUDY' : null;
  // เกี่ยวข้อง = อยู่ในสองอำเภอ หรืออยู่ในลุ่มน้ำที่ไหลเข้าพื้นที่ (ถ้ายังไม่มีไฟล์ลุ่มน้ำ ถือว่าเกี่ยวข้องทั้งหมด)
  const rel = (s) => !BAS || inArea(s.lat, s.lon) || basinOf(s.lat, s.lon) !== null;
  const tag = (s) => { if (inArea(s.lat, s.lon)) return '<span class="tag-in">ในพื้นที่</span>';
    if (!BAS) return '<span class="tag-out">นอกพื้นที่</span>';
    const b = basinOf(s.lat, s.lon);
    return b === 'LCK' ? '<span class="tag-up">ต้นน้ำลำเชียงไกร</span>' : b === 'MUN_UP' ? '<span class="tag-up">ต้นน้ำมูล</span>'
      : b === 'TAK' ? '<span class="tag-up">ต้นน้ำลำตะคอง</span>'
      : b === 'STUDY' ? '<span class="tag-up">ในลุ่มน้ำ</span>' : '<span class="tag-out">นอกลุ่มน้ำ</span>'; };
  const inBox = (la, lo, bb) => la != null && lo != null && lo >= bb[0] && lo <= bb[2] && la >= bb[1] && la <= bb[3];
  const n = (x) => { const v = parseFloat(x); return Number.isFinite(v) ? v : null; };
  const th = (x) => (x && typeof x === 'object') ? x.th : x;

  function thaiwater() {
    if (!twCache) twCache = loadThaiwater().catch(e => { twCache = null; throw e; });
    return twCache;
  }
  async function loadThaiwater() {
    const bb = bbox(), out = { rain: [], waterlevel: [], via: 'api', time: new Date().toISOString() };
    try {
      const [r, w] = await Promise.all([json(L_.thaiwater_base + 'rain_24h'), json(L_.thaiwater_base + 'waterlevel_load')]);
      (r.data || []).forEach(x => {
        const s = x.station || {}, la = n(s.tele_station_lat), lo = n(s.tele_station_long);
        if (!inBox(la, lo, bb)) return;
        out.rain.push({ name: th(s.tele_station_name), lat: la, lon: lo, rain_24h: n(x.rain_24h), rain_1h: n(x.rain_1h),
          time: x.rainfall_datetime, amphoe: th((x.geocode || {}).amphoe_name) });
      });
      ((w.waterlevel_data || {}).data || []).forEach(x => {
        const s = x.station || {}, la = n(s.tele_station_lat), lo = n(s.tele_station_long);
        if (!inBox(la, lo, bb)) return;
        out.waterlevel.push({ code: String(s.tele_station_oldcode || s.id), name: th(s.tele_station_name), lat: la, lon: lo,
          level_msl: n(x.waterlevel_msl), bank_msl: n(s.min_bank), storage_pct: n(x.storage_percent),
          discharge: n(x.discharge), measured_at: x.waterlevel_datetime, amphoe: th((x.geocode || {}).amphoe_name) });
      });
    } catch (e) {
      console.warn('ThaiWater API ตรงไม่สำเร็จ ใช้ snapshot', e);
      const s = await json('data/live/thaiwater_region.json').catch(() => null);
      if (!s || !s.updated_at) throw new Error('ไม่มีข้อมูล ThaiWater');
      Object.assign(out, { rain: s.rain, waterlevel: s.waterlevel, via: 'snapshot', time: s.updated_at });
    }
    return out;
  }

  const imgs = (str) => [...new Set(String(str || '').split(',').map(x => x.trim()).filter(Boolean))].map(x => {
    const m = x.match(/^(.*?)_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})$/);
    const sensor = m && ({ rd2: 'RADARSAT-2', S1A: 'Sentinel-1A', S1B: 'Sentinel-1B', S1C: 'Sentinel-1C', S1D: 'Sentinel-1D' }[m[1]] || m[1]);
    return m ? `${sensor} ${+m[4]}/${+m[3]} ${m[5]}:${m[6]}` : x;
  }).join(', ') || '—';

  /* ---------- ThaiWater จังหวัด (ฝนสะสม 3/7 วัน, อ่างเก็บน้ำ) — มาจาก Actions เท่านั้น เพราะ CORS ---------- */
  let provCache = null;
  function province() {
    if (!provCache) provCache = Promise.all([json('data/live/tw_province.json'), json('data/live/rid_reservoir.json').catch(() => null)]).then(([d, rid]) => {
      if (!d.updated_at) throw new Error('รอ workflow รันรอบแรก');
      d.dams = mergeRid(d.dams || [], rid);
      return d;
    }).catch(e => { provCache = null; throw e; });
    return provCache;
  }
  // ใช้ค่าจากกรมชลประทาน (อัปเดตเร็วกว่า ThaiWater ~1 วัน) เมื่อใหม่กว่าหรือเท่ากัน และเพิ่มอ่างที่ ThaiWater ไม่มี
  function mergeRid(dams, rid) {
    if (!rid || rid.status !== 'ok') return dams;
    const norm = (x) => String(x || '').replace(/\s+/g, '');   // ชื่อสองแหล่งเว้นวรรคต่างกัน เช่น "อ่างเก็บน้ำ บ้านซับกระจาย"
    const byName = new Map(dams.map(d => [norm(d.name), d]));
    (rid.items || []).forEach(r => {
      if (!r.date || r.pct == null) return;
      let d = byName.get(norm(r.name));
      if (!d) { d = { name: r.name.replace(/\s+/g, ''), kind: 'medium', lat: r.lat, lon: r.lon, amphoe: null }; dams.push(d); byName.set(norm(r.name), d); }
      if (!d.date || r.date >= d.date) Object.assign(d, { pct: r.pct, storage: r.storage, inflow: r.inflow, released: r.release,
        date: r.date, stale: false, src: 'กรมชลประทาน', pct_prev: r.pct_prev });
      const h = (rid.hist || {})[r.code];
      if (h) d.ridHist = h.map(x => [x[0], x[2]]);
    });
    return dams;
  }
  const hhmm = (iso) => new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });

  /* ---------- ประวัติ (บันทึกโดย Actions ทุกชั่วโมง) → แนวโน้มและกราฟ ---------- */
  let ridCache = null;   // ข้อมูลสถานีกรมชลประทาน (ลำน้ำ, ราคาศูนย์เสา, พื้นที่รับน้ำ)
  const rid = () => ridCache || (ridCache = json('data/rid_stations.json').then(d => d.stations).catch(() => ({})));
  let histCache = null;
  function history() {
    if (!histCache) histCache = json('data/live/history.json').catch(() => ({ wl: {}, dam: {} }));
    return histCache;
  }
  const tparse = (t) => new Date(String(t).replace(' ', 'T').slice(0, 16) + (String(t).length <= 10 ? 'T00:00' : '') + ':00+07:00');
  // แนวโน้มระดับน้ำ: ค่าล่าสุดเทียบจุดก่อนหน้า และเทียบประมาณ 24 ชม. ก่อน (ใช้ระดับ ม.รทก. ละเอียดกว่า %)
  function trendWL(h, s) {
    const arr = (h.wl[s.code] || []).filter(x => x[2] != null);
    const cur = s.measured_at && s.level_msl != null ? [s.measured_at, s.storage_pct, s.level_msl] : arr[arr.length - 1];
    if (!cur) return null;
    const before = arr.filter(x => x[0] < cur[0]);
    const prev = before[before.length - 1];
    const t0 = tparse(cur[0]) - 24 * 3.6e6;
    const d24 = before.filter(x => tparse(x[0]) <= t0).pop();
    return { d: prev ? (cur[2] - prev[2]) * 100 : null, prevT: prev && prev[0],
      d24: d24 ? (cur[2] - d24[2]) * 100 : null, series: [...before, cur].map(x => [tparse(x[0]), x[2]]) };
  }
  function trendDam(h, d) {
    const arr = (d.ridHist && d.ridHist.length > 1 ? d.ridHist : (h.dam[d.name] || [])).filter(x => x[0] < d.date);
    const prev = arr[arr.length - 1];
    return { d: prev ? d.pct - prev[1] : null, prevT: prev && prev[0],
      series: [...arr, [d.date, d.pct]].map(x => [tparse(x[0]), x[1]]) };
  }
  function arrow(v, unit, dec) {
    if (v == null) return '<span class="muted">—</span>';
    if (Math.abs(v) < (unit === 'ซม.' ? 1 : 0.05)) return `<span class="tr-flat">▬ คงที่</span>`;
    return v > 0 ? `<span class="tr-up">▲ +${fmt(v, dec)} ${unit}</span>` : `<span class="tr-dn">▼ ${fmt(v, dec)} ${unit}</span>`;
  }
  const arrowShort = (v, unit) => v == null ? '' : Math.abs(v) < (unit === 'cm' ? 1 : 0.05) ? ' <span class="tr-flat">▬</span>'
    : v > 0 ? ' <span class="tr-up">▲</span>' : ' <span class="tr-dn">▼</span>';
  function spark(series, label) {
    if (!series || series.length < 2) return `<div class="spark-empty">${label}: กำลังเก็บประวัติ (ต้องมีอย่างน้อย 2 ช่วงเวลา)</div>`;
    const W = 220, H = 44, xs = series.map(p => +p[0]), ys = series.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), ry = (y1 - y0) || 1;
    const pts = series.map(p => `${(4 + (W - 8) * ((+p[0] - x0) / ((x1 - x0) || 1))).toFixed(1)},${(H - 4 - (H - 8) * ((p[1] - y0) / ry)).toFixed(1)}`).join(' ');
    const d = (t) => new Date(t).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
    return `<div class="spark"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${label}">
      <polyline points="${pts}" fill="none" stroke="#0E7C7B" stroke-width="1.8"/></svg>
      <div class="spark-lab"><span>${d(x0)}</span><span>${label}</span><span>${d(x1)}</span></div></div>`;
  }

  /* ---------- สถานะเทียบตลิ่ง + เวลาคาดถึงตลิ่ง ---------- */
  const BK = cfg.bank;
  function bankStatus(s, t) {
    if (s.storage_pct == null) return { key: 'na', label: 'ไม่มีข้อมูล', color: '#94A3B8', rank: -1 };
    const lv = BK.levels.find(l => s.storage_pct >= l.min);
    const rank = BK.levels.length - 1 - BK.levels.indexOf(lv);
    if (lv.key === 'over' && t && t.d != null && t.d >= BK.severe.rise_cm) return Object.assign({ rank: rank + 1 }, BK.severe);
    return Object.assign({ rank }, lv);
  }
  // อัตราขึ้นเฉลี่ยช่วง lookback ชม. → ชั่วโมงที่น้ำจะถึงระดับตลิ่งต่ำสุด ถ้าอัตราคงเดิม
  function bankEta(s, t) {
    const E = BK.eta;
    if (!t || !t.series || s.bank_msl == null || s.level_msl == null || s.level_msl >= s.bank_msl) return null;
    const last = t.series[t.series.length - 1], from = +last[0] - E.lookback_h * 3.6e6;
    const base = t.series.filter(p => +p[0] >= from)[0];
    if (!base) return null;
    const span = (+last[0] - +base[0]) / 3.6e6;
    if (span < E.min_span_h) return null;
    const rate = (last[1] - base[1]) * 100 / span;                  // ซม./ชม.
    if (rate < E.min_rate_cm_h) return null;
    const h = (s.bank_msl - s.level_msl) * 100 / rate;
    return h <= E.max_hours ? { h, rate, span } : null;
  }
  const etaTxt = (e) => e ? `คาดถึงตลิ่งใน ~${e.h < 1 ? '<1' : Math.round(e.h)} ชม. ถ้าน้ำขึ้นด้วยอัตราเดิม (${fmt(e.rate, 1)} ซม./ชม. เฉลี่ย ${Math.round(e.span)} ชม. ล่าสุด)` : '';

  /* ---------- สีตามเกณฑ์ ---------- */
  const RAIN_BR = [[90.1, '#08306B'], [35.1, '#2171B5'], [10.1, '#6BAED6'], [0.1, '#C6DBEF'], [-1, '#E2E8F0']];
  const rainColor = v => (RAIN_BR.find(([b]) => (v ?? -1) >= b) || RAIN_BR[4])[1];
  const WL_BR = [[100, '#C0392B'], [70, '#E67E22'], [30, '#1E8449'], [-1e9, '#D68910']];
  const R7_BR = [[200, '#08306B'], [100, '#2171B5'], [50, '#6BAED6'], [10, '#C6DBEF'], [-1, '#E2E8F0']];
  const r7Color = v => (R7_BR.find(([b]) => (v ?? -1) >= b) || R7_BR[4])[1];
  // ช่วงสีอ่าง: > 100 เกินความจุ · 80–100 น้ำมาก · 50–80 ปานกลาง · 30–50 น้อย · < 30 น้อยวิกฤต
  const DAM_BR = [[100, '#7F1D1D'], [80, '#C0392B'], [50, '#1E8449'], [30, '#D68910'], [-1e9, '#92400E']];
  const damColor = (d) => d.stale || d.pct == null ? '#94A3B8' : DAM_BR.find(([b]) => d.pct > b || (b === 80 && d.pct >= 80))[1];
  // รายงานเหตุจาก LINE OA (Worker v4.13 · KV) — ไม่มีรายละเอียด/ผู้รายงาน · เหตุที่ปิดแล้วไม่ส่งมา
  // น้ำท่วม/ถนน: ตำแหน่งปัด ~100 ม. จุดแดง · ขอความช่วยเหลือ: ตำแหน่งจริง จุดม่วง SOS (คำแนะนำผู้ทรงคุณวุฒิ: ทุกคนเห็น · อบต. ติดตาม)
  async function reportsV4() {
    const LC = window.LINE_CFG || {};
    if (!LC.WEBHOOK) throw new Error('ยังไม่ได้ตั้ง WEBHOOK ใน liff/config.js');
    const d = await json(LC.WEBHOOK.replace(/\/$/, '') + '/api/reports');
    const now = Date.now(), items = d.items || [];
    const isHelp = r => r.type === 'ขอความช่วยเหลือ';
    const lyr = L.layerGroup(items.map(r => { const h = (now - Date.parse(r.created_at)) / 36e5, help = isHelp(r);
      const op = help ? 1 : h <= 24 ? 1 : h <= 72 ? 0.7 : 0.45;           // จางลงตามอายุรายงาน (ขอความช่วยเหลือไม่จาง)
      return L.marker([r.lat, r.lon], { opacity: op, zIndexOffset: help ? 1000 : 0, icon: L.divIcon({ className: '', iconSize: help ? [30, 30] : [22, 22], iconAnchor: help ? [15, 15] : [11, 11],
          html: help ? `<span class="rp-sos${r.status === 'ack' ? ' ack' : ''}" title="${esc(r.type)}">SOS</span>`
            : `<span class="rp-dot${h <= 24 ? ' new' : ''}" title="${esc(r.type)}"></span>` }) })   // จุดแดงกระพริบ (24 ชม. แรกกระพริบแรงกว่า)
        .bindPopup(`<b>${help ? '🆘 ' : ''}${esc(r.type)}</b> · ${esc(r.village)}<br>
          <span class="bk" style="background:${r.status === 'ack' ? '#1E8449' : r.by === 'adm' ? '#0E7C7B' : '#94A3B8'}">${r.status === 'ack' ? 'อบต. รับทราบแล้ว' : r.by === 'adm' ? 'รายงานโดย ADM' : 'รายงานจากประชาชน · ยังไม่ได้ตรวจสอบ'}</span>
          <div class="trend">${new Date(r.created_at).toLocaleString('th-TH')} · ${h < 1 ? 'ไม่ถึง 1 ชม.' : Math.round(h) + ' ชม.'}ที่แล้ว</div>
          ${help ? `<a href="https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lon}" target="_blank" rel="noopener">นำทางไปจุดนี้ (Google Maps)</a>` : ''}
          <div class="muted" style="font-size:11px">${help ? 'ตำแหน่งตามที่ผู้ขอแชร์ · ไม่แสดงตัวผู้ขอและรายละเอียด · อันตรายต่อชีวิตโทร 1669 / 1784' : 'ตำแหน่งโดยประมาณ (~100 ม.) · ไม่แสดงตัวผู้รายงาน'}</div>`); }));
    const nHelp = items.filter(isHelp).length, nOld = Object.values(d.help_by_village || {}).reduce((a, b) => a + b, 0),
      nNo = Object.values(d.no_location_by_village || {}).reduce((a, b) => a + b, 0);
    return { lyr, sub: `${items.length - nHelp} จุดแจ้งเหตุ` + (nHelp ? ` · 🆘 ขอความช่วยเหลือ ${nHelp} จุด` : '') + ` ใน ${d.days} วัน`
        + (nNo ? ` · ไม่มีตำแหน่ง ${nNo}` : '') + (nOld ? ` · ขอความช่วยเหลือไม่มีตำแหน่ง ${nOld}` : ''),
      attr: 'จุดแจ้งเหตุ/ขอความช่วยเหลือจาก LINE OA จันอัดบ้านฉัน (ยังไม่ได้ตรวจสอบ)' };
  }
  // GloFAS: สถานะจากค่ามัธยฐานพยากรณ์เทียบเกณฑ์ค่าสูงสุดรายปี (≈ รอบ 2/5/20 ปี)
  function glofasStatus(p) {
    const t = p.thresholds || {}, fc = p.fcst || [];
    const med = Math.max(...fc.map(r => r[1] ?? 0)), mx = Math.max(...fc.map(r => r[2] ?? r[1] ?? 0));
    if (t.q20 && med >= t.q20) return { rank: 3, label: 'คาดเกินรอบ 20 ปี', color: '#7F1D1D' };
    if (t.q5 && med >= t.q5) return { rank: 2, label: 'คาดเกินรอบ 5 ปี', color: '#C0392B' };
    if (t.q2 && med >= t.q2) return { rank: 1, label: 'คาดเกินรอบ 2 ปี', color: '#E67E22' };
    if (t.q2 && mx >= t.q2) return { rank: 0.5, label: 'บางชุดพยากรณ์เกินรอบ 2 ปี', color: '#F4D03F' };
    return { rank: 0, label: 'ต่ำกว่ารอบ 2 ปี', color: '#1E8449' };
  }
  function glofasChart(p, W) {
    const H = 90, past = p.past || [], fc = p.fcst || [], t = p.thresholds || {};
    const all = past.map(r => r[0]).concat(fc.map(r => r[0])); if (all.length < 2) return '';
    const ys = past.map(r => r[1]).concat(fc.flatMap(r => [r[1], r[2], r[3]])).filter(v => v != null).concat([t.q2 || 0, t.q5 || 0]);
    const y1 = Math.max(...ys) * 1.08 || 1, X = (d) => 4 + (W - 8) * all.indexOf(d) / (all.length - 1), Y = (v) => H - 4 - (H - 8) * v / y1;
    const line = (rows, k, col, dash) => `<polyline points="${rows.filter(r => r[k] != null).map(r => X(r[0]).toFixed(1) + ',' + Y(r[k]).toFixed(1)).join(' ')}" fill="none" stroke="${col}" stroke-width="1.6" ${dash ? 'stroke-dasharray="4 3"' : ''}/>`;
    const band = fc.filter(r => r[2] != null && r[3] != null);
    const poly = band.length ? `<polygon points="${band.map(r => X(r[0]).toFixed(1) + ',' + Y(r[2]).toFixed(1)).concat(band.slice().reverse().map(r => X(r[0]).toFixed(1) + ',' + Y(r[3]).toFixed(1))).join(' ')}" fill="#93C5FD" opacity="0.45"/>` : '';
    const hl = (v, col, lab) => v && v < y1 ? `<line x1="4" x2="${W - 4}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="${col}" stroke-width="1" stroke-dasharray="3 2"/><text x="${W - 6}" y="${(Y(v) - 2).toFixed(1)}" text-anchor="end" font-size="9" fill="${col}">${lab}</text>` : '';
    const today = fc.length ? `<line x1="${X(fc[0][0]).toFixed(1)}" x2="${X(fc[0][0]).toFixed(1)}" y1="2" y2="${H - 2}" stroke="#64748B" stroke-width="0.8"/>` : '';
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="ปริมาณน้ำย้อนหลัง 60 วันและพยากรณ์ 30 วัน" style="display:block;background:#F8FAFC;border-radius:4px;margin-top:4px">
      ${poly}${hl(t.q2, '#D68910', 'รอบ 2 ปี')}${hl(t.q5, '#C0392B', 'รอบ 5 ปี')}${hl(t.q20, '#7F1D1D', 'รอบ 20 ปี')}${today}${line(past, 1, '#0A1628')}${line(fc, 1, '#0E7C7B', true)}</svg>
      <div class="spark-lab"><span>60 วันก่อน</span><span>วันนี้ │ พยากรณ์ 30 วัน (แถบ = ช่วงชุดพยากรณ์)</span></div>`;
  }
  // เกิน 100% (อ่างเกินความจุ / ระดับน้ำเกินตลิ่ง) → วงกลมแดงกระพริบซ้อนบนจุด (divIcon + CSS เพราะแผนที่วาดจุดด้วย canvas)
  // interactive:false ให้การแตะทะลุไปที่จุดเดิมซึ่งมี popup
  const overPulse = (la, lo, size) => L.marker([la, lo], { interactive: false, keyboard: false, icon: L.divIcon({ className: '',
    iconSize: [size, size], iconAnchor: [size / 2, size / 2], html: '<span class="ov-pulse"></span>' }) });
  const wlColor = v => v === null || v === undefined ? '#94A3B8' : WL_BR.find(([b]) => v >= b)[1];

  /* ---------- ภัยแล้ง (GISTDA): คำอธิบายสัญลักษณ์มุมขวาล่าง แสดงเมื่อเปิดชั้น dri / droughtfreq ---------- */
  // ดัชนีภัยแล้ง 7 วัน: ช่วงค่าและสีตามคำอธิบายสัญลักษณ์บนแผนที่ภัยแล้งของ GISTDA (ภาพจากผู้ใช้ 23 ต.ค. 69)
  const IDX = {
    dri: { name: 'พื้นที่เสี่ยงภัยแล้ง DRI+', unit: '', note: 'ค่า &lt; 50 ไม่เสี่ยง (ไม่แสดง)',
      lg: [['#FBE5B6', '50–59', 'ต่ำ'], ['#F7F700', '60–69', 'ปานกลาง'], ['#FFA200', '70–79', 'สูง'], ['#FF1E1E', '≥80', 'สูงมาก']] },
    smap: { name: 'ความชื้นในดิน SMAP', unit: ' (%)', note: '',
      lg: [['#FF1010', '0–8', 'ชื้นน้อยที่สุด'], ['#F5B800', '9–22', 'ชื้นน้อย'], ['#FFFFA6', '23–37', 'ชื้นปานกลาง'], ['#8CCF9A', '38–51', 'ชื้นมาก'], ['#0C2C72', '52–100', 'ชื้นมากที่สุด']] },
    ndwi: { name: 'ความชื้นพืชพรรณ NDWI', unit: '', note: '',
      lg: [['#FF1010', '−1 ถึง −0.14', 'ความชื้นต่ำ มีผลต่อพืชมาก'], ['#FFA500', '−0.13 ถึง −0.08', 'ความชื้นต่ำ มีผลต่อพืชปานกลาง'],
        ['#D4F56A', '−0.07 ถึง 0.02', 'ความชื้นต่ำ มีผลต่อพืชน้อย'], ['#2E7D0F', '0.03 ถึง 1', 'ชื้นมากที่สุด']] },
  };
  const DF_COL = ['#FEF3C7', '#FDE68A', '#FBBF24', '#F59E0B', '#D97706', '#92400E'];   // ภัยแล้งซ้ำซาก 1–6 ครั้ง
  const TILE_WORKER = 'https://gistda-tile-proxy.sarochinee-k.workers.dev';   // เหมือน GISTDA_TILE_WORKER ใน chanat/index.html · key อยู่ใน Secret ของ Worker
  const LGD = { dri: '', droughtfreq: '', crops: '' };
  function legendD() {
    const el = $('legend-d'); if (!el) return;
    const h = ['dri', 'droughtfreq', 'crops'].filter(k => state[k] && state[k].on && LGD[k]).map(k => LGD[k]).join('');
    el.innerHTML = h; el.hidden = !h;
  }
  let dfCache = null;
  const droughtfreq = () => dfCache || (dfCache = json('data/droughtfreq.geojson').catch(e => { dfCache = null; throw e; }));
  const thYr = (y) => Number(y) + 543;
  // พื้นที่ปลูกพืช (GISTDA check-crop): ชื่อจาก API → ชื่อไทย + สีโทนเดียวกับแผนที่ภัยแล้งของ GISTDA · ชื่อที่ไม่อยู่ในตารางแสดงตามที่ API ส่งมา
  const CROP = { Sugarcane: ['อ้อย', '#E39B7B'], Cassava: ['มันสำปะหลัง', '#F5B887'], Maize: ['ข้าวโพด', '#EFD08C'], Rice: ['ข้าว', '#9ED29A'] };
  const CROP_X = ['#B39DDB', '#80CBC4', '#BCAAA4', '#90A4AE'];
  const cropOf = (c, i) => CROP[c] || [c, CROP_X[i % CROP_X.length]];
  const rai = (v) => Number(v || 0).toLocaleString('th-TH');

  /* ---------- นิยามเลเยอร์ ---------- */
  const defs = [
    {
      id: 'dri', icon: 'ti-sun-high', label: 'ดัชนีภัยแล้ง 7 วัน (GISTDA)', on: false,
      sw: ['dri', 'smap', 'ndwi'], swLabels: ['DRI', 'SMAP', 'NDWI'],
      async build(s) {
        // tile ผ่าน Worker gistda-tile-proxy เส้นทาง /dri/ /smap/ /ndwi/ (แกน y แบบ XYZ · ตรวจ 23 ต.ค. 69) · Worker ตอบ 204 นอกขอบเขต 26 ตำบล
        const k = s.sw || 'dri', ix = IDX[k];
        const lyr = L.tileLayer(`${TILE_WORKER}/${k}/{z}/{x}/{y}.png`, { minZoom: 6, maxNativeZoom: 15, maxZoom: 19, opacity: 0.8, zIndex: 300 });
        let bad = 0, ok = 0;   // Worker ตอบ 204 นอกขอบเขต (นับเป็น tileerror) → แจ้งเฉพาะเมื่อไม่มีภาพโหลดสำเร็จเลย
        lyr.on('tileload', () => ok++);
        lyr.on('tileerror', () => { if (++bad >= 6 && !ok && state.dri.on && !state.dri.sub.startsWith('โหลด')) { state.dri.sub = `โหลดภาพไม่สำเร็จ — ตรวจ Worker gistda-tile-proxy (v1.4 /${k}/)`; render(); } });
        LGD.dri = `<b>${ix.name}${ix.unit} · GISTDA 7 วันล่าสุด</b>` + ix.lg.map(([c, v, t]) =>
          `<div class="row"><span class="sw" style="background:${c}"></span>${v} ${t}</div>`).join('') + (ix.note ? `<div class="muted">${ix.note}</div>` : '');
        lyr.on('add remove', () => setTimeout(legendD));
        return { lyr, sub: `${ix.name} · ปรับรายสัปดาห์ · สีตามคำอธิบายของ GISTDA`, attr: `${ix.name.split(' ').pop()} © GISTDA` };
      }
    },
    {
      id: 'droughtfreq', icon: 'ti-repeat', label: 'ภัยแล้งซ้ำซาก (GISTDA)', on: false,
      async build() {
        // สร้างโดย .github/workflows/drought-layers.yml (scripts/region/build_droughtfreq_gistda.py) · ตัดตามขอบเขต 26 ตำบล
        const d = await droughtfreq().catch(() => { throw new Error('รอ workflow drought-layers สร้างข้อมูล'); });
        const ys = d.years || [], n = ys.length, yr = n ? `${thYr(ys[0])}–${thYr(ys[n - 1])}` : '';
        const lyr = L.geoJSON(d, { style: f => ({ stroke: false, fillColor: DF_COL[Math.min(f.properties.freq, 6) - 1] || DF_COL[5], fillOpacity: 0.5 }),
          onEachFeature: (f, l) => l.bindTooltip(`ภัยแล้งซ้ำซาก ${f.properties.freq} ครั้ง ใน ${n} ปี (${yr}) · GISTDA`, { sticky: true }) });
        const fq = Object.keys(d.count_by_freq || {}).map(Number).sort((a, b) => a - b);
        LGD.droughtfreq = `<b>ภัยแล้งซ้ำซาก (ครั้ง ใน ${n} ปี ${yr})</b>` + fq.map(k =>
          `<div class="row"><span class="sw" style="background:${DF_COL[Math.min(k, 6) - 1]}"></span>${k} ครั้ง</div>`).join('');
        lyr.on('add remove', () => setTimeout(legendD));
        const ca = (d.by_tambon || {})['301010'];
        return { lyr, sub: `GISTDA ปี ${yr}${ca ? ` · ต.จันอัด ส่วนใหญ่ ${ca.mode} ครั้ง (${fmt((ca.share[ca.mode] || 0) * 100, 0)}% ของพื้นที่)` : ''} · ดึงเมื่อ ${hhmm(d.updated_at)}`,
          attr: 'ภัยแล้งซ้ำซาก © GISTDA' };
      }
    },
    {
      id: 'crops', icon: 'ti-plant-2', label: 'พื้นที่การเกษตร (GISTDA)', on: false,
      async build() {
        // สร้างโดย .github/workflows/crop-layers.yml (scripts/region/build_crops_gistda.py) · พืชที่ปลูกอยู่ ณ รอบข้อมูลล่าสุด (ราย 2 สัปดาห์)
        const d = await json('data/crops.geojson').catch(() => { throw new Error('รอ workflow crop-layers สร้างข้อมูล'); });
        const cs = d.crops || [], col = {}; cs.forEach((c, i) => col[c] = cropOf(c, i));
        const up = (d.data_updates || []).slice(-1)[0];
        const lyr = L.geoJSON(d, { style: f => ({ stroke: false, fillColor: (col[f.properties.crop] || cropOf(f.properties.crop, 0))[1], fillOpacity: 0.75 }),
          onEachFeature: (f, l) => l.bindTooltip(`${esc((col[f.properties.crop] || [f.properties.crop])[0])} · GISTDA ข้อมูลวันที่ ${dDate(up)}`, { sticky: true }) });
        LGD.crops = `<b>พื้นที่การเกษตร (GISTDA · ${dDate(up)})</b>` + cs.map(c =>
          `<div class="row"><span class="sw" style="background:${col[c][1]}"></span>${esc(col[c][0])} ${rai((d.total_rai || {})[c])} ไร่</div>`).join('')
          + '<div class="muted">พื้นที่ใน 26 ตำบล · คำนวณจากขอบเขตแปลง</div>';
        lyr.on('add remove', () => setTimeout(legendD));
        const ca = ((d.by_tambon || {})['301010'] || {}).crops_rai || {};
        const caTxt = Object.entries(ca).sort((a, b) => b[1] - a[1]).map(([c, v]) => `${(col[c] || [c])[0]} ${rai(v)}`).join(' · ');
        return { lyr, sub: `ข้อมูลวันที่ ${dDate(up)} (ราย 2 สัปดาห์)${caTxt ? ` · ต.จันอัด ${caTxt} ไร่` : ''}`, attr: 'พื้นที่ปลูกพืช © GISTDA' };
      }
    },
    {
      id: 'gistda', icon: 'ti-satellite', label: 'น้ำท่วมตรวจพบ (ดาวเทียม)', on: true,
      async build() {
        const d = await json('data/live/gistda_flood_7d.geojson');
        if (d.status === 'not_configured') throw new Error('ยังไม่ตั้ง GISTDA_API_KEY');
        if (d.status === 'error' && !d.features.length) throw new Error('ดึงจาก GISTDA ไม่สำเร็จ');
        // เซลล์ H3 ของ GISTDA เล็กมาก (~65 ไร่/เซลล์ ส่วนใหญ่ท่วมไม่กี่ไร่) → ซูมไกลแสดงเป็นวงกลมตามพื้นที่ ซูมใกล้แสดงรูปเซลล์
        const pop = (f) => `<b>น้ำท่วมตรวจพบ (GISTDA 7 วัน)</b><br>ต.${esc(f.properties.tb_name)} อ.${esc(f.properties.ap_name)}<br>
            ${fmt(f.properties.area_rai, 1)} ไร่ในเซลล์นี้<br>
            ${f.properties.bldg ? `อาคาร ${f.properties.bldg} หลัง · ` : ''}${f.properties.pop ? `ประชากร ~${f.properties.pop} คน · ` : ''}${f.properties.school ? `โรงเรียน ${f.properties.school} · ` : ''}${f.properties.hosp ? `สถานพยาบาล ${f.properties.hosp}` : ''}
            <br><span class="muted">ภาพ ${esc(imgs(f.properties.img))}</span>`;
        const cells = L.geoJSON(d, { style: f => ({ color: f.properties.in_area ? '#0369A1' : '#0891B2', weight: 1,
            fillColor: '#00E5FF', fillOpacity: f.properties.in_area ? 0.85 : 0.65 }), onEachFeature: (f, l) => l.bindPopup(pop(f)) });
        const dots = L.layerGroup((d.features || []).map(f => { const c = L.geoJSON(f).getBounds().getCenter();
          return L.circleMarker(c, { radius: Math.max(3, Math.min(14, 2 + Math.sqrt(f.properties.area_rai || 0))), weight: 1, color: '#0369A1',
            fillColor: '#00E5FF', fillOpacity: 0.85 }).bindPopup(pop(f)); }));
        const lyr = L.layerGroup();
        const sync = () => { const near = map.getZoom() >= 12;
          if (near) { lyr.removeLayer(dots); lyr.addLayer(cells); } else { lyr.removeLayer(cells); lyr.addLayer(dots); } };
        lyr.on('add', () => { sync(); map.on('zoomend', sync); });
        lyr.on('remove', () => map.off('zoomend', sync));
        const nT = Object.keys(d.by_tambon || {}).length;
        return { lyr, sub: `ในพื้นที่ ${Number(d.total_rai || 0).toLocaleString('th-TH')} ไร่ · ${nT} ตำบล · ทั้งจังหวัด ${Number(d.province_rai || 0).toLocaleString('th-TH')} ไร่ · ภาพล่าสุด ${imgs((d.images || []).slice(-1)[0])}`,
          attr: 'น้ำท่วม © GISTDA' };
      }
    },
    {
      id: 'structures', icon: 'ti-building-bridge', label: 'อาคารชลศาสตร์ลำเชียงไกร (ปภ./อบต.)', on: false,
      async build() {
        const d = await json('data/structures.geojson');
        const STRUCT_COLOR = '#DB2777';   // สีเดียวทุกประเภท (ชมพูเข้ม ไม่ซ้ำกับสีสถานะระดับน้ำ/อ่าง) · ประเภทดูใน popup
        const TY = { gate: ['บ', '#0E7C7B', 'อาคารบังคับน้ำ'], drain: ['ร', '#2563EB', 'อาคารระบายน้ำ'], weir: ['ฝ', '#7C3AED', 'ฝาย'],
          retention: ['ก', '#0891B2', 'แก้มลิง'], reservoir: ['อ', '#1E3A8A', 'อ่างเก็บน้ำ'], bridge: ['ส', '#64748B', 'สะพาน'],
          canal: ['ท', '#64748B', 'ระบบส่งน้ำ'], river: ['น', '#64748B', 'จุดอ้างอิงลำน้ำ'], other: ['•', '#64748B', 'อื่น ๆ'] };
        const n = d.features.length;
        const lyr = L.layerGroup(d.features.map(f => { const p = f.properties, lab = (TY[p.type] || TY.other)[2];
          return L.marker([f.geometry.coordinates[1], f.geometry.coordinates[0]], {
            icon: L.divIcon({ className: '', iconSize: [18, 18], iconAnchor: [9, 9],
              html: `<span style="display:block;width:12px;height:12px;border-radius:3px;background:${STRUCT_COLOR};border:2px solid #fff;box-shadow:0 0 2px #000"></span>` }) })
            .bindTooltip(esc(p.name), { direction: 'top', offset: [0, -7] })
            .bindPopup(`<b>${esc(p.name)}</b><br>${lab} · ลำดับที่ ${p.seq}/${n} จากอ่างลำเชียงไกรตอนล่าง
              <br>${p.tambon ? `ต.${esc(p.tambon)} อ.${esc(p.amphoe)}` : 'ใกล้แนวเขตตำบล'}
              <div class="muted" style="font-size:11px">ที่มา: ปภ. และ อบต. · ตำแหน่งตามข้อมูลที่ได้รับ ยังไม่ได้ตรวจภาคสนาม</div>`); }));
        const cnt = d.features.reduce((m, f) => (m[f.properties.type] = (m[f.properties.type] || 0) + 1, m), {});
        return { lyr, sub: `${n} จุด · บังคับน้ำ ${cnt.gate || 0} · ระบายน้ำ ${cnt.drain || 0} · ฝาย ${cnt.weir || 0} · แก้มลิง ${cnt.retention || 0}`,
          attr: 'อาคารชลศาสตร์ © ปภ. และ อบต.' };
      }
    },
    {
      // ตำแหน่งตัวแทนหมู่บ้าน (scripts/region/import_villages.py ← Village.shp) · ชื่อแสดงบนแผนที่ตลอด
      id: 'villages', icon: 'ti-building', label: 'หมู่บ้าน (ตำแหน่งตัวแทน)', on: true,
      async build() {
        const d = await json('data/villages.geojson');
        const lyr = L.layerGroup(d.features.map(f => { const p = f.properties;
          return L.marker([f.geometry.coordinates[1], f.geometry.coordinates[0]], {
            icon: L.divIcon({ className: '', iconSize: [14, 14], iconAnchor: [7, 7],
              html: '<span class="vil-dot"></span>' }) })
            .bindTooltip(`ม.${p.vill_no} ${esc(p.name)}`, { permanent: true, direction: 'right', offset: [6, 0], className: 'vlabel' })
            .bindPopup(`<b>บ้าน${esc(p.name)} หมู่ ${p.vill_no}</b><br>ต.${esc(p.tambon)} อ.${esc(p.amphoe)} · รหัส ${esc(p.code)}
              <div class="muted" style="font-size:11px">จุดตัวแทนหมู่บ้าน ไม่ใช่ขอบเขตหมู่บ้าน</div>`); }));
        return { lyr, sub: `${d.features.length} หมู่บ้าน · ${[...new Set(d.features.map(f => 'ต.' + f.properties.tambon))].join(' · ')}`,
          attr: 'ตำแหน่งหมู่บ้าน: ข้อมูลโครงการ' };
      }
    },
    {
      id: 'reports', icon: 'ti-map-pin-exclamation', label: 'จุดแจ้งเหตุ / ขอความช่วยเหลือ (LINE OA)', on: true,
      async build() {
        if (!lineReady) return reportsV4();
        const [rp, hs] = await Promise.all([json(LC.API + '/api/reports'), json(LC.API + '/api/help/summary').catch(() => null)]);
        const ICON = { flood: '🌊', road: '🚧', power: '⚡', landslide: '⛰️', tree: '🌳', building: '🏚️', other: '❗' };
        const CAT = { flood: 'น้ำท่วม', road: 'ถนนผ่านไม่ได้', power: 'ไฟดับ', landslide: 'ดินสไลด์', tree: 'ต้นไม้ล้ม', building: 'อาคารเสียหาย', other: 'อื่น ๆ' };
        const DEP = { ankle: 'ตาตุ่ม', knee: 'เข่า', waist: 'เอว', chest: 'อก', over: 'ท่วมมิดหัว' };
        const lyr = L.layerGroup((rp.items || []).map(r => L.marker([r.lat, r.lon], {
            icon: L.divIcon({ className: '', html: `<span class="rp-pin ${r.status === 'verified' ? '' : 'unv'}">${ICON[r.cats[0]] || '❗'}</span>`, iconSize: [20, 20], iconAnchor: [10, 10] }) })
          .bindPopup(`<b>${r.cats.map(c => CAT[c] || c).join(' · ')}</b>${r.depth ? ` · ระดับน้ำ${DEP[r.depth]}` : ''}<br>
            <span class="bk" style="background:${r.status === 'verified' ? '#1E8449' : '#94A3B8'}">${r.status === 'verified' ? 'ตรวจสอบแล้ว' : 'ยังไม่ได้ตรวจสอบ'}</span>
            ${r.note ? `<div class="trend">${esc(r.note)}</div>` : ''}<div class="muted" style="font-size:11px">${new Date(r.created_at).toLocaleString('th-TH')} · รายงานโดยผู้ลงทะเบียน LINE OA</div>`)));
        const open = hs ? Object.values(hs.by_tambon || {}).reduce((a, b) => a + b, 0) : 0, nT = hs ? Object.keys(hs.by_tambon || {}).length : 0;
        return { lyr, sub: `${(rp.items || []).length} รายงาน${open ? ` · คำขอความช่วยเหลือที่ยังเปิด ${open} เรื่อง (${nT} ตำบล)` : ''}`, attr: 'รายงานจากประชาชน (ยังไม่ได้ตรวจสอบทั้งหมด)' };
      }
    },
    {
      id: 'basins', icon: 'ti-topology-star-3', label: 'ขอบเขตลุ่มน้ำ (HydroBASINS)', on: false,
      async build() {
        if (!BAS) throw new Error('ยังไม่มีไฟล์ขอบเขตลุ่มน้ำ');
        const col = { LCK: '#38BDF8', MUN_UP: '#A78BFA', TAK: '#FB923C', STUDY: '#94A3B8' };
        const lyr = L.geoJSON({ type: 'FeatureCollection', features: BAS.features.filter(f => f.properties.id !== 'STUDY') }, {
          style: f => ({ color: col[f.properties.id], weight: 2, dashArray: '6 4', fill: false }),
          onEachFeature: (f, l) => l.bindTooltip(`${f.properties.name} · ${Number(f.properties.area_km2).toLocaleString('th-TH')} ตร.กม. (D.A กรมชลประทาน ${Number(f.properties.da_rid).toLocaleString('th-TH')})`, { sticky: true }) });
        return { lyr, sub: 'ลำเชียงไกร (ฟ้า) · มูลตอนบน (ม่วง) · ลำตะคอง (ส้ม) · ตรวจกับ D.A กรมชลประทานแล้ว', attr: 'HydroBASINS © WWF (HydroSHEDS)' };
      }
    },
    {
      id: 'rivers', icon: 'ti-wave-sine', label: 'แม่น้ำ/ลำน้ำ (OpenStreetMap)', on: false,
      async build() {
        // สร้างโดย .github/workflows/osm-rivers.yml (scripts/region/build_osm_rivers.py) · river หนา · canal ประ · stream บาง
        const d = await json('data/osm_rivers.geojson').catch(() => { throw new Error('รอ workflow osm-rivers สร้างข้อมูล'); });
        const ST = { river: { color: '#1D4ED8', weight: 3 }, canal: { color: '#0891B2', weight: 1.6, dashArray: '5 3' }, stream: { color: '#3B82F6', weight: 1.2, opacity: 0.8 } };
        const TH = { river: 'แม่น้ำ/ลำน้ำสายหลัก', canal: 'คลอง/คลองส่งน้ำ', stream: 'ลำห้วย' };
        const lyr = L.geoJSON(d, { interactive: true, style: f => ST[f.properties.type] || ST.stream,
          onEachFeature: (f, l) => l.bindTooltip(`${esc(f.properties.name || 'ไม่มีชื่อใน OSM')} · ${TH[f.properties.type] || f.properties.type}`, { sticky: true }) });
        const c = d.count || {};
        return { lyr, sub: `แม่น้ำ ${c.river || 0} · คลอง ${c.canal || 0} · ลำห้วย ${c.stream || 0} เส้น · ${hhmm(d.updated_at)}`,
          attr: 'ลำน้ำ © OpenStreetMap contributors (ODbL)' };
      }
    },
    {
      id: 'water', icon: 'ti-droplet-half-2', label: 'แหล่งน้ำผิวดิน (OpenStreetMap)', on: false,
      async build() {
        // อ่าง สระ หนอง บึง กุด พื้นที่ชุ่มน้ำ (ไม่รวมตัวลำน้ำ) · สร้างโดย workflow osm-rivers (scripts/region/build_osm_water.py)
        const d = await json('data/osm_water.geojson').catch(() => { throw new Error('รอ workflow osm-rivers สร้างข้อมูล'); });
        const TY = { reservoir: ['อ่างเก็บน้ำ', '#1E3A8A'], lake: ['หนอง/บึง', '#1D4ED8'], oxbow: ['กุด', '#0369A1'], pond: ['สระ/บ่อ', '#0EA5E9'],
          wetland: ['พื้นที่ชุ่มน้ำ', '#0F766E'], basin: ['บ่อพัก/บ่อบำบัด', '#64748B'], other: ['แหล่งน้ำ (OSM ไม่ระบุประเภท)', '#38BDF8'] };
        const ty = (t) => TY[t] || TY.other;
        const lyr = L.geoJSON(d, { style: f => ({ color: ty(f.properties.type)[1], weight: 1, fillColor: ty(f.properties.type)[1],
            fillOpacity: f.properties.type === 'wetland' ? 0.25 : 0.55, dashArray: f.properties.type === 'wetland' ? '3 2' : null }),
          onEachFeature: (f, l) => l.bindTooltip(`${esc(f.properties.name || 'ไม่มีชื่อใน OSM')} · ${ty(f.properties.type)[0]} · ${Number(f.properties.area_rai).toLocaleString('th-TH', { maximumFractionDigits: 1 })} ไร่`, { sticky: true }) });
        const c = d.count || {}, top = Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${ty(k)[0]} ${v}`).join(' · ');
        return { lyr, sub: `${d.features.length.toLocaleString('th-TH')} แหล่ง · ${Number(d.total_rai || 0).toLocaleString('th-TH')} ไร่ · ${top}`,
          attr: 'แหล่งน้ำ © OpenStreetMap contributors (ODbL)' };
      }
    },
    {
      id: 'labels', icon: 'ti-map-pin', label: 'เขตตำบล/อำเภอ', on: true,
      async build() {
        return { toggle: (on) => { map.getContainer().classList.toggle('hide-labels', !on); window.SDSS.setTambonVisible(on); },
          sub: 'ปิดแล้วยังแตะแผนที่เพื่อดูข้อมูลตำบลได้' };
      }
    },
    {
      id: 'radar', icon: 'ti-cloud-rain', label: 'เรดาร์ฝน (2 ชม. ล่าสุด)', on: false,
      async build() {
        // RainViewer: ย้อนหลัง 2 ชม. ทุก 10 นาที → ภาพเคลื่อนไหว · หน้ากากพื้นที่ครอบคลุม (ดำ = เรดาร์ไม่ครอบคลุม)
        const d = await json(L_.rainviewer);
        const frames = (d.radar && d.radar.past) || [];
        if (!frames.length) throw new Error('ไม่มีภาพเรดาร์');
        const opt = { maxNativeZoom: L_.rainviewer_max_native_zoom, maxZoom: 18, zIndex: 400 };
        const tiles = frames.map(f => L.tileLayer(d.host + f.path + '/256/{z}/{x}/{y}/2/1_1.png', Object.assign({ opacity: 0 }, opt)));
        const cover = L.tileLayer(d.host + '/v2/coverage/0/256/{z}/{x}/{y}/0/0_0.png', Object.assign({ opacity: 0.35 }, opt, { zIndex: 399 }));
        const grp = L.layerGroup(tiles);
        let idx = frames.length - 1, timer = null, ctl = null;
        const tm = (i) => new Date(frames[i].time * 1000).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
        const show = (i) => { idx = i; tiles.forEach((t, j) => t.setOpacity(j === i ? 0.65 : 0));
          if (ctl) { ctl.querySelector('.rv-t').textContent = tm(i) + (i === frames.length - 1 ? ' (ล่าสุด)' : ''); ctl.querySelector('input[type=range]').value = i; } };
        const stop = () => { clearInterval(timer); timer = null; if (ctl) ctl.querySelector('.rv-play').textContent = '▶'; };
        const play = () => { if (timer) return stop(); ctl.querySelector('.rv-play').textContent = '⏸';
          timer = setInterval(() => show(idx >= frames.length - 1 ? 0 : idx + 1), 700); };
        grp.on('add', () => {
          ctl = document.createElement('div'); ctl.className = 'rv-ctl';
          ctl.innerHTML = `<button class="rv-play" aria-label="เล่น/หยุดภาพเคลื่อนไหวเรดาร์">▶</button>
            <input type="range" min="0" max="${frames.length - 1}" value="${idx}" aria-label="เลือกเวลาภาพเรดาร์">
            <span class="rv-t mono"></span><label class="rv-cov"><input type="checkbox"> พื้นที่ครอบคลุม</label>`;
          map.getContainer().parentElement.appendChild(ctl);
          L.DomEvent.disableClickPropagation(ctl);
          ctl.querySelector('.rv-play').onclick = play;
          ctl.querySelector('input[type=range]').oninput = (e) => { stop(); show(+e.target.value); };
          ctl.querySelector('.rv-cov input').onchange = (e) => e.target.checked ? cover.addTo(map) : map.removeLayer(cover);
          show(frames.length - 1);
        });
        grp.on('remove', () => { stop(); if (map.hasLayer(cover)) map.removeLayer(cover); if (ctl) ctl.remove(); ctl = null; });
        return { lyr: grp, sub: `RainViewer · ${frames.length} ภาพย้อนหลัง 2 ชม. · ล่าสุด ${tm(frames.length - 1)}`,
          attr: 'Weather data by <a href="https://www.rainviewer.com" target="_blank" rel="noopener">RainViewer</a>' };
      }
    },
    {
      id: 'glofas', icon: 'ti-chart-line', label: 'พยากรณ์ปริมาณน้ำ 30 วัน (ทดลอง)', on: false,
      async build() {
        const g = await json('data/live/glofas.json');
        if (!g.points || !g.points.length) throw new Error(g.status === 'error' ? 'ดึงไม่สำเร็จ' : 'รอ workflow รันรอบแรก');
        const lyr = L.layerGroup(g.points.map(p => {
          const st = glofasStatus(p);
          return L.circleMarker([p.lat, p.lon], { bubblingMouseEvents: false, radius: 9, weight: 2, color: '#FFFFFF', fillColor: st.color, fillOpacity: 0.95 })
            .bindPopup(`<b>${esc(p.name)}</b><br><span class="bk" style="background:${st.color}">${st.label}</span>
              <div class="trend">ล่าสุด ${fmt((p.past.slice(-1)[0] || [])[1], 1)} ลบ.ม./วิ · คาดสูงสุด ${fmt(p.peak && p.peak.median, 1)} (สูงสุดของชุดพยากรณ์ ${fmt(p.peak && p.peak.max, 1)}) วันที่ ${esc(p.peak && p.peak.date)}</div>
              ${glofasChart(p, 250)}<div class="muted" style="font-size:11px">แบบจำลอง GloFAS กริด ~5 กม. · ยังไม่ได้ตรวจเทียบกับสถานีจริง · ไม่ใช่ประกาศเตือนภัย</div>`, { maxWidth: 280 });
        }));
        const warn = g.points.filter(p => glofasStatus(p).rank >= 1).length;
        return { lyr, sub: `${g.points.length} จุด · ${warn ? `เกินเกณฑ์ ${warn} จุด` : 'ไม่เกินรอบ 2 ปี'} · ${hhmm(g.updated_at)}`, attr: 'GloFAS © Copernicus EMS (CC BY 4.0) · Open-Meteo' };
      }
    },
    {
      id: 'rainsta', icon: 'ti-droplet', label: 'ฝนสถานีตรวจวัด', on: true, sw: ['rain_24h', 'rain_1h'],
      swLabels: ['สะสม 24 ชม.', 'ความเข้มตอนนี้'],
      async build(state) {
        const tw = await thaiwater(), key = state.sw || 'rain_24h';
        const lyr = L.layerGroup(tw.rain.map(s => MARK['r:' + s.lat + ',' + s.lon] = L.circleMarker([s.lat, s.lon], {
          bubblingMouseEvents: false,
          radius: inArea(s.lat, s.lon) ? 7 : 5, weight: inArea(s.lat, s.lon) ? 1.5 : 1,
          color: inArea(s.lat, s.lon) ? '#0F172A' : '#64748B', dashArray: inArea(s.lat, s.lon) ? null : '2 2',
          fillColor: rainColor(s[key]), fillOpacity: rel(s) ? 0.9 : 0.3
        }).bindPopup(`<b>${esc(s.name)}</b> ${tag(s)}<br>อ.${esc(s.amphoe)}<br>ฝน 24 ชม. <b>${fmt(s.rain_24h)}</b> มม.<br>
            ฝน 1 ชม. ${fmt(s.rain_1h)} มม.<br><span class="muted">${tTime(s.time)}</span>`)));
        return { lyr, sub: `ThaiWater · ${tw.rain.length} สถานี · ${key === 'rain_24h' ? 'ฝน 24 ชม.' : 'ฝน 1 ชม.'}${tw.via === 'snapshot' ? ' (snapshot)' : ''}`,
          attr: 'สถานี © สสน. (ThaiWater)' };
      }
    },
    {
      id: 'wlsta', icon: 'ti-ripple', label: 'ระดับน้ำสถานีตรวจวัด', on: true,
      async build() {
        const [tw, h, R] = await Promise.all([thaiwater(), history(), rid()]);
        const lyr = L.layerGroup(tw.waterlevel.map(s => MARK['w:' + s.code] = L.circleMarker([s.lat, s.lon], {
          bubblingMouseEvents: false,
          radius: inArea(s.lat, s.lon) ? 8 : 6, weight: inArea(s.lat, s.lon) ? 2 : 1,
          color: inArea(s.lat, s.lon) ? '#0F172A' : '#64748B', dashArray: inArea(s.lat, s.lon) ? null : '2 2',
          fillColor: bankStatus(s, trendWL(h, s)).color, fillOpacity: rel(s) ? 0.95 : 0.3
        }).bindPopup(`<b>${esc(s.name)}</b> ${tag(s)} <span class="mono">${esc(s.code)}</span><br>
            ${(() => { const t = trendWL(h, s), b = bankStatus(s, t), e = bankEta(s, t);
              const gap = s.bank_msl != null && s.level_msl != null ? s.bank_msl - s.level_msl : null;
              return `<span class="bk" style="background:${b.color}">${b.label}</span>
                ${gap != null ? (gap >= 0 ? ` ต่ำกว่าตลิ่ง ${fmt(gap, 2)} ม.` : ` <b>สูงกว่าตลิ่ง ${fmt(-gap, 2)} ม.</b>`) : ''}
                ${e ? `<div class="eta">${etaTxt(e)}</div>` : ''}<br>`; })()}อ.${esc(s.amphoe)}<br>
            ${R[s.code] ? `ลำน้ำ <b>${esc(R[s.code].river)}</b> · พื้นที่รับน้ำ ${Number(R[s.code].da).toLocaleString('th-TH')} ตร.กม.<br>` : ''}
            ความจุลำน้ำ <b>${fmt(s.storage_pct, 0)}%</b>${R[s.code] && R[s.code].zg && s.level_msl != null ? ` · ความลึกน้ำ <b>${fmt(s.level_msl - R[s.code].zg, 2)} ม.</b>` : ''}<br>ระดับน้ำ ${fmt(s.level_msl, 2)} ม.รทก. · ตลิ่ง ${fmt(s.bank_msl, 2)} ม.รทก.<br>
            ${s.discharge != null ? `ปริมาณน้ำ ${fmt(s.discharge)} ลบ.ม./วิ<br>` : ''}<span class="muted">${tTime(s.measured_at)}</span>
            ${(() => { const t = trendWL(h, s); return t ? `<div class="trend">เทียบครั้งก่อน ${arrow(t.d, 'ซม.', 0)}<br>เทียบ 24 ชม. ${arrow(t.d24, 'ซม.', 0)}</div>${spark(t.series, 'ระดับน้ำ ม.รทก.')}` : ''; })()}`)));
        const wOver = tw.waterlevel.filter(s => s.storage_pct > 100);
        wOver.forEach(s => lyr.addLayer(overPulse(s.lat, s.lon, inArea(s.lat, s.lon) ? 26 : 22)));
        return { lyr, sub: `ThaiWater · ${tw.waterlevel.length} สถานี · สี = สถานะเทียบตลิ่ง${wOver.length ? ` · เกินตลิ่ง ${wOver.length} สถานี (วงแดงกระพริบ)` : ''}`, attr: 'สถานี © สสน. (ThaiWater)' };
      }
    },
    {
      id: 'rainacc', icon: 'ti-cloud-storm', label: 'ฝนสะสม 7/3 วัน (สถานี)', on: false, sw: ['rain7d', 'rain3d'],
      swLabels: ['สะสม 7 วัน', 'สะสม 3 วัน'],
      async build(state) {
        const p = await province(), key = state.sw || 'rain7d', bb = bbox();
        // ชั่วคราว: เฉพาะสถานีในพื้นที่ศึกษา + buffer (รอบถัดไปกรองตามขอบเขตลุ่มน้ำ)
        const rows = (p[key] || []).filter(s => inBox(s.lat, s.lon, bb));
        const lyr = L.layerGroup(rows.map(s => L.circleMarker([s.lat, s.lon], {
          bubblingMouseEvents: false,
          radius: inArea(s.lat, s.lon) ? 7 : 5, weight: inArea(s.lat, s.lon) ? 1.5 : 1,
          color: inArea(s.lat, s.lon) ? '#0F172A' : '#64748B', dashArray: inArea(s.lat, s.lon) ? null : '2 2',
          fillColor: r7Color(key === 'rain7d' ? s.v : s.v * 7 / 3), fillOpacity: 0.9
        }).bindPopup(`<b>${esc(s.name)}</b> ${tag(s)}<br>ต.${esc(s.tambon)} อ.${esc(s.amphoe)}<br>
            ฝนสะสม ${key === 'rain7d' ? '7' : '3'} วัน <b>${fmt(s.v)}</b> มม.<br>
            <span class="muted">${esc(s.start)} ถึง ${esc(s.end)} · ${esc(s.agency)}</span>`)));
        return { lyr, sub: `ThaiWater · ${rows.length} สถานีในและรอบพื้นที่ · ${hhmm(p.updated_at)}`, attr: 'สถานี © สสน. (ThaiWater)' };
      }
    },
    {
      id: 'dams', icon: 'ti-building-bridge-2', label: 'อ่างเก็บน้ำ', on: true,
      async build() {
        const [p, h] = await Promise.all([province(), history()]), rows = p.dams || [];
        const lyr = L.layerGroup(rows.map(d => L.circleMarker([d.lat, d.lon], {
          bubblingMouseEvents: false,
          radius: d.kind === 'large' ? 11 : 7, weight: 2, color: '#FFFFFF', fillColor: damColor(d), fillOpacity: rel(d) ? 0.95 : 0.3
        }).bindPopup(`<b>${esc(d.name)}</b> ${tag(d)}<br>${d.kind === 'large' ? 'เขื่อน/อ่างขนาดใหญ่' : 'อ่างขนาดกลาง'} · อ.${esc(d.amphoe)}<br>
            ปริมาณน้ำ <b>${fmt(d.pct, 1)}%</b> (${fmt(d.storage, 2)} ล้าน ลบ.ม.)<br>
            น้ำไหลเข้า ${fmt(d.inflow, 2)} · ระบาย ${fmt(d.released, 2)} ล้าน ลบ.ม./วัน<br>
            ${d.pct_prev != null ? `ปีก่อนวันเดียวกัน ${fmt(d.pct_prev, 0)}%<br>` : ''}
            <span class="muted">ข้อมูลวันที่ ${esc(d.date)}${d.stale ? ' — ข้อมูลเก่า' : ''} · ${d.src || 'ThaiWater'}</span>
            ${d.stale ? '' : (() => { const t = trendDam(h, d); return `<div class="trend">เทียบวันก่อน ${arrow(t.d, '%', 1)}</div>${spark(t.series, 'ปริมาณน้ำ %')}`; })()}`)
          .on('add', function () { MARK['d:' + d.name] = this; })));
        const n = rows.filter(d => !d.stale && d.pct != null).length;
        const dOver = rows.filter(d => !d.stale && d.pct > 100);
        dOver.forEach(d => lyr.addLayer(overPulse(d.lat, d.lon, d.kind === 'large' ? 30 : 24)));
        return { lyr, sub: `ThaiWater จังหวัด · ${n} อ่างมีข้อมูลปัจจุบัน${dOver.length ? ` · เกินความจุ ${dOver.length} อ่าง (วงแดงกระพริบ)` : ''} · ${hhmm(p.updated_at)}`, attr: 'อ่างเก็บน้ำ © สสน. (ThaiWater), กรมชลประทาน' };
      }
    },
    {
      id: 'bldg', icon: 'ti-building', label: 'อาคาร/สิ่งปลูกสร้าง', on: false,
      async build() {
        // ซูม 13–14: จุดอาคาร (buildings.json) · ซูม ≥ 15: รูปอาคาร polygon จาก tile รายตำบล (data/bldg/<tcode>.json)
        const Z_PT = 13, Z_POLY = 15, CAP = 25000;
        let P = null, idx = null;
        try {
          const b = await json('data/buildings.json');
          P = new Float64Array(b.n * 2);
          let x = b.x0, y = b.y0;
          for (let i = 0, k = 0; i < b.d.length; i += 3, k++) { x += b.d[i]; y += b.d[i + 1]; P[2 * k] = x / b.scale; P[2 * k + 1] = y / b.scale; }
        } catch (e) { P = null; }
        try { idx = (await json('data/bldg/index.json')).tiles; } catch (e) { idx = null; }
        if (!P && !idx) throw new Error('รอข้อมูลอาคารจาก GEE');
        const tiles = {};
        const loadTile = (c) => tiles[c] || (tiles[c] = json(`data/bldg/${c}.json`).then(t => t.p.map(e => {
          const r = []; let x = e[0], y = e[1]; r.push([y / t.s, x / t.s]);
          for (let i = 2; i < e.length; i += 2) { x += e[i]; y += e[i + 1]; r.push([y / t.s, x / t.s]); }
          return r;
        })).catch(() => []));
        const rend = L.canvas({ padding: 0.2 }), out = L.layerGroup();
        let ticket = 0;
        const draw = async () => {
          const my = ++ticket, z = map.getZoom();
          const bb = map.getBounds().pad(0.1), w = bb.getWest(), e = bb.getEast(), so = bb.getSouth(), no = bb.getNorth();
          if (z >= Z_POLY && idx) {
            const want = Object.entries(idx).filter(([, v]) => !(v.bbox[2] < w || v.bbox[0] > e || v.bbox[3] < so || v.bbox[1] > no)).map(([c]) => c);
            const polys = (await Promise.all(want.map(loadTile))).flat();
            if (my !== ticket) return;
            out.clearLayers(); let n = 0;
            for (const r of polys) {
              const [la, lo] = r[0];
              if (lo < w || lo > e || la < so || la > no) continue;
              L.polygon(r, { renderer: rend, color: '#1F2937', weight: 0.7, fillColor: '#F59E0B', fillOpacity: 0.85, interactive: false }).addTo(out);
              if (++n >= CAP) break;
            }
            return;
          }
          out.clearLayers();
          if (z >= Z_PT && P) {
            let n = 0;
            for (let k = 0; k < P.length / 2 && n < CAP; k++) {
              const lo = P[2 * k], la = P[2 * k + 1];
              if (lo < w || lo > e || la < so || la > no) continue;
              L.circleMarker([la, lo], { renderer: rend, radius: 2, weight: 0.5, color: '#1F2937', fillColor: '#F59E0B', fillOpacity: 0.9, interactive: false }).addTo(out); n++;
            }
          }
        };
        out.on('add', () => { draw(); map.on('moveend', draw); });
        out.on('remove', () => { map.off('moveend', draw); ticket++; out.clearLayers(); });
        const tot = idx ? Object.values(idx).reduce((a, v) => a + v.n, 0) : P.length / 2;
        return { lyr: out, sub: `${tot.toLocaleString('th-TH')} หลัง · ซูม ${Z_PT}+ จุด${idx ? ` · ซูม ${Z_POLY}+ รูปอาคาร` : ''}`,
          attr: 'อาคาร © Google Open Buildings (CC BY 4.0)' };
      }
    }
  ];

  /* ---------- UI แผงสวิตช์ ---------- */
  const state = {};
  function row(d) {
    const s = state[d.id];
    const swHtml = d.sw && s.on ? `<div class="lsw">${d.sw.map((k, i) =>
      `<button data-sw="${k}" class="${(s.sw || d.sw[0]) === k ? 'on' : ''}">${d.swLabels[i]}</button>`).join('')}</div>` : '';
    return `<div class="lrow" data-id="${d.id}">
      <i class="ti ${d.icon} licon" aria-hidden="true"></i>
      <div class="ltext"><div class="llab">${d.label}</div><div class="lsub ${s.err ? 'lerr' : ''}">${esc(s.err || s.sub || (s.loading ? 'กำลังโหลด…' : 'แตะเพื่อเปิด'))}</div></div>
      <label class="tog"><input type="checkbox" ${s.on ? 'checked' : ''} aria-label="${d.label}"><span></span></label>
    </div>${swHtml}${d.id === 'labels' ? tmodeHtml(s.on) : ''}`;
  }
  // การแสดงผลตำบล (โหมดสี) — ย้ายจากปุ่มมุมขวาบนของแผนที่ · ปิดเขตตำบลแล้วเป็นสีจางและเลือกไม่ได้
  function tmodeHtml(on) {
    const S = window.SDSS, cur = S.getMode();
    return `<fieldset class="tmode${on ? '' : ' off'}" ${on ? '' : 'disabled'}><legend>การแสดงผลตำบล</legend>
      ${S.tambonModes().map(m => `<label><input type="radio" name="tmode" value="${m.id}" ${m.id === cur ? 'checked' : ''}> ${esc(m.label)}</label>`).join('')}
    </fieldset>`;
  }
  // เรียงตามห่วงโซ่การเกิดน้ำท่วม: ฝน → อ่าง/ลำน้ำ → น้ำท่วม → ผลกระทบ → พื้นฐาน
  const GROUPS = [['① ฝน', ['rainsta', 'rainacc', 'radar']], ['② อ่างเก็บน้ำและลำน้ำ', ['dams', 'wlsta', 'structures', 'glofas']],
    ['③ น้ำท่วม', ['gistda', 'reports']], ['④ ผลกระทบ', ['bldg']], ['พื้นฐาน', ['labels', 'villages', 'rivers', 'water', 'basins']]];
  // แถบ tick box ชั้นข้อมูลสำคัญบนแผนที่ (มือถือ: แผงชั้นข้อมูลอยู่ใต้แผนที่ ต้องเลื่อนลงไปไกล) · สถานะตรงกับแผงซ้ายเสมอ
  const QUICK = [['wlsta', 'ระดับน้ำ'], ['dams', 'อ่างเก็บน้ำ'], ['rainsta', 'ฝน'], ['gistda', 'น้ำท่วม'],
    ['rivers', 'ลำน้ำ'], ['water', 'แหล่งน้ำ'], ['labels', 'เขตตำบล'], ['villages', 'หมู่บ้าน'], ['reports', 'จุดแจ้งเหตุ']];
  // แท็บภัยแล้ง: เฉพาะชั้นที่ใช้วิเคราะห์ภัยแล้ง (ผู้ใช้กำหนด 24 ต.ค. 69) — ดัชนี GISTDA → น้ำต้นทุน → พื้นฐาน
  // ฝน เรดาร์ ระดับน้ำ GloFAS ลำน้ำ ลุ่มน้ำ อาคารชลศาสตร์ อยู่เฉพาะแท็บน้ำท่วม · ชั้น dri/droughtfreq ไม่อยู่ในแท็บน้ำท่วม
  const GROUPS_D = [['① ดัชนีภัยแล้ง (GISTDA)', ['dri', 'droughtfreq', 'crops']], ['② น้ำต้นทุน', ['dams', 'water']],
    ['พื้นฐาน', ['labels', 'villages']]];
  const QUICK_D = [['dri', 'ดัชนีภัยแล้ง'], ['droughtfreq', 'แล้งซ้ำซาก'], ['crops', 'พื้นที่เกษตร'], ['dams', 'อ่างเก็บน้ำ'], ['water', 'แหล่งน้ำ'],
    ['labels', 'เขตตำบล'], ['villages', 'หมู่บ้าน']];
  const MODES = {
    flood: { groups: GROUPS, quick: QUICK, on: defs.filter(d => d.on).map(d => d.id) },
    drought: { groups: GROUPS_D, quick: QUICK_D, on: ['dri', 'dams', 'water', 'labels', 'villages'] },
  };
  let mode = location.hash === '#drought' ? 'drought' : 'flood';
  const isDefault = (id) => MODES[mode].on.includes(id);
  function renderQuick() {
    const el = $('qlayers'); if (!el) return;
    el.innerHTML = MODES[mode].quick.filter(([id]) => state[id]).map(([id, lab]) => { const s = state[id];
      return `<label class="qchip${s.on ? ' on' : ''}${s.loading ? ' busy' : ''}${s.err ? ' err' : ''}" title="${esc(s.err || lab)}">
        <input type="checkbox" data-id="${id}" ${s.on ? 'checked' : ''}> ${lab}</label>`; }).join('');
    el.querySelectorAll('input').forEach(cb => cb.onchange = () => setOn(cb.dataset.id, cb.checked));
  }
  function render() {
    renderQuick();
    $('layers').innerHTML = MODES[mode].groups.map(([g, ids]) => {
      const rows = ids.map(id => defs.find(d => d.id === id)).filter(Boolean);
      return rows.length ? `<div class="lgrp">${g}</div>` + rows.map(row).join('') : '';
    }).join('');
    $('layers').querySelectorAll('.lrow input').forEach(cb => cb.onchange = () => setOn(cb.closest('.lrow').dataset.id, cb.checked));
    $('layers').querySelectorAll('.tmode input').forEach(r => r.onchange = () => window.SDSS.setMode(r.value));
    $('layers').querySelectorAll('.lsw button').forEach(b => b.onclick = () => {
      const id = b.closest('.lsw').previousElementSibling.dataset.id;
      state[id].sw = b.dataset.sw; rebuild(id);
    });
  }
  async function rebuild(id) {
    const s = state[id];
    if (s.lyr) { map.removeLayer(s.lyr); s.lyr = null; }
    if (s.attr) map.attributionControl.removeAttribution(s.attr);   // ชื่อแหล่งข้อมูลเปลี่ยนตามตัวเลือก (เช่น DRI → SMAP)
    await setOn(id, true);
  }
  async function setOn(id, on) {
    const d = defs.find(x => x.id === id), s = state[id];
    s.on = on; s.err = null;
    if (!on) {
      if (s.lyr) map.removeLayer(s.lyr);
      if (s.toggle) s.toggle(false);
      if (s.attr) map.attributionControl.removeAttribution(s.attr);
      return render();
    }
    s.loading = true; render();
    try {
      const r = await d.build(s);
      Object.assign(s, { sub: r.sub, toggle: r.toggle, attr: r.attr });
      if (r.lyr) { s.lyr = r.lyr; if (s.on) s.lyr.addTo(map); }
      if (r.toggle) r.toggle(true);
      if (r.attr) map.attributionControl.addAttribution(r.attr);
    } catch (e) {
      s.err = e.message; s.on = false;
    }
    s.loading = false; render();
  }
  /* ---------- สถานการณ์ปัจจุบัน: KPI + รายการสถานีที่ควรจับตา ---------- */
  function setK(id, v, sub) { $(id).textContent = v; if ($(id + '-s')) $(id + '-s').textContent = sub || ''; }
  async function refreshNow() {
    const h = await history();
    try {
      const tw = await thaiwater();
      const rain = tw.rain.filter(s => s.rain_24h != null && rel(s)).sort((a, b) => b.rain_24h - a.rain_24h);
      const wl = tw.waterlevel.filter(s => s.storage_pct != null && rel(s)).sort((a, b) => b.storage_pct - a.storage_pct);
      const heavy = rain.filter(s => s.rain_24h >= 35.1);
      const nIn = (a) => a.filter(s => inArea(s.lat, s.lon)).length;
      const where = (s) => inArea(s.lat, s.lon) ? '' : ' (' + tag(s).replace(/<[^>]+>/g, '') + ')';
      setK('k-rmax', rain.length ? fmt(rain[0].rain_24h) + ' มม.' : '—', rain.length ? rain[0].name + where(rain[0]) : 'ไม่มีข้อมูลสถานี');
      setK('k-heavy', `${heavy.length}`, `จาก ${rain.length} สถานี (ในพื้นที่ ${nIn(rain)})`);
      const st = wl.map(s => ({ s, t: trendWL(h, s) })).map(x => Object.assign(x, { b: bankStatus(x.s, x.t), e: bankEta(x.s, x.t) }));
      const alarm = st.filter(x => ['near', 'over', 'severe'].includes(x.b.key) || x.e).sort((a, b) => b.b.rank - a.b.rank || b.s.storage_pct - a.s.storage_pct);
      const nOver = st.filter(x => ['over', 'severe'].includes(x.b.key)).length;
      setK('k-wl', `${alarm.filter(x => x.b.key !== 'high' && x.b.key !== 'normal').length}`,
        `ล้นตลิ่ง ${nOver} · จาก ${wl.length} สถานี (ในพื้นที่ ${nIn(wl)})`);
      renderAlert(alarm);
      const top = [
        ...wl.filter(s => s.storage_pct >= 30).slice(0, 5).map(s => ({ k: 'w:' + s.code, lyr: 'wlsta', c: bankStatus(s, trendWL(h, s)).color,
          t: s.name, tg: tag(s), sub: bankStatus(s, trendWL(h, s)).label + ' · อ.' + (s.amphoe || '—'),
          v: fmt(s.storage_pct, 0) + '%' + arrowShort((trendWL(h, s) || {}).d, 'cm') })),
        ...rain.filter(s => s.rain_24h >= 10.1).slice(0, 5).map(s => ({ k: 'r:' + s.lat + ',' + s.lon, lyr: 'rainsta', c: rainColor(s.rain_24h),
          t: s.name, tg: tag(s), sub: 'ฝน 24 ชม. · อ.' + (s.amphoe || '—'), v: fmt(s.rain_24h) + ' มม.' }))
      ];
      $('now').innerHTML = top.length ? top.map(x => `<div class="wrow" data-k="${esc(x.k)}" data-l="${x.lyr}">
          <span><span class="dot" style="background:${x.c}"></span>${esc(x.t)} ${x.tg}<span class="muted" style="display:block;font-size:11.5px;margin-left:15px">${esc(x.sub)}</span></span>
          <span class="mono">${x.v}</span></div>`).join('')
        : '<div class="muted" style="font-size:13px">ไม่มีสถานีที่ระดับน้ำ ≥ 30% ความจุ หรือฝน ≥ 10 มม. ใน 24 ชม.</div>';
      $('now-ts').textContent = '· ' + new Date(tw.time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
        + (tw.via === 'snapshot' ? ' (snapshot)' : '');
      $('now').querySelectorAll('.wrow').forEach(el => el.onclick = async () => {
        if (!state[el.dataset.l].on) await setOn(el.dataset.l, true);
        const m = MARK[el.dataset.k]; if (m) { map.setView(m.getLatLng(), Math.max(map.getZoom(), 12)); m.openPopup(); }
      });
    } catch (e) {
      $('now').innerHTML = `<div class="muted" style="font-size:13px">ดึงข้อมูลสถานี ThaiWater ไม่สำเร็จ: ${esc(e.message)}</div>`;
      ['k-rmax', 'k-heavy', 'k-wl'].forEach(id => setK(id, '—', 'ไม่มีข้อมูล'));
    }
    try {
      const p = await province(), dams = (p.dams || []).filter(d => !d.stale && d.pct != null && rel(d)).sort((a, b) => b.pct - a.pct);
      // ลำดับความสำคัญ: ในพื้นที่/ต้นน้ำลำเชียงไกร → ในลุ่มน้ำ → ต้นน้ำมูล (ไกลกว่า ผลต่อพื้นที่อ่อนกว่า)
      const pr = (d) => inArea(d.lat, d.lon) ? 0 : ({ LCK: 0, STUDY: 1, TAK: 2, MUN_UP: 2 }[basinOf(d.lat, d.lon)] ?? 3);
      const hi = dams.filter(d => d.pct >= 80).sort((a, b) => pr(a) - pr(b) || b.pct - a.pct), over = dams.filter(d => d.pct > 100);
      setK('k-dam', `${hi.length}`, `เกินความจุ ${over.length} · จาก ${dams.length} อ่าง`);
      const rows = hi.slice(0, 6).map(d => `<div class="wrow" data-k="d:${esc(d.name)}" data-l="dams">
          <span><span class="dot" style="background:${damColor(d)}"></span>${esc(d.name)} ${tag(d)}<span class="muted" style="display:block;font-size:11.5px;margin-left:15px">อ่างเก็บน้ำ · อ.${esc(d.amphoe || '—')}</span></span>
          <span class="mono">${fmt(d.pct, 0)}%${arrowShort(trendDam(h, d).d, '%')}</span></div>`).join('');
      $('now').insertAdjacentHTML('afterbegin', rows);
      $('now').querySelectorAll('.wrow[data-l="dams"]').forEach(el => el.onclick = async () => {
        if (!state.dams.on) await setOn('dams', true);
        const m = MARK[el.dataset.k]; if (m) { map.setView(m.getLatLng(), Math.max(map.getZoom(), 11)); m.openPopup(); }
      });
    } catch (e) { setK('k-dam', '—', e.message); }
    try {   // ฝนเฉลี่ยลุ่มลำเชียงไกร (แทน KPI ฝนคาดการณ์รายตำบล)
      const br = await json('data/live/basin_rain.json');
      const b = br && br.status === 'ok' && br.basins && br.basins.LCK;
      if (b) {
        $('k-fcst').previousElementSibling.textContent = 'ฝนเฉลี่ยลุ่มลำเชียงไกร 24 ชม.';
        $('k-fcst').textContent = fmt(b.past24) + ' มม.';
        const sub = $('k-fcst').nextElementSibling;
        if (sub) sub.textContent = `คาดการณ์ 24 ชม. ${fmt(b.next24)} · 72 ชม. ${fmt(b.next72)} มม. · 7 วัน ${fmt(b.past7d, 0)} มม.`;
      }
    } catch (e) { /* ยังไม่มีไฟล์ → คง KPI เดิม */ }
    try {
      const g = await json('data/live/gistda_flood_7d.geojson');
      if (g.status === 'ok') setK('k-flood', Number(g.total_rai || 0).toLocaleString('th-TH') + ' ไร่',
        `${Object.keys(g.by_tambon || {}).length} ตำบล · อาคาร ${Number((g.exposure || {}).building || 0).toLocaleString('th-TH')} หลัง · ทั้งจังหวัด ${Number(g.province_rai || 0).toLocaleString('th-TH')} ไร่`);
      else setK('k-flood', '—', g.status === 'not_configured' ? 'รอ GISTDA API key' : 'ดึงไม่สำเร็จ');
    } catch (e) { setK('k-flood', '—', 'ไม่มีข้อมูล'); }
  }

  /* ---------- แท็บภัยแล้ง: KPI + อ่างที่ควรจับตา (แสดงค่าจริง ไม่จัดระดับแล้ง/ไม่แล้ง) ---------- */
  // อ่างลำเชียงไกร: ค่าล่าสุดระหว่าง items กับ hist (กติกาเดียวกับรายงานสถานการณ์ใน report.js)
  const lckPct = (rid, code) => { const items = rid && rid.status === 'ok' ? (rid.items || []) : [];
    const hh = ((rid && rid.hist) || {})[code] || [], h2 = hh.filter(r => r[2] != null), i = items.find(x => x.code === code);
    if (i && i.pct != null && (!h2.length || i.date >= h2[h2.length - 1][0])) return { pct: i.pct, date: i.date, prev: h2.length ? h2[h2.length - 1][2] : null };
    return h2.length ? { pct: h2[h2.length - 1][2], date: h2[h2.length - 1][0], prev: h2.length > 1 ? h2[h2.length - 2][2] : null } : null; };
  const dDate = (s) => s ? new Date(s + 'T00:00:00+07:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : '—';
  // รายงานสถานการณ์ภัยแล้ง (แผงขวา + หน้าพิมพ์ A4) — แทนแถบ KPI เดิม · แสดงค่าจริง ไม่จัดระดับแล้ง
  // แต่ละหัวข้อเป็น [หัวข้อ, [[ชื่อ, ค่า, คำอธิบาย], …]] · ข้อความสำหรับพิมพ์สร้างจากโครงสร้างเดียวกัน (window.SDSS.droughtReport)
  let dRep = null;
  function droughtText(R) {
    const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' });
    const out = ['รายงานสถานการณ์ภัยแล้ง ต.จันอัด อ.โนนสูง จ.นครราชสีมา', `สร้างเมื่อ ${now} น.`];
    R.forEach(([h, rows]) => { out.push('', h); rows.forEach(([k, v, sub]) => out.push(`• ${k}: ${v}${sub ? ` (${sub})` : ''}`)); });
    out.push('', 'ดัชนีภัยแล้ง DRI/SMAP/NDWI (GISTDA ราย 7 วัน) ดูบนแผนที่', 'แสดงค่าจริงจากหน่วยงาน ไม่จัดระดับความรุนแรงภัยแล้ง · ไม่ใช่ประกาศเตือนภัยทางการ');
    return out.join('\n');
  }
  async function refreshDrought() {
    const R = [], sec = (h) => { const rows = []; R.push([h, rows]); return rows; };
    const res = sec('💧 น้ำในอ่างเก็บน้ำ');
    try {
      const rid = await json('data/live/rid_reservoir.json');
      [['อ่างลำเชียงไกรตอนบน', 'rsv300'], ['อ่างลำเชียงไกรตอนล่าง', 'rsv292']].forEach(([n, code]) => { const r = lckPct(rid, code);
        res.push([n, r ? fmt(r.pct, 0) + '% ความจุ' : '—', r ? `ข้อมูลวันที่ ${dDate(r.date)}${r.prev != null && r.pct !== r.prev ? ` · ${r.pct > r.prev ? '▲' : '▼'} ${fmt(Math.abs(r.pct - r.prev), 1)}% จากวันก่อน` : ''} · กรมชลประทาน` : 'ไม่มีข้อมูล']); });
    } catch (e) { res.push(['อ่างลำเชียงไกร', '—', 'ไม่มีข้อมูล']); }
    try {
      const p = await province(), dams = (p.dams || []).filter(d => !d.stale && d.pct != null && rel(d));
      const crit = dams.filter(d => d.pct < 30), low = dams.filter(d => d.pct >= 30 && d.pct < 50);   // ช่วงสีเดิมของชั้นอ่าง (DAM_BR)
      res.push(['อ่างในจังหวัด < 30% ความจุ', `${crit.length} อ่าง`, `30–50% อีก ${low.length} อ่าง · จาก ${dams.length} อ่าง · ${hhmm(p.updated_at)}`]);
      const h = await history();
      const rows = dams.slice().sort((a, b) => a.pct - b.pct).slice(0, 8);
      $('now-title').textContent = 'อ่างเก็บน้ำที่ควรจับตา (น้ำน้อยก่อน)';
      $('now').innerHTML = rows.length ? rows.map(d => `<div class="wrow" data-k="d:${esc(d.name)}" data-l="dams">
          <span><span class="dot" style="background:${damColor(d)}"></span>${esc(d.name)} ${tag(d)}<span class="muted" style="display:block;font-size:11.5px;margin-left:15px">อ่างเก็บน้ำ · อ.${esc(d.amphoe || '—')}</span></span>
          <span class="mono">${fmt(d.pct, 0)}%${arrowShort(trendDam(h, d).d, '%')}</span></div>`).join('')
        : '<div class="muted" style="font-size:13px">ไม่มีข้อมูลอ่างเก็บน้ำ</div>';
      $('now-ts').textContent = '· ' + hhmm(p.updated_at);
      $('now').querySelectorAll('.wrow').forEach(el => el.onclick = async () => {
        if (!state.dams.on) await setOn('dams', true);
        const m = MARK[el.dataset.k]; if (m) { map.setView(m.getLatLng(), Math.max(map.getZoom(), 11)); m.openPopup(); }
      });
    } catch (e) { res.push(['อ่างในจังหวัด', '—', e.message]); }
    const rec = sec('🔁 ภัยแล้งซ้ำซาก (GISTDA)');
    try {   // จำนวนครั้งที่ครอบคลุมพื้นที่ตำบลมากที่สุด (สัดส่วนพื้นที่จากขอบเขตตำบลของโครงการ)
      const d = await droughtfreq(), ca = (d.by_tambon || {})['301010'], ys = d.years || [];
      if (!ca || !ca.mode) throw new Error('no');
      const oth = Object.entries(ca.share).filter(([k, v]) => +k !== ca.mode && v >= 0.01).sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ครั้ง ${fmt(v * 100, 0)}%`).join(' · ');
      rec.push(['ต.จันอัด', `${ca.mode} ครั้ง ใน ${ys.length} ปี`, `${fmt((ca.share[ca.mode] || 0) * 100, 0)}% ของพื้นที่ตำบล${oth ? ' · ' + oth : ''} · ปี ${thYr(ys[0])}–${thYr(ys[ys.length - 1])}`]);
    } catch (e) { rec.push(['ต.จันอัด', '—', 'รอ workflow drought-layers สร้างข้อมูล']); }
    const ag = sec('🌾 พื้นที่การเกษตรที่ปลูกอยู่ (GISTDA)');
    try {
      const d = await json('data/crops.geojson'), ca = ((d.by_tambon || {})['301010'] || {}).crops_rai || {};
      const up = (d.data_updates || []).slice(-1)[0];
      const ent = Object.entries(ca).sort((a, b) => b[1] - a[1]);
      if (!ent.length) ag.push(['ต.จันอัด', 'ไม่พบพื้นที่ปลูกพืชเศรษฐกิจ', `ข้อมูลวันที่ ${dDate(up)}`]);
      ent.forEach(([c, v], i) => ag.push([cropOf(c, i)[0], `${rai(v)} ไร่`, i === 0 ? `ต.จันอัด · ข้อมูลวันที่ ${dDate(up)} (ราย 2 สัปดาห์)` : '']));
    } catch (e) { ag.push(['ต.จันอัด', '—', 'รอ workflow crop-layers สร้างข้อมูล']); }
    dRep = R;
    $('drep-ts').textContent = '· ' + new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    $('drep-body').innerHTML = R.map(([h, rows]) => `<div class="dr-sec">${esc(h)}</div>` + rows.map(([k, v, sub]) =>
      `<div class="dr-row"><span>${esc(k)}${sub ? `<span class="dr-sub">${esc(sub)}</span>` : ''}</span><span class="mono">${esc(v)}</span></div>`).join('')).join('');
  }
  window.SDSS.droughtReport = async () => { if (!dRep) await refreshDrought(); return droughtText(dRep); };

  // สลับแท็บ: เปิด/ปิดชั้นข้อมูลตามค่าเริ่มต้นของแท็บ · แถว KPI (น้ำท่วม) / รายงานภัยแล้ง (แผงขวา) · รายการจับตา · แถบเตือนตลิ่ง (เฉพาะน้ำท่วม)
  function applyMode(m, first) {
    mode = m;
    document.querySelectorAll('#modetabs .mtab[data-mode]').forEach(a => { const on = a.dataset.mode === m;
      a.classList.toggle('on', on); a.setAttribute('aria-current', on ? 'page' : 'false'); });
    $('kpi-flood').hidden = m !== 'flood'; $('drep').hidden = m !== 'drought';
    document.body.classList.toggle('mode-drought', m === 'drought');
    if (m !== 'flood' && $('bank-alert')) $('bank-alert').hidden = true;
    setTimeout(legendD);
    $('now-title').textContent = 'สถานีที่ควรจับตา';
    defs.forEach(d => { const want = isDefault(d.id);
      if (first ? want : state[d.id].on !== want) setOn(d.id, want); });
    render();
    if (m === 'drought') refreshDrought(); else refreshNow();
  }

  /* ---------- แถบแจ้งเตือนระดับน้ำเทียบตลิ่ง ---------- */
  function renderAlert(alarm) {
    const el = $('bank-alert');
    if (!el) return;
    if (!alarm.length || mode !== 'flood') { el.hidden = true; return; }
    const top = alarm[0].b;
    el.hidden = false;
    el.style.background = top.color;
    el.style.color = top.key === 'high' ? '#0F172A' : '#FFFFFF';
    el.innerHTML = `<b>เฝ้าระวังระดับน้ำ:</b> ` + alarm.slice(0, 4).map(x =>
      `<a href="#" data-k="w:${esc(x.s.code)}">${esc(x.s.name)}</a> ${x.b.label} ${fmt(x.s.storage_pct, 0)}%` +
      `${inArea(x.s.lat, x.s.lon) ? ' (ในพื้นที่)' : ''}${x.e ? ` · คาดถึงตลิ่ง ~${x.e.h < 1 ? '<1' : Math.round(x.e.h)} ชม.` : ''}`).join(' · ')
      + (alarm.length > 4 ? ` · และอีก ${alarm.length - 4} สถานี` : '')
      + `<span class="bk-note">${BK.verified ? '' : ' · เกณฑ์ 70/90% ยังไม่ยืนยันกับหน่วยงาน · '}ไม่ใช่ประกาศเตือนภัยทางการ</span>`;
    el.querySelectorAll('a').forEach(a => a.onclick = async (ev) => {
      ev.preventDefault();
      if (!state.wlsta.on) await setOn('wlsta', true);
      const m = MARK[a.dataset.k]; if (m) { map.setView(m.getLatLng(), Math.max(map.getZoom(), 12)); m.openPopup(); }
    });
  }

  /* ---------- แตะจุดใดก็ได้: สถานีและอ่างที่ใกล้ที่สุด ---------- */
  const TAMB = window.SDSS.tambon.features.map(f => ({ code: f.properties.tcode,
    polys: f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates }));
  const km = (a, b, c, d) => {   // haversine
    const r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(x));
  };
  const nearest = (arr, la, lo, ok = () => true) => arr.filter(ok).map(x => [x, km(la, lo, x.lat, x.lon)]).sort((a, b) => a[1] - b[1])[0];
  let probe = null;
  map.on('click', async (e) => {
    const la = e.latlng.lat, lo = e.latlng.lng;
    if (probe) map.removeLayer(probe);
    probe = L.circleMarker(e.latlng, { radius: 12, color: '#0F172A', weight: 2, dashArray: '4 3', fill: false, interactive: false }).addTo(map);
    const t = TAMB.find(tb => tb.polys.some(p => inRing(lo, la, p[0]) && !p.slice(1).some(hh => inRing(lo, la, hh))));
    if (t) window.SDSS.select(t.code);
    else $('query').innerHTML = '<div class="q-name">จุดนอกพื้นที่ศึกษา</div>';
    const [tw, p, h, gf] = await Promise.all([thaiwater().catch(() => null), province().catch(() => null), history(),
      json('data/live/gistda_flood_7d.geojson').catch(() => null)]);
    const fl = gf && gf.status === 'ok' && t ? `<dt>น้ำท่วมตรวจพบ 7 วัน (ทั้งตำบล)</dt><dd class="mono">${fmt((gf.by_tambon || {})[t.code] || 0, 0)} ไร่</dd>` : '';
    const row = (lab, hit, val) => hit ? `<dt>${lab}</dt><dd>${val(hit[0])}<span class="muted" style="display:block;font-size:11px">${esc(hit[0].name)} · ${fmt(hit[1], 1)} กม.</span></dd>` : `<dt>${lab}</dt><dd>—</dd>`;
    const rs = tw && nearest(tw.rain, la, lo, x => x.rain_24h != null);
    const ws = tw && nearest(tw.waterlevel, la, lo, x => x.storage_pct != null);
    const r7 = p && nearest(p.rain7d || [], la, lo, x => x.v != null);
    const dm = p && nearest(p.dams || [], la, lo, x => !x.stale && x.pct != null);
    const block = `<div class="probe">
      <div class="probe-h">จุดที่แตะ <span class="mono">${la.toFixed(4)}, ${lo.toFixed(4)}</span></div>
      <dl class="kv kv-main">
        ${fl}
        ${row('ระดับน้ำ ใกล้สุด', ws, s => `<span class="bk" style="background:${bankStatus(s, trendWL(h, s)).color}">${bankStatus(s, trendWL(h, s)).label}</span> <span class="mono">${fmt(s.storage_pct, 0)}%</span>${arrowShort((trendWL(h, s) || {}).d, 'cm')}`)}
      </dl>
      <details class="more-d"><summary>สถานีฝนและอ่างใกล้จุดนี้</summary>
        <dl class="kv">
          ${row('ฝน 24 ชม. ใกล้สุด', rs, s => `<span class="mono">${fmt(s.rain_24h)} มม.</span>`)}
          ${row('ฝนสะสม 7 วัน ใกล้สุด', r7, s => `<span class="mono">${fmt(s.v)} มม.</span>`)}
          ${row('อ่างเก็บน้ำ ใกล้สุด', dm, d => `<span class="mono">${fmt(d.pct, 0)}%</span>${arrowShort(trendDam(h, d).d, '%')}`)}
        </dl>
      </details>
      <div class="muted" style="font-size:11px;margin-top:4px">ระยะทางเป็นเส้นตรง ไม่ได้บอกว่าสถานีอยู่ต้นน้ำหรือท้ายน้ำของจุดนี้</div>
    </div>`;
    $('query').insertAdjacentHTML('beforeend', block);
  });

  /* ---------- รีเฟรชอัตโนมัติทุก 10 นาที (เฉพาะเมื่อแท็บเปิดอยู่) ---------- */
  let lastRun = Date.now();
  async function refreshAll() {
    if (document.hidden) return;
    lastRun = Date.now();
    twCache = null; provCache = null; histCache = null;
    for (const d of defs) {
      const st = state[d.id];
      // เลเยอร์ที่เปิดอยู่ → โหลดใหม่ · เลเยอร์ที่ตั้งให้เปิดแต่โหลดไม่สำเร็จตอนแรก → ลองใหม่
      if (d.id !== 'labels' && (st.on || (isDefault(d.id) && st.err))) await rebuild(d.id);
    }
    await (mode === 'drought' ? refreshDrought() : refreshNow());
  }
  setInterval(refreshAll, 10 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastRun > 10 * 60 * 1000) refreshAll(); });

  // ซ่อน/แสดงแผงชั้นข้อมูลด้านซ้าย (แผนที่ต้องคำนวณขนาดใหม่หลังเปลี่ยน layout)
  const lp = (hide) => { $('body').classList.toggle('lp-hidden', hide); setTimeout(() => map.invalidateSize(), 60); };
  if ($('lp-hide')) $('lp-hide').onclick = () => lp(true);
  if ($('lp-show')) $('lp-show').onclick = () => lp(false);

  // ปุ่มรายงาน/ขอความช่วยเหลือ → หน้า LIFF (ใช้ได้เมื่อตั้งค่า LINE OA แล้วใน liff/config.js)
  const LC = window.LINE_CFG || {}, lineReady = LC.LIFF_ID && !/YOUR_/.test(LC.LIFF_ID) && LC.API && !/YOUR-/.test(LC.API);
  // ปุ่มรายงาน/ขอความช่วยเหลือ:
  //  1) ระบบ D1 + LIFF พร้อม (LIFF_ID, API) → เปิดฟอร์มปักหมุด
  //  2) มีเพียง LINE OA (OA_ID) → เปิดแชท "จันอัดบ้านฉัน" พร้อมพิมพ์คำสั่งให้ ผู้ใช้กดส่ง แล้วทำตามขั้นตอนในแชท
  const oaId = LC.OA_ID && !/YOUR_/.test(LC.OA_ID) ? LC.OA_ID.trim() : '';
  const oaLink = (msg) => `https://line.me/R/oaMessage/${encodeURIComponent(oaId)}/?${encodeURIComponent(msg)}`;
  [['btn-report', 'report.html', 'รายงานเหตุ'], ['btn-help', 'help.html', 'ขอความช่วยเหลือ']].forEach(([id, page, cmd]) => { const a = $(id); if (!a) return;
    if (lineReady) a.href = `https://liff.line.me/${LC.LIFF_ID}/${page}`;
    else if (oaId) a.href = oaLink(cmd);
    else { a.classList.add('off'); a.removeAttribute('href'); return; }
    a.target = '_blank'; a.rel = 'noopener'; });
  if ($('act-note')) $('act-note').innerHTML = lineReady ? $('act-note').innerHTML
    : oaId ? `ทุกคนแจ้งได้ ไม่ต้องลงทะเบียน · เปิดแชท LINE "จันอัดบ้านฉัน" แล้วกด<b>ส่ง</b> · ต้องแชร์ตำแหน่ง · แจ้งเหตุขึ้นเป็นจุดแดง ขอความช่วยเหลือขึ้นเป็นจุดม่วง SOS ตามตำแหน่งจริง ทุกคนเห็น อบต. ติดตาม · ไม่ผ่าน ADM · ต้องเพิ่มเพื่อนก่อน (<a href="https://line.me/R/ti/p/${encodeURIComponent(oaId)}" target="_blank" rel="noopener">เพิ่มเพื่อน</a>) · อันตรายต่อชีวิตโทร 1669 / 1784`
    : 'เปิดใช้เมื่อตั้งค่า LINE OA เสร็จ · อันตรายต่อชีวิตโทร 1669 / 1784';
  if ($('now-more')) $('now-more').onclick = () => { const c = $('now').classList.toggle('collapsed'); $('now-more').textContent = c ? 'ดูทั้งหมด ▾' : 'ย่อ ▴'; };

  defs.forEach(d => state[d.id] = { on: false });
  render();
  applyMode(mode, true);
  window.addEventListener('hashchange', () => {
    const m = location.hash === '#drought' ? 'drought' : location.hash === '#flood' || !location.hash ? 'flood' : null;
    if (m && m !== mode) applyMode(m);
  });
});
