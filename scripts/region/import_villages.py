"""นำเข้าตำแหน่งหมู่บ้าน (shapefile) → region/data/villages.geojson (ข้อมูลคงที่ · รันครั้งเดียวเมื่อได้ไฟล์ใหม่)

ใช้:  pip install pyshp pyproj  แล้ว  python scripts/region/import_villages.py <path>/Village.shp
ต้นฉบับ (ได้รับ 17 ต.ค. 69): Village.shp · MultiPoint 1 จุดต่อหมู่บ้าน · WGS 1984 UTM Zone 47N (EPSG:32647, อ่านจาก .prj) · UTF-8 (.cpg)
  field ที่ใช้: CODE (รหัสหมู่บ้าน 9 หลัก) · VILL_NO · VILL_NAME · TAM_NAME · AMP_NAME
ผลลัพธ์: Point WGS84 ทศนิยม 5 ตำแหน่ง · ตรวจว่าทุกจุดอยู่ใน 26 ตำบลของพื้นที่ศึกษา (tambon.geojson) ไม่อยู่ = หยุด ไม่เขียนไฟล์
ข้อมูลระดับหมู่บ้าน (ชื่อ เลขหมู่ จุดตัวแทน) ไม่ใช่ข้อมูลครัวเรือน เผยแพร่ได้
"""
import json, re, sys
from _common import ROOT, now_iso

OUT = ROOT / "data/villages.geojson"


def in_ring(x, y, r):
    c, j = False, len(r) - 1
    for i in range(len(r)):
        xi, yi, xj, yj = r[i][0], r[i][1], r[j][0], r[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            c = not c
        j = i
    return c


def main(path):
    import shapefile
    from pyproj import CRS, Transformer
    base = re.sub(r"\.shp$", "", path, flags=re.I)
    crs = CRS.from_wkt(open(base + ".prj", encoding="utf-8").read())
    tf = Transformer.from_crs(crs, 4326, always_xy=True)
    r = shapefile.Reader(base, encoding="utf-8")
    tambon = json.loads((ROOT / "data/tambon.geojson").read_text(encoding="utf-8"))["features"]
    polys = [(f["properties"]["tcode"], [f["geometry"]["coordinates"]] if f["geometry"]["type"] == "Polygon" else f["geometry"]["coordinates"]) for f in tambon]
    feats = []
    for sh, rec in zip(r.shapes(), r.records()):
        if len(sh.points) != 1:
            sys.exit(f"หมู่ {rec['VILL_NO']} มี {len(sh.points)} จุด — ต้องตรวจก่อนนำเข้า")
        lon, lat = tf.transform(*sh.points[0])
        tcode = next((c for c, P in polys if any(in_ring(lon, lat, p[0]) and not any(in_ring(lon, lat, h) for h in p[1:]) for p in P)), None)
        if not tcode:
            sys.exit(f"หมู่ {rec['VILL_NO']} {rec['VILL_NAME']} อยู่นอก 26 ตำบล ({lat:.5f}, {lon:.5f}) — ไม่เขียนไฟล์")
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
                      "properties": {"code": rec["CODE"], "vill_no": int(rec["VILL_NO"]), "name": rec["VILL_NAME"].strip(),
                                     "tambon": rec["TAM_NAME"].replace("ต.", "").strip(), "amphoe": rec["AMP_NAME"].replace("อ.", "").strip(), "tcode": tcode}})
    feats.sort(key=lambda f: (f["properties"]["tcode"], f["properties"]["vill_no"]))
    OUT.write_text(json.dumps({"type": "FeatureCollection", "updated_at": now_iso(), "source": "Village.shp (EPSG:32647) ได้รับจากโครงการ 17 ต.ค. 2569",
                               "features": feats}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"บันทึก {len(feats)} หมู่บ้าน → {OUT.name}: " + " · ".join(f"ม.{f['properties']['vill_no']} {f['properties']['name']}" for f in feats))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
