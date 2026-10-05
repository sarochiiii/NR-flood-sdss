"""แหล่งน้ำผิวดินอื่นนอกจากลำน้ำ จาก OpenStreetMap (Overpass API) — สร้างข้อมูลคงที่ ไม่ต้องใช้ key

ดึง polygon (way ปิด + relation multipolygon) ในกรอบสองอำเภอ + buffer 0.05°:
  natural=water (ยกเว้น water=river|canal|stream|ditch|drain ซึ่งเป็นตัวลำน้ำ — ชั้นลำน้ำอยู่ใน osm_rivers.geojson)
  landuse=reservoir|basin · natural=wetland
ประเภท (properties.type): reservoir อ่างเก็บน้ำ · pond สระ/บ่อ · lake หนอง/บึง · oxbow กุด · wetland พื้นที่ชุ่มน้ำ · basin บ่อพัก/บ่อบำบัด · other
ผลลัพธ์: region/data/osm_water.geojson (Polygon/MultiPolygon · name, type, area_rai, osm) · พิกัดปัด 5 ตำแหน่ง
พื้นที่ (ไร่) คำนวณแบบ equirectangular รอบละติจูดของ polygon — ใช้เพื่อแสดงผล ไม่ใช่การรังวัด
ถ้าดึงไม่สำเร็จจะไม่เขียนทับไฟล์เดิม และจบ exit 0 · © OpenStreetMap contributors (ODbL 1.0)
"""
import json, math
from _common import ROOT, now_iso, region_bbox
from build_osm_rivers import fetch

OUT = ROOT / "data/osm_water.geojson"
SKIP_WATER = {"river", "canal", "stream", "ditch", "drain", "riverbank", "stream_pool"}
TYPE_OF_WATER = {"reservoir": "reservoir", "pond": "pond", "lake": "lake", "oxbow": "oxbow", "lagoon": "lake",
                 "basin": "basin", "wastewater": "basin", "fishpond": "pond", "reflecting_pool": "pond"}


def classify(t):
    if t.get("natural") == "wetland":
        return "wetland"
    if t.get("landuse") == "reservoir":
        return "reservoir"
    if t.get("landuse") == "basin":
        return "basin"
    w = t.get("water")
    if w in SKIP_WATER or t.get("waterway") == "riverbank":
        return None
    return TYPE_OF_WATER.get(w, "other")


def stitch(lines):
    """ต่อ way ของ relation ให้เป็นวงปิด (จับปลายที่ตรงกัน) — คืนรายการวงปิด"""
    segs, rings = [list(l) for l in lines if len(l) >= 2], []
    while segs:
        cur = segs.pop(0)
        changed = True
        while cur[0] != cur[-1] and changed:
            changed = False
            for i, s in enumerate(segs):
                if s[0] == cur[-1]: cur += s[1:]
                elif s[-1] == cur[-1]: cur += s[::-1][1:]
                elif s[-1] == cur[0]: cur = s[:-1] + cur
                elif s[0] == cur[0]: cur = s[::-1][:-1] + cur
                else: continue
                segs.pop(i); changed = True
                break
        if cur[0] == cur[-1] and len(cur) >= 4:
            rings.append(cur)
    return rings


def area_rai(ring):
    lat0 = math.radians(sum(p[1] for p in ring) / len(ring))
    kx, ky = 111320 * math.cos(lat0), 110540
    a = sum((ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]) for i in range(len(ring) - 1))
    return abs(a) / 2 * kx * ky / 1600


def inside(pt, ring):
    x, y, c = pt[0], pt[1], False
    for i in range(len(ring) - 1):
        (x1, y1), (x2, y2) = ring[i], ring[i + 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


def main():
    w, s, e, n = region_bbox(0.05)
    b = f"({s:.4f},{w:.4f},{n:.4f},{e:.4f})"
    q = (f'[out:json][timeout:170];('
         f'way["natural"="water"]{b};relation["natural"="water"]{b};'
         f'way["landuse"~"^(reservoir|basin)$"]{b};relation["landuse"~"^(reservoir|basin)$"]{b};'
         f'way["natural"="wetland"]{b};relation["natural"="wetland"]{b};);out tags geom;')
    try:
        d = fetch(q)
    except Exception as ex:
        print(f"ดึงแหล่งน้ำจาก OSM ไม่สำเร็จ — คงไฟล์เดิมไว้: {ex}")
        return
    rnd = lambda g: [[round(p["lon"], 5), round(p["lat"], 5)] for p in g]
    feats = []
    for el in d.get("elements", []):
        t = el.get("tags", {})
        typ = classify(t)
        if not typ:
            continue
        if el["type"] == "way":
            ring = rnd(el.get("geometry") or [])
            if len(ring) < 4 or ring[0] != ring[-1]:
                continue                                    # way ไม่ปิด = ไม่ใช่ polygon
            polys = [[ring]]
        elif el["type"] == "relation":
            mem = [m for m in el.get("members", []) if m.get("type") == "way" and m.get("geometry")]
            outers = stitch([rnd(m["geometry"]) for m in mem if m.get("role") in ("outer", "")])
            inners = stitch([rnd(m["geometry"]) for m in mem if m.get("role") == "inner"])
            if not outers:
                continue
            polys = [[o] for o in outers]
            for h in inners:                                # รู (เกาะกลางน้ำ) → ใส่ใน outer ที่ครอบอยู่
                for p in polys:
                    if inside(h[0], p[0]):
                        p.append(h); break
        else:
            continue
        ar = sum(area_rai(p[0]) - sum(area_rai(h) for h in p[1:]) for p in polys)
        geom = {"type": "Polygon", "coordinates": polys[0]} if len(polys) == 1 else {"type": "MultiPolygon", "coordinates": polys}
        feats.append({"type": "Feature", "geometry": geom,
                      "properties": {"name": t.get("name:th") or t.get("name") or "", "type": typ,
                                     "area_rai": round(ar, 1), "osm": f"{el['type'][0]}{el['id']}"}})
    if not feats:
        print("ไม่พบแหล่งน้ำในกรอบ (ผิดปกติ) — คงไฟล์เดิมไว้")
        return
    feats.sort(key=lambda f: -f["properties"]["area_rai"])      # ใหญ่ก่อน → แหล่งเล็กวาดทับด้านบน
    cnt = {}
    for f in feats:
        cnt[f["properties"]["type"]] = cnt.get(f["properties"]["type"], 0) + 1
    OUT.write_text(json.dumps({"type": "FeatureCollection", "updated_at": now_iso(),
                               "source": "© OpenStreetMap contributors (ODbL)", "bbox": [w, s, e, n], "count": cnt,
                               "total_rai": round(sum(f["properties"]["area_rai"] for f in feats)),
                               "features": feats}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"บันทึก {len(feats)} แหล่ง {cnt} → {OUT.name}")


if __name__ == "__main__":
    main()
