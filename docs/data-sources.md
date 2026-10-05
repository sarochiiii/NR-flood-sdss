# แหล่งข้อมูล endpoint และ field

ทุกโครงสร้างด้านล่างตรวจกับ response จริงแล้ว (26–27 ก.ย. 2569) เว้นแต่ระบุว่า "ยังไม่ยืนยัน"

## 1. ThaiWater public (สสน./HII) — browser เรียกตรงได้ (CORS เปิด)
- `https://api-v3.thaiwater.net/api/v1/thaiwater30/public/rain_24h` → `data[]`:
  `station.{tele_station_lat, tele_station_long, tele_station_name.th}`, `rain_24h`, `rain_1h`, `rainfall_datetime`, `geocode.amphoe_name.th`
- `.../public/waterlevel_load` → `waterlevel_data.data[]`:
  `station.{tele_station_oldcode, min_bank, tele_station_lat/long}`, `waterlevel_msl`, `storage_percent`, `discharge`, `waterlevel_datetime`
- **ไม่มีเอกสาร API ทางการ** โครงสร้างอ้างอิงจากโค้ดโอเพนซอร์สและข้อมูลจริง ควรทำหนังสือขอใช้ข้อมูลจาก สสน.
- `level_msl` และ `min_bank` เป็น ม.รทก. **ห้ามหารกัน** → ใช้ `storage_percent`
- endpoint กราฟย้อนหลังใช้ไม่ได้ ระบบจึงเก็บประวัติเองใน `history.json`

## 2. ThaiWater จังหวัด — CORS อนุญาตเฉพาะ nakhonratchasima.thaiwater.net → ต้องดึงผ่าน Actions
- `https://api-v3.thaiwater.net/api/v1/thaiwater30/provinces/rain3d?province_code=30` (และ `rain7d`, `rain1d`)
  → `data[]`: `rain_3d|rain_7d`, `rainfall_start_date`, `rainfall_end_date`, `station{...}`, `geocode.{amphoe_name, tumbon_name}`, `agency.agency_shortname`
- `.../provinces/dam?province_id=30` → `data.dam_daily[]` (ขนาดใหญ่ 4), `data.dam_medium[]` (ขนาดกลาง 35):
  `dam_date, dam_storage (ล้าน ลบ.ม.), dam_storage_percent, dam_inflow, dam_released, dam.{dam_name.th, dam_lat, dam_long}`
- อ่างบางแห่งข้อมูลเก่า (บางแถวลงวันที่ 1970-01-01) → ระบบตั้ง `stale` ถ้าเกิน 7 วัน
- หา endpoint ใหม่ได้จาก DevTools → Network → Fetch/XHR บนเว็บ nakhonratchasima.thaiwater.net

## 3. GISTDA Disaster Platform — ต้องใช้ API key (header `API-Key`)
- `GET https://api-gateway.gistda.or.th/api/2.0/resources/features/flood/7days?pv_idn=30&limit=1000&offset=N`
  (มี `1day`, `3days`, `30days`, `flood-freq` ด้วย — flood-freq ยังไม่ได้ตรวจโครงสร้าง)
- ซอง: `{features[], links[], numberMatched, numberReturned, timeStamp}` · แบ่งหน้าด้วย offset จน `offset ≥ numberMatched`
- `features[].properties`: `pv_idn, ap_idn (3009/3010), tb_idn (= tcode), tb_tn, ap_tn, f_area (ตร.ม.), h3_address (H3 res 9),
  file_name ("rd2_20260926_0613, S1C_…" คั่นด้วย ", "), building, population, school, hospital, length_road, rice_area …`
- ⚠️ `links[].href` มี `?api_key=` ของเรา **ห้ามเก็บ พิมพ์ หรือส่งต่อ** สคริปต์สร้าง URL หน้าถัดไปจาก offset เอง
- ภาพ SAR ตรวจน้ำท่วมในชุมชนหนาแน่น/ใต้ต้นไม้ได้ไม่ดี → 0 ไร่ไม่ได้แปลว่าไม่ท่วม

## 4. Open-Meteo Forecast API (แบบจำลอง NWP ไม่ใช่สถานี)
- `https://api.open-meteo.com/v1/forecast?latitude=..,..&longitude=..,..&hourly=precipitation&past_days=7&forecast_days=2&timezone=Asia/Bangkok`
- ส่งพิกัดตัวแทน 26 ตำบลในคำขอเดียว ได้ list · ฟรีสำหรับงานไม่ใช่เชิงพาณิชย์
- เทียบกับสถานีจริง (21–26 ก.ย. 69): แบบจำลองสูงกว่าสถานีในพื้นที่ราว 15–40 มม./7 วัน

