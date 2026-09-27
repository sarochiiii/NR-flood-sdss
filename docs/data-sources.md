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
| M.194 | มูล | ต.ดอนชมพู อ.โนนสูง | 8,467 | — | ไม่มี |
| M.195 / M.184 | มูล | อ.พิมาย | 11,458 / 11,476 | 151.3 / 150.0 | มี |
| ONE022 | คลองสามบาท | บ.กุดพิมาน อ.ด่านขุนทด | — | — | มี (มักเกินตลิ่ง) |
อ่างลำเชียงไกรตอนบน (อ.ด่านขุนทด, 101.64°E) → ตอนล่าง (อ.โนนไทย, 101.90°E) → M.206 → จันอัด → M.188A → มูล
(จุดบรรจบอยู่ระหว่าง M.2A กับ M.194 เพราะ 4,724 + 2,811 < 8,467)
