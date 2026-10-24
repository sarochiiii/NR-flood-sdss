"""พื้นที่ปลูกพืชเศรษฐกิจปัจจุบันจาก API ของ GISTDA → region/data/crops.geojson  {properties: {crop, update}} + สรุปรายตำบล (by_tambon)

API: GET https://api-gateway.gistda.or.th/api/2.0/resources/gi-service/v2.2/agriculture/check-crop?area={GeoJSON Feature}
     header API-Key · ตอบ [{result: ชื่อพืช (เช่น "Rice"), update: "YYYY-MM-DD", geom: [geometry, …]}] หรือ {"result": "Data was not found."}
     (ตรวจ 23 ต.ค. 69 ด้วย scripts/region/probe_gistda_agri.py: กรอบ 0.02° ได้ผล · กรอบ 0.08° ไม่ได้ JSON → ต้องแบ่งช่องเล็ก)
     ข้อมูลราย 2 สัปดาห์ 40 ม. (ชุด "พื้นที่ปลูกพืชเศรษฐกิจ 6 ชนิด (ล่าสุด)" ใน opendata.gistda.or.th)
พื้นที่: 26 ตำบล (region/data/tambon.geojson) → ตาราง STEP° (เฉพาะช่องที่แตะตำบล) → dissolve ตามชนิดพืช → ตัดตามขอบเขต 26 ตำบล → simplify ~10 ม.
รอบข้อมูล: check-crop คืนแปลงที่ update ต่างกัน (ม.ค. 2568 – ล่าสุด) ถ้ารวมทุกรอบพื้นที่ข้าวสูงเกินจริง (ต.จันอัด ~92% ของตำบล · อาคาร 33% อยู่ใน "ข้าว")
     → ใช้เฉพาะแปลงในรอบข้อมูลล่าสุดของแต่ละพืช (update สูงสุดของพืชนั้น · ผู้ใช้กำหนด 24 ต.ค. 69) · พิมพ์พื้นที่ทุกรอบไว้ใน log/all_rounds_rai เพื่อตรวจสอบ
สรุปรายตำบล: พื้นที่ (ไร่) ตามชนิดพืช คำนวณจาก geometry เอง (ไม่ใช้ field area ของ API เพราะเอกสารไม่ระบุหน่วย) · ไม่บันทึกขนาดพื้นที่ตำบล (ผู้ใช้กำหนด)
ชื่อพืชเก็บตามที่ API ส่งมา (ไม่แปล/ไม่เดา) · หน้าเว็บแปลเป็นไทยเฉพาะชื่อที่ตรวจแล้ว
เก็บเฉพาะ ข้าว อ้อย มันสำปะหลัง ข้าวโพด (KEEP · ผู้ใช้กำหนด 24 ต.ค. 69) — ตัดยางพารา/ปาล์มน้ำมัน (รายปี · พบเพียงไม่กี่ไร่ใน 26 ตำบล)
เรียกไม่สำเร็จแม้ช่องเดียว (หลังลองซ้ำ) → ไม่เขียนทับไฟล์เดิม · พิมพ์ ::error:: · จบ exit 0
ผลรอบแรก (24 ต.ค. 69): ชื่อพืช Cassava · Maize · Oil palm · Para rubber · Rice · Sugarcane · update ของแต่ละแปลงต่างกัน (ปี 2023 ถึงวันที่ล่าสุด)
     · 322 คำขอ ~15 นาที · ไฟล์ ~2.8 MB → เขียนสรุปรายตำบลแยกเป็น crops_summary.json (เล็ก) ให้รายงานบนเว็บโหลดเร็ว
env: GISTDA_API_KEY (Secret) · OUT (ค่าเริ่มต้น region/data/crops.geojson · สรุปเขียนข้างกันชื่อ crops_summary.json) · STEP (ค่าเริ่มต้น 0.02) · WORKERS (คำขอพร้อมกัน ค่าเริ่มต้น 6)
     BUDGET_MIN (เวลาสูงสุด นาที ค่าเริ่มต้น 45 · เกินแล้วหยุดโดยไม่เขียนทับไฟล์) · ต้องมี shapely
รอบแรก (24 ต.ค. 69) เรียกทีละช่องเกิน 40 นาที → เรียกพร้อมกันหลายช่อง และพิมพ์ความคืบหน้าระหว่างทาง (python -u)
"""
import json, math, os, re, sys, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from _common import ROOT, now_iso

