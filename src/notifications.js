/* ═══════════════════════════════════════════════════════════════════════════
   การแจ้งเตือน — แหล่งข้อมูลเดียวของทั้งระบบ

   เดิมมี 3 ชุดแยกกันและไม่คุยกัน: ตั้งค่าระบบ · โปรไฟล์ · กระดิ่งมุมขวาบน
   รายการไม่ตรงกัน บางอันอ้างถึงฟีเจอร์ที่ถอดออกไปแล้ว และปิดสวิตช์ก็ไม่มีผลกับกระดิ่ง

   โครง 2 ชั้น (แนวเดียวกับแบบจำลองสิทธิ์):
     ชั้นที่ 1  ระบบ   — แอดมินตั้งที่ "ตั้งค่าระบบ › การแจ้งเตือน" ว่าเปิดเหตุการณ์ไหน + ระดับใด
     ชั้นที่ 2  ผู้ใช้  — แต่ละคนปิดของตัวเองได้ที่ "โปรไฟล์" แต่เปิดเกินที่ระบบอนุญาตไม่ได้

   เหตุการณ์ที่ผู้ใช้ได้รับจริง = ระบบเปิดไว้ AND ผู้ใช้ไม่ได้ปิดเอง
   ═══════════════════════════════════════════════════════════════════════════ */
import {permByRole, DEFAULT_SCOPE} from "./permissions.js";   // ตารางสิทธิ์/ขอบเขตชุดเดียวของระบบ
import {provinceTH, segTH} from "./lib.js";
import {t} from "./i18n.js";


/* รายการเหตุการณ์ทั้งหมด — ตัดของที่อ้างถึงฟีเจอร์ที่ไม่มีแล้วออกหมด
   perm = สิทธิ์ใน permissions.js ที่เป็นเจ้าของเหตุการณ์นั้น
   บทบาทที่ไม่ได้สิทธิ์ "y" จะไม่เห็นเหตุการณ์นั้นเลย (เช่น import_done = data.import → แอดมินเท่านั้น
   ผู้บริหารได้ "o" คือเปิดรายคนได้ ไม่ใช่ค่าตั้งต้น จึงไม่ควรโผล่ในกระดิ่งผู้บริหาร)
   ไม่สร้างตารางสิทธิ์ชุดใหม่ — อ้างของเดิมที่ permissions.js ที่เดียว
   (เหตุการณ์ที่อ้างถึงฟีเจอร์ที่ถอดออกไปแล้วถูกตัดทิ้งหมด: ซิงค์ข้อมูลกับระบบภายนอก ·
    ความครอบคลุม · ข่าวสารการตลาด · คิวตรวจข้อมูลซ้ำ) */
export const NOTIF_EVENTS = [
  { key:"lead_new",    get label(){ return t("พบ Lead ใหม่ในพื้นที่รับผิดชอบ","New Lead in your territory"); }, priority:"medium", perm:"customer.view" },
  { key:"lead_gap",    get label(){ return t("พบพื้นที่ Lead สูง","High-Lead area found"); },                   priority:"high",   perm:"map.view_score" },
  { key:"import_done", get label(){ return t("นำเข้าไฟล์สำเร็จ","File import finished"); },                     priority:"low",    perm:"data.import" },
  { key:"export_done", get label(){ return t("ส่งออกข้อมูลสำเร็จ","Data export finished"); },                   priority:"low",    perm:"report.export_summary" },
  { key:"weekly",      get label(){ return t("สรุปข่าวกรองประจำสัปดาห์","Weekly intelligence summary"); },       priority:"low",    perm:"report.view" },
];
export const NOTIF_INDEX = Object.fromEntries(NOTIF_EVENTS.map(e=>[e.key,e]));
export const PRIORITY_TH = {
  get high(){ return t("สูง","High"); }, get medium(){ return t("กลาง","Medium"); }, get low(){ return t("ต่ำ","Low"); } };

/* ── ชั้นที่ 1 · ค่าระดับระบบ (แอดมิน) ── */
let _SYS = null;
const sysStore = () => (_SYS || (_SYS = Object.fromEntries(
  NOTIF_EVENTS.map(e=>[e.key, {on:true, priority:e.priority}]))));
export const getSysNotif = () => ({...sysStore()});
export const setSysNotif = next => { _SYS = {...next}; };

/* ── ชั้นที่ 2 · ค่าระดับผู้ใช้ — เก็บเฉพาะ "อันที่ผู้ใช้ปิดเอง" ── */
let _USER_OFF = {};
export const getUserOff = () => ({..._USER_OFF});
export const setUserOff = next => { _USER_OFF = {...next}; };

/* เหตุการณ์นี้ผู้ใช้จะได้รับจริงไหม */
export const notifOn = key => {
  const s = sysStore()[key];
  return !!(s && s.on) && _USER_OFF[key] !== true;
};
/* เหตุการณ์ที่ระบบเปิดไว้ — โปรไฟล์แสดงเฉพาะรายการเหล่านี้ */
export const sysEnabledEvents = () => NOTIF_EVENTS.filter(e => sysStore()[e.key].on);
/* เหตุการณ์ที่ผู้ใช้ได้รับจริง — กระดิ่งมุมขวาบนกรองด้วยตัวนี้ */
export const activeEvents = () => NOTIF_EVENTS.filter(e => notifOn(e.key));

