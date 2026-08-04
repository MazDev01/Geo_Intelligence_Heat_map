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

// ── นิยาม 5 หมวดข้อมูลหลัก ──
const TYPES = [
  {value:"segments",         label:"หมวดธุรกิจ",        color:true,  icon:true,  egLabel:"เช่น ร้านอาหารและเครื่องดื่ม", egCode:"เช่น food_beverage"},
  {value:"areas",            label:"พื้นที่ / จังหวัด",  color:false, icon:false, egLabel:"เช่น เชียงใหม่",             egCode:"เช่น chiang_mai"},
  {value:"customer-status",  label:"สถานะลูกค้า",       color:true,  icon:false, egLabel:"เช่น ลูกค้าประจำ",           egCode:"เช่น active"},
  {value:"prospect-status",  label:"สถานะ Lead",        color:true,  icon:false, egLabel:"เช่น รอนัดหมาย",             egCode:"เช่น pending_visit"},
  {value:"reject-reasons",   label:"เหตุผลการปฏิเสธ",    color:false, icon:false, egLabel:"เช่น ไม่มีหลักฐาน",          egCode:"เช่น no_evidence"},
];
const typeCfg = t => TYPES.find(x=>x.value===t) || TYPES[0];

// ── ค่าตั้งต้น (seed) จากค่าคงที่เดิมของระบบ ──
const seed = ()=>({
  "segments": SEGMENTS.map((s,i)=>({code:s, label_th:SEG_TH[s], color_hex:SEG_COLOR[s], icon:SEG_ICON[s], sort_order:i, is_active:true, is_system:s==="Other"})),
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
  "reject-reasons": [
    {code:"no_evidence",     label_th:"หลักฐานไม่เพียงพอ"},
    {code:"duplicate",       label_th:"ข้อมูลซ้ำกับที่มีอยู่"},
    {code:"wrong_area",      label_th:"อยู่นอกพื้นที่รับผิดชอบ"},
    {code:"incomplete_data", label_th:"ข้อมูลไม่ครบถ้วน"},
    {code:"other",           label_th:"อื่น ๆ", is_system:true},
  ].map((x,i)=>({...x, color_hex:"", icon:"", sort_order:i, is_active:true, is_system:!!x.is_system})),
});

// ── นับจำนวนที่ข้อมูลจริงใช้ค่านี้อยู่ (usage) — จาก db ในหน่วยความจำ ──
function usageOf(type, code, db){
  const cs=db.customers||[], ps=db.prospects||[];
  if(type==="segments") return [...cs,...ps].filter(x=>x.segment===code).length;
  if(type==="areas")    return [...cs,...ps].filter(x=>x.province===code).length;
  if(type==="customer-status") return cs.filter(x=>String(x.tradingStatus||"").toLowerCase()===code).length;
  if(type==="prospect-status"){ const m=p=>{ const v=p.visit_status||"ยังไม่เข้าพบ"; if(v==="ครอบคลุมแล้ว")return "visited"; if((p.visitRounds||[]).some(r=>r.status==="นัดแล้ว"))return "appointed"; if(p.dealStatus==="pending")return "pending_conversion"; return "pending_visit"; };
    return ps.filter(p=>m(p)===code).length; }
  return 0;   // reject-reasons: เดโมไม่ได้เก็บ mapping ต่อรหัส จึงแสดง 0
}

