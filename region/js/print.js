// พิมพ์แผนที่ + รายงาน 1 หน้า A4 (แนวตั้ง) — ใช้คำสั่งพิมพ์ของเบราว์เซอร์ เลือก "บันทึกเป็น PDF" ได้ · ไม่มีค่าใช้จ่าย ไม่ใช้บริการภายนอก
// ใช้ใน region/index.html (รายงานสถานการณ์น้ำ) และ chanat/index.html (รายงานบ้านด่านติง) ผ่าน window.SDSS_PRINT.open({...})
// วิธีทำงาน: ย้ายกล่องแผนที่ Leaflet ตัวจริงเข้าไปในแผ่น A4 ตัวอย่าง (ชั้นข้อมูล/มุมมองเดิม เลื่อน/ซูมต่อได้) → window.print() → ปิดแล้วย้ายกลับ
(function () {
  const CSS = `
#print-ov{position:fixed;inset:0;z-index:5000;background:#475569;overflow:auto;font-family:'IBM Plex Sans Thai',system-ui,sans-serif}
#print-ov .pv-bar{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 12px;background:#0A1628;color:#fff;font-size:13px}
#print-ov .pv-bar span{opacity:.8;font-size:12px;flex:1;min-width:180px}
#print-ov .pv-bar button{font:inherit;font-size:13.5px;border:0;border-radius:8px;padding:7px 14px;cursor:pointer}
#print-ov .pv-print{background:#0D9488;color:#fff;font-weight:600}
#print-ov .pv-close{background:#E2E8F0;color:#0F172A}
#print-ov .sheet{box-sizing:border-box;width:210mm;height:297mm;margin:12px auto;padding:8mm;background:#fff;color:#0F172A;box-shadow:0 4px 18px rgba(0,0,0,.35);
  display:flex;flex-direction:column;gap:2.2mm;overflow:hidden}
#print-ov .ph{display:flex;justify-content:space-between;gap:4mm;align-items:flex-end;border-bottom:.6mm solid #0E7C7B;padding-bottom:1.5mm}
#print-ov .ph b{font-size:13.5pt;line-height:1.2}#print-ov .ph small{display:block;font-size:8pt;color:#475569}
#print-ov .ph .r{text-align:right;font-size:7.5pt;color:#475569;white-space:nowrap}
#print-ov .pmap{position:relative;flex:0 0 128mm;border:.3mm solid #94A3B8;overflow:hidden}
#print-ov .pmap #map{position:absolute!important;inset:0!important;width:100%!important;height:100%!important}
#print-ov .pmap .north{position:absolute;top:2mm;right:2mm;z-index:800;background:rgba(255,255,255,.9);border-radius:1mm;padding:.6mm 1.6mm;font:700 8pt/1.05 sans-serif;text-align:center;pointer-events:none}
#print-ov .pmap .leaflet-control-zoom,#print-ov .pmap .leaflet-control-layers{display:none}
#print-ov .pmap .leaflet-control-attribution{font-size:6pt;line-height:1.25;max-width:62%}
#print-ov .plegend{display:flex;flex-wrap:wrap;gap:1mm 4mm;font-size:6.8pt;max-height:30mm;overflow:hidden}
#print-ov .plegend .muted,#print-ov .plegend button{display:none!important}
#print-ov .plegend>*{position:static!important;inset:auto!important;max-width:none!important;max-height:none!important;overflow:visible!important;box-shadow:none!important;
  background:none!important;border:0!important;padding:0!important;margin:0!important;font-size:6.8pt!important;display:block!important}
#print-ov .plegend .legend{columns:5;column-gap:4mm;width:100%}#print-ov .plegend .legend b{display:block;break-after:avoid}
#print-ov .plegend .row{margin:.2mm 0!important;break-inside:avoid}
#print-ov .plegend .bank-legend{display:flex!important;flex-wrap:wrap;gap:1mm 3mm}
#print-ov .ptext{flex:1;margin:0;white-space:pre-wrap;word-break:break-word;font:8.4pt/1.38 'IBM Plex Sans Thai',system-ui,sans-serif;columns:2;column-gap:6mm;column-fill:auto;overflow:hidden}
#print-ov .pf{border-top:.3mm solid #CBD5E1;padding-top:1mm;font-size:6.8pt;color:#475569;display:flex;justify-content:space-between;gap:4mm}
@media print{
  @page{size:A4 portrait;margin:0}
  html,body{background:#fff!important;height:auto!important;overflow:visible!important}
  body.sdss-printing>*:not(#print-ov){display:none!important}
  #print-ov{position:static;background:none;overflow:visible}
  #print-ov .pv-bar{display:none}
  #print-ov .sheet{margin:0;box-shadow:none;break-after:avoid;page-break-after:avoid}
  #print-ov *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}`;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const now = () => new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' }) + ' น.';

  // o = { map, title, subtitle, report: string | Promise<string>, legends: [Element], site }
  async function open(o) {
    if (document.getElementById('print-ov') || !o || !o.map) return;
    if (!document.getElementById('print-css')) { const st = document.createElement('style'); st.id = 'print-css'; st.textContent = CSS; document.head.appendChild(st); }
    const map = o.map, el = map.getContainer(), view = { c: map.getCenter(), z: map.getZoom() };
    const ov = document.createElement('div');
    ov.id = 'print-ov';
    ov.innerHTML = `<div class="pv-bar"><b>ตัวอย่างก่อนพิมพ์ · A4 แนวตั้ง</b>
        <span>เลื่อน/ซูมแผนที่ในกรอบได้ · ปุ่มพิมพ์แล้วเลือกเครื่องพิมพ์ หรือ "บันทึกเป็น PDF" (Save as PDF)</span>
        <button type="button" class="pv-print">🖨 พิมพ์ / บันทึก PDF</button><button type="button" class="pv-close">ปิด</button></div>
      <div class="sheet">
        <div class="ph"><div><b>${esc(o.title)}</b><small>${esc(o.subtitle || '')}</small></div>
          <div class="r">พิมพ์เมื่อ ${esc(now())}<br>ไม่ใช่ประกาศเตือนภัยทางการ</div></div>
        <div class="pmap"><div class="north">N<br>▲</div></div>
        <div class="plegend"></div>
        <pre class="ptext">กำลังสร้างรายงาน…</pre>
        <div class="pf"><span>${esc(o.site || location.href.split('#')[0])}</span><span>โครงการวิจัย มรภ.นครราชสีมา · ข้อมูลจากหน่วยงานตามที่ระบุในรายงาน</span></div>
      </div>`;
    document.body.appendChild(ov);
    document.body.classList.add('sdss-printing');

    // ย้ายแผนที่ตัวจริงเข้าแผ่น A4 (จุดเดิมเก็บด้วย comment) + มาตราส่วน
    const ph = document.createComment('map-placeholder');
    el.parentNode.insertBefore(ph, el);
    ov.querySelector('.pmap').prepend(el);
    const scale = el.querySelector('.leaflet-control-scale') ? null : L.control.scale({ imperial: false, position: 'bottomleft', maxWidth: 140 }).addTo(map);
    map.invalidateSize(); map.setView(view.c, view.z, { animate: false });

    // คำอธิบายสัญลักษณ์: คัดลอกจาก legend ที่เปิดอยู่บนแผนที่ (ไม่รวมที่ซ่อนอยู่)
    const lg = ov.querySelector('.plegend');
    (o.legends || []).filter((x) => x && x.offsetParent !== null && x.textContent.trim()).forEach((x) => {
      const c = x.cloneNode(true); c.removeAttribute('id'); c.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id')); lg.appendChild(c); });
    if (!lg.children.length) lg.remove();

    // รายงาน: ย่อตัวอักษรจนพอดีพื้นที่ที่เหลือของหน้า
    const pt = ov.querySelector('.ptext');
    try { pt.textContent = await o.report; } catch (e) { pt.textContent = 'สร้างรายงานไม่สำเร็จ — ลองใหม่อีกครั้ง'; }
    const fit = () => { let fs = 8.4; pt.style.fontSize = fs + 'pt';
      while (pt.scrollHeight > pt.clientHeight + 1 && fs > 6) { fs -= 0.2; pt.style.fontSize = fs.toFixed(1) + 'pt'; }
      // หลายคอลัมน์: ข้อความล้นจะไปเกิดคอลัมน์ที่ 3 ด้านขวา (scrollWidth) แทนด้านล่าง
      while (pt.scrollWidth > pt.clientWidth + 1 && fs > 6) { fs -= 0.2; pt.style.fontSize = fs.toFixed(1) + 'pt'; } };
    fit();

    const close = () => {
      ph.parentNode.insertBefore(el, ph); ph.remove(); if (scale) scale.remove();
      ov.remove(); document.body.classList.remove('sdss-printing'); document.removeEventListener('keydown', onKey);
      map.invalidateSize(); map.setView(view.c, view.z, { animate: false });
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    ov.querySelector('.pv-close').onclick = close;
    ov.querySelector('.pv-print').onclick = () => { map.invalidateSize(); setTimeout(() => window.print(), 300); };
  }
  window.SDSS_PRINT = { open };
})();