/* ── ชั้นที่ 0 · บทบาท — เหตุการณ์ที่บทบาทนี้ "มีสิทธิ์ได้รับ" เลย ──
   ต่างจาก 2 ชั้นบน: ชั้นระบบ/ผู้ใช้ = เปิด-ปิดเอง · ชั้นนี้ = ไม่มีสิทธิ์ ปิดตายไม่มีให้เลือก */
export const roleEvents = role => NOTIF_EVENTS.filter(e => !e.perm || permByRole(e.perm, role) === "y");
/* เหตุการณ์ที่ผู้ใช้คนนี้ตั้งค่าได้จริง = ระบบเปิดไว้ AND บทบาทมีสิทธิ์ (โปรไฟล์ใช้ตัวนี้) */
export const userSettableEvents = role => roleEvents(role).filter(e => sysStore()[e.key].on);

/* ── ข้อความในกระดิ่ง — คำนวณจากข้อมูลจริงและขอบเขตของผู้ใช้ ──
   เดิมเป็นข้อความตายตัวในไฟล์ app.js: TC ที่ดูแลเชียงใหม่ก็ยังเห็น "Lead ใหม่ในภูเก็ต"
   และผู้บริหารเห็น "นำเข้าไฟล์สำเร็จ" ซึ่งเป็นงานของแอดมิน
   ตอนนี้ TC (scope own_area) → นับเฉพาะจังหวัดที่รับผิดชอบ · แอดมิน/ผู้บริหาร (national) → ทั้งประเทศ */
const NEW_WINDOW_DAYS = 7;
export function buildNotifs(user, db){
  const role = (user && user.role) || "Administrator";
  // TC เห็นเฉพาะพื้นที่ตัวเอง · บทบาทอื่นขอบเขตทั้งประเทศ
  const prov = (DEFAULT_SCOPE[role] === "own_area" && user && user.province) ? user.province : null;
  const inScope = o => !prov || o.province === prov;
  const pros  = (db && db.prospects || []).filter(inScope);
  const custs = (db && db.customers || []).filter(inScope);
  // "ในเชียงใหม่" / "ทั่วประเทศ" — คำบุพบทอยู่ในตัวแปร ไม่งั้นได้ "ในทั่วประเทศ"
  const where = prov ? t("ใน","in ")+provinceTH(prov) : t("ทั่วประเทศ","nationwide");

  // Lead ใหม่: นับเทียบกับ "วันล่าสุดที่มี Lead ในข้อมูล" ไม่ใช่วันนี้ (ชุดข้อมูลนิ่ง ไม่ใช่ realtime)
  const ts = pros.map(o => Date.parse(o.created_at)).filter(Number.isFinite);
  const newest = ts.length ? Math.max(...ts) : 0;
  const newLeads = ts.filter(t => t >= newest - NEW_WINDOW_DAYS*864e5).length;

  // หมวดที่ยังขาดมากที่สุดในขอบเขตนี้ = Lead มากกว่าลูกค้าเยอะสุด
  const bal = {};
  pros .forEach(o => { bal[o.segment] = (bal[o.segment]||0) + 1; });
  custs.forEach(o => { bal[o.segment] = (bal[o.segment]||0) - 1; });
  const [gapSeg, gapN] = Object.entries(bal).sort((a,b)=>b[1]-a[1])[0] || [null,0];

  // ข้อความทั้งประโยคเขียนเป็น template สองภาษา ไม่ใช่ต่อคำทีละชิ้น —
  // ลำดับคำไทยกับอังกฤษไม่ตรงกัน ("หมวดX ยังขาดอีก N ราย" ↔ "X is short by N businesses")
  const all = [
    {key:"lead_new",    icon:"target",   time:t("3 นาที","3 min"),
     t:t(`พบ Lead ใหม่ ${newLeads} ราย ${where} (${NEW_WINDOW_DAYS} วันล่าสุด)`,
         `${newLeads} new Leads ${where} (last ${NEW_WINDOW_DAYS} days)`), skip:!newLeads},
    {key:"lead_gap",    icon:"gap",      time:t("1 ชม.","1 hr"),
     t:t(`หมวด${segTH(gapSeg)}${where} ยังขาดอีก ${gapN} ราย`,
         `${segTH(gapSeg)} ${where} is short by ${gapN} businesses`), skip:!gapSeg || gapN<=0},
    {key:"import_done", icon:"upload",   time:t("3 ชม.","3 hr"),
     t:t("นำเข้าไฟล์ ลูกค้า_กรุงเทพ_Q2.xlsx สำเร็จ 110 รายการ","Imported ลูกค้า_กรุงเทพ_Q2.xlsx — 110 records")},
    {key:"export_done", icon:"download", time:t("4 ชม.","4 hr"),
     t:t("ส่งออกรายงานโอกาส (PDF) เรียบร้อย","Opportunity report (PDF) exported")},
    {key:"weekly",      icon:"reports",  time:t("5 ชม.","5 hr"),
     t:t(`รายงานโอกาสประจำสัปดาห์${prov?" ("+provinceTH(prov)+")":""} พร้อมแล้ว`,
         `Weekly opportunity report${prov?" ("+provinceTH(prov)+")":""} is ready`)},
  ];
  const allowed = new Set(roleEvents(role).map(e=>e.key));
  return all.filter(x => !x.skip && allowed.has(x.key) && notifOn(x.key));
}
