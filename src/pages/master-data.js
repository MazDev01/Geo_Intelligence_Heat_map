import {t} from "../i18n.js";   // สลับภาษา TH/EN — ดู src/i18n.js
// ═══════════════════════════════════════════════════════════════════════════
// หน้า "ข้อมูลหลัก" (Master Data) — เฉพาะผู้ดูแลระบบ (Administrator)
// จัดการค่าตัวเลือกที่ใช้ทั้งระบบ (dropdown) แบบไม่ต้องแก้โค้ด: หมวดธุรกิจ · พื้นที่ · สถานะลูกค้า · สถานะ Lead · เหตุผลปฏิเสธ
// สแตกจริง = buildless htm/React + ข้อมูลในหน่วยความจำ (ไม่ใช่ Next.js/Supabase ตามหัว prompt) · ข้อความไทยล้วน
// กติกา: ไม่มีลบถาวร (ปิดใช้งานเท่านั้น) · แถว is_system ล็อก · code แก้ไม่ได้หลังสร้าง · ทุก action ลง Audit Log
// ═══════════════════════════════════════════════════════════════════════════
import {html, useState, useEffect, useApp, Icon, SegmentIcon, num} from "../lib.js";
import {Card, Btn, Badge, Toggle, Tabs, Modal, Field, toast} from "../ui.js";
import {SEGMENTS, SEG_TH, SEG_COLOR, SEG_ICON, PROVINCES} from "../mock/geoData.js";
import {pushAudit} from "../audit.js";
import {SEED_USERS} from "./admin.js";   // รายชื่อผู้ใช้ — ใช้ตั้งต้นหมวด TC
import {Dropdown} from "../select.js";

/* บัญชีที่มีบทบาท TC ในระบบ — หมวด "ผู้ประสานงานการค้า" เลือกจากรายชื่อนี้เท่านั้น ไม่ให้พิมพ์เอง */
const TC_ACCOUNTS = () => SEED_USERS.filter(u=>u.role==="Trade Coordinator");

/* จานสีประจำ TC บนแผนที่ขอบเขต — นิยามไว้ที่นี่ที่เดียว หน้าขอบเขตพื้นที่นำไปใช้ต่อ
   เลือกให้แยกจากกันได้ชัดและอ่านออกบนพื้นสว่าง (ไม่ผูกกับสีแบรนด์) */
export const TC_COLORS = ["#2563eb","#15a34a","#7c3aed","#c2410c","#0891b2","#be185d","#4d7c0f","#0f766e"];

// ── นิยาม 5 หมวดข้อมูลหลัก ──
// label/egLabel/egCode เป็น getter — ค่าคงที่ระดับโมดูลถูกประเมินครั้งเดียวตอนโหลดไฟล์
// ห่อ t() ตรง ๆ จะค้างเป็นภาษาแรกที่โหลด สลับภาษาแล้วไม่เปลี่ยน
const TYPES = [
  {value:"segments",         get label(){ return t("หมวดธุรกิจ","Business categories"); },        color:true,  icon:true,
   get egLabel(){ return t("เช่น ร้านอาหารและเครื่องดื่ม","e.g. Food & Beverage"); }, get egCode(){ return t("เช่น food_beverage","e.g. food_beverage"); }},
  {value:"areas",            get label(){ return t("พื้นที่ / จังหวัด","Areas / provinces"); },    color:false, icon:false,
   get egLabel(){ return t("เช่น เชียงใหม่","e.g. Chiang Mai"); },                    get egCode(){ return t("เช่น chiang_mai","e.g. chiang_mai"); }},
  {value:"customer-status",  get label(){ return t("สถานะลูกค้า","Customer status"); },            color:true,  icon:false,
   get egLabel(){ return t("เช่น ลูกค้าประจำ","e.g. Regular customer"); },            get egCode(){ return t("เช่น active","e.g. active"); }},
  {value:"prospect-status",  get label(){ return t("สถานะ Lead","Lead status"); },                 color:true,  icon:false,
   get egLabel(){ return t("เช่น รอนัดหมาย","e.g. Awaiting appointment"); },          get egCode(){ return t("เช่น pending_visit","e.g. pending_visit"); }},
  {value:"reject-reasons",   get label(){ return t("เหตุผลการปฏิเสธ","Rejection reasons"); },      color:false, icon:false,
   get egLabel(){ return t("เช่น ไม่มีหลักฐาน","e.g. No evidence"); },                get egCode(){ return t("เช่น no_evidence","e.g. no_evidence"); }},
  {value:"tc",               get label(){ return t("ผู้ประสานงานการค้า (TC)","Trade Coordinator (TC)"); }, color:true, icon:false,
   get egLabel(){ return t("เช่น ธนพล ศรีวัฒน์","e.g. Thanaphon Sriwat"); },          get egCode(){ return t("เช่น tc_10","e.g. tc_10"); }},
];
const typeCfg = t => TYPES.find(x=>x.value===t) || TYPES[0];

