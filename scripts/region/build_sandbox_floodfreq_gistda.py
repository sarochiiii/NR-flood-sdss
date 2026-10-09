"""น้ำท่วมซ้ำซากจาก API ของ GISTDA (ผลิตภัณฑ์เดียวกับภาพ tile) → region/data/sandbox/floodfreq.geojson  {properties: {freq}}

แทนชั้น FloodGCS (Earth Engine) ตั้งแต่ 9 ต.ค. 69 — ตรวจพบว่า FloodGCS นับสูงกว่า GISTDA ~2 ขั้น ณ จุดเดียวกัน (docs/sandbox.md)
API: GET https://api-gateway.gistda.or.th/api/2.0/resources/gi-service/v1.1/disasters/flood-recurrence?area={GeoJSON Feature}
     header API-Key · ตอบ [{subdistrict_name, district_name, province_name, total, detail:[{year, freq}×13 ปี 2011–2023], area, geom}]
     (ตรวจโครงสร้างด้วย scripts/region/probe_gistda_area.py · ส่ง geometry เปล่าได้ 503 ต้องห่อเป็น Feature)
พื้นที่: กรอบ ต.จันอัด (301010) ∪ รัศมี 1.5 กม. รอบบ้านด่านติง → ตาราง 0.01° ทีละช่อง → dissolve ตาม total → ตัดตามกรอบ → simplify ~3 ม.
เรียกไม่สำเร็จแม้ช่องเดียว (หลังลองซ้ำ) → ไม่เขียนทับไฟล์เดิม (ข้อมูลไม่ครบอันตรายกว่า) · พิมพ์ ::error:: · จบ exit 0
env: GISTDA_API_KEY (Secret) · OUT (ค่าเริ่มต้น region/data/sandbox/floodfreq.geojson) · ต้องมี shapely
"""
import json, math, os, re, sys, time, urllib.parse, urllib.request
from _common import ROOT, now_iso

KEY = os.environ.get("GISTDA_API_KEY", "").strip()
BASE = "https://api-gateway.gistda.or.th/api/2.0/resources/gi-service/v1.1/disasters/flood-recurrence"
TCODE, DT, RADIUS_KM, STEP = "301010", (102.13359, 15.14223), 1.5, 0.01   # DT เหมือน chanat/index.html
OUT = os.environ.get("OUT") or str(ROOT / "data/sandbox/floodfreq.geojson")
KX, KY = 111320 * math.cos(15.15 * math.pi / 180), 110540


def red(s):
    s = str(s)
    if KEY:
        s = s.replace(KEY, "***")
    return re.sub(r"(?i)(api[-_]?key=)[^&\"'\s]+", r"\1***", s)


def call(cell):
    feat = {"type": "Feature", "properties": {}, "geometry": {"type": "Polygon", "coordinates": [cell]}}
    url = BASE + "?area=" + urllib.parse.quote(json.dumps(feat, separators=(",", ":")))
    last = None
    for i in range(4):
        try:
            req = urllib.request.Request(url, headers={"API-Key": KEY, "User-Agent": "NRRU-SDSS/1.0"})
            with urllib.request.urlopen(req, timeout=120) as r:
                j = json.loads(r.read().decode("utf-8", "replace"))
            if isinstance(j, dict) and j.get("result") == "not found":
                return []
            if isinstance(j, list):
                return j
            last = f"รูปแบบไม่คาดคิด: {red(json.dumps(j, ensure_ascii=False))[:150]}"
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code} {red(e.read().decode('utf-8', 'replace'))[:120]}"
        except Exception as e:
            last = red(e)[:150]
        time.sleep(3 * (i + 1))
    raise RuntimeError(last)


def main():
    if not KEY:
        print("::error::ไม่มี GISTDA_API_KEY"); return
    try:
        from shapely.geometry import shape, box, mapping
        from shapely.ops import unary_union
    except ImportError:
        print("::error::ต้องติดตั้ง shapely"); return
    tb = next(f for f in json.loads((ROOT / "data/tambon.geojson").read_text(encoding="utf-8"))["features"] if f["properties"]["tcode"] == TCODE)
    tbg = shape(tb["geometry"])
    dl, dn = RADIUS_KM * 1000 / KY, RADIUS_KM * 1000 / KX
    x0, y0, x1, y1 = tbg.bounds
    x0, y0, x1, y1 = min(x0, DT[0] - dn), min(y0, DT[1] - dl), max(x1, DT[0] + dn), max(y1, DT[1] + dl)
    aoi = box(x0, y0, x1, y1)
    nx, ny = math.ceil((x1 - x0) / STEP), math.ceil((y1 - y0) / STEP)
    print(f"กรอบ {x0:.5f},{y0:.5f} – {x1:.5f},{y1:.5f} · {nx}×{ny} = {nx * ny} ช่อง")
    by = {}      # total → [geometry]
    years, n_raw = set(), 0
    for i in range(nx):
        for j in range(ny):
            a, b = x0 + i * STEP, y0 + j * STEP
            cell = [[a, b], [a + STEP, b], [a + STEP, b + STEP], [a, b + STEP], [a, b]]
            try:
                rows = call(cell)
            except Exception as e:
                print(f"::error::ช่อง {i},{j} เรียกไม่สำเร็จ ({e}) — ไม่เขียนทับไฟล์เดิม"); return
            for r in rows:
                g, t = r.get("geom"), r.get("total")
                if not g or t is None:
                    continue
                n_raw += 1
                years.update(d.get("year") for d in (r.get("detail") or []))
                try:
                    by.setdefault(int(t), []).append(shape(g).buffer(0))
                except Exception:
                    pass
            time.sleep(0.3)
    if not by:
        print("::error::ไม่พบ polygon น้ำท่วมซ้ำซากในพื้นที่ — คงไฟล์เดิม"); return
    feats, cnt = [], {}
    rnd = lambda c: [rnd(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 5), round(c[1], 5)]
    for t in sorted(by):
        if t <= 0:
            continue
        u = unary_union(by[t]).intersection(aoi).simplify(0.00003, preserve_topology=True)
        if u.is_empty:
            continue
        for g in (u.geoms if hasattr(u, "geoms") else [u]):
            if g.geom_type not in ("Polygon", "MultiPolygon") or g.area <= 0:
                continue
            m = mapping(g)
            feats.append({"type": "Feature", "properties": {"freq": t}, "geometry": {"type": m["type"], "coordinates": rnd(m["coordinates"])}})
            cnt[str(t)] = cnt.get(str(t), 0) + 1
    yrs = sorted(y for y in years if y)
    out = {"type": "FeatureCollection", "updated_at": now_iso(),
           "source": f"GISTDA น้ำท่วมซ้ำซาก (API flood-recurrence v1.1 · ปี {yrs[0] if yrs else '?'}–{yrs[-1] if yrs else '?'} · field total)",
           "years": yrs, "tcode": TCODE, "max_freq": max(int(k) for k in cnt), "count_by_freq": cnt, "raw_polygons": n_raw, "features": feats}
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"บันทึก {len(feats)} polygon (จาก {n_raw} polygon ดิบ) · จำนวนครั้ง {cnt} · ปี {yrs} · {os.path.getsize(OUT) / 1e6:.2f} MB → {OUT}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"::error::{red(e)[:300]}")
    sys.exit(0)
