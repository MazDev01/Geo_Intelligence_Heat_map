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
import {t} from "./i18n.js";   // สลับภาษา TH/EN — ดู src/i18n.js

export const ROLES = [
  { key:"Administrator", get th(){ return t("ผู้ดูแลระบบ", "Administrator"); }, code:"ADMIN" },
  { key:"Management", get th(){ return t("ผู้บริหาร", "Management"); }, code:"SALES_MANAGER" },
  { key:"Trade Coordinator", get th(){ return t("ผู้ประสานงานการค้า (TC)", "Trade Coordinator (TC)"); }, code:"TC" },
];
export const ROLE_TH = Object.fromEntries(ROLES.map(r=>[r.key, r.th]));
/* role key → code ตามเอกสาร (ADMIN · SALES_MANAGER · TC) — ใช้แทนการเทียบสตริงบทบาทดิบ */
export const ROLE_CODE = Object.fromEntries(ROLES.map(r=>[r.key, r.code]));
export const roleCode = role => ROLE_CODE[role] || null;

/* ── ขอบเขตข้อมูล (ชั้นที่ 3) ──
   บังคับจริงต้องทำที่ชั้น query ฝั่งเซิร์ฟเวอร์ ไม่ใช่ที่ UI */
export const SCOPES = [
  { key:"national", get th(){ return t("ทั้งประเทศ", "Nationwide"); }, get hint(){ return t("เห็นทุกจังหวัด ทุกรายการ", "Sees every province and every record"); } },
  { key:"own_area", get th(){ return t("เฉพาะจังหวัดที่รับผิดชอบ", "Assigned province only"); }, get hint(){ return t("เห็นเฉพาะพื้นที่ของตัวเอง", "Sees only their own area"); } },
];
export const SCOPE_TH = Object.fromEntries(SCOPES.map(s=>[s.key, s.th]));
export const DEFAULT_SCOPE = {
  "Administrator":"national", "Management":"national", "Trade Coordinator":"own_area",
};

/* ── สิทธิ์รายการ (ชั้นที่ 2) ──
   ค่าในแต่ละบทบาท:  "y" = เปิดตามค่าตั้งต้น · "o" = มีได้แต่ต้องเปิดรายบุคคล · "n" = ไม่มีสิทธิ์
   ลำดับคอลัมน์: [ผู้ดูแลระบบ, ผู้บริหาร, TC]                                     */
