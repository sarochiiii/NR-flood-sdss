---
name: nr-flood-sdss-ops
description: คู่มือส่งมอบและดูแลระบบ "SDSS น้ำท่วม อำเภอโนนไทย–โนนสูง" (repo sarochiiii/NR-flood-sdss บน GitHub Pages + Actions) ของโครงการวิจัยย่อยที่ 2 มรภ.นครราชสีมา — ครอบคลุมโครงสร้างไฟล์ แหล่งข้อมูลสด (ThaiWater, GISTDA, Open-Meteo, RainViewer, Earth Engine), เกณฑ์เตือน, ขั้นตอนอัปเดตเว็บ, การแก้ปัญหา และข้อห้ามด้านข้อมูลส่วนบุคคล. ใช้ skill นี้ทุกครั้งที่มีคนถามหรือทำงานเกี่ยวกับเว็บ sarochiiii.github.io/NR-flood-sdss, หน้าเฝ้าระวังลำเชียงไกร, workflow region-live, สถานี M.188A/M.206, ข้อมูลน้ำท่วม GISTDA, อ่างลำเชียงไกร, ชั้นอาคาร Open Buildings, Sentinel-1 ในระบบนี้ หรือการส่งต่อ/เพิ่มฟีเจอร์ (สถานี local, รายงานจาก ADM, LINE OA) — แม้ผู้ใช้จะไม่เอ่ยชื่อ repo ก็ตาม เพราะระบบมีข้อตกลงเรื่อง data contract, เกณฑ์ที่ยังไม่ยืนยัน และ secret ที่ต้องรักษา
---

# ระบบ SDSS น้ำท่วม อำเภอโนนไทย–โนนสูง · คู่มือส่งมอบ

สถานะ ณ 27 ก.ย. 2569 · ผู้รับผิดชอบหลัก: Sarochinee Kaewthanee (หลักสูตรภูมิศาสตร์และภูมิสารสนเทศ มรภ.นครราชสีมา) · บัญชี GitHub `sarochiiii`

ระบบสนับสนุนการตัดสินใจเชิงพื้นที่ (SDSS) สำหรับ ADM และ อบต. ในอำเภอโนนไทยและโนนสูง
แสดงสถานการณ์น้ำปัจจุบันจากหลายหน่วยงานบนแผนที่เดียว **ไม่ใช่ระบบประกาศเตือนภัยทางการ**
(อำนาจของ ปภ. ตาม พ.ร.บ.ป้องกันและบรรเทาสาธารณภัย พ.ศ. 2550)

## ที่อยู่ระบบ

| ส่วน | URL / ที่อยู่ |
|---|---|
| เว็บหลัก (ภาพรวม 2 อำเภอ 26 ตำบล) | https://sarochiiii.github.io/NR-flood-sdss/region/ |
| หน้าเฝ้าระวังลำเชียงไกร | …/region/lamchiangkrai.html |
| Sandbox จันอัด (**ต้นแบบหน้าจอ ข้อมูลสมมติ**) | …/chanat/ |
| Repo (สาธารณะ) | github.com/sarochiiii/NR-flood-sdss |
| GEE project | ee-sarochineek (Earth Engine default project) |

## สถาปัตยกรรมโดยย่อ

```
แหล่งข้อมูล ─┬─ เรียกตรงจาก browser (CORS เปิด): ThaiWater public, RainViewer, Open-Meteo (สำรอง)
             └─ GitHub Actions ทุกชั่วโมง นาทีที่ 15 (workflow region-live):
                Open-Meteo → ThaiWater public → ThaiWater จังหวัด → GISTDA → Earth Engine S1
                → บันทึกประวัติ → คำนวณ T → commit region/data/live/*
เว็บ (GitHub Pages, static) อ่าน config.json + data/*.json แล้ววาดด้วย Leaflet
```

รายละเอียดไฟล์ทั้งหมด → `references/architecture.md`
endpoint, field และข้อจำกัดของแต่ละแหล่ง → `references/data-sources.md`

## หลักการที่ห้ามละเมิด

1. **ห้ามนำข้อมูลรายครัวเรือนขึ้น repo นี้** (PPPConnext, พิกัดบ้าน 100 ครัวเรือน Sandbox, เบอร์โทร, LINE userId)
   repo และเว็บเป็นสาธารณะ ใครก็ดาวน์โหลดไฟล์ได้ การซ่อนใน UI ไม่ช่วย → ต้องเป็นระบบจำกัดสิทธิ์แยก
