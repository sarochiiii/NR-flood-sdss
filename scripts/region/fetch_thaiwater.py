"""ดึงสถานีฝนและระดับน้ำจาก ThaiWater public API (สสน./HII) เฉพาะในขอบเขตศึกษา + buffer

เขียนสองไฟล์
  thaiwater_region.json  snapshot สำหรับชั้นแผนที่ (หน้าเว็บใช้เมื่อเรียก API ตรงไม่สำเร็จ)
  water_region.json      ตาม data contract สำหรับคำนวณ T (compute_risk.py)

โครงสร้าง response อ้างอิงจากโค้ดโอเพนซอร์สที่เรียก endpoint เดียวกัน ยังต้องตรวจกับ response จริง
  rain_24h        -> data[]
  waterlevel_load -> waterlevel_data.data[]
"""
import json, urllib.request
from _common import CFG, LIVE, now_iso, read, write, region_bbox, num

BASE = CFG["layers"]["thaiwater_base"]


def get(ep):
    req = urllib.request.Request(BASE + ep, headers={"User-Agent": "NRRU-Region-SDSS/1.0"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read())


def inside(lat, lon, bb):
    return lat is not None and lon is not None and bb[0] <= lon <= bb[2] and bb[1] <= lat <= bb[3]


def th(x):
    return (x or {}).get("th") if isinstance(x, dict) else x


def parse_rain(d, bb):
    out = []
    for x in d.get("data", []):
        st = x.get("station") or {}
        la, lo = num(st.get("tele_station_lat")), num(st.get("tele_station_long"))
        if not inside(la, lo, bb):
            continue
        g = x.get("geocode") or {}
        out.append({"id": st.get("id") or st.get("tele_station_oldcode"), "name": th(st.get("tele_station_name")),
                    "lat": la, "lon": lo, "rain_24h": num(x.get("rain_24h")), "rain_1h": num(x.get("rain_1h")),
                    "time": x.get("rainfall_datetime"), "amphoe": th(g.get("amphoe_name")),
                    "agency": ((x.get("agency") or {}).get("agency_shortname") or {}).get("th")})
    return out


def parse_wl(d, bb):
    out = []
    for x in (d.get("waterlevel_data") or {}).get("data", []):
        st = x.get("station") or {}
        la, lo = num(st.get("tele_station_lat")), num(st.get("tele_station_long"))
        if not inside(la, lo, bb):
            continue
        g = x.get("geocode") or {}
        bank = num(st.get("min_bank"))
        out.append({"code": str(st.get("tele_station_oldcode") or st.get("id")), "name": th(st.get("tele_station_name")),
                    "lat": la, "lon": lo, "level_msl": num(x.get("waterlevel_msl")),
                    "bank_msl": bank if bank and bank > 0 else None,
                    "storage_pct": num(x.get("storage_percent")), "discharge": num(x.get("discharge")),
                    "measured_at": x.get("waterlevel_datetime"), "amphoe": th(g.get("amphoe_name"))})
    return out


def main():
    bb = region_bbox()
    snap = read("thaiwater_region.json")
    res = {"updated_at": now_iso(), "bbox": bb, "rain": snap.get("rain", []), "waterlevel": snap.get("waterlevel", []),
           "status": {}}
    for key, ep, fn in (("rain", "rain_24h", parse_rain), ("waterlevel", "waterlevel_load", parse_wl)):
        try:
            res[key] = fn(get(ep), bb)
            res["status"][key] = "ok"
        except Exception as err:
            res["status"][key] = f"error: {str(err)[:150]}"
    write("thaiwater_region.json", res, indent=0)

    ok = res["status"]["waterlevel"] == "ok"
    prev = read("water_region.json")
    write("water_region.json", {
        "status": "ok" if ok else "error",
        "message": None if ok else res["status"]["waterlevel"],
        "updated_at": res["updated_at"] if ok else prev.get("updated_at"),
        "source": "ThaiWater (สสน.) waterlevel_load",
        "stations": [{"code": s["code"], "name": s["name"], "level_m": s["level_msl"], "bank_m": s["bank_msl"],
                      "storage_pct": s["storage_pct"], "measured_at": s["measured_at"]}
                     for s in res["waterlevel"]] if ok else prev.get("stations", [])})
    print("thaiwater:", res["status"], f"rain={len(res['rain'])} wl={len(res['waterlevel'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
