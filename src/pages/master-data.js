import {t} from "../i18n.js";   // สลับภาษา TH/EN — ดู src/i18n.js
// ═══════════════════════════════════════════════════════════════════════════
// หน้า "ข้อมูลหลัก" (Master Data) — เฉพาะผู้ดูแลระบบ (Administrator)
// จัดการค่าตัวเลือกที่ใช้ทั้งระบบ (dropdown) แบบไม่ต้องแก้โค้ด: หมวดธุรกิจ · พื้นที่ · สถานะลูกค้า · สถานะ Lead · เหตุผลปฏิเสธ
// ⚠ ไม่มีหมวด "ผู้ประสานงานการค้า (TC)" — ข้อมูลคนอยู่ที่หน้าจัดการผู้ใช้ที่เดียว (สีประจำตัวอยู่ในฟอร์มผู้ใช้)
// กติกา: ไม่มีลบถาวร (ปิดใช้งานเท่านั้น) · แถว is_system ล็อก · code แก้ไม่ได้หลังสร้าง · ทุก action ลง Audit Log
// ═══════════════════════════════════════════════════════════════════════════
import {html, useState, useEffect, useApp, Icon, SegmentIcon, num} from "../lib.js";
import {Card, Btn, Badge, Toggle, Tabs, Modal, Field, toast} from "../ui.js";
import {SEGMENTS, SEG_TH, SEG_COLOR, SEG_ICON_KEYS, SEG_ICON_SVG, PROVINCES} from "../mock/geoData.js";
import {loadMaster, saveMaster, masterData} from "../master-api.js";

// ── นิยาม 5 หมวดข้อมูลหลัก ──
// label/egLabel/egCode เป็น getter — ค่าคงที่ระดับโมดูลถูกประเมินครั้งเดียวตอนโหลดไฟล์
// ห่อ t() ตรง ๆ จะค้างเป็นภาษาแรกที่โหลด สลับภาษาแล้วไม่เปลี่ยน
const TYPES = [
  {value:"segments",         get label(){ return t("หมวดธุรกิจ","Business categories"); },        color:true,  icon:true,  create:true,  toggle:true,
   get egLabel(){ return t("เช่น ร้านอาหารและเครื่องดื่ม","e.g. Food & Beverage"); }, get egCode(){ return t("เช่น FoodBeverage","e.g. FoodBeverage"); }},
  {value:"areas",            get label(){ return t("พื้นที่ / จังหวัด","Areas / provinces"); },    color:false, icon:false, create:false, toggle:false,
   get egLabel(){ return t("เช่น เชียงใหม่","e.g. Chiang Mai"); },                    get egCode(){ return ""; }},
  {value:"customer-status",  get label(){ return t("สถานะลูกค้า","Customer status"); },            color:true,  icon:false, readOnly:true},
  {value:"prospect-status",  get label(){ return t("สถานะ Lead","Lead status"); },                 color:true,  icon:false, readOnly:true},
  {value:"reject-reasons",   get label(){ return t("เหตุผลการปฏิเสธ","Rejection reasons"); },      color:false, icon:false, create:true,  toggle:true,
   get egLabel(){ return t("เช่น ไม่มีหลักฐาน","e.g. No evidence"); },                get egCode(){ return t("เช่น no_evidence","e.g. no_evidence"); }},
  // แท็บ "ผู้ประสานงานการค้า (TC)" ถอดออกแล้ว — เคยเก็บชื่อ TC ซ้ำกับบัญชีผู้ใช้
  // ชื่อ/อีเมล/บทบาท อยู่ที่หน้าจัดการผู้ใช้ที่เดียว · สีประจำตัวย้ายไปอยู่ในฟอร์มผู้ใช้ (ดู src/tc-colors.js)
];
const typeCfg = t => TYPES.find(x=>x.value===t) || TYPES[0];