/* แปลงข้อความเป็นรหัสอ้างอิง — ชื่อไทยจะได้ค่าว่าง (ตั้งใจ) ผู้เรียกค่อยไปใช้ nextCode ต่อ */
const slugify = s => (s||"").trim().toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");
/* รหัสอัตโนมัติเมื่อสร้างจากชื่อไม่ได้ — คำนำหน้าตามหมวด + เลขที่ว่างถัดไป เช่น reject_6 · segment_13 */
const CODE_PREFIX = {segments:"segment", areas:"area", "customer-status":"cust_status",
  "prospect-status":"lead_status", "reject-reasons":"reject", tc:"tc"};
function nextCode(type, rows){
  const pre = CODE_PREFIX[type] || "item";
  let i = rows.length + 1;
  while(rows.some(r=>r.code===pre+"_"+i)) i++;
  return pre+"_"+i;
}

// ── ค่าตั้งต้น (seed) จากค่าคงที่เดิมของระบบ ──
const seed = ()=>({
  "segments": SEGMENTS.map((s,i)=>({code:s, label_th:SEG_TH[s], color_hex:SEG_COLOR[s], icon:SEG_ICON[s], sort_order:i, is_active:true, is_system:false})),
  "areas": PROVINCES.map((p,i)=>({code:p.key, label_th:p.th, color_hex:"", icon:"", sort_order:i, is_active:true, is_system:false})),
  "customer-status": [
    {code:"active",  label_th:"ซื้อขายอยู่ (Active)",  color_hex:"#33d69f"},
    {code:"dormant", label_th:"หยุดนิ่ง (Dormant)",    color_hex:"#ffb02e"},
    {code:"churned", label_th:"เลิกซื้อขาย (Churned)", color_hex:"#ff5a3c"},
  ].map((x,i)=>({...x, icon:"", sort_order:i, is_active:true, is_system:false})),
  "prospect-status": [
    {code:"new",                label_th:"ใหม่",                     color_hex:"#38bdf8"},
    {code:"pending_visit",      label_th:"รอเข้าพบ",                 color_hex:"#8a7bff"},
    {code:"appointed",          label_th:"นัดแล้ว",                  color_hex:"#2563eb"},
    {code:"visited",            label_th:"เข้าพบแล้ว",               color_hex:"#0d9488"},
    {code:"pending_conversion", label_th:"รออนุมัติเปลี่ยนเป็นลูกค้า", color_hex:"#ff3b5c"},
    {code:"rejected",           label_th:"ไม่สนใจ / ปิดโอกาส",       color_hex:"#78716c"},
  ].map((x,i)=>({...x, icon:"", sort_order:i, is_active:true, is_system:false})),
  // TC + สีประจำตัว — สีนี้คือสีที่ใช้ระบายจังหวัดในหน้า "จัดการขอบเขตพื้นที่การขาย"
  "tc": SEED_USERS.filter(u=>u.role==="Trade Coordinator")
    .map((u,i)=>({code:"tc_"+u.id, label_th:u.name, color_hex:TC_COLORS[i%TC_COLORS.length],
      icon:"", sort_order:i, is_active:true, is_system:false})),
  "reject-reasons": [
    {code:"no_evidence",     label_th:"หลักฐานไม่เพียงพอ"},
    {code:"duplicate",       label_th:"ข้อมูลซ้ำกับที่มีอยู่"},
    {code:"wrong_area",      label_th:"อยู่นอกพื้นที่รับผิดชอบ"},
    {code:"incomplete_data", label_th:"ข้อมูลไม่ครบถ้วน"},
    {code:"other",           label_th:"อื่น ๆ", is_system:true},
  ].map((x,i)=>({...x, color_hex:"", icon:"", sort_order:i, is_active:true, is_system:!!x.is_system})),
});