export function MasterData(){
  const {db, user} = useApp();
  const q = new URLSearchParams(location.search);
  const [tab, setTab] = useState(()=> TYPES.some(t=>t.value===q.get("type")) ? q.get("type") : "segments");
  const [data, setData] = useState(seed);        // สโตร์ในหน่วยความจำ (เดโม — เปลี่ยนอยู่ในเซสชัน)
  const [edit, setEdit] = useState(null);        // {type, item, isNew}
  // สะท้อนหมวดที่เลือกลง URL (?type=...) สำหรับ deep-link (คงพารามิเตอร์ go เดิมของหน้าตั้งค่าระบบไว้)
  useEffect(()=>{ const u=new URL(location.href); u.searchParams.set("type",tab); history.replaceState(null,"",u); },[tab]);

  // สิทธิ์: เฉพาะ Administrator (กันกรณีถูกเรียกโดยตรง)
  if(!user || user.role!=="Administrator")
    return html`<div class="page"><div class="emptybox" style=${{margin:"40px auto",maxWidth:"440px",textAlign:"center"}}>
      <${Icon} name="shield" size=${30} color="var(--muted)"/>
      <div style=${{fontSize:"16px",fontWeight:700,marginTop:"10px"}}>ไม่มีสิทธิ์เข้าถึงหน้านี้</div>
      <div class="dim" style=${{fontSize:"13px",marginTop:"6px"}}>เฉพาะผู้ดูแลระบบ (Administrator) เท่านั้นที่จัดการข้อมูลหลักได้</div></div></div>`;

  const cfg = typeCfg(tab);
  const rows = [...(data[tab]||[])].sort((a,b)=>a.sort_order-b.sort_order);
  const audit = (action, detail)=> pushAudit({user:(user&&user.email)||"admin@geointel.io", action, category:"แก้ไข", detail:`ข้อมูลหลัก · ${cfg.label} · ${detail}`});

  const setRows = updater => setData(d=>({...d, [tab]: updater(d[tab]||[]) }));
  const toggleActive = it=>{
    if(it.is_system){ toast("รายการระบบ ปิดใช้งานไม่ได้","warn"); return; }
    const use = usageOf(tab, it.code, db);
    if(it.is_active && use>0 && !confirm(`มีข้อมูล ${num(use)} รายการที่ยังใช้ "${it.label_th}" อยู่\nปิดใช้งานแล้วจะไม่แสดงใน dropdown ของการเพิ่ม/แก้ไขต่อไป (เรคคอร์ดเดิมยังคงอยู่)\n\nยืนยันปิดใช้งาน?`)) return;
    setRows(a=>a.map(x=>x.code===it.code?{...x,is_active:!x.is_active}:x));
    audit(it.is_active?"ปิดใช้งาน":"เปิดใช้งาน", `"${it.label_th}"${it.is_active&&use>0?` (มีใช้อยู่ ${use} รายการ)`:""}`);
    toast(it.is_active?`ปิดใช้งาน "${it.label_th}" แล้ว`:`เปิดใช้งาน "${it.label_th}" แล้ว`,"good");
  };
  const save = form =>{
    const isNew = edit.isNew;
    if(!form.label_th.trim()){ toast("กรุณากรอกชื่อที่แสดงผล","warn"); return; }
    if(isNew){
      const code = (form.code||form.label_th).trim().toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"") || ("item_"+(rows.length+1));
      if(rows.some(x=>x.code===code)){ toast("รหัสอ้างอิงนี้มีอยู่แล้ว","warn"); return; }
      const item = {code, label_th:form.label_th.trim(), color_hex:cfg.color?(form.color_hex||"#8aa0be"):"", icon:cfg.icon?(form.icon||""):"",
        sort_order:rows.length, is_active:form.is_active!==false, is_system:false};
      setRows(a=>[...a, item]); audit("เพิ่มรายการ", `"${item.label_th}" (${code})`); toast(`เพิ่ม "${item.label_th}" แล้ว`,"good");
    } else {
      setRows(a=>a.map(x=>x.code===edit.item.code ? {...x, label_th:form.label_th.trim(),
        color_hex:cfg.color?form.color_hex:x.color_hex, icon:cfg.icon?form.icon:x.icon, is_active:form.is_active} : x));
      audit("แก้ไขรายการ", `"${form.label_th.trim()}" (${edit.item.code})`); toast("บันทึกการแก้ไขแล้ว","good");
    }
    setEdit(null);
  };

  return html`<div class="fade-in">
    <!-- แผงย่อยของ "ตั้งค่าระบบ" — ไม่มี page-head ของตัวเอง (ใช้หัวข้อ 'ตั้งค่าระบบ' ร่วม) -->
    <div class="row between" style=${{marginBottom:"12px",gap:"12px",flexWrap:"wrap"}}>
      <div><div style=${{fontSize:"15px",fontWeight:700}}>ข้อมูลหลัก (Master Data)</div>
        <div class="dim" style=${{fontSize:"12.5px",marginTop:"2px"}}>จัดการค่าตัวเลือกที่ใช้ในระบบ · การเปลี่ยนแปลงจะมีผลกับ dropdown ทุกหน้าของทุกบทบาท</div></div>
      <${Btn} variant="outline" icon="plus" onClick=${()=>setEdit({type:tab, isNew:true, item:{label_th:"",code:"",color_hex:"#38bdf8",icon:"",is_active:true}})}>เพิ่มรายการ</${Btn}></div>

    <div class="md-alert"><${Icon} name="info" size=${15} color="#f59e0b"/>
      <span>ค่าที่เพิ่ม/ปิดใช้งานที่นี่จะสะท้อนไปยังตัวกรอง Legend และฟอร์มทั่วทั้งระบบ · ไม่มีการลบถาวร (ปิดใช้งานเท่านั้น) เพื่อกันข้อมูลเดิมตกหล่น</span></div>

    <${Tabs} tabs=${TYPES} active=${tab} onChange=${setTab}/>

    <${Card} pad0=${true} style=${{marginTop:"14px"}}>
      <div class="md-table-wrap"><table class="md-table">
        <thead><tr><th style=${{width:"64px"}}>ลำดับ</th><th>ชื่อที่แสดงผล</th><th>รหัสอ้างอิง</th><th>จำนวนที่ใช้อยู่</th><th>สถานะ</th><th style=${{textAlign:"right"}}>จัดการ</th></tr></thead>
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
            <td>${use>0? html`<span>${num(use)} รายการ</span>` : html`<span class="dim">—</span>`}</td>
            <td>${it.is_system
                ? html`<${Badge} tone="neutral" icon="shield">ระบบ</${Badge}>`
                : it.is_active ? html`<${Badge} tone="good">ใช้งาน</${Badge}>` : html`<${Badge} tone="neutral">เลิกใช้แล้ว</${Badge}>`}</td>
            <td style=${{textAlign:"right"}}><div class="row" style=${{gap:"6px",justifyContent:"flex-end"}}>
              <${Btn} size="sm" variant="ghost" icon="edit" onClick=${()=>setEdit({type:tab, isNew:false, item:it})}>แก้ไข</${Btn}>
              ${it.is_system
                ? html`<span class="dim" style=${{fontSize:"11.5px",padding:"0 6px"}}>ล็อก</span>`
                : html`<${Toggle} on=${it.is_active} onChange=${()=>toggleActive(it)}/>`}
            </div></td>
          </tr>`; })}
        </tbody>
      </table>
      ${rows.length===0 && html`<div class="emptybox" style=${{margin:"18px"}}>ยังไม่มีรายการในหมวดนี้</div>`}
      </div>
    </${Card}>

    ${edit && html`<${MDModal} edit=${edit} cfg=${cfg} onClose=${()=>setEdit(null)} onSave=${save}/>`}
    <style>${MD_CSS}</style>
  </div>`;
}

function MDModal({edit, cfg, onClose, onSave}){
  const it = edit.item;
  const [f, setF] = useState({label_th:it.label_th||"", code:it.code||"", color_hex:it.color_hex||"#38bdf8", icon:it.icon||"", is_active:it.is_active!==false});
  const set=(k,v)=>setF(p=>({...p,[k]:v}));
  return html`<${Modal} title=${edit.isNew?"เพิ่มรายการใหม่ · "+cfg.label:"แก้ไข · "+cfg.label} onClose=${onClose}
    footer=${html`<${Btn} variant="outline" onClick=${onClose}>ยกเลิก</${Btn}>
      <${Btn} variant="primary" icon="check" onClick=${()=>onSave(f)}>บันทึก</${Btn}>`}>
    <${Field} label="ชื่อที่แสดงผล"><input class="input" value=${f.label_th} onInput=${e=>set("label_th",e.target.value)} placeholder=${cfg.egLabel||"เช่น รายการใหม่"}/></${Field}>
    <${Field} label="รหัสอ้างอิง (code)">
      <input class="input" value=${f.code} disabled=${!edit.isNew} onInput=${e=>set("code",e.target.value)}
        placeholder=${cfg.egCode||"เช่น new_item"} style=${!edit.isNew?{opacity:.6,cursor:"not-allowed"}:null}/>
      <div class="dim" style=${{fontSize:"11.5px",marginTop:"4px"}}>${edit.isNew?"ใช้ a–z, 0–9, _ เท่านั้น (เว้นว่างได้ ระบบจะสร้างจากชื่อให้)":"รหัสอ้างอิงเปลี่ยนไม่ได้หลังสร้างแล้ว"}</div>
    </${Field}>
    ${cfg.color && html`<${Field} label="สี">
      <div class="row" style=${{gap:"10px"}}><input type="color" value=${f.color_hex} onInput=${e=>set("color_hex",e.target.value)} style=${{width:"46px",height:"34px",padding:"2px",borderRadius:"8px",border:"1px solid var(--stroke2)",background:"var(--surface)",cursor:"pointer"}}/>
        <span class="mono dim" style=${{fontSize:"12px"}}>${f.color_hex}</span></div></${Field}>`}
    ${cfg.icon && html`<${Field} label="ไอคอน (อีโมจิ)"><input class="input" value=${f.icon} onInput=${e=>set("icon",e.target.value)} placeholder="เช่น 🍽️" maxLength=${4} style=${{width:"120px"}}/></${Field}>`}
    <${Field} label="เปิดใช้งาน"><div><${Toggle} on=${f.is_active} onChange=${()=>set("is_active",!f.is_active)}/></div></${Field}>
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
