"""ตรวจหา API พื้นที่เสี่ยงภัยแล้ง (DRI) ของ GISTDA — สำหรับวินิจฉัยเท่านั้น ไม่เขียนไฟล์ ไม่ commit

ทำไม: แท็บ "ภัยแล้ง" ต้องการชั้น DRI แต่ห้ามเดา endpoint/field (กฎ CLAUDE.md ข้อ 6) และเครื่องผู้พัฒนาเข้า opendata.gistda.or.th ไม่ได้
ขั้นตอน: ① ค้นชุดข้อมูลใน CKAN ของ opendata.gistda.or.th (คำค้น drought/ภัยแล้ง/DRI) → พิมพ์ชื่อชุดข้อมูล resource และ URL ของ api-gateway ที่พบ
         ② เรียก URL ของ api-gateway ที่เกี่ยวกับภัยแล้งด้วย header API-Key (เติมพิกัด ต.จันอัด ถ้ามี lat/lon) → พิมพ์สถานะ ชนิด และโครงสร้าง JSON (ปิดบัง key ทุกจุด)
env: GISTDA_API_KEY (Secret · ไม่มีก็ทำข้อ ① ได้) · จบ exit 0 เสมอ
"""
import json, os, re, sys, urllib.parse, urllib.request

KEY = os.environ.get("GISTDA_API_KEY", "").strip()
LAT, LON = 15.15629, 102.15786          # ต.จันอัด (จุดเดียวกับ ecmwf.json)
CKAN = "https://opendata.gistda.or.th/api/3/action/package_search?rows=30&q="
QUERIES = ["drought", "ภัยแล้ง", "DRI", "แล้ง"]
HINT = re.compile(r"(?i)drought|dri\b|dri[-_/]|แล้ง")


def red(s):
    s = str(s)
    if KEY:
        s = s.replace(KEY, "***")
    return re.sub(r"(?i)(api[-_]?key=)[^&\"'\s]+", r"\1***", s)


