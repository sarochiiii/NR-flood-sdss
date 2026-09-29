"""ฝนเฉลี่ยลุ่มน้ำ (ถ่วงน้ำหนักตามพื้นที่ลุ่มย่อย HydroBASINS) จาก Open-Meteo — ฝนที่ผ่านมาและคาดการณ์

อ่านจุดตัวแทนจาก region/data/basin_points.json (สร้างโดย build_basins.py)
ผลลัพธ์: region/data/live/basin_rain.json
  basins.{LCK, MUN_UP}: past24, past72, past7d, next24, next72 (มม. เฉลี่ยทั้งลุ่ม), n_points, area_km2
ค่าจากแบบจำลองเชิงตัวเลข ไม่ใช่สถานีวัด · ยังไม่ใช้เป็นเกณฑ์ T (ยังไม่มีเกณฑ์ฝนเชิงพื้นที่ที่ยืนยันแล้ว)
"""
import json, urllib.request, urllib.parse, datetime as dt
from _common import ROOT, now_iso, read, write

TZ = dt.timezone(dt.timedelta(hours=7))
OUT = "basin_rain.json"


def main():
    pts = json.loads((ROOT / "data/basin_points.json").read_text(encoding="utf-8"))
    prev = read(OUT)
    try:
        q = urllib.parse.urlencode({"latitude": ",".join(str(p["lat"]) for p in pts), "longitude": ",".join(str(p["lon"]) for p in pts),
                                    "hourly": "precipitation", "past_days": 7, "forecast_days": 3, "timezone": "Asia/Bangkok"})
        with urllib.request.urlopen(f"https://api.open-meteo.com/v1/forecast?{q}", timeout=120) as r:
            data = json.loads(r.read())
        data = data if isinstance(data, list) else [data]
        now = dt.datetime.now(TZ).replace(minute=0, second=0, microsecond=0)
        acc = {}
        for p, d in zip(pts, data):
            s = {"past24": 0.0, "past72": 0.0, "past7d": 0.0, "next24": 0.0, "next72": 0.0}
            for t, v in zip(d["hourly"]["time"], d["hourly"]["precipitation"]):
                if v is None:
                    continue
                h = (dt.datetime.fromisoformat(t).replace(tzinfo=TZ) - now).total_seconds() / 3600
                if -24 < h <= 0: s["past24"] += v
                if -72 < h <= 0: s["past72"] += v
                if -168 < h <= 0: s["past7d"] += v
                if 0 < h <= 24: s["next24"] += v
                if 0 < h <= 72: s["next72"] += v
            a = acc.setdefault(p["basin"], {"w": 0.0, "n": 0, **{k: 0.0 for k in s}})
            a["w"] += p["w"]; a["n"] += 1
            for k, v in s.items():
                a[k] += v * p["w"]
        basins = {b: {**{k: round(a[k] / a["w"], 1) for k in ("past24", "past72", "past7d", "next24", "next72")},
                      "n_points": a["n"], "area_km2": round(a["w"])} for b, a in acc.items()}
        write(OUT, {"status": "ok", "updated_at": now_iso(), "source": "Open-Meteo (แบบจำลอง) · ถ่วงน้ำหนักพื้นที่ลุ่มย่อย HydroBASINS L12",
                    "basins": basins}, indent=None)
        print("basin rain:", basins)
    except Exception as err:
        prev.update({"status": "error", "message": f"{type(err).__name__}: {str(err)[:150]}"})
        write(OUT, prev, indent=None)
        print("basin rain error:", type(err).__name__)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
