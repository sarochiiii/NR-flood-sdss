"""ตรวจหา API พื้นที่การเกษตร (อ้อย มันสำปะหลัง ข้าวโพด ข้าว) ของ GISTDA — สำหรับวินิจฉัยเท่านั้น ไม่เขียนข้อมูล ไม่ commit

ทำไม: แท็บ "ภัยแล้ง" อาจเพิ่มชั้นพื้นที่การเกษตรแบบเดียวกับแผนที่ภัยแล้งของ GISTDA แต่ห้ามเดา endpoint/field (กฎ CLAUDE.md ข้อ 6)
ขั้นตอน: ① ค้นชุดข้อมูลใน CKAN ของ opendata.gistda.or.th (คำค้นพืช/เกษตร/การใช้ที่ดิน) → ชื่อชุดข้อมูล resource และ URL ที่พบ
         ② อ่านหน้าเว็บแผนที่ภัยแล้ง/ภัยพิบัติของ GISTDA และไฟล์ JS ที่หน้าโหลด → หา URL/path ที่เกี่ยวกับพืชหรือเกษตร
         ③ ไล่ STAC ของ api-gateway (root และ catalog ภัยแล้ง) → หา collection ที่เกี่ยวกับพืช
         ④ เรียกเฉพาะ URL ที่ค้นพบจริงจาก ①–③ และ cropsdrought zonal (พบใน CKAN รอบก่อน) → พิมพ์สถานะ ชนิด และโครงสร้าง
         ไม่สุ่มเดา path · ปิดบัง key ทุกจุด · ภาพตัวอย่างเก็บเป็น artifact 3 วัน ไม่ commit
env: GISTDA_API_KEY (Secret · ไม่มีก็ทำ ①–② ได้) · OUT_DIR (ค่าเริ่มต้น probe_out) · จบ exit 0 เสมอ
"""
import json, os, re, sys, urllib.parse, urllib.request

KEY = os.environ.get("GISTDA_API_KEY", "").strip()
OUT = os.environ.get("OUT_DIR", "probe_out")
LAT, LON = 15.15629, 102.15786          # ต.จันอัด (จุดเดียวกับ ecmwf.json)
CKAN = "https://opendata.gistda.or.th/api/3/action/package_search?rows=40&q="
QUERIES = ["เกษตร", "พืชเศรษฐกิจ", "อ้อย", "มันสำปะหลัง", "ข้าวโพด", "ข้าว", "crop", "agriculture", "sugarcane", "cassava", "maize", "rice", "land use"]
HINT = re.compile(r"(?i)crop|agri|sugar|cassava|maize|corn|rice|paddy|plant|landuse|land-use|เกษตร|อ้อย|มันสำปะหลัง|ข้าวโพด|ข้าว|พืช")
# หน้าเว็บของ GISTDA ที่อาจมีแผนที่ภัยแล้ง (ลองอ่าน · หน้าไหนเข้าไม่ได้ก็ข้าม)
PORTALS = ["https://drought.gistda.or.th/", "https://disaster.gistda.or.th/", "https://disaster.gistda.or.th/drought",
           "https://cropsdrought.gistda.or.th/", "https://opendata.gistda.or.th/"]
STAC = ["https://api-gateway.gistda.or.th/api/2.0/resources/stac", "https://api-gateway.gistda.or.th/api/2.0/resources/stac/drought",
        "https://api-gateway.gistda.or.th/api/2.0/resources/stac/drought/catalogs"]
ZONAL = ["https://cropsdrought.gistda.or.th/api/rest/zonal/province", "https://cropsdrought.gistda.or.th/api/rest/zonal/irrigation",
         "https://cropsdrought.gistda.or.th/api/rest/zonal/mainbasin"]
URLRE = re.compile(r"https?://[A-Za-z0-9.-]*gistda\.or\.th[^\s\"'<>`\\)]*")
PATHRE = re.compile(r"[\"'`](/(?:api|maps|resources|stac|v\d)[^\"'`\s]{2,160})[\"'`]")


def red(s):
    s = str(s)
    if KEY:
        s = s.replace(KEY, "***")
    return re.sub(r"(?i)(api[-_]?key=)[^&\"'\s]+", r"\1***", s)


