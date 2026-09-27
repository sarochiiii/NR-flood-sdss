"""แปลงรูปอาคารจาก GEE (Shapefile) เป็น tile รายตำบลสำหรับเว็บ

ใช้:  python scripts/region/build_building_tiles.py path/to/NR_buildings_poly.shp
ผลลัพธ์: region/data/bldg/<tcode>.json  และ region/data/bldg/index.json
รูปแบบ tile (กะทัดรัด): {"s": 1e6, "p": [[x0, y0, dx1, dy1, dx2, dy2, ...], ...]}
  พิกัดจำนวนเต็ม × 1e6 (ละเอียด ~0.1 ม.) จุดแรกเป็นค่าเต็ม จุดถัดไปเป็นผลต่างสะสม ไม่เก็บจุดปิดวงซ้ำ
เลือกตำบลของอาคารจากจุดศูนย์กลาง อาคารนอกสองอำเภอถูกตัดทิ้ง
"""
import json, sys, pathlib
import shapefile
from shapely.geometry import shape, Polygon
from shapely.strtree import STRtree

ROOT = pathlib.Path(__file__).resolve().parents[2]
S = 1_000_000


def main(shp):
    T = json.loads((ROOT / "region/data/tambon.geojson").read_text(encoding="utf-8"))["features"]
    geoms = [shape(f["geometry"]) for f in T]
    codes = [f["properties"]["tcode"] for f in T]
    tree = STRtree(geoms)
    tiles = {c: [] for c in codes}
    r = shapefile.Reader(shp)
    n = 0
    for sh in r.iterShapes():
        if not sh.points:
            continue
        ring = sh.points[: sh.parts[1]] if len(sh.parts) > 1 else sh.points   # เก็บเฉพาะวงนอก
        if len(ring) > 1 and ring[0] == ring[-1]:
            ring = ring[:-1]
        if len(ring) < 3:
            continue
        c = Polygon(ring).centroid
        hit = next((i for i in tree.query(c) if geoms[i].contains(c)), None)
        if hit is None:
            continue
        pts = [(round(x * S), round(y * S)) for x, y in ring]
        enc = [pts[0][0], pts[0][1]]
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            enc += [bx - ax, by - ay]
        tiles[codes[hit]].append(enc)
        n += 1
    out = ROOT / "region/data/bldg"
    out.mkdir(exist_ok=True)
    idx = {}
    for c, g in zip(codes, geoms):
        (out / f"{c}.json").write_text(json.dumps({"s": S, "p": tiles[c]}, separators=(",", ":")))
        idx[c] = {"n": len(tiles[c]), "bbox": [round(v, 5) for v in g.bounds]}
    (out / "index.json").write_text(json.dumps({"source": "Google Open Buildings V3 (confidence ≥ 0.70)", "tiles": idx}, ensure_ascii=False, separators=(",", ":")))
    size = sum(p.stat().st_size for p in out.glob("*.json")) / 1e6
    print(f"อาคาร {n:,} หลังใน {len(codes)} ตำบล · รวม {size:.1f} MB · ใหญ่สุด {max(v['n'] for v in idx.values()):,} หลัง/ตำบล")


if __name__ == "__main__":
    main(sys.argv[1])