2. **ห้าม commit key** ทุกชนิด (GISTDA API key, ไฟล์ JSON ของ service account) ใช้ GitHub Secrets เท่านั้น
   Google ปิด service account key อัตโนมัติถ้าพบใน repo สาธารณะ · response ของ GISTDA มี key ติดใน `links[]` ห้ามบันทึก/ส่งต่อ
3. **ทุกหน้าที่เผยแพร่ต้องมี disclaimer** ว่าไม่ใช่ประกาศเตือนภัยทางการ และแสดงเวลาที่ข้อมูลถูกวัด
4. **เกณฑ์ที่ยังไม่ยืนยันต้องแสดงว่ายังไม่ยืนยัน** (`verified: false` ใน config.json) จนกว่าชลประทาน/ปภ. รับรอง
5. **ห้ามเดาข้อมูลที่ไม่มีหลักฐาน** เช่น ลำดับสถานีตามลำน้ำ ชื่อ field ของ API ใหม่ — ตรวจจากข้อมูลจริงก่อนเสมอ

รายละเอียด → `references/governance.md`

## งานประจำ (ผู้ดูแล)

| ความถี่ | งาน |
|---|---|
| ทุกวัน (ฤดูฝน) | เปิดเว็บดูแถบแจ้งเตือนและสถานะข้อมูล (แผงขวาล่าง) ว่าไม่มี "ดึงไม่สำเร็จ" / "ข้อมูลเก่า" |
| ทุกสัปดาห์ | GitHub → Actions → region-live ว่ารอบล่าสุดเป็น ✓ และดู log ขั้น GISTDA/Sentinel-1 |
| ทุกเดือน | ตรวจว่า scheduled workflow ไม่ถูกปิด (GitHub ปิดเองถ้า repo ไม่มีความเคลื่อนไหว ~60 วัน) |
| ทุกปี / เมื่อ key หลุด | หมุนเวียน GISTDA key และ service account key · ทบทวนขนาด repo |

ขั้นตอนอัปเดตโค้ด การรัน workflow การตรวจผล และตารางแก้ปัญหา → `references/operations.md`

## ตรรกะการเตือนและค่าที่ตั้งไว้

ทุกเกณฑ์อยู่ใน `region/config.json` ไฟล์เดียว (ใช้ร่วมกันทั้ง JavaScript และ Python)
- สภาวะกระตุ้น T จากฝน: max(ฝน 24 ชม. ที่ผ่านมา, คาดการณ์ 24 ชม.) เทียบเกณฑ์ TMD (35.1 / 90.1 มม.)
- สถานะเทียบตลิ่ง: storage_pct ของ ThaiWater → ปกติ <70 · ค่อนข้างสูง ≥70 · ใกล้ล้นตลิ่ง ≥90 · ล้นตลิ่ง ≥100 · ล้นและยังขึ้น
- เวลาคาดถึงตลิ่ง: อัตราขึ้นเฉลี่ย 6 ชม. ล่าสุด (ต้องมีประวัติ ≥2 ชม., ≥0.5 ซม./ชม., ≤72 ชม.)
รายละเอียดและสิ่งที่ยังไม่ยืนยัน → `references/config-logic.md`

## งานค้างและงานถัดไป

ดู `references/backlog.md` (สถานี local, รายงานจาก ADM, LINE OA รายวัน, แผนที่ 100 ครัวเรือนแบบจำกัดสิทธิ์,
Sandbox จริง, ชั้น S ที่พักไว้, หนังสือขอใช้ข้อมูล)

## เมื่อ Claude ใช้ skill นี้ช่วยงาน

- ถามก่อนเสมอว่าผู้ใช้กำลังทำงานส่วนใด และตรวจไฟล์จริงใน repo ก่อนแก้ (clone ได้จาก github.com ซึ่งเปิดใน sandbox)
- แก้ไขแบบ "update-N.zip" ที่มีเฉพาะไฟล์ที่เปลี่ยน ตาม path เดิม ให้ผู้ใช้อัปโหลดผ่านหน้าเว็บ GitHub
- เมื่อแก้ JS/CSS ต้องเพิ่มเลข `?v=N` ใน `region/index.html` และ `region/lamchiangkrai.html` เสมอ (ปัจจุบัน v=24)
- ทดสอบ JS ด้วย `node --check` และ jsdom + leaflet (mock fetch) ก่อนส่ง · ทดสอบ Python กับข้อมูลจริงถ้ามี
- ตรรกะ T และสถานะตลิ่งมีทั้งใน `js/region.js`/`js/layers.js` และ `scripts/region/compute_risk.py` แก้ที่หนึ่งต้องแก้อีกที่
- ผู้ใช้หลักทำงานผ่านหน้าเว็บ GitHub ไม่ใช้ git บน command line อธิบายขั้นตอนเป็นการคลิกทีละขั้น
