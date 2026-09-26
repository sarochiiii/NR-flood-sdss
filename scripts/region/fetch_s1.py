"""สร้างภาพ Sentinel-1 VV ล่าสุดของพื้นที่ศึกษาเป็น PNG สำหรับซ้อนบนแผนที่ (L.imageOverlay)

ต้องมี Secret EE_SERVICE_ACCOUNT_KEY (JSON ของ service account ที่ลงทะเบียน Earth Engine แล้ว)
และ EE_PROJECT (เช่น ee-sarochineek)
ข้ามการเขียนไฟล์ถ้าวันที่ภาพเท่าเดิม เพื่อไม่ให้ repo โตจาก commit PNG ซ้ำ
"""
import json, os, urllib.request, datetime as dt
from _common import LIVE, now_iso, read, write, region_bbox

META = "s1_latest.json"


def main():
    raw = os.environ.get("EE_SERVICE_ACCOUNT_KEY", "").strip()
    if not raw:
        write(META, {"status": "not_configured"}); print("s1: not_configured"); return 0
    prev = read(META)
    try:
        import ee
        info = json.loads(raw)
        ee.Initialize(ee.ServiceAccountCredentials(info["client_email"], key_data=raw),
                      project=os.environ.get("EE_PROJECT") or info.get("project_id"))
        bb = region_bbox(0.03)
        region = ee.Geometry.Rectangle(list(bb))
        end = ee.Date(dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d"))
        col = (ee.ImageCollection("COPERNICUS/S1_GRD").filterBounds(region)
               .filterDate(end.advance(-14, "day"), end.advance(1, "day"))
               .filter(ee.Filter.eq("instrumentMode", "IW"))
               .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV")))
        if col.size().getInfo() == 0:
            prev.update({"status": "no_image", "checked_at": now_iso()}); write(META, prev); print("s1: ไม่มีภาพ 14 วัน"); return 0
        last = ee.Date(col.aggregate_max("system:time_start"))
        date = last.format("YYYY-MM-dd").getInfo()
        if prev.get("date") == date and (LIVE / "s1_latest.png").exists():
            prev.update({"checked_at": now_iso()}); write(META, prev); print("s1: ภาพเดิม", date); return 0
        img = col.filterDate(last.advance(-1, "day"), last.advance(1, "day")).select("VV").mosaic().clip(region)
        url = img.getThumbURL({"region": region, "dimensions": 1400, "format": "png",
                               "min": -25, "max": 0, "palette": ["000000", "FFFFFF"]})
        with urllib.request.urlopen(url, timeout=180) as r:
            (LIVE / "s1_latest.png").write_bytes(r.read())
        write(META, {"status": "ok", "date": date, "checked_at": now_iso(), "polarisation": "VV",
                     "stretch_db": [-25, 0], "bounds": [[bb[1], bb[0]], [bb[3], bb[2]]]})
        print("s1: อัปเดต", date)
    except Exception as err:
        prev.update({"status": "error", "message": f"{type(err).__name__}: {str(err)[:120]}"}); write(META, prev)
        print("s1 error:", type(err).__name__)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
