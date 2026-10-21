import {html, Icon, cx, useState, useEffect, useRef, thDate, todayBKK} from "./lib.js";
import {createPortal} from "react-dom";   // portal Modal ไป <body> เพื่อไม่ให้ถูก .slide-panel (overflow:hidden + transform) กักไว้ในเนื้อหา — ป็อปอัพจึงคลุมเต็มจอ (รวมแถบเมนู)
import {t, getLang, setLang} from "./i18n.js";

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

export function Btn({variant="ghost", size, icon, children, onClick, disabled, type}){
  return html`<button type=${type||"button"} class=${cx("btn",variant,size)} onClick=${onClick} disabled=${disabled}>
    ${icon&&html`<${Icon} name=${icon} size=${size==="sm"?14:size==="lg"?19:16}/>`}${children}</button>`;
}

export function PwInput({value, onInput, autocomplete, placeholder, name}){
  const [show, setShow] = useState(false);
  const has = String(value == null ? "" : value).length > 0;
  useEffect(()=>{ if(!has) setShow(false); },[has]);
  const label = show ? t("ซ่อนรหัสผ่าน","Hide password") : t("แสดงรหัสผ่าน","Show password");
  return html`<div class="pw-wrap">
    <input class="input" name=${name} type=${show && has?"text":"password"} autocomplete=${autocomplete} placeholder=${placeholder} value=${value} onInput=${onInput}/>
    ${has && html`<button type="button" class="pw-eye" aria-pressed=${show} aria-label=${label} title=${label} onClick=${()=>setShow(!show)}><${Icon} name=${show?"eyeOff":"eye"} size=${18}/></button>`}
  </div>`;
}

export function Toggle({on, onChange, label, disabled, title}){
  return html`<button type="button" role="switch" class=${cx("toggle",on&&"on")} aria-checked=${on?"true":"false"}
    aria-label=${label} title=${title} disabled=${disabled} onClick=${()=>onChange&&onChange(!on)}></button>`;
}

