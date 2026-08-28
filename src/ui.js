import {html, Icon, cx, useState, useEffect, useRef, thDate} from "./lib.js";
import {createPortal} from "react-dom";   // portal Modal ไป <body> เพื่อไม่ให้ถูก .slide-panel (overflow:hidden + transform) กักไว้ในเนื้อหา — ป็อปอัพจึงคลุมเต็มจอ (รวมแถบเมนู)

export function Card({title, sub, right, className, children, pad0, onClick, hoverable}){
  return html`<div class=${cx("card", pad0&&"pad0", hoverable&&"hoverable", className)} onClick=${onClick}>
    ${(title||right)&&html`<div class="card-h" style=${pad0?{padding:"16px 18px 0"}:null}>
      ${title&&html`<div><h3>${title}</h3>${sub&&html`<div class="ch-sub">${sub}</div>`}</div>`}
      ${right&&html`<div class="sp">${right}</div>`}
    </div>`}
    ${children}
  </div>`;
}

export function Kpi({label, value, icon, iconBg, iconColor, delta, deltaUp, spark}){
  return html`<div class="kpi hoverable fade-in">
    ${/* สีไอคอนตั้งต้น = แดงเข้มของแบรนด์ (ธีมสว่าง) — เดิมเป็นฟ้าอ่อน #dbe8ff ซึ่งเป็นสีสำหรับพื้นมืด
           ทำให้ไอคอนจางจนแทบมองไม่เห็นบนกล่อง KPI พื้นอ่อน · กล่องที่ส่ง iconBg สีอื่นมาใช้สีตัวอักษรหลักแทน */""}
    ${icon&&html`<div class="kpi-ic" style=${{background:iconBg||"rgba(230, 0, 35,.15)"}}>
      <${Icon} name=${icon} size=${19} color=${iconColor || (iconBg ? "var(--txt)" : "var(--accent-deep)")}/></div>`}
    <div class="kk">${label}</div>
    <div class="kv tnum">${value}</div>
    ${delta!=null&&html`<div class=${cx("kd", deltaUp?"up":"down")}>
      <${Icon} name="trend" size=${13}/> ${delta}</div>`}
    ${spark&&html`<div class="spark">${spark}</div>`}
  </div>`;
}

export function Badge({tone="neutral", children, icon}){
  return html`<span class=${"badge b-"+tone}>${icon&&html`<${Icon} name=${icon} size=${12}/>`}${children}</span>`;
}