KEY = os.environ.get("GISTDA_API_KEY", "").strip()
BASE = "https://api-gateway.gistda.or.th/api/2.0/resources/gi-service/v2.2/agriculture/check-crop"
OUT = os.environ.get("OUT") or str(ROOT / "data/crops.geojson")
STEP = float(os.environ.get("STEP") or 0.02)
WORKERS = int(os.environ.get("WORKERS") or 6)
BUDGET = float(os.environ.get("BUDGET_MIN") or 45) * 60
KX, KY = 111320 * math.cos(15.2 * math.pi / 180), 110540   # ม./องศา ที่ละติจูดพื้นที่ศึกษา
RAI = 1600.0
KEEP = {"Rice", "Sugarcane", "Cassava", "Maize"}               # ชื่อตามที่ API ส่งมา (ตรวจแล้ว 24 ต.ค. 69)                                                 # ตร.ม. ต่อไร่


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
            with urllib.request.urlopen(req, timeout=90) as r:
                j = json.loads(r.read().decode("utf-8", "replace"))
            if isinstance(j, dict) and re.search(r"(?i)not found", str(j.get("result", ""))):
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
    cells = []
    for i in range(nx):
        for j in range(ny):
            a, b = x0 + i * STEP, y0 + j * STEP
            if box(a, b, a + STEP, b + STEP).intersects(aoi):
                cells.append(((i, j), [[a, b], [a + STEP, b], [a + STEP, b + STEP], [a, b + STEP], [a, b]]))
    print(f"เรียก {len(cells)} ช่อง · พร้อมกัน {WORKERS} คำขอ · เวลาสูงสุด {BUDGET / 60:.0f} นาที", flush=True)
    by, updates, n_raw, n_call, t0 = {}, set(), 0, 0, time.time()
    ex = ThreadPoolExecutor(WORKERS)
    futs = {ex.submit(call, c): ij for ij, c in cells}
    for fu in as_completed(futs):
        if time.time() - t0 > BUDGET:
            print(f"::error::เกินเวลา {BUDGET / 60:.0f} นาที ({n_call}/{len(cells)} ช่อง) — ไม่เขียนทับไฟล์เดิม", flush=True)
            ex.shutdown(wait=False, cancel_futures=True); return
        try:
            rows = fu.result(); n_call += 1
        except Exception as e:
            print(f"::error::ช่อง {futs[fu]} เรียกไม่สำเร็จ ({e}) — ไม่เขียนทับไฟล์เดิม", flush=True)
            ex.shutdown(wait=False, cancel_futures=True); return
        for r in rows:
            c, gs = r.get("result"), r.get("geom")
            if not c or not gs or c not in KEEP:
                continue
            if r.get("update"):
                updates.add(r["update"])
            for g in (gs if isinstance(gs, list) else [gs]):
                try:
                    by.setdefault((str(c), str(r.get("update") or "")), []).append(shape(g).buffer(0)); n_raw += 1
                except Exception:
                    pass
        if n_call % 25 == 0:
            print(f"  … {n_call}/{len(cells)} ช่อง · {time.time() - t0:.0f} วินาที · พืช {sorted({c for c, _ in by})}", flush=True)
    ex.shutdown()
    print(f"เรียกครบ {n_call} ช่อง · {time.time() - t0:.0f} วินาที · กำลังรวม polygon …", flush=True)
    if not by:
        print("::error::ไม่พบพื้นที่ปลูกพืชในพื้นที่ — คงไฟล์เดิม"); return
    m2 = lambda g: scale(g, KX, KY, origin=(0, 0)).area
    rnd = lambda c: [rnd(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 5), round(c[1], 5)]
    # พื้นที่ทุกรอบ (ตรวจสอบเท่านั้น) และรอบล่าสุดของแต่ละพืช ("2023" < "2025-01-15" เทียบแบบข้อความได้)
    all_rounds = {}
    for (c, up), gs in sorted(by.items()):
        a = round(m2(unary_union(gs).intersection(aoi)) / RAI)
        if a > 0:
            all_rounds.setdefault(c, {})[up] = a
    latest = {c: max(r) for c, r in all_rounds.items()}
    print("พื้นที่ทุกรอบ (ไร่ · 26 ตำบล):", json.dumps(all_rounds, ensure_ascii=False))
    print("รอบล่าสุดที่ใช้:", latest, flush=True)
    feats, unions, total = [], {}, {}
    for c in sorted(latest):
        u = unary_union(by[(c, latest[c])]).intersection(aoi)
        if u.is_empty:
            continue
        unions[c] = u
        total[c] = round(m2(u) / RAI)
        s = u.simplify(0.0001, preserve_topology=True)
        for g in (s.geoms if hasattr(s, "geoms") else [s]):
            if g.geom_type not in ("Polygon", "MultiPolygon") or g.area <= 0:
                continue
            m = mapping(g)
            feats.append({"type": "Feature", "properties": {"crop": c, "update": latest[c]}, "geometry": {"type": m["type"], "coordinates": rnd(m["coordinates"])}})
    by_tambon = {}
    for f in tbs:
        p, tg = f["properties"], tgeo[f["properties"]["tcode"]]
        rai = {c: round(m2(u.intersection(tg)) / RAI) for c, u in unions.items() if u.intersects(tg)}
        by_tambon[p["tcode"]] = {"name": p["name"], "amphoe": p["amphoe"], "crops_rai": {c: v for c, v in rai.items() if v > 0}}
    out = {"type": "FeatureCollection", "updated_at": now_iso(),
           "source": "GISTDA พื้นที่ปลูกพืชเศรษฐกิจ 6 ชนิด (ล่าสุด) · API check-crop v2.2 · ราย 2 สัปดาห์ 40 ม.",
           "data_updates": sorted(updates), "latest": latest, "all_rounds_rai": all_rounds,
           "crops": sorted(unions), "total_rai": total, "raw_polygons": n_raw, "calls": n_call,
           "by_tambon": by_tambon, "features": feats}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    summ = {k: v for k, v in out.items() if k not in ("type", "features")}
    with open(os.path.join(os.path.dirname(OUT), "crops_summary.json"), "w", encoding="utf-8") as fh:
        json.dump(summ, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"บันทึก {len(feats)} polygon (จาก {n_raw} ดิบ · {n_call} คำขอ · {time.time() - t0:.0f} วินาที) · {os.path.getsize(OUT) / 1e6:.2f} MB → {OUT}")
    print(f"ชื่อพืชที่ API ส่งมา: {sorted(unions)} · วันที่ข้อมูล {sorted(updates)}")
    print(f"พื้นที่รวม 26 ตำบล (ไร่): {total}")
    for k, v in sorted(by_tambon.items()):
        print(f"  {k} {v['name']:<12} {v['crops_rai']}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"::error::{red(e)[:300]}")
    sys.exit(0)
