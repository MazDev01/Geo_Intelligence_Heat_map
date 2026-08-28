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
// ── สีจาก Protomaps style ตัวจริง (อ่านจาก object ตอนโหลดโมดูล ไม่ใช่ literal) ──
// ใช้ instance แยกจาก tunedRules เพราะตัวนั้นถูก mutate ต่อการเรียก (label rules)
const FLAVOR = namedFlavor("light");
export const WATER = FLAVOR.water;   // สีน้ำ — พื้นหลัง map สำหรับบทบาทที่เข้าเงื่อนไข
export const EARTH = FLAVOR.earth;   // สีพื้นดิน — ใช้เติมแผ่นดินโลกที่ landPane

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
// Range ดึงเฉพาะ tile ที่ viewport เห็น · คืน { base, lbl } เพื่อให้ผู้เรียกคุมได้ทั้งสองชั้น
// ─────────────────────────────────────────────────────────────────────────────
export function basemap(map, lang="th"){
  if(!L || !map) return null;
  // ไม่ตั้งสีพื้นที่นี่ — ผู้เรียกเป็นคนตัดสิน (lmap.js ใส่คลาส .map-sea ให้เฉพาะบทบาทที่เข้าเงื่อนไข)
  // ถ้าตั้งที่นี่ mini map ทุกตัวในแอปจะเปลี่ยนสีตามไปด้วยโดยไม่ได้ตั้งใจ
  const { paint, labels } = tunedRules(lang);

  // ── pane สำหรับ "ป้ายชื่อ" โดยเฉพาะ (z450: เหนือ mask/choropleth/heat(400) · ใต้ marker(600)) ──
  // ต้องอยู่เหนือ heat/choropleth ไม่งั้นสี Lead จะวาดทับชื่อสถานที่จนอ่านไม่ออก
  // (แต่ยังใต้หมุด 600 · และถูก clip เฉพาะรูปจังหวัดใน lmap.js อยู่แล้ว จึงไม่โผล่นอกพื้นที่)
  if(!map.getPane("labelPane")){
    map.createPane("labelPane");
    map.getPane("labelPane").style.zIndex = "450";
    map.getPane("labelPane").style.pointerEvents = "none";
  }

  // layer 1: BASE เท่านั้น (พื้น/น้ำ/ถนน/อาคาร — ไม่มี label) อยู่ tilePane ปกติ (200) ใต้ mask
  const base = leafletLayer({
    url: BASEMAP_URL,
    paintRules: paint,
    labelRules: [],                    // ต้องเป็น array ว่างจริง (ไม่ใช่ null) ไม่งั้น protomaps fallback เป็น default rules
    maxDataZoom: BASEMAP_MAXDATAZOOM,   // z16+ = overzoom จาก z15
    // ไม่ตั้ง backgroundColor: protomaps-leaflet จะถมสีนี้เต็ม tile ทุกใบ "รวมใบที่ไม่มีข้อมูล"
    // ผลคือแผ่นน้ำทึบคลุมทั้ง viewport แล้วบัง landPane (z150) ที่อยู่ข้างใต้จนมองไม่เห็นเลย
    // ปล่อยให้ tile ที่ไม่มีข้อมูลโปร่ง → เห็นแผ่นดินจาก world.geojson · สีทะเลมาจากพื้นหลัง container (#80deea) อยู่แล้ว
    attribution: ATTR,
  });
  base.addTo(map);

  // layer 2: LABEL เท่านั้น (ไม่วาด base ซ้ำ) อยู่ labelPane (300) ลอยเหนือ mask
  // โหลด .pmtiles ซ้ำแต่ browser แคช HTTP Range ไว้แล้ว จึงไม่มี network cost เพิ่ม
  const lbl = leafletLayer({
    url: BASEMAP_URL,
    paintRules: [],                    // ไม่วาดพื้น/ถนน/อาคารซ้ำ
    labelRules: labels,
    maxDataZoom: BASEMAP_MAXDATAZOOM,
    pane: "labelPane",
  });
  lbl.addTo(map);
  if(lbl.options.pane !== "labelPane") lbl.options.pane = "labelPane";   // กันกรณี leafletLayer ไม่ส่งต่อ pane option

  // คืนทั้งคู่: ทุกที่ที่ add/remove ต้องทำพร้อมกันเสมอ ไม่งั้นป้ายชื่อจะลอยอยู่บนพื้นเปล่า
  return { base, lbl };
}