### 4ข. ECMWF IFS ผ่าน Open-Meteo (`scripts/region/fetch_ecmwf.py` → `live/ecmwf.json`)
- `…/v1/forecast?latitude=<จันอัด>&longitude=…&models=ecmwf_ifs025&hourly=precipitation&daily=precipitation_sum,temperature_2m_max,temperature_2m_min&forecast_days=7&timezone=Asia/Bangkok`
- กริด 0.25° (~25 กม.) · ECMWF ออกรอบละ 6 ชม. → ดึงไม่เกินทุก 3 ชม. · ใช้ในรายงาน "สถานการณ์น้ำ" (ฝน 24/72 ชม. + 3 วัน)
- ยังไม่ได้ตรวจชื่อ field กับคำตอบจริงจากเครื่องพัฒนา (เครือข่ายปิด) — ตรวจ `live/ecmwf.json` หลัง Actions รอบแรก · ถ้า `status: error` ดู `error`
- ผลแบบจำลองระดับโลก ไม่ใช่การพยากรณ์ของกรมอุตุนิยมวิทยา · เครดิต CC BY 4.0

## 5. RainViewer
- `https://api.rainviewer.com/public/weather-maps.json` → `host + radar.past[-1].path + /256/{z}/{x}/{y}/2/1_1.png`
- รุ่นฟรีปี 2026: zoom สูงสุด 7 (`maxNativeZoom`) · ต้องแสดงเครดิต "Weather data by RainViewer"

## 6. Earth Engine
- Sentinel-1: `COPERNICUS/S1_GRD` IW, VV, 14 วันล่าสุด, mosaic วันที่ล่าสุด, `getThumbURL` 1400 px, −25..0 dB → PNG + bounds
- ต้องใช้ service account ที่มี **Earth Engine Resource Writer** (Viewer ไม่มีสิทธิ์ `earthengine.thumbnails.create`) + **Service Usage Consumer**
- Open Buildings V3: `GOOGLE/Research/open-buildings/v3/polygons`, confidence ≥ 0.70 (ข้อมูลเปิด CC BY 4.0)
- MERIT Hydro `MERIT/Hydro/v1_0_1` (band `hnd`, `wth`) ใช้ในชั้น S ที่พักไว้

## 7. กรมชลประทาน (ไฟล์)
- PDF "สถานีสำรวจระดับน้ำ ลุ่มน้ำมูล ปีน้ำ 2569 (79 สถานี)": CODE, แม่น้ำ, บ้าน/ตำบล/อำเภอ/จังหวัด, UTM, Lat-Long, **Z.G (ม.รทก.)**, **D.A (ตร.กม.)**
- **Lat-Long ในเอกสารผิดหลายแถว** (M.206, M.202, M.204, M.174, M.177, M.196, M.211, E.98) → ใช้ค่าที่แปลงจาก UTM (`coord_q: utm`) หรือไม่ใช้ (`bad`)
- ความลึกน้ำ = `waterlevel_msl − zg` · เรียงสถานีบนลำน้ำเดียวกันด้วย D.A (มาก = ท้ายน้ำ)
- `KEYSTATION_RID.csv`: สถานีหลัก 159 แห่งทั่วประเทศ (ไม่มี Z.G/D.A) — ในนครราชสีมา: M.164, M.173, M.195, TM.202, TM.204

## สถานีสำคัญของพื้นที่
| รหัส | ลำน้ำ | ที่ตั้ง | D.A | Z.G | ใน ThaiWater |
|---|---|---|---|---|---|
| M.206 | ลำเชียงไกร | ต.ด่านจาก อ.โนนไทย | 2,239 | — | ไม่มี |
| **M.188A** | ลำเชียงไกร | บ.เพิ่ม ต.โนนสูง (ThaiWater เรียก "บ้านบัว") | 2,811 | 157.700 | มี |
| M.2A | มูล | ต.พระพุทธ อ.เฉลิมพระเกียรติ | 4,724 | 161.000 | มี |
| M.164 | ลำตะคอง | ต.ในเมือง อ.เมือง | 3,033 | — | มี |
| M.194 | มูล | ต.ดอนชมพู อ.โนนสูง | 8,467 | — | ไม่มี |
| M.195 / M.184 | มูล | อ.พิมาย | 11,458 / 11,476 | 151.3 / 150.0 | มี |
| ONE022 | คลองสามบาท | บ.กุดพิมาน อ.ด่านขุนทด | — | — | มี (มักเกินตลิ่ง) |
อ่างลำเชียงไกรตอนบน (อ.ด่านขุนทด, 101.64°E) → ตอนล่าง (อ.โนนไทย, 101.90°E) → M.206 → จันอัด → M.188A → มูล
**แก้ไข 29 ก.ย. 69:** ลำเชียงไกรบรรจบมูล**ระหว่าง M.194 กับ M.195** (ตรวจด้วย NEXT_DOWN ของ HydroBASINS และ D.A: M.2A 4,724 + ลำตะคอง M.164 3,033 ≈ M.194 8,467 · M.194 + M.188A 2,811 ≈ M.195 11,458) — ข้อสรุปเดิม "ระหว่าง M.2A กับ M.194" ผิดเพราะไม่ได้นับลำตะคอง