const FIXED = ()=>({
  "customer-status": [
    {code:"active",  label_th:"ซื้อขายอยู่ (Active)",  color_hex:"#33d69f"},
    {code:"dormant", label_th:"หยุดนิ่ง (Dormant)",    color_hex:"#ffb02e"},
    {code:"churned", label_th:"เลิกซื้อขาย (Churned)", color_hex:"#ff5a3c"},
  ].map((x,i)=>({...x, icon:"", sort_order:i, is_active:true, is_system:true})),
  "prospect-status": [
    {code:"new",                label_th:"ใหม่",                     color_hex:"#38bdf8"},
    {code:"pending_visit",      label_th:"รอเข้าพบ",                 color_hex:"#8a7bff"},
    {code:"appointed",          label_th:"นัดแล้ว",                  color_hex:"#2563eb"},
    {code:"visited",            label_th:"เข้าพบแล้ว",               color_hex:"#0d9488"},
    {code:"pending_conversion", label_th:"รออนุมัติเปลี่ยนเป็นลูกค้า", color_hex:"#ff3b5c"},
    {code:"rejected",           label_th:"ไม่สนใจ / ปิดโอกาส",       color_hex:"#78716c"},
  ].map((x,i)=>({...x, icon:"", sort_order:i, is_active:true, is_system:true})),
});
const SAMPLE = ()=>({
  "segments": SEGMENTS.map((s,i)=>({code:s, label_th:SEG_TH[s], label_en:"", color_hex:SEG_COLOR[s], icon:s, sort_order:i, is_active:true, is_system:false})),
  "areas": PROVINCES.map((p,i)=>({code:p.key, label_th:p.th, label_en:p.key, color_hex:"", icon:"", sort_order:i, is_active:true, is_system:true})),
  "reject-reasons": [],
});

// ── นับจำนวนที่ข้อมูลจริงใช้ค่านี้อยู่ (usage) — จาก db ในหน่วยความจำ ──
function usageOf(type, code, db){
  const cs=db.customers||[], ps=db.prospects||[];
  if(type==="segments") return [...cs,...ps].filter(x=>x.segment===code).length;
  if(type==="areas")    return [...cs,...ps].filter(x=>x.province===code).length;
  // ข้อมูลลูกค้าจริงจาก Barter ไม่มีคอลัมน์สถานะการค้า → นับได้ 0 ทุกสถานะ
  if(type==="customer-status") return 0;
  if(type==="prospect-status"){ const m=p=>{ const v=p.visit_status||"ยังไม่เข้าพบ"; if(v==="ครอบคลุมแล้ว")return "visited"; if((p.visitRounds||[]).some(r=>r.status==="นัดแล้ว"))return "appointed"; if(p.dealStatus==="pending")return "pending_conversion"; return "pending_visit"; };
    return ps.filter(p=>m(p)===code).length; }
  return 0;
}

