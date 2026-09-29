// ส่วนกลางของหน้า LIFF: เริ่ม LIFF, เรียก API ด้วย ID token, ข้อความ
window.LIFFX = {
  async init() {
    const C = window.LINE_CFG;
    await liff.init({ liffId: C.LIFF_ID });
    if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return false; }
    return true;
  },
  async post(path, body) {
    const r = await fetch(window.LINE_CFG.API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ idToken: liff.getIDToken() }, body || {})) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'เกิดข้อผิดพลาด');
    return j;
  },
  CATS: { flood: 'น้ำท่วม', road: 'ถนนผ่านไม่ได้', power: 'ไฟดับ', landslide: 'ดินสไลด์', tree: 'ต้นไม้ล้ม', building: 'อาคารเสียหาย', other: 'อื่น ๆ' },
  DEPTH: { ankle: 'ตาตุ่ม (~10 ซม.)', knee: 'เข่า (~50 ซม.)', waist: 'เอว (~1 ม.)', chest: 'อก (~1.3 ม.)', over: 'ท่วมมิดหัว' },
  KIND: { evac: 'อพยพ/ติดค้าง', patient: 'ผู้ป่วย/ผู้ติดเตียง', food: 'อาหาร/น้ำดื่ม', medicine: 'ยา', other: 'อื่น ๆ' },
  esc: (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
};
