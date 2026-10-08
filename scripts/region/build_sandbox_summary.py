"""สรุปอาคารที่สัมผัสภัย บ้านด่านติง / ต.จันอัด → region/data/sandbox/summary.json (ใช้ในรายงาน "รายงานบ้านด่านติง" ของ LINE OA และหน้า /chanat/)

คำนวณวิธีเดียวกับแผง SDSS ใน chanat/index.html ทุกขั้น (ต้องแก้คู่กัน):
  อาคาร Open Buildings (region/data/bldg) · จุดกึ่งกลาง = ค่าเฉลี่ยจุดยอด · ใน ต.จันอัด (NR_admin3 301010) หรือในรัศมี RADIUS_KM จาก DT
  ระยะถึงลำน้ำ = ระยะเส้นตรงแบบ equirectangular (KX, KY เดียวกับเว็บ) ถึงเส้น OSM ประเภท river (สายหลัก) / river+canal
  น้ำท่วมซ้ำซาก = ค่า freq สูงสุดของ polygon FloodGCS (region/data/sandbox/floodfreq.geojson) ที่ครอบจุดกึ่งกลาง
ค่าเริ่มต้นของแผง SDSS: ระยะ ≤ 300 ม. (สายหลัก) · ซ้ำซาก ≥ 1 ครั้ง → นับ both / ff / buf / none เหมือน legend บนเว็บ
ไม่มีข้อมูลครัวเรือน (อาคารคือรูปหลังคาจากภาพดาวเทียม) · ไม่ใช้เครือข่าย · ไฟล์ input ไม่ครบ → พิมพ์ ::error:: และไม่เขียนทับไฟล์เดิม (exit 0)
รันโดย workflow sandbox-summary (หลัง sandbox-layers / osm-rivers) หรือรันเองในเครื่อง
"""
import json, math
from _common import ROOT, now_iso

TCODE = "301010"
DT = {"lat": 15.14223, "lon": 102.13359, "name": "บ้านด่านติง (ประมาณจากกลุ่มอาคาร)"}   # เหมือน DT ใน chanat/index.html
RADIUS_KM = 1.5
BUF_DEFAULT, FREQ_DEFAULT = 300, 1
NEAR = (100, 300)              # ระยะที่รายงาน (ม.)
KX, KY = 111320 * math.cos(15.15 * math.pi / 180), 110540
OUT = ROOT / "data/sandbox/summary.json"


def dist(a, b, c, d):
    return math.hypot((c - a) * KX, (d - b) * KY)


def seg_dist(px, py, ax, ay, bx, by):
    x, y, dx, dy = (px - ax) * KX, (py - ay) * KY, (bx - ax) * KX, (by - ay) * KY
    l2 = dx * dx + dy * dy
    t = max(0.0, min(1.0, (x * dx + y * dy) / l2)) if l2 else 0.0
    return math.hypot(x - t * dx, y - t * dy)


