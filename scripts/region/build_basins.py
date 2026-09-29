"""สร้างขอบเขตลุ่มน้ำต้นน้ำของจุดสถานีจาก HydroBASINS L12 (ผลจาก gee/basins_hydrosheds.js)

ใช้:  python scripts/region/build_basins.py gee/NR_hybas12.geojson
ผลลัพธ์
  region/data/basins.geojson        ขอบเขตลุ่มน้ำเหนือแต่ละจุด (id, name, area_km2, da_rid, diff_pct)
  region/data/basin_points.json      จุดตัวแทนลุ่มน้ำย่อย (centroid) สำหรับคำนวณฝนเฉลี่ยลุ่มน้ำ
ตรวจความถูกต้อง: เทียบพื้นที่กับ D.A ของกรมชลประทาน (rid_stations.json) · ต่างเกิน 25% = ควรตรวจก่อนใช้
"""
import json, sys, pathlib
from collections import defaultdict, deque
from shapely.geometry import shape, mapping, Point
from shapely.ops import unary_union

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUTLETS = [  # (id, ชื่อ, รหัสสถานี กรมชลประทาน) — โทโพโลยีตรวจจาก NEXT_DOWN ของ HydroBASINS:
    # มูล (M.2A) + ลำตะคอง (M.164) บรรจบกันก่อน M.194 · ลำเชียงไกร (M.188A) บรรจบมูลระหว่าง M.194 กับ M.195
    ("LCK", "ลุ่มลำเชียงไกรเหนือ M.188A", "M.188A"),
    ("MUN_UP", "ลุ่มมูลตอนบนเหนือ M.2A", "M.2A"),
    ("TAK", "ลุ่มลำตะคองเหนือ M.164", "M.164"),
    ("STUDY", "ลุ่มน้ำเหนือ M.195 (มูล + ลำตะคอง + ลำเชียงไกร)", "M.195"),
]


def main(path):
    fc = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    rid = json.loads((ROOT / "region/data/rid_stations.json").read_text(encoding="utf-8"))["stations"]
    B = {}
    for f in fc["features"]:
        p = f["properties"]; B[int(p["HYBAS_ID"])] = {"geom": shape(f["geometry"]), "next": int(p["NEXT_DOWN"]),
                                                     "sub": float(p["SUB_AREA"]), "up": float(p["UP_AREA"])}
    ups = defaultdict(list)
    for k, v in B.items():
        ups[v["next"]].append(k)
    feats, points, rows = [], [], []
    for oid, name, code in OUTLETS:
        st = rid.get(code) or {}
        if st.get("lat") is None:
            print(f"{code}: ไม่มีพิกัด"); continue
        pt = Point(st["lon"], st["lat"])
        start = next((k for k, v in B.items() if v["geom"].contains(pt)), None)
        if start is None:
            print(f"{code}: จุดอยู่นอกกรอบ HydroBASINS ที่ส่งออก"); continue
        seen, q = {start}, deque([start])
        while q:
            for u in ups[q.popleft()]:
                if u in B and u not in seen:
                    seen.add(u); q.append(u)
        area = sum(B[k]["sub"] for k in seen)
        complete = abs(area - B[start]["up"]) / B[start]["up"] < 0.02   # ถ้าขาดลุ่มย่อย แปลว่ากรอบที่ส่งออกเล็กเกิน
        da = st.get("da")
        diff = round(100 * (area - da) / da, 1) if da else None
        geom = unary_union([B[k]["geom"] for k in seen]).simplify(0.002, preserve_topology=True)
        feats.append({"type": "Feature", "properties": {"id": oid, "name": name, "outlet": code, "area_km2": round(area),
                      "da_rid": da, "diff_pct": diff, "n_sub": len(seen), "complete": complete},
                      "geometry": json.loads(json.dumps(mapping(geom)), parse_float=lambda x: round(float(x), 4))})
        if oid != "STUDY":
            for k in seen:
                c = B[k]["geom"].representative_point()
                points.append({"basin": oid, "hybas": k, "lat": round(c.y, 4), "lon": round(c.x, 4), "w": round(B[k]["sub"], 1)})
        rows.append((code, name, round(area), da, diff, len(seen), complete))
    (ROOT / "region/data/basins.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (ROOT / "region/data/basin_points.json").write_text(json.dumps(points, separators=(",", ":")), encoding="utf-8")
    print("จุดออก | ลุ่มน้ำ | พื้นที่ HydroBASINS | D.A กรมชลฯ | ต่าง % | ลุ่มย่อย | ครบกรอบ")
    for r in rows:
        print(" | ".join(str(x) for x in r))
    print(f"จุดตัวแทนฝนลุ่มน้ำ {len(points)} จุด")


if __name__ == "__main__":
    main(sys.argv[1])