def get(url, headers=None, timeout=45):
    h = {"User-Agent": "Mozilla/5.0 NRRU-SDSS-probe/1.0", **(headers or {})}
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.headers.get("Content-Type", ""), r.read()


def shape(o, depth=0):
    if depth > 3:
        return "…"
    if isinstance(o, dict):
        return {k: shape(v, depth + 1) for k, v in list(o.items())[:25]}
    if isinstance(o, list):
        return [f"list[{len(o)}]", shape(o[0], depth + 1)] if o else "list[0]"
    return type(o).__name__ + (f"={str(o)[:50]}" if isinstance(o, (str, int, float)) else "")


def ckan(found):
    print("=== ① ชุดข้อมูลใน opendata.gistda.or.th ===")
    seen = set()
    for q in QUERIES:
        try:
            st, ct, body = get(CKAN + urllib.parse.quote(q))
            res = json.loads(body.decode("utf-8", "replace")).get("result", {})
            print(f"\n[{st}] q={q} · {res.get('count')} ชุดข้อมูล")
            for p in res.get("results", []):
                if p.get("name") in seen or not HINT.search(json.dumps(p, ensure_ascii=False)):
                    continue
                seen.add(p.get("name"))
                print(f"  • {p.get('name')} — {p.get('title')} · องค์กร {(p.get('organization') or {}).get('title')} · ปรับปรุง {p.get('metadata_modified', '')[:10]}")
                notes = re.sub(r"\s+", " ", p.get("notes") or "")[:300]
                if notes:
                    print(f"      คำอธิบาย: {red(notes)}")
                for r in p.get("resources", [])[:10]:
                    u = r.get("url") or ""
                    print(f"      - {r.get('name')} [{r.get('format')}] {red(u)[:200]}")
                txt = json.dumps(p, ensure_ascii=False).replace("\\/", "/")
                found.update(URLRE.findall(txt))
                for r in p.get("resources", [])[:6]:     # หน้า resource มักมีตัวอย่าง URL ของ api-gateway
                    try:
                        _, _, b = get(f"https://opendata.gistda.or.th/dataset/{p.get('name')}/resource/{r.get('id')}")
                        found.update(URLRE.findall(b.decode("utf-8", "replace").replace("\\/", "/").replace("&amp;", "&")))
                    except Exception as e:
                        print(f"      (อ่านหน้า resource ไม่ได้: {red(e)[:80]})")
        except Exception as e:
            print(f"[ERR] q={q} · {red(e)[:160]}")


def portals(found, paths):
    print("\n=== ② หน้าเว็บ GISTDA และไฟล์ JS ===")
    for pg in PORTALS:
        try:
            st, ct, body = get(pg)
            html = body.decode("utf-8", "replace")
            title = re.search(r"<title>(.*?)</title>", html, re.S)
            scripts = re.findall(r"<script[^>]+src=[\"']([^\"']+)", html)
            print(f"\n[{st}] {pg} · {len(body)} bytes · title={title.group(1).strip()[:80] if title else '-'} · script {len(scripts)} ไฟล์")
            found.update(URLRE.findall(html))
            for s in scripts[:25]:
                u = urllib.parse.urljoin(pg, s)
                try:
                    _, _, jb = get(u, timeout=60)
                    js = jb.decode("utf-8", "replace").replace("\\/", "/")
                    us, ps = URLRE.findall(js), PATHRE.findall(js)
                    hit = sorted({x for x in us + ps if HINT.search(x)})
                    found.update(us); paths.update((pg, x) for x in ps if HINT.search(x))
                    # คำที่เกี่ยวกับพืชในโค้ด (ชื่อชั้น/ป้าย) — ช่วยหาว่าชั้นพื้นที่การเกษตรมาจากไหน
                    kw = sorted(set(m.group(0)[:120] for m in re.finditer(r"[^\"'`\n]{0,60}(?:อ้อย|มันสำปะหลัง|ข้าวโพด|sugarcane|cassava|maize)[^\"'`\n]{0,60}", js)))[:8]
                    print(f"   - {red(u)[:140]} · {len(jb)} bytes · URL/path ที่เกี่ยวกับพืช {len(hit)}")
                    for x in hit[:15]:
                        print(f"       {red(x)[:200]}")
                    for x in kw:
                        print(f"       คำ: {red(x)}")
                except Exception as e:
                    print(f"   - {red(u)[:140]} (อ่านไม่ได้: {red(e)[:80]})")
        except Exception as e:
            print(f"\n[ERR] {pg} · {red(e)[:120]}")


