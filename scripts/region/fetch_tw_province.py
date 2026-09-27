"""ดึงข้อมูลระดับจังหวัดนครราชสีมาจาก ThaiWater (endpoint เดียวกับ nakhonratchasima.thaiwater.net)

API ตั้ง CORS ให้เฉพาะ origin ของเว็บจังหวัด เบราว์เซอร์จากเว็บเราจึงเรียกตรงไม่ได้
จึงดึงผ่าน GitHub Actions แล้วเขียน region/data/live/tw_province.json

โครงสร้าง response ตรวจจากข้อมูลจริง 27 ก.ย. 2569
  rain3d / rain7d -> data[]: rain_3d|rain_7d, rainfall_start_date, rainfall_end_date, station{...}, geocode{...}, agency{...}
  dam -> data.dam_daily[] (เขื่อนขนาดใหญ่), data.dam_medium[] (อ่างขนาดกลาง)
         dam_date, dam_storage (ล้าน ลบ.ม.), dam_storage_percent, dam_inflow, dam_released, dam{dam_name, dam_lat, dam_long}
"""
import json, urllib.request, datetime as dt
from _common import now_iso, read, write, num

BASE = "https://api-v3.thaiwater.net/api/v1/thaiwater30/provinces/"
STALE_DAYS = 7          # อ่างที่ข้อมูลเก่ากว่านี้ (รวมวันที่ 1970-01-01) ไม่นับใน KPI
OUT = "tw_province.json"


def get(ep):
    req = urllib.request.Request(BASE + ep, headers={"User-Agent": "NRRU-Region-SDSS/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read())


def th(x):
    return x.get("th") if isinstance(x, dict) else x


def rain_rows(body, key):
    out = []
    for x in body.get("data", []):
        st, g = x.get("station") or {}, x.get("geocode") or {}
        la, lo = num(st.get("tele_station_lat")), num(st.get("tele_station_long"))
        if la is None or lo is None:
            continue
        out.append({"name": th(st.get("tele_station_name")), "lat": la, "lon": lo, "v": num(x.get(key)),
                    "start": x.get("rainfall_start_date"), "end": x.get("rainfall_end_date"),
                    "amphoe": th(g.get("amphoe_name")), "tambon": th(g.get("tumbon_name")),
                    "agency": th((x.get("agency") or {}).get("agency_shortname"))})
    return out


def dam_rows(body):
    today = dt.date.today()
    out = []
    data = body.get("data") or {}
    for kind, arr in (("large", data.get("dam_daily") or []), ("medium", data.get("dam_medium") or [])):
        for x in arr:
            d, g = x.get("dam") or {}, x.get("geocode") or {}
            la, lo = num(d.get("dam_lat")), num(d.get("dam_long"))
            if la is None or lo is None:
                continue
            try:
                age = (today - dt.date.fromisoformat(str(x.get("dam_date"))[:10])).days
            except ValueError:
                age = None
            out.append({"name": th(d.get("dam_name")), "kind": kind, "lat": la, "lon": lo,
                        "pct": num(x.get("dam_storage_percent")), "storage": num(x.get("dam_storage")),
                        "inflow": num(x.get("dam_inflow")), "released": num(x.get("dam_released")),
                        "date": x.get("dam_date"), "stale": age is None or age > STALE_DAYS,
                        "amphoe": th(g.get("amphoe_name"))})
    return out


def main():
    prev = read(OUT)
    res = {"updated_at": now_iso(), "status": {}, "source": "ThaiWater (สสน.) provinces API, province_code=30"}
    jobs = (("rain3d", "rain3d?province_code=30", lambda b: rain_rows(b, "rain_3d")),
            ("rain7d", "rain7d?province_code=30", lambda b: rain_rows(b, "rain_7d")),
            ("dams", "dam?province_id=30", dam_rows))
    for key, ep, fn in jobs:
        try:
            res[key] = fn(get(ep))
            res["status"][key] = "ok"
        except Exception as err:
            res[key] = prev.get(key, [])
            res["status"][key] = f"error: {type(err).__name__}"
    write(OUT, res, indent=0)
    print("tw_province:", res["status"], {k: len(res[k]) for k in ("rain3d", "rain7d", "dams")})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
