# ส่วนขยายระดับภูมิภาค: อำเภอโนนไทย–โนนสูง (Chanat-SDSS)

ส่วนขยายนี้เพิ่มหน้า L1/L2 (ภูมิภาค → ตำบล) ให้ระบบ Chanat-SDSS โดย**ไม่แตะไฟล์เดิม**
หน้าเดิมที่ root ของ repo ทำหน้าที่เป็น L3 (Sandbox จันอัด) ต่อไป

## ไฟล์ที่เพิ่ม

```
region/                          หน้าเว็บ  →  https://<user>.github.io/<repo>/region/
├── index.html · css/region.css · js/region.js · js/layers.js
├── config.json                  เกณฑ์ทั้งหมด (ใช้ร่วมกับ Python) — แก้ที่นี่ที่เดียว
└── data/
    ├── tambon.geojson           26 ตำบล (โนนไทย 10 · โนนสูง 16)
    ├── amphoe.geojson
    ├── hex.geojson              ← สร้างโดย merge_susceptibility.py หลังรัน GEE
    └── live/  rain_region.json · water_region.json · risk_now.json   ← เขียนโดย Actions
scripts/region/  fetch_rain.py · fetch_thaiwater.py · fetch_gistda_flood.py · fetch_s1.py
                 compute_risk.py · merge_susceptibility.py · _common.py
gee/             region_susceptibility.js · hex_grid_res8.geojson (1,421 ช่อง)
.github/workflows/region-live.yml
```

## ติดตั้งบน GitHub (repo ใหม่)

โครงสร้างหน้าเว็บ: `/` ส่งต่อไป `/region/` (ภาพรวมสองอำเภอ) · `/chanat/` (Sandbox จันอัด)
ขั้นตอนละเอียดดูในข้อความแชท — สรุป: สร้าง repo สาธารณะ → อัปโหลดไฟล์ → สร้าง
`.github/workflows/region-live.yml` ผ่านหน้าเว็บ → เปิดสิทธิ์ Actions แบบ Read and write →
เปิด GitHub Pages จาก branch `main` / root → Run workflow

## เปิดชั้น Susceptibility (S) → ได้ระดับเขียว/เหลือง/ส้ม/แดง

1. อัปโหลด `gee/hex_grid_res8.geojson` เป็น Table asset ชื่อ `NR_hex_res8`
2. เตรียมข้อมูลความถี่น้ำท่วม GISTDA 2554–2567 ให้ครอบคลุม**ทั้งสองอำเภอ** แล้วแก้ `FREQ_ASSET`,
   `FREQ_IS_VECTOR`, `FREQ_FIELD` ใน `gee/region_susceptibility.js`
3. รันใน Code Editor → ตรวจ `print()` ทุกบรรทัด → Tasks → Run export `NR_hex_metrics` (CSV ลง Drive)
4. วาง CSV ที่ `gee/NR_hex_metrics.csv` แล้วรัน
   `python scripts/region/merge_susceptibility.py gee/NR_hex_metrics.csv`
5. commit `region/data/hex.geojson` และ `region/data/tambon.geojson`

**Gate:** hexagon ครบ 1,421 ช่อง · `freq_max` ไม่เป็น 0 ทุกช่อง · ขนาด `hex.geojson` < 1 MB
· เทียบ S รายตำบลกับประสบการณ์ ADM/อบต. อย่างน้อย 3 ตำบล

## เลเยอร์เพิ่มเติม

| เลเยอร์ | แหล่ง | ช่องทาง | ต้องตั้งค่า |
|---|---|---|---|
| น้ำท่วมตรวจพบ 7 วัน | GISTDA Disaster Platform API | Actions → `gistda_flood_7d.geojson` | Secret `GISTDA_API_KEY` |
| ภาพเรดาร์ Sentinel-1 | Earth Engine (`COPERNICUS/S1_GRD`) | Actions → `s1_latest.png` | Secret `EE_SERVICE_ACCOUNT_KEY` |
| ชื่อตำบล + ขอบเขต | `tambon.geojson`, `amphoe.geojson` | ไฟล์ใน repo | — |
| เรดาร์ฝน | RainViewer public API | เบราว์เซอร์ตรง | — |
| ฝนสถานีตรวจวัด | ThaiWater `rain_24h` | เบราว์เซอร์ตรง / snapshot จาก Actions | — |
| ระดับน้ำสถานี | ThaiWater `waterlevel_load` | เบราว์เซอร์ตรง / snapshot จาก Actions | — |
| บ้านเรือน | Open Buildings V3 ผ่าน `hex.geojson` | ไฟล์ใน repo | รัน GEE ก่อน |

**GISTDA:** สมัคร API key ที่ https://api-gateway.gistda.or.th แล้วใส่เป็น Secret `GISTDA_API_KEY`
(Settings → Secrets and variables → Actions) ห้ามใส่ key ในไฟล์หน้าเว็บ

**Sentinel-1:** สร้าง service account ใน Google Cloud project `ee-sarochineek` ให้สิทธิ์
Earth Engine Resource Viewer และ Service Usage Consumer สร้าง key แบบ JSON แล้ววางทั้งไฟล์เป็น Secret
`EE_SERVICE_ACCOUNT_KEY` สคริปต์จะ commit PNG ใหม่เฉพาะเมื่อวันที่ภาพเปลี่ยน

