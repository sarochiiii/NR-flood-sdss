// gistda-tile-proxy · Cloudflare Worker (v1.2 · เพิ่ม TMS_Y)
// ส่งต่อ tile น้ำท่วมซ้ำซากของ GISTDA โดยเก็บ API key ไว้ฝั่ง Worker เท่านั้น
// ตั้งค่าใน Cloudflare → Worker → Settings → Variables and Secrets
//   GISTDA_API_KEY  (Secret)  key ของ GISTDA
//   UPSTREAM        (Text)    URL tile จากเอกสาร GISTDA ที่มี {z} {x} {y}
//                             น้ำท่วมซ้ำซาก: https://api-gateway.gistda.or.th/api/2.0/resources/maps/flood-freq/tms/{z}/{x}/{y}
//   ALLOWED_ORIGIN  (Text)    https://sarochiiii.github.io
//   TMS_Y           (Text)    "true" = แปลงแถวเป็นแบบ TMS (นับจากล่าง: y_tms = 2^z − 1 − y) — path ของ GISTDA มีคำว่า tms
//   SWAP_XY         (Text)    "true" = สลับ {x}/{y} ก่อนส่งต่อ (เอกสาร GISTDA เรียก x = row, y = column — ยังไม่ยืนยันกับ tile จริง)
// เรียกใช้: https://<worker>.workers.dev/floodfreq/{z}/{x}/{y}.png

const ZMIN = 8, ZMAX = 17;
// ขอบเขต 26 ตำบล อ.โนนไทย–โนนสูง (จาก region/data/tambon.geojson) + ขอบ 0.05°
const BBOX = { w: 101.82, s: 14.98, e: 102.49, n: 15.44 };
const CACHE_SEC = 7 * 24 * 3600; // ข้อมูลซ้ำซากเปลี่ยนไม่บ่อย

/** @param {number} lon @param {number} z */
const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
/** @param {number} lat @param {number} z */
const lat2y = (lat, z) => {
  const r = lat * Math.PI / 180;
  return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z);
};

/** @param {any} env */
function cors(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || 'https://sarochiiii.github.io',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Vary': 'Origin'
  };
}

export default {
  /** @param {Request} req @param {any} env @param {any} ctx */
  async fetch(req, env, ctx) {
    const h = cors(env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    if (req.method !== 'GET') return new Response('method not allowed', { status: 405, headers: h });

    const url = new URL(req.url);
    const m = url.pathname.match(/^\/floodfreq\/(\d{1,2})\/(\d+)\/(\d+)(?:\.png)?$/);
    if (!m) return new Response('not found', { status: 404, headers: h });
    const z = +m[1], x = +m[2], y = +m[3];

    // จำกัดซูมและพื้นที่ เพื่อไม่ให้ Worker กลายเป็น proxy สาธารณะที่ใช้โควตา key ของโครงการ
    if (z < ZMIN || z > ZMAX) return new Response('zoom out of range', { status: 400, headers: h });
    if (x < lon2x(BBOX.w, z) || x > lon2x(BBOX.e, z) || y < lat2y(BBOX.n, z) || y > lat2y(BBOX.s, z))
      return new Response(null, { status: 204, headers: h });

    if (!env.GISTDA_API_KEY || !env.UPSTREAM) return new Response('not_configured', { status: 500, headers: h });

    const cache = /** @type {any} */ (caches).default;
    const key = new Request(`https://cache.local/floodfreq/${z}/${x}/${y}.png`);
    const hit = await cache.match(key);
    if (hit) return new Response(hit.body, { status: hit.status, headers: { ...Object.fromEntries(hit.headers), ...h, 'X-Cache': 'HIT' } });

    // เส้นทางฝั่งเว็บเป็น XYZ มาตรฐานเสมอ · แปลงเฉพาะตอนส่งต่อ upstream (TMS_Y ก่อน แล้วจึง SWAP_XY)
    const yy = env.TMS_Y === 'true' ? 2 ** z - 1 - y : y;          // XYZ → TMS (กลับแกน y)
    const [ux, uy] = env.SWAP_XY === 'true' ? [yy, x] : [x, yy];
    const up = env.UPSTREAM.replace('{z}', String(z)).replace('{x}', String(ux)).replace('{y}', String(uy));
    let r;
    try {
      r = await fetch(up, { headers: { 'API-Key': env.GISTDA_API_KEY, 'Accept': 'image/png' } });
    } catch (e) {
      return new Response('upstream_unreachable', { status: 502, headers: h });
    }
    const ct = r.headers.get('Content-Type') || '';
    if (!r.ok || !ct.startsWith('image/')) {
      // ไม่ส่งข้อความจาก upstream ต่อ (อาจมีรายละเอียด key) บอกเฉพาะสถานะ
      return new Response(`upstream_${r.status}`, { status: r.status === 404 ? 404 : 502, headers: h });
    }
    const body = await r.arrayBuffer();
    const out = new Response(body, { status: 200, headers: {
      'Content-Type': ct, 'Cache-Control': `public, max-age=${CACHE_SEC}` } });
    ctx.waitUntil(cache.put(key, out.clone()));
    return new Response(body, { status: 200, headers: { 'Content-Type': ct, 'Cache-Control': `public, max-age=${CACHE_SEC}`, ...h, 'X-Cache': 'MISS' } });
  }
};
