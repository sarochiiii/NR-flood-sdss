/**** S1 · ชั้นภัยสำหรับ Sandbox บ้านด่านติง ต.จันอัด (น้ำท่วม + ภัยแล้ง)
 * ผลลัพธ์ (Export ลง Google Drive → ส่งให้ Claude แปลงเป็นไฟล์เว็บ) — ทั้งหมดเป็นข้อมูลสาธารณะ ไม่มีข้อมูลครัวเรือน
 *   SBX_boundary.geojson    ขอบเขต ต.จันอัด
 *   SBX_river.geojson       เส้นลำเชียงไกร (ทำ buffer/ระยะในเว็บ)
 *   SBX_floodfreq.geojson   น้ำท่วมซ้ำซาก GISTDA รวมตามจำนวนครั้ง (dissolve) เพื่อให้ไฟล์เล็ก
 *   SBX_water.geojson       แหล่งน้ำ (ถ้ามี asset)
 *   SBX_rain_monthly.csv    ฝนรายเดือน CHIRPS 1991–ปัจจุบัน (ค่าเฉลี่ยทั้งตำบล) → คำนวณ SPI
 *   SBX_ndvi_monthly.csv    NDVI รายเดือนพื้นที่เกษตร Sentinel-2 2019–ปัจจุบัน → ความผิดปกติของพืชพรรณ
 ****/
var A = 'projects/ee-sarochineek/assets/';
var boundary = ee.FeatureCollection(A + 'ChanAtOSM');        // [ตรวจ] ขอบเขตตำบล
var river    = ee.FeatureCollection(A + 'ChiangKriFull');    // เส้นลำเชียงไกรเต็มเส้น (ใช้ก่อน clip ตามข้อตกลงเดิม)
var freqFC   = ee.FeatureCollection(A + 'FloodGCS');         // น้ำท่วมซ้ำซาก GISTDA เฉพาะจันอัด (ตรงขอบเขตตำบลกว่า Repeatarea)
var WATER_ASSETS = ['ChanAtWaterLine', 'ChanAtWaterArea'];   // [ตรวจชื่อ] ถ้าไม่มีให้ลบออกจากรายการ

print('boundary', boundary.first());
print('river', river.first());
print('FloodGCS ตัวอย่าง properties (ดูชื่อ field ความถี่):', freqFC.first().toDictionary());

var region = boundary.geometry();
var aoi = region.buffer(3000);                                // พื้นที่รอบตำบล 3 กม. ให้เห็นต้นน้ำ-ท้ายน้ำ

// ---------- 1) ขอบเขตและลำน้ำ ----------
Export.table.toDrive({ collection: boundary.map(function (f) { return ee.Feature(f.geometry().simplify(5), {}); }),
  description: 'SBX_boundary', fileFormat: 'GeoJSON' });
Export.table.toDrive({ collection: river.filterBounds(aoi).map(function (f) {
    return ee.Feature(f.geometry().intersection(aoi, 1).simplify(5), {}); }),
  description: 'SBX_river', fileFormat: 'GeoJSON' });

// ---------- 2) น้ำท่วมซ้ำซาก: รวมเป็น polygon ตามจำนวนครั้ง ----------
var FREQ_FIELD = ee.String(ee.Algorithms.If(freqFC.first().propertyNames().contains('Repeating'), 'Repeating', 'freq'));
print('ใช้ field ความถี่ =', FREQ_FIELD);
var freqImg = freqFC.filter(ee.Filter.notNull([FREQ_FIELD]))
  .map(function (f) {                                          // แตก GeometryCollection เก็บเฉพาะ polygon
    return ee.FeatureCollection(ee.List(f.geometry().geometries()).map(function (g) {
      g = ee.Geometry(g); return ee.Feature(g, { freq: f.get(FREQ_FIELD), t: g.type() }); }));
  }).flatten().filter(ee.Filter.inList('t', ['Polygon', 'MultiPolygon']))
  .reduceToImage(['freq'], ee.Reducer.max()).rename('freq').toInt();
