# โครงสร้างเว็บ SDSS-ChanAT (repo sarochiiii/NR-flood-sdss)

## ภาพรวม
```
แหล่งข้อมูล ─┬─ browser เรียกตรง: ThaiWater public, RainViewer, Open-Meteo (สำรอง)
             └─ GitHub Actions `region-live` ทุกชั่วโมง นาทีที่ 15 → commit region/data/live/*
เว็บ static (GitHub Pages) อ่าน config.json + data/*.json → Leaflet
LINE OA (Cloudflare Worker) อ่าน JSON เดียวกันจากเว็บ เพื่อตอบ "สถานการณ์น้ำ"
```

## หน้าเว็บ (`region/`)
| ไฟล์ | หน้าที่ |
|---|---|
| `index.html` | หัว **SDSS-ChanAT** (ระบบสนับสนุนการตัดสินใจเชิงพื้นที่ ตำบลจันอัด อำเภอโนนสูง จังหวัดนครราชสีมา) · KPI · แถบแจ้งเตือนตลิ่ง · **แผงชั้นข้อมูลซ้าย (ซ่อนได้)** · แผนที่ · แผงขวา (ปุ่ม 📍รายงาน/🆘ขอความช่วยเหลือ, ปุ่มลำเชียงไกร, การ์ดตำบล, สถานีที่ควรจับตา 5 อันดับ + ดูทั้งหมด, สถานะข้อมูล, วิธีคำนวณ) |
| `lamchiangkrai.html` | ลำเชียงไกร: อ่างตอนบน → อ่างตอนล่าง → M.206 → จันอัด → M.188A → มูล · แม่น้ำมูล: M.2A + ลำตะคอง M.164 → M.194 → **ลำเชียงไกรบรรจบ** → M.195 → M.184 · อ่างใช้ข้อมูลกรมชลประทาน (กราฟทั้งปี เทียบปีก่อน วันคาดเต็มความจุ) · พยากรณ์ GloFAS 5 จุด |
| `js/region.js` | แผนที่ basemap **ภาพดาวเทียมเป็นค่าเริ่มต้น** (สีเส้น/ชื่อปรับตาม basemap) · เขตตำบล โหมดสี (เส้นขอบเขตอย่างเดียว=ค่าเริ่มต้น · T · ฝนคาดการณ์ 24 ชม.) · การ์ดตำบล + "ที่มาของ T" · `window.SDSS` |
| `js/layers.js` | ชั้นข้อมูล KPI รายการจับตา (กรองตามลุ่มน้ำ) แนวโน้ม สถานะตลิ่ง ETA แถบแจ้งเตือน แตะจุด รีเฟรช 10 นาที ปุ่ม LINE |
| `css/region.css` | สไตล์ |
| `config.json` | เกณฑ์ทั้งหมด (`rain`, `water`, `bank`, `t_rules`, `sandbox`) |
| `liff/` | หน้า LIFF register/report/help/staff + `config.js` (LIFF_ID, API) — **ยังเป็นค่า placeholder** (รอระบบ D1) ปุ่ม 📍/🆘 บนเว็บจึงเป็นสีเทา |

## ชั้นข้อมูล (แผงซ้าย จัดตามห่วงโซ่น้ำท่วม) · ✓ = เปิดเป็นค่าเริ่มต้น
| กลุ่ม | id · ชื่อ |
|---|---|
| ① ฝน | `rainsta` ฝนสถานีตรวจวัด ✓ (24 ชม./1 ชม.) · `rainacc` ฝนสะสม 7/3 วัน (สถานีในพื้นที่+buffer) · `radar` เรดาร์ฝน 2 ชม. (ภาพเคลื่อนไหว ▶/⏸ + หน้ากากพื้นที่ครอบคลุม) |
| ② อ่างเก็บน้ำและลำน้ำ | `dams` อ่างเก็บน้ำ ✓ (ThaiWater + กรมชลประทาน · เกินความจุ >100% = วงแดงกระพริบ) · `wlsta` ระดับน้ำสถานี ✓ (เกินตลิ่ง >100% = วงแดงกระพริบ) · `structures` **อาคารชลศาสตร์ลำเชียงไกร (ปภ./อบต.)** ✓ 64 จุด **ปิดเป็นค่าเริ่มต้น** ไอคอนสี่เหลี่ยมสีเดียว `#DB2777` ไม่มีตัวอักษร · `glofas` พยากรณ์ปริมาณน้ำ 30 วัน (ทดลอง) |
| ③ น้ำท่วม | `gistda` น้ำท่วมตรวจพบ ✓ (ทั้งจังหวัด · ซูม <12 วงกลมตามพื้นที่ · ≥12 เซลล์ H3 สีฟ้าสด) · `reports` จุดแจ้งเหตุจาก LINE OA ✓ (จุดแดงกระพริบ · /api/reports 7 วัน · ปัด ~100 ม.) |
| ④ ผลกระทบ | `bldg` อาคาร/สิ่งปลูกสร้าง (ซูม 13–14 จุด · ≥15 polygon รายตำบล) |
| พื้นฐาน | `labels` เขตตำบล/อำเภอ ✓ · `rivers` แม่น้ำ/ลำน้ำ OpenStreetMap (river/canal/stream · `data/osm_rivers.geojson` สร้างโดย workflow `osm-rivers` · ปิดเป็นค่าเริ่มต้น) · `water` แหล่งน้ำผิวดิน OpenStreetMap (polygon อ่าง/สระ/หนอง-บึง/กุด/พื้นที่ชุ่มน้ำ/บ่อพัก · ไม่รวมตัวลำน้ำ · `data/osm_water.geojson` พร้อม area_rai · workflow เดียวกัน · ปิดเป็นค่าเริ่มต้น) · `basins` ขอบเขตลุ่มน้ำ HydroBASINS (ปิดเป็นค่าเริ่มต้น) |
ถอดแล้ว: ภาพ Sentinel-1 (ซ้ำกับ GISTDA; workflow ยังเก็บภาพ) · โหมดฝนสะสม 7 วันแบบจำลอง · ตำบลเรียงตามฝน