/* สโตร์ข้อมูลหลัก — เก็บที่ระดับโมดูล ไม่ใช่ใน useState เพื่อให้
   (1) แก้แล้วค่ายังอยู่เมื่อสลับหน้าไป-กลับ  (2) หน้าอื่นอ่านไปใช้ได้ เช่น สี TC บนแผนที่ขอบเขต */
let _STORE = null;
const store = () => (_STORE || (_STORE = seed()));
const tcRow = id => (store()["tc"]||[]).find(x=>x.code==="tc_"+id);
/* สีประจำ TC ที่ตั้งไว้ในข้อมูลหลัก — null ถ้ายังไม่ได้ตั้ง (ผู้เรียกค่อย fallback เอง) */
export const tcMasterColor = id => { const r=tcRow(id); return (r && r.color_hex) || null; };

// ── นับจำนวนที่ข้อมูลจริงใช้ค่านี้อยู่ (usage) — จาก db ในหน่วยความจำ ──
function usageOf(type, code, db){
  const cs=db.customers||[], ps=db.prospects||[];
  if(type==="segments") return [...cs,...ps].filter(x=>x.segment===code).length;
  if(type==="areas")    return [...cs,...ps].filter(x=>x.province===code).length;
  // ข้อมูลลูกค้าจริงจาก Barter ไม่มีคอลัมน์สถานะการค้า → นับได้ 0 ทุกสถานะ
  if(type==="customer-status") return 0;
  if(type==="tc") return [...cs,...ps].filter(x=>("tc_"+x.tc_owner)===code || x.tc_owner===code.replace(/^tc_/,"")).length;
  if(type==="prospect-status"){ const m=p=>{ const v=p.visit_status||"ยังไม่เข้าพบ"; if(v==="ครอบคลุมแล้ว")return "visited"; if((p.visitRounds||[]).some(r=>r.status==="นัดแล้ว"))return "appointed"; if(p.dealStatus==="pending")return "pending_conversion"; return "pending_visit"; };
    return ps.filter(p=>m(p)===code).length; }
  return 0;   // reject-reasons: เดโมไม่ได้เก็บ mapping ต่อรหัส จึงแสดง 0
}

