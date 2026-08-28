/* ═══════════════════════════════════════════════════════════════════════════
   แบบจำลองสิทธิ์การใช้งาน (Permission Model) — GeoIntel · Barter Connect
   อ้างอิงเอกสาร "แบบจำลองสิทธิ์การใช้งานฉบับปรับปรุง v1.0 (28 ส.ค. 2569)"

   โครงสร้าง 3 ชั้นตามเอกสาร:
     ชั้นที่ 1  บทบาท (Role)        → ชุดสิทธิ์สำเร็จรูปที่ผูกกับตำแหน่งงาน
     ชั้นที่ 2  สิทธิ์รายการ (Permission) → ทำอะไรได้บ้างในแต่ละเมนู
     ชั้นที่ 3  ขอบเขตข้อมูล (Scope)  → เห็นข้อมูลของใคร

   ต่างจากเอกสารจุดเดียว: ระบบนี้คงไว้ 3 บทบาทเดิม (ผู้ดูแลระบบ · ผู้บริหาร · TC)
   ไม่ได้แยก TEAM_LEAD และ EXECUTIVE ออกมา — คอลัมน์ SALES_MANAGER ในเอกสาร
   ถูกใช้เป็นค่าตั้งต้นของ "ผู้บริหาร"
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── บทบาท (ชั้นที่ 1) ── */
export const ROLES = [
  { key:"Administrator",     th:"ผู้ดูแลระบบ",              code:"ADMIN" },
  { key:"Management",        th:"ผู้บริหาร",                code:"SALES_MANAGER" },
  { key:"Trade Coordinator", th:"ผู้ประสานงานการค้า (TC)",  code:"TC" },
];
export const ROLE_TH = Object.fromEntries(ROLES.map(r=>[r.key, r.th]));
/* role key → code ตามเอกสาร (ADMIN · SALES_MANAGER · TC) — ใช้แทนการเทียบสตริงบทบาทดิบ */
export const ROLE_CODE = Object.fromEntries(ROLES.map(r=>[r.key, r.code]));
export const roleCode = role => ROLE_CODE[role] || null;

/* ── ขอบเขตข้อมูล (ชั้นที่ 3) ──
   บังคับจริงต้องทำที่ชั้น query ฝั่งเซิร์ฟเวอร์ ไม่ใช่ที่ UI */
export const SCOPES = [
  { key:"national",  th:"ทั้งประเทศ",                 hint:"เห็นทุกจังหวัด ทุกรายการ" },
  { key:"own_area",  th:"เฉพาะจังหวัดที่รับผิดชอบ",   hint:"เห็นเฉพาะพื้นที่ของตัวเอง" },
];
export const SCOPE_TH = Object.fromEntries(SCOPES.map(s=>[s.key, s.th]));
export const DEFAULT_SCOPE = {
  "Administrator":"national", "Management":"national", "Trade Coordinator":"own_area",
};

/* ── สิทธิ์รายการ (ชั้นที่ 2) ──
   ค่าในแต่ละบทบาท:  "y" = เปิดตามค่าตั้งต้น · "o" = มีได้แต่ต้องเปิดรายบุคคล · "n" = ไม่มีสิทธิ์
   ลำดับคอลัมน์: [ผู้ดูแลระบบ, ผู้บริหาร, TC]                                     */
