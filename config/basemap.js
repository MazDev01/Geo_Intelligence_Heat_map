// ─────────────────────────────────────────────────────────────────────────────
// ที่อยู่ไฟล์ basemap (Protomaps vector tiles) — จุดเดียวที่กำหนดที่เก็บไฟล์
// ย้ายที่เก็บ (Vercel static → cloud อื่นของลูกค้า) = แก้แค่ BASEMAP_BASE บรรทัดเดียว
// ห้าม hardcode URL .pmtiles กระจายในโค้ดที่อื่น — import จากไฟล์นี้เท่านั้น
//
// โครงไฟล์: ไฟล์เดียว 2 ระดับ (สร้างด้วย pmtiles extract แยกซูมแล้ว merge)
//   • ทั้งประเทศไทย  z0–11  → ซูมออกเห็นครบทุกจังหวัด ไม่มีพื้นที่ว่าง
//   • 4 จังหวัดนำร่อง z12–15 → ซูมเข้าลึกเห็นถนน/ซอย/อาคาร (กทม.+ปริมณฑล, ชลบุรี+ระยอง, เชียงใหม่, ภูเก็ต)
//   Range request ดึงเฉพาะ byte ของ tile ที่มองเห็น ไม่ได้โหลดทั้งไฟล์ 174 MB
// ─────────────────────────────────────────────────────────────────────────────

// โฟลเดอร์ static บน Vercel (same-origin → HTTP Range 206 ใช้ได้)
// ย้ายไป cloud อื่น: เปลี่ยนเป็น URL เต็ม เช่น "https://cdn.example.com/basemap"
export const BASEMAP_BASE = "/basemap";

// วันที่ข้อมูล OSM ของ build ปัจจุบัน (osmosisreplicationtime = 2026-08-05)
// ใช้ในชื่อไฟล์เพื่อ cache-busting เวลา rebuild ข้อมูลใหม่
const V = "20260805";

// ไฟล์แผนที่ฐานไฟล์เดียว (~174 MB · z0–15 · ครอบคลุมทั้งประเทศ + รายละเอียด 4 จังหวัด)
export const BASEMAP_URL = `${BASEMAP_BASE}/basemap-th-${V}.pmtiles`;

// ต้นทางมีถึง z15 (รายละเอียด 4 จังหวัด) · z16+ = overzoom ฝั่ง client
export const BASEMAP_MAXDATAZOOM = 15;
export const BASEMAP_MAXZOOM = 18;   // maxZoom ของ Leaflet map (ให้ overzoom เกิน 15 ได้)
