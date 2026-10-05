# CLAUDE.md — SDSS-ChanAT (repo `sarochiiii/NR-flood-sdss`)

ระบบสนับสนุนการตัดสินใจเชิงพื้นที่ (SDSS) ด้านน้ำท่วม/ภัยแล้ง ตำบลจันอัด อ.โนนสูง จ.นครราชสีมา (ขยายได้ 26 ตำบล อ.โนนไทย–โนนสูง)
โครงการวิจัยย่อยที่ 2 มรภ.นครราชสีมา · เจ้าของ: Sarochinee Kaewthanee (GitHub `sarochiiii`)
**ไม่ใช่ระบบประกาศเตือนภัยทางการ** (อำนาจ ปภ.) — ทุกหน้า/ข้อความต้องมี disclaimer และเวลาที่ข้อมูลถูกวัด

ตอบผู้ใช้เป็นภาษาไทย ศัพท์เทคนิคใช้อังกฤษ · ผู้ใช้เป็นนักภูมิสารสนเทศ ไม่ใช่นักพัฒนาเว็บ — อธิบายขั้นตอนที่ต้องทำนอก repo (Cloudflare, LINE) เป็นการคลิกทีละขั้น
คู่มือละเอียด: `docs/` (HANDOVER, architecture, data-sources, config-logic, operations, governance, line-oa, sandbox, backlog, changelog)

## ส่วนประกอบ
| ส่วน | ที่อยู่ | deploy |
|---|---|---|
| เว็บสาธารณะ | `region/` → https://sarochiiii.github.io/NR-flood-sdss/region/ | push `main` → GitHub Pages |
| ข้อมูลสด | `scripts/region/*.py` → `region/data/live/` | `.github/workflows/region-live.yml` ทุกชั่วโมง :15 |
| LINE OA "จันอัดบ้านฉัน" (@142uxpzr) — **ใช้งานจริง** | `line/kv/worker.js` (v4.8, KV) | Cloudflare Worker `chanat-line-webhook` (วางผ่าน dashboard หรือ wrangler) |
| LINE ระยะสอง (D1 + LIFF) — **ยังไม่ใช้** | `line/worker.js`, `line/schema.sql`, `region/liff/*` | — |
| Sandbox บ้านด่านติง (ข้อมูลครัวเรือน) | **ไม่อยู่ใน repo** — โฟลเดอร์ `sandbox-private` แยก | Cloudflare Pages + Access |

## โครงสร้างสำคัญ
```
region/index.html            หน้าหลัก (หัว SDSS-ChanAT) · lamchiangkrai.html หน้าลำเชียงไกร
region/js/region.js          แผนที่ ขอบเขตตำบล โหมดสี การ์ดตำบล T (basinT)
region/js/report.js          รายงานสถานการณ์สำหรับ LINE (situationReport) — **ต้องเหมือนใน line/kv/worker.js**
region/js/layers.js          ชั้นข้อมูลทั้งหมด (GROUPS ตามห่วงโซ่ ①ฝน ②อ่าง/ลำน้ำ ③น้ำท่วม ④ผลกระทบ พื้นฐาน) KPI รายการจับตา ปุ่ม LINE
region/config.json           เกณฑ์ทั้งหมด (rain, water, bank, t_rules[verified:false], sandbox)
region/liff/config.js        OA_ID '@142uxpzr' · WEBHOOK (Worker) · LIFF_ID/API (placeholder ระยะสอง)
region/data/                 tambon/amphoe (NR_admin3) · basins (HydroBASINS) · structures (ปภ./อบต. 64 จุด) · buildings/bldg (Open Buildings) · rid_stations
region/data/live/            เขียนโดย Actions เท่านั้น — ห้ามแก้มือ ห้าม commit การแก้ไฟล์นี้จากเครื่อง
scripts/region/              fetch_* (ข้อมูลสด) · build_*/import_*/merge_* (สร้างข้อมูลคงที่ครั้งเดียว) · compute_risk.py (T ฝั่ง Python)
gee/                         สคริปต์ Earth Engine (project ee-sarochineek)
line/kv/worker.js            Worker ที่ใช้จริง · line/worker.js + schema.sql = ระบบ D1 ระยะสอง
docs/                        คู่มือส่งมอบ
```