export const PERM_MODULES = [
  { key:"dashboard", name:"แดชบอร์ด", perms:[
    ["dashboard.view",            "ดูแดชบอร์ด",                          ["y","y","y"]],
    ["dashboard.view_usage_kpi",  "ดู KPI การใช้งานระบบ",                ["y","y","n"]],
  ]},
  { key:"map", name:"แผนที่วิเคราะห์", perms:[
    ["map.view",                  "ดูแผนที่และแผนที่ความร้อน",            ["y","y","y"]],
    ["map.view_score",            "ดูดัชนีระดับพื้นที่",                  ["y","y","y"]],
    ["map.view_contact_pii",      "ดูข้อมูลติดต่อลูกค้า (PII)",           ["y","y","y"]],
  ]},
  { key:"customer", name:"ลูกค้าและ Lead", perms:[
    ["customer.view",             "ดูรายการ",                            ["y","y","y"]],
    ["customer.create",           "เพิ่มด้วยตนเอง",                      ["y","y","y"]],
    ["customer.edit_own",         "แก้ไขรายการที่ตัวเองกรอก",             ["y","y","y"]],
    ["customer.edit_any",         "แก้ไขรายการของคนอื่น / จากไฟล์นำเข้า",  ["y","y","n"]],
    ["customer.delete",           "ลบข้อมูล",                            ["y","o","n"]],
    ["customer.approve_manual",   "ตรวจ/อนุมัติข้อมูลที่ถูกเพิ่มเอง",      ["y","y","n"]],
    ["customer.convert",          "เปลี่ยน Lead เป็นลูกค้า",              ["y","y","o"]],
    ["customer.reassign",         "ย้ายผู้รับผิดชอบ",                     ["y","y","n"]],
  ]},
  { key:"territory", name:"ขอบเขตพื้นที่การขาย", perms:[
    ["territory.view",            "ดูขอบเขตและผู้ดูแลรายพื้นที่",          ["y","y","y"]],
    ["territory.draft",           "สร้าง/แก้ไขขอบเขต (ฉบับร่าง)",         ["o","y","n"]],
    ["territory.approve",         "อนุมัติแผนที่ให้มีผลจริง",              ["n","y","n"]],
    ["territory.rollback",        "ย้อนขอบเขตกลับเวอร์ชันก่อน",           ["y","y","n"]],
    ["territory.upload_boundary", "อัปโหลดไฟล์ขอบเขต (GeoJSON/Shapefile)", ["y","o","n"]],
  ]},
  { key:"visit", name:"แผนการเข้าพบ", perms:[
    ["visit.manage_own",          "สร้าง/แก้ไขแผนของตัวเอง",              ["y","y","y"]],
    ["visit.view_team",           "ดูแผนของทั้งทีม",                     ["y","y","n"]],
    ["visit.manage_any",          "แก้ไขแผนของคนอื่น",                    ["o","y","n"]],
  ]},
  { key:"report", name:"รายงานและการส่งออก", perms:[
    ["report.view",               "ดูรายงานวิเคราะห์",                    ["y","y","y"]],
    ["report.export_summary",     "ส่งออกรายงานสรุป (PDF)",               ["y","y","y"]],
    ["report.export_raw_pii",     "ส่งออกข้อมูลดิบที่มี PII (CSV/Excel)",  ["o","y","n"]],
  ]},
  { key:"data", name:"เชื่อมต่อและนำเข้าข้อมูล", perms:[
    ["data.view_status",          "ดูสถานะการเชื่อมต่อและ error",         ["y","y","n"]],
    ["data.import",               "นำเข้าไฟล์ Excel/CSV",                 ["y","o","n"]],
    ["data.resolve_conflict",     "แก้ conflict / จับคู่ฟิลด์ (mapping)",  ["y","n","n"]],
    ["data.manage_connection",    "ตั้งค่าการเชื่อมต่อทางข้อมูล",          ["y","n","n"]],
    ["data.trigger_sync",         "สั่งซิงค์ข้อมูลด้วยตนเอง",              ["y","o","n"]],
  ]},
  { key:"user", name:"ผู้ใช้และบทบาท", perms:[
    ["user.view",                 "ดูรายชื่อผู้ใช้",                      ["y","y","n"]],
    ["user.manage",               "เพิ่ม/แก้ไขผู้ใช้",                    ["y","o","n"]],
    ["user.set_active",           "เปิด/ปิดการเข้าใช้งานบัญชี",            ["y","o","n"]],
    ["user.grant_permission",     "กำหนดสิทธิ์และบทบาทให้ผู้อื่น",         ["y","n","n"]],
    ["user.assign_scope",         "กำหนดขอบเขตข้อมูลให้ผู้อื่น",           ["y","y","n"]],
    ["user.impersonate",          "เข้าใช้แทนบัญชีผู้ใช้ (impersonate)",    ["o","n","n"]],
  ]},
  { key:"settings", name:"ตั้งค่าระบบ", perms:[
    ["settings.manage",           "ตั้งค่า parameter ทั่วไป",             ["y","n","n"]],
    ["settings.manage_scoring",   "ตั้งค่าเกณฑ์การให้คะแนน (scoring)",     ["o","y","n"]],
    ["settings.manage_layer",     "ตั้งค่าเลเยอร์และรอบอัปเดตข้อมูล",       ["y","o","n"]],
    ["settings.manage_api_key",   "จัดการ API key / integration token",   ["y","n","n"]],
  ]},
  { key:"audit", name:"บันทึกการตรวจสอบ", perms:[
    ["audit.view",                "ดู log การเข้าใช้และการแก้ข้อมูล",       ["y","y","n"]],
    ["audit.view_export",         "ดู log การส่งออกข้อมูล",                ["y","y","n"]],
    ["audit.export",              "ส่งออก log",                          ["y","n","n"]],
  ]},
];

