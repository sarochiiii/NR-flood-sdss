"""ค่าร่วมของสคริปต์ข้อมูลสด: path, การเขียนไฟล์ และขอบเขตพื้นที่ศึกษา (bbox + buffer)"""
import json, pathlib, datetime as dt

ROOT = pathlib.Path(__file__).resolve().parents[2] / "region"
LIVE = ROOT / "data/live"
CFG = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))


def now_iso():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def read(name, default=None):
    p = LIVE / name
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else (default or {})


def write(name, obj, indent=1):
    (LIVE / name).write_text(json.dumps(obj, ensure_ascii=False, indent=indent,
                             separators=None if indent else (",", ":")), encoding="utf-8")


def region_bbox(buffer_deg=None):
    """bbox ของสองอำเภอ ขยายด้วย buffer (องศา) — คืน (minx, miny, maxx, maxy)"""
    b = CFG["layers"]["station_buffer_deg"] if buffer_deg is None else buffer_deg
    xs, ys = [], []
    def walk(c):
        if isinstance(c[0], (int, float)):
            xs.append(c[0]); ys.append(c[1])
        else:
            for x in c: walk(x)
    for f in json.loads((ROOT / "data/amphoe.geojson").read_text(encoding="utf-8"))["features"]:
        walk(f["geometry"]["coordinates"])
    return min(xs) - b, min(ys) - b, max(xs) + b, max(ys) + b


def num(x):
    try:
        v = float(x)
        return v if v == v else None
    except (TypeError, ValueError):
        return None
