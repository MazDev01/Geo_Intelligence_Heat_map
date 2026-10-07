import {t} from "./i18n.js";
import {token} from "./auth.js";

export async function fetchAudit(params){
  const qs = new URLSearchParams();
  for(const [k,v] of Object.entries(params||{})) if(v!==undefined && v!==null && v!=="") qs.set(k, String(v));
  const tk = token();
  try{
    const r = await fetch("/api/audit?"+qs, {cache:"no-store", headers: tk ? {Authorization:"Bearer "+tk} : {}});
    const data = await r.json().catch(()=>null);
    if(r.status===404 || r.status===405) return {ok:false, error:t("เซิร์ฟเวอร์นี้ยังไม่รองรับบันทึกการตรวจสอบ", "This server does not support the audit log yet")};
    if(r.status===401) return {ok:false, error:t("ต้องเข้าสู่ระบบด้วยบัญชีจริงจึงจะดูบันทึกได้ (โหมดทดลองไม่มีบันทึก)", "Sign in with a real account to see the log (demo mode has none)")};
    if(r.status===403) return {ok:false, error:t("บัญชีนี้ไม่มีสิทธิ์ดูบันทึกการตรวจสอบ", "This account may not view the audit log")};
    if(!r.ok) return {ok:false, error:(data && data.error) || t("โหลดบันทึกไม่สำเร็จ", "Could not load the log")};
    return data;
  }catch(e){
    return {ok:false, error:t("ติดต่อเซิร์ฟเวอร์ไม่ได้", "Could not reach the server")};
  }
}

const EV = {
  login:               [()=>t("เข้าสู่ระบบ","Sign in"), "shield", "info"],
  login_fail:          [()=>t("เข้าสู่ระบบไม่สำเร็จ","Sign-in failed"), "shield", "bad"],
  logout:              [()=>t("ออกจากระบบ","Sign out"), "logout", "neutral"],
  password_change:     [()=>t("เปลี่ยนรหัสผ่าน","Changed password"), "shield", "info"],
  user_create:         [()=>t("สร้างบัญชี","Created an account"), "user", "good"],
  user_update:         [()=>t("แก้ไขบัญชี","Edited an account"), "user", "info"],
  user_remove:         [()=>t("ลบบัญชี","Deleted an account"), "user", "bad"],
  user_password_reset: [()=>t("รีเซ็ตรหัสผ่าน","Reset a password"), "user", "warn"],
  place_create:        [()=>t("เพิ่มรายการ","Added a record"), "edit", "good"],
  place_update:        [()=>t("แก้ไขรายการ","Edited a record"), "edit", "info"],
  place_delete:        [()=>t("ลบรายการ","Deleted a record"), "edit", "bad"],
  import_upload:       [()=>t("อัปโหลดไฟล์นำเข้า","Uploaded an import file"), "download", "info"],
  import_mapping:      [()=>t("จับคู่คอลัมน์นำเข้า","Mapped import columns"), "download", "info"],
  import_confirm:      [()=>t("ยืนยันการนำเข้า","Confirmed an import"), "download", "good"],
  import_withdraw:     [()=>t("ยกเลิกการนำเข้าทั้งชุด","Withdrew an import batch"), "download", "bad"],
  import_queue_import: [()=>t("นำเข้าจากคิวรอแก้ไข","Imported from the review queue"), "download", "good"],
  import_queue_merge:  [()=>t("รวมกับรายการเดิม","Merged with an existing record"), "download", "info"],
  import_queue_skip:   [()=>t("ข้ามรายการในคิว","Skipped queue rows"), "download", "warn"],
  import_queue_unskip: [()=>t("นำกลับเข้าคิว","Returned rows to the queue"), "download", "info"],
  territory_assign:    [()=>t("มอบหมายเขตการขาย","Assigned sales territories"), "refresh", "info"],
  zone_draft_save:     [()=>t("บันทึกร่างโซน","Saved a zone draft"), "refresh", "info"],
  zone_publish:        [()=>t("เผยแพร่โซน","Published zones"), "refresh", "good"],
  zone_approve:        [()=>t("อนุมัติร่างโซน","Approved the zone draft"), "refresh", "good"],
  zone_discard:        [()=>t("ทิ้งร่างโซน","Discarded the zone draft"), "refresh", "warn"],
  zone_restore:        [()=>t("ย้อนโซนเป็นฉบับเก่า","Restored an older zone version"), "refresh", "warn"],
  plan_create:         [()=>t("สร้างแผนเข้าพบ","Created a visit plan"), "check", "info"],
  plan_save:           [()=>t("บันทึกแผนเข้าพบ","Saved a visit plan"), "check", "good"],
  plan_delete:         [()=>t("ลบแผนเข้าพบ","Deleted a visit plan"), "check", "bad"],
  lead_request_submit:  [()=>t("ส่งดีลขออนุมัติ","Submitted a deal for approval"), "check", "info"],
  lead_request_approve: [()=>t("อนุมัติดีล เปลี่ยนเป็นลูกค้า","Approved a deal — converted to customer"), "check", "good"],
  lead_request_reject:  [()=>t("ปฏิเสธดีล","Rejected a deal"), "check", "warn"],
  lead_request_undo:    [()=>t("ย้อนการอนุมัติดีล","Reversed a deal approval"), "check", "warn"],
  visit_record:        [()=>t("บันทึกผลเข้าพบ","Recorded a visit result"), "check", "info"],
  export:              [()=>t("ส่งออกข้อมูล","Exported data"), "download", "info"],
  export_denied:       [()=>t("ส่งออกถูกปฏิเสธ","Export refused"), "download", "bad"],
  settings_update:     [()=>t("แก้การตั้งค่าระบบ","Changed system settings"), "config", "info"],
  master_create:       [()=>t("เพิ่มข้อมูลหลัก","Added master data"), "config", "good"],
  master_update:       [()=>t("แก้ข้อมูลหลัก","Changed master data"), "config", "info"],
};

