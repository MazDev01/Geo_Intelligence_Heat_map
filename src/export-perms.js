// ═══════════════════════════════════════════════════════════════════════════
// src/export-perms.js — สิทธิ์การส่งออกไฟล์ตามบทบาท (ค่าเริ่มต้น + อ่าน/บันทึก)
//
// TODO(server): สิทธิ์จริงต้องบังคับที่ "เซิร์ฟเวอร์" — ตรวจ role จาก session จริงตอนเรียก API ส่งออก
//   แล้วปฏิเสธคำขอที่บทบาทไม่มีสิทธิ์ (คืน 403) · การกรอง/ซ่อนตัวเลือกบนหน้าจอนี้เป็นเพียง
//   ตัวช่วย UX ลดความสับสน ไม่ใช่กลไกควบคุมสิทธิ์ · ห้ามพึ่งการซ่อนบนหน้าจอเพียงอย่างเดียว
// ═══════════════════════════════════════════════════════════════════════════

export const EXPORT_ROLES = [
  {key:"Administrator",     label:"ผู้ดูแลระบบ"},
  {key:"Management",        label:"ผู้บริหาร"},
  {key:"Trade Coordinator", label:"ผู้ประสานงานการค้า"},
];
export const EXPORT_FORMATS = [
  {key:"pdf",   label:"PDF"},
  {key:"excel", label:"Excel"},
  {key:"csv",   label:"CSV"},
];

// ค่าเริ่มต้นตามนโยบาย: CSV เปิดเฉพาะผู้ดูแลระบบ (ดึงข้อมูลทั้งชุดไปทำเหมืองต่อได้)
export const DEFAULT_EXPORT_PERMS = {
  "Administrator":     {pdf:true, excel:true,  csv:true},
  "Management":        {pdf:true, excel:true,  csv:false},
  "Trade Coordinator": {pdf:true, excel:false, csv:false},
};

const KEY="geo_export_perms";
export function getExportPerms(){
  try{ const s=JSON.parse(localStorage.getItem(KEY)); if(s&&typeof s==="object") return {...DEFAULT_EXPORT_PERMS, ...s}; }catch(e){}
  return DEFAULT_EXPORT_PERMS;
}
export function setExportPerms(perms){ try{ localStorage.setItem(KEY, JSON.stringify(perms)); }catch(e){} }
// ตรวจว่าบทบาทนี้ส่งออกไฟล์ประเภทนี้ได้หรือไม่ (ใช้ทั้งกรองตัวเลือก UI และด่านตรวจก่อนส่งออกจริง)
export function canExport(role, fmt){ const p=getExportPerms()[role]; return !!(p && p[fmt]); }
