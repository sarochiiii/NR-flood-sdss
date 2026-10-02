// ตั้งค่าร่วมของหน้า LIFF ทุกหน้า (แก้ที่นี่ที่เดียว หลังสร้าง LIFF และ Worker) — ค่าไม่ใช่ความลับ
window.LINE_CFG = {
  OA_ID: '@142uxpzr',          // Basic ID ของ LINE OA "จันอัดบ้านฉัน" เช่น '@123abcde' (OA Manager → หน้าแรก ใต้ชื่อบัญชี) → ปุ่มบนเว็บจะเปิดแชท OA
  // สองค่าล่างสำหรับระบบระยะสอง (D1 + LIFF ฟอร์มปักหมุด) — ยังไม่ต้องแก้
  LIFF_ID: 'YOUR_LIFF_ID',
  API: 'https://line-hub.YOUR-SUBDOMAIN.workers.dev'
};
