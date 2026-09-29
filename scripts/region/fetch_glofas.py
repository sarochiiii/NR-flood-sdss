"""พยากรณ์ปริมาณน้ำในลำน้ำจาก GloFAS (Copernicus) ผ่าน Open-Meteo Flood API — ไม่ต้องใช้ key

GET https://flood-api.open-meteo.com/v1/flood?latitude=..&longitude=..&daily=...&past_days=60&forecast_days=30
  daily: river_discharge (ค่าวิเคราะห์/พยากรณ์หลัก), river_discharge_median, river_discharge_max, river_discharge_min (สถิติชุดพยากรณ์)
  ข้อมูล GloFAS v4 กริด ~5 กม. ต่อเนื่องตั้งแต่ 1984 · พิกัดต้องอยู่บน/ใกล้ลำน้ำ

เกณฑ์เทียบ (thresholds) คำนวณจากค่าย้อนหลัง 1984–ปีที่แล้ว: ค่าสูงสุดรายปี → ควอนไทล์ 0.50 / 0.80 / 0.95
  ≈ รอบการเกิดซ้ำ 2 / 5 / 20 ปี (ประมาณเชิงประจักษ์ ไม่ใช่การวิเคราะห์ความถี่แบบเต็ม) · คำนวณใหม่ทุก 30 วัน

ผลลัพธ์: region/data/live/glofas.json · ดึงพยากรณ์ไม่เกินทุก 12 ชม. (GloFAS ออกวันละครั้ง)
ข้อจำกัด: GloFAS ไม่จำลองการบริหารอ่างขนาดกลางอย่างละเอียด ต้องตรวจเทียบกับสถานีจริงก่อนใช้เป็นเกณฑ์เตือน
"""
import json, urllib.request, urllib.parse, datetime as dt
from _common import now_iso, read, write

API = "https://flood-api.open-meteo.com/v1/flood"
POINTS = [   # พิกัดสถานีกรมชลประทาน (rid_stations.json) — วางจุดบนลำน้ำ
    {"id": "LCK_M206", "name": "ลำเชียงไกร · M.206 ต.ด่านจาก", "river": "ลำเชียงไกร", "lat": 15.13544, "lon": 102.10466},
    {"id": "LCK_M188A", "name": "ลำเชียงไกร · M.188A บ้านเพิ่ม", "river": "ลำเชียงไกร", "lat": 15.18167, "lon": 102.24278},
    {"id": "MUN_M2A", "name": "มูล · M.2A บ้านด่านกะตา (มูลตอนบน)", "river": "มูล", "lat": 14.96806, "lon": 102.23806},
    {"id": "MUN_M194", "name": "มูล · M.194 (รวมลำตะคอง · เหนือจุดบรรจบลำเชียงไกร)", "river": "มูล", "lat": 15.15972, "lon": 102.36861},
    {"id": "MUN_M195", "name": "มูล · M.195 บ้านสัมฤทธิ์ (ใต้จุดบรรจบลำเชียงไกร)", "river": "มูล", "lat": None, "lon": None},
]
# เติมพิกัดจาก rid_stations.json ถ้าไม่ได้ระบุ
_RID = json.loads((__import__("pathlib").Path(__file__).resolve().parents[2] / "region/data/rid_stations.json").read_text(encoding="utf-8"))["stations"]
for _p in POINTS:
    if _p["lat"] is None:
        _s = _RID.get(_p["id"].split("_")[1].replace("M", "M.", 1)) or {}
        _p["lat"], _p["lon"] = _s.get("lat"), _s.get("lon")
POINTS = [p for p in POINTS if p["lat"] is not None]
FCST_GAP_H, THR_GAP_D = 12, 30
OUT = "glofas.json"


def get(params):
    url = API + "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "NRRU-Region-SDSS/1.0"}), timeout=120) as r:
        d = json.loads(r.read())
    return d if isinstance(d, list) else [d]