export function MasterData(){
  const {db, user} = useApp();
  const q = new URLSearchParams(location.search);
  const [tab, setTab] = useState(()=> TYPES.some(t=>t.value===q.get("type")) ? q.get("type") : "segments");
  const [data, _setData] = useState(store);      // อ่านค่าจากสโตร์ระดับโมดูล
  const setData = up => _setData(prev=>{ const next = typeof up==="function" ? up(prev) : up; _STORE = next; return next; });
  const [edit, setEdit] = useState(null);        // {type, item, isNew}
  // สะท้อนหมวดที่เลือกลง URL (?type=...) สำหรับ deep-link (คงพารามิเตอร์ go เดิมของหน้าตั้งค่าระบบไว้)
  useEffect(()=>{ const u=new URL(location.href); u.searchParams.set("type",tab); history.replaceState(null,"",u); },[tab]);

  // สิทธิ์: เฉพาะ Administrator (กันกรณีถูกเรียกโดยตรง)
  if(!user || user.role!=="Administrator")
    return html`<div class="page"><div class="emptybox" style=${{margin:"40px auto",maxWidth:"440px",textAlign:"center"}}>
      <${Icon} name="shield" size=${30} color="var(--muted)"/>
      <div style=${{fontSize:"16px",fontWeight:700,marginTop:"10px"}}>${t("ไม่มีสิทธิ์เข้าถึงหน้านี้", "You don't have access to this page")}</div>
      <div class="dim" style=${{fontSize:"13px",marginTop:"6px"}}>${t("เฉพาะผู้ดูแลระบบ (Administrator) เท่านั้นที่จัดการข้อมูลหลักได้", "Only an Administrator can manage master data")}</div></div></div>`;

  const cfg = typeCfg(tab);
  const rows = [...(data[tab]||[])].sort((a,b)=>a.sort_order-b.sort_order);
  const audit = (action, detail)=> pushAudit({user:(user&&user.email)||"admin@geointel.io", action, category:"แก้ไข", detail:`${t("ข้อมูลหลัก ·", "Master data ·")} ${cfg.label} · ${detail}`});

  const setRows = updater => setData(d=>({...d, [tab]: updater(d[tab]||[]) }));
  const toggleActive = it=>{
    if(it.is_system){ toast(t("รายการระบบ ปิดใช้งานไม่ได้", "System entry — cannot be disabled"),"warn"); return; }
    const use = usageOf(tab, it.code, db);
    if(it.is_active && use>0 && !confirm(`${t("มีข้อมูล", "There are")} ${num(use)} ${t("รายการที่ยังใช้ \"", "records still using \"")}${it.label_th}${t("\" อยู่\\nปิดใช้งานแล้วจะไม่แสดงใน dropdown ของการเพิ่ม/แก้ไขต่อไป (เรคคอร์ดเดิมยังคงอยู่)\\n\\nยืนยันปิดใช้งาน?", "\".\\nOnce disabled it no longer appears in add/edit dropdowns (existing records are kept).\\n\\nDisable it?")}`)) return;
    setRows(a=>a.map(x=>x.code===it.code?{...x,is_active:!x.is_active}:x));
    audit(it.is_active?t("ปิดใช้งาน", "Disable"):t("เปิดใช้งาน", "Enable"), `"${it.label_th}"${it.is_active&&use>0?` ${t("(มีใช้อยู่", "(in use by")} ${use} ${t("รายการ)", "records)")}`:""}`);
    toast(it.is_active?`${t("ปิดใช้งาน \"", "Disabled \"")}${it.label_th}${t("\" แล้ว", "\"")}`:`${t("เปิดใช้งาน \"", "Enabled \"")}${it.label_th}${t("\" แล้ว", "\"")}`,"good");
  };
  const save = form =>{
    const isNew = edit.isNew;
    if(!form.label_th.trim()){ toast(tab==="tc"?t("กรุณาเลือกบัญชี TC", "Pick a TC account"):t("กรุณากรอกชื่อที่แสดงผล", "Enter a display name"),"warn"); return; }
    if(isNew){
      const code = slugify(form.code||form.label_th) || nextCode(tab, rows);
      if(rows.some(x=>x.code===code)){ toast(t("รหัสอ้างอิงนี้มีอยู่แล้ว", "That reference code already exists"),"warn"); return; }
      const item = {code, label_th:form.label_th.trim(), color_hex:cfg.color?(form.color_hex||"#8aa0be"):"", icon:cfg.icon?(form.icon||""):"",
        sort_order:rows.length, is_active:form.is_active!==false, is_system:false};
      setRows(a=>[...a, item]); audit(t("เพิ่มรายการ", "Add entry"), `"${item.label_th}" (${code})`); toast(`${t("เพิ่ม \"", "Added \"")}${item.label_th}${t("\" แล้ว", "\"")}`,"good");
    } else {
      const old = edit.item.code;
      let code = slugify(form.code) || old;
      if(code!==old){
        if(edit.item.is_system){ toast(t("รายการของระบบ เปลี่ยนรหัสอ้างอิงไม่ได้", "System entry — its reference code cannot be changed"),"warn"); return; }
        const use = usageOf(tab, old, db);
        if(use>0){ toast(`${t("มีข้อมูล", "There are")} ${num(use)} ${t("รายการอ้างถึงรหัสนี้อยู่ — เปลี่ยนรหัสไม่ได้", "records reference this code — it cannot be changed")}`,"warn"); return; }
        if(rows.some(x=>x.code===code)){ toast(t("รหัสอ้างอิงนี้มีอยู่แล้ว", "That reference code already exists"),"warn"); return; }
      }
      setRows(a=>a.map(x=>x.code===old ? {...x, code, label_th:form.label_th.trim(),
        color_hex:cfg.color?form.color_hex:x.color_hex, icon:cfg.icon?form.icon:x.icon, is_active:form.is_active} : x));
      if(code!==old) audit(t("เปลี่ยนรหัสอ้างอิง", "Reference code changed"), `"${form.label_th.trim()}" · ${old} → ${code}`);
      audit(t("แก้ไขรายการ", "Edit record"), `"${form.label_th.trim()}" (${edit.item.code})`); toast(t("บันทึกการแก้ไขแล้ว", "Changes saved"),"good");
    }
    setEdit(null);
  };

  // หน้าเต็มของเมนูย่อย "ข้อมูลหลัก" (ใต้ ตั้งค่าระบบ) — เดิมเป็นแท็บอยู่ในหน้าตั้งค่าระบบ
  return html`<div class="page fade-in">
    <div class="page-head"><div><h1>${t("ข้อมูลหลัก", "Master data")}</h1></div>
      <div class="ph-right">
        <${Btn} variant="outline" icon="plus" onClick=${()=>setEdit({type:tab, isNew:true, item:{label_th:"",code:"",color_hex:"#38bdf8",icon:"",is_active:true}})}>${t("เพิ่มรายการ", "Add entry")}</${Btn}>
      </div></div>

    <${Tabs} tabs=${TYPES} active=${tab} onChange=${setTab}/>

    <${Card} pad0=${true} style=${{marginTop:"14px"}}>
      <div class="md-table-wrap"><table class="md-table">
        <thead><tr><th style=${{width:"64px"}}>${t("ลำดับ", "Order")}</th><th>${t("ชื่อที่แสดงผล", "Display name")}</th><th>${t("รหัสอ้างอิง", "Reference code")}</th><th>${t("จำนวนที่ใช้อยู่", "In use")}</th><th>${t("สถานะ", "Status")}</th><th style=${{textAlign:"right"}}>${t("จัดการ", "Actions")}</th></tr></thead>
        <tbody>
        ${rows.map((it,i)=>{ const use=usageOf(tab, it.code, db);
          return html`<tr key=${it.code} style=${{opacity:it.is_active?1:.5}}>
            <td><span class="md-seq">${i+1}</span></td>
            <td><div class="row" style=${{gap:"9px"}}>
              ${cfg.color && it.color_hex ? html`<span class="md-dot" style=${{background:it.color_hex}}></span>`:""}
              ${tab==="segments" ? html`<${SegmentIcon} seg=${it.code} size=${17} color="var(--muted)"/>`
                : (cfg.icon && it.icon ? html`<span style=${{fontSize:"15px"}}>${it.icon}</span>`:"")}
              <b>${it.label_th}</b></div></td>
            <td><span class="mono dim" style=${{fontSize:"12px"}}>${it.code}</span></td>
            <td>${use>0? html`<span>${num(use)} ${t("รายการ", "records")}</span>` : html`<span class="dim">—</span>`}</td>
            <td>${it.is_system
                ? html`<${Badge} tone="neutral" icon="shield">${t("ระบบ", "System")}</${Badge}>`
                : it.is_active ? html`<${Badge} tone="good">${t("ใช้งาน", "Active")}</${Badge}>` : html`<${Badge} tone="neutral">${t("เลิกใช้แล้ว", "Retired")}</${Badge}>`}</td>
            <td style=${{textAlign:"right"}}><div class="row" style=${{gap:"6px",justifyContent:"flex-end"}}>
              <${Btn} size="sm" variant="ghost" icon="edit" onClick=${()=>setEdit({type:tab, isNew:false, item:it})}>${t("แก้ไข", "Edit")}</${Btn}>
              ${it.is_system
                ? html`<span class="dim" style=${{fontSize:"11.5px",padding:"0 6px"}}>${t("ล็อก", "Locked")}</span>`
                : html`<${Toggle} on=${it.is_active} onChange=${()=>toggleActive(it)}/>`}
            </div></td>
          </tr>`; })}
        </tbody>
      </table>
      ${rows.length===0 && html`<div class="emptybox" style=${{margin:"18px"}}>${t("ยังไม่มีรายการในหมวดนี้", "No entries in this category yet")}</div>`}
      </div>
    </${Card}>

    ${edit && html`<${MDModal} edit=${edit} cfg=${cfg} rows=${rows} onClose=${()=>setEdit(null)} onSave=${save}/>`}
    <style>${MD_CSS}</style>
  </div>`;
}

