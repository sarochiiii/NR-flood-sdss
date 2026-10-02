"""นำเข้าตำแหน่งอาคารชลศาสตร์ลำเชียงไกร (ปภ. และ อบต. ส่งมอบ · export จาก Google My Maps เป็น KML)

ใช้:  python scripts/region/import_structures.py point_1.kml
ผลลัพธ์: region/data/structures.geojson
  seq = ลำดับตามไฟล์ต้นฉบับ (FID+1) ซึ่งเรียงจากอ่างลำเชียงไกรตอนล่างลงไปถึงแม่น้ำมูล
  name = ชื่อที่แก้การสะกดเล็กน้อย (นํ้า→น้ำ, เเ→แ, บ้งคับ/บังคบ→บังคับ) · name_src = ชื่อตามต้นฉบับ
  type = จัดประเภทจากคำนำหน้าชื่อ
"""
import json, re, sys, pathlib, xml.etree.ElementTree as ET
from shapely.geometry import shape, Point

ROOT = pathlib.Path(__file__).resolve().parents[2]
NS = {"k": "http://www.opengis.net/kml/2.2"}
TYPES = [("อ่างเก็บน้ำ", "reservoir"), ("แก้มลิง", "retention"), ("อาคารบังคับน้ำ", "gate"), ("อาคารระบายน้ำ", "drain"),
         ("ท่อระบายน้ำ", "drain"), ("ฝาย", "weir"), ("สะพาน", "bridge"), ("ระบบส่งน้ำ", "canal"), ("ลำน้ำ", "river")]


def clean(s):
    s = re.sub(r"\s+", " ", s or "").strip()
    s = s.replace("\u0e4d\u0e49\u0e32", "\u0e49\u0e33").replace("\u0e4d\u0e32", "\u0e33").replace("เเ", "แ")
    return s.replace("บ้งคับ", "บังคับ").replace("บังคบ", "บังคับ")


def main(path):
    T = [(f["properties"], shape(f["geometry"])) for f in json.loads((ROOT / "region/data/tambon.geojson").read_text(encoding="utf-8"))["features"]]
    feats, seen = [], {}
    for i, p in enumerate(ET.parse(path).getroot().findall(".//k:Placemark", NS), 1):
        src = (p.findtext("k:name", default="", namespaces=NS) or "").strip()
        lo, la = map(float, p.findtext(".//k:coordinates", namespaces=NS).strip().split(",")[:2])
        name = clean(src)
        seen[name] = seen.get(name, 0) + 1
        typ = next((t for k, t in TYPES if name.startswith(k)), "other")
        tb = next((pp for pp, g in T if g.contains(Point(lo, la))), None)
        feats.append({"type": "Feature", "properties": {"seq": i, "name": name, "name_src": src, "type": typ,
                      "tcode": tb["tcode"] if tb else None, "tambon": tb["name"] if tb else None, "amphoe": tb["amphoe"] if tb else None},
                      "geometry": {"type": "Point", "coordinates": [round(lo, 6), round(la, 6)]}})
    for n, c in seen.items():                       # ชื่อซ้ำต่างตำแหน่ง → เติม (แห่งที่ k)
        if c > 1:
            k = 0
            for f in feats:
                if f["properties"]["name"] == n:
                    k += 1; f["properties"]["name"] = f"{n} (แห่งที่ {k})"
    out = {"type": "FeatureCollection", "source": "ปภ. และ อบต. (ส่งมอบให้โครงการ · Google My Maps \"Chan-At Flood SDSS\")",
           "n": len(feats), "features": feats}
    (ROOT / "region/data/structures.geojson").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    from collections import Counter
    print(len(feats), "จุด ·", dict(Counter(f["properties"]["type"] for f in feats)), "· นอก 26 ตำบล", sum(1 for f in feats if not f["properties"]["tcode"]))


if __name__ == "__main__":
    main(sys.argv[1])