## 8. กรมชลประทาน ระบบฐานข้อมูลน้ำในอ่างเก็บน้ำ (app.rid.go.th/reservoir)
- หน้า `rsvmiddle/detail/<รหัส>/<เริ่ม>/<สิ้นสุด>` · `rsv292` = อ่างลำเชียงไกรตอนล่าง (ความจุ รนก. 27.7 ล้าน ลบ.ม.)
- **API (ตรวจแล้ว 28 ก.ย. 69, CORS `*`):** `POST https://app.rid.go.th/reservoir/api/rsvmiddles`
  form `date=YYYY-MM-DD&region=ne&percent=&percent_from=&percent_to=&status=1` → `region[].reservoir[]`
  field: `cresv` (rsv300 ตอนบน, rsv292 ตอนล่าง), `date` (null = วันนั้นยังไม่บันทึก), `nresv`, `cresv_lat/lng`, `tprov`,
  `cap_resv`, `low_qdisc`, `qdisc_curr`, `percent_resv_curr`, `qdisc_prev`, `percent_resv_prev`, `q_info`, `jan_info`, `q_outfo`, `water_workable`
  ตัวเลขเป็นข้อความมีจุลภาค · `" - "` = ไม่มีข้อมูล · อ่างขนาดใหญ่ `api/dams` โครงสร้างต่างกัน (ยังไม่ได้ใช้)
- `scripts/region/fetch_rid_reservoir.py` → `region/data/live/rid_reservoir.json` (24 อ่างขนาดกลางใน จ.นครราชสีมา + ประวัติ 400 วัน) ดึงไม่เกินทุก 3 ชม.
- ประวัติย้อนหลังก่อนเริ่มดึง: **Export To Excel** จากหน้า `rsvmiddle/detail/<รหัส>/<เริ่ม>/<สิ้นสุด>` แล้ว `import_rid_rsv.py`
- คอลัมน์: วันที่ (ไทย พ.ศ.), ความจุ รนก., ต่ำสุด, ปริมาณน้ำปีก่อน + %, ปัจจุบัน + %, ไหลลง/สะสม, ระบาย/สะสม, ใช้การได้
- ตรงกับ ThaiWater (27 ก.ย. 69: 15.82 ล้าน ลบ.ม. 57.11% ทั้งสองแหล่ง) แต่**กรมชลประทานอัปเดตเร็วกว่า 1 วัน**
- ผลลัพธ์: `region/data/rid_rsv/index.json` + `rsv_<hash>.json` → หน้าลำเชียงไกรใช้แสดงกราฟทั้งปี เทียบปีก่อน และวันคาดเต็มความจุ

## 9. GloFAS (Copernicus EMS) ผ่าน Open-Meteo Flood API
- `https://flood-api.open-meteo.com/v1/flood?latitude=..&longitude=..&daily=river_discharge,river_discharge_median,river_discharge_max,river_discharge_min&past_days=60&forecast_days=30`
  ไม่ต้องใช้ key · GloFAS v4 กริด ~5 กม. ต่อเนื่องตั้งแต่ 1984 · พิกัดต้องอยู่บน/ใกล้ลำน้ำ (ใช้พิกัดสถานี M.206, M.188A, M.2A, M.194, M.195)
- `scripts/region/fetch_glofas.py` → `region/data/live/glofas.json` · เกณฑ์ ≈ รอบ 2/5/20 ปี จากควอนไทล์ค่าสูงสุดรายปี 1984–ปีที่แล้ว (คำนวณใหม่ทุก 30 วัน)
- **ยังไม่ได้ตรวจเทียบกับสถานีจริง** · ไม่จำลองการบริหารอ่างขนาดกลาง → ใช้ดูแนวโน้ม ห้ามใช้เป็นเกณฑ์เตือนจนกว่าจะเทียบกับ M.188A
- ทางการ: Copernicus EWDS (ต้องมีบัญชี, GRIB) และ WMS-T · GFM (น้ำท่วมจาก Sentinel-1, 3 อัลกอริทึม) ซ้ำกับ GISTDA จึงยังไม่ใช้

## 10. RainViewer (ตรวจเอกสาร 28 ก.ย. 69)
- `radar.past` = 2 ชม. ทุก 10 นาที → ระบบทำภาพเคลื่อนไหว (ตัวควบคุมกลางบนของแผนที่) · zoom สูงสุด 7
- หน้ากากพื้นที่ครอบคลุม `{host}/v2/coverage/0/256/{z}/{x}/{y}/0/0_0.png` (ดำ = เรดาร์ไม่ครอบคลุม) → ช่อง "พื้นที่ครอบคลุม"