export const AUDIT_GROUPS = {
  auth:    {label:()=>t("เข้า/ออกระบบ","Sign-in & out"),        events:["login","login_fail","logout","password_change"]},
  users:   {label:()=>t("บัญชีผู้ใช้","User accounts"),          events:["user_create","user_update","user_remove","user_password_reset"]},
  places:  {label:()=>t("ลูกค้าและ Lead","Customers & Leads"),   events:["place_create","place_update","place_delete"]},
  imports: {label:()=>t("นำเข้าข้อมูล","Data import"),           events:["import_upload","import_mapping","import_confirm","import_withdraw","import_queue_import","import_queue_merge","import_queue_skip","import_queue_unskip"]},
  areas:   {label:()=>t("เขตและโซน","Territories & zones"),      events:["territory_assign","zone_draft_save","zone_publish","zone_approve","zone_discard","zone_restore"]},
  visits:  {label:()=>t("แผนและผลเข้าพบ","Visit plans & results"), events:["plan_create","plan_save","plan_delete","visit_record"]},
  deals:   {label:()=>t("ดีลและการอนุมัติ","Deals & approvals"), events:["lead_request_submit","lead_request_approve","lead_request_reject","lead_request_undo"]},
  exports: {label:()=>t("ส่งออกข้อมูล","Data export"),           events:["export","export_denied"]},
  settings:{label:()=>t("ตั้งค่าระบบ","System settings"),         events:["settings_update","master_create","master_update"]},
};

export const eventLabel = code => (EV[code] ? EV[code][0]() : code);
export const eventIcon  = code => (EV[code] ? EV[code][1] : "edit");
export const eventTone  = code => (EV[code] ? EV[code][2] : "info");

const KEY_LABEL = {
  businessName:()=>t("ชื่อธุรกิจ","Business"), province:()=>t("จังหวัด","Province"), type:()=>t("ประเภท","Type"),
  fields:()=>t("ช่องที่แก้","Fields changed"), role:()=>t("บทบาท","Role"), filename:()=>t("ไฟล์","File"),
  rows:()=>t("แถว","Rows"), bytes:()=>t("ขนาด (ไบต์)","Size (bytes)"), status:()=>t("สถานะ","Status"), counts:()=>t("สรุป","Summary"),
  template:()=>t("ผังจับคู่","Template"), withdrawn:()=>t("ลบออก","Removed"), kept:()=>t("เก็บไว้","Kept"), round:()=>t("รอบ","Round"),
  places:()=>t("ร้าน","Places"), saved:()=>t("บันทึกแล้ว","Saved"), door:()=>t("ประตู","Entrance"), reason:()=>t("เหตุผล","Reason"),
  count:()=>t("จำนวน","Count"), ids:()=>t("รหัสแถว","Row IDs"),
  requestId:()=>t("คำขอ","Request"), gap:()=>t("ช่องว่างตลาด","Market gap"), ownerId:()=>t("ผู้ดูแล (รหัส)","Owner (ID)"), custType:()=>t("ประเภทลูกค้า","Customer type"),
  kind:()=>t("รายงาน","Report"), format:()=>t("รูปแบบ","Format"), records:()=>t("รายการ","Records"), scope:()=>t("ขอบเขต","Scope"),
  changed:()=>t("รายการที่เปลี่ยน","Changed"), perm:()=>t("สิทธิ์ที่ต้องมี","Permission needed"), source:()=>t("แหล่งข้อมูล","Source"), filters:()=>t("ตัวกรอง","Filters"),
};
const fmtObj = (k, v) => k==="scope" ? Object.values(v).filter(Boolean).join(" · ")
  : k==="filters" ? Object.entries(v).map(([a,b])=>a+"="+b).join(", ") : JSON.stringify(v);
const fmtVal = (v, k) => Array.isArray(v) ? v.join(", ") : (v && typeof v==="object") ? fmtObj(k, v) : v===true ? "✓" : v===false ? "—" : String(v);

const EXPORT_TARGET = {
  report:()=>t("รายงานพื้นที่","Area report"), visit_plans:()=>t("รายงานแผนเข้าพบ","Visit plan report"), dashboard:()=>t("แดชบอร์ด","Dashboard"),
  places:()=>t("ข้อมูลลูกค้าและ Lead","Customer & Lead data"), tc_records:()=>t("ข้อมูลที่ TC กรอก","TC-entered records"),
  audit:()=>t("บันทึกการตรวจสอบ","Audit log"), lead_requests:()=>t("คำขอดีล","Deal requests"),
};

export function detailText(r){
  const parts = [];
  const isExport = r.event==="export" || r.event==="export_denied";
  if(r.target) parts.push(isExport && EXPORT_TARGET[r.target] ? EXPORT_TARGET[r.target]() : r.target);
  for(const [k,v] of Object.entries(r.detail||{})){
    if(isExport && (k==="kind" || k==="source")) continue;
    if(v===null || v===undefined || v==="" || (Array.isArray(v) && !v.length)) continue;
    const s = fmtVal(v, k);
    if(s==="") continue;
    parts.push((KEY_LABEL[k] ? KEY_LABEL[k]() : k)+": "+s);
  }
  return parts.join(" · ");
}
