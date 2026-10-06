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

## หน้า ChanAT Sandbox สาธารณะ (`chanat/index.html` → https://sarochiiii.github.io/NR-flood-sdss/chanat/)
- **ไม่มีข้อมูลครัวเรือน** — ใช้อาคาร Open Buildings (`region/data/bldg/*.json`) · ลำน้ำ/แหล่งน้ำ OSM · ขอบเขตตำบล · อาคารชลศาสตร์ · ข้อมูลสดชุดเดียวกับหน้า region
- ศูนย์กลาง = กลุ่มอาคารหนาแน่นที่สุดใกล้ "อาคารบังคับน้ำบ้านด่านติง" (structures seq 34 · 102.12961, 15.13600) → **15.14223, 102.13359** (578 หลังในรัศมี 600 ม. · ห่างประตูน้ำ 0.8 กม.) — ยังไม่ยืนยันขอบเขตหมู่บ้านกับ อบต.
- แผง SDSS: ขอบเขต (รัศมี 1.5 กม. / ทั้งตำบล) · ระยะจากลำน้ำสายหลัก (± คลอง) 50–1000 ม. · น้ำท่วมซ้ำซาก ≥ N ครั้ง → จัดอาคาร 4 กลุ่ม (ทั้งสอง / ซ้ำซาก / ใกล้ลำน้ำ / นอกเกณฑ์) · ส่งออก CSV (พิกัดจุดกึ่งกลางอาคาร ไม่ใช่ครัวเรือน)
- น้ำท่วมซ้ำซาก: `scripts/region/build_sandbox_floodfreq.py` ผ่าน workflow **`sandbox-layers`** (กดรันเอง) อ่าน EE asset `Repeatarea` ด้วย service account → `region/data/sandbox/floodfreq.geojson` · ถ้า error "permission" ให้แชร์ asset ให้อีเมล service account
- ภาพน้ำท่วมซ้ำซากจาก GISTDA API (ทางเลือก): Worker `workers/gistda-tile-proxy.js` ซ่อน key · ตั้ง `GISTDA_TILE_WORKER` ใน `chanat/index.html` → แสดง tile (z8–17, opacity 0.7) **แต่การวิเคราะห์อาคาร/ตัวกรอง/CSV ยังใช้ vector Repeatarea (GEE)** · tile โหลดไม่ได้ ≥ 4 ครั้งโดยไม่มีสำเร็จ → กลับไปแสดง vector + ข้อความใน `freq-warn`
  - `UPSTREAM` = `https://api-gateway.gistda.or.th/api/2.0/resources/maps/flood-freq/tms/{z}/{x}/{y}` (จากหน้าเอกสาร GISTDA · ลำดับ {z}/{x}/{y} ยังไม่ยืนยัน) · path เป็น **tms** → ถ้าภาพกลับหัวหรือว่าง ลอง `TMS_Y=true` (y = 2^z−1−y) ก่อน `SWAP_XY`
  - **deploy แล้ว 6 ต.ค.**: https://gistda-tile-proxy.sarochinee-k.workers.dev · `/floodfreq/14/12840/7494.png` ได้ภาพข้อมูลไทยและแนวลำน้ำสอดคล้องกับ Repeatarea → ลำดับ {z}/{x}/{y} ใช้ได้ · tile มีพื้นเทาทึบนอกพื้นที่ท่วม → หน้าเว็บใช้ `mix-blend-mode: multiply`
  - ยังไม่ยืนยัน: URL `UPSTREAM` · ลำดับ x/y (เอกสาร GISTDA เรียก x=row, y=column → ทดสอบ z14 x12840 y7494 = บ้านด่านติง ถ้าภาพผิดตำแหน่งตั้ง `SWAP_XY=true`) · ตาราง legend สี→จำนวนครั้ง · เงื่อนไขการเผยแพร่ tile สาธารณะของ GISTDA
- อาคาร Open Buildings มีเฉพาะ 26 ตำบล — บ้านที่อยู่นอกสองอำเภอจะไม่มีรูปอาคาร

## ชั้นภัย S1 (ยังไม่ได้รัน)
`gee/sandbox_layers.js` → `import_sandbox_layers.py` → `region/data/sandbox/` (ขอบเขต · ลำเชียงไกร · น้ำท่วมซ้ำซาก · แหล่งน้ำ · ฝน CHIRPS รายเดือน · NDVI รายเดือน) — สาธารณะ ไม่มีครัวเรือน

## field ของ H-E-V-C (attributes.csv)
`moo, members, elderly, children, bedridden, disabled, poor, two_storey, vehicle, water_tank, well, irrigation, farm_rai, past_depth_cm` · น้ำหนักเริ่มต้นเท่ากัน "ยังไม่กำหนดร่วมกับชุมชน" (เสนอ AHP กับ ADM)
