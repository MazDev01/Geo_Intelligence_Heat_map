// ─────────────────────────────────────────────────────────────────────────────
// ความทึบของเลเยอร์บนแผนที่ — ตั้งที่เดียวคือ "ตั้งค่าระบบ › การจัดการเลเยอร์" (แอดมิน)
//
// เดิมมีแถบเลื่อนอยู่ในแผงเลเยอร์บนแผนที่ ใครก็ปรับได้ทุกบทบาท — ถอดออกแล้ว
// TC/ผู้บริหารเห็นค่าที่แอดมินตั้งไว้อย่างเดียว เข้าระบบมาก็ได้ ลูกค้า=ทึบ · Lead=จาง ทันที
// (แยกลูกค้า/Lead ด้วยความทึบ ไม่ใช่สี — สีสงวนไว้บอกหมวดธุรกิจ)
//
// เก็บที่ระดับโมดูล + localStorage แบบเดียวกับ src/export-perms.js
// แจ้ง subscriber เพื่อให้แผนที่อัปเดตทันทีที่แอดมินกดบันทึก ไม่ต้องรีเฟรช
// ─────────────────────────────────────────────────────────────────────────────

const KEY = "geointel_layer_opacity";

/* ค่าตั้งต้น = ที่ผู้ใช้เห็นตอนเข้าระบบครั้งแรก
   ลูกค้า 90% (ทึบชัด) · Lead 40% (จาง) — ตัวเลขเดิมที่แผนที่ใช้อยู่ก่อนถอดแถบเลื่อน */
export const DEFAULT_LAYER_OPACITY = {existing:90, prospect:40, heat:80, province:100};

function load(){
  try{
    const s = JSON.parse(localStorage.getItem(KEY));
    if(s && typeof s === "object") return {...DEFAULT_LAYER_OPACITY, ...s};
  }catch(e){}   // localStorage ถูกปิด (private mode) — ใช้ค่าตั้งต้น
  return {...DEFAULT_LAYER_OPACITY};
}

let cur = load();
const subs = new Set();

/* ค่าปัจจุบัน — คืนสำเนา กันผู้เรียกแก้ของกลางโดยไม่ผ่าน setLayerOpacity() */
export const getLayerOpacity = () => ({...cur});

/* ตั้งค่าใหม่ (merge บางส่วนได้) — เรียกจากหน้าตั้งค่าของแอดมินเท่านั้น */
export function setLayerOpacity(next){
  cur = {...cur, ...next};
  try{ localStorage.setItem(KEY, JSON.stringify(cur)); }catch(e){}
  subs.forEach(fn => fn({...cur}));
}

export function subscribeLayerOpacity(fn){
  subs.add(fn);
  return () => subs.delete(fn);
}