export function Field({label, children}){
  return html`<div class="field">${label&&html`<label>${label}</label>`}${children}</div>`;
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
        <button class="icon-btn" style=${{marginLeft:"auto",width:"32px",height:"32px"}} aria-label=${t("ปิด", "Close")} onClick=${onClose}>
          <${Icon} name="close" size=${16}/></button></div>
      <div class="modal-b">${children}</div>
      ${footer&&html`<div class="modal-f">${footer}</div>`}
    </div></div>`;
  // render ที่ <body> โดยตรง → escape .slide-panel ในหน้าแอดมิน จึงคลุมเต็มจอ (แถบเมนูไม่โผล่หลังป็อปอัพ)
  return (typeof document!=="undefined") ? createPortal(node, document.body) : node;
}

export function Table({cols, rows, onRow, empty="No records", rowClass}){
  return html`<div class="table-wrap scrolly">
    <table class="table"><thead><tr>${cols.map((c,i)=>html`<th key=${i} style=${c.w?{width:c.w}:null}>${c.h}</th>`)}</tr></thead>
    <tbody>${rows.length? rows.map((r,ri)=>html`<tr key=${ri} class=${cx(onRow&&"clickable", rowClass&&rowClass(r,ri))} onClick=${onRow?()=>onRow(r,ri):null}>
      ${cols.map((c,ci)=>html`<td key=${ci} data-label=${typeof c.h==="string" && c.h ? c.h : undefined}>${c.render? c.render(r,ri): r[c.key]}</td>`)}
    </tr>`) : html`<tr><td colSpan=${cols.length}><div class="emptybox">${empty}</div></td></tr>`}</tbody></table>
  </div>`;
}

/* ช่องเลือกวันที่แบบไทย — value/onChange ยังเป็น "YYYY-MM-DD" เหมือน <input type=date> ทุกประการ
   className ส่งต่อไปที่ input ตัวจริง เพื่อให้ CSS ขนาดเดิมของแต่ละหน้ายังใช้ได้ */
const CAL_W = 284, CAL_H = 352;
const calPad = n => String(n).padStart(2, "0");
const calKey = (y, m, d) => { const x = new Date(Date.UTC(y, m, d)); return x.getUTCFullYear()+"-"+calPad(x.getUTCMonth()+1)+"-"+calPad(x.getUTCDate()); };
const calParse = v => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v||""); return m ? {y:+m[1], m:+m[2]-1, d:+m[3]} : null; };
const calShift = (k, days) => { const p = calParse(k); return calKey(p.y, p.m, p.d+days); };
const calMonths = () => getLang()==="en"
  ? ["January","February","March","April","May","June","July","August","September","October","November","December"]
  : ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
const calDows = () => getLang()==="en" ? ["Su","Mo","Tu","We","Th","Fr","Sa"] : ["อา","จ","อ","พ","พฤ","ศ","ส"];
const calYear = y => getLang()==="en" ? y : y+543;

export function DateField({value, onChange, min, max, title, className, placeholder=t("วว/ดด/ปปปป", "dd/mm/yyyy")}){
  const [open,setOpen] = useState(false);
  const [view,setView] = useState(null);
  const [cursor,setCursor] = useState("");
  const [pos,setPos] = useState(null);
  const wrapRef = useRef(null); const popRef = useRef(null);
  const today = todayBKK();
  const allowed = k => (!min || k>=min) && (!max || k<=max);
  const clamp = k => (min && k<min) ? min : (max && k>max) ? max : k;
  const show = () => { const start = calParse(value) ? value : clamp(today); const p = calParse(start);
    setView({y:p.y, m:p.m}); setCursor(start); setPos(null); setOpen(true); };
  const close = back => { setOpen(false); if(back && wrapRef.current){ const i = wrapRef.current.querySelector("input"); if(i) i.focus(); } };
  const pick = k => { if(!allowed(k)) return; onChange && onChange(k); close(true); };
  const clear = () => { onChange && onChange(""); close(true); };
  const go = (dy, dm) => setView(v => { const x = new Date(Date.UTC(v.y+dy, v.m+dm, 1)); return {y:x.getUTCFullYear(), m:x.getUTCMonth()}; });
  const moveTo = k => { const p = calParse(k); setCursor(k); setView({y:p.y, m:p.m}); };
  useEffect(()=>{ if(!open || !wrapRef.current) return;
    const r = wrapRef.current.getBoundingClientRect();
    let left = r.left; if(left + CAL_W > window.innerWidth - 8) left = Math.max(8, r.right - CAL_W);
    let top = r.bottom + 6; if(top + CAL_H > window.innerHeight - 8 && r.top - CAL_H - 6 >= 8) top = r.top - CAL_H - 6;
    setPos({left, top});
    const inside = e => !!(popRef.current && e.target && e.target.nodeType===1 && popRef.current.contains(e.target));
    const onDown = e => { if(wrapRef.current && wrapRef.current.contains(e.target)) return; if(inside(e)) return; setOpen(false); };
    const onMove = e => { if(inside(e)) return; setOpen(false); };
    document.addEventListener("mousedown", onDown); window.addEventListener("resize", onMove); window.addEventListener("scroll", onMove, true);
    return ()=>{ document.removeEventListener("mousedown", onDown); window.removeEventListener("resize", onMove); window.removeEventListener("scroll", onMove, true); };
  },[open]);
  useEffect(()=>{ if(open && pos && popRef.current) popRef.current.focus(); },[open, !!pos]);
  const onCalKey = e => {
    const step = {ArrowLeft:-1, ArrowRight:1, ArrowUp:-7, ArrowDown:7}[e.key];
    if(step){ e.preventDefault(); moveTo(calShift(cursor, step)); return; }
    if(e.key==="PageUp" || e.key==="PageDown"){ e.preventDefault(); const p = calParse(cursor); const dir = e.key==="PageUp" ? -1 : 1;
      const last = new Date(Date.UTC(p.y, p.m+dir+1, 0)).getUTCDate(); moveTo(calKey(p.y, p.m+dir, Math.min(p.d, last))); return; }
    if(e.key==="Enter" || e.key===" "){ e.preventDefault(); pick(cursor); return; }
    if(e.key==="Escape"){ e.preventDefault(); e.stopPropagation(); close(true); }
  };
  const onFieldKey = e => { if(e.key==="Enter" || e.key===" " || e.key==="ArrowDown"){ e.preventDefault(); if(!open) show(); }
    else if(e.key==="Escape" && open){ e.preventDefault(); e.stopPropagation(); close(true); } };
  const cells = view ? Array.from({length:42}, (_, i) => { const lead = new Date(Date.UTC(view.y, view.m, 1)).getUTCDay();
    const k = calKey(view.y, view.m, i - lead + 1); const p = calParse(k); return {k, d:p.d, out:p.m!==view.m}; }) : [];
  return html`<span class="thdate" ref=${wrapRef}>
    <input type="date" class=${className} value=${value||""} title=${title} readOnly=${true} aria-haspopup="dialog" aria-expanded=${open}
      min=${min||undefined} max=${max||undefined}
      onClick=${()=>open ? setOpen(false) : show()} onKeyDown=${onFieldKey}
      onChange=${e=>onChange&&onChange(e.target.value)} onInput=${e=>onChange&&onChange(e.target.value)}/>
    <span class=${cx("thdate-lb", !value&&"ph")}>${value ? thDate(value) : placeholder}</span>
    ${open && pos && view && createPortal(html`<div class="thcal" ref=${popRef} role="dialog" tabIndex="-1" aria-label=${t("เลือกวันที่", "Choose a date")}
        style=${{left:pos.left+"px", top:pos.top+"px"}} onKeyDown=${onCalKey}>
      <div class="thcal-head">
        <button type="button" class="thcal-nav" tabIndex="-1" title=${t("ปีก่อนหน้า", "Previous year")} onClick=${()=>go(-1,0)}>«</button>
        <button type="button" class="thcal-nav" tabIndex="-1" title=${t("เดือนก่อนหน้า", "Previous month")} onClick=${()=>go(0,-1)}>‹</button>
        <div class="thcal-title">${calMonths()[view.m]} ${calYear(view.y)}</div>
        <button type="button" class="thcal-nav" tabIndex="-1" title=${t("เดือนถัดไป", "Next month")} onClick=${()=>go(0,1)}>›</button>
        <button type="button" class="thcal-nav" tabIndex="-1" title=${t("ปีถัดไป", "Next year")} onClick=${()=>go(1,0)}>»</button>
      </div>
      <div class="thcal-grid">
        ${calDows().map(d=>html`<div key=${d} class="thcal-dow">${d}</div>`)}
        ${cells.map(c=>html`<button key=${c.k} type="button" data-day=${c.k} disabled=${!allowed(c.k)} tabIndex="-1"
          class=${cx("thcal-day", c.out&&"out", c.k===today&&"today", c.k===value&&"on", c.k===cursor&&"cur")}
          aria-pressed=${c.k===value} onMouseEnter=${()=>allowed(c.k)&&setCursor(c.k)} onClick=${()=>pick(c.k)}>${c.d}</button>`)}
      </div>
      <div class="thcal-foot">
        <button type="button" class="thcal-link" tabIndex="-1" disabled=${!value} onClick=${clear}>${t("ล้าง", "Clear")}</button>
        <button type="button" class="thcal-link" tabIndex="-1" disabled=${!allowed(today)} onClick=${()=>pick(today)}>${t("วันนี้", "Today")}</button>
      </div>
    </div>`, document.body)}
  </span>`;
}

// Toast host
let _toasts=[];
const _toastSubs=new Set();
const _toastEmit=()=>_toastSubs.forEach(f=>f(_toasts));
export function toast(msg, tone="good"){ const id=Math.random();
  _toasts=[..._toasts,{id,msg,tone}]; _toastEmit();
  setTimeout(()=>{ _toasts=_toasts.filter(i=>i.id!==id); _toastEmit(); },3200); }
export function ToastHost(){
  const [items,setItems]=useState(_toasts);
  useEffect(()=>{ _toastSubs.add(setItems); setItems(_toasts); return ()=>{ _toastSubs.delete(setItems); }; },[]);
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
  { id:"reports",     get label(){ return t("แดชบอร์ด TC","TC Dashboard"); },        icon:"reports" },
  { id:"visit-plans", get label(){ return t("รายงานแผนการเข้าพบ","Visit Plan Report"); }, icon:"route" },
];
const TEAMRP_TABS = [
  { id:"reports",     get label(){ return t("แดชบอร์ด","Dashboard"); },                    icon:"reports" },
  { id:"visit-plans", get label(){ return t("แผนการเข้าพบของทีม","Team visit plans"); }, icon:"route" },
];
export function TCReportNav({active, nav, team}){
  return html`<nav class="tcrp-nav" aria-label=${t("เมนูรายงาน", "Reports menu")}>
    <div class="tcrp-nav-h">${t("รายงาน", "Reports")}</div>
    ${(team ? TEAMRP_TABS : TCRP_TABS).map(t=>html`<button key=${t.id} class=${cx("tcrp-tab", active===t.id&&"on")}
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
.tcrp-wrap > .tcrp-nav{grid-column:1;grid-row:1 / span 60}
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
  .tcrp-wrap > .tcrp-nav{grid-row:auto}
  .tcrp-nav{flex-direction:row;position:static;flex-wrap:wrap}
  .tcrp-nav-h{display:none}
  .tcrp-tab{width:auto;border-radius:999px;border-color:var(--stroke2);background:var(--panel)}
}
@media print{.tcrp-nav{display:none!important}.tcrp-wrap{display:block}}
`;

// ── ปุ่มสลับภาษา TH/EN ─────────────────────────────────────────────────────────
// segmented control 2 ช่อง · กดช่องไหน = setLang ช่องนั้น (ไม่ใช่ toggle สลับไปมา
// เพื่อให้ผู้ใช้เห็นชัดว่ากำลังอยู่ภาษาไหนและกดเลือกได้ตรง ๆ ไม่ต้องเดา)
// setLang แจ้ง subscriber → App (useLang) re-render ทั้งต้นไม้ → ทุก t() อ่านค่าใหม่
// ใช้ที่ topbar (ทุกบทบาท) และมุมขวาบนของหน้าเข้าสู่ระบบ (หน้านั้นไม่มี topbar)
export function LangToggle(){
  const cur = getLang();
  const seg = on => ({
    height:"26px", minWidth:"32px", padding:"0 9px", border:"none", borderRadius:"7px", cursor:"pointer",
    fontFamily:"var(--font)", fontSize:"11.5px", fontWeight:700, letterSpacing:".3px",
    background: on ? "var(--panel)" : "transparent",
    color: on ? "var(--accent2)" : "var(--muted)",
    boxShadow: on ? "0 1px 3px rgba(0,0,0,.14)" : "none", transition:"background .18s, color .18s",
  });
  return html`<div class="lang-toggle" role="group" aria-label=${t("เลือกภาษา","Select language")}
    style=${{display:"inline-flex", alignItems:"center", gap:"2px", height:"32px", padding:"3px", marginRight:"8px",
      borderRadius:"9px", border:"1px solid var(--stroke2)", background:"var(--surface2, rgba(0,0,0,.04))"}}>
    ${[["th","ไทย","TH"],["en","English","EN"]].map(([code,full,short])=>html`
      <button key=${code} type="button" onClick=${()=>setLang(code)} title=${full}
        aria-pressed=${cur===code} style=${seg(cur===code)}>${short}</button>`)}
  </div>`;
}

