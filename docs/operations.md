# คู่มือปฏิบัติงาน (runbook)

## สารบัญ
1. อัปเดตไฟล์ขึ้นเว็บ · 2. รัน workflow และอ่าน log · 3. ตรวจข้อมูลสด · 4. งาน GEE · 5. จัดการ secret · 6. แก้ปัญหา

## 1. อัปเดตไฟล์ขึ้นเว็บ (ผ่านหน้าเว็บ GitHub ไม่ต้องใช้ git)
1. แตก zip อัปเดต (เช่น `update-16.zip`) — ภายในมีโฟลเดอร์ตาม path จริง (`region/…`, `scripts/…`, `gee/…`)
2. github.com/sarochiiii/NR-flood-sdss → **Add file → Upload files** → ลาก**โฟลเดอร์ระดับบนสุด** (`region`, `scripts`) ไปวาง
   ไฟล์ชื่อซ้ำจะถูกเขียนทับ ไฟล์อื่นไม่ถูกแตะ
3. **Commit changes** → รอ Actions → `pages-build-deployment` ขึ้น ✓ (1–2 นาที)
4. เปิดเว็บ ถ้าเปลี่ยน JS/CSS ต้องเพิ่มเลข `?v=N` ใน `region/index.html` และ `region/lamchiangkrai.html` (ปัจจุบัน v=34)
   มิฉะนั้น browser จะใช้ไฟล์เก่าใน cache (GitHub Pages cache ~10 นาที) — ผู้ใช้กด Ctrl+F5 ได้ชั่วคราว

ข้อห้าม: อย่าลากโฟลเดอร์ `.github` ผ่าน Upload files (อาจไม่ติด) — แก้ workflow ด้วยการเปิดไฟล์แล้วกดดินสอ ✏️
ข้อห้าม: อย่าอัปโหลดไฟล์ใน `region/data/live/` ทับ (Actions เป็นผู้เขียน)

### ก่อนสร้างไฟล์อัปเดต (สำหรับผู้พัฒนา)
clone repo ล่าสุด → diff กับไฟล์ที่จะส่ง → ถ้ามีการแก้จากช่องทางอื่น ให้แก้ต่อจากรุ่นใน repo ไม่ใช่รุ่นในเครื่อง
ไฟล์ข้อมูล `.geojson` ไม่มีเลขรุ่น — หลังอัปโหลดให้ผู้ใช้กด Ctrl+F5 หนึ่งครั้ง
ตรวจว่าอัปโหลดแล้ว: ในโฟลเดอร์บน GitHub ดู "Latest commit" ของไฟล์ ต้องเป็น "Add files via upload" เวลาล่าสุด

## 2. รัน workflow และอ่าน log
Actions → **region-live** → **Run workflow** → เมื่อ ✓ คลิก **fetch** → ขยายขั้นที่ต้องการ

| ขั้น | ข้อความเมื่อสำเร็จ |
|---|---|
| ฝนรายตำบล | `ok: 26 ตำบล` |
| ThaiWater | `thaiwater: {'rain': 'ok', 'waterlevel': 'ok'} rain=… wl=…` |
| ThaiWater จังหวัด | `tw_province: {…ok…} {'rain3d': 73, 'rain7d': 73, 'dams': 39}` |
| GISTDA | `gistda: N เซลล์ทั้งจังหวัด · ในพื้นที่ X ไร่ (Y ตำบล)` |
| Sentinel-1 | `s1: อัปเดต YYYY-MM-DD` หรือ `s1: ภาพเดิม …` (ใช้เวลา >3 วินาทีถ้าสร้างภาพ) |
| ประวัติ | `history: +N จุด · สถานี … · อ่าง …` |

**workflow ขึ้น ✓ ไม่ได้แปลว่าทุกแหล่งสำเร็จ** (สคริปต์ออกแบบให้ไม่ล้ม) → ต้องดู log หรือไฟล์ผลลัพธ์

## 3. ตรวจข้อมูลสดโดยไม่ต้องเปิดเว็บ
เปิดไฟล์ใน repo → `region/data/live/<ไฟล์>` ดู `status`, `updated_at`, `message`
หรือ raw: `https://raw.githubusercontent.com/sarochiiii/NR-flood-sdss/main/region/data/live/<ไฟล์>` (cache ~5 นาที)
ในเว็บ: แผงขวา "สถานะข้อมูล" แสดง ปกติ / ข้อมูลเก่า (>6 ชม.) / ดึงไม่สำเร็จ / ยังไม่เชื่อมต่อ

