"""แปลงผล GEE ของ gee/sandbox_layers.js ให้เป็นไฟล์เว็บสาธารณะ region/data/sandbox/

ใช้:  python scripts/region/import_sandbox_layers.py โฟลเดอร์ที่มีไฟล์จาก Google Drive
  SBX_boundary.geojson → boundary.geojson · SBX_river.geojson → river.geojson · SBX_floodfreq.geojson → floodfreq.geojson
  SBX_water_*.geojson → water.geojson (รวม) · SBX_rain_monthly.csv → rain_monthly.json · SBX_ndvi_monthly.csv → ndvi_monthly.json
ไฟล์เหล่านี้ไม่มีข้อมูลครัวเรือน เผยแพร่ได้
"""
import csv, json, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "region/data/sandbox"


def rnd(o, n=5):
    return json.loads(json.dumps(o), parse_float=lambda x: round(float(x), n))


def main(src):
    src = pathlib.Path(src); OUT.mkdir(parents=True, exist_ok=True)
    for a, b in (("SBX_boundary", "boundary"), ("SBX_river", "river"), ("SBX_floodfreq", "floodfreq")):
        p = next(src.glob(a + "*.geojson"), None)
        if p:
            d = rnd(json.loads(p.read_text(encoding="utf-8")))
            for f in d.get("features", []):
                f["properties"] = {k: v for k, v in (f.get("properties") or {}).items() if k in ("freq", "src")}
            (OUT / f"{b}.geojson").write_text(json.dumps(d, separators=(",", ":")), encoding="utf-8")
            print(b, len(d.get("features", [])), "features")
    feats = []
    for p in src.glob("SBX_water_*.geojson"):
        feats += rnd(json.loads(p.read_text(encoding="utf-8"))).get("features", [])
    if feats:
        (OUT / "water.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")), encoding="utf-8")
        print("water", len(feats))
    for a, b, key in (("SBX_rain_monthly", "rain_monthly", "rain_mm"), ("SBX_ndvi_monthly", "ndvi_monthly", "ndvi")):
        p = next(src.glob(a + "*.csv"), None)
        if p:
            rows = []
            for r in csv.DictReader(open(p, encoding="utf-8")):
                try:
                    v = round(float(r[key]), 4)
                except (ValueError, TypeError):
                    v = None
                rows.append({"month": r["month"], key: v})
            (OUT / f"{b}.json").write_text(json.dumps(rows, separators=(",", ":")), encoding="utf-8")
            print(b, len(rows), "months")


if __name__ == "__main__":
    main(sys.argv[1])
