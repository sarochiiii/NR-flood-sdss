"""ดึงฝนรายชั่วโมงจาก Open-Meteo ที่จุดตัวแทนของทุกตำบล แล้วเขียน region/data/live/rain_region.json

ค่าที่ได้เป็นผลจากแบบจำลองเชิงตัวเลข (NWP) ไม่ใช่สถานีวัดฝนจริง
เมื่อดึงไม่สำเร็จ สคริปต์คงข้อมูลเดิมไว้และไม่ทำให้ workflow ล้ม
"""
import json, pathlib, datetime as dt, urllib.request, urllib.parse

ROOT = pathlib.Path(__file__).resolve().parents[2] / "region"
OUT = ROOT / "data/live/rain_region.json"
TZ = dt.timezone(dt.timedelta(hours=7))


def write(obj):
    OUT.write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")


def windows(times, values, now):
    """รวมฝนย้อนหลัง 24 ชม., 7 วัน และคาดการณ์ 24 ชม. ข้างหน้า นับจากชั่วโมงปัจจุบัน"""
    past24 = past7d = next24 = 0.0
    for t, v in zip(times, values):
        if v is None:
            continue
        h = (dt.datetime.fromisoformat(t).replace(tzinfo=TZ) - now).total_seconds() / 3600
        if -24 < h <= 0: past24 += v
        if -168 < h <= 0: past7d += v
        if 0 < h <= 24: next24 += v
    return round(past24, 1), round(past7d, 1), round(next24, 1)


def main():
    tambon = json.loads((ROOT / "data/tambon.geojson").read_text(encoding="utf-8"))["features"]
    pts = [f["properties"] for f in tambon]
    q = urllib.parse.urlencode({
        "latitude": ",".join(str(p["lat"]) for p in pts),
        "longitude": ",".join(str(p["lon"]) for p in pts),
        "hourly": "precipitation", "past_days": 7, "forecast_days": 2,
        "timezone": "Asia/Bangkok",
    })
    try:
        with urllib.request.urlopen(f"https://api.open-meteo.com/v1/forecast?{q}", timeout=60) as r:
            data = json.loads(r.read())
        data = data if isinstance(data, list) else [data]
        now = dt.datetime.now(TZ).replace(minute=0, second=0, microsecond=0)
        rows = []
        for p, d in zip(pts, data):
            a, b, c = windows(d["hourly"]["time"], d["hourly"]["precipitation"], now)
            rows.append({"tcode": p["tcode"], "rain_24h_mm": a, "rain_7d_mm": b, "rain_next24h_mm": c})
        write({"status": "ok", "updated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
               "source": "Open-Meteo Forecast API", "tambon": rows})
        print(f"ok: {len(rows)} ตำบล")
    except Exception as err:
        prev = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
        write({"status": "error", "message": str(err)[:200], "updated_at": prev.get("updated_at"),
               "source": "Open-Meteo Forecast API", "tambon": prev.get("tambon", [])})
        print(f"error: {err}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
