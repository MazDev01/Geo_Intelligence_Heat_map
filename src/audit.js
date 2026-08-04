// ── บันทึกการตรวจสอบ (Audit Log) ที่ใช้ร่วมกันทั้งระบบ ──
// ทุก action ที่เปลี่ยนแปลงข้อมูล (นำเข้า/แก้ไข/ลบ/แก้ conflict/ส่งออก) เรียก pushAudit()
// หน้า "บันทึกการตรวจสอบ" อ่านผ่าน getAudit()/subscribeAudit() เพื่อแสดงรวมกับ log ระบบเดิม
let _log = [];
const subs = new Set();
let _seq = 1;

// entry: { user, action, category, detail } · ts เติมให้อัตโนมัติ (เวลาเรียก)
export function pushAudit(entry){
  _log = [{ id:"al"+(_seq++), ts:new Date().toISOString(), user:"System Administrator", ...entry }, ..._log];
  subs.forEach(fn=>{ try{ fn(_log); }catch(e){} });
  return _log[0];
}
export function getAudit(){ return _log; }
export function subscribeAudit(fn){ subs.add(fn); return ()=>subs.delete(fn); }
