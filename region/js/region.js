/* SDSS น้ำท่วม โนนไทย–โนนสูง — หน้า L1/L2
   ตรรกะ tState()/riskRank() ต้องตรงกับ scripts/region/compute_risk.py */
(async function () {
  'use strict';

  const LEVEL_COLOR = ['#1E8449', '#F4D03F', '#E67E22', '#C0392B'];
  const S_COLOR = ['#EAF3DE', '#FAC775', '#F0997B', '#E24B4A'];
  const NA_COLOR = '#CBD5E1';
  const RAIN24 = { breaks: [0.1, 10.1, 35.1, 90.1], colors: ['#F8FAFC', '#C6DBEF', '#6BAED6', '#2171B5', '#08306B'],
    labels: ['ไม่มีฝน', 'ฝนเล็กน้อย 0.1–10', 'ฝนปานกลาง 10.1–35', 'ฝนหนัก 35.1–90', 'ฝนหนักมาก > 90'] };
  const RAIN7 = { breaks: [10, 50, 100, 200], colors: ['#F8FAFC', '#C6DBEF', '#6BAED6', '#2171B5', '#08306B'],
    labels: ['< 10', '10–50', '50–100', '100–200', '> 200'] };

  const $ = (id) => document.getElementById(id);
  const fmt = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v)) ? '—' : Number(v).toFixed(d);

  async function load(url) {
    try {
      const r = await fetch(url, { cache: 'no-cache' });
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } catch (e) { console.warn('โหลดไม่สำเร็จ:', url, e); return null; }
  }

  const [cfg, tambon, amphoe, hex, rainFile, water] = await Promise.all([
    load('config.json'), load('data/tambon.geojson'), load('data/amphoe.geojson'),
    load('data/hex.geojson'), load('data/live/rain_region.json'), load('data/live/water_region.json')
  ]);
  if (!cfg || !tambon) {
    $('badge').className = 'badge badge-err'; $('badge').textContent = 'โหลดข้อมูลหลักไม่สำเร็จ';
    return;
  }

  /* ---------- ฝน: ใช้ไฟล์จาก GitHub Actions ก่อน ถ้าไม่มี/เก่า ดึงตรงจาก Open-Meteo ---------- */
  const ageMin = (iso) => iso ? (Date.now() - new Date(iso).getTime()) / 60000 : Infinity;
  let rain = rainFile, rainVia = 'actions';
  if (!rain || rain.status !== 'ok' || ageMin(rain.updated_at) > cfg.stale_after_min) {
    const direct = await fetchRainDirect(tambon.features.map(f => f.properties));
    if (direct) { rain = direct; rainVia = 'browser'; }
  }

  async function fetchRainDirect(pts) {
    const q = new URLSearchParams({
      latitude: pts.map(p => p.lat).join(','), longitude: pts.map(p => p.lon).join(','),
      hourly: 'precipitation', past_days: 7, forecast_days: 2, timezone: 'Asia/Bangkok'
    });
    try {
      const r = await fetch('https://api.open-meteo.com/v1/forecast?' + q);
      if (!r.ok) throw new Error(r.status);
      let d = await r.json(); if (!Array.isArray(d)) d = [d];
      const now = new Date(); now.setMinutes(0, 0, 0);
      const rows = pts.map((p, i) => {
        let a = 0, b = 0, c = 0;
        d[i].hourly.time.forEach((t, k) => {
          const v = d[i].hourly.precipitation[k]; if (v == null) return;
          const h = (new Date(t + ':00+07:00') - now) / 3.6e6;
          if (h > -24 && h <= 0) a += v;
          if (h > -168 && h <= 0) b += v;
          if (h > 0 && h <= 24) c += v;
        });
        return { tcode: p.tcode, rain_24h_mm: +a.toFixed(1), rain_7d_mm: +b.toFixed(1), rain_next24h_mm: +c.toFixed(1) };
      });
      return { status: 'ok', updated_at: new Date().toISOString(), source: 'Open-Meteo (ดึงจากเบราว์เซอร์)', tambon: rows };
    } catch (e) { console.warn('Open-Meteo ไม่ตอบสนอง', e); return null; }
  }

  /* ---------- ตรรกะ S × T ---------- */
  function tFromRain(r) {
    if (!r) return null;
    const th = cfg.rain.tmd_24h_mm, x = Math.max(r.rain_24h_mm, r.rain_next24h_mm);
    let t = x >= th.very_heavy ? 2 : x >= th.heavy ? 1 : 0;
    const wet = cfg.rain.wet_7d_mm;
    if (wet !== null && t >= 1 && r.rain_7d_mm >= wet) t += 1;
    return Math.min(t, 3);
  }
  function tFromWater(st) {
    // storage_pct ของ ThaiWater (ร้อยละความจุลำน้ำ) — level_m/bank_m เป็นค่า ม.รทก. หารกันไม่ได้
    if (!st || st.storage_pct === null || st.storage_pct === undefined) return null;
    const x = st.storage_pct / 100, th = cfg.water.ratio;
    return x >= th.crit ? 3 : x >= th.warn ? 2 : x >= th.watch ? 1 : 0;
  }
  const rainMap = new Map((rain && rain.tambon || []).map(r => [r.tcode, r]));
  const staMap = new Map((water && water.stations || []).map(s => [s.code, s]));
  const riskRank = (s, t) => (s && t !== null && t !== undefined) ? cfg.matrix[s - 1][t] : null;

  const T = {};   // สถานะรายตำบล
  tambon.features.forEach(f => {
    const p = f.properties, r = rainMap.get(p.tcode), st = staMap.get(p.station_code);
    const ts = [tFromRain(r), tFromWater(st)].filter(v => v !== null);
    const t = ts.length ? Math.max(...ts) : null;
    T[p.tcode] = { p, r, st, t, s: p.s_class, rank: riskRank(p.s_class, t) };
  });
  const hasS = tambon.features.some(f => f.properties.s_class);

  /* ---------- แผนที่ ---------- */
  const map = L.map('map', { preferCanvas: true, zoomControl: true, attributionControl: true });
  const base = {
    'OSM': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }),
    'ภาพดาวเทียม': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: 'Esri World Imagery' })
  };
  base.OSM.addTo(map);
  L.control.layers(base, null, { position: 'bottomright' }).addTo(map);

  const modes = [
    { id: 'none', label: 'เส้นขอบเขตอย่างเดียว' },
    { id: 'risk', label: 'ความเสี่ยงตอนนี้ (S×T)', need: () => hasS },
    { id: 't', label: 'สภาวะกระตุ้น (T)' },
    { id: 'r24', label: 'ฝน 24 ชม. / คาดการณ์' },
    { id: 'r7', label: 'ฝนสะสม 7 วัน' },
    { id: 's', label: 'ความอ่อนไหวคงที่ (S)', need: () => hasS }
  ];
  let mode = 'none', selected = null, showTambon = true;   // ค่าเริ่มต้น: แสดงเฉพาะเส้นขอบเขต ไม่ระบายสี

  function colorFor(code) {
    const o = T[code];
    if (mode === 'none') return NA_COLOR;
    if (mode === 'risk') return o.rank === null ? NA_COLOR : LEVEL_COLOR[o.rank];
    if (mode === 't') return o.t === null ? NA_COLOR : LEVEL_COLOR[o.t];
    if (mode === 's') return o.s ? S_COLOR[o.s - 1] : NA_COLOR;
    const sc = mode === 'r24' ? RAIN24 : RAIN7;
    if (!o.r) return NA_COLOR;
    const v = mode === 'r24' ? Math.max(o.r.rain_24h_mm, o.r.rain_next24h_mm) : o.r.rain_7d_mm;
    let i = 0; while (i < sc.breaks.length && v >= sc.breaks[i]) i++;
    return sc.colors[i];
  }

  const hexLayer = hex ? L.geoJSON(hex, {
    interactive: false,
    style: f => {
      const s = f.properties.s_class, o = T[f.properties.tcode];
      let c = NA_COLOR;
      if (mode === 's' && s) c = S_COLOR[s - 1];
      if (mode === 'risk' && s && o && o.t !== null) c = LEVEL_COLOR[cfg.matrix[s - 1][o.t]];
      return { stroke: false, fillColor: c, fillOpacity: 0.55 };
    }
  }) : null;

  const tLayer = L.geoJSON(tambon, {
    style: f => {
      const showHex = hexLayer && (mode === 'risk' || mode === 's');
      const sb = f.properties.tcode === cfg.sandbox.tcode, sel = f.properties.tcode === selected;
      // ปิดชั้นเขตตำบล: โปร่งใสทั้งสีและเส้น แต่ยังแตะเลือกตำบลได้ (คงเส้นของตำบลที่เลือกไว้)
      if (!showTambon) return { color: '#0F172A', weight: sel ? 2.5 : 0, opacity: sel ? 1 : 0, fillOpacity: 0 };
      return { color: sel ? '#0F172A' : sb ? '#0E7C7B' : '#475569', weight: sel ? 3 : sb ? 2.2 : 0.8, opacity: 1,
        dashArray: sb && !sel ? '5 3' : null, fillColor: colorFor(f.properties.tcode),
        fillOpacity: (showHex || mode === 'none') ? 0 : 0.6 };
    },
    onEachFeature: (f, l) => {
      l.bindTooltip(f.properties.name, { permanent: true, direction: 'center', className: 'tlabel' });
      l.on('click', () => select(f.properties.tcode));
    }
  }).addTo(map);
  const amLayer = amphoe ? L.geoJSON(amphoe, { interactive: false, style: { color: '#0A1628', weight: 2.2, fill: false } }).addTo(map) : null;
  function setTambonVisible(on) {
    showTambon = on;
    if (amLayer) { if (on && !map.hasLayer(amLayer)) amLayer.addTo(map); if (!on && map.hasLayer(amLayer)) map.removeLayer(amLayer); }
    $('legend').style.display = on ? '' : 'none';
    $('modes').style.display = on ? '' : 'none';
    redraw();
  }
  map.fitBounds(tLayer.getBounds(), { padding: [10, 10] });

  function redraw() {
    if (hexLayer) {
      const show = mode === 'risk' || mode === 's';
      if (show && !map.hasLayer(hexLayer)) { hexLayer.addTo(map); tLayer.bringToFront(); }
      if (!show && map.hasLayer(hexLayer)) map.removeLayer(hexLayer);
      if (show) hexLayer.setStyle(hexLayer.options.style);
    }
    tLayer.setStyle(tLayer.options.style);
    renderLegend();
  }

  /* ---------- ปุ่มโหมดและ legend ---------- */
  function renderModes() {
    $('modes').innerHTML = '';
    modes.forEach(m => {
      if (m.need && !m.need()) return;
      const b = document.createElement('button');
      b.textContent = m.label; b.className = m.id === mode ? 'on' : '';
      b.setAttribute('aria-pressed', m.id === mode);
      b.onclick = () => { mode = m.id; renderModes(); redraw(); };
      $('modes').appendChild(b);
    });
  }
  function renderLegend() {
    const row = (c, t) => `<div class="row"><span class="sw" style="background:${c}"></span>${t}</div>`;
    let h = '';
    if (mode === 'none') { $('legend').style.display = 'none'; return; }
    $('legend').style.display = showTambon ? '' : 'none';
    if (mode === 'risk') h = '<b>ระดับความเสี่ยง</b>' + cfg.levels.map(l => row(LEVEL_COLOR[l.rank], `${l.label} · ${l.desc}`)).join('');
    else if (mode === 't') h = '<b>สภาวะกระตุ้น (T)</b>' + cfg.t_states.map((s, i) => row(LEVEL_COLOR[i], s)).join('')
;
    else if (mode === 's') h = '<b>ความอ่อนไหว (S) เชิงสัมพัทธ์</b>' + cfg.s_classes.map((s, i) => row(S_COLOR[i], s)).join('');
    else {
      const sc = mode === 'r24' ? RAIN24 : RAIN7;
      h = `<b>${mode === 'r24' ? 'ฝนสูงสุดระหว่าง 24 ชม. ที่ผ่านมา/ข้างหน้า (มม.)' : 'ฝนสะสม 7 วัน (มม.)'}</b>`
        + sc.colors.map((c, i) => row(c, sc.labels[i])).join('')
        + (mode === 'r7' ? '<div class="muted">ช่วงสีเพื่อการแสดงผล ไม่ใช่เกณฑ์ตัดสินใจ</div>' : '<div class="muted">เกณฑ์ กรมอุตุนิยมวิทยา</div>');
    }
    h += row(NA_COLOR, 'ไม่มีข้อมูล');
    $('legend').innerHTML = h;
  }

  /* ---------- การ์ดตำบล ---------- */
  function select(code) {
    selected = code; redraw();
    const o = T[code], p = o.p;
    const lvl = o.rank !== null
      ? `<span class="lvl lvl-${o.rank}">ระดับ${cfg.levels[o.rank].label} · ${cfg.levels[o.rank].desc}</span>`
      : `<span class="lvl lvl-na">${hasS ? 'ข้อมูลไม่พอคำนวณระดับ' : 'แสดงสภาวะกระตุ้น (T)'}</span>`;
    const st = o.st ? `${fmt(o.st.storage_pct, 0)}% ความจุ (${o.st.code})` : (p.station_code ? 'ไม่มีข้อมูลสถานี' : 'ยังไม่กำหนดสถานีตัวแทน');
    $('query').innerHTML = `
      <div class="q-name">ต.${p.name}</div>
      <div class="q-amp">อ.${p.amphoe} · ${fmt(p.area_km2, 1)} ตร.กม. · <span class="mono">${p.tcode}</span></div>
      ${lvl}
      <dl class="kv">
        <dt>S (คงที่)</dt><dd>${o.s ? cfg.s_classes[o.s - 1] : '—'}</dd>
        <dt>T (ตอนนี้)</dt><dd>${o.t !== null ? cfg.t_states[o.t] : '—'}</dd>
        ${p.bldg != null ? `<dt>อาคาร (Open Buildings)</dt><dd class="mono">${Number(p.bldg).toLocaleString('th-TH')} หลัง</dd>` : ''}
        <dt>ฝน 24 ชม. ที่ผ่านมา</dt><dd class="mono">${fmt(o.r && o.r.rain_24h_mm)} มม.</dd>
        <dt>คาดการณ์ 24 ชม.</dt><dd class="mono">${fmt(o.r && o.r.rain_next24h_mm)} มม.</dd>
        <dt>ฝนสะสม 7 วัน</dt><dd class="mono">${fmt(o.r && o.r.rain_7d_mm)} มม.</dd>
        <dt>ระดับน้ำสถานีตัวแทน</dt><dd class="mono">${st}</dd>
      </dl>
      ${code === cfg.sandbox.tcode ? `<a class="btn" href="${cfg.sandbox.url}">เปิด ${cfg.sandbox.label} →</a>` : ''}`;
    history.replaceState(null, '', '#t=' + code);
  }

  /* ---------- รายการจับตาและ KPI ---------- */
  function renderWatch() {
    const key = o => [o.rank ?? -1, o.t ?? -1, o.r ? Math.max(o.r.rain_24h_mm, o.r.rain_next24h_mm) : -1];
    const list = Object.values(T).sort((a, b) => {
      const ka = key(a), kb = key(b);
      for (let i = 0; i < 3; i++) if (kb[i] !== ka[i]) return kb[i] - ka[i];
      return 0;
    }).slice(0, 8);
    $('watch').innerHTML = list.map(o => {
      const v = hasS ? o.rank : o.t, c = v === null || v === undefined ? NA_COLOR : LEVEL_COLOR[v];
      const rr = o.r ? Math.max(o.r.rain_24h_mm, o.r.rain_next24h_mm) : null;
      return `<div class="wrow" data-t="${o.p.tcode}"><span><span class="dot" style="background:${c}"></span>ต.${o.p.name}
        <span class="muted">อ.${o.p.amphoe}</span></span><span class="mono">${fmt(rr)} มม.</span></div>`;
    }).join('');
    document.querySelectorAll('.wrow').forEach(el => el.onclick = () => {
      select(el.dataset.t);
      const lyr = tLayer.getLayers().find(l => l.feature.properties.tcode === el.dataset.t);
      if (lyr) map.fitBounds(lyr.getBounds(), { maxZoom: 12 });
    });
  }
  function renderKpi() {
    // KPI สถานี/น้ำท่วมเป็นหน้าที่ของ layers.js — ที่นี่เติมเฉพาะฝนคาดการณ์จากแบบจำลอง
    const rs = Object.values(T).filter(o => o.r);
    $('k-fcst').textContent = rs.length ? fmt(Math.max(...rs.map(o => o.r.rain_next24h_mm))) + ' มม.' : '—';
  }

  /* ---------- สถานะข้อมูล 4 แบบ: ยังไม่เชื่อมต่อ / ดึงไม่สำเร็จ / ข้อมูลเก่า / ปกติ ---------- */
  function statusLine(name, obj, via) {
    const ok = '<span style="color:var(--green)">●</span>', warn = '<span style="color:var(--amber)">●</span>', err = '<span style="color:var(--red)">●</span>';
    if (!obj || obj.status === 'not_configured') return `<div class="srow">${warn} ${name}: ยังไม่เชื่อมต่อ</div>`;
    const age = ageMin(obj.updated_at), t = obj.updated_at ? new Date(obj.updated_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—';
    if (obj.status === 'error') return `<div class="srow">${err} ${name}: ดึงไม่สำเร็จ (แสดงข้อมูลเดิม ${t})<span class="s-note">${obj.message || ''}</span></div>`;
    if (age > cfg.stale_after_min) return `<div class="srow">${warn} ${name}: ข้อมูลเก่า ${Math.round(age / 60)} ชม.</div>`;
    return `<div class="srow">${ok} ${name}: ปกติ · ${t}${via ? `<span class="s-note">${via}</span>` : ''}</div>`;
  }
  function renderStatus() {
    const viaTxt = rainVia === 'browser' ? 'ดึงตรงจากเบราว์เซอร์ (Actions ยังไม่มีข้อมูลล่าสุด)' : 'จาก GitHub Actions';
    $('status').innerHTML =
      statusLine('ฝน (Open-Meteo)', rain, viaTxt) +
      statusLine('ระดับน้ำ (ThaiWater)', water) +
      (hasS ? '<div class="srow"><span style="color:var(--green)">●</span> ชั้น S จาก GEE: พร้อมใช้</div>' : '') +
      (hasS && !cfg.matrix_verified ? '<div class="srow"><span style="color:var(--amber)">●</span> Risk matrix: ยังไม่ calibrate</div>' : '') +
      (!cfg.water.verified ? '<div class="srow"><span style="color:var(--amber)">●</span> เกณฑ์ระดับน้ำ: ยังไม่ยืนยันกับหน่วยงาน</div>' : '');

    const liveOk = rain && rain.status === 'ok' && ageMin(rain.updated_at) <= cfg.stale_after_min;
    const b = $('badge');
    if (!liveOk) { b.className = 'badge badge-err'; b.textContent = 'ไม่มีข้อมูลฝนล่าสุด'; }
    else { b.className = 'badge badge-ok'; b.textContent = 'ข้อมูลสด'; }
    $('updated').textContent = rain && rain.updated_at ? 'อัปเดต ' + new Date(rain.updated_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '—';
  }
  function renderMethod() {
    const hdr = cfg.t_states.map(s => `<th>${s}</th>`).join('');
    const rows = cfg.matrix.map((r, i) => `<tr><th>${cfg.s_classes[i]}</th>${r.map(v => `<td style="background:${LEVEL_COLOR[v]}33">${cfg.levels[v].label}</td>`).join('')}</tr>`).reverse().join('');
    $('method').innerHTML = `<table><tr><th>S \\ T</th>${hdr}</tr>${rows}</table>
      <p><b>T จากฝน:</b> ใช้ค่าที่มากกว่าระหว่างฝน 24 ชม. ที่ผ่านมาและคาดการณ์ 24 ชม. ข้างหน้า เทียบ${cfg.rain.tmd_ref}
      ${cfg.rain.wet_7d_mm === null ? 'เงื่อนไขดินอิ่มน้ำจากฝนสะสม 7 วันยังไม่เปิดใช้' : `ฝนสะสม 7 วัน ≥ ${cfg.rain.wet_7d_mm} มม. เพิ่ม T หนึ่งขั้น`}</p>
      <p><b>T จากระดับน้ำ:</b> ร้อยละความจุลำน้ำ (ThaiWater) หาร 100 ≥ ${cfg.water.ratio.watch} / ${cfg.water.ratio.warn} / ${cfg.water.ratio.crit} (${cfg.water.note})</p>
      <p><b>S:</b> ความอ่อนไหวเชิงสัมพัทธ์ภายในพื้นที่ศึกษา จากความถี่น้ำท่วมซ้ำ (GISTDA) ค่า HAND และระยะห่างจากทางน้ำ (MERIT Hydro) ต่อ hexagon H3 res 8</p>
      <p>${cfg.matrix_verified ? '' : 'ค่าในเมทริกซ์เป็นข้อเสนอเบื้องต้น รอการ calibrate กับเหตุการณ์ปี 2564'}</p>`;
  }

  renderModes(); redraw(); renderWatch(); renderKpi(); renderStatus(); renderMethod();
  window.SDSS = { map, cfg, tambon, amphoe, hex, select, setTambonVisible };
  document.dispatchEvent(new CustomEvent('sdss:ready'));
  const m = location.hash.match(/t=(\d{6})/);
  if (m && T[m[1]]) select(m[1]);
})();
