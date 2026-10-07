"""น้ำท่วมซ้ำซาก (GISTDA) รอบ ต.จันอัด จาก Earth Engine asset → region/data/sandbox/floodfreq.geojson

ทำซ้ำส่วนที่ 2 ของ gee/sandbox_layers.js แต่รันผ่าน service account ใน Actions (workflow sandbox-layers) แทนการ export ลง Drive
  asset: env FF_ASSET (ค่าเริ่มต้น projects/ee-sarochineek/assets/FloodGCS — ต้นฉบับ GISTDA · Repeatarea เดิมถูกตัดขอบ)
  field ความถี่: env FF_FIELD หรือค้นจากชื่อที่รู้จัก (ตรวจจากข้อมูลจริง ไม่เดา)
  FF_INSPECT=1 → พิมพ์โครงสร้าง asset (ชนิด · field · ค่าที่พบ · ชนิด geometry ในพื้นที่) แล้วจบ ไม่เขียนไฟล์
  แตก GeometryCollection เก็บเฉพาะ polygon → raster ค่าสูงสุด (10 ม.) → polygon ตามจำนวนครั้ง (dissolve) ในพื้นที่ ต.จันอัด + 3 กม.
ผลลัพธ์: FeatureCollection {properties: {freq}} · ไม่มีข้อมูลครัวเรือน เผยแพร่ได้
ต้องมี Secret EE_SERVICE_ACCOUNT_KEY และ service account ต้องอ่าน asset ได้ (แชร์ asset ให้อีเมล service account)
ดึงไม่สำเร็จ → ไม่เขียนทับไฟล์เดิม · พิมพ์ ::error:: ให้เห็นใน Actions · จบ exit 0
"""
import json, os
from _common import ROOT, now_iso

ASSET = os.environ.get("FF_ASSET", "").strip() or "projects/ee-sarochineek/assets/FloodGCS"
FIELDS = ("Repeating", "freq", "FREQ", "repeat", "Repeat", "REPEAT", "frequency", "count")
TCODE = "301010"
OUT = ROOT / "data/sandbox/floodfreq.geojson"


def inspect(ee, asset, kind, aoi):
    """พิมพ์โครงสร้าง asset เพื่อเลือก field/วิธีแปลงจากข้อมูลจริง (ไม่เขียนไฟล์)"""
    if kind in ("TABLE", "FEATURE_COLLECTION"):
        fc = ee.FeatureCollection(asset)
        sub = fc.filterBounds(aoi)
        print("จำนวน feature ทั้งหมด", fc.size().getInfo(), "· ในพื้นที่ ต.จันอัด + 3 กม.", sub.size().getInfo())
        names = [n for n in fc.first().propertyNames().getInfo() if n != "system:index"]
        print("field:", names)
        print("ตัวอย่าง properties:", json.dumps(fc.first().toDictionary().getInfo(), ensure_ascii=False)[:800])
        gt = sub.map(lambda f: f.set("_t", f.geometry().type())).aggregate_histogram("_t").getInfo()
        print("ชนิด geometry ในพื้นที่:", gt)
        for n in names:
            try:
                h = sub.aggregate_histogram(n).getInfo()
                ks = list(h)
                print(f"  {n}: {len(ks)} ค่า · {json.dumps(dict(list(h.items())[:15]), ensure_ascii=False)[:400]}")
            except Exception as e:
                print(f"  {n}: อ่าน histogram ไม่ได้ ({str(e)[:80]})")
        try:
            a = sub.map(lambda f: f.set("_a", f.geometry().intersection(aoi, 1).area(1))).aggregate_sum("_a").getInfo()
            print(f"พื้นที่รวมในพื้นที่ (ทับซ้อนนับซ้ำ) {a / 1e6:.2f} ตร.กม.")
        except Exception as e:
            print("คำนวณพื้นที่ไม่ได้:", str(e)[:120])
    elif kind == "IMAGE":
        img = ee.Image(asset)
        print("band:", img.bandNames().getInfo(), "· scale", img.projection().nominalScale().getInfo(), "ม.")
        print("properties:", json.dumps(img.toDictionary().getInfo(), ensure_ascii=False)[:600])
        print("histogram ค่าพิกเซลในพื้นที่:", json.dumps(img.reduceRegion(ee.Reducer.frequencyHistogram(), aoi, 30, maxPixels=1e9).getInfo(), ensure_ascii=False)[:1500])
    else:
        print("ชนิดที่ยังไม่รองรับ:", kind)


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
        kind = ee.data.getAsset(ASSET).get("type")
        print("asset =", ASSET, "· ชนิด =", kind)
        if os.environ.get("FF_INSPECT") == "1":
            inspect(ee, ASSET, kind, aoi); return
        if kind not in ("TABLE", "FEATURE_COLLECTION"):
            print(f"::error::{ASSET} เป็น {kind} — สคริปต์รองรับเฉพาะ FeatureCollection · รัน FF_INSPECT=1 แล้วส่งผลให้ผู้พัฒนา"); return
        fc = ee.FeatureCollection(ASSET)
        names = fc.first().propertyNames().getInfo()
        want = os.environ.get("FF_FIELD", "").strip()
        field = want if want in names else None if want else next((n for n in FIELDS if n in names), None)
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
