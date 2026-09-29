# ตั้งค่า LINE OA "เฝ้าระวังน้ำ โนนไทย–โนนสูง" — ระยะ P0 + P1

ผลลัพธ์เมื่อทำครบ: ผู้ใช้เพิ่มเพื่อน → ได้ข้อความต้อนรับ → ลงทะเบียนตำบล (LIFF) →
กดเมนูดูสถานการณ์ตำบลตนเอง / ส่งตำแหน่งดูสถานการณ์ ณ จุดนั้น / เบอร์ฉุกเฉิน ·
ADM ที่ใช้รหัสเชิญได้รับสรุปประจำวัน 07:00 น.

ไฟล์ที่ใช้: `line/worker.js` · `line/schema.sql` · `line/richmenu_2500x1686.png` · `region/liff/register.html`

> ใช้บัญชีอีเมลของโครงการ ไม่ใช่บัญชีส่วนตัว และเพิ่มผู้ดูแลอย่างน้อย 2 คนทุกระบบ
> ห้ามส่ง Channel secret / access token / ADMIN_KEY ทางแชท ใส่ใน Cloudflare เท่านั้น

---

## ส่วน A · LINE (ไม่ต้องเขียนโค้ด)

**A1. สร้างบัญชี LINE OA**
manager.line.biz → สร้างบัญชี → ชื่อ `เฝ้าระวังน้ำ โนนไทย–โนนสูง` (หรือชื่อที่ทีมตกลง) →
หมวดหมู่ หน่วยงานการศึกษา/สาธารณะ · ภายหลังขอ Verified badge ด้วยเอกสารของมหาวิทยาลัย (เพิ่มความน่าเชื่อถือช่วงเกิดภัย)

**A2. เปิด Messaging API**
OA Manager → ตั้งค่า → Messaging API → เปิดใช้ → สร้าง Provider ชื่อ `NRRU Flood SDSS`
⚠️ ต้องใช้ Provider เดียวกันในข้อ A5 มิฉะนั้นรหัสผู้ใช้จาก LIFF กับจาก LINE OA จะไม่ตรงกัน

**A3. เก็บค่าจาก LINE Developers** (developers.line.biz → Provider → channel Messaging API)
- แท็บ Basic settings → **Channel secret**
- แท็บ Messaging API → Channel access token (long-lived) → **Issue**

**A4. ตั้งค่าการตอบกลับ** (OA Manager → ตั้งค่า → การตอบกลับ)
แชท: ปิด (หรือเปิดถ้ามีเจ้าหน้าที่ตอบ) · Webhook: **เปิด** · ข้อความทักทาย: **ปิด** · ข้อความตอบกลับอัตโนมัติ: **ปิด**
(Worker เป็นผู้ส่งข้อความต้อนรับและตอบเมนู)

**A5. สร้าง LIFF สำหรับหน้าลงทะเบียน**
LINE Developers → Provider เดียวกัน → Create channel → **LINE Login** → ชื่อ `NRRU Flood LIFF`
→ แท็บ LIFF → Add:
- Size: **Full** · Endpoint URL: `https://sarochiiii.github.io/NR-flood-sdss/region/liff/` (**โฟลเดอร์** — ทุกหน้าใช้ LIFF เดียวกัน เปิดด้วย `https://liff.line.me/<LIFF ID>/<ชื่อหน้า>.html`)
- Scopes: **openid** · Bot link feature: **On (Aggressive)** (ชวนเพิ่มเพื่อน OA)
- จด **LIFF ID** (เช่น `2000000000-AbCdEfGh`) และ **Channel ID** ของ LINE Login (แท็บ Basic settings)
- ⚠️ เปลี่ยนสถานะ channel จาก Developing เป็น **Published** มิฉะนั้นเฉพาะผู้ดูแลเท่านั้นที่เปิด LIFF ได้

---

## ส่วน B · Cloudflare (ฟรี)

**B1.** สมัคร dash.cloudflare.com (อีเมลโครงการ)

**B2. ฐานข้อมูล D1** → Storage & Databases → D1 → Create → ชื่อ `line-hub-db` →
แท็บ Console → วางเนื้อหา `schema.sql` → Execute

**B3. Worker** → Workers & Pages → Create → Worker → ชื่อ `line-hub` → Deploy →
**Edit code** → ลบโค้ดตัวอย่าง วางเนื้อหา `worker.js` ทั้งไฟล์ → Deploy

**B4. Bindings** → Worker → Settings → Bindings → Add → D1 database → Variable name `DB` → `line-hub-db`

