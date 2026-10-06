"""น้ำท่วมซ้ำซาก (GISTDA) รอบ ต.จันอัด จาก Earth Engine asset → region/data/sandbox/floodfreq.geojson

ทำซ้ำส่วนที่ 2 ของ gee/sandbox_layers.js แต่รันผ่าน service account ใน Actions (workflow sandbox-layers) แทนการ export ลง Drive
  asset: projects/ee-sarochineek/assets/Repeatarea · field ความถี่ 'Repeating' หรือ 'freq' (ตรวจจากข้อมูลจริง ไม่เดา)
  แตก GeometryCollection เก็บเฉพาะ polygon → raster ค่าสูงสุด (10 ม.) → polygon ตามจำนวนครั้ง (dissolve) ในพื้นที่ ต.จันอัด + 3 กม.
ผลลัพธ์: FeatureCollection {properties: {freq}} · ไม่มีข้อมูลครัวเรือน เผยแพร่ได้
ต้องมี Secret EE_SERVICE_ACCOUNT_KEY และ service account ต้องอ่าน asset ได้ (แชร์ asset ให้อีเมล service account)
ดึงไม่สำเร็จ → ไม่เขียนทับไฟล์เดิม · พิมพ์ ::error:: ให้เห็นใน Actions · จบ exit 0
"""
import json, os
from _common import ROOT, now_iso

ASSET = "projects/ee-sarochineek/assets/Repeatarea"
TCODE = "301010"
OUT = ROOT / "data/sandbox/floodfreq.geojson"


def main():
    raw = os.environ.get("EE_SERVICE_ACCOUNT_KEY", "").strip()
    if not raw:
        print("::error::ไม่มี EE_SERVICE_ACCOUNT_KEY"); return
    try:
        import ee
        info = json.loads(raw)
        ee.Initialize(ee.ServiceAccountCredentials(info["client_email"], key_data=raw),
                      project=os.environ.get("EE_PROJECT") or info.get("project_id"))
        tb = next(f for f in json.loads((ROOT / "data/tambon.geojson").read_text(encoding="utf-8"))["features"]
                  if f["properties"]["tcode"] == TCODE)
        aoi = ee.Geometry(tb["geometry"]).buffer(3000)
        fc = ee.FeatureCollection(ASSET)
        names = fc.first().propertyNames().getInfo()
        field = next((n for n in ("Repeating", "freq", "FREQ", "repeat") if n in names), None)
        if not field:
            print(f"::error::ไม่พบ field ความถี่ใน {ASSET} — field ที่มี: {names}"); return
        print("ใช้ field ความถี่ =", field, "· จำนวน feature ทั้งหมด", fc.size().getInfo())

        def explode(f):
            gs = ee.List(f.geometry().geometries())
            return ee.FeatureCollection(gs.map(lambda g: ee.Feature(ee.Geometry(g), {"freq": f.get(field), "t": ee.Geometry(g).type()})))
        img = (fc.filterBounds(aoi).filter(ee.Filter.notNull([field])).map(explode).flatten()
               .filter(ee.Filter.inList("t", ["Polygon", "MultiPolygon"]))
               .reduceToImage(["freq"], ee.Reducer.max()).rename("freq").toInt())
        vec = img.reduceToVectors(geometry=aoi, scale=10, geometryType="polygon", labelProperty="freq",
                                  maxPixels=1e9, tileScale=4)
        vec = vec.map(lambda f: ee.Feature(f.geometry().simplify(8), {"freq": f.get("freq")}))
        d = vec.getInfo()
    except Exception as e:
        print(f"::error::ดึงน้ำท่วมซ้ำซากไม่สำเร็จ — {str(e)[:300]}"); return
    rnd = lambda c: [rnd(x) for x in c] if isinstance(c[0], list) else [round(c[0], 5), round(c[1], 5)]
    feats = [{"type": "Feature", "properties": {"freq": int(f["properties"]["freq"])},
              "geometry": {"type": f["geometry"]["type"], "coordinates": rnd(f["geometry"]["coordinates"])}}
             for f in d.get("features", []) if f.get("geometry") and f["properties"].get("freq") is not None]
    if not feats:
        print("::error::ไม่พบ polygon น้ำท่วมซ้ำซากในพื้นที่ — คงไฟล์เดิมไว้"); return
    OUT.parent.mkdir(parents=True, exist_ok=True)
    cnt = {}
    for f in feats:
        cnt[f["properties"]["freq"]] = cnt.get(f["properties"]["freq"], 0) + 1
    OUT.write_text(json.dumps({"type": "FeatureCollection", "updated_at": now_iso(), "source": f"GISTDA น้ำท่วมซ้ำซาก ({ASSET}, field {field})",
                               "tcode": TCODE, "max_freq": max(cnt), "count_by_freq": cnt, "features": feats},
                              ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"บันทึก {len(feats)} polygon · ความถี่ {sorted(cnt)} → {OUT.name}")


if __name__ == "__main__":
    main()
