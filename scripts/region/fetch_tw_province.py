"""ดึงข้อมูลระดับจังหวัดจาก ThaiWater (endpoint เดียวกับ nakhonratchasima.thaiwater.net)

API ตั้ง CORS ให้เฉพาะ origin ของเว็บจังหวัด เบราว์เซอร์จากเว็บเราจึงเรียกตรงไม่ได้
ต้องดึงผ่าน GitHub Actions (ฝั่ง server ไม่ติด CORS) แล้วเก็บเป็นไฟล์ใน repo

รอบแรก: เก็บ response ดิบไว้ที่ region/data/live/raw/ เพื่อตรวจโครงสร้างก่อนเขียน parser
"""
import json, urllib.request
from _common import LIVE, now_iso

BASE = "https://api-v3.thaiwater.net/api/v1/thaiwater30/provinces/"
ENDPOINTS = {
    "rain1d": "rain1d?province_code=30",
    "rain3d": "rain3d?province_code=30",
    "rain7d": "rain7d?province_code=30",
    "dam": "dam?province_id=30",
}
RAW = LIVE / "raw"


def main():
    RAW.mkdir(exist_ok=True)
    for name, ep in ENDPOINTS.items():
        out = {"fetched_at": now_iso(), "url": BASE + ep}
        try:
            req = urllib.request.Request(BASE + ep, headers={"User-Agent": "NRRU-Region-SDSS/1.0", "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=90) as r:
                out.update(status="ok", http=r.status, body=json.loads(r.read()))
        except Exception as err:
            out.update(status="error", message=f"{type(err).__name__}: {str(err)[:150]}")
        (RAW / f"{name}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
        print(name, out["status"], out.get("http", ""), out.get("message", ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