## ข้อมูลคงที่ (`region/data/`)
| ไฟล์ | เนื้อหา · ที่มา |
|---|---|
| `tambon.geojson` / `amphoe.geojson` | 26 ตำบล (โนนไทย 10 · โนนสูง 16): `tcode, name, amphoe, acode, area_km2, lat, lon, station_code, s_class, bldg, basin` · shapefile `NR_admin3` (adm3_pcode, valid_on 2022-01-22) |
| `basins.geojson` · `basin_points.json` | ลุ่ม LCK (เหนือ M.188A) · MUN_UP (เหนือ M.2A) · TAK (ลำตะคองเหนือ M.164) · STUDY (เหนือ M.195) · ไม่มีรู · 78 จุดตัวแทนฝนลุ่มน้ำ |
| `structures.geojson` | อาคารชลศาสตร์ 64 จุด (`seq` จากอ่างตอนล่างลงไป, `name`, `name_src`, `type`, `tcode`) · ปภ. และ อบต. (อนุญาตเผยแพร่แล้ว) · ต้นฉบับ `data/src/structures_point_1.kml` |
| `rid_stations.json` | 79 สถานีกรมชลประทาน ลุ่มน้ำมูล (Z.G, D.A, พิกัดที่แก้จาก UTM) |
| `buildings.json` · `bldg/<tcode>.json` · `hex.geojson` | Open Buildings V3 (≥0.70): จุด 156,507 หลัง · polygon 153,886 หลัง · H3 res 8 |
| `rid_rsv/` | ประวัติรายวันอ่างจาก Excel กรมชลประทาน (**ยังไม่ขึ้น repo** — อยู่ใน update-20) |

## ข้อมูลสด (`region/data/live/`) — Actions เขียน ห้ามแก้มือ
`rain_region` · `basin_rain` (ฝนเฉลี่ยลุ่ม LCK/MUN_UP) · `thaiwater_region` · `water_region` · `tw_province` · `rid_reservoir` (อ่างกลาง 24 แห่ง + ประวัติ 400 วัน) · `glofas` (5 จุด) · `gistda_flood_7d.geojson` (ทั้งจังหวัด) · `s1_latest.*` · `history` · `risk_now`

## สคริปต์ (`scripts/region/`)
fetch: `fetch_rain` · `fetch_basin_rain` · `fetch_thaiwater` · `fetch_tw_province` · `fetch_rid_reservoir` · `fetch_glofas` · `fetch_gistda_flood` · `fetch_s1` · `update_history` · `compute_risk`
สร้างข้อมูลครั้งเดียว: `merge_buildings` · `build_building_tiles` · `build_basins` · `import_rid_rsv` · `import_structures` · `import_sandbox_layers` · `merge_susceptibility` (ชั้น S พักไว้)

## Workflow `.github/workflows/region-live.yml`
ทุกชั่วโมงนาที 15 + Run workflow · ลำดับ: ติดตั้ง lib → ฝนรายตำบล → ฝนลุ่มน้ำ → ThaiWater → ThaiWater จังหวัด → กรมชลประทาน → GloFAS → GISTDA → Sentinel-1 → ประวัติ → ความเสี่ยง → **commit (ลอง push ซ้ำ 4 ครั้ง 15/30/45/60 วินาที)**
Secrets: `GISTDA_API_KEY` · `EE_SERVICE_ACCOUNT_KEY` (service account `github-actions-ee@ee-sarochineek` · Earth Engine Resource Writer + Service Usage Consumer)

## GEE (project ee-sarochineek) · `gee/`
assets: `NR_hex_res8_shp` · `NR_FloodFreq` · `Repeatarea` (จันอัด) · `ChanAtOSM` · `ChiangKri` · `ChiangKriFull`
สคริปต์: `region_buildings(_poly).js` · `basins_hydrosheds.js` · `sandbox_layers.js` (S1 Sandbox — ยังไม่ได้รัน) · `region_susceptibility.js` (พักไว้)