**B5. Variables and Secrets** (Settings → Variables and Secrets → Add)
| ชื่อ | ชนิด | ค่า |
|---|---|---|
| `LINE_CHANNEL_SECRET` | Secret | จาก A3 |
| `LINE_CHANNEL_TOKEN` | Secret | จาก A3 |
| `LINE_LOGIN_CHANNEL_ID` | Text | Channel ID ของ LINE Login (A5) |
| `LIFF_ID` | Text | LIFF ID (A5) |
| `ADMIN_KEY` | Secret | ตั้งเอง ยาว ≥ 24 ตัวอักษร (ใช้ทดสอบ) |

**B6. Cron** → Settings → Triggers → Cron Triggers → Add → `0 0 * * *` (00:00 UTC = 07:00 น.)

**B7.** จด URL ของ Worker เช่น `https://line-hub.<ชื่อบัญชี>.workers.dev`

---

## ส่วน C · เชื่อมต่อ

**C1. Webhook** → LINE Developers → channel Messaging API → แท็บ Messaging API →
Webhook URL = `https://line-hub.<ชื่อบัญชี>.workers.dev/webhook` → **Verify** (ต้องขึ้น Success) → Use webhook: **On**

**C2. หน้า LIFF** → GitHub repo → เปิด `region/liff/config.js` → ดินสอ ✏️ → แก้ 2 ค่า
```js
LIFF_ID: 'ใส่ LIFF ID',
API: 'https://line-hub.<ชื่อบัญชี>.workers.dev'
```
→ Commit (ค่าทั้งสองไม่ใช่ความลับ) · ใช้ร่วมกันทุกหน้า: register · report · help · staff และปุ่มบนเว็บหลัก

**C3. Rich menu** → OA Manager → หน้าหลัก → ริชเมนู → สร้าง
- เทมเพลต: **ขนาดใหญ่ 6 ช่อง** · อัปโหลดรูป `richmenu_2500x1686.png` · ข้อความแถบเมนู: `เมนู` · แสดงเป็นค่าเริ่มต้น: เปิด
| ช่อง | ประเภท | ค่า |
|---|---|---|
| A สถานการณ์ตำบลฉัน | ข้อความ | `สถานการณ์ตำบลฉัน` |
| B แผนที่ | ลิงก์ | `https://sarochiiii.github.io/NR-flood-sdss/region/` |
| C รายงาน | ลิงก์ | `https://liff.line.me/<LIFF ID>/report.html` |
| D ขอความช่วยเหลือ | ลิงก์ | `https://liff.line.me/<LIFF ID>/help.html` |
| E เบอร์ฉุกเฉิน | ข้อความ | `เบอร์ฉุกเฉิน` |
| F ลงทะเบียน | ลิงก์ | `https://liff.line.me/<LIFF ID>/register.html` |
คำว่า `ศูนย์พักพิง` และ `ประกาศล่าสุด` ยังพิมพ์ถามได้ (ระบบตอบให้) แม้ไม่มีปุ่ม

**C4. ข้อมูลที่ทีมต้องเติมใน `worker.js`** (Edit code → Deploy)
`EMERGENCY` เบอร์ อบต./อำเภอ ที่ยืนยันแล้ว · `SHELTERS` ศูนย์พักพิงตามแผนของ อบต. — ห้ามเดา

---

## ส่วน D · ทดสอบ (ใช้ทีมงาน 2–3 คนก่อนเปิดจริง)

1. สแกน QR ของ OA → ได้ข้อความต้อนรับพร้อมปุ่ม "ลงทะเบียนตำบล"
2. ลงทะเบียน ต.จันอัด → กดเมนู A → ได้การ์ดสถานการณ์ (หัวสีตามสถานะตลิ่งของสถานีใกล้สุด)
3. ส่ง "ตำแหน่ง" (+ → Location) จุดในโนนไทย → ได้การ์ดของตำบลนั้น · จุดนอกพื้นที่ → แจ้งว่านอกพื้นที่
4. สร้างรหัสเชิญ (D1 Console):
   `INSERT INTO invites (code, role, tcode, note) VALUES ('CHANAT-7K2Q','adm','301010','ทดสอบ');`
   → ลงทะเบียนใหม่พร้อมรหัส → ต้องขึ้น "ADM"
5. ทดสอบสรุปประจำวันทันที (PowerShell บน Windows):
   `Invoke-WebRequest -Method POST -Uri https://line-hub.<ชื่อบัญชี>.workers.dev/admin/daily -Headers @{"x-admin-key"="<ADMIN_KEY>"}`
