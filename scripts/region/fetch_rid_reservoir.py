"""ดึงข้อมูลอ่างเก็บน้ำจากระบบฐานข้อมูลน้ำในอ่างเก็บน้ำ กรมชลประทาน (app.rid.go.th/reservoir)

POST https://app.rid.go.th/reservoir/api/rsvmiddles   form: date=YYYY-MM-DD, region=ne, percent=, percent_from=, percent_to=, status=1
POST https://app.rid.go.th/reservoir/api/dams         form: date=YYYY-MM-DD, region=ne, percent=, percent_from=, percent_to=
(ตรวจจาก DevTools 28 ก.ย. 2569 · Access-Control-Allow-Origin: *)

รอบแรก: ยังไม่รู้โครงสร้าง JSON → เก็บเฉพาะรายการที่มีคำว่า "นครราชสีมา" ไว้ที่ region/data/live/raw/rid_*.json
เพื่อให้ตรวจโครงสร้างแล้วเขียน parser (ไม่เก็บทั้งภาค เพราะไฟล์ใหญ่ ~220 kB)
"""
import json, urllib.request, urllib.parse, datetime as dt
from _common import LIVE, now_iso

BASE = "https://app.rid.go.th/reservoir/api/"
TZ = dt.timezone(dt.timedelta(hours=7))
JOBS = {"rsvmiddles": {"status": "1"}, "dams": {}}


def post(ep, extra):
    form = {"date": dt.datetime.now(TZ).strftime("%Y-%m-%d"), "region": "ne",
            "percent": "", "percent_from": "", "percent_to": ""}
    form.update(extra)
    req = urllib.request.Request(BASE + ep, data=urllib.parse.urlencode(form).encode(),
                                 headers={"User-Agent": "NRRU-Region-SDSS/1.0 (research)",
                                          "Accept": "application/json",
                                          "Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return form["date"], json.loads(r.read())


def keep_province(obj, word="นครราชสีมา"):
    """คืนทุก dict ที่มีค่าข้อความใดมีคำว่า word (ค้นลึกทุกชั้น) พร้อม path ของ list ที่พบ"""
    out = []
    def walk(o, path):
        if isinstance(o, dict):
            if any(isinstance(v, str) and word in v for v in o.values()):
                out.append({"path": path, "item": o})
                return
            for k, v in o.items():
                walk(v, f"{path}.{k}")
        elif isinstance(o, list):
            for i, v in enumerate(o):
                walk(v, f"{path}[]")
    walk(obj, "$")
    return out


def main():
    raw = LIVE / "raw"
    raw.mkdir(exist_ok=True)
    for ep, extra in JOBS.items():
        res = {"fetched_at": now_iso(), "endpoint": BASE + ep}
        try:
            date, body = post(ep, extra)
            top = list(body.keys())[:20] if isinstance(body, dict) else f"list[{len(body)}]"
            items = keep_province(body)
            res.update(status="ok", date=date, top_level=top, n=len(items), items=items)
        except Exception as err:
            res.update(status="error", message=f"{type(err).__name__}: {str(err)[:150]}")
        (raw / f"rid_{ep}.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
        print(ep, res["status"], res.get("n", ""), res.get("message", ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