export const PERM_MODULES = [
  { key:"dashboard", name:()=>t("แดชบอร์ด", "Dashboard"), perms:[
    ["dashboard.view",            ()=>t("ดูแดชบอร์ด", "View dashboard"),                          ["y","y","y"]],
    ["dashboard.view_usage_kpi",  ()=>t("ดู KPI การใช้งานระบบ", "View system usage KPIs"),                ["y","y","n"]],
  ]},
  { key:"map", name:()=>t("แผนที่วิเคราะห์", "Analysis map"), perms:[
    ["map.view",                  ()=>t("ดูแผนที่และแผนที่ความร้อน", "View map and heatmap"),            ["y","y","y"]],
    ["map.view_score",            ()=>t("ดูดัชนีระดับพื้นที่", "View area-level index"),                  ["y","y","y"]],
    ["map.view_contact_pii",      ()=>t("ดูข้อมูลติดต่อลูกค้า (PII)", "View customer contact details (PII)"),           ["y","y","y"]],
  ]},
  { key:"customer", name:()=>t("ลูกค้าและ Lead", "Customers & Leads"), perms:[
    ["customer.view",             ()=>t("ดูรายการ", "View records"),                            ["y","y","y"]],
    ["customer.create",           ()=>t("เพิ่มด้วยตนเอง", "Add manually"),                      ["y","y","y"]],
    ["customer.edit_own",         ()=>t("แก้ไขรายการที่ตัวเองกรอก", "Edit own records"),             ["y","y","y"]],
    ["customer.edit_any",         ()=>t("แก้ไขรายการของคนอื่น / จากไฟล์นำเข้า", "Edit others' / imported records"),  ["y","y","n"]],
    ["customer.delete",           ()=>t("ลบข้อมูล", "Delete records"),                            ["y","o","n"]],
    ["customer.approve_manual",   ()=>t("ตรวจ/อนุมัติข้อมูลที่ถูกเพิ่มเอง", "Review / approve manually added records"),      ["y","y","n"]],
    ["customer.convert",          ()=>t("เปลี่ยน Lead เป็นลูกค้า", "Convert Lead to customer"),              ["y","y","o"]],
    ["customer.reassign",         ()=>t("ย้ายผู้รับผิดชอบ", "Reassign owner"),                     ["y","y","n"]],
  ]},
  { key:"territory", name:()=>t("ขอบเขตพื้นที่การขาย", "Sales territories"), perms:[
    ["territory.view",            ()=>t("ดูขอบเขตและผู้ดูแลรายพื้นที่", "View territories and their owners"),          ["y","y","y"]],
    ["territory.draft",           ()=>t("สร้าง/แก้ไขขอบเขต (ฉบับร่าง)", "Create / edit territories (draft)"),         ["o","y","n"]],
    ["territory.approve",         ()=>t("อนุมัติแผนที่ให้มีผลจริง", "Approve a map to go live"),              ["n","y","n"]],
    ["territory.rollback",        ()=>t("ย้อนขอบเขตกลับเวอร์ชันก่อน", "Roll territories back to a previous version"),           ["y","y","n"]],
    ["territory.upload_boundary", ()=>t("อัปโหลดไฟล์ขอบเขต (GeoJSON/Shapefile)", "Upload boundary files (GeoJSON/Shapefile)"), ["y","o","n"]],
  ]},
  { key:"visit", name:()=>t("แผนการเข้าพบ", "Visit plans"), perms:[
    ["visit.manage_own",          ()=>t("สร้าง/แก้ไขแผนของตัวเอง", "Create / edit own plans"),              ["y","y","y"]],
    ["visit.view_team",           ()=>t("ดูแผนของทั้งทีม", "View the whole team's plans"),                     ["y","y","n"]],
    ["visit.manage_any",          ()=>t("แก้ไขแผนของคนอื่น", "Edit other people's plans"),                    ["o","y","n"]],
  ]},
  { key:"report", name:()=>t("รายงานและการส่งออก", "Reports & export"), perms:[
    ["report.view",               ()=>t("ดูรายงานวิเคราะห์", "View analysis reports"),                    ["y","y","y"]],
    ["report.export_summary",     ()=>t("ส่งออกรายงานสรุป (PDF)", "Export summary report (PDF)"),               ["y","y","y"]],
    ["report.export_raw_pii",     ()=>t("ส่งออกข้อมูลดิบที่มี PII (CSV/Excel)", "Export raw data containing PII (CSV/Excel)"),  ["o","y","n"]],
  ]},
  { key:"data", name:()=>t("เชื่อมต่อและนำเข้าข้อมูล", "Data connection & import"), perms:[
    ["data.view_status",          ()=>t("ดูสถานะการเชื่อมต่อและ error", "View connection status and errors"),         ["y","y","n"]],
    ["data.import",               ()=>t("นำเข้าไฟล์ Excel/CSV", "Import Excel/CSV files"),                 ["y","o","n"]],
    ["data.resolve_conflict",     ()=>t("แก้ conflict / จับคู่ฟิลด์ (mapping)", "Resolve conflicts / map fields"),  ["y","n","n"]],
    ["data.manage_connection",    ()=>t("ตั้งค่าการเชื่อมต่อทางข้อมูล", "Configure data connections"),          ["y","n","n"]],
    ["data.trigger_sync",         ()=>t("สั่งซิงค์ข้อมูลด้วยตนเอง", "Trigger a manual data sync"),              ["y","o","n"]],
  ]},
  { key:"user", name:()=>t("ผู้ใช้และบทบาท", "Users & roles"), perms:[
    ["user.view",                 ()=>t("ดูรายชื่อผู้ใช้", "View user list"),                      ["y","y","n"]],
    ["user.manage",               ()=>t("เพิ่ม/แก้ไขผู้ใช้", "Add / edit users"),                    ["y","o","n"]],
    ["user.set_active",           ()=>t("เปิด/ปิดการเข้าใช้งานบัญชี", "Enable / disable account access"),            ["y","o","n"]],
    ["user.grant_permission",     ()=>t("กำหนดสิทธิ์และบทบาทให้ผู้อื่น", "Grant permissions and roles to others"),         ["y","n","n"]],
    ["user.assign_scope",         ()=>t("กำหนดขอบเขตข้อมูลให้ผู้อื่น", "Assign data scope to others"),           ["y","y","n"]],
    ["user.impersonate",          ()=>t("เข้าใช้แทนบัญชีผู้ใช้ (impersonate)", "Impersonate a user account"),    ["o","n","n"]],
  ]},
  { key:"settings", name:()=>t("ตั้งค่าระบบ", "System settings"), perms:[
    ["settings.manage",           ()=>t("ตั้งค่า parameter ทั่วไป", "Configure general parameters"),             ["y","n","n"]],
    ["settings.manage_scoring",   ()=>t("ตั้งค่าเกณฑ์การให้คะแนน (scoring)", "Configure scoring rules"),     ["o","y","n"]],
    ["settings.manage_layer",     ()=>t("ตั้งค่าเลเยอร์และรอบอัปเดตข้อมูล", "Configure layers and refresh cycles"),       ["y","o","n"]],
    ["settings.manage_api_key",   ()=>t("จัดการ API key / integration token", "Manage API keys / integration tokens"),   ["y","n","n"]],
  ]},
  { key:"audit", name:()=>t("บันทึกการตรวจสอบ", "Audit log"), perms:[
    ["audit.view",                ()=>t("ดู log การเข้าใช้และการแก้ข้อมูล", "View access and data-change logs"),       ["y","y","n"]],
    ["audit.view_export",         ()=>t("ดู log การส่งออกข้อมูล", "View data export logs"),                ["y","y","n"]],
    ["audit.export",              ()=>t("ส่งออก log", "Export logs"),                          ["y","n","n"]],
  ]},
];

/* แผนที่แบน: key → {label, module, moduleName, byRole:[a,m,t]} */
export const PERM_INDEX = Object.fromEntries(
  PERM_MODULES.flatMap(m => m.perms.map(([k,label,byRole]) =>
    [k, {key:k, get label(){ return label(); }, module:m.key, get moduleName(){ return m.name(); }, byRole}])));

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
