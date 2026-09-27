"""บันทึกประวัติระดับน้ำสถานีและปริมาณน้ำในอ่าง เพื่อคำนวณแนวโน้มขึ้น-ลงและวาดกราฟ

API สาธารณะของ สสน. ให้เฉพาะค่าล่าสุด ระบบจึงเก็บประวัติเองทุกครั้งที่ workflow รัน
  wl[code]  = [[measured_at, storage_pct, level_msl], ...]  เก็บ 14 วัน (ใช้เวลาที่สถานีวัด ไม่ใช่เวลาที่ดึง)
  dam[name] = [[dam_date, pct, storage], ...]               เก็บ 30 รายการล่าสุด (ข้อมูลรายวัน)
อ่านจาก thaiwater_region.json และ tw_province.json ที่สคริปต์ก่อนหน้าเขียนไว้
"""
import datetime as dt
from _common import now_iso, read, write

KEEP_DAYS = 14
KEEP_DAM = 30
TZ = dt.timezone(dt.timedelta(hours=7))


def parse(t):
    try:
        return dt.datetime.fromisoformat(str(t).replace(" ", "T")[:16]).replace(tzinfo=TZ)
    except ValueError:
        return None


def main():
    h = read("history.json") or {}
    wl, dam = h.get("wl", {}), h.get("dam", {})
    added = 0

    tw = read("thaiwater_region.json")
    if (tw.get("status") or {}).get("waterlevel") == "ok":
        for s in tw.get("waterlevel", []):
            t, lv = s.get("measured_at"), s.get("level_msl")
            if not t or lv is None:
                continue
            arr = wl.setdefault(s["code"], [])
            if not any(x[0] == t for x in arr[-5:]):
                arr.append([t, s.get("storage_pct"), lv]); added += 1

    pv = read("tw_province.json")
    if (pv.get("status") or {}).get("dams") == "ok":
        for d in pv.get("dams", []):
            if d.get("stale") or d.get("pct") is None:
                continue
            arr = dam.setdefault(d["name"], [])
            if not arr or arr[-1][0] != d["date"]:
                arr.append([d["date"], d["pct"], d.get("storage")]); added += 1

    cut = dt.datetime.now(TZ) - dt.timedelta(days=KEEP_DAYS)
    for k in list(wl):
        wl[k] = sorted((x for x in wl[k] if (parse(x[0]) or cut) >= cut), key=lambda x: x[0])
        if not wl[k]:
            del wl[k]
    for k in list(dam):
        dam[k] = sorted(dam[k], key=lambda x: x[0])[-KEEP_DAM:]

    write("history.json", {"updated_at": now_iso(), "keep_days": KEEP_DAYS, "wl": wl, "dam": dam}, indent=None)
    print(f"history: +{added} จุด · สถานี {len(wl)} · อ่าง {len(dam)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
