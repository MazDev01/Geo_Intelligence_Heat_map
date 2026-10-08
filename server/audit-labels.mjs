const EVENT = {
  login: ['เข้าสู่ระบบ', 'Sign in'],
  login_fail: ['เข้าสู่ระบบไม่สำเร็จ', 'Sign-in failed'],
  logout: ['ออกจากระบบ', 'Sign out'],
  password_change: ['เปลี่ยนรหัสผ่าน', 'Changed password'],
  user_create: ['สร้างบัญชี', 'Created an account'],
  user_update: ['แก้ไขบัญชี', 'Edited an account'],
  user_remove: ['ลบบัญชี', 'Deleted an account'],
  user_password_reset: ['รีเซ็ตรหัสผ่าน', 'Reset a password'],
  place_create: ['เพิ่มรายการ', 'Added a record'],
  place_update: ['แก้ไขรายการ', 'Edited a record'],
  place_delete: ['ลบรายการ', 'Deleted a record'],
  import_upload: ['อัปโหลดไฟล์นำเข้า', 'Uploaded an import file'],
  import_mapping: ['จับคู่คอลัมน์นำเข้า', 'Mapped import columns'],
  import_confirm: ['ยืนยันการนำเข้า', 'Confirmed an import'],
  import_withdraw: ['ยกเลิกการนำเข้าทั้งชุด', 'Withdrew an import batch'],
  import_queue_import: ['นำเข้าจากคิวรอแก้ไข', 'Imported from the review queue'],
  import_queue_merge: ['รวมกับรายการเดิม', 'Merged with an existing record'],
  import_queue_skip: ['ข้ามรายการในคิว', 'Skipped queue rows'],
  import_queue_unskip: ['นำกลับเข้าคิว', 'Returned rows to the queue'],
  territory_assign: ['มอบหมายเขตการขาย', 'Assigned sales territories'],
  zone_draft_save: ['บันทึกร่างโซน', 'Saved a zone draft'],
  zone_publish: ['เผยแพร่โซน', 'Published zones'],
  zone_approve: ['อนุมัติร่างโซน', 'Approved the zone draft'],
  zone_discard: ['ทิ้งร่างโซน', 'Discarded the zone draft'],
  zone_restore: ['ย้อนโซนเป็นฉบับเก่า', 'Restored an older zone version'],
  plan_create: ['สร้างแผนเข้าพบ', 'Created a visit plan'],
  plan_save: ['บันทึกแผนเข้าพบ', 'Saved a visit plan'],
  plan_delete: ['ลบแผนเข้าพบ', 'Deleted a visit plan'],
  lead_request_submit: ['ส่งดีลขออนุมัติ', 'Submitted a deal for approval'],
  lead_request_approve: ['อนุมัติดีล เปลี่ยนเป็นลูกค้า', 'Approved a deal — converted to customer'],
  lead_request_reject: ['ปฏิเสธดีล', 'Rejected a deal'],
  lead_request_undo: ['ย้อนการอนุมัติดีล', 'Reversed a deal approval'],
  visit_record: ['บันทึกผลเข้าพบ', 'Recorded a visit result'],
  export: ['ส่งออกข้อมูล', 'Exported data'],
  export_denied: ['ส่งออกถูกปฏิเสธ', 'Export refused'],
  settings_update: ['แก้การตั้งค่าระบบ', 'Changed system settings'],
  master_create: ['เพิ่มข้อมูลหลัก', 'Added master data'],
  master_update: ['แก้ข้อมูลหลัก', 'Changed master data'],
};

const KEY = {
  businessName: ['ชื่อธุรกิจ', 'Business'],
  province: ['จังหวัด', 'Province'],
  type: ['ประเภท', 'Type'],
  fields: ['ช่องที่แก้', 'Fields changed'],
  role: ['บทบาท', 'Role'],
  filename: ['ไฟล์', 'File'],
  rows: ['แถว', 'Rows'],
  bytes: ['ขนาด (ไบต์)', 'Size (bytes)'],
  status: ['สถานะ', 'Status'],
  counts: ['สรุป', 'Summary'],
  template: ['ผังจับคู่', 'Template'],
  withdrawn: ['ลบออก', 'Removed'],
  kept: ['เก็บไว้', 'Kept'],
  round: ['รอบ', 'Round'],
  places: ['ร้าน', 'Places'],
  saved: ['บันทึกแล้ว', 'Saved'],
  door: ['ประตู', 'Entrance'],
  reason: ['เหตุผล', 'Reason'],
  count: ['จำนวน', 'Count'],
  ids: ['รหัสแถว', 'Row IDs'],
  requestId: ['คำขอ', 'Request'],
  file: ['ไฟล์แนบ', 'Attachment'],
  gap: ['ช่องว่างตลาด', 'Market gap'],
  ownerId: ['ผู้ดูแล (รหัส)', 'Owner (ID)'],
  custType: ['ประเภทลูกค้า', 'Customer type'],
  kind: ['รายงาน', 'Report'],
  format: ['รูปแบบ', 'Format'],
  records: ['รายการ', 'Records'],
  scope: ['ขอบเขต', 'Scope'],
  changed: ['รายการที่เปลี่ยน', 'Changed'],
  perm: ['สิทธิ์ที่ต้องมี', 'Permission needed'],
  source: ['แหล่งข้อมูล', 'Source'],
  filters: ['ตัวกรอง', 'Filters'],
};

const EXPORT_TARGET = {
  report: ['รายงานพื้นที่', 'Area report'],
  visit_plans: ['รายงานแผนเข้าพบ', 'Visit plan report'],
  dashboard: ['แดชบอร์ด', 'Dashboard'],
  places: ['ข้อมูลลูกค้าและ Lead', 'Customer & Lead data'],
  tc_records: ['ข้อมูลที่ TC กรอก', 'TC-entered records'],
  audit: ['บันทึกการตรวจสอบ', 'Audit log'],
  lead_requests: ['คำขอดีล', 'Deal requests'],
};

const at = L => (L === 'en' ? 1 : 0);
const isExport = r => r.event === 'export' || r.event === 'export_denied';
const flat = v => Object.entries(v).map(([a, b]) => a + '=' + plain(b)).join(', ');
const plain = v => (Array.isArray(v) ? v.map(plain).join(', ') : v && typeof v === 'object' ? '(' + flat(v) + ')'
  : v === true ? '✓' : v === false ? '—' : v === null || v === undefined ? '' : String(v));
const value = (v, k) => (Array.isArray(v) ? v.map(plain).join(', ') : v && typeof v === 'object'
  ? (k === 'scope' ? Object.values(v).filter(Boolean).join(' · ') : flat(v)) : plain(v));

export const EVENT_CODES = Object.keys(EVENT);
export const KEY_CODES = Object.keys(KEY);
export const eventLabel = (code, L) => (Object.hasOwn(EVENT, code || '') ? EVENT[code][at(L)] : code || '');
export const targetLabel = (r, L) => (isExport(r) && Object.hasOwn(EXPORT_TARGET, r.target || '') ? EXPORT_TARGET[r.target][at(L)] : r.target || '');

export function detailLabel(r, L) {
  const parts = [];
  for (const [k, v] of Object.entries(r.detail || {})) {
    if (isExport(r) && (k === 'kind' || k === 'source')) continue;
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
    const s = value(v, k);
    if (s === '') continue;
    parts.push((Object.hasOwn(KEY, k) ? KEY[k][at(L)] : k) + ': ' + s);
  }
  return parts.join(' · ');
}
