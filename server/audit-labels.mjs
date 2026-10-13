const EVENT = {
  login: ['เข้าสู่ระบบ', 'Sign in'],
  login_fail: ['เข้าสู่ระบบไม่สำเร็จ', 'Sign-in failed'],
  logout: ['ออกจากระบบ', 'Sign out'],
  password_change: ['เปลี่ยนรหัสผ่าน', 'Changed password'],
  profile_update: ['แก้ไขข้อมูลส่วนตัว', 'Edited own profile'],
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
  before: ['ก่อนแก้', 'Before'],
  after: ['หลังแก้', 'After'],
  segmentFrom: ['หมวดเดิม', 'Previous segment'],
  segmentTo: ['หมวดใหม่', 'New segment'],
  via: ['ทำผ่าน', 'Via'],
  changes: ['การเปลี่ยนแปลง', 'Changes'],
};

const SUB = {
  ok: ['สำเร็จ', 'Imported'],
  dup: ['ซ้ำ', 'Duplicates'],
  incomplete: ['ข้อมูลไม่ครบ', 'Incomplete'],
  badcoord: ['พิกัดผิด', 'Bad coordinates'],
  total: ['ทั้งหมด', 'Total'],
  code: ['รหัส', 'Code'],
  label_th: ['ชื่อไทย', 'Thai name'],
  label_en: ['ชื่ออังกฤษ', 'English name'],
  color_hex: ['สี', 'Colour'],
  icon: ['ไอคอน', 'Icon'],
  is_active: ['ใช้งาน', 'Active'],
  is_system: ['ของระบบ', 'System'],
  sort_order: ['ลำดับ', 'Order'],
  cut: ['เกณฑ์ระดับ', 'Level thresholds'],
  ref: ['ค่าอ้างอิง', 'Reference values'],
  weights: ['น้ำหนัก', 'Weights'],
  high: ['สูง', 'High'],
  medium: ['กลาง', 'Medium'],
  cluster: ['กลุ่ม', 'Cluster'],
  country: ['ประเทศ', 'Country'],
  district: ['อำเภอ', 'District'],
  province: ['จังหวัด', 'Province'],
  depth: ['ความลึก', 'Depth'],
  volume: ['ปริมาณ', 'Volume'],
  breadth: ['ความกว้าง', 'Breadth'],
  area: ['พื้นที่', 'Area'],
  period: ['ช่วงเวลา', 'Period'],
  segment: ['หมวดธุรกิจ', 'Segment'],
  actor: ['ผู้ใช้', 'User'],
  event: ['การกระทำ', 'Action'],
  status: ['สถานะ', 'Status'],
  q: ['คำค้น', 'Search'],
  account_no: ['เลขบัญชี', 'Account no.'],
  address: ['ที่อยู่', 'Address'],
  business_name: ['ชื่อธุรกิจ', 'Business name'],
  category: ['ประเภทกิจการ', 'Category'],
  date_join: ['วันที่เข้าร่วม', 'Join date'],
  email: ['อีเมล', 'Email'],
  latitude: ['ละติจูด', 'Latitude'],
  longitude: ['ลองจิจูด', 'Longitude'],
  phone: ['เบอร์โทร', 'Phone'],
  tc_owner_id: ['ผู้ดูแล (TC)', 'Owner (TC)'],
  type: ['ประเภท', 'Type'],
  facebook: ['Facebook', 'Facebook'],
  website: ['เว็บไซต์', 'Website'],
  name: ['ชื่อ', 'Name'],
  overrides: ['สิทธิ์รายคน', 'Personal permissions'],
  role: ['บทบาท', 'Role'],
  scope: ['ขอบเขตข้อมูล', 'Data scope'],
  deal_new: ['แจ้งเตือนดีลใหม่', 'New-deal alert'],
  deal_result: ['แจ้งเตือนผลดีล', 'Deal-result alert'],
  export_done: ['แจ้งเตือนส่งออกเสร็จ', 'Export-done alert'],
  import_done: ['แจ้งเตือนนำเข้าเสร็จ', 'Import-done alert'],
  lead_gap: ['แจ้งเตือนหมวดที่ยังขาด', 'Segment-gap alert'],
  lead_new: ['แจ้งเตือน Lead ใหม่', 'New-Lead alert'],
  weekly: ['สรุปรายสัปดาห์', 'Weekly summary'],
};

