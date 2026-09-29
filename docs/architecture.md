# โครงสร้างระบบและไฟล์

## สารบัญ
- หน้าเว็บ · ไฟล์ข้อมูลคงที่ · ไฟล์ข้อมูลสด · สคริปต์ · GEE · workflow · บัญชีและ secret

## หน้าเว็บ (`region/`)

| ไฟล์ | หน้าที่ |
|---|---|
| `index.html` | หน้าหลัก: KPI 6 ช่อง, แถบแจ้งเตือนระดับน้ำ, แผนที่, แผงขวา (การ์ดตำบล/จุดที่แตะ, ปุ่มลำเชียงไกร, สถานีที่ควรจับตา, เลเยอร์, ตำบลเรียงตามฝน, สถานะข้อมูล, วิธีคำนวณ) |
| `lamchiangkrai.html` | หน้าเฝ้าระวังลำเชียงไกร: อ่างตอนบน → อ่างตอนล่าง → M.206 → จันอัด → M.188A → มูล (M.2A + ลำตะคอง M.164 → M.194 → **ลำเชียงไกรบรรจบ** → M.195 → M.184) |
| `js/region.js` | แผนที่ ขอบเขตตำบล โหมดสี (เส้นขอบอย่างเดียว=ค่าเริ่มต้น / T / ฝน 24 ชม. / ฝน 7 วัน) การ์ดตำบล สถานะข้อมูล ส่งออก `window.SDSS` |
| `js/layers.js` | เลเยอร์เพิ่มเติม KPI สถานีที่ควรจับตา แนวโน้ม/กราฟ สถานะตลิ่ง ETA แถบแจ้งเตือน แตะจุดใดก็ได้ รีเฟรชทุก 10 นาที |
| `css/region.css` | สไตล์ (IBM Plex Sans Thai, navy/teal) |
| `config.json` | เกณฑ์ทั้งหมด (ดู config-logic.md) |

ชั้นข้อมูลใน `layers.js` จัดกลุ่มตามห่วงโซ่น้ำท่วม (ปรับ 28 ก.ย. 69):
① ฝน: `rainsta` ฝนสถานี · `rainacc` ฝนสะสม 7/3 วัน (สถานีในพื้นที่ + buffer) · `radar` เรดาร์ฝน 2 ชม. (ภาพเคลื่อนไหว + พื้นที่ครอบคลุม)
② อ่าง/ลำน้ำ: `dams` · `wlsta` · `glofas` (ทดลอง)  ③ น้ำท่วม: `gistda`  ④ ผลกระทบ: `bldg` อาคาร/สิ่งปลูกสร้าง  พื้นฐาน: `labels`
เปิดเป็นค่าเริ่มต้น: เขตตำบล/อำเภอ · อ่างเก็บน้ำ · ระดับน้ำ · น้ำท่วมตรวจพบ · **ถอดแล้ว:** ภาพ Sentinel-1 (ซ้ำกับ GISTDA; workflow ยังเก็บภาพอยู่) · โหมดฝนสะสม 7 วันแบบจำลอง
โหมดสีตำบล: เส้นขอบเขตอย่างเดียว (ค่าเริ่มต้น) · สภาวะ T · ฝนคาดการณ์ 24 ชม.
รอบถัดไป: กรองอ่าง/สถานี/รายการจับตาด้วยขอบเขตลุ่มน้ำ (HydroSHEDS) และปรับ T ให้ใช้ฝนลุ่มน้ำ + อ่างต้นทาง + M.188A

## ไฟล์ข้อมูลคงที่ (`region/data/`)

| ไฟล์ | เนื้อหา | ที่มา |
|---|---|---|
| `tambon.geojson` | 26 ตำบล: `tcode, name, amphoe, acode, area_km2, lat, lon, station_code(null), s_class(null), bldg` | OpenGISData-Thailand (ไม่ใช่ข้อมูลทางการ) |
| `amphoe.geojson` | 2 อำเภอ (acode 3009 โนนไทย, 3010 โนนสูง) | รวมจาก tambon |
| `hex.geojson` | H3 res 8 1,421 ช่อง + `bldg` | `scripts/region/merge_buildings.py` |
| `buildings.json` | จุดอาคาร 156,670 หลัง (delta-encoded) | GEE `region_buildings.js` |
| `bldg/<tcode>.json`, `bldg/index.json` | รูปอาคาร 154,115 หลัง แยกรายตำบล | GEE `region_buildings_poly.js` → `build_building_tiles.py` |
| `rid_stations.json` | 79 สถานีกรมชลประทาน ลุ่มน้ำมูล ปีน้ำ 2569: `river, zg (ม.รทก.), da (ตร.กม.), lat, lon, coord_q` | PDF "สถานีสำรวจระดับน้ำ ลุ่มน้ำมูล 2569" |

## ไฟล์ข้อมูลสด (`region/data/live/`) — เขียนโดย Actions เท่านั้น ห้ามแก้มือ

