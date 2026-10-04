# ย้ายงานไปทำใน Claude Code

## 1. เตรียมเครื่อง (ครั้งเดียว)
- ติดตั้ง Git, Node.js 20+, Python 3.11+ และ Claude Code (หรือใช้ Claude Code ในแอป Claude Desktop)
- `git clone https://github.com/sarochiiii/NR-flood-sdss.git` แล้ว `cd NR-flood-sdss`
- `pip install shapely pyproj pyshp openpyxl` (สคริปต์สร้างข้อมูล) · `npm i -D jsdom leaflet typescript` (ทดสอบ)

## 2. นำไฟล์ชุดนี้เข้า repo
คัดลอก `CLAUDE.md`, `.gitignore`, `line/kv/`, `tests/`, `docs/` ไปที่รากของ repo แล้ว
```
git add CLAUDE.md .gitignore line/kv tests docs
git commit -m "docs: CLAUDE.md + worker LINE (KV v4.4) + tests"
git pull --rebase && git push
```
`line/kv/worker.js` คือโค้ด Worker ที่ใช้จริง (ไม่มีค่าลับ) — เก็บใน repo เพื่อให้ Claude Code แก้และทดสอบได้

## 3. เปิด Claude Code ในโฟลเดอร์ repo
Claude Code อ่าน `CLAUDE.md` อัตโนมัติ · ตัวอย่างคำสั่งเริ่มงาน:
- "อ่าน docs/backlog.md แล้วเสนอลำดับงานสัปดาห์นี้"
- "เพิ่มให้ ADM ยืนยัน/ปิดรายงานเหตุใน line/kv/worker.js แล้วรัน tests/worker_kv.test.mjs"

## 4. สิ่งที่เปลี่ยนจากการทำงานในแชท
| เดิม (แชท) | ใน Claude Code |
|---|---|
| ดาวน์โหลด update-N.zip แล้วลากไฟล์ขึ้น GitHub | Claude Code แก้ไฟล์ในเครื่อง → `git commit` → `git push` (ตรวจ diff ก่อน push ทุกครั้ง) |
| ส่งภาพหน้าจอ log | `gh run list` / `gh run view --log` (ติดตั้ง GitHub CLI) |
| วางโค้ด Worker ใน dashboard | ยังทำแบบเดิมได้ หรือ `npx wrangler deploy` จาก `line/kv/` (ต้อง `npx wrangler login` และสร้าง wrangler.toml จาก .example) |

## 5. ข้อควรระวัง
- **ห้ามนำโฟลเดอร์ `sandbox-private` หรือไฟล์ key รหัสประจำบ้านเข้าโฟลเดอร์ repo** (`.gitignore` กันไว้ชั้นหนึ่งแล้ว แต่ไม่ควรวางไว้ในนั้น) — เก็บแยกโฟลเดอร์
- ค่าลับ (LINE token, STATS_KEY ฯลฯ) อย่าวางในแชทของ Claude Code — ตั้งใน Cloudflare/GitHub Secrets หรือ `wrangler secret put`
- Actions commit ข้อมูลทุกชั่วโมง: `git pull --rebase` ก่อน push เสมอ
