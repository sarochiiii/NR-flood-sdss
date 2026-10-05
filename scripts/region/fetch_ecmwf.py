"""พยากรณ์อากาศ ECMWF IFS (0.25°) ที่จุดกึ่งกลาง ต.จันอัด ผ่าน Open-Meteo — ไม่ต้องใช้ key

GET https://api.open-meteo.com/v1/forecast?models=ecmwf_ifs025&hourly=precipitation&daily=precipitation_sum,temperature_2m_max,temperature_2m_min
ECMWF ออกรอบละ 6 ชม. → ดึงไม่เกินทุก 3 ชม. (ข้ามถ้ารอบก่อนสำเร็จและยังไม่ครบ)
ผลลัพธ์: region/data/live/ecmwf.json
  {status, updated_at, model, point:{tcode,name,lat,lon,cell_lat,cell_lon}, next24_mm, next72_mm, days:[[วันที่, ฝน มม., สูงสุด °C, ต่ำสุด °C], …7 วัน]}
ค่าเป็นผลแบบจำลองเชิงตัวเลขระดับโลก (กริด ~25 กม.) ไม่ใช่การพยากรณ์ของกรมอุตุนิยมวิทยา
ดึงไม่สำเร็จ → status: error คงค่าเดิมไว้ และจบ exit 0
"""
import json, urllib.request, urllib.parse, datetime as dt
from _common import ROOT, now_iso, read, write

OUT = "ecmwf.json"
MODEL = "ecmwf_ifs025"
TCODE = "301010"
GAP_H = 3
TZ = dt.timezone(dt.timedelta(hours=7))


def main():
    prev = read(OUT)
    now = dt.datetime.now(dt.timezone.utc)
    if prev.get("status") == "ok" and prev.get("updated_at"):
        if (now - dt.datetime.fromisoformat(prev["updated_at"])).total_seconds() / 3600 < GAP_H:
            print("ecmwf: ข้าม (ดึงไม่นานนี้)"); return
    p = next(f["properties"] for f in json.loads((ROOT / "data/tambon.geojson").read_text(encoding="utf-8"))["features"]
             if f["properties"]["tcode"] == TCODE)
    q = urllib.parse.urlencode({"latitude": p["lat"], "longitude": p["lon"], "models": MODEL, "timezone": "Asia/Bangkok",
                                "hourly": "precipitation", "daily": "precipitation_sum,temperature_2m_max,temperature_2m_min",
                                "forecast_days": 7})
    try:
        with urllib.request.urlopen(f"https://api.open-meteo.com/v1/forecast?{q}", timeout=60) as r:
            d = json.loads(r.read())
        h, dy = d.get("hourly") or {}, d.get("daily") or {}
        if not dy.get("time") or "precipitation_sum" not in dy:
            raise ValueError(f"ไม่มี daily ในผลลัพธ์: {list(d)[:8]}")
        hr = dt.datetime.now(TZ).replace(minute=0, second=0, microsecond=0)
        acc = {24: 0.0, 72: 0.0}
        for t, v in zip(h.get("time", []), h.get("precipitation", [])):
            if v is None:
                continue
            k = (dt.datetime.fromisoformat(t).replace(tzinfo=TZ) - hr).total_seconds() / 3600
            for w in acc:
                if 0 < k <= w: acc[w] += v
        col = lambda k: dy.get(k) or [None] * len(dy["time"])
        r1 = lambda v: None if v is None else round(v, 1)
        days = [[t, r1(a), r1(b), r1(c)] for t, a, b, c in
                zip(dy["time"], col("precipitation_sum"), col("temperature_2m_max"), col("temperature_2m_min"))]
        write(OUT, {"status": "ok", "updated_at": now_iso(), "model": MODEL, "source": "ECMWF IFS ผ่าน Open-Meteo (CC BY 4.0)",
                    "point": {"tcode": TCODE, "name": p["name"], "lat": p["lat"], "lon": p["lon"],
                              "cell_lat": d.get("latitude"), "cell_lon": d.get("longitude")},
                    "next24_mm": round(acc[24], 1), "next72_mm": round(acc[72], 1), "days": days})
        print(f"ecmwf: ฝน 24 ชม. ข้างหน้า {acc[24]:.1f} มม. · {len(days)} วัน")
    except Exception as e:
        prev.update({"status": "error", "error": str(e)[:200], "error_at": now_iso()})
        write(OUT, prev)
        print(f"ecmwf: ดึงไม่สำเร็จ — {e}")


if __name__ == "__main__":
    main()