| ไฟล์ | สคริปต์ |
|---|---|
| `rain_region.json` | `fetch_rain.py` (Open-Meteo รายตำบล) |
| `thaiwater_region.json`, `water_region.json` | `fetch_thaiwater.py` |
| `tw_province.json` | `fetch_tw_province.py` (ฝนสะสม 3/7 วัน 73 สถานี, อ่าง 39 แห่ง) |
| `gistda_flood_7d.geojson` | `fetch_gistda_flood.py` (มี `by_tambon`, `exposure`, `images`) |
| `s1_latest.json`, `s1_latest.png` | `fetch_s1.py` (commit PNG ใหม่เมื่อวันที่ภาพเปลี่ยนเท่านั้น) |
| `history.json` | `update_history.py` (ระดับน้ำ 14 วัน, อ่าง 30 รายการ) |
| `risk_now.json` | `compute_risk.py` (เตรียมไว้ให้ LINE OA) |
| `raw/` | ข้อมูลดิบรอบตรวจโครงสร้าง ลบได้ |

## สคริปต์ (`scripts/region/`) — Python มาตรฐาน + shapely/pyproj/earthengine-api
`_common.py` (path, bbox+buffer 0.15°, read/write) · fetch_* ตามตารางบน · `update_history.py` · `compute_risk.py` ·
`merge_buildings.py` · `build_building_tiles.py` · `merge_susceptibility.py` (ชั้น S — พักไว้)
ทุก fetch_* ออกแบบให้ไม่ทำให้ workflow ล้ม: ถ้าดึงไม่ได้จะเขียน `status: error` และเก็บข้อมูลเดิมไว้

## GEE (`gee/`) และ asset ใน `projects/ee-sarochineek/assets/`
| asset | เนื้อหา |
|---|---|
| `NR_hex_res8_shp` | กริด H3 res 8 (field h3, tcode) |
| `NR_FloodFreq` | น้ำท่วมซ้ำซาก GISTDA ระดับจังหวัด (field `Repeating` 1–9, `Label` 0–3; มี GeometryCollection/LineString ต้องกรอง) |
| `Repeatarea` | น้ำท่วมซ้ำซากเฉพาะจันอัด |
| `ChanAtOSM`, `ChiangKri`, `ChiangKriFull` | ขอบเขตจันอัด, เส้นลำเชียงไกร (สำหรับ Sandbox) |
สคริปต์: `region_buildings.js` (จุด+hex) · `region_buildings_poly.js` (รูปอาคาร SHP) · `region_susceptibility.js` (ชั้น S — พักไว้)

## Workflow `.github/workflows/region-live.yml`
cron `15 * * * *` + ปุ่ม Run workflow · ขั้นตอน: ติดตั้ง library → fetch_rain → fetch_thaiwater → fetch_tw_province →
fetch_gistda_flood → fetch_s1 → update_history → compute_risk → commit `region/data/live/` (ใช้ actions/checkout@v6, setup-python@v6)
Settings → Actions → General → Workflow permissions = **Read and write**

## บัญชีและ secret (ห้ามเก็บค่าจริงในเอกสาร)
| รายการ | ที่อยู่ |
|---|---|
| `GISTDA_API_KEY` | GitHub Secret · สมัคร/หมุนเวียนที่ api-gateway.gistda.or.th (หมุนเวียน key เมื่อสงสัยว่าหลุด) |
| `EE_SERVICE_ACCOUNT_KEY` | GitHub Secret · service account `github-actions-ee@ee-sarochineek.iam.gserviceaccount.com` roles: Earth Engine Resource Writer + Service Usage Consumer |
| `EE_PROJECT` | ตั้งตรงใน workflow = ee-sarochineek |

## LINE OA (ระยะ P1 · 27 ก.ย. 69)
| ส่วน | ที่อยู่ |
|---|---|
| โค้ด Worker `line-hub` | `line/worker.js` (คัดลอกไปวางใน Cloudflare → Edit code) |
| ฐานข้อมูลผู้ใช้ | Cloudflare D1 `line-hub-db` ตาม `line/schema.sql` — **ข้อมูลส่วนบุคคล ห้ามนำขึ้น repo** |
| หน้าลงทะเบียน LIFF | `region/liff/register.html` (ต้องใส่ LIFF_ID และ URL Worker) |
| ภาพ rich menu | `line/richmenu_2500x1686.png` (6 ช่อง ตั้งค่าใน OA Manager) |
| คู่มือตั้งค่า | `line/SETUP.md` |
Worker อ่านข้อมูลสถานการณ์จากเว็บสาธารณะ (config.json, tambon, rain, thaiwater, tw_province, gistda) · cron 00:00 UTC ส่งสรุป D1 ให้ role adm/staff

## Sandbox จันอัด แบบจำกัดสิทธิ์ (ข้อมูลครัวเรือน)
| ส่วน | ที่อยู่ |
|---|---|
| หน้าเว็บ + `households.geojson` | Cloudflare Pages (Direct Upload) ชื่อ project ที่เดายาก — **ไม่อยู่ใน GitHub** |
| การยืนยันตัวตน | Cloudflare Access (Zero Trust Free) · One-time PIN ทางอีเมล · ผู้มีสิทธิ์ ≤ 5 อีเมล · 2 application (URL หลัก + `*.project.pages.dev`) |
| ข้อมูลที่หน้า Sandbox อ่านจากเว็บสาธารณะ | tambon, bldg/301010, thaiwater_region, tw_province, config |
| ปุ่มจากเว็บสาธารณะ | `region/config.json` → `sandbox.url`, `sandbox.label` |
คู่มือ: `README-SETUP.md` ในชุดไฟล์ sandbox-private (เก็บในไดรฟ์ของโครงการ ไม่ใช่ repo)
