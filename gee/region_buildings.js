/**** อาคารจาก Google Open Buildings V3 — อำเภอโนนไทย–โนนสูง
 * ผลลัพธ์ 2 ไฟล์ (Export ลง Google Drive)
 *   NR_buildings_pts.csv  จุดศูนย์กลางอาคาร (lon, lat, area ตร.ม.)  → แสดงรายหลังเมื่อซูมใกล้
 *   NR_hex_bldg.csv       จำนวนอาคารต่อ hexagon H3 res 8           → แสดงความหนาแน่นเมื่อซูมไกล
 * ไม่ต้องใช้ข้อมูลน้ำท่วมซ้ำซาก จึงเบากว่า region_susceptibility.js มาก
 ****/
var HEX_ASSET   = 'projects/ee-sarochineek/assets/NR_hex_res8_shp';
var OB_MIN_CONF = 0.70;     // ตรงกับ data contract ของโครงการ

var hex = ee.FeatureCollection(HEX_ASSET);
var region = hex.geometry().bounds();          // กรอบล้อม — ตัดให้ตรงขอบอำเภอภายหลังด้วย Python

var ob = ee.FeatureCollection('GOOGLE/Research/open-buildings/v3/polygons')
  .filterBounds(region)
  .filter(ee.Filter.gte('confidence', OB_MIN_CONF));

// ตรวจเร็ว: ดูตัวอย่าง 3 หลัง (อย่า print ob.size() ทั้งหมด — อาจ timeout)
print('ตัวอย่างอาคาร:', ob.limit(3));
Map.centerObject(hex, 10);
Map.addLayer(ob.limit(5000), {color: 'd62728'}, 'อาคาร (ตัวอย่าง 5,000 หลัง)');
Map.addLayer(hex.style({color: '555555', fillColor: '00000000', width: 0.5}), {}, 'H3 res 8');

// 1) จุดศูนย์กลางอาคาร
var pts = ob.map(function (b) {
  var c = b.geometry().centroid(1).coordinates();
  return ee.Feature(null, {
    lon: ee.Number(c.get(0)).format('%.5f'),
    lat: ee.Number(c.get(1)).format('%.5f'),
    area: ee.Number(b.get('area_in_meters')).round()
  });
});
Export.table.toDrive({ collection: pts, description: 'NR_buildings_pts', fileFormat: 'CSV',
                       selectors: ['lon', 'lat', 'area'] });

// 2) จำนวนอาคารต่อ hexagon (นับผ่าน raster — เร็วกว่านับทีละ hexagon)
var cnt = ob.map(function (b) { return ee.Feature(b.geometry().centroid(1), {n: 1}); })
  .reduceToImage(['n'], ee.Reducer.count()).unmask(0).rename('bldg');
var hc = cnt.reduceRegions({ collection: hex, reducer: ee.Reducer.sum().setOutputs(['bldg']),
                             scale: 10, tileScale: 8 });
Export.table.toDrive({ collection: hc, description: 'NR_hex_bldg', fileFormat: 'CSV',
                       selectors: ['h3', 'tcode', 'bldg'] });
