// ─────────────────────────────────────────────────────────────────────────────
// แผนที่ฐาน Protomaps (vector tiles, self-host) — โมดูลรวมศูนย์เดียวของทั้งแอป
// ทุกแผนที่ในแอป (แผนที่หลัก, mini map, แผงพื้นที่, รายงาน, ฟอร์ม) เรียก basemap(map)
// จากที่นี่ที่เดียว จึงมีสไตล์เดียวกันหมดและเปลี่ยนที่เก็บไฟล์/สไตล์ได้จุดเดียว
//
// ไฟล์เดียวครอบทั้งประเทศ (z0–11) + รายละเอียด 4 จังหวัด (z12–15) → ซูมออกเห็นครบ
// ไม่มีพื้นที่ว่าง · ซูมเข้าลึกมีรายละเอียดเฉพาะ 4 จังหวัดนำร่อง (ดู config/basemap.js)
//
// สไตล์ (ปรับจาก POC): เน้น "อาคาร" + "ชื่อถนน/ซอย" (ตัวใหญ่ Noto Sans Thai) · ไม่แสดง POI
// (หมุดร้าน/ลูกค้ามาจากข้อมูลของแอปเอง การโชว์ POI ของ OSM จะรกและซ้ำซ้อน)
// ─────────────────────────────────────────────────────────────────────────────
import { leafletLayer, paintRules, labelRules } from "protomaps-leaflet";
import { namedFlavor } from "@protomaps/basemaps";
import { BASEMAP_URL, BASEMAP_MAXDATAZOOM } from "../config/basemap.js";

const L = (typeof window !== "undefined") ? window.L : undefined;

const ATTR  = 'แผนที่ฐาน &copy; <a href="https://openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> · Protomaps';
const EARTH = "#e2dfda";   // สีพื้นดินของธีม — ใช้เป็นพื้นหลัง map ก่อน tile โหลดเสร็จ

// สร้างชุด paint/label rules ที่ปรับแล้ว (สร้างใหม่ทุกครั้งเพราะ label rules ถูก mutate ต่อ instance)
function tunedRules(lang){
  const fl = namedFlavor("light");
  fl.buildings         = "#ccd1d9";   // เดิม #cccccc = สีเดียวกับพื้นดิน (มองไม่เห็น) → เทาเย็น ตัดกับพื้น + ปล่อยหมุดแดงเด่น
  fl.roads_label_major = "#2b3440";   // ชื่อถนนหลัก เข้ม
  fl.roads_label_minor = "#4a5563";   // ชื่อซอย เข้ม
  const paint  = paintRules(fl);
  const labels = labelRules(fl, lang);
  // ขยายขนาดฟอนต์ชื่อถนน (ค่าเดิม 12px เล็กไปบนมือถือ) + ใช้ Noto Sans Thai ให้ตรง typeface แอป
  for(const r of labels){
    const f = r.symbolizer && r.symbolizer.font;
    if(r.dataLayer==="roads" && f && typeof f.font==="string"){
      f.font = (r.minzoom>=16)
        ? "600 15px 'Noto Sans Thai', sans-serif"   // ซอย (โผล่ที่ z16)
        : "700 16px 'Noto Sans Thai', sans-serif";  // ถนนหลัก
    }
  }
  return { paint, labels };
}

// ─────────────────────────────────────────────────────────────────────────────
// เพิ่มแผนที่ฐานให้ map — ไฟล์เดียวครอบทั้งประเทศ จึงไม่ต้องสลับไฟล์/เลือกพื้นที่
// Range ดึงเฉพาะ tile ที่ viewport เห็น · คืน layer เผื่อผู้เรียกอ้างอิง
// ─────────────────────────────────────────────────────────────────────────────
export function basemap(map, lang="th"){
  if(!L || !map) return null;
  map.getContainer().style.background = EARTH;
  const { paint, labels } = tunedRules(lang);
  const layer = leafletLayer({
    url: BASEMAP_URL,
    paintRules: paint,
    labelRules: labels,
    maxDataZoom: BASEMAP_MAXDATAZOOM,   // z16+ = overzoom จาก z15
    backgroundColor: EARTH,
    attribution: ATTR,
  });
  layer.addTo(map);
  return layer;
}
