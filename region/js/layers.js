/* เลเยอร์เพิ่มเติมจากหลายแหล่ง — โหลดเมื่อผู้ใช้เปิดเท่านั้น (lazy) เพื่อไม่ให้หน้าแรกช้า
   แหล่งที่เรียกจากเบราว์เซอร์ตรง: ThaiWater public API, RainViewer
   แหล่งที่ผ่าน GitHub Actions (ต้องใช้ key): GISTDA flood 7 วัน, Sentinel-1 (Earth Engine) */
document.addEventListener('sdss:ready', () => {
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
  let _bb = null;
  const tag = (s) => inArea(s.lat, s.lon) ? '<span class="tag-in">ในพื้นที่</span>'
    : inBox(s.lat, s.lon, _bb || (_bb = bbox())) ? '<span class="tag-out">ใกล้เคียง</span>' : '<span class="tag-out">นอกพื้นที่</span>';
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
    if (!provCache) provCache = json('data/live/tw_province.json').then(d => {
      if (!d.updated_at) throw new Error('รอ workflow รันรอบแรก');
      return d;
    }).catch(e => { provCache = null; throw e; });
    return provCache;
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
    const arr = (h.dam[d.name] || []).filter(x => x[0] < d.date);
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
  const wlColor = v => v === null || v === undefined ? '#94A3B8' : WL_BR.find(([b]) => v >= b)[1];

  /* ---------- นิยามเลเยอร์ ---------- */
  const defs = [
    {
      id: 'gistda', icon: 'ti-satellite', label: 'น้ำท่วมตรวจพบ (ดาวเทียม)', on: true,
      async build() {
        const d = await json('data/live/gistda_flood_7d.geojson');
        if (d.status === 'not_configured') throw new Error('ยังไม่ตั้ง GISTDA_API_KEY');
        if (d.status === 'error' && !d.features.length) throw new Error('ดึงจาก GISTDA ไม่สำเร็จ');
        const lyr = L.geoJSON(d, { style: f => ({ color: f.properties.in_area ? '#1D4ED8' : '#64748B', weight: 0.4,
            fillColor: '#3B82F6', fillOpacity: f.properties.in_area ? 0.6 : 0.35 }),
          onEachFeature: (f, l) => l.bindPopup(`<b>น้ำท่วมตรวจพบ (GISTDA 7 วัน)</b><br>ต.${esc(f.properties.tb_name)} อ.${esc(f.properties.ap_name)}<br>
            ${fmt(f.properties.area_rai, 1)} ไร่ในเซลล์นี้<br>
            ${f.properties.bldg ? `อาคาร ${f.properties.bldg} หลัง · ` : ''}${f.properties.pop ? `ประชากร ~${f.properties.pop} คน · ` : ''}${f.properties.school ? `โรงเรียน ${f.properties.school} · ` : ''}${f.properties.hosp ? `สถานพยาบาล ${f.properties.hosp}` : ''}
            <br><span class="muted">ภาพ ${esc(imgs(f.properties.img))}</span>`) });
        const nT = Object.keys(d.by_tambon || {}).length;
        return { lyr, sub: `ในพื้นที่ ${Number(d.total_rai || 0).toLocaleString('th-TH')} ไร่ · ${nT} ตำบล · ภาพล่าสุด ${imgs((d.images || []).slice(-1)[0])}`,
          attr: 'น้ำท่วม © GISTDA' };
      }
    },
    {
      id: 's1', icon: 'ti-radar-2', label: 'ภาพเรดาร์ Sentinel-1', on: false,
      async build() {
        const m = await json('data/live/s1_latest.json');
        if (m.status === 'not_configured') throw new Error('ยังไม่ตั้ง Earth Engine service account');
        if (!m.date) throw new Error(m.status === 'no_image' ? 'ไม่มีภาพในรอบ 14 วัน' : 'ยังไม่มีภาพ');
        const lyr = L.imageOverlay('data/live/s1_latest.png?d=' + m.date, m.bounds, { opacity: 0.8 });
        return { lyr, sub: `VV ${m.date} · ผิวน้ำเรียบเป็นสีเข้ม`, attr: 'Contains Copernicus Sentinel data' };
      }
    },
    {
      id: 'labels', icon: 'ti-map-pin', label: 'ชื่อตำบล + ขอบเขตอำเภอ', on: true,
      async build() {
        return { toggle: (on) => map.getContainer().classList.toggle('hide-labels', !on), sub: 'อำเภอ ตำบล' };
      }
    },
    {
      id: 'radar', icon: 'ti-cloud-rain', label: 'เรดาร์ฝน', on: true,
      async build() {
        const d = await json(L_.rainviewer);
        const f = d.radar && d.radar.past && d.radar.past[d.radar.past.length - 1];
        if (!f) throw new Error('ไม่มีภาพเรดาร์');
        const lyr = L.tileLayer(d.host + f.path + '/256/{z}/{x}/{y}/2/1_1.png',
          { opacity: 0.6, maxNativeZoom: L_.rainviewer_max_native_zoom, maxZoom: 18, zIndex: 400,
            attribution: 'Weather data by <a href="https://www.rainviewer.com" target="_blank" rel="noopener">RainViewer</a>' });
        return { lyr, sub: 'RainViewer · ' + new Date(f.time * 1000).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) };
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
          fillColor: rainColor(s[key]), fillOpacity: 0.9
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
          fillColor: bankStatus(s, trendWL(h, s)).color, fillOpacity: 0.95
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
        return { lyr, sub: `ThaiWater · ${tw.waterlevel.length} สถานี · สี = สถานะเทียบตลิ่ง`, attr: 'สถานี © สสน. (ThaiWater)' };
      }
    },
    {
      id: 'rainacc', icon: 'ti-cloud-storm', label: 'ฝนสะสมหลายวัน (สถานีจังหวัด)', on: false, sw: ['rain7d', 'rain3d'],
      swLabels: ['สะสม 7 วัน', 'สะสม 3 วัน'],
      async build(state) {
        const p = await province(), key = state.sw || 'rain7d', rows = p[key] || [];
        const lyr = L.layerGroup(rows.map(s => L.circleMarker([s.lat, s.lon], {
          bubblingMouseEvents: false,
          radius: inArea(s.lat, s.lon) ? 7 : 5, weight: inArea(s.lat, s.lon) ? 1.5 : 1,
          color: inArea(s.lat, s.lon) ? '#0F172A' : '#64748B', dashArray: inArea(s.lat, s.lon) ? null : '2 2',
          fillColor: r7Color(key === 'rain7d' ? s.v : s.v * 7 / 3), fillOpacity: 0.9
        }).bindPopup(`<b>${esc(s.name)}</b> ${tag(s)}<br>ต.${esc(s.tambon)} อ.${esc(s.amphoe)}<br>
            ฝนสะสม ${key === 'rain7d' ? '7' : '3'} วัน <b>${fmt(s.v)}</b> มม.<br>
            <span class="muted">${esc(s.start)} ถึง ${esc(s.end)} · ${esc(s.agency)}</span>`)));
        return { lyr, sub: `ThaiWater จังหวัด · ${rows.length} สถานี · ${hhmm(p.updated_at)}`, attr: 'สถานี © สสน. (ThaiWater)' };
      }
    },
    {
      id: 'dams', icon: 'ti-building-bridge-2', label: 'อ่างเก็บน้ำ', on: true,
      async build() {
        const [p, h] = await Promise.all([province(), history()]), rows = p.dams || [];
        const lyr = L.layerGroup(rows.map(d => L.circleMarker([d.lat, d.lon], {
          bubblingMouseEvents: false,
          radius: d.kind === 'large' ? 11 : 7, weight: 2, color: '#FFFFFF', fillColor: damColor(d), fillOpacity: 0.95
        }).bindPopup(`<b>${esc(d.name)}</b> ${tag(d)}<br>${d.kind === 'large' ? 'เขื่อน/อ่างขนาดใหญ่' : 'อ่างขนาดกลาง'} · อ.${esc(d.amphoe)}<br>
            ปริมาณน้ำ <b>${fmt(d.pct, 1)}%</b> (${fmt(d.storage, 2)} ล้าน ลบ.ม.)<br>
            น้ำไหลเข้า ${fmt(d.inflow, 2)} · ระบาย ${fmt(d.released, 2)} ล้าน ลบ.ม./วัน<br>
            <span class="muted">ข้อมูลวันที่ ${esc(d.date)}${d.stale ? ' — ข้อมูลเก่า' : ''}</span>
            ${d.stale ? '' : (() => { const t = trendDam(h, d); return `<div class="trend">เทียบวันก่อน ${arrow(t.d, '%', 1)}</div>${spark(t.series, 'ปริมาณน้ำ %')}`; })()}`)
          .on('add', function () { MARK['d:' + d.name] = this; })));
        const n = rows.filter(d => !d.stale && d.pct != null).length;
        return { lyr, sub: `ThaiWater จังหวัด · ${n} อ่างมีข้อมูลปัจจุบัน · ${hhmm(p.updated_at)}`, attr: 'อ่างเก็บน้ำ © สสน. (ThaiWater)' };
      }
    },
    {
      id: 'bldg', icon: 'ti-building', label: 'บ้านเรือน (ความหนาแน่น)', on: false,
      async build() {
        if (!hex || !hex.features.length || hex.features[0].properties.bldg === undefined) throw new Error('รอชั้น hexagon จาก GEE');
        const mx = Math.max(...hex.features.map(f => f.properties.bldg));
        const ramp = ['#F1F5F9', '#CBD5E1', '#94A3B8', '#475569', '#0F172A'];
        const lyr = L.geoJSON(hex, { style: f => ({ stroke: false, fillOpacity: 0.7,
          fillColor: ramp[Math.min(4, Math.floor(5 * f.properties.bldg / (mx + 1)))] }),
          onEachFeature: (f, l) => l.bindPopup(`อาคาร ${f.properties.bldg} หลัง ต่อ hexagon`) });
        const tot = hex.features.reduce((a, f) => a + f.properties.bldg, 0);
        return { lyr, sub: `${tot.toLocaleString('th-TH')} หลัง · Open Buildings V3`, attr: 'อาคาร © Google Open Buildings' };
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
    </div>${swHtml}`;
  }
  function render() {
    $('layers').innerHTML = defs.map(row).join('');
    $('layers').querySelectorAll('.lrow input').forEach(cb => cb.onchange = () => setOn(cb.closest('.lrow').dataset.id, cb.checked));
    $('layers').querySelectorAll('.lsw button').forEach(b => b.onclick = () => {
      const id = b.closest('.lsw').previousElementSibling.dataset.id;
      state[id].sw = b.dataset.sw; rebuild(id);
    });
  }
  async function rebuild(id) {
    const s = state[id];
    if (s.lyr) { map.removeLayer(s.lyr); s.lyr = null; }
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
      const rain = tw.rain.filter(s => s.rain_24h != null).sort((a, b) => b.rain_24h - a.rain_24h);
      const wl = tw.waterlevel.filter(s => s.storage_pct != null).sort((a, b) => b.storage_pct - a.storage_pct);
      const heavy = rain.filter(s => s.rain_24h >= 35.1);
      const nIn = (a) => a.filter(s => inArea(s.lat, s.lon)).length;
      const where = (s) => inArea(s.lat, s.lon) ? '' : ' (ใกล้เคียง)';
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
      const p = await province(), dams = (p.dams || []).filter(d => !d.stale && d.pct != null).sort((a, b) => b.pct - a.pct);
      const hi = dams.filter(d => d.pct >= 80), over = dams.filter(d => d.pct > 100);
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
    try {
      const g = await json('data/live/gistda_flood_7d.geojson');
      if (g.status === 'ok') setK('k-flood', Number(g.total_rai || 0).toLocaleString('th-TH') + ' ไร่',
        `${Object.keys(g.by_tambon || {}).length} ตำบล · อาคาร ${Number((g.exposure || {}).building || 0).toLocaleString('th-TH')} หลัง · ทั้งจังหวัด ${Number(g.province_rai || 0).toLocaleString('th-TH')} ไร่`);
      else setK('k-flood', '—', g.status === 'not_configured' ? 'รอ GISTDA API key' : 'ดึงไม่สำเร็จ');
    } catch (e) { setK('k-flood', '—', 'ไม่มีข้อมูล'); }
  }

  /* ---------- แถบแจ้งเตือนระดับน้ำเทียบตลิ่ง ---------- */
  function renderAlert(alarm) {
    const el = $('bank-alert');
    if (!el) return;
    if (!alarm.length) { el.hidden = true; return; }
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
      <dl class="kv">
        ${fl}
        ${row('ฝน 24 ชม. ใกล้สุด', rs, s => `<span class="mono">${fmt(s.rain_24h)} มม.</span>`)}
        ${row('ฝนสะสม 7 วัน ใกล้สุด', r7, s => `<span class="mono">${fmt(s.v)} มม.</span>`)}
        ${row('ระดับน้ำ ใกล้สุด', ws, s => `<span class="bk" style="background:${bankStatus(s, trendWL(h, s)).color}">${bankStatus(s, trendWL(h, s)).label}</span> <span class="mono">${fmt(s.storage_pct, 0)}%</span>${arrowShort((trendWL(h, s) || {}).d, 'cm')}`)}
        ${row('อ่างเก็บน้ำ ใกล้สุด', dm, d => `<span class="mono">${fmt(d.pct, 0)}%</span>${arrowShort(trendDam(h, d).d, '%')}`)}
      </dl>
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
      if (d.id !== 'labels' && (st.on || (d.on && st.err))) await rebuild(d.id);
    }
    await refreshNow();
  }
  setInterval(refreshAll, 10 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastRun > 10 * 60 * 1000) refreshAll(); });

  defs.forEach(d => state[d.id] = { on: false });
  render();
  defs.filter(d => d.on).forEach(d => setOn(d.id, true));
  refreshNow();
});