## กฎที่ห้ามละเมิด
1. **ห้ามมีข้อมูลรายบุคคล/รายครัวเรือนใน repo** (PPPConnext, พิกัดบ้าน Sandbox, รหัสประจำบ้าน, เบอร์โทร, LINE userId) — repo สาธารณะ
2. **ห้าม commit secret** — LINE secret/token, STATS_KEY, GISTDA key, EE service account อยู่ใน GitHub Secrets / Cloudflare Secrets เท่านั้น · ห้ามพิมพ์ค่าเหล่านี้ใน log/คำตอบ
3. **แก้ JS/CSS ต้องเพิ่ม `?v=N`** ใน `region/index.html` และ `region/lamchiangkrai.html` (ทุก `<script src>`/`<link>` รวม `liff/config.js`) — ปัจจุบัน **v=38**
4. **รายงานสถานการณ์มี 2 ที่** `region/js/report.js` และ `line/kv/worker.js` (ระหว่าง `// >>> situationReport` … `// <<<`) — แก้ที่เว็บแล้วคัดลอกทั้งฟังก์ชัน · `tests/report.test.mjs` ตรวจว่าตรงกัน
5. **ตรรกะ T มี 2 ที่** `region/js/region.js` (basinT) และ `scripts/region/compute_risk.py` (basin_t) — แก้คู่กันเสมอ
6. **อย่าเดา** field ของ API ภายนอก ลำดับสถานี หรือความสัมพันธ์ต้นน้ำ–ท้ายน้ำ — ตรวจกับข้อมูลจริง (บทเรียน: ลำเชียงไกรบรรจบมูลระหว่าง **M.194–M.195** ไม่ใช่ M.2A–M.194 เพราะลำตะคองบรรจบก่อน M.194)
7. เกณฑ์ที่ยังไม่ยืนยันกับชลประทาน/ปภ. ต้องคง `verified: false` และแสดงป้ายบนหน้าเว็บ
8. LINE: "ติดต่อ อบต."/"ขอความช่วยเหลือ" **ปิดชั่วคราว** (`HELP_ENABLED = false`) · รายงานเหตุต้องแชร์ตำแหน่ง ไม่ส่งถึง ADM แสดงเป็นจุดแดงกระพริบบนแผนที่ · ADM ต้องลงทะเบียนด้วย **รหัสเชิญ** (KV `invite:<CODE>`) · ในกลุ่ม LINE ตอบเฉพาะ 3 คำสั่ง ไม่อ่าน/เก็บข้อความอื่น · `/api/reports` สาธารณะต้องไม่มีข้อความรายละเอียด/ผู้รายงาน และปัดตำแหน่ง ~100 ม.
9. โควตา LINE Free 300 push/เดือน (กลุ่มนับตามจำนวนสมาชิก) — ห้ามเพิ่ม push/broadcast โดยไม่คำนวณโควตา · reply ไม่นับโควตา

## แหล่งข้อมูล (ตรวจแล้ว)
ThaiWater public (`rain_24h`, `waterlevel_load` CORS เปิด) · ThaiWater provinces (`rain3d/7d`, `dam` — CORS ปิด ใช้ใน Actions) ·
กรมชลประทาน `POST app.rid.go.th/reservoir/api/rsvmiddles` (form date/region=ne/status=1, ตัวเลขมีจุลภาค, CORS *) ·
GISTDA flood 7days (header API-Key, H3 res9, `links[]` มี key — ห้ามเก็บ) · GloFAS ผ่าน `flood-api.open-meteo.com` · Open-Meteo forecast · ECMWF IFS 0.25° (`models=ecmwf_ifs025` → `live/ecmwf.json` ต.จันอัด ทุก 3 ชม.) ·
RainViewer (zoom ≤ 7, past 2 ชม.) · OSM Overpass (ลำน้ำ/แหล่งน้ำ — เข้าได้จาก Actions เท่านั้น workflow `osm-rivers`) · Earth Engine S1 (service account) · Open Buildings V3 · HydroBASINS L12
รหัสสำคัญ: ต.จันอัด `301010` · อ่างลำเชียงไกรตอนบน `rsv300` / ตอนล่าง `rsv292` · สถานี M.188A (ท้ายจันอัด), M.206, M.2A, M.164, M.194, M.195