## 4. งาน GEE (ทำเมื่อต้องการปรับข้อมูลอาคารหรือกริด)
1. Code Editor (code.earthengine.google.com, project ee-sarochineek) → วางสคริปต์จาก `gee/` → Run
2. Tasks → RUN → รอไฟล์ใน Google Drive
3. แปลงด้วยสคริปต์ใน `scripts/region/` (ต้องมี Python + shapely/pyshp/h3) หรือส่งให้ Claude แปลง
- อัปโหลด table asset: NEW → **Shape files** (ไม่ใช่ Image upload) เลือก .shp .shx .dbf .prj (.cpg) พร้อมกัน ไม่ต้อง zip ซ้อนโฟลเดอร์
- งานใหญ่ใน Console จะ timeout → ใช้ Export (batch) และ preview เฉพาะ 3–5 feature

## 5. จัดการ secret
Settings → Secrets and variables → Actions → New repository secret / ดินสอ ✏️ เพื่อ Update
- เปลี่ยน GISTDA key: สร้าง key ใหม่ → Update `GISTDA_API_KEY` → ยกเลิก key เก่า → Run workflow
- เปลี่ยน service account key: Cloud Console → IAM & Admin → Service Accounts → github-actions-ee → Keys → Add key (JSON)
  → วางทั้งไฟล์ใน `EE_SERVICE_ACCOUNT_KEY` → ลบ key เก่าและไฟล์ในเครื่อง
- ไม่ต้องเปิด billing/Free trial ของ Google Cloud (Earth Engine noncommercial ใช้ฟรี)

## 6. ตารางแก้ปัญหา
| อาการ | สาเหตุ | วิธีแก้ |
|---|---|---|
| เลเยอร์ขึ้น "ยังไม่ตั้ง … / รอ workflow รันรอบแรก" แต่ KPI มีค่า | หน้าเปิดก่อน workflow เขียนเสร็จ | กดสวิตช์ใหม่หรือ F5 (ระบบลองใหม่เองทุก 10 นาที) |
| แก้โค้ดแล้วหน้าเว็บไม่เปลี่ยน | browser cache | เพิ่ม `?v=N` · Ctrl+F5 · รอ pages-build ✓ |
| `gistda: not_configured` | ไม่มี/ชื่อ Secret ผิด | ตรวจชื่อ `GISTDA_API_KEY` |
| `gistda error: HTTPError` | key ผิด/ถูกยกเลิก | สร้าง key ใหม่ |
| `s1 error … serviceusage` | ขาด role Service Usage Consumer | IAM → Grant access |
| `s1 error … thumbnails.create` | role เป็น Viewer | เปลี่ยนเป็น Earth Engine Resource Writer → รอ 3–5 นาที |
| ThaiWater จังหวัดเรียกจาก browser ไม่ได้ | CORS | ต้องผ่าน Actions เท่านั้น |
| GEE upload: "No primary file found" | ไม่มี .shp หรือ zip มีโฟลเดอร์ซ้อน | เลือกไฟล์ .shp .shx .dbf .prj โดยตรง |
| GEE upload: "not a correct extension" | เลือกเมนู Image upload | ใช้ NEW → Shape files |
| แผนที่ฟ้าเบลอเมื่อซูมใกล้ | เรดาร์ฝน RainViewer ถูกขยายเกิน zoom 7 | ปิดชั้นเรดาร์ฝนเมื่อดูรายละเอียด |
| scheduled workflow หยุดรัน | ไม่มีความเคลื่อนไหว ~60 วัน / GitHub ปิด | Actions → enable workflow → Run |

| `remote: Internal Server Error` ตอน push | GitHub ขัดข้องชั่วคราว | ขั้น commit ลองซ้ำเอง 4 ครั้ง · รอบถัดไปส่งข้อมูลใหม่ |
| ชั้นข้อมูลยังเป็นแบบเดิมหลังอัปโหลด | ไฟล์ไม่ได้ขึ้น repo จริง / cache | ตรวจ Latest commit · Ctrl+F5 |

## 7. LINE OA (Worker chanat-line-webhook)
- แก้โค้ด: Cloudflare → Workers & Pages → chanat-line-webhook → Edit code → วางทั้งไฟล์ → Deploy (เลข "1" ที่แท็บ = คำเตือนชนิดข้อมูล ไม่ใช่ error)
- ตัวแปร: Settings → Variables and Secrets → Add variable → **ติ๊ก Secret** สำหรับค่าลับ (ไม่ติ๊ก = Text มองเห็นได้) · กล่องเหลือง "Update your Wrangler configuration" ไม่ต้องทำตาม
- Logs: Observability · ถ้า ADM ไม่ได้รับแจ้ง หา `multicast failed` (429 = โควตาหมด)
- เปิดให้ OA เข้ากลุ่ม: manager.line.biz (เข้าด้วยบัญชี LINE ที่ดูแล OA หรือบัญชีธุรกิจที่เป็นอีเมล) → ตั้งค่า → ตั้งค่าบัญชี → เข้าร่วมแชทกลุ่ม → ยอมรับคำเชิญ · ผู้เชิญต้องเป็นเพื่อนกับ OA · ควรขออนุญาตสมาชิกกลุ่มก่อน
