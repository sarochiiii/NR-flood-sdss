"""รวมผล GEE (อาคาร) เข้าระบบ

ใช้:  python scripts/region/merge_buildings.py gee/NR_hex_bldg.csv gee/NR_buildings_pts.csv
ผลลัพธ์
  region/data/hex.geojson        hexagon + จำนวนอาคาร (ไม่มีค่า S)
  region/data/buildings.json     จุดอาคารเฉพาะในสองอำเภอ แบบกะทัดรัด
                                  {"n", "scale", "x0", "y0", "d": [dx, dy, area, ...]}  (พิกัดจำนวนเต็ม × 1e5 แบบสะสมต่าง)
"""
import csv, json, sys, pathlib
from shapely.geometry import shape, Point
from shapely.prepared import prep

ROOT = pathlib.Path(__file__).resolve().parents[2]


def main(hex_csv, pts_csv):
    # นับอาคารต่อ hexagon จากจุดโดยตรงด้วย h3 (ค่าจาก GEE เป็นผลรวมถ่วงน้ำหนักพิกเซลขอบ จึงมีทศนิยม)
    try:
        import h3
        rows = {}
        for r in csv.DictReader(open(pts_csv, encoding="utf-8")):
            c = h3.latlng_to_cell(float(r["lat"]), float(r["lon"]), 8)
            rows[c] = rows.get(c, 0) + 1
    except ImportError:
        rows = {r["h3"]: round(float(r["bldg"] or 0)) for r in csv.DictReader(open(hex_csv, encoding="utf-8"))}
    grid = json.loads((ROOT / "gee/hex_grid_res8.geojson").read_text())
    feats = []
    for f in grid["features"]:
        h = f["properties"]["h3"]
        f["properties"]["bldg"] = rows.get(h, 0)
        feats.append(f)
    (ROOT / "region/data/hex.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")))

    area = prep(shape({"type": "MultiPolygon", "coordinates": sum(
        [[g["geometry"]["coordinates"]] if g["geometry"]["type"] == "Polygon" else g["geometry"]["coordinates"]
         for g in json.loads((ROOT / "region/data/amphoe.geojson").read_text(encoding="utf-8"))["features"]], [])}))
    pts = []
    for r in csv.DictReader(open(pts_csv, encoding="utf-8")):
        x, y = float(r["lon"]), float(r["lat"])
        if area.contains(Point(x, y)):
            pts.append((round(x * 1e5), round(y * 1e5), int(float(r["area"] or 0))))
    pts.sort()
    d, px, py = [], pts[0][0], pts[0][1]
    for x, y, a in pts:
        d += [x - px, y - py, a]; px, py = x, y
    out = {"n": len(pts), "scale": 1e5, "x0": pts[0][0], "y0": pts[0][1], "d": d,
           "source": "Google Open Buildings V3 (confidence ≥ 0.70), CC BY-4.0 / ODbL"}
    p = ROOT / "region/data/buildings.json"
    p.write_text(json.dumps(out, separators=(",", ":")))
    print(f"hex {len(feats)} ช่อง · อาคารในสองอำเภอ {len(pts):,} หลัง · buildings.json {p.stat().st_size/1e6:.1f} MB")


if __name__ == "__main__":
    main(*sys.argv[1:3])