6. เลิกติดตาม OA → ตรวจ D1: `SELECT * FROM users;` แถวของผู้ทดสอบต้องหายไป
7. ปัญหา: Worker → Logs (Observability) ดูข้อความ error · Webhook Verify ไม่ผ่าน = ตรวจ URL `/webhook` และ Channel secret

---

## โควตาและแพ็กเกจ
- ข้อความตอบกลับ (เมนู/ส่งตำแหน่ง) **ไม่นับโควตา** · สรุปประจำวันและการเตือน (push) นับตามจำนวนผู้รับ
- ช่วงทดสอบใช้แพ็กเกจ Free (300 ข้อความ/เดือน) ได้ · ก่อนเปิดให้ ADM ทั้งสองอำเภอ อัปเกรดเป็น Basic
- ตรวจการใช้: `SELECT kind, SUM(n) FROM send_log WHERE sent_at >= strftime('%Y-%m-01','now') AND ok=1 GROUP BY kind;`

## ข้อมูลส่วนบุคคล
D1 เก็บ userId ตำบล บทบาท และเวลาที่ยินยอม · ลบอัตโนมัติเมื่อเลิกติดตามหรือกด "ลบข้อมูลของฉัน"
ห้าม export ตาราง `users` ออกนอก Cloudflare · จำกัดสิทธิ์บัญชี Cloudflare เฉพาะผู้ดูแล


---

## ส่วน E · รายงานสถานการณ์และขอความช่วยเหลือ (เพิ่ม 29 ก.ย. 69)

**ต้องทำเพิ่มหลังอัปเดต worker.js:** D1 Console → วางส่วน `reports` และ `help_requests` จาก `schema.sql` → Execute
(ใช้ `CREATE TABLE IF NOT EXISTS` รันซ้ำทั้งไฟล์ได้ ไม่ลบข้อมูลเดิม)

| หน้า (LIFF) | ใครใช้ | ทำอะไร |
|---|---|---|
| `report.html` | ผู้ลงทะเบียนทุกคน | ปักหมุด · หมวด (น้ำท่วม ถนน ไฟดับ ดินสไลด์ ต้นไม้ อาคาร อื่น ๆ) · ระดับน้ำ · รายละเอียด → **แผนที่สาธารณะ 30 วัน ไม่แสดงผู้รายงาน** |
| `help.html` | ผู้ลงทะเบียนทุกคน | ปุ่มโทร 1669/1784/191 · ตำแหน่ง · ประเภท · จำนวนคน · กลุ่มเปราะบาง · เบอร์ติดต่อ → **ไม่เผยแพร่** · push LINE ถึง ADM ของตำบล + เจ้าหน้าที่ทั้งหมด · ได้รหัส H-xxxxx ดูสถานะได้ |
| `staff.html` | role `adm` (ตำบลตน) · `staff` (ทุกตำบล) | เปลี่ยนสถานะคำขอ (รับเรื่อง/กำลังช่วย/เสร็จสิ้น) · ยืนยัน/ซ่อนรายงาน |

API สาธารณะ (ไม่มีข้อมูลส่วนบุคคล): `GET /api/reports` · `GET /api/help/summary` (จำนวนคำขอที่เปิดรายตำบล)
จำกัด: รายงาน 10 ครั้ง/ชม./คน · คำขอ 3 ครั้ง/ชม./คน · ตำแหน่งต้องอยู่ใน 26 ตำบล
การเก็บข้อมูล (cron ทุกวัน): ลบรายงานเกิน 30 วัน · ลบเบอร์โทรและรายละเอียดของคำขอที่ปิดแล้วเกิน 90 วัน

**ทดสอบ:** ลงทะเบียน 1 บัญชีเป็นประชาชน + 1 บัญชีด้วยรหัสเชิญ ADM ตำบลเดียวกัน → ส่งคำขอจากบัญชีแรก → บัญชี ADM ต้องได้ LINE แจ้ง → เปิดลิงก์ staff.html เปลี่ยนสถานะ → บัญชีแรกเปิด help.html เห็นสถานะใหม่
**ข้อสำคัญ:** ถ้าตำบลนั้นยังไม่มี ADM ในระบบ คำขอจะถึงเฉพาะเจ้าหน้าที่ และหน้าจอแจ้งผู้ขอให้โทร 1784 — ควรมี ADM ครบทุกตำบลก่อนเปิดใช้จริง
