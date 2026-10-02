# Sandbox บ้านด่านติง (ต.จันอัด) — จำกัดสิทธิ์

## ตัดสินใจแล้ว
- ไม่มีโครงการบินโดรน → **ไม่ทำ digital twin** · พัฒนาเป็น **SDSS แผนที่ความเสี่ยงออนไลน์** น้ำท่วม+ภัยแล้ง (จัดลำดับครัวเรือนตาม H-E-V-C)
- ระยะปัจจุบัน: **แสดงตำแหน่งบ้านเท่านั้น** (ครัวเรือนที่สำรวจใน PPPConnext ซึ่งอยู่ฐานข้อมูลแยก ไม่เชื่อมกัน)
- ล็อกด้วย **Cloudflare Pages (Direct Upload) + Cloudflare Access** One-time PIN อีเมล ≤ 5 คน · Access 2 application (URL หลัก + `*.project.pages.dev`) · ทดสอบในหน้าต่างไม่ระบุตัวตนทุก URL รวม `households.geojson`

## ไฟล์ชุด `sandbox-private` (ห้ามขึ้น GitHub)
| ไฟล์ | เนื้อหา |
|---|---|
| `index.html` | แผนที่ตำแหน่งครัวเรือน 97 หลัง (`DT-001…`) ภาพดาวเทียม · ค้นหารหัส · นำทาง Google Maps · KPI อ่าง/M.188A · ระยะจากลำน้ำเมื่อมีชั้น GEE |
| `households.geojson` | จาก `100_House_dbf.csv` (KML→UTM 47N→WGS84) 97 จุด (3 หลังไม่มีพิกัด) · ไม่มีรหัสประจำบ้าน |
| `sdss.html` + `attributes.csv` | SDSS ระยะถัดไป: แท็บน้ำท่วม/ภัยแล้ง · คะแนน H-E-V-C ใน browser · ปรับน้ำหนัก · Weighted sum/TOPSIS · รายชื่อจัดลำดับ · CSV ภาคสนาม · ค่ารวมรายหมู่ (ซ่อนช่อง <3) |
| `README-SETUP.md` | ตั้ง Cloudflare Access + export จาก QGIS |
ไฟล์แยก **`KEEP_OFFLINE_house_key.zip`** (hh_id ↔ รหัสประจำบ้าน) เก็บออฟไลน์เท่านั้น

## ข้อค้นพบจากข้อมูล
- ขอบเขตตำบลทางการ: 79 หลังอยู่ใน ต.จันอัด · **18 หลังอยู่นอกขอบเขต 32–234 ม.** (นอกสองอำเภอ) → ยืนยันกับ อบต. ว่าหมู่บ้านคร่อมแนวเขตหรือเส้นเขตคลาดเคลื่อน
- รหัสประจำบ้านมีทั้ง 10 และ 11 หลัก (เลข 0 นำหน้าอาจหาย) · ซ้ำ 1 คู่

## ชั้นภัย S1 (ยังไม่ได้รัน)
`gee/sandbox_layers.js` → `import_sandbox_layers.py` → `region/data/sandbox/` (ขอบเขต · ลำเชียงไกร · น้ำท่วมซ้ำซาก · แหล่งน้ำ · ฝน CHIRPS รายเดือน · NDVI รายเดือน) — สาธารณะ ไม่มีครัวเรือน

## field ของ H-E-V-C (attributes.csv)
`moo, members, elderly, children, bedridden, disabled, poor, two_storey, vehicle, water_tank, well, irrigation, farm_rai, past_depth_cm` · น้ำหนักเริ่มต้นเท่ากัน "ยังไม่กำหนดร่วมกับชุมชน" (เสนอ AHP กับ ADM)
