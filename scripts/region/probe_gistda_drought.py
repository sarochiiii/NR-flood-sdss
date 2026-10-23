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


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"::error::{red(e)[:300]}")
    sys.exit(0)