/* แผนที่แบน: key → {label, module, moduleName, byRole:[a,m,t]} */
export const PERM_INDEX = Object.fromEntries(
  PERM_MODULES.flatMap(m => m.perms.map(([k,label,byRole]) =>
    [k, {key:k, label, module:m.key, moduleName:m.name, byRole}])));

export const PERM_KEYS = Object.keys(PERM_INDEX);
export const PERM_COUNT = PERM_KEYS.length;

const ROLE_COL = {"Administrator":0, "Management":1, "Trade Coordinator":2};

/* ค่าตั้งต้นของสิทธิ์หนึ่งรายการตามบทบาท: "y" | "o" | "n" */
export const permByRole = (key, role) => {
  const p = PERM_INDEX[key]; if(!p) return "n";
  return p.byRole[ROLE_COL[role] ?? 2];
};
/* บทบาทนี้เปิดสิทธิ์นี้ไว้ให้ตั้งแต่ต้นหรือไม่ ("y" เท่านั้น — "o" ต้องเปิดรายบุคคล) */
export const roleGrants = (key, role) => permByRole(key, role) === "y";
/* บทบาทนี้ "ห้าม" ถือสิทธิ์นี้เลยหรือไม่ — ผู้ดูแลเปิดให้ไม่ได้ ต้องเปลี่ยนบทบาทก่อน */
export const roleForbids = (key, role) => permByRole(key, role) === "n";

/* สิทธิ์ที่มีผลจริง = ค่าตั้งต้นของบทบาท ปรับด้วย override รายบุคคล
   overrides: { [key]: true|false }  (true = เปิดเพิ่ม, false = ปิดทับ) */
export function effectivePerms(role, overrides={}){
  const out = new Set();
  for(const k of PERM_KEYS){
    const has = Object.prototype.hasOwnProperty.call(overrides, k) ? !!overrides[k] : roleGrants(k, role);
    if(has && !roleForbids(k, role)) out.add(k);
  }
  return out;
}
/* นับเฉพาะ override ที่ต่างจากบทบาทจริง ๆ (กันนับซ้ำเวลาเปิด/ปิดกลับไปค่าเดิม) */
export function realOverrides(role, overrides={}){
  const out = {};
  for(const [k,v] of Object.entries(overrides||{})){
    if(!PERM_INDEX[k] || roleForbids(k, role)) continue;
    if(!!v !== roleGrants(k, role)) out[k] = !!v;
  }
  return out;
}

/* ── กติกาที่ระบบต้องบังคับเอง (ข้อ 06 ในเอกสาร) ──
   G1 ต้องเหลือผู้ดูแลที่ให้สิทธิ์ผู้อื่นได้อย่างน้อย 1 คน
   G2 แก้สิทธิ์ตัวเองไม่ได้ (กันทั้ง self-escalation และล็อกตัวเองออก)
   G6 ให้สิทธิ์เกินตัวเองไม่ได้                                        */
export const GUARD_KEY = "user.grant_permission";