def thresholds():
    last_year = dt.date.today().year - 1
    res = get({"latitude": ",".join(str(p["lat"]) for p in POINTS), "longitude": ",".join(str(p["lon"]) for p in POINTS),
               "daily": "river_discharge", "start_date": "1984-01-01", "end_date": f"{last_year}-12-31"})
    out = {}
    for p, d in zip(POINTS, res):
        t, q = d["daily"]["time"], d["daily"]["river_discharge"]
        amax = {}
        for day, v in zip(t, q):
            if v is not None:
                y = day[:4]; amax[y] = max(amax.get(y, 0), v)
        s = sorted(amax.values())
        qt = lambda f: round(s[min(len(s) - 1, int(f * (len(s) - 1) + 0.5))], 2) if s else None
        mean = [v for v in q if v is not None]
        out[p["id"]] = {"q2": qt(0.5), "q5": qt(0.8), "q20": qt(0.95), "mean": round(sum(mean) / len(mean), 2) if mean else None,
                        "years": f"1984–{last_year}", "n_years": len(s), "cell_lat": d.get("latitude"), "cell_lon": d.get("longitude")}
    return out


def main():
    prev = read(OUT)
    now = dt.datetime.now(dt.timezone.utc)
    if prev.get("status") == "ok" and prev.get("updated_at"):
        if (now - dt.datetime.fromisoformat(prev["updated_at"])).total_seconds() / 3600 < FCST_GAP_H:
            print("glofas: ข้าม (ดึงไม่นานนี้)"); return 0
    try:
        thr, thr_at = prev.get("thresholds") or {}, prev.get("thresholds_at")
        if not thr or not thr_at or (now - dt.datetime.fromisoformat(thr_at)).days >= THR_GAP_D:
            thr, thr_at = thresholds(), now_iso()
        res = get({"latitude": ",".join(str(p["lat"]) for p in POINTS), "longitude": ",".join(str(p["lon"]) for p in POINTS),
                   "daily": "river_discharge,river_discharge_median,river_discharge_max,river_discharge_min",
                   "past_days": 60, "forecast_days": 30})
        today = dt.date.today().isoformat()
        pts = []
        for p, d in zip(POINTS, res):
            dd = d.get("daily", {}); t = dd.get("time", [])
            col = lambda k: dd.get(k) or [None] * len(t)
            q, qmed, qmax, qmin = col("river_discharge"), col("river_discharge_median"), col("river_discharge_max"), col("river_discharge_min")
            rnd = lambda v: None if v is None else round(v, 2)
            past = [[t[i], rnd(q[i])] for i in range(len(t)) if t[i] < today]
            fc = [[t[i], rnd(qmed[i] if qmed[i] is not None else q[i]), rnd(qmax[i]), rnd(qmin[i])] for i in range(len(t)) if t[i] >= today]
            th = thr.get(p["id"], {})
            peak = max(fc, key=lambda r: (r[2] if r[2] is not None else r[1] or 0), default=None)
            pts.append(dict(p, cell_lat=d.get("latitude"), cell_lon=d.get("longitude"), thresholds=th, past=past, fcst=fc,
                            peak={"date": peak[0], "median": peak[1], "max": peak[2]} if peak else None))
        write(OUT, {"status": "ok", "updated_at": now_iso(), "source": "GloFAS v4 (Copernicus EMS) ผ่าน Open-Meteo Flood API · CC BY 4.0",
                    "thresholds_at": thr_at, "thresholds": thr, "points": pts}, indent=None)
        for p in pts:
            print(f"glofas {p['id']}: เซลล์ {p['cell_lat']},{p['cell_lon']} · ล่าสุด {p['past'][-1][1] if p['past'] else '—'} · สูงสุด 30 วัน {p['peak']} · q2 {p['thresholds'].get('q2')}")
    except Exception as err:
        prev.update({"status": "error", "message": f"{type(err).__name__}: {str(err)[:150]}"})
        write(OUT, prev, indent=None)
        print("glofas error:", type(err).__name__, str(err)[:150])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
