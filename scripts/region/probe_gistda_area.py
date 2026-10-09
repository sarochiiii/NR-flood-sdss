"""ตรวจโครงสร้างผลของ API "ข้อมูลพื้นที่น้ำท่วมซ้ำซาก ค้นหาด้วยขอบเขต geometry" ของ GISTDA ก่อนใช้แทน FloodGCS (ห้ามเดา field)
GET https://api-gateway.gistda.or.th/api/2.0/resources/gi-service/v1.1/disasters/flood-recurrence?area={GeoJSON} · header API-Key
(รูปแบบ URL จากหน้า opendata.gistda.or.th dataset disasters-01 — ตรวจด้วย workflow gistda-legend 8 ต.ค. 69)
พิมพ์เฉพาะโครงสร้าง (ปิดบัง key) · ไม่เขียนไฟล์ใน repo · จบ exit 0 เสมอ
"""
import json, os, re, sys, urllib.parse, urllib.request
from _common import ROOT

KEY = os.environ.get("GISTDA_API_KEY", "").strip()
BASE = "https://api-gateway.gistda.or.th/api/2.0/resources/gi-service/v1.1/disasters/flood-recurrence"


def red(s):
    s = str(s)
    if KEY:
        s = s.replace(KEY, "***")
    return re.sub(r"(?i)(api[-_]?key=)[^&\"'\s]+", r"\1***", s)


def shape(o, d=0):
    """สรุปโครงสร้าง JSON (ชื่อ key ชนิด ตัวอย่างค่า) โดยไม่พิมพ์ข้อมูลทั้งก้อน"""
    p = "  " * d
    if isinstance(o, dict):
        for k, v in list(o.items())[:25]:
            if isinstance(v, (dict, list)):
                print(f"{p}{k}: {type(v).__name__}({len(v)})"); shape(v, d + 1) if d < 4 else None
            else:
                print(f"{p}{k}: {red(json.dumps(v, ensure_ascii=False))[:120]}")
    elif isinstance(o, list) and o:
        print(f"{p}[0] จาก {len(o)} รายการ"); shape(o[0], d + 1) if d < 4 else None


def main():
    if not KEY:
        print("::error::ไม่มี GISTDA_API_KEY"); return
    lat, lon, r = 15.14223, 102.13359, 0.004   # กรอบเล็ก ~900 ม. รอบบ้านด่านติง (DT ใน chanat/index.html)
    tests = {
        "polygon เล็ก (geometry)": {"type": "Polygon", "coordinates": [[[lon - r, lat - r], [lon + r, lat - r], [lon + r, lat + r], [lon - r, lat + r], [lon - r, lat - r]]]},
    }
    tb = next(f for f in json.loads((ROOT / "data/tambon.geojson").read_text(encoding="utf-8"))["features"] if f["properties"]["tcode"] == "301010")
    xs = [c[0] for p in ([tb["geometry"]["coordinates"]] if tb["geometry"]["type"] == "Polygon" else tb["geometry"]["coordinates"]) for c in p[0]]
    ys = [c[1] for p in ([tb["geometry"]["coordinates"]] if tb["geometry"]["type"] == "Polygon" else tb["geometry"]["coordinates"]) for c in p[0]]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    tests["กรอบ ต.จันอัด (geometry)"] = {"type": "Polygon", "coordinates": [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]}
    tests["polygon เล็ก (Feature)"] = {"type": "Feature", "properties": {}, "geometry": tests["polygon เล็ก (geometry)"]}
    for name, g in tests.items():
        url = BASE + "?area=" + urllib.parse.quote(json.dumps(g, separators=(",", ":")))
        try:
            req = urllib.request.Request(url, headers={"API-Key": KEY, "User-Agent": "NRRU-SDSS-probe/1.0"})
            with urllib.request.urlopen(req, timeout=120) as resp:
                st, ct, body = resp.status, resp.headers.get("Content-Type", ""), resp.read()
        except urllib.error.HTTPError as e:
            print(f"\n[{e.code}] {name} · {red(e.read().decode('utf-8', 'replace'))[:300]}"); continue
        except Exception as e:
            print(f"\n[ERR] {name} · {red(e)[:200]}"); continue
        txt = body.decode("utf-8", "replace")
        print(f"\n[{st}] {name} · {ct} · {len(body):,} ไบต์")
        try:
            j = json.loads(txt)
        except Exception:
            print("  ไม่ใช่ JSON:", red(txt)[:300]); continue
        shape(j, 1)
        feats = j.get("features") if isinstance(j, dict) else None
        if isinstance(feats, list):
            gt, tv = {}, {}
            for f in feats:
                t = (f.get("geometry") or {}).get("type"); gt[t] = gt.get(t, 0) + 1
                for k, v in (f.get("properties") or {}).items():
                    if isinstance(v, (int, float)) and k.lower() in ("total", "freq", "count", "repeat", "times", "value"):
                        tv.setdefault(k, {}); tv[k][v] = tv[k].get(v, 0) + 1
            print(f"  features {len(feats)} · geometry {gt} · ค่าตัวเลข {tv}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"::error::{red(e)[:300]}")
    sys.exit(0)
