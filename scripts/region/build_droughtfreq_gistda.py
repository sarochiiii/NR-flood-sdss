"""ภัยแล้งซ้ำซากจาก API ของ GISTDA → region/data/droughtfreq.geojson  {properties: {freq}} + สรุปรายตำบล (by_tambon)

API: GET https://api-gateway.gistda.or.th/api/2.0/resources/gi-service/v1.1/disasters/drought-recurrence?area={GeoJSON Feature}
     header API-Key · ตอบ [{subdistrict_name, district_name, province_name, total, detail:[{year, freq}×6 ปี 2018–2023], area, geom}]
     (ตรวจโครงสร้าง 23 ต.ค. 69 ด้วย scripts/region/probe_gistda_drought.py: geom = patch ที่ถูกตัดตามกรอบที่ส่งไป · โครงสร้างเดียวกับ flood-recurrence)
พื้นที่: 26 ตำบล (region/data/tambon.geojson) → ตาราง STEP° ทีละช่อง → dissolve ตาม total → ตัดตามขอบเขต 26 ตำบล → simplify ~20 ม.
สรุปรายตำบล: สัดส่วนพื้นที่ตำบลตามจำนวนครั้ง (ใช้ขอบเขตตำบลของโครงการ ไม่ใช้ชื่อตำบลที่ GISTDA ติดมากับ patch)
เรียกไม่สำเร็จแม้ช่องเดียว (หลังลองซ้ำ) → ไม่เขียนทับไฟล์เดิม · พิมพ์ ::error:: · จบ exit 0
env: GISTDA_API_KEY (Secret) · OUT (ค่าเริ่มต้น region/data/droughtfreq.geojson) · STEP (ค่าเริ่มต้น 0.05) · ต้องมี shapely
"""
import json, math, os, re, sys, time, urllib.parse, urllib.request
from _common import ROOT, now_iso

KEY = os.environ.get("GISTDA_API_KEY", "").strip()
BASE = "https://api-gateway.gistda.or.th/api/2.0/resources/gi-service/v1.1/disasters/drought-recurrence"
OUT = os.environ.get("OUT") or str(ROOT / "data/droughtfreq.geojson")
STEP = float(os.environ.get("STEP") or 0.05)
KX, KY = 111320 * math.cos(15.2 * math.pi / 180), 110540   # ม./องศา ที่ละติจูดพื้นที่ศึกษา


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
        from shapely.affinity import scale
    except ImportError:
        print("::error::ต้องติดตั้ง shapely"); return
    tbs = json.loads((ROOT / "data/tambon.geojson").read_text(encoding="utf-8"))["features"]
    tgeo = {f["properties"]["tcode"]: shape(f["geometry"]).buffer(0) for f in tbs}
    aoi = unary_union(list(tgeo.values()))
    x0, y0, x1, y1 = aoi.bounds
    nx, ny = math.ceil((x1 - x0) / STEP), math.ceil((y1 - y0) / STEP)
    print(f"กรอบ 26 ตำบล {x0:.4f},{y0:.4f} – {x1:.4f},{y1:.4f} · {nx}×{ny} = {nx * ny} ช่อง (ข้ามช่องที่ไม่แตะตำบล)")
    by, years, n_raw, n_call = {}, set(), 0, 0
    for i in range(nx):
        for j in range(ny):
            a, b = x0 + i * STEP, y0 + j * STEP
            if not box(a, b, a + STEP, b + STEP).intersects(aoi):
                continue
            cell = [[a, b], [a + STEP, b], [a + STEP, b + STEP], [a, b + STEP], [a, b]]
            try:
                rows = call(cell); n_call += 1
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
        print("::error::ไม่พบ polygon ภัยแล้งซ้ำซากในพื้นที่ — คงไฟล์เดิม"); return
    # พื้นที่ (ตร.กม.) โดยประมาณ: ปรับสเกลองศา → เมตร ที่ละติจูดพื้นที่ศึกษา
    km2 = lambda g: scale(g, KX / 1000, KY / 1000, origin=(0, 0)).area
    rnd = lambda c: [rnd(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 5), round(c[1], 5)]
    feats, cnt, union_by = [], {}, {}
    for t in sorted(by):
        if t <= 0:
            continue
        u = unary_union(by[t]).intersection(aoi)
        if u.is_empty:
            continue
        union_by[t] = u
        s = u.simplify(0.0002, preserve_topology=True)
        for g in (s.geoms if hasattr(s, "geoms") else [s]):
            if g.geom_type not in ("Polygon", "MultiPolygon") or g.area <= 0:
                continue
            m = mapping(g)
            feats.append({"type": "Feature", "properties": {"freq": t}, "geometry": {"type": m["type"], "coordinates": rnd(m["coordinates"])}})
            cnt[str(t)] = cnt.get(str(t), 0) + 1
    by_tambon = {}
    for f in tbs:
        p, tg = f["properties"], tgeo[f["properties"]["tcode"]]
        ta = km2(tg)
        share = {str(t): round(km2(u.intersection(tg)) / ta, 4) for t, u in union_by.items() if u.intersects(tg)}
        share = {k: v for k, v in share.items() if v >= 0.0005}
        dom = max(share, key=share.get) if share else None
        by_tambon[p["tcode"]] = {"name": p["name"], "amphoe": p["amphoe"], "area_km2": round(ta, 2), "share": share,
                                 "mode": int(dom) if dom else 0, "covered": round(sum(share.values()), 4)}
    yrs = sorted(y for y in years if y)
    out = {"type": "FeatureCollection", "updated_at": now_iso(),
           "source": f"GISTDA ภัยแล้งซ้ำซาก (API drought-recurrence v1.1 · ปี {yrs[0] if yrs else '?'}–{yrs[-1] if yrs else '?'} · field total)",
           "years": yrs, "max_freq": max(int(k) for k in cnt), "count_by_freq": cnt, "raw_polygons": n_raw, "calls": n_call,
           "by_tambon": by_tambon, "features": feats}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    ca = by_tambon.get("301010", {})
    print(f"บันทึก {len(feats)} polygon (จาก {n_raw} polygon ดิบ · {n_call} คำขอ) · จำนวนครั้ง {cnt} · ปี {yrs} · {os.path.getsize(OUT) / 1e6:.2f} MB → {OUT}")
    print(f"ต.จันอัด: {ca}")
    for k, v in sorted(by_tambon.items()):
        print(f"  {k} {v['name']:<12} mode={v['mode']} share={v['share']}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"::error::{red(e)[:300]}")
    sys.exit(0)
