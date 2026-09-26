/**** ชั้น Susceptibility (S) รายหกเหลี่ยม H3 res 8 — อำเภอโนนไทย–โนนสูง
 * ผลลัพธ์: ค่าดิบต่อ hexagon (freq_max, flood_frac, hand_m, dist_m, bldg)
 * การจัดชั้น S ทำต่อใน scripts/region/merge_susceptibility.py เพื่อให้ตรวจสอบย้อนหลังได้
 *
 * ก่อนรัน
 *   1) อัปโหลด gee/hex_grid_res8.geojson เป็น Table asset (ชื่อแนะนำ NR_hex_res8)
 *   2) เตรียมข้อมูลความถี่น้ำท่วม GISTDA 2554–2567 ให้ครอบคลุมทั้งสองอำเภอ
 *      (asset Repeatarea เดิมอาจครอบคลุมเฉพาะจันอัด — ตรวจด้วย print ด้านล่าง)
 *   3) คัดลอก asset path จากหน้า Asset detail — ตัวพิมพ์เล็ก/ใหญ่มีผล
 ****/

// ======== ตั้งค่า (แก้ส่วนนี้เท่านั้น) ========
var HEX_ASSET   = 'projects/ee-sarochineek/assets/NR_hex_res8_shp';    // อัปโหลดแล้ว 1,421 ช่อง
var FREQ_ASSET  = 'projects/ee-sarochineek/assets/NR_FloodFreq';       // GISTDA reflood ระดับจังหวัด
var FREQ_IS_VECTOR = true;     // true = FeatureCollection ที่มี field ความถี่, false = ภาพ raster
var FREQ_FIELD  = 'Repeating'; // จำนวนครั้งที่ท่วมซ้ำ 1–9 (ยืนยันแล้ว 26 ก.ย. 2569)
var OB_MIN_CONF = 0.70;        // ตรงกับ data contract ของ buildings.geojson
var SCALE       = 30;          // ม. สำหรับ reduceRegions
// ============================================

var hex = ee.FeatureCollection(HEX_ASSET);
var region = hex.geometry().bounds();
print('จำนวน hexagon (ควรเป็น 1421):', hex.size());

// --- 1) ความถี่น้ำท่วมซ้ำ GISTDA ---
var freq;
if (FREQ_IS_VECTOR) {
  var fc = ee.FeatureCollection(FREQ_ASSET).filterBounds(region);
  print('ตัวอย่าง feature ความถี่น้ำท่วม (ตรวจชื่อ field):', fc.first());
  print('จำนวน polygon ในพื้นที่ (ต้อง > 0):', fc.size());
  // ข้อมูลมี GeometryCollection และ LineString ปน (~5% ของตัวอย่าง)
  // แตกทุก feature เป็นชิ้นย่อย แล้วเก็บเฉพาะ Polygon/MultiPolygon ก่อนแปลงเป็น raster
  // ไม่เช่นนั้นเส้นจะถูก rasterize เป็นแนวพิกเซลที่ "เคยท่วม" ปลอม
  var polys = fc.filter(ee.Filter.notNull([FREQ_FIELD])).map(function (f) {
    var parts = ee.List(f.geometry().geometries());
    return ee.FeatureCollection(parts.map(function (p) {
      p = ee.Geometry(p);
      return ee.Feature(p, {freq: f.get(FREQ_FIELD), gtype: p.type()});
    }));
  }).flatten().filter(ee.Filter.inList('gtype', ['Polygon', 'MultiPolygon']));
  print('ชิ้น polygon หลังกรอง (ควรใกล้ 57,295 หรือมากกว่าเล็กน้อย):', polys.size());
  freq = polys.reduceToImage(['freq'], ee.Reducer.max()).rename('freq');
} else {
  freq = ee.Image(FREQ_ASSET).select(0).rename('freq');
}
freq = freq.unmask(0).clip(region);
var flooded = freq.gt(0).rename('flooded');

