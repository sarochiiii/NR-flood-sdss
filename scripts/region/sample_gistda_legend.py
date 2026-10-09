"""วินิจฉัย legend ภาพน้ำท่วมซ้ำซากของ GISTDA (tile ผ่าน Worker gistda-tile-proxy) — ไม่เขียนไฟล์ใน repo · พิมพ์ผลใน log + artifact

GISTDA ไม่มีตาราง legend สี→จำนวนครั้งเผยแพร่ → อนุมานจากข้อมูลจริง 2 ทาง
  ก. สีพิกเซลของ tile z15 ใน ต.จันอัด × ค่า freq ของ FloodGCS (region/data/sandbox/floodfreq.geojson) ที่ตำแหน่งเดียวกัน
  ข. สีพิกเซล × ค่าจาก API จุดพิกัด "ข้อมูลพื้นที่น้ำท่วมซ้ำซาก" ของ GISTDA (ผลิตภัณฑ์เดียวกับ tile) — ยังไม่รู้ชื่อ parameter/field
     จึงลองหลายรูปแบบและพิมพ์ผลดิบ (ปิดบัง key) เพื่อยืนยันก่อนใช้ ห้ามเดา
env: GISTDA_API_KEY (ข้อ ข · ไม่มี = ข้าม) · TILE_BASE (ค่าเริ่มต้น Worker) · ZOOM (15) · STEP (เก็บตัวอย่างทุก N พิกเซล · 8)
ต้องมี Pillow · จบ exit 0 เสมอ
"""
import io, json, math, os, re, sys, urllib.parse, urllib.request
from collections import Counter, defaultdict
from _common import ROOT

TILE_BASE = os.environ.get("TILE_BASE", "https://gistda-tile-proxy.sarochinee-k.workers.dev").rstrip("/")
Z, STEP, TCODE = int(os.environ.get("ZOOM", "15")), int(os.environ.get("STEP", "8")), "301010"
KEY = os.environ.get("GISTDA_API_KEY", "").strip()
POINT_URLS = [   # ตามหน้า opendata.gistda.or.th dataset disasters-01 (resource "ค้นหาด้วยจุดพิกัด") — ชื่อ parameter ยังไม่ยืนยัน
    "https://api-gateway.gistda.or.th/api/2.0/resources/gi-service/v1.0/disasters/flood-recurrence?lat={lat}&lon={lon}",
    "https://api-gateway.gistda.or.th/api/2.0/resources/gi-service/v1.0/disasters/flood-recurrence?latitude={lat}&longitude={lon}",
    "https://api-gateway.gistda.or.th/api/2.0/resources/gi-service/v1.0/disasters/flood-recurrence?lng={lon}&lat={lat}",
]


def red(s):   # ปิดบัง key ในทุกข้อความที่พิมพ์ (GISTDA ใส่ key ใน links[] ของบาง response)
    s = str(s)
    if KEY:
        s = s.replace(KEY, "***")
    return re.sub(r"(?i)(api[-_]?key=)[^&\"'\s]+", r"\1***", s)


def get(url, headers=None, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": "NRRU-SDSS-legend/1.0", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.headers.get("Content-Type", ""), r.read()


def lon2x(lon, z): return (lon + 180) / 360 * 2 ** z
def lat2y(lat, z): r = math.radians(lat); return (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * 2 ** z
def x2lon(x, z): return x / 2 ** z * 360 - 180
def y2lat(y, z): return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / 2 ** z))))