def get(url, headers=None, timeout=45):
    req = urllib.request.Request(url, headers={"User-Agent": "NRRU-SDSS-probe/1.0", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.headers.get("Content-Type", ""), r.read()


def shape(o, depth=0):
    if depth > 3:
        return "…"
    if isinstance(o, dict):
        return {k: shape(v, depth + 1) for k, v in list(o.items())[:25]}
    if isinstance(o, list):
        return [f"list[{len(o)}]", shape(o[0], depth + 1)] if o else "list[0]"
    return type(o).__name__ + (f"={str(o)[:40]}" if isinstance(o, (str, int, float)) else "")


def main():
    found = set()
    print("=== ① ชุดข้อมูลใน opendata.gistda.or.th ===")
    for q in QUERIES:
        try:
            st, ct, body = get(CKAN + urllib.parse.quote(q))
            res = json.loads(body.decode("utf-8", "replace")).get("result", {})
            print(f"\n[{st}] q={q} · {res.get('count')} ชุดข้อมูล")
            for p in res.get("results", []):
                if not HINT.search(json.dumps(p, ensure_ascii=False)):
                    continue
                print(f"  • {p.get('name')} — {p.get('title')}")
                for r in p.get("resources", []):
                    u = r.get("url") or ""
                    print(f"      - {r.get('name')} [{r.get('format')}] {red(u)[:200]}")
                    found.update(re.findall(r"https?://api-gateway\.gistda\.or\.th[^\s\"'<>]+", u))
                txt = json.dumps(p, ensure_ascii=False).replace("\\/", "/")
                found.update(re.findall(r"https?://api-gateway\.gistda\.or\.th[^\s\"'<>\\]+", txt))
                for r in p.get("resources", [])[:6]:     # หน้า resource มักมีตัวอย่าง URL ของ api-gateway
                    try:
                        pg = f"https://opendata.gistda.or.th/dataset/{p.get('name')}/resource/{r.get('id')}"
                        _, _, b = get(pg)
                        t = b.decode("utf-8", "replace").replace("\\/", "/").replace("&amp;", "&")
                        found.update(re.findall(r"https?://api-gateway\.gistda\.or\.th[^\s\"'<>]+", t))
                    except Exception as e:
                        print(f"      (อ่านหน้า resource ไม่ได้: {red(e)[:80]})")
        except Exception as e:
            print(f"[ERR] q={q} · {red(e)[:160]}")
    cand = sorted(u for u in found if HINT.search(u))
    print(f"\n=== URL ของ api-gateway ที่เกี่ยวกับภัยแล้ง ({len(cand)} จาก {len(found)}) ===")
    for u in cand:
        print("   ", red(u)[:240])
    if not KEY:
        print("\n(ข้าม ② — ไม่มี GISTDA_API_KEY)")
        return
    print("\n=== ② เรียก API (ผลดิบ ปิดบัง key) ===")
    for u in cand[:12]:
        url = re.sub(r"(?i)(api[-_]?key=)[^&]*&?", "", u).rstrip("?&")
        url = re.sub(r"(?i)\b(lat(?:itude)?=)[^&]*", rf"\g<1>{LAT}", url)
        url = re.sub(r"(?i)\b((?:lon|lng|longitude)=)[^&]*", rf"\g<1>{LON}", url)
        try:
            st, ct, body = get(url, {"API-Key": KEY})
            txt = body.decode("utf-8", "replace")
            print(f"\n[{st}] {ct} · {len(body)} bytes · {red(url)[:200]}")
            try:
                print("   โครงสร้าง:", red(json.dumps(shape(json.loads(txt)), ensure_ascii=False))[:1500])
            except Exception:
                print("   ข้อความ:", red(txt)[:600])
        except urllib.error.HTTPError as e:
            print(f"\n[HTTP {e.code}] {red(url)[:200]} · {red(e.read().decode('utf-8', 'replace'))[:300]}")
        except Exception as e:
            print(f"\n[ERR] {red(url)[:200]} · {red(e)[:200]}")


BBOX = (101.71793, 14.8793, 102.5855, 15.53446)      # 26 ตำบล + buffer (เดียวกับ thaiwater_region.json)
WMS = "https://api-gateway.gistda.or.th/api/2.0/resources/maps/dri/7days/wms"
TMS = "https://api-gateway.gistda.or.th/api/2.0/resources/maps/dri/7days/tms"
OUT = os.environ.get("OUT_DIR", "probe_out")


def wms_probe():
    """③ ชั้น DRI+: ชื่อชั้น/SRS/เวลา จาก GetCapabilities · legend · ภาพทดลองของพื้นที่ศึกษา (บันทึกเป็น artifact ไม่ commit)"""
    import xml.etree.ElementTree as ET
    os.makedirs(OUT, exist_ok=True)
    print("\n=== ③ DRI+ 7 วัน (WMS) ===")
    try:
        st, ct, body = get(WMS + "?service=WMS&request=GetCapabilities&version=1.1.1&api_key=" + urllib.parse.quote(KEY), {"API-Key": KEY})
        print("  capabilities (ตัดตอน):", red(body.decode("utf-8", "replace"))[:1500].replace("\n", " "))
        root = ET.fromstring(body)
        layers = []
        for ly in root.iter("Layer"):
            name = ly.findtext("Name")
            if not name:
                continue
            layers.append(name)
            print(f"  ชั้น: {name} · {ly.findtext('Title')}")
            print("     SRS:", [e.text for e in ly.findall("SRS")][:6])
            for d in list(ly.findall("Dimension")) + list(ly.findall("Extent")):
                print("     มิติ:", d.attrib, (d.text or "")[:200])
            for st_ in ly.findall("Style"):
                lu = st_.find("LegendURL/OnlineResource")
                print("     style:", st_.findtext("Name"), "· legend:", red(lu.attrib.get("{http://www.w3.org/1999/xlink}href", lu.attrib.get("href", "")) if lu is not None else "-")[:200])
            for bb in ly.findall("LatLonBoundingBox"):
                print("     bbox:", bb.attrib)
        fmts = [e.text for e in root.iter("Format")]
        print("  รูปแบบที่รองรับ:", sorted({f for f in fmts if f})[:12])
    except Exception as e:
        print("  [ERR] GetCapabilities", red(e)[:200]); return
    if not layers:
        return
    lyr = next((n for n in layers if "Root" not in n), layers[0])
    print("  ใช้ชั้น:", lyr)
    w, h = 1024, int(1024 * (BBOX[3] - BBOX[1]) / (BBOX[2] - BBOX[0]))
    qs = {"service": "WMS", "request": "GetMap", "version": "1.1.1", "layers": lyr, "styles": "", "srs": "EPSG:4326",
          "bbox": ",".join(map(str, BBOX)), "width": w, "height": h, "format": "image/png", "transparent": "true"}
    qs["api_key"] = KEY
    try:
        st, ct, body = get(WMS + "?" + urllib.parse.urlencode(qs), {"API-Key": KEY}, timeout=90)
        print(f"  GetMap [{st}] {ct} · {len(body)} bytes")
        if "image" in ct:
            open(os.path.join(OUT, "dri_studyarea.png"), "wb").write(body)
            try:
                from PIL import Image
                im = Image.open(os.path.join(OUT, "dri_studyarea.png")).convert("RGBA")
                cols = im.getcolors(1 << 20) or []
                cols = sorted(cols, reverse=True)[:12]
                print("  สีที่พบมากสุด (จำนวนพิกเซล, RGBA):", cols)
                # ต.จันอัด (ecmwf.json) → พิกเซล
                px = int((LON - BBOX[0]) / (BBOX[2] - BBOX[0]) * w); py = int((BBOX[3] - LAT) / (BBOX[3] - BBOX[1]) * h)
                print(f"  สีที่ ต.จันอัด ({px},{py}):", im.getpixel((px, py)))
            except Exception as e:
                print("  (อ่านภาพไม่ได้)", red(e)[:120])
        else:
            print("  ข้อความ:", red(body.decode("utf-8", "replace"))[:400])
    except urllib.error.HTTPError as e:
        print(f"  GetMap [HTTP {e.code}]", red(e.read().decode("utf-8", "replace"))[:300])
    except Exception as e:
        print("  [ERR] GetMap", red(e)[:200])
    for leg in [WMS + "?" + urllib.parse.urlencode({"service": "WMS", "request": "GetLegendGraphic", "version": "1.1.1", "layer": lyr, "format": "image/png", "api_key": KEY})]:
        try:
            st, ct, body = get(leg, {"API-Key": KEY})
            print(f"  GetLegendGraphic [{st}] {ct} · {len(body)} bytes")
            if "image" in ct:
                open(os.path.join(OUT, "dri_legend.png"), "wb").write(body)
            else:
                print("   ", red(body.decode("utf-8", "replace"))[:300])
        except urllib.error.HTTPError as e:
            print(f"  GetLegendGraphic [HTTP {e.code}]", red(e.read().decode("utf-8", "replace"))[:200])
        except Exception as e:
            print("  [ERR] legend", red(e)[:150])
    # TMS: ลองรูปแบบ path ทีละแบบ ที่ z=11 ครอบ ต.จันอัด (xyz และ tms y)
    import math
    z = 11; x = int((LON + 180) / 360 * 2 ** z); r = math.radians(LAT)
    y = int((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * 2 ** z); yt = 2 ** z - 1 - y
    for suf in [f"/{z}/{x}/{y}", f"/{z}/{x}/{y}.png", f"/{z}/{x}/{yt}", f"/{z}/{x}/{yt}.png"]:
        try:
            st, ct, body = get(TMS + suf + "?api_key=" + urllib.parse.quote(KEY), {"API-Key": KEY})
            print(f"  TMS {suf} [{st}] {ct} · {len(body)} bytes")
        except urllib.error.HTTPError as e:
            print(f"  TMS {suf} [HTTP {e.code}]", red(e.read().decode("utf-8", "replace"))[:120])
        except Exception as e:
            print(f"  TMS {suf} [ERR]", red(e)[:120])
    # ภัยแล้งซ้ำซากแบบพื้นที่ (รอบแรกได้ 503) — ห่อ Feature เหมือน flood-recurrence
    cell = [[102.13, 15.13], [102.15, 15.13], [102.15, 15.15], [102.13, 15.15], [102.13, 15.13]]
    feat = {"type": "Feature", "properties": {}, "geometry": {"type": "Polygon", "coordinates": [cell]}}
    url = "https://api-gateway.gistda.or.th/api/2.0/resources/gi-service/v1.1/disasters/drought-recurrence?area=" + urllib.parse.quote(json.dumps(feat, separators=(",", ":")))
    try:
        st, ct, body = get(url, {"API-Key": KEY}, timeout=90)
        j = json.loads(body.decode("utf-8", "replace"))
        print(f"  drought-recurrence area [{st}] · โครงสร้าง:", red(json.dumps(shape(j), ensure_ascii=False))[:800])
    except urllib.error.HTTPError as e:
        print(f"  drought-recurrence area [HTTP {e.code}]", red(e.read().decode("utf-8", "replace"))[:200])
    except Exception as e:
        print("  drought-recurrence area [ERR]", red(e)[:200])
    try:   # รายปีของจุด ต.จันอัด (รอบแรกเห็นแค่โครงสร้าง)
        st, ct, body = get(f"https://api-gateway.gistda.or.th/api/2.0/resources/gi-service/v1.1/disasters/drought-recurrence?lat={LAT}&lon={LON}", {"API-Key": KEY})
        print("  drought-recurrence จุด ต.จันอัด:", red(body.decode("utf-8", "replace"))[:400])
    except Exception as e:
        print("  [ERR] point", red(e)[:150])


if __name__ == "__main__":
    try:
        if os.environ.get("SKIP_SEARCH") != "1":
            main()
        if KEY:
            wms_probe()
    except Exception as e:
        print(f"::error::{red(e)[:300]}")
    sys.exit(0)