## การทดสอบก่อน commit
- JS: `node --check region/js/*.js` · ทดสอบหน้าเว็บด้วย jsdom + leaflet (mock `fetch` ชี้ไปไฟล์ใน `region/data`) — ดู `tests/README.md`
- รายงาน: `node --no-warnings tests/report.test.mjs` (ฟังก์ชันเว็บ = worker · สร้างข้อความจาก `region/data/live`)
- Worker: `node --no-warnings tests/worker_kv.test.mjs` (mock KV + LINE API) · type check: `npx tsc --allowJs --checkJs --noEmit --target es2022 --lib es2022,dom line/kv/worker.js`
- Python: รันสคริปต์ใน `scripts/region/` ได้แบบ offline — ต้องจบ exit 0 แม้เครือข่ายล้มเหลว (เขียน `status: error` แทน)
- ข้อมูลภูมิสารสนเทศ: ตรวจจำนวน feature, พิกัดอยู่ใน 26 ตำบล, พื้นที่ลุ่มเทียบ D.A กรมชลประทาน

## วิธีทำงานกับ repo นี้
- `git pull` ก่อนเริ่มทุกครั้ง — Actions commit ข้อมูลสดทุกชั่วโมง (`data(region): อัปเดตข้อมูลสด`) · ใช้ `git pull --rebase` ก่อน push
- commit เฉพาะไฟล์ที่ตั้งใจแก้ อย่า `git add -A` ถ้ามี `region/data/live/` เปลี่ยนในเครื่อง
- Worker: แก้ `line/kv/worker.js` → deploy ด้วย `npx wrangler deploy` (ต้องมี `wrangler.toml` + login) หรือให้ผู้ใช้วางใน dashboard · bindings: KV `USERS`→`LINE_USERS` · secrets `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_TOKEN`, `STATS_KEY` · var `DAILY_GROUP_PUSH` · cron `0 0 * * *`

## สถานะและงานถัดไป (ณ 3 ต.ค. 2569) — รายละเอียด `docs/backlog.md`
- ผู้ใช้ LINE OA: เป้าหมาย 100 คน (ตัวชี้วัดข้อเสนอโครงการ) · ADM ที่มีรหัสเชิญยังน้อย · ติดตามด้วย `/stats?key=…`
- ระยะสั้น: ADM ยืนยัน/ปิดรายงาน ("น้ำลดแล้ว") · ความลึกเป็น ซม. · ฝน 3 ชม. ข้างหน้า · รายชื่อหมู่บ้าน/เบอร์ อบต. ใน worker
- ระยะสอง: รวม KV worker เข้ากับระบบ D1 + LIFF (ฟอร์มปักหมุด, ขอความช่วยเหลือแยกพร้อมสถานะ, หน้าจัดการ) + ย้ายข้อมูล KV
- Sandbox: Cloudflare Access + อัปโหลด sandbox-private · สถานะถนน/เส้นทางอพยพ (ต้องได้ศูนย์พักพิงจาก อบต.) · S1 GEE `gee/sandbox_layers.js`
- ข้อมูล: อัปโหลด `region/data/rid_rsv/` · ยืนยันเกณฑ์กับชลประทาน · สถานี local (กำลังติดตั้ง) · ตรวจ GloFAS กับ M.188A
