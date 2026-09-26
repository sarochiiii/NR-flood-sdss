"""ดึงพื้นที่น้ำท่วมรอบ 7 วันล่าสุดจาก GISTDA Disaster Platform API แล้วตัดเฉพาะขอบเขตศึกษา

ต้องมี Secret GISTDA_API_KEY (สมัครที่ https://api-gateway.gistda.or.th)
Endpoint: {base}/features/flood/7days  header "API-Key"
ผลลัพธ์: region/data/live/gistda_flood_7d.geojson
"""
import json, os, urllib.request
from _common import LIVE, now_iso, read, write, region_bbox

BASE = "https://api-gateway.gistda.or.th/api/2.0/resources"
OUT = "gistda_flood_7d.geojson"


def main():
    key = os.environ.get("GISTDA_API_KEY", "").strip()
    prev = read(OUT, {"type": "FeatureCollection", "features": []})
    if not key:
        write(OUT, {"type": "FeatureCollection", "status": "not_configured", "updated_at": None, "features": []}, indent=0)
        print("gistda: not_configured"); return 0
    try:
        from shapely.geometry import shape, mapping, box
        from pyproj import Geod
        req = urllib.request.Request(f"{BASE}/features/flood/7days",
                                     headers={"API-Key": key, "User-Agent": "NRRU-Region-SDSS/1.0"})
        with urllib.request.urlopen(req, timeout=180) as r:
            fc = json.loads(r.read())
        clip = box(*region_bbox(0.02))
        geod, feats, rai = Geod(ellps="WGS84"), [], 0.0
        for f in fc.get("features", []):
            if not f.get("geometry"):
                continue
            g = shape(f["geometry"])
            if not g.intersects(clip):
                continue
            g = g.intersection(clip).simplify(0.0001, preserve_topology=True)
            if g.is_empty:
                continue
            a = abs(geod.geometry_area_perimeter(g)[0]) / 1600
            rai += a
            feats.append({"type": "Feature", "properties": {"area_rai": round(a, 1)},
                          "geometry": json.loads(json.dumps(mapping(g)), parse_float=lambda x: round(float(x), 5))})
        write(OUT, {"type": "FeatureCollection", "status": "ok", "updated_at": now_iso(),
                    "total_rai": round(rai), "features": feats}, indent=0)
        print(f"gistda: {len(feats)} polygon · {rai:,.0f} ไร่")
    except Exception as err:
        prev.update({"status": "error", "message": type(err).__name__})
        write(OUT, prev, indent=0)
        print("gistda error:", type(err).__name__)   # ไม่พิมพ์รายละเอียดเพื่อไม่ให้ key หลุดใน log
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
