"""ดึงพื้นที่น้ำท่วมรอบ 7 วันล่าสุดจาก GISTDA API gateway (เฉพาะ จ.นครราชสีมา) แล้วเก็บเฉพาะขอบเขตศึกษา + buffer

GET {BASE}/features/flood/7days?pv_idn=30&limit=1000&offset=N   header "API-Key"
ซองข้อมูล: {type, features[], links[], numberMatched, numberReturned, timeStamp}
feature.properties: pv_idn, ap_idn, tb_idn, pv_tn, ap_tn, tb_tn, f_area (ตร.ม.), h3_address, file_name, _createdAt,
                    building, population, school, hospital, length_road (ข้อมูลผู้รับผลกระทบในเซลล์ ที่ GISTDA คำนวณให้)
ตรวจกับ response จริง 27 ก.ย. 2569: pv_idn=30 ใช้ได้, numberMatched = จำนวนเซลล์ทั้งจังหวัด
geometry: เซลล์ H3 ที่ตรวจพบน้ำ

ข้อควรระวัง: links[] ของต้นทางมี API key ติดมาใน URL — สคริปต์นี้ไม่อ่าน ไม่เก็บ และไม่พิมพ์ links
และสร้าง URL หน้าถัดไปจาก offset เองเสมอ
ต้องมี Secret GISTDA_API_KEY (สมัครที่ https://api-gateway.gistda.or.th)
"""
import json, os, urllib.request, urllib.parse
from _common import CFG, now_iso, read, write, region_bbox

BASE = "https://api-gateway.gistda.or.th/api/2.0/resources/features/flood/7days"
PROVINCE = 30
LIMIT, MAX_PAGES = 1000, 100
STUDY_AMPHOE = {"3009", "3010"}          # โนนไทย, โนนสูง
OUT = "gistda_flood_7d.geojson"


def page(key, offset):
    q = urllib.parse.urlencode({"pv_idn": PROVINCE, "limit": LIMIT, "offset": offset})
    req = urllib.request.Request(f"{BASE}?{q}", headers={"API-Key": key, "User-Agent": "NRRU-Region-SDSS/1.0"})
    with urllib.request.urlopen(req, timeout=180) as r:
        b = json.loads(r.read())
    if "features" not in b:
        raise ValueError("ซองข้อมูลไม่มี features")
    return b["features"], b.get("numberMatched"), b.get("numberReturned", len(b["features"]))


def inside_bbox(geom, bb):
    def walk(c):
        if isinstance(c[0], (int, float)):
            yield c
        else:
            for x in c:
                yield from walk(x)
    return any(bb[0] <= x <= bb[2] and bb[1] <= y <= bb[3] for x, y in walk(geom["coordinates"]))


def main():
    key = os.environ.get("GISTDA_API_KEY", "").strip()
    prev = read(OUT, {"type": "FeatureCollection", "features": []})
    if not key:
        write(OUT, {"type": "FeatureCollection", "status": "not_configured", "updated_at": None, "features": []}, indent=None)
        print("gistda: not_configured"); return 0
    try:
        bb = region_bbox()
        feats, seen, images, by_tb = [], set(), set(), {}
        rai_in = rai_all = 0.0
        EXP = ("building", "population", "school", "hospital")
        exp_in = {k: 0 for k in EXP}
        offset, matched = 0, None
        for n in range(MAX_PAGES):
            rows, m, returned = page(key, offset)
            if n == 0:
                matched = m
            for f in rows:
                p, g = f.get("properties") or {}, f.get("geometry")
                h3 = p.get("h3_address")
                if not g or not h3 or h3 in seen:
                    continue
                seen.add(h3)
                ap = str(p.get("ap_idn") or "")
                tb = str(p.get("tb_idn") or "")
                a = float(p.get("f_area") or 0) / 1600      # ตร.ม. → ไร่
                rai_all += a
                study = ap in STUDY_AMPHOE
                for s in str(p.get("file_name") or "").split(","):
                    if s.strip():
                        images.add(s.strip())
                ex = {k: int(float(p.get(k) or 0)) for k in EXP}
                if study:
                    rai_in += a
                    by_tb[tb] = round(by_tb.get(tb, 0) + a, 1)
                    for k in EXP:
                        exp_in[k] += ex[k]
                if not (study or inside_bbox(g, bb)):
                    continue
                feats.append({"type": "Feature", "properties": {
                    "tb": tb, "tb_name": p.get("tb_tn"), "ap_name": p.get("ap_tn"),
                    "area_rai": round(a, 2), "img": p.get("file_name"), "in_area": study,
                    "bldg": ex["building"], "pop": ex["population"], "school": ex["school"], "hosp": ex["hospital"]},
                    "geometry": json.loads(json.dumps(g), parse_float=lambda x: round(float(x), 5))})
            offset += LIMIT
            if not rows or (returned or 0) < LIMIT or (matched is not None and offset >= matched):
                break
        write(OUT, {"type": "FeatureCollection", "status": "ok", "updated_at": now_iso(), "window": "7days",
                    "total_rai": round(rai_in), "province_rai": round(rai_all), "province_cells": matched,
                    "by_tambon": by_tb, "exposure": exp_in,
                    "images": sorted(images, key=lambda x: x.split("_", 1)[-1]), "features": feats}, indent=None)  # images เรียงตามเวลาถ่าย
        print(f"gistda: {len(seen)} เซลล์ทั้งจังหวัด · ในพื้นที่ {rai_in:,.0f} ไร่ ({len(by_tb)} ตำบล) · เก็บ {len(feats)} เซลล์")
    except Exception as err:
        prev.update({"status": "error", "message": type(err).__name__})
        write(OUT, prev, indent=None)
        print("gistda error:", type(err).__name__)   # ไม่พิมพ์รายละเอียด เพื่อไม่ให้ key หลุดใน log
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