const VALUE = {
  status: {completed: ['เสร็จสมบูรณ์', 'Completed'], partial: ['บางส่วน', 'Partial'], failed: ['ไม่สำเร็จ', 'Failed'],
    all: ['ทั้งหมด', 'All'], Active: ['ใช้งาน', 'Active'], Suspended: ['ถูกระงับ', 'Suspended']},
  type: {Existing: ['ลูกค้า', 'Customer'], Prospect: ['Lead', 'Lead'], segments: ['หมวดธุรกิจ', 'Segments'],
    areas: ['พื้นที่ / จังหวัด', 'Areas / provinces'], 'reject-reasons': ['เหตุผลปฏิเสธดีล', 'Deal rejection reasons']},
  door: {admin: ['หน้าผู้ดูแลระบบ', 'Admin sign-in'], management: ['หน้าผู้บริหาร', 'Management sign-in'], tc: ['หน้า TC', 'TC sign-in']},
  role: {Administrator: ['ผู้ดูแลระบบ', 'Administrator'], Management: ['ผู้บริหาร', 'Management'],
    'Trade Coordinator': ['ผู้ประสานงานการค้า (TC)', 'Trade Coordinator (TC)']},
  reason: {credentials: ['รหัสผ่านไม่ถูกต้อง', 'Wrong password'], suspended: ['บัญชีถูกระงับ', 'Account suspended'],
    locked: ['บัญชีถูกล็อกชั่วคราว', 'Account locked'], door: ['เข้าผิดหน้าเข้าสู่ระบบ', 'Wrong sign-in page']},
  format: {csv: ['CSV', 'CSV'], excel: ['Excel', 'Excel'], pdf: ['PDF', 'PDF']},
  perm: {'report.export_summary': ['ส่งออกรายงานสรุป (PDF)', 'Export summary report (PDF)'],
    'report.export_raw_pii': ['ส่งออกข้อมูลดิบที่มี PII (CSV/Excel)', 'Export raw data containing PII (CSV/Excel)'],
    'audit.export': ['ส่งออก log', 'Export logs']},
  via: {'server-console': ['คำสั่งบนเครื่องเซิร์ฟเวอร์', 'Server console'],
    zone_publish: ['ใช้โซนจริง (ย้ายตามโซนอัตโนมัติ)', 'Zones published (moved with the zones)'],
    zone_approve: ['อนุมัติร่างโซน (ย้ายตามโซนอัตโนมัติ)', 'Zone draft approved (moved with the zones)'],
    zone_restore: ['ย้อนโซนเป็นฉบับเก่า (ย้ายตามโซนอัตโนมัติ)', 'Older zones restored (moved with the zones)']},
};

const MASTER_OF = {reason: 'reject-reasons', segmentFrom: 'segments', segmentTo: 'segments', segment: 'segments', province: 'areas'};

export async function loadLabelContext(pool) {
  const r = await pool.query('select type, code, label_th, label_en from master_data');
  const master = {};
  for (const x of r.rows) (master[x.type] ||= {})[x.code] = [x.label_th, x.label_en || x.label_th];
  return {master};
}

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
const word = (k, L) => (Object.hasOwn(SUB, k) ? SUB[k][at(L)] : k);
const codeLabel = (k, v, L, ctx) => {
  if (VALUE[k] && Object.hasOwn(VALUE[k], v)) return VALUE[k][v][at(L)];
  if (k === 'event' && Object.hasOwn(EVENT, v)) return EVENT[v][at(L)];
  const m = MASTER_OF[k] && ctx.master && ctx.master[MASTER_OF[k]];
  return m && Object.hasOwn(m, v) ? m[v][at(L)] : v;
};
const flat = (v, L, ctx) => Object.entries(v).filter(([, b]) => b !== null && b !== undefined && b !== '')
  .map(([a, b]) => word(a, L) + ': ' + plain(b, L, ctx, a)).join(', ');
const plain = (v, L, ctx, k) => (Array.isArray(v) ? v.map(x => plain(x, L, ctx, k)).join(', ')
  : v && typeof v === 'object' ? '(' + flat(v, L, ctx) + ')'
  : v === true ? '✓' : v === false ? '—' : v === null || v === undefined ? '' : typeof v === 'string' ? codeLabel(k, v, L, ctx) : String(v));
const areaLabel = (key, L, ctx) => {
  const [prov, zone] = String(key).split('/');
  const p = codeLabel('province', prov, L, ctx);
  if (!zone) return p;
  return p + ' · ' + (zone === '__rest' ? (L === 'en' ? 'Outside any zone' : 'พื้นที่นอกโซน') : (L === 'en' ? 'zone ' : 'โซน ') + zone);
};
const noOwner = L => (L === 'en' ? 'No owner' : 'ไม่มีผู้ดูแล');
const territoryChanges = (v, L, ctx) => v.map(c => areaLabel(c.area, L, ctx) + ': '
  + (c.from || noOwner(L)) + ' → ' + (c.to || noOwner(L))).join(', ');
const value = (v, k, L, ctx) => (k === 'changes' && Array.isArray(v) && v.every(c => c && typeof c === 'object' && 'area' in c)
  ? territoryChanges(v, L, ctx)
  : Array.isArray(v)
  ? (k === 'fields' || k === 'changed' ? v.map(x => word(String(x), L)) : v.map(x => plain(x, L, ctx, k))).join(', ')
  : v && typeof v === 'object' ? (k === 'scope' ? Object.values(v).filter(Boolean).join(' · ') : flat(v, L, ctx)) : plain(v, L, ctx, k));

export const EVENT_CODES = Object.keys(EVENT);
export const KEY_CODES = Object.keys(KEY);
export const eventLabel = (code, L) => (Object.hasOwn(EVENT, code || '') ? EVENT[code][at(L)] : code || '');
export const roleLabel = (role, L) => (role && Object.hasOwn(VALUE.role, role) ? VALUE.role[role][at(L)] : role || '');
export const targetLabel = (r, L) => (isExport(r) && Object.hasOwn(EXPORT_TARGET, r.target || '') ? EXPORT_TARGET[r.target][at(L)] : r.target || '');

export function detailLabel(r, L, ctx = {}) {
  const parts = [];
  for (const [k, v] of Object.entries(r.detail || {})) {
    if (isExport(r) && (k === 'kind' || k === 'source')) continue;
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
    const s = value(v, k, L, ctx);
    if (s === '') continue;
    parts.push((Object.hasOwn(KEY, k) ? KEY[k][at(L)] : k) + ': ' + s);
  }
  return parts.join(' · ');
}