def stac(found):
    print("\n=== ③ STAC ของ api-gateway ===")
    if not KEY:
        print("(ข้าม — ไม่มี GISTDA_API_KEY)"); return
    for u in STAC:
        try:
            st, ct, body = get(u, {"API-Key": KEY})
            j = json.loads(body.decode("utf-8", "replace"))
            links = [l for l in (j.get("links") or []) if isinstance(l, dict)] if isinstance(j, dict) else []
            print(f"\n[{st}] {u} · id={j.get('id') if isinstance(j, dict) else '-'} · links {len(links)}")
            for l in links[:60]:
                h = l.get("href", "")
                print(f"   {l.get('rel')} · {l.get('title') or ''} · {red(h)[:160]}")
                if HINT.search(h + " " + str(l.get("title") or "")):
                    found.add(h)
        except urllib.error.HTTPError as e:
            print(f"\n[HTTP {e.code}] {u} · {red(e.read().decode('utf-8', 'replace'))[:160]}")
        except Exception as e:
            print(f"\n[ERR] {u} · {red(e)[:160]}")


def call(cand):
    print(f"\n=== ④ เรียก URL ที่ค้นพบ ({len(cand)}) ===")
    os.makedirs(OUT, exist_ok=True)
    for i, u in enumerate(cand[:25]):
        url = re.sub(r"(?i)(api[-_]?key=)[^&]*&?", "", u).rstrip("?&")
        url = re.sub(r"(?i)\b(lat(?:itude)?=)[^&]*", rf"\g<1>{LAT}", url)
        url = re.sub(r"(?i)\b((?:lon|lng|longitude)=)[^&]*", rf"\g<1>{LON}", url)
        if "{" in url:
            print(f"\n[ข้าม · มีตัวแปร] {red(url)[:200]}"); continue
        hdr = {"API-Key": KEY} if KEY and "api-gateway" in url else {}
        try:
            st, ct, body = get(url, hdr, timeout=60)
            print(f"\n[{st}] {ct} · {len(body)} bytes · {red(url)[:200]}")
            if "image" in ct:
                open(os.path.join(OUT, f"agri_{i}.png"), "wb").write(body)
                continue
            txt = body.decode("utf-8", "replace")
            try:
                j = json.loads(txt)
                print("   โครงสร้าง:", red(json.dumps(shape(j), ensure_ascii=False))[:1500])
                if isinstance(j, list) and j and isinstance(j[0], dict):   # หาแถวนครราชสีมาถ้ามี
                    nr = [r for r in j if "นครราชสีมา" in json.dumps(r, ensure_ascii=False)][:2]
                    for r in nr:
                        print("   แถวนครราชสีมา:", red(json.dumps(r, ensure_ascii=False))[:600])
            except Exception:
                print("   ข้อความ:", red(txt)[:500].replace("\n", " "))
        except urllib.error.HTTPError as e:
            print(f"\n[HTTP {e.code}] {red(url)[:200]} · {red(e.read().decode('utf-8', 'replace'))[:200]}")
        except Exception as e:
            print(f"\n[ERR] {red(url)[:200]} · {red(e)[:160]}")


def main():
    found, paths = set(), set()
    ckan(found)
    portals(found, paths)
    stac(found)
    cand = sorted({u.rstrip(".,;") for u in found if HINT.search(u)} | set(ZONAL))
    print(f"\n=== URL ที่เกี่ยวกับพืช/เกษตร ({len(cand)} จาก {len(found)}) ===")
    for u in cand:
        print("   ", red(u)[:240])
    print(f"\n=== path ในโค้ดหน้าเว็บที่เกี่ยวกับพืช ({len(paths)}) ===")
    for pg, p in sorted(paths)[:40]:
        print(f"    {pg} → {red(p)[:200]}")
    call(cand)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"::error::{red(e)[:300]}")
    sys.exit(0)