def in_ring(x, y, r):
    c, j = False, len(r) - 1
    for i in range(len(r)):
        xi, yi, xj, yj = r[i][0], r[i][1], r[j][0], r[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            c = not c
        j = i
    return c


def polys_of(g): return [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"] if g["type"] == "MultiPolygon" else []
def in_polys(x, y, P): return any(in_ring(x, y, p[0]) and not any(in_ring(x, y, h) for h in p[1:]) for p in P)
def is_bg(r, g, b): return r > 200 and g > 200 and b > 200 and max(r, g, b) - min(r, g, b) < 14   # เหมือน isBg ใน chanat/index.html
def hexc(c): return "#%02X%02X%02X" % c[:3]


def main():
    try:
        from PIL import Image
    except ImportError:
        print("::error::ต้องติดตั้ง Pillow"); return
    tambon = json.loads((ROOT / "data/tambon.geojson").read_text(encoding="utf-8"))
    tb = next(f for f in tambon["features"] if f["properties"]["tcode"] == TCODE)
    TB = polys_of(tb["geometry"])
    xs = [c[0] for p in TB for c in p[0]]; ys = [c[1] for p in TB for c in p[0]]
    x0, x1 = int(lon2x(min(xs), Z)), int(lon2x(max(xs), Z))
    y0, y1 = int(lat2y(max(ys), Z)), int(lat2y(min(ys), Z))
    ffj = json.loads((ROOT / "data/sandbox/floodfreq.geojson").read_text(encoding="utf-8"))
    FF = []
    for f in ffj["features"]:
        P = polys_of(f["geometry"])
        if P:
            bx = [c[0] for p in P for c in p[0]]; by = [c[1] for p in P for c in p[0]]
            FF.append((int(f["properties"]["freq"]), P, (min(bx), min(by), max(bx), max(by))))

    def ff_at(lon, lat):
        m = 0
        for fr, P, bb in FF:
            if fr > m and bb[0] <= lon <= bb[2] and bb[1] <= lat <= bb[3] and in_polys(lon, lat, P):
                m = fr
        return m

    print(f"tile z{Z} x {x0}–{x1} · y {y0}–{y1} ({(x1 - x0 + 1) * (y1 - y0 + 1)} แผ่น) · ตัวอย่างทุก {STEP} พิกเซล")
    colors, bycol, samples, modes, nok = Counter(), defaultdict(Counter), defaultdict(list), Counter(), 0
    alphas = defaultdict(Counter)
    for tx in range(x0, x1 + 1):
        for ty in range(y0, y1 + 1):
            try:
                st, ct, body = get(f"{TILE_BASE}/floodfreq/{Z}/{tx}/{ty}.png")
            except Exception as e:
                print(f"  tile {tx}/{ty}: {red(e)[:120]}"); continue
            if st != 200 or not body:
                print(f"  tile {tx}/{ty}: HTTP {st} {ct}"); continue
            nok += 1
            im = Image.open(io.BytesIO(body)); modes[im.mode] += 1
            im = im.convert("RGBA"); W, H = im.size; px = im.load()
            for py in range(STEP // 2, H, STEP):
                for pxx in range(STEP // 2, W, STEP):
                    lon, lat = x2lon(tx + pxx / W, Z), y2lat(ty + py / H, Z)
                    if not in_polys(lon, lat, TB):
                        continue
                    r, g, b, a = px[pxx, py]
                    key = "transparent" if a < 20 else "bg" if is_bg(r, g, b) else hexc((r, g, b))
                    colors[key] += 1
                    alphas[key][a // 32 * 32] += 1
                    bycol[key][ff_at(lon, lat)] += 1
                    if key not in ("transparent", "bg") and len(samples[key]) < 60:
                        samples[key].append((round(lat, 6), round(lon, 6)))
    print(f"โหลด tile ได้ {nok} แผ่น · โหมดภาพ {dict(modes)}")
    tot = sum(colors.values()) or 1
    print("\n=== ก. สีพิกเซลใน ต.จันอัด (เรียงตามจำนวน) × freq ของ FloodGCS ที่ตำแหน่งเดียวกัน ===")
    print("สี        สัดส่วน   freq FloodGCS (0 = นอก polygon): จำนวนพิกเซล")
    top = [k for k, _ in colors.most_common(30)]
    for k in top:
        d = bycol[k]; n = sum(d.values())
        mode = max(d, key=d.get)
        print(f"{k:12s} {colors[k] * 100 / tot:5.1f}%  ฐานนิยม freq={mode} ({d[mode] * 100 / n:.0f}%) · " + " ".join(f"{f}:{c}" for f, c in sorted(d.items()))
              + f" · alpha {dict(sorted(alphas[k].items()))}")
    print("\n=== ก. กลับด้าน: แต่ละ freq ของ FloodGCS เห็นเป็นสีใดบนภาพ GISTDA ===")
    byf = defaultdict(Counter)
    for k, d in bycol.items():
        for f, c in d.items():
            byf[f][k] += c
    for f in sorted(byf):
        n = sum(byf[f].values())
        print(f"freq {f}: " + " · ".join(f"{k} {c * 100 / n:.0f}%" for k, c in byf[f].most_common(5)))

    out = {"zoom": Z, "step": STEP, "tiles_ok": nok, "colors": dict(colors.most_common(60)),
           "by_color_floodgcs": {k: dict(bycol[k]) for k in top}, "point_api": {}}
    # หา path จริงของ API จุดพิกัดจากหน้า opendata ของ GISTDA (เครื่องผู้พัฒนาเข้าไม่ได้ · Actions เข้าได้)
    print("\n=== URL ของ api-gateway ที่พบในหน้า opendata.gistda.or.th (dataset disasters-01) ===")
    found = []
    for pg in ["https://opendata.gistda.or.th/dataset/disasters-01",
               "https://opendata.gistda.or.th/dataset/disasters-01/resource/6533f035-7b40-47ba-ad62-5d99fa4969e4",
               "https://opendata.gistda.or.th/dataset/disasters-01/resource/4e84d399-740b-48d9-a8d9-6a0a556f3464",
               "https://opendata.gistda.or.th/dataset/disasters-01/resource/bd53012a-7e73-4170-beaa-18980396d923",
               "https://opendata.gistda.or.th/api/3/action/package_show?id=disasters-01"]:
        try:
            st, ct, body = get(pg)
            txt = body.decode("utf-8", "replace").replace("\\/", "/").replace("&amp;", "&")
            urls = sorted(set(re.findall(r"https?://api-gateway\.gistda\.or\.th[^\s\"'<>]+", txt)))
            print(f"[{st}] {pg} · {len(urls)} URL"); [print("   ", red(u)[:220]) for u in urls[:20]]
            found += urls
            for m in re.finditer(r"(?i)(legend|สัญลักษณ์|ระดับ|ครั้ง)[^<]{0,160}", txt):
                print("    ข้อความ:", red(m.group(0))[:160])
        except Exception as e:
            print(f"[ERR] {pg} · {red(e)[:150]}")
    for u in sorted(set(found)):
        if "recurr" in u or "repeat" in u or "flood-freq" in u:
            q = re.sub(r"(?i)(lat(?:itude)?=)[^&]*", r"\g<1>{lat}", u)
            q = re.sub(r"(?i)((?:lon|lng|longitude)=)[^&]*", r"\g<1>{lon}", q)
            q = re.sub(r"(?i)(api[-_]?key=)[^&]*&?", "", q).rstrip("?&")
            if "{lat}" in q and q not in POINT_URLS:
                POINT_URLS.insert(0, q)
    if not KEY:
        print("\n(ข้าม ข. — ไม่มี GISTDA_API_KEY)")
    else:
        print("\n=== ข. API จุดพิกัดของ GISTDA (ผลดิบ ปิดบัง key) ===")
        good = None
        lat0, lon0 = samples[top[0]][0] if top and samples.get(top[0]) else (15.14223, 102.13359)
        for u in POINT_URLS:
            url = u.format(lat=lat0, lon=lon0)
            try:
                st, ct, body = get(url, {"API-Key": KEY})
                txt = body.decode("utf-8", "replace")
                print(f"[{st}] {red(url)}\n  {ct} · {red(txt)[:700]}")
                if st == 200 and txt.strip().startswith(("{", "[")):
                    good = u; break
            except urllib.error.HTTPError as e:
                print(f"[{e.code}] {red(url)} · {red(e.read().decode('utf-8', 'replace'))[:300]}")
            except Exception as e:
                print(f"[ERR] {red(url)} · {red(e)[:200]}")
        if good:
            print("\nเรียก API ที่จุดตัวอย่างสูงสุด 10 จุดต่อสี (สีที่มี ≥ 15 พิกเซล) → นับค่า total")
            raw_shown = False
            for k in [c for c in top if c not in ("transparent", "bg") and colors[c] >= 15] + \
                     [c for c in colors if c not in top and c not in ("transparent", "bg") and colors[c] >= 15]:
                tl = Counter()
                pts = samples[k][:: max(1, len(samples[k]) // 10)][:10]
                for lat, lon in pts:
                    try:
                        st, ct, body = get(good.format(lat=lat, lon=lon), {"API-Key": KEY})
                        j = json.loads(body.decode("utf-8", "replace"))
                        if isinstance(j, list) and j and "total" in j[0]:
                            tl[j[0]["total"]] += 1
                            if not raw_shown:
                                print("ตัวอย่างผลเต็ม 1 รายการ:", red(json.dumps(j[0], ensure_ascii=False))[:900]); raw_shown = True
                        else:
                            tl["ไม่พบ"] += 1
                    except Exception as e:
                        tl["ERR"] += 1
                out["point_api"][k] = dict(tl)
                print(f"  {k} ({colors[k]} px · alpha {dict(alphas[k])}): total {dict(sorted(tl.items(), key=lambda x: str(x[0])))}")
    p = os.environ.get("OUT", "/tmp/gistda_legend.json")
    with open(p, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    print(f"\nบันทึก {p}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"::error::{red(e)[:300]}")
    sys.exit(0)
