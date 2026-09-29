-- ฐานข้อมูล Cloudflare D1 ของ LINE OA (ห้ามนำข้อมูลในตารางเหล่านี้ขึ้น repo)
CREATE TABLE IF NOT EXISTS users (
  user_id    TEXT PRIMARY KEY,           -- LINE userId (ข้อมูลส่วนบุคคล)
  tcode      TEXT NOT NULL,              -- รหัสตำบล 6 หลัก
  role       TEXT NOT NULL DEFAULT 'public',   -- public | adm | staff
  consent_at TEXT NOT NULL,              -- เวลาที่ยินยอม (ISO)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_tcode_role ON users (tcode, role);

-- รหัสเชิญสำหรับ ADM/เจ้าหน้าที่ (ทีมวิจัยสร้างด้วยคำสั่ง SQL ด้านล่าง ใช้ได้ครั้งเดียว)
CREATE TABLE IF NOT EXISTS invites (
  code     TEXT PRIMARY KEY,
  role     TEXT NOT NULL,                -- adm | staff
  tcode    TEXT,                         -- ถ้าระบุ บังคับตำบล
  note     TEXT,                         -- เช่น ชื่อหมู่บ้าน (ห้ามใส่ชื่อบุคคล/เบอร์)
  used_by  TEXT,
  used_at  TEXT
);

-- บันทึกการส่ง push เพื่อติดตามโควตา (ไม่เก็บ userId)
CREATE TABLE IF NOT EXISTS send_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  kind      TEXT NOT NULL,               -- D1 | A1 | ...
  tcode     TEXT,
  n         INTEGER NOT NULL,
  ok        INTEGER NOT NULL,
  sent_at   TEXT NOT NULL
);

-- ตัวอย่าง: สร้างรหัสเชิญ ADM ต.จันอัด
-- INSERT INTO invites (code, role, tcode, note) VALUES ('CHANAT-7K2Q', 'adm', '301010', 'ADM ต.จันอัด ชุดที่ 1');
-- ตรวจจำนวนผู้ใช้รายตำบล:
-- SELECT tcode, role, COUNT(*) FROM users GROUP BY tcode, role;
-- ตรวจโควตาที่ใช้เดือนนี้:
-- SELECT kind, SUM(n) FROM send_log WHERE sent_at >= strftime('%Y-%m-01','now') AND ok = 1 GROUP BY kind;

-- ===== รายงานสถานการณ์จากผู้ลงทะเบียน (เผยแพร่บนแผนที่ 30 วัน ไม่เปิดเผยตัวผู้รายงาน) =====
CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,               -- ไม่เผยแพร่
  tcode       TEXT NOT NULL,
  lat         REAL NOT NULL,
  lon         REAL NOT NULL,
  cats        TEXT NOT NULL,               -- คั่นด้วย , เช่น flood,road
  depth       TEXT,                        -- ankle | knee | waist | chest | over
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'unverified',   -- unverified | verified | hidden
  checked_by  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_time ON reports (created_at);

-- ===== คำขอความช่วยเหลือ (ไม่เผยแพร่ · เห็นเฉพาะ ADM ของตำบลและเจ้าหน้าที่) =====
CREATE TABLE IF NOT EXISTS help_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ref         TEXT NOT NULL UNIQUE,        -- รหัสอ้างอิงให้ผู้ขอ เช่น H-7K2Q9
  user_id     TEXT NOT NULL,
  tcode       TEXT NOT NULL,
  lat         REAL NOT NULL,
  lon         REAL NOT NULL,
  kind        TEXT NOT NULL,               -- evac | patient | food | medicine | other (คั่นด้วย ,)
  people      INTEGER,
  vulnerable  INTEGER NOT NULL DEFAULT 0,
  phone       TEXT,                        -- ลบอัตโนมัติ 90 วันหลังปิดเรื่อง
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'new', -- new | in_progress | done
  handled_by  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_help_tcode ON help_requests (tcode, status);
