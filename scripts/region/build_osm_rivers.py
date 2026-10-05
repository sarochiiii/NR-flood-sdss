"""ลำน้ำจาก OpenStreetMap (Overpass API) — สร้างข้อมูลคงที่ ไม่ต้องใช้ key

ดึง way ที่มี waterway = river | canal | stream ในกรอบสองอำเภอ (โนนไทย–โนนสูง) + buffer 0.05°
ผลลัพธ์: region/data/osm_rivers.geojson (LineString · properties: name, type) · พิกัดปัด 5 ตำแหน่ง (~1 ม.)
รันผ่าน .github/workflows/osm-rivers.yml (กดเองหรือทุกต้นเดือน) เพราะเครื่องพัฒนาบางเครื่องเข้าถึง Overpass ไม่ได้
ถ้าดึงไม่สำเร็จจะไม่เขียนทับไฟล์เดิม และจบ exit 0
ลิขสิทธิ์: © OpenStreetMap contributors (ODbL 1.0) — ต้องแสดง attribution บนแผนที่
"""
import json, sys, urllib.request, urllib.parse
from _common import ROOT, now_iso, region_bbox

MIRRORS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
OUT = ROOT / "data/osm_rivers.geojson"
TYPES = "river|canal|stream"


def fetch(q):
    err = None
    for url in MIRRORS:
        try:
            req = urllib.request.Request(url, data=urllib.parse.urlencode({"data": q}).encode(),
                                         headers={"User-Agent": "SDSS-ChanAT (github.com/sarochiiii/NR-flood-sdss)"})
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.load(r)
        except Exception as e:  # ลอง mirror ถัดไป
            err = e
            print(f"Overpass {url} ไม่สำเร็จ: {e}", file=sys.stderr)
    raise RuntimeError(err)


def main():
    w, s, e, n = region_bbox(0.05)
    q = f'[out:json][timeout:150];way["waterway"~"^({TYPES})$"]({s:.4f},{w:.4f},{n:.4f},{e:.4f});out tags geom;'
    try:
        d = fetch(q)
    except Exception as ex:
        print(f"ดึงลำน้ำจาก OSM ไม่สำเร็จ — คงไฟล์เดิมไว้: {ex}")
        return
    feats = []
    for el in d.get("elements", []):
        g = el.get("geometry") or []
        if el.get("type") != "way" or len(g) < 2:
            continue
        t = el.get("tags", {})
        feats.append({"type": "Feature",
                      "properties": {"name": t.get("name:th") or t.get("name") or "", "type": t.get("waterway"), "osm_id": el["id"]},
                      "geometry": {"type": "LineString", "coordinates": [[round(p["lon"], 5), round(p["lat"], 5)] for p in g]}})
    if not feats:
        print("ไม่พบลำน้ำในกรอบ (ผิดปกติ) — คงไฟล์เดิมไว้")
        return
    cnt = {k: sum(f["properties"]["type"] == k for f in feats) for k in TYPES.split("|")}
    OUT.write_text(json.dumps({"type": "FeatureCollection", "updated_at": now_iso(),
                               "source": "© OpenStreetMap contributors (ODbL)", "bbox": [w, s, e, n], "count": cnt,
                               "features": feats}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"บันทึก {len(feats)} เส้น {cnt} → {OUT.relative_to(ROOT.parent)}")


if __name__ == "__main__":
    main()