// --- 2) HAND และระยะถึงทางน้ำ จาก MERIT Hydro v1.0.1 ---
var merit = ee.Image('MERIT/Hydro/v1_0_1');
var hand = merit.select('hnd').rename('hand');
var channel = merit.select('wth').gt(0);                 // พิกเซลที่มีความกว้างลำน้ำ > 0
var distPx = channel.fastDistanceTransform(128).sqrt();  // หน่วย = พิกเซล
var dist = distPx.multiply(ee.Image.pixelArea().sqrt())
                 .reproject(merit.projection()).rename('dist');

// --- 3) อาคารจาก Open Buildings V3 → raster นับจำนวน (เร็วกว่า filterBounds ทีละ hexagon มาก) ---
var bldg = ee.FeatureCollection('GOOGLE/Research/open-buildings/v3/polygons')
  .filterBounds(region)
  .filter(ee.Filter.gte('confidence', OB_MIN_CONF))
  .map(function (b) { return ee.Feature(b.geometry().centroid(1), {n: 1}); })
  .reduceToImage(['n'], ee.Reducer.count())
  .unmask(0).rename('bldg');

// --- 4) สถิติรายหกเหลี่ยม: ฟังก์ชันเดียวใช้ทั้ง preview และ export ---
var stack = freq.rename('freq').addBands(flooded).addBands(hand).addBands(dist);

function metrics(hexFC) {
  // pass 1: 30 ม. — mean และ max ของทุก band ในรอบเดียว (ได้ชื่อ <band>_mean, <band>_max)
  var s1 = stack.reduceRegions({
    collection: hexFC,
    reducer: ee.Reducer.mean().combine({reducer2: ee.Reducer.max(), sharedInputs: true}),
    scale: SCALE, tileScale: 8
  });
  // pass 2: 10 ม. — ผลรวมจำนวนอาคาร
  var s2 = bldg.reduceRegions({ collection: hexFC, reducer: ee.Reducer.sum().setOutputs(['bldg']),
                               scale: 10, tileScale: 8 });
  var bDict = ee.Dictionary.fromLists(s2.aggregate_array('h3'), s2.aggregate_array('bldg'));
  return s1.map(function (h) {
    return ee.Feature(null, {
      h3: h.get('h3'), tcode: h.get('tcode'),
      freq_max: h.get('freq_max'),
      flood_frac: h.get('flooded_mean'),       // สัดส่วนพื้นที่ที่เคยท่วม
      hand_m: h.get('hand_mean'),
      dist_m: h.get('dist_mean'),
      bldg: bDict.get(h.get('h3'), 0)
    });
  });
}

// preview เฉพาะ 3 hexagon — ถ้ารันทั้ง 1,421 ช่องใน Console จะ timeout (ขีดจำกัดโหมด interactive)
var sample = hex.filter(ee.Filter.inList('tcode', ['301010'])).limit(3);   // ต.จันอัด
print('ตัวอย่างผล 3 hexagon (ต.จันอัด):', metrics(sample));

Map.centerObject(hex, 10);
Map.addLayer(freq.selfMask(), {min: 1, max: 9, palette: ['#C6DBEF', '#08306B']}, 'ความถี่น้ำท่วม');
Map.addLayer(hand, {min: 0, max: 20, palette: ['#08306B', '#FFFFFF']}, 'HAND', false);
Map.addLayer(hex.style({color: '555555', fillColor: '00000000', width: 0.5}), {}, 'H3 res 8');

// export ทั้งหมดเป็น batch task (ไม่มีขีดจำกัดเวลาแบบ Console)
Export.table.toDrive({
  collection: metrics(hex),
  description: 'NR_hex_metrics',
  fileFormat: 'CSV',
  selectors: ['h3', 'tcode', 'freq_max', 'flood_frac', 'hand_m', 'dist_m', 'bldg']
});
