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

const RUNTIME = (typeof globalThis !== "undefined" && globalThis.__GEO_CONFIG) || {};
export const BASEMAP_URL = RUNTIME.basemapUrl || "/basemap/basemap-th.pmtiles";

// ต้นทางมีถึง z15 (รายละเอียด 4 จังหวัด) · z16+ = overzoom ฝั่ง client
export const BASEMAP_MAXDATAZOOM = 15;
export const BASEMAP_MAXZOOM = 18;   // maxZoom ของ Leaflet map (ให้ overzoom เกิน 15 ได้)
