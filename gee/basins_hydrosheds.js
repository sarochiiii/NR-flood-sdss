/**** รอบสอง · ลุ่มน้ำย่อย HydroBASINS ระดับ 12 รอบพื้นที่ศึกษา (ลุ่มมูลตอนบน + ลำเชียงไกร)
 * ส่งออกลุ่มน้ำย่อยทั้งหมดในกรอบ พร้อม HYBAS_ID / NEXT_DOWN / SUB_AREA / UP_AREA
 * การไล่หาต้นน้ำ (upstream tracing) จากจุดสถานีทำใน Python (scripts/region/build_basins.py)
 * แล้วตรวจกับพื้นที่รับน้ำ (D.A) ของกรมชลประทาน: M.188A 2,811 · M.2A 4,724 · M.194 8,467 · M.195 11,458 ตร.กม.
 ****/
var bb = ee.Geometry.Rectangle([101.0, 14.1, 102.9, 15.8]);   // ครอบลุ่มมูลตอนบน ลำเชียงไกร ลำตะคอง ลำพระเพลิง
var basins = ee.FeatureCollection('WWF/HydroSHEDS/v1/Basins/hybas_12').filterBounds(bb);
print('จำนวนลุ่มน้ำย่อยในกรอบ:', basins.size());
print('ตัวอย่าง properties:', basins.first().toDictionary());

var out = basins.map(function (f) {
  return ee.Feature(f.geometry().simplify(60), {
    HYBAS_ID: f.get('HYBAS_ID'), NEXT_DOWN: f.get('NEXT_DOWN'),
    SUB_AREA: f.get('SUB_AREA'), UP_AREA: f.get('UP_AREA'), ORDER: f.get('ORDER')
  });
});
Map.centerObject(bb, 8);
Map.addLayer(basins.style({ color: '1f78b4', fillColor: '00000000', width: 1 }), {}, 'HydroBASINS L12');
Export.table.toDrive({ collection: out, description: 'NR_hybas12', fileFormat: 'GeoJSON' });