**RainViewer:** ใช้ฟรีสำหรับงานการศึกษาโดยต้องแสดงเครดิต "Weather data by RainViewer" (หน้าเว็บใส่ให้แล้ว)
ตั้งแต่ปี 2026 รุ่นฟรีจำกัด zoom สูงสุดที่ 7 ภาพจึงหยาบเมื่อซูมเข้า

## เชื่อมระดับน้ำเข้าการคำนวณ T

`fetch_thaiwater.py` ดึงสถานีระดับน้ำทุกสถานีในขอบเขต + buffer 0.15° มาเก็บใน `water_region.json` แล้ว
ขั้นที่ยังต้องทำด้วยมือคือใส่ `station_code` (รหัสสถานีที่เห็นใน popup) ให้แต่ละตำบลใน `tambon.geojson`
ควรยืนยันการจับคู่กับโครงการชลประทานนครราชสีมา

T จากระดับน้ำใช้ `storage_pct` (ร้อยละความจุลำน้ำของ ThaiWater) หาร 100 ไม่ใช้ `level_m / bank_m`
เพราะทั้งสองค่าเป็นระดับ ม.รทก. เมื่อเกณฑ์ได้รับการยืนยัน เปลี่ยน `water.verified` ใน `config.json` เป็น `true`

## Service Worker (offline)

เพิ่มใน precache list ของ `sw.js` เดิม แล้ว bump version:
```js
'region/', 'region/index.html', 'region/css/region.css', 'region/js/region.js',
'region/config.json', 'region/data/tambon.geojson', 'region/data/amphoe.geojson'
```
ไฟล์ใน `region/data/live/` ใช้ network-first ตามแบบเดิม

## Data contract (ส่วนเพิ่ม)

| ไฟล์ | field ที่ขาดไม่ได้ |
|---|---|
| `tambon.geojson` | `tcode`, `name`, `amphoe`, `lat`, `lon`, `station_code` (null ได้), `s_class` (null ได้) |
| `hex.geojson` | `h3`, `tcode`, `s_class` 1–4, `freq_max`, `flood_frac`, `hand_m`, `dist_m`, `bldg` |
| `rain_region.json` | `status`, `updated_at`, `tambon[]`: `tcode`, `rain_24h_mm`, `rain_7d_mm`, `rain_next24h_mm` |
| `water_region.json` | `status`, `updated_at`, `stations[]`: `code`, `name`, `level_m` (ม.รทก.), `bank_m` (ม.รทก.), `storage_pct`, `measured_at` |
| `thaiwater_region.json` | snapshot สถานีฝน/ระดับน้ำสำหรับชั้นแผนที่ |
| `gistda_flood_7d.geojson` | `status`, `updated_at`, `total_rai`, features[`area_rai`] |
| `s1_latest.json` + `.png` | `status`, `date`, `bounds` |
| `risk_now.json` | `updated_at`, `tambon[]`: `tcode`, `t_state`, `s_class`, `level_rank` |

ตรรกะ T และ matrix อยู่สองที่: `js/region.js` (`tFromRain`, `tFromWater`) และ
`scripts/region/compute_risk.py` — แก้ที่หนึ่งต้องแก้อีกที่ ส่วนตัวเลขเกณฑ์อยู่ใน `config.json` ที่เดียว

## ข้อจำกัดที่ต้องระบุในรายงาน

- ฝนเป็นผลจากแบบจำลองเชิงตัวเลข (Open-Meteo) ไม่ใช่สถานีวัดจริง ความละเอียดราว 10 กม.
  ควรแทนด้วยข้อมูลสถานีกรมอุตุนิยมวิทยาหรือเรดาร์เมื่อมีข้อตกลง
- โครงสร้าง response ของ ThaiWater public API อ้างอิงจากโค้ดโอเพนซอร์สที่เรียก endpoint เดียวกัน
  ยังไม่มีเอกสารทางการ ถ้า สสน. เปลี่ยน format ชั้นสถานีจะหยุดแสดงผล (หน้าเว็บจะแจ้งสถานะ)
- เกณฑ์ฝน 24 ชม. อ้างอิงการจำแนกปริมาณฝนของกรมอุตุนิยมวิทยา ซึ่งเป็นเกณฑ์อุตุนิยมวิทยา
  ไม่ใช่เกณฑ์การเกิดน้ำท่วมเฉพาะพื้นที่
- S เป็นค่าเชิงสัมพัทธ์ภายในพื้นที่ศึกษา (quartile) น้ำหนักสามตัวชี้วัดเท่ากัน รอ calibrate กับเหตุการณ์ปี 2564
- Risk matrix และเกณฑ์สัดส่วนระดับน้ำ/ตลิ่ง ยังไม่ได้รับการยืนยันจากหน่วยงาน
- ขอบเขตตำบลจาก OpenGISData-Thailand (GitHub: chingchai) ไม่ระบุแหล่งต้นฉบับ
  ควรแทนด้วยข้อมูลกรมการปกครองก่อนเผยแพร่ในรายงาน
- Open-Meteo ให้ใช้ฟรีสำหรับงานที่ไม่ใช่เชิงพาณิชย์ หากขยายผลแบบมีค่าตอบแทนต้องตรวจเงื่อนไขใหม่
