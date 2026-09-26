"""คำนวณสถานะ T และระดับความเสี่ยงรายตำบลตาม risk matrix ใน region/config.json
เขียนผลที่ region/data/live/risk_now.json (สคริปต์ LINE OA ในเฟส 5 จะอ่านไฟล์นี้)

ตรรกะเดียวกับ tState()/riskRank() ใน region/js/region.js — แก้ที่หนึ่งต้องแก้อีกที่
"""
import json, pathlib, datetime as dt

ROOT = pathlib.Path(__file__).resolve().parents[2] / "region"
load = lambda p: json.loads((ROOT / p).read_text(encoding="utf-8"))


def t_from_rain(r, cfg):
    if not r:
        return None
    th = cfg["rain"]["tmd_24h_mm"]
    x = max(r["rain_24h_mm"], r["rain_next24h_mm"])
    t = 2 if x >= th["very_heavy"] else 1 if x >= th["heavy"] else 0
    wet = cfg["rain"]["wet_7d_mm"]
    if wet is not None and t >= 1 and r["rain_7d_mm"] >= wet:
        t += 1
    return min(t, 3)


def t_from_water(st, cfg):
    # ใช้ storage_pct ของ ThaiWater (ร้อยละความจุลำน้ำ) — ไม่ใช้ level/bank เพราะเป็นค่า ม.รทก.
    if not st or st.get("storage_pct") is None:
        return None
    ratio = st["storage_pct"] / 100
    th = cfg["water"]["ratio"]
    return 3 if ratio >= th["crit"] else 2 if ratio >= th["warn"] else 1 if ratio >= th["watch"] else 0


def main():
    cfg = load("config.json")
    tambon = [f["properties"] for f in load("data/tambon.geojson")["features"]]
    rain = load("data/live/rain_region.json")
    water = load("data/live/water_region.json")
    rmap = {r["tcode"]: r for r in rain.get("tambon", [])}
    smap = {s["code"]: s for s in water.get("stations", [])}
    rows = []
    for p in tambon:
        ts = [t for t in (t_from_rain(rmap.get(p["tcode"]), cfg),
                          t_from_water(smap.get(p.get("station_code")), cfg)) if t is not None]
        t = max(ts) if ts else None
        s = p.get("s_class")
        rank = cfg["matrix"][s - 1][t] if (s and t is not None) else None
        rows.append({"tcode": p["tcode"], "t_state": t, "s_class": s, "level_rank": rank})
    (ROOT / "data/live/risk_now.json").write_text(json.dumps({
        "updated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "matrix_verified": cfg["matrix_verified"], "tambon": rows}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"risk_now: {sum(r['level_rank'] is not None for r in rows)}/{len(rows)} ตำบลมีระดับ")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
