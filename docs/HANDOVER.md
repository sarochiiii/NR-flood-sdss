---
name: nr-flood-sdss-ops
description: คู่มือพัฒนาและดูแลระบบ "SDSS-ChanAT" (เดิม SDSS น้ำท่วม โนนไทย–โนนสูง) ของโครงการวิจัยย่อยที่ 2 มรภ.นครราชสีมา — เว็บ GitHub Pages (repo sarochiiii/NR-flood-sdss) + GitHub Actions ดึงข้อมูลสดทุกชั่วโมง, LINE OA "จันอัดบ้านฉัน" บน Cloudflare Worker, Sandbox บ้านด่านติงที่ล็อกด้วย Cloudflare Access. ใช้ skill นี้ทุกครั้งที่งานเกี่ยวกับเว็บ SDSS-ChanAT/region, หน้าลำเชียงไกร, workflow region-live, ThaiWater/กรมชลประทาน/GISTDA/GloFAS/Open-Meteo/RainViewer/HydroBASINS ในระบบนี้, อ่างลำเชียงไกร, M.188A, อาคารชลศาสตร์ลำเชียงไกร, LINE OA จันอัดบ้านฉัน (worker chanat-line-webhook, รหัสเชิญ ADM, กลุ่ม LINE, /stats, ตัวชี้วัด 100 ผู้ใช้), Sandbox ด่านติง (ครัวเรือน PPPConnext, H-E-V-C) หรือการส่งต่องานให้เจ้าหน้าที่ — แม้ผู้ใช้ไม่เอ่ยชื่อ repo เพราะมีข้อตกลงด้านข้อมูลส่วนบุคคล เกณฑ์ที่ยังไม่ยืนยัน และขั้นตอนอัปเดตเฉพาะของโครงการ
---

# SDSS-ChanAT · คู่มือพัฒนาและดูแลระบบ

สถานะ ณ 2 ต.ค. 2569 · ผู้รับผิดชอบ: Sarochinee Kaewthanee (หลักสูตรภูมิศาสตร์และภูมิสารสนเทศ มรภ.นม.) · GitHub `sarochiiii`

ระบบสนับสนุนการตัดสินใจเชิงพื้นที่ (SDSS) ด้านน้ำท่วม/ภัยแล้ง สำหรับ ADM และ อบต. ตำบลจันอัด (ขยายได้ 26 ตำบล อ.โนนไทย–โนนสูง)
**ไม่ใช่ระบบประกาศเตือนภัยทางการ** (อำนาจของ ปภ. ตาม พ.ร.บ.ป้องกันและบรรเทาสาธารณภัย พ.ศ. 2550)

## องค์ประกอบ 3 ส่วน

| ส่วน | ที่อยู่ | สถานะ |
|---|---|---|
| **เว็บสาธารณะ SDSS-ChanAT** | https://sarochiiii.github.io/NR-flood-sdss/region/ · หน้าลำเชียงไกร `…/region/lamchiangkrai.html` | ใช้งาน · `?v=37` |
| **LINE OA "จันอัดบ้านฉัน"** | Cloudflare Worker `chanat-line-webhook` (KV `LINE_USERS`) · โค้ด `line/kv/worker.js` (v4.4) | ใช้งาน · แพ็กเกจ Free |
| **Sandbox บ้านด่านติง (จำกัดสิทธิ์)** | Cloudflare Pages + Cloudflare Access (≤ 5 อีเมล) · ไฟล์ชุด `sandbox-private` **ไม่อยู่ใน GitHub** | เตรียมไฟล์แล้ว · แสดงตำแหน่งบ้าน 97 หลัง |

รายละเอียด: เว็บ → `references/architecture.md` · LINE OA → `references/line-oa.md` · Sandbox → `references/sandbox.md`
แหล่งข้อมูล → `references/data-sources.md` · เกณฑ์/ตรรกะ → `references/config-logic.md` · ขั้นตอนดูแล → `references/operations.md`
ข้อมูลส่วนบุคคล/สิทธิ์ข้อมูล → `references/governance.md` · งานค้าง → `references/backlog.md` · ประวัติรุ่น → `references/changelog.md`

## หลักการที่ห้ามละเมิด

1. **ไม่มีข้อมูลรายบุคคล/รายครัวเรือนใน repo สาธารณะ** (PPPConnext, พิกัดบ้าน Sandbox, รหัสประจำบ้าน, เบอร์โทร, LINE userId) — repo และเว็บดาวน์โหลดได้ทั้งหมด การซ่อนใน UI ไม่ช่วย
2. **ไม่ commit/ไม่ส่ง secret ทางแชทหรือภาพหน้าจอ** — LINE secret/token, STATS_KEY, GISTDA key, service account JSON อยู่ใน Secrets เท่านั้น (key หลุดแล้ว = เปลี่ยนใหม่)
3. **ทุกหน้า/ข้อความ LINE มี disclaimer** ว่าไม่ใช่ประกาศทางการ และแสดงเวลาที่ข้อมูลถูกวัด
4. **เกณฑ์ที่ยังไม่ยืนยันต้องติดป้าย** (`verified: false`) จนกว่าชลประทาน/ปภ. รับรอง
5. **ไม่เดา** ชื่อ field ของ API, ลำดับสถานี, ความสัมพันธ์ต้นน้ำ–ท้ายน้ำ — ตรวจกับข้อมูลจริงก่อน (เคยผิดเรื่องจุดบรรจบลำเชียงไกร ดู changelog)
6. **ADM ต้องลงทะเบียนด้วยรหัสเชิญ** — ห้ามเปิดช่องให้ใครก็ได้รับรายงานเหตุ/คำขอความช่วยเหลือ

## เมื่อ Claude ใช้ skill นี้ช่วยงาน

- **clone repo ล่าสุดก่อนแก้เสมอ** (`git clone --depth 1 https://github.com/sarochiiii/NR-flood-sdss.git`) แล้ว diff กับสำเนาในเครื่อง — มีการแก้จากช่องทางอื่น (เช่นชื่อระบบ SDSS-ChanAT, ปิดชั้นลุ่มน้ำเป็นค่าเริ่มต้น) ถ้าไม่ตรวจจะเขียนทับ
- ส่งงานเป็น `update-N.zip` ที่มีเฉพาะไฟล์ที่เปลี่ยน ตาม path จริง ผู้ใช้อัปโหลดผ่านหน้าเว็บ GitHub (ไม่ใช้ git)
- แก้ JS/CSS ต้องเพิ่ม `?v=N` ใน `region/index.html` และ `region/lamchiangkrai.html` (ปัจจุบัน 31 → ครั้งถัดไป 32)
- ทดสอบก่อนส่ง: `node --check`, jsdom + leaflet (mock fetch), Worker ด้วย mock KV/D1 (`node:sqlite`), TypeScript `--checkJs` สำหรับโค้ดที่วางใน Cloudflare editor
- ตรรกะ T อยู่ 2 ที่: `region/js/region.js` (basinT) และ `scripts/region/compute_risk.py` (basin_t) — แก้คู่กันเสมอ
- ผู้ใช้หลักไม่ใช้ command line: อธิบายเป็นการคลิกทีละขั้น ภาษาไทย ศัพท์เทคนิคอังกฤษ
- ข้อมูลที่ผู้ใช้ส่งมาเป็นข้อมูลส่วนบุคคล (เช่นไฟล์ครัวเรือน): ตรวจเฉพาะโครงสร้าง ไม่พิมพ์ค่ารายบุคคล แยกไฟล์ key ที่ระบุตัวตนออกไปเก็บออฟไลน์
