"""รวมผล GEE (NR_hex_metrics.csv) เข้ากับกริด H3 แล้วจัดชั้น S

วิธีจัดชั้น (ต้องระบุในรายงาน):
  1) แปลงแต่ละตัวชี้วัดเป็น percentile rank ภายในพื้นที่ศึกษา (0–1)
       flood : ค่าเฉลี่ยของ pr(freq_max) และ pr(flood_frac)   — สูง = อ่อนไหว
       hand  : 1 - pr(hand_m)                                  — HAND ต่ำ = อ่อนไหว
       dist  : 1 - pr(dist_m)                                  — ใกล้ทางน้ำ = อ่อนไหว
  2) score = ผลรวมถ่วงน้ำหนักตาม WEIGHTS
  3) s_class 1–4 ตาม quartile ของ score  → เป็น S เชิงสัมพัทธ์ ไม่ใช่ความน่าจะเป็นสัมบูรณ์
  4) s_class รายตำบล = ค่าเฉลี่ยถ่วงน้ำหนักด้วยจำนวนอาคาร (bldg + 1) ปัดเศษ

ใช้:  python scripts/region/merge_susceptibility.py gee/NR_hex_metrics.csv
"""
import csv, json, sys, pathlib
from bisect import bisect_right

WEIGHTS = {"flood": 1 / 3, "hand": 1 / 3, "dist": 1 / 3}   # น้ำหนักเท่ากัน — รอ calibrate

ROOT = pathlib.Path(__file__).resolve().parents[2]
GRID = ROOT / "gee/hex_grid_res8.geojson"
HEX_OUT = ROOT / "region/data/hex.geojson"
TAMBON = ROOT / "region/data/tambon.geojson"


def prank(vals):
    s = sorted(vals); n = len(s)
    return [(bisect_right(s, v) - 1) / (n - 1) if n > 1 else 0.5 for v in vals]


def num(x, d=0.0):
    try: return float(x)
    except (TypeError, ValueError): return d


def main(csv_path):
    rows = {r["h3"]: r for r in csv.DictReader(open(csv_path, encoding="utf-8"))}
    grid = json.loads(GRID.read_text())
    feats = [f for f in grid["features"] if f["properties"]["h3"] in rows]
    missing = len(grid["features"]) - len(feats)
    if missing: print(f"คำเตือน: hexagon {missing} ช่องไม่มีใน CSV")

    R = [rows[f["properties"]["h3"]] for f in feats]
    fmax = prank([num(r["freq_max"]) for r in R]); ffr = prank([num(r["flood_frac"]) for r in R])
    hand = prank([num(r["hand_m"], 99) for r in R]); dist = prank([num(r["dist_m"], 1e5) for r in R])
    score = [WEIGHTS["flood"] * (a + b) / 2 + WEIGHTS["hand"] * (1 - c) + WEIGHTS["dist"] * (1 - d)
             for a, b, c, d in zip(fmax, ffr, hand, dist)]
    s_sorted = sorted(score); n = len(score)
    q = [s_sorted[int(n * k / 4)] for k in (1, 2, 3)]
    for f, r, sc in zip(feats, R, score):
        f["properties"].update({
            "s_class": 1 + sum(sc >= x for x in q), "score": round(sc, 3),
            "freq_max": int(num(r["freq_max"])), "flood_frac": round(num(r["flood_frac"]), 3),
            "hand_m": round(num(r["hand_m"]), 1), "dist_m": int(num(r["dist_m"])), "bldg": int(num(r["bldg"]))})
    HEX_OUT.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")))

    tam = json.loads(TAMBON.read_text(encoding="utf-8"))
    for t in tam["features"]:
        hs = [f["properties"] for f in feats if f["properties"]["tcode"] == t["properties"]["tcode"]]
        w = sum(h["bldg"] + 1 for h in hs)
        t["properties"]["s_class"] = round(sum(h["s_class"] * (h["bldg"] + 1) for h in hs) / w) if w else None
        t["properties"]["bldg"] = sum(h["bldg"] for h in hs)
    TAMBON.write_text(json.dumps(tam, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    kb = HEX_OUT.stat().st_size / 1024
    print(f"hex.geojson {len(feats)} ช่อง ({kb:.0f} KB) · quartile = {[round(x, 3) for x in q]}")
    print("S รายตำบล:", {t['properties']['name']: t['properties']['s_class'] for t in tam['features']})


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ROOT / "gee/NR_hex_metrics.csv")