function MDModal({edit, cfg, rows=[], onClose, onSave}){
  const it = edit.item;
  const isTC = cfg.value==="tc";   // หมวด TC: ชื่อมาจากบัญชีผู้ใช้ ไม่ให้พิมพ์เอง
  // ตัวเลือกบัญชี TC — แสดงทุกคนเสมอ · คนที่มีในรายการ (กำหนดสีไว้แล้ว) จะจางและเลือกไม่ได้
  const tcOpts = TC_ACCOUNTS().map(u=>{
    const used = rows.some(r=>r.code==="tc_"+u.id) && ("tc_"+u.id)!==it.code;
    return {value:String(u.id), label:u.name, disabled:used, note: used?t("กำหนดสีแล้ว", "Colour set"):""};
  });
  const locked = !!it.is_system;   // รายการของระบบเท่านั้นที่ล็อกรหัสอ้างอิง
  const [f, setF] = useState({label_th:it.label_th||"", code:it.code||"", color_hex:it.color_hex||"#38bdf8", icon:it.icon||"", is_active:it.is_active!==false});
  const set=(k,v)=>setF(p=>({...p,[k]:v}));
  return html`<${Modal} title=${edit.isNew?t("เพิ่มรายการใหม่ · ", "New entry · ")+cfg.label:t("แก้ไข · ", "Edit · ")+cfg.label} onClose=${onClose}
    footer=${html`<${Btn} variant="outline" onClick=${onClose}>${t("ยกเลิก", "Cancel")}</${Btn}>
      <${Btn} variant="primary" icon="check" onClick=${()=>onSave(f)}>${t("บันทึก", "Save")}</${Btn}>`}>
    ${isTC ? html`<${Field} label=${t("บัญชี TC", "TC account")}>
      ${edit.isNew
        ? html`<${Dropdown} value=${f.code.replace(/^tc_/,"")} placeholder=${t("เลือกบัญชี TC…", "Pick a TC account…")} options=${tcOpts}
            onChange=${v=>{ const u=TC_ACCOUNTS().find(x=>String(x.id)===v);
              setF(pv=>({...pv, code:u?("tc_"+u.id):"", label_th:u?u.name:""})); }}/>`
        : html`<div style=${{fontSize:"13.5px",fontWeight:600}}>${f.label_th}</div>`}
    </${Field}>`
    : html`<${Field} label=${t("ชื่อที่แสดงผล", "Display name")}><input class="input" value=${f.label_th} onInput=${e=>set("label_th",e.target.value)} placeholder=${cfg.egLabel||"เช่น รายการใหม่"}/></${Field}>
    <${Field} label=${t("รหัสอ้างอิง (code)", "Reference code")}>
      <input class="input" value=${f.code} disabled=${locked} onInput=${e=>set("code",e.target.value)}
        placeholder=${cfg.egCode||"เช่น new_item"} style=${locked?{opacity:.6,cursor:"not-allowed"}:null}/>
      <div class="dim" style=${{fontSize:"11.5px",marginTop:"4px"}}>${
        locked ? t("รายการของระบบ เปลี่ยนรหัสอ้างอิงไม่ได้", "System entry — its reference code cannot be changed")
        : edit.isNew ? t("ใช้ a–z, 0–9, _ เท่านั้น · เว้นว่างได้ ระบบจะสร้างให้ (ชื่อภาษาไทยสร้างรหัสไม่ได้ จะได้เป็นเลขลำดับแทน)", "Use a–z, 0–9, _ only · leave blank and one is generated (Thai names can't produce a code, so a sequence number is used)")
        : t("แก้ได้ · ใช้ a–z, 0–9, _ เท่านั้น — เปลี่ยนไม่ได้ถ้ามีข้อมูลอ้างถึงรหัสนี้อยู่", "Editable · a–z, 0–9, _ only — cannot change while records reference this code")}</div>
    </${Field}>`}
    ${cfg.color && html`<${Field} label=${t("สี", "Colour")}>
      <div class="row" style=${{gap:"10px"}}><input type="color" value=${f.color_hex} onInput=${e=>set("color_hex",e.target.value)} style=${{width:"46px",height:"34px",padding:"2px",borderRadius:"8px",border:"1px solid var(--stroke2)",background:"var(--surface)",cursor:"pointer"}}/>
        <span class="mono dim" style=${{fontSize:"12px"}}>${f.color_hex}</span></div></${Field}>`}
    ${cfg.icon && html`<${Field} label=${t("ไอคอน (อีโมจิ)", "Icon (emoji)")}><input class="input" value=${f.icon} onInput=${e=>set("icon",e.target.value)} placeholder=${t("เช่น 🍽️", "e.g. 🍽️")} maxLength=${4} style=${{width:"120px"}}/></${Field}>`}
    <${Field} label=${t("เปิดใช้งาน", "Enable")}><div><${Toggle} on=${f.is_active} onChange=${()=>set("is_active",!f.is_active)}/></div></${Field}>
  </${Modal}>`;
}

const MD_CSS = `
.md-alert{display:flex;align-items:center;gap:9px;padding:10px 13px;border-radius:11px;margin-bottom:14px;font-size:12.5px;line-height:1.5;
  background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);color:var(--txt)}
.md-table-wrap{overflow-x:auto}
.md-table{width:100%;border-collapse:collapse;font-size:13px}
.md-table th{text-align:left;padding:11px 14px;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;border-bottom:1px solid var(--stroke);white-space:nowrap}
.md-table td{padding:10px 14px;border-bottom:1px solid var(--stroke);vertical-align:middle}
.md-table tbody tr:last-child td{border-bottom:none}
.md-dot{width:13px;height:13px;border-radius:4px;flex:none;box-shadow:0 0 0 1px rgba(0,0,0,.08)}
.md-seq{display:inline-grid;place-items:center;min-width:26px;height:26px;padding:0 6px;border-radius:8px;
  font-size:12.5px;font-weight:700;color:var(--muted);background:var(--surface2);font-variant-numeric:tabular-nums}
`;
