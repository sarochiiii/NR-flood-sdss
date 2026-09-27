/**** รูปอาคาร (polygon) จาก Google Open Buildings V3 — อำเภอโนนไทย–โนนสูง
 * Export เป็น Shapefile (ขนาดเล็กกว่า GeoJSON/CSV หลายเท่า) ลง Google Drive
 * ได้ไฟล์ NR_buildings_poly (.shp .shx .dbf .prj) → ส่งให้ Claude แปลงเป็น tile รายตำบลสำหรับเว็บ
 ****/
var HEX_ASSET   = 'projects/ee-sarochineek/assets/NR_hex_res8_shp';
var OB_MIN_CONF = 0.70;

var hex = ee.FeatureCollection(HEX_ASSET);
var ob = ee.FeatureCollection('GOOGLE/Research/open-buildings/v3/polygons')
  .filterBounds(hex.geometry())
  .filter(ee.Filter.gte('confidence', OB_MIN_CONF))
  .map(function (b) {
    return ee.Feature(b.geometry(), { a: ee.Number(b.get('area_in_meters')).round() });
  });

print('ตัวอย่าง:', ob.limit(3));
Map.centerObject(hex, 13);
Map.addLayer(ob.limit(3000), {color: 'F59E0B'}, 'อาคาร (ตัวอย่าง)');

Export.table.toDrive({ collection: ob, description: 'NR_buildings_poly', fileFormat: 'SHP' });