// Small "i" info affordance with a tooltip. Works on hover (desktop) AND click/tap (mobile, no hover);
// a click toggles it and an outside click closes it. `side="right"` opens the bubble leftward (use near
// a right edge). `text` may be a string or an html`` fragment.
export function InfoTip({text, side}){
  const [open,setOpen]=useState(false);
  const ref=useRef();
  useEffect(()=>{ if(!open) return;
    const away=e=>{ if(ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown",away);
    return ()=>document.removeEventListener("mousedown",away);
  },[open]);
  return html`<span class=${"infotip"+(side==="right"?" itp-right":"")} ref=${ref}
    onMouseEnter=${()=>setOpen(true)} onMouseLeave=${()=>setOpen(false)}>
    <button class="infotip-i" type="button" aria-label="คำอธิบายที่มาของคะแนน"
      onClick=${e=>{e.stopPropagation();e.preventDefault();setOpen(o=>!o);}}>i</button>
    ${open && html`<span class="infotip-pop" role="tooltip">${text}</span>`}
  </span>`;
}

export function Btn({variant="ghost", size, icon, children, onClick, disabled, type}){
  return html`<button type=${type||"button"} class=${cx("btn",variant,size)} onClick=${onClick} disabled=${disabled}>
    ${icon&&html`<${Icon} name=${icon} size=${size==="sm"?14:16}/>`}${children}</button>`;
}

export function Toggle({on, onChange}){
  return html`<div class=${cx("toggle",on&&"on")} onClick=${()=>onChange&&onChange(!on)}></div>`;
}

export function Field({label, children}){
  return html`<div class="field">${label&&html`<label>${label}</label>`}${children}</div>`;
}
export function Input(props){ return html`<input class="input" ...${props}/>`; }
export function Select({value,onChange,children,...rest}){
  return html`<select class="input" value=${value} onChange=${onChange} ...${rest}>${children}</select>`;
}

export function Tabs({tabs, active, onChange}){
  return html`<div class="tabs">${tabs.map(t=>{
    const v=typeof t==="string"?t:t.value, l=typeof t==="string"?t:t.label;
    return html`<div key=${v} class=${cx("tab",active===v&&"on")} onClick=${()=>onChange(v)}>${l}</div>`;
  })}</div>`;
}

export function Meter({value, color, height}){
  return html`<div class="meter" style=${height?{height:height+"px"}:null}>
    <span style=${{width:Math.max(0,Math.min(100,value))+"%", background:color||"linear-gradient(90deg,#e60023,#ff3b5c)"}}></span></div>`;
}

export function Modal({title, onClose, children, footer, wide, small}){
  // small = กล่องยืนยันสั้น ๆ (ข้อความไม่กี่บรรทัด) ไม่ต้องกว้าง 560px เท่าป็อปอัพที่มีฟอร์ม
  const node = html`<div class="modal-ov" onClick=${e=>e.target.classList.contains("modal-ov")&&onClose()}>
    <div class=${cx("modal",wide&&"wide",small&&"small")}>
      <div class="modal-h"><h2>${title}</h2>
        <button class="icon-btn" style=${{marginLeft:"auto",width:"32px",height:"32px"}} onClick=${onClose}>
          <${Icon} name="close" size=${16}/></button></div>
      <div class="modal-b">${children}</div>
      ${footer&&html`<div class="modal-f">${footer}</div>`}
    </div></div>`;
  // render ที่ <body> โดยตรง → escape .slide-panel ในหน้าแอดมิน จึงคลุมเต็มจอ (แถบเมนูไม่โผล่หลังป็อปอัพ)
  return (typeof document!=="undefined") ? createPortal(node, document.body) : node;
}

export function Skeleton({h=16, w="100%", style}){
  return html`<div class="skeleton" style=${{height:h+"px", width:typeof w==="number"?w+"px":w, ...style}}></div>`;
}
export function LoadingScreen({label="Loading geospatial data…"}){
  return html`<div style=${{display:"grid",placeItems:"center",height:"100%",gap:"18px"}}>
    <div style=${{width:"46px",height:"46px",borderRadius:"50%",border:"3px solid rgba(120,160,220,.2)",
      borderTopColor:"var(--accent2)",animation:"spin 1s linear infinite"}}></div>
    <div class="muted" style=${{fontSize:"13px"}}>${label}</div>
    <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
  </div>`;
}

export function Table({cols, rows, onRow, empty="No records", rowClass}){
  return html`<div class="table-wrap scrolly">
    <table class="table"><thead><tr>${cols.map((c,i)=>html`<th key=${i} style=${c.w?{width:c.w}:null}>${c.h}</th>`)}</tr></thead>
    <tbody>${rows.length? rows.map((r,ri)=>html`<tr key=${ri} class=${cx(onRow&&"clickable", rowClass&&rowClass(r,ri))} onClick=${onRow?()=>onRow(r,ri):null}>
      ${cols.map((c,ci)=>html`<td key=${ci}>${c.render? c.render(r,ri): r[c.key]}</td>`)}
    </tr>`) : html`<tr><td colSpan=${cols.length}><div class="emptybox">${empty}</div></td></tr>`}</tbody></table>
  </div>`;
}

/* ช่องเลือกวันที่แบบไทย — value/onChange ยังเป็น "YYYY-MM-DD" เหมือน <input type=date> ทุกประการ
   className ส่งต่อไปที่ input ตัวจริง เพื่อให้ CSS ขนาดเดิมของแต่ละหน้ายังใช้ได้ */
export function DateField({value, onChange, min, max, title, className, placeholder="วว/ดด/ปปปป"}){
  return html`<span class="thdate">
    <input type="date" class=${className} value=${value||""} title=${title}
      min=${min||undefined} max=${max||undefined}
      onChange=${e=>onChange&&onChange(e.target.value)} onInput=${e=>onChange&&onChange(e.target.value)}/>
    <span class=${cx("thdate-lb", !value&&"ph")}>${value ? thDate(value) : placeholder}</span>
  </span>`;
}

// Toast host
let _toastFn=null;
export function toast(msg, tone="good"){ _toastFn && _toastFn(msg,tone); }
export function ToastHost(){
  const [items,setItems]=useState([]);
  useEffect(()=>{ _toastFn=(msg,tone)=>{ const id=Math.random();
    setItems(x=>[...x,{id,msg,tone}]); setTimeout(()=>setItems(x=>x.filter(i=>i.id!==id)),3200);}; },[]);
  const border={good:"var(--good)",bad:"var(--bad)",info:"var(--accent2)",warn:"var(--warn)"};
  return html`<div class="toast-wrap">${items.map(i=>html`<div key=${i.id} class="toast"
    style=${{borderLeftColor:border[i.tone]}}>${i.msg}</div>`)}</div>`;
}


/* ── แถบเมนูด้านข้างของโมดูลรายงาน TC ──
   เดิมเป็นปุ่มกลม 2 อันวางพาดด้านบนสุดของหน้า เขียนซ้ำกัน 2 ที่ (reports.js ใช้ .rp-subtab
   · visit-plan-report.js ใช้ .vp-subtab) สไตล์ไม่ตรงกันและแก้ต้องแก้สองที่
   รวมเหลือตัวเดียวที่นี่ และย้ายมาเป็นคอลัมน์ซ้ายตามที่ผู้ใช้กำหนด
   ใช้คู่กับ .tcrp-wrap ที่ห่อหน้า (กริด: เมนู 196px | เนื้อหา) */
const TCRP_TABS = [
  { id:"reports",     label:"แดชบอร์ด TC",        icon:"reports" },
  { id:"visit-plans", label:"รายงานแผนการเข้าพบ", icon:"route"   },
];
export function TCReportNav({active, nav}){
  return html`<nav class="tcrp-nav" aria-label="เมนูรายงาน">
    <div class="tcrp-nav-h">รายงาน</div>
    ${TCRP_TABS.map(t=>html`<button key=${t.id} class=${cx("tcrp-tab", active===t.id&&"on")}
      aria-current=${active===t.id?"page":undefined}
      onClick=${()=>{ if(active!==t.id && nav) nav(t.id); }}>
      <${Icon} name=${t.icon} size=${15}/><span>${t.label}</span></button>`)}
    <style>${TCRP_CSS}</style></nav>`;
}
const TCRP_CSS = `
/* เมนูอยู่คอลัมน์ 1 · ลูกที่เหลือของ .page ไหลลงคอลัมน์ 2 เรียงเป็นแถวตามเดิม
   ทำที่ CSS ล้วน จึงไม่ต้องห่อเนื้อหาหน้าใหม่ (htm พาร์สแต่ละ template แยกกัน เปิด/ปิด tag ข้าม template ไม่ได้)
   row-gap 0 เพื่อคงระยะห่างเดิมที่แต่ละบล็อกมี margin ของตัวเองอยู่แล้ว */
.tcrp-wrap{display:grid;grid-template-columns:196px minmax(0,1fr);gap:0 22px;align-items:start}
.tcrp-wrap > *{grid-column:2;min-width:0}
.tcrp-wrap > .tcrp-nav{grid-column:1;grid-row:1}
.tcrp-nav{display:flex;flex-direction:column;gap:4px;position:sticky;top:0}
.tcrp-nav-h{font-size:11px;font-weight:700;color:var(--dim);letter-spacing:.04em;padding:2px 12px 8px}
.tcrp-tab{display:flex;align-items:center;gap:9px;width:100%;text-align:left;padding:10px 13px;border-radius:10px;
  border:1px solid transparent;background:none;color:var(--muted);font-family:var(--font);font-size:13px;
  font-weight:600;cursor:pointer;line-height:1.3}
.tcrp-tab:hover{background:var(--surface2);color:var(--txt)}
.tcrp-tab.on{background:var(--accent);border-color:var(--accent);color:#fff}
/* จอแคบ: พับกลับเป็นแถวเดียวเหนือเนื้อหา ไม่ให้เมนูกินความกว้างของตาราง */
@media(max-width:900px){
  .tcrp-wrap{grid-template-columns:1fr;gap:12px 0}
  .tcrp-wrap > *,.tcrp-wrap > .tcrp-nav{grid-column:1}
  .tcrp-nav{flex-direction:row;position:static;flex-wrap:wrap}
  .tcrp-nav-h{display:none}
  .tcrp-tab{width:auto;border-radius:999px;border-color:var(--stroke2);background:var(--panel)}
}
@media print{.tcrp-nav{display:none!important}.tcrp-wrap{display:block}}
`;
