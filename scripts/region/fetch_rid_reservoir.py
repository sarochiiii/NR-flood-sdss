"""ดึงข้อมูลอ่างเก็บน้ำขนาดกลาง จ.นครราชสีมา จากระบบฐานข้อมูลน้ำในอ่างเก็บน้ำ กรมชลประทาน

POST https://app.rid.go.th/reservoir/api/rsvmiddles
  form: date=YYYY-MM-DD, region=ne, percent=, percent_from=, percent_to=, status=1
  → {date, year_prev, region: [{region_name_th, reservoir: [ {...} ]}], sum: {...}}
  รายอ่าง: cresv (rsv292), date (null = วันนี้ยังไม่บันทึก), nresv, cresv_lat/lng, tprov, cap_resv, low_qdisc,
           qdisc_curr, percent_resv_curr, qdisc_prev, percent_resv_prev, q_info, jan_info, q_outfo, water_workable
  ตัวเลขเป็นข้อความมีจุลภาค ("2,208.830") และ " - " = ไม่มีข้อมูล
  (ตรวจกับข้อมูลจริง 28 ก.ย. 2569 · CORS *)

ผลลัพธ์: region/data/live/rid_reservoir.json
  items[]  ค่าล่าสุดรายอ่าง · hist{code: [[date, curr, pct, prev_pct, q_in, q_out, workable]]} เก็บ 400 วัน
ดึงไม่เกินทุก 3 ชั่วโมง (ข้อมูลอ่างบันทึกวันละครั้ง) เพื่อไม่เป็นภาระต่อ server ของกรมชลประทาน
"""
import json, urllib.request, urllib.parse, datetime as dt
from _common import now_iso, read, write

URL = "https://app.rid.go.th/reservoir/api/rsvmiddles"
PROVINCE = "นครราชสีมา"
TZ = dt.timezone(dt.timedelta(hours=7))
MIN_GAP_H = 3
KEEP_DAYS = 400
OUT = "rid_reservoir.json"


def n(v):
    s = str(v if v is not None else "").replace(",", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def main():
    prev = read(OUT)
    if prev.get("status") == "ok" and prev.get("updated_at"):
        age = (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(prev["updated_at"])).total_seconds() / 3600
        if age < MIN_GAP_H:
            print(f"rid: ข้าม (ดึงล่าสุด {age:.1f} ชม. ก่อน)"); return 0
    today = dt.datetime.now(TZ).strftime("%Y-%m-%d")
    form = {"date": today, "region": "ne", "percent": "", "percent_from": "", "percent_to": "", "status": "1"}
    hist = prev.get("hist", {})
    try:
        req = urllib.request.Request(URL, data=urllib.parse.urlencode(form).encode(),
                                     headers={"User-Agent": "NRRU-Region-SDSS/1.0 (research)", "Accept": "application/json",
                                              "Content-Type": "application/x-www-form-urlencoded"})
        with urllib.request.urlopen(req, timeout=90) as r:
            body = json.loads(r.read())
        items = []
        for reg in body.get("region") or []:
            for x in reg.get("reservoir") or []:
                if x.get("tprov") != PROVINCE:
                    continue
                it = {"code": x.get("cresv"), "name": x.get("nresv"), "lat": n(x.get("cresv_lat")), "lon": n(x.get("cresv_lng")),
                      "date": x.get("date"), "cap": n(x.get("cap_resv")), "low": n(x.get("low_qdisc")),
                      "storage": n(x.get("qdisc_curr")), "pct": n(x.get("percent_resv_curr")),
                      "prev": n(x.get("qdisc_prev")), "pct_prev": n(x.get("percent_resv_prev")),
                      "inflow": n(x.get("q_info")), "release": n(x.get("q_outfo")), "jan_inflow": n(x.get("jan_info")),
                      "workable": n(x.get("water_workable")), "project": x.get("project_name")}
                items.append(it)
                if it["date"] and it["pct"] is not None:              # เก็บประวัติเฉพาะวันที่มีการบันทึก
                    h = [r for r in hist.get(it["code"], []) if r[0] != it["date"]]
                    h.append([it["date"], it["storage"], it["pct"], it["pct_prev"], it["inflow"], it["release"], it["workable"]])
                    cut = (dt.date.fromisoformat(it["date"]) - dt.timedelta(days=KEEP_DAYS)).isoformat()
                    hist[it["code"]] = sorted(r for r in h if r[0] >= cut)
        write(OUT, {"status": "ok", "updated_at": now_iso(), "query_date": today, "source": "กรมชลประทาน app.rid.go.th/reservoir",
                    "items": items, "hist": hist}, indent=None)
        ok = sum(1 for i in items if i["date"])
        print(f"rid: {len(items)} อ่างใน {PROVINCE} · บันทึกวันนี้ {ok} อ่าง")
    except Exception as err:
        prev.update({"status": "error", "message": f"{type(err).__name__}: {str(err)[:150]}"})
        write(OUT, prev, indent=None)
        print("rid error:", type(err).__name__)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