var freqVec = freqImg.reduceToVectors({ geometry: aoi, scale: 10, geometryType: 'polygon',
  labelProperty: 'freq', maxPixels: 1e9, tileScale: 4 })
  .map(function (f) { return ee.Feature(f.geometry().simplify(8), { freq: f.get('freq') }); });
Map.addLayer(freqImg.selfMask(), {min: 1, max: 7, palette: ['#C6DBEF', '#08306B']}, 'ความถี่น้ำท่วม');
Export.table.toDrive({ collection: freqVec, description: 'SBX_floodfreq', fileFormat: 'GeoJSON' });

// ---------- 3) แหล่งน้ำ ----------
WATER_ASSETS.forEach(function (n) {
  var fc = ee.FeatureCollection(A + n).filterBounds(aoi);
  Export.table.toDrive({ collection: fc.map(function (f) { return ee.Feature(f.geometry().simplify(5), { src: n }); }),
    description: 'SBX_water_' + n, fileFormat: 'GeoJSON' });
});

// ---------- 4) ฝนรายเดือน CHIRPS (สำหรับ SPI) ----------
var chirps = ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY');
var today = ee.Date(Date.now());
var start = ee.Date('1991-01-01'), end = ee.Date.fromYMD(today.get('year'), today.get('month'), 1);   // ถึงต้นเดือนปัจจุบัน
var nMonths = end.difference(start, 'month').floor();
var rain = ee.FeatureCollection(ee.List.sequence(0, nMonths.subtract(1)).map(function (i) {
  var d0 = start.advance(i, 'month'), d1 = d0.advance(1, 'month');
  var img = chirps.filterDate(d0, d1).sum();
  var v = img.reduceRegion({ reducer: ee.Reducer.mean(), geometry: region, scale: 5566 }).get('precipitation');
  return ee.Feature(null, { month: d0.format('YYYY-MM'), rain_mm: v, n_days: chirps.filterDate(d0, d1).size() });
}));
Export.table.toDrive({ collection: rain, description: 'SBX_rain_monthly', fileFormat: 'CSV',
  selectors: ['month', 'rain_mm', 'n_days'] });

// ---------- 5) NDVI รายเดือน Sentinel-2 (พื้นที่เกษตรในตำบล) ----------
var wc = ee.ImageCollection('ESA/WorldCover/v200').first();
var crop = wc.eq(40).or(wc.eq(30));                            // cropland + grassland (นา/ไร่)
var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filterBounds(region)
  .map(function (im) {
    var scl = im.select('SCL'), ok = scl.eq(4).or(scl.eq(5));  // vegetation/bare เท่านั้น (ตัดเมฆ เงา น้ำ)
    return im.normalizedDifference(['B8', 'B4']).rename('ndvi').updateMask(ok).updateMask(crop)
      .copyProperties(im, ['system:time_start']);
  });
var s0 = ee.Date('2019-01-01'), nm2 = end.difference(s0, 'month').floor();
var ndvi = ee.FeatureCollection(ee.List.sequence(0, nm2.subtract(1)).map(function (i) {
  var d0 = s0.advance(i, 'month'), d1 = d0.advance(1, 'month');
  var col = s2.filterDate(d0, d1);
  var v = ee.Algorithms.If(col.size().gt(0),
    col.median().reduceRegion({ reducer: ee.Reducer.median(), geometry: region, scale: 20, maxPixels: 1e9 }).get('ndvi'), null);
  return ee.Feature(null, { month: d0.format('YYYY-MM'), ndvi: v, n_img: col.size() });
}));
Export.table.toDrive({ collection: ndvi, description: 'SBX_ndvi_monthly', fileFormat: 'CSV',
  selectors: ['month', 'ndvi', 'n_img'] });

Map.centerObject(region, 13);
Map.addLayer(boundary.style({ color: 'ffffff', fillColor: '00000000', width: 2 }), {}, 'ต.จันอัด');
Map.addLayer(river, { color: '1f78b4' }, 'ลำเชียงไกร');