def in_ring(x, y, r):
    c, j = False, len(r) - 1
    for i in range(len(r)):
        xi, yi = r[i][0], r[i][1]
        xj, yj = r[j][0], r[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            c = not c
        j = i
    return c


def polys_of(g):
    return [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"] if g["type"] == "MultiPolygon" else []


def in_polys(x, y, P):
    return any(in_ring(x, y, p[0]) and not any(in_ring(x, y, h) for h in p[1:]) for p in P)


def bbox_of(P):
    xs = [c[0] for p in P for c in p[0]]
    ys = [c[1] for p in P for c in p[0]]
    return min(xs), min(ys), max(xs), max(ys)


def load(p):
    try:
        return json.loads((ROOT / p).read_text(encoding="utf-8"))
    except Exception:
        return None


def main():
    tambon, idx, rivers, ff = load("data/tambon.geojson"), load("data/bldg/index.json"), load("data/osm_rivers.geojson"), load("data/sandbox/floodfreq.geojson")
    if not (tambon and idx and rivers):
        print("::error::ไฟล์ขอบเขตตำบล/อาคาร/ลำน้ำไม่ครบ — คงไฟล์ summary เดิม"); return
    tb = next((f for f in tambon["features"] if f["properties"]["tcode"] == TCODE), None)
    if not tb:
        print("::error::ไม่พบ ต.จันอัด ใน tambon.geojson"); return
    TB = polys_of(tb["geometry"])
    tbb = bbox_of(TB)
    dlat, dlon = RADIUS_KM * 1000 / KY, RADIUS_KM * 1000 / KX
    cbb = (DT["lon"] - dlon, DT["lat"] - dlat, DT["lon"] + dlon, DT["lat"] + dlat)
    hit = lambda b, bb: not (b[2] < bb[0] or b[0] > bb[2] or b[3] < bb[1] or b[1] > bb[3])

    B = []
    for code, v in idx["tiles"].items():
        if not (hit(v["bbox"], tbb) or hit(v["bbox"], cbb)):
            continue
        t = load(f"data/bldg/{code}.json")
        if not t:
            continue
        s = t["s"]
        for e in t["p"]:
            x, y = e[0], e[1]
            r = [(x / s, y / s)]
            for i in range(2, len(e), 2):
                x += e[i]; y += e[i + 1]
                r.append((x / s, y / s))
            cx, cy = sum(p[0] for p in r) / len(r), sum(p[1] for p in r) / len(r)
            in_tb, in_c = in_polys(cx, cy, TB), dist(DT["lon"], DT["lat"], cx, cy) <= RADIUS_KM * 1000
            if in_tb or in_c:
                B.append({"x": cx, "y": cy, "in_tb": in_tb, "in_c": in_c})
    if not B:
        print("::error::ไม่พบอาคารในพื้นที่"); return

    # ส่วนของเส้นลำน้ำใกล้พื้นที่ (กรองด้วยกรอบอาคาร + 0.03° เหมือนเว็บ)
    pad = 0.03
    bx0, by0 = min(b["x"] for b in B) - pad, min(b["y"] for b in B) - pad
    bx1, by1 = max(b["x"] for b in B) + pad, max(b["y"] for b in B) + pad
    def segs(types):
        out = []
        for f in rivers["features"]:
            if f["properties"].get("type") not in types or f["geometry"]["type"] != "LineString":
                continue
            c = f["geometry"]["coordinates"]
            for i in range(1, len(c)):
                ax, ay, bx, by = c[i - 1][0], c[i - 1][1], c[i][0], c[i][1]
                if max(ax, bx) < bx0 or min(ax, bx) > bx1 or max(ay, by) < by0 or min(ay, by) > by1:
                    continue
                out.append((ax, ay, bx, by))
        return out
    S1, S2 = segs(("river",)), segs(("river", "canal"))

    FF = []
    if ff and ff.get("features"):
        for f in ff["features"]:
            P = polys_of(f["geometry"])
            if P:
                FF.append((int(f["properties"]["freq"]), P, bbox_of(P)))
    for b in B:
        b["d_river"] = min((seg_dist(b["x"], b["y"], *s) for s in S1), default=math.inf)
        b["d_all"] = min((seg_dist(b["x"], b["y"], *s) for s in S2), default=math.inf)
        m = 0
        for fr, P, bb in FF:
            if fr > m and bb[0] <= b["x"] <= bb[2] and bb[1] <= b["y"] <= bb[3] and in_polys(b["x"], b["y"], P):
                m = fr
        b["freq"] = m if FF else None

    def summ(rows):
        n = len(rows)
        near = {str(d): sum(1 for b in rows if b["d_river"] <= d) for d in NEAR}
        hist = {}
        for b in rows:
            if b["freq"]:
                hist[str(b["freq"])] = hist.get(str(b["freq"]), 0) + 1
        ffc = lambda k: sum(1 for b in rows if b["freq"] is not None and b["freq"] >= k)
        cls = {"both": 0, "ff": 0, "buf": 0, "none": 0}
        for b in rows:
            nr, fl = b["d_river"] <= BUF_DEFAULT, b["freq"] is not None and b["freq"] >= FREQ_DEFAULT
            cls["both" if nr and fl else "ff" if fl else "buf" if nr else "none"] += 1
        # จำนวนที่ใกล้ลำน้ำ ≤ 300 ม. และท่วมซ้ำ ≥ 3 ครั้ง — ช่วงเชิงพรรณนาสำหรับรายงาน (FloodGCS คลุม ~97% ของตำบล ค่า ≥ 1 จึงแยกแยะไม่ได้) ไม่ใช่เกณฑ์ทางการ
        near_ff3 = sum(1 for b in rows if b["d_river"] <= BUF_DEFAULT and b["freq"] is not None and b["freq"] >= 3) if FF else None
        return {"n": n, "near_river": near, "near300_ff3": near_ff3, "ff_ge": {str(k): ffc(k) for k in (1, 3, 5)} if FF else None,
                "freq_hist": dict(sorted(hist.items(), key=lambda kv: int(kv[0]))) if FF else None, "cls": cls}

    out = {
        "updated_at": now_iso(), "tcode": TCODE, "center": DT, "radius_km": RADIUS_KM,
        "params": {"buf_m": BUF_DEFAULT, "freq_min": FREQ_DEFAULT, "river_types": ["river"], "near_m": list(NEAR)},
        "inputs": {"buildings": idx.get("source", "Open Buildings"), "rivers_updated_at": rivers.get("updated_at"),
                   "floodfreq_updated_at": ff.get("updated_at") if ff else None, "floodfreq_source": ff.get("source") if ff else None,
                   "max_freq": max((x[0] for x in FF), default=None)},
        "village": summ([b for b in B if b["in_c"]]),
        "tambon": summ([b for b in B if b["in_tb"]]),
        "note": "อาคาร = รูปหลังคาจากภาพดาวเทียม (Open Buildings) ไม่ใช่ครัวเรือน · ศูนย์กลางบ้านด่านติงประมาณจากกลุ่มอาคาร ยังไม่ยืนยันกับ อบต.",
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"บันทึก {OUT.name}: รอบบ้านด่านติง {out['village']['n']} หลัง {out['village']['cls']} · ทั้งตำบล {out['tambon']['n']} หลัง {out['tambon']['cls']}")


if __name__ == "__main__":
    main()
