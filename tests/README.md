# การทดสอบ

## Worker LINE (KV)
`node --no-warnings tests/worker_kv.test.mjs` — ลงทะเบียน ADM ด้วยรหัสเชิญ · ขอความช่วยเหลือแจ้ง ADM · กลุ่ม LINE · /api/reports ไม่มีข้อมูลส่วนบุคคล · /stats ต้องใช้ key

## หน้าเว็บ (smoke test ด้วย jsdom)
ติดตั้ง: `npm i -D jsdom leaflet`
แนวทาง: โหลด `region/index.html` ตัด `<script src>` ออก → `window.eval` leaflet → `window.eval` `region/liff/config.js`, `js/layers.js`, `js/region.js`
→ mock `window.fetch` ให้คืนไฟล์จาก `region/` (และ `region/data/live/` จาก repo) → ตั้ง `HTMLElement.prototype.clientWidth/Height` ให้ไม่เป็น 0
→ รอ ~2.5 วินาที แล้วตรวจ DOM เช่น `.lrow[data-id=...] .lsub`, `#now .wrow`, `#query` (การ์ดตำบลหลัง `window.SDSS.select('301010')`)
หมายเหตุ: jsdom ไม่มี canvas — stub `HTMLCanvasElement.prototype.getContext`

## รายงานสถานการณ์สำหรับ LINE
`node --no-warnings tests/report.test.mjs` — `situationReport` ใน `region/js/report.js` ต้องตรงกับ `line/kv/worker.js` ทุกตัวอักษร · สร้างข้อความจาก `region/data/live` ได้ ไม่มี undefined/NaN · คำสั่ง "สถานการณ์น้ำ" ใน worker ได้ข้อความเดียวกับเว็บ

## Worker gistda-tile-proxy
`node --no-warnings tests/gistda_tile_proxy.test.mjs` — 200 MISS→HIT (cache) · ส่ง key ใน header ไม่หลุดใน response · SWAP_XY · 204 นอก bbox · 400 zoom นอก 8–17 · 404 path ผิด · 500 not_configured · 405 · upstream error → 502 ไม่ส่งข้อความต่อ