export function MasterData(){
  const {db, user, masterChanged} = useApp();
  const q = new URLSearchParams(location.search);
  const [tab, setTab] = useState(()=> TYPES.some(t=>t.value===q.get("type")) ? q.get("type") : "segments");
  const [server, setServer] = useState(()=>masterData());
  const [local, setLocal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(null);        // {type, item, isNew}
  // สะท้อนหมวดที่เลือกลง URL (?type=...) สำหรับ deep-link (คงพารามิเตอร์ go เดิมของหน้าตั้งค่าระบบไว้)
  useEffect(()=>{ const u=new URL(location.href); u.searchParams.set("type",tab); history.replaceState(null,"",u); },[tab]);
  const reload = async ()=>{
    const r = await loadMaster();
    if(r.local){ setLocal(true); return false; }
    if(!r.ok){ toast(r.error,"bad"); return false; }
    setServer(r.data); return true;
  };
  useEffect(()=>{ reload(); },[]);

  // สิทธิ์: เฉพาะ Administrator (กันกรณีถูกเรียกโดยตรง)
  if(!user || user.role!=="Administrator")
    return html`<div class="page"><div class="emptybox" style=${{margin:"40px auto",maxWidth:"440px",textAlign:"center"}}>
      <${Icon} name="shield" size=${30} color="var(--muted)"/>
      <div style=${{fontSize:"16px",fontWeight:700,marginTop:"10px"}}>${t("ไม่มีสิทธิ์เข้าถึงหน้านี้", "You don't have access to this page")}</div>
      <div class="dim" style=${{fontSize:"13px",marginTop:"6px"}}>${t("เฉพาะผู้ดูแลระบบ (Administrator) เท่านั้นที่จัดการข้อมูลหลักได้", "Only an Administrator can manage master data")}</div></div></div>`;

  const cfg = typeCfg(tab);
  const data = {...SAMPLE(), ...(server||{}), ...FIXED()};
  const rows = [...(data[tab]||[])].sort((a,b)=>a.sort_order-b.sort_order);
  const locked = !!cfg.readOnly || local || !server;
  const useOf = it => (!cfg.readOnly && server && typeof it.usage==="number") ? it.usage : usageOf(tab, it.code, db);

  const send = async (body, okText)=>{
    if(busy) return false;
    setBusy(true);
    const r = await saveMaster({type:tab, ...body});
    if(!r.ok){ setBusy(false); toast(r.error,"bad"); return false; }
    await reload();
    setBusy(false);
    masterChanged(false);
    if(okText) toast(okText,"good");
    return true;
  };
  const toggleActive = it=>{
    if(it.is_system){ toast(t("รายการระบบ ปิดใช้งานไม่ได้", "System entry — cannot be disabled"),"warn"); return; }
    const use = useOf(it);
    if(it.is_active && use>0){ toast(`${t("ยังมีข้อมูล", use===1 ? "There is still" : "There are still")} ${num(use)} ${t("รายการใช้ค่านี้อยู่ จึงปิดใช้งานไม่ได้", use===1 ? "record using this value, so it cannot be disabled" : "records using this value, so it cannot be disabled")}`,"warn"); return; }
    send({action:"update", code:it.code, is_active:!it.is_active},
      it.is_active?`${t("ปิดใช้งาน \"", "Disabled \"")}${it.label_th}${t("\" แล้ว", "\"")}`:`${t("เปิดใช้งาน \"", "Enabled \"")}${it.label_th}${t("\" แล้ว", "\"")}`);
  };
  const save = async form =>{
    if(!form.label_th.trim()){ toast(t("กรุณากรอกชื่อที่แสดงผล", "Enter a display name"),"warn"); return; }
    const body = {label_th:form.label_th.trim(), label_en:form.label_en.trim()};
    if(cfg.color) body.color_hex = form.color_hex;
    if(cfg.icon) body.icon = form.icon || "Other";
    if(cfg.toggle && !edit.item.is_system) body.is_active = form.is_active;
    const done = edit.isNew
      ? await send({action:"create", ...body, ...(form.code.trim() ? {code:form.code.trim()} : {})}, `${t("เพิ่ม \"", "Added \"")}${body.label_th}${t("\" แล้ว", "\"")}`)
      : await send({action:"update", code:edit.item.code, ...body}, t("บันทึกการแก้ไขแล้ว", "Changes saved"));
    if(done) setEdit(null);
  };

  // หน้าเต็มของเมนูย่อย "ข้อมูลหลัก" (ใต้ ตั้งค่าระบบ) — เดิมเป็นแท็บอยู่ในหน้าตั้งค่าระบบ
  return html`<div class="page fade-in">
    <div class="page-head"><div><h1>${t("ข้อมูลหลัก", "Master data")}</h1></div>
      <div class="ph-right">
        ${cfg.create && !locked && html`<${Btn} variant="outline" icon="plus" onClick=${()=>setEdit({type:tab, isNew:true, item:{label_th:"",label_en:"",code:"",color_hex:"#38bdf8",icon:"Other",is_active:true}})}>${t("เพิ่มรายการ", "Add entry")}</${Btn}>`}
      </div></div>

    <${Tabs} tabs=${TYPES} active=${tab} onChange=${setTab}/>

    ${cfg.readOnly && html`<div class="md-alert" style=${{marginTop:"14px",marginBottom:0}}><${Icon} name="shield" size=${16} color="var(--muted)"/>${t("สถานะผูกกับขั้นตอนของระบบ จึงแสดงให้ดูอย่างเดียว", "Statuses are tied to system workflow, so they are shown read-only")}</div>`}
    ${local && !cfg.readOnly && html`<div class="md-alert" style=${{marginTop:"14px",marginBottom:0}}><${Icon} name="shield" size=${16} color="var(--muted)"/>${t("โหมดข้อมูลตัวอย่าง แก้ไขไม่ได้", "Sample-data mode — editing is unavailable")}</div>`}

    <${Card} pad0=${true} style=${{marginTop:"14px"}}>
      <div class="md-table-wrap"><table class="md-table" data-md=${tab}>
        <thead><tr><th style=${{width:"64px"}}>${t("ลำดับ", "Order")}</th><th>${t("ชื่อที่แสดงผล", "Display name")}</th><th>${t("รหัสอ้างอิง", "Reference code")}</th><th>${t("จำนวนที่ใช้อยู่", "In use")}</th><th>${t("สถานะ", "Status")}</th><th style=${{textAlign:"right"}}>${t("จัดการ", "Actions")}</th></tr></thead>
        <tbody>
        ${rows.map((it,i)=>{ const use=useOf(it);
          return html`<tr key=${it.code} data-code=${it.code} style=${{opacity:it.is_active?1:.5}}>
            <td data-label=${t("ลำดับ", "Order")}><span class="md-seq">${i+1}</span></td>
            <td data-label=${t("ชื่อที่แสดงผล", "Display name")}><div class="row" style=${{gap:"9px"}}>
              ${cfg.color && it.color_hex ? html`<span class="md-dot" style=${{background:it.color_hex}}></span>`:""}
              ${tab==="segments" ? html`<${IconGlyph} name=${it.icon} size=${17}/>` : ""}
              <b>${t(it.label_th, it.label_en||it.label_th)}</b>
              ${it.unlisted && html`<${Badge} tone="warn">${t("ยังไม่ได้ตั้งค่า", "Not set up")}</${Badge}>`}</div></td>
            <td data-label=${t("รหัสอ้างอิง", "Reference code")}><span class="mono dim" style=${{fontSize:"12px"}}>${it.code}</span></td>
            <td data-label=${t("จำนวนที่ใช้อยู่", "In use")}>${use>0? html`<span>${num(use)} ${t("รายการ", use===1 ? "record" : "records")}</span>` : html`<span class="dim">—</span>`}</td>
            <td data-label=${t("สถานะ", "Status")}>${it.is_system
                ? html`<${Badge} tone="neutral" icon="shield">${t("ระบบ", "System")}</${Badge}>`
                : it.is_active ? html`<${Badge} tone="good">${t("ใช้งาน", "Active")}</${Badge}>` : html`<${Badge} tone="neutral">${t("เลิกใช้แล้ว", "Retired")}</${Badge}>`}</td>
            <td style=${{textAlign:"right"}}>${locked ? html`<span class="dim" style=${{fontSize:"11.5px",padding:"0 6px"}}>${t("ล็อก", "Locked")}</span>`
              : html`<div class="row" style=${{gap:"6px",justifyContent:"flex-end"}}>
              ${!it.unlisted && html`<button class="md-move" disabled=${busy||i===0} aria-label=${t("เลื่อนขึ้น", "Move up")} onClick=${()=>send({action:"move", code:it.code, dir:-1})}>▲</button>
                <button class="md-move" disabled=${busy||i===rows.length-1||!!(rows[i+1]&&rows[i+1].unlisted)} aria-label=${t("เลื่อนลง", "Move down")} onClick=${()=>send({action:"move", code:it.code, dir:1})}>▼</button>`}
              <${Btn} size="sm" variant="ghost" icon="edit" onClick=${()=>setEdit({type:tab, isNew:false, item:it})}>${t("แก้ไข", "Edit")}</${Btn}>
              ${cfg.toggle && !it.is_system ? html`<${Toggle} on=${it.is_active} onChange=${()=>toggleActive(it)}/>` : ""}
            </div>`}</td>
          </tr>`; })}
        </tbody>
      </table>
      ${rows.length===0 && html`<div class="emptybox" style=${{margin:"18px"}}>${t("ยังไม่มีรายการในหมวดนี้", "No entries in this category yet")}</div>`}
      </div>
    </${Card}>

    ${edit && html`<${MDModal} edit=${edit} cfg=${cfg} busy=${busy} onClose=${()=>setEdit(null)} onSave=${save}/>`}
    <style>${MD_CSS}</style>
  </div>`;
}

function IconGlyph({name, size=18, color="var(--muted)"}){
  return html`<svg width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke=${color} stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true" dangerouslySetInnerHTML=${{__html: SEG_ICON_SVG[name] || SEG_ICON_SVG.Other}}></svg>`;
}

function MDModal({edit, cfg, busy, onClose, onSave}){
  const it = edit.item;
  const [f, setF] = useState({label_th:it.label_th||"", label_en:it.label_en||"", code:it.code||"", color_hex:it.color_hex||"#38bdf8", icon:it.icon||"Other", is_active:it.is_active!==false});
  const set=(k,v)=>setF(p=>({...p,[k]:v}));
  return html`<${Modal} title=${edit.isNew?t("เพิ่มรายการใหม่ · ", "New entry · ")+cfg.label:t("แก้ไข · ", "Edit · ")+cfg.label} onClose=${onClose}
    footer=${html`<${Btn} variant="outline" onClick=${onClose}>${t("ยกเลิก", "Cancel")}</${Btn}>
      <${Btn} variant="primary" icon="check" disabled=${busy} onClick=${()=>onSave(f)}>${t("บันทึก", "Save")}</${Btn}>`}>
    <${Field} label=${t("ชื่อที่แสดงผล", "Display name")}><input class="input" data-md-f="label_th" value=${f.label_th} maxLength=${80} onInput=${e=>set("label_th",e.target.value)} placeholder=${cfg.egLabel||""}/></${Field}>
    <${Field} label=${t("ชื่อภาษาอังกฤษ", "English name")}><input class="input" data-md-f="label_en" value=${f.label_en} maxLength=${80} onInput=${e=>set("label_en",e.target.value)}/></${Field}>
    <${Field} label=${t("รหัสอ้างอิง (code)", "Reference code")}>
      <input class="input" data-md-f="code" value=${f.code} disabled=${!edit.isNew} maxLength=${40} onInput=${e=>set("code",e.target.value)}
        placeholder=${cfg.egCode||""} style=${!edit.isNew?{opacity:.6,cursor:"not-allowed"}:null}/>
      <div class="dim" style=${{fontSize:"11.5px",marginTop:"4px"}}>${
        edit.isNew ? t("ใช้ a–z, 0–9, _ · เว้นว่างได้ ระบบจะสร้างให้ · สร้างแล้วแก้ไม่ได้", "Use a–z, 0–9, _ · leave blank and one is generated · cannot be changed later")
        : t("รหัสอ้างอิงแก้ไม่ได้หลังสร้าง", "The reference code cannot be changed after creation")}</div>
    </${Field}>
    ${cfg.color && html`<${Field} label=${t("สี", "Colour")}>
      <div class="row" style=${{gap:"10px"}}><input type="color" data-md-f="color_hex" value=${f.color_hex} onInput=${e=>set("color_hex",e.target.value)} style=${{width:"46px",height:"34px",padding:"2px",borderRadius:"8px",border:"1px solid var(--stroke2)",background:"var(--surface)",cursor:"pointer"}}/>
        <span class="mono dim" style=${{fontSize:"12px"}}>${f.color_hex}</span></div></${Field}>`}
    ${cfg.icon && html`<${Field} label=${t("ไอคอน", "Icon")}>
      <div class="md-icons">${SEG_ICON_KEYS.map(k=>html`<button key=${k} type="button" data-md-icon=${k} class=${"md-icon"+(f.icon===k?" on":"")} aria-pressed=${f.icon===k}
        onClick=${()=>set("icon",k)}><${IconGlyph} name=${k} size=${18} color=${f.icon===k?"var(--accent)":"var(--muted)"}/></button>`)}</div></${Field}>`}
    ${cfg.toggle && !it.is_system && html`<${Field} label=${t("เปิดใช้งาน", "Enable")}><div><${Toggle} on=${f.is_active} onChange=${()=>set("is_active",!f.is_active)}/></div></${Field}>`}
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
@media(max-width:640px){
  .md-table-wrap{overflow:visible}
  .md-table,.md-table tbody{display:block}
  .md-table thead{display:none}
  .md-table tbody tr{display:block;padding:8px 0;border-bottom:1px solid var(--stroke)}
  .md-table tbody tr:last-child{border-bottom:none}
  .md-table td,.md-table tbody tr:last-child td{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 14px;border-bottom:none;text-align:right;overflow-wrap:anywhere}
  .md-table td[data-label]::before{content:attr(data-label);flex:none;max-width:45%;text-align:left;font-size:11.5px;font-weight:600;color:var(--muted)}
  .md-table td:not([data-label]){justify-content:flex-end}
  .md-table td:not([data-label]) > .row{flex-wrap:wrap}
}
.md-dot{width:13px;height:13px;border-radius:4px;flex:none;box-shadow:0 0 0 1px rgba(0,0,0,.08)}
.md-seq{display:inline-grid;place-items:center;min-width:26px;height:26px;padding:0 6px;border-radius:8px;
  font-size:12.5px;font-weight:700;color:var(--muted);background:var(--surface2);font-variant-numeric:tabular-nums}
.md-move{width:26px;height:26px;border-radius:8px;border:1px solid var(--stroke2);background:var(--surface);color:var(--muted);font-size:10px;cursor:pointer;line-height:1}
.md-move:hover:not(:disabled){background:var(--surface2);color:var(--txt)}
.md-move:disabled{opacity:.35;cursor:default}
.md-icons{display:flex;flex-wrap:wrap;gap:7px}
.md-icon{width:38px;height:38px;border-radius:10px;border:1px solid var(--stroke2);background:var(--surface);display:grid;place-items:center;cursor:pointer}
.md-icon:hover{background:var(--surface2)}
.md-icon.on{border-color:var(--accent);box-shadow:0 0 0 2px rgba(230,0,35,.15)}
`;
