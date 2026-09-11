// ═══════════════════════════════════════════════════════════════════════════
// src/category-dropdown.js — ตัวกรอง "หมวดธุรกิจ" แบบ dropdown เลือกได้หลายหมวด
//
// แทนที่แถบชิปเลื่อนแนวนอนเดิม (category-chips.js) ด้วยปุ่มเดียว + แผงรายการติ๊ก
// เหตุผล: หมวดเพิ่มเป็น 13 หมวดและชื่อยาวขึ้นมาก (ชื่ออังกฤษยาวกว่าไทยอีก)
//         แถวชิปจึงล้นจอตลอดเวลา ต้องลาก/เลื่อนกว่าจะเห็นหมวดท้าย ๆ
//         dropdown เห็นครบทุกหมวดในคราวเดียว และคืนพื้นที่แถบบนให้แผนที่
//
// พฤติกรรมการกรองเหมือนเดิมทุกอย่าง: active คือ map ของ seg → true/false
// (ค่าเริ่มต้นคือ true ทุกหมวด · false = ซ่อนหมวดนั้นจากแผนที่และตัวเลขทั้งหมด)
// ═══════════════════════════════════════════════════════════════════════════
import {html, useState, useEffect, useRef, SEGMENTS, SEG_COLOR, SEG_SVG, segKey, segTH} from "./lib.js";

// ไอคอนหมวด — ดึงจาก SEG_SVG กลาง (แหล่งเดียว) เพื่อใช้สัญลักษณ์ชุดเดียวกับหมุด/ตาราง/ป๊อปอัพ
export const CatIcon = ({seg, size=16, cls="cd-ic"}) => html`<svg class=${cls} width=${size} height=${size}
  viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
  aria-hidden="true" dangerouslySetInnerHTML=${{__html: SEG_SVG[segKey(seg)]}}></svg>`;

if(typeof document!=="undefined" && !document.getElementById("cd-css")){
  const st=document.createElement("style"); st.id="cd-css";
  st.textContent=`
.cd-wrap{position:relative;display:inline-flex;align-items:center;min-width:0}
/* ปุ่มเปิดแผง — ทรงเดียวกับปุ่มอื่นบนแถบแผนที่ (พิลกลม พื้นโปร่ง เงาบาง) */
.cd-btn{height:35px;max-width:260px;display:inline-flex;align-items:center;gap:8px;padding:0 12px;border-radius:999px;
  border:1px solid var(--stroke2);background:var(--panel);backdrop-filter:blur(6px);box-shadow:var(--shadow-sm);
  color:var(--txt);cursor:pointer;font-family:var(--font);font-size:12.5px;font-weight:600;white-space:nowrap}
.cd-btn:hover{background:var(--surface);border-color:var(--muted)}
.cd-btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.cd-btn.filtered{border-color:var(--accent);color:var(--accent)}
.cd-lb{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cd-count{flex:none;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:var(--accent);color:#fff;
  font-size:11px;font-weight:700;display:inline-flex;align-items:center;justify-content:center}
.cd-caret{flex:none;transition:transform .18s}
.cd-wrap.open .cd-caret{transform:rotate(180deg)}
/* แผงรายการ — ชิดซ้ายใต้ปุ่ม สูงไม่เกินครึ่งจอ เลื่อนในแผงได้ */
.cd-pop{position:absolute;top:42px;left:0;z-index:950;width:300px;max-width:calc(100vw - 32px);
  border-radius:14px;background:var(--panel);border:1px solid var(--stroke2);backdrop-filter:blur(14px);
  box-shadow:var(--shadow);overflow:hidden}
.cd-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;
  border-bottom:1px solid var(--stroke)}
.cd-title{font-size:12px;font-weight:700;color:var(--txt)}
.cd-lnk{background:none;border:none;padding:0;color:var(--accent2);font-family:var(--font);font-size:12px;
  font-weight:700;cursor:pointer;white-space:nowrap}
.cd-lnk:hover{text-decoration:underline}
.cd-lnk:disabled{color:var(--muted);cursor:default;text-decoration:none}
.cd-list{max-height:min(52vh,380px);overflow-y:auto;padding:6px}
.cd-item{width:100%;display:flex;align-items:center;gap:9px;padding:8px 9px;border-radius:9px;cursor:pointer;
  border:1px solid transparent;background:none;color:var(--txt);font-family:var(--font);font-size:12.5px;
  font-weight:500;text-align:left}
.cd-item:hover{background:var(--surface)}
.cd-item:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.cd-item.on{font-weight:700}
.cd-item .cd-ic{color:var(--seg);flex:none}
.cd-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* กล่องติ๊ก — วาดเองเพื่อให้สีตรงกับสีประจำหมวด */
.cd-box{flex:none;width:16px;height:16px;border-radius:5px;border:1.5px solid var(--stroke2);
  display:inline-flex;align-items:center;justify-content:center}
.cd-item.on .cd-box{background:var(--seg);border-color:var(--seg)}
.cd-box svg{opacity:0;color:#fff}
.cd-item.on .cd-box svg{opacity:1}
.cd-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 12px;
  border-top:1px solid var(--stroke);font-size:11.5px;color:var(--dim)}
.cd-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
@media(max-width:767px){
  .map-nav{flex-wrap:wrap!important}
  .map-nav [data-tour="segments"]{order:3;flex-basis:100%!important}
  .cd-btn{height:40px;font-size:13px;max-width:none;width:100%;justify-content:space-between}
  .cd-pop{width:100%}
}`;
  document.head.appendChild(st);
}

const CHECK = html`<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7"/></svg>`;

export function CategoryDropdown({ segments=SEGMENTS, active={}, onToggle, onSetAll }){
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const list = useRef(null);

  const selected = segments.filter(s=>active[s]);
  const selN = selected.length;
  const allOn  = selN === segments.length;
  const noneOn = selN === 0;

  // ปิดแผงเมื่อคลิกนอกแผง หรือกด Esc — ผูก listener เฉพาะตอนเปิด
  useEffect(()=>{
    if(!open) return;
    const away = e => { if(wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    const key  = e => { if(e.key==="Escape"){ setOpen(false); wrap.current?.querySelector(".cd-btn")?.focus(); } };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return ()=>{ document.removeEventListener("mousedown", away); document.removeEventListener("keydown", key); };
  },[open]);

  // ↑ ↓ Home End เดินในรายการ — เปิดแผงแล้วโฟกัสอยู่ที่รายการ ไม่ต้องใช้เมาส์
  const onKey = e => {
    const items = list.current ? [...list.current.querySelectorAll(".cd-item")] : [];
    if(!items.length) return;
    const i = items.indexOf(document.activeElement);
    let n = -1;
    if(e.key==="ArrowDown") n = Math.min(items.length-1, i+1);
    else if(e.key==="ArrowUp") n = Math.max(0, i<0 ? 0 : i-1);
    else if(e.key==="Home") n = 0;
    else if(e.key==="End") n = items.length-1;
    if(n>=0){ e.preventDefault(); items[n].focus(); }
  };

  // ป้ายบนปุ่ม: บอกสถานะการกรองได้ในแวบเดียว ไม่ต้องเปิดแผงดู
  const label = allOn  ? "ทุกหมวดธุรกิจ"
              : noneOn ? "ไม่แสดงหมวดใด"
              : selN===1 ? segTH(selected[0])
              : "เลือกแล้ว "+selN+" หมวด";

  return html`<div class=${"cd-wrap"+(open?" open":"")} ref=${wrap}>
    <button class=${"cd-btn"+(allOn?"":" filtered")} type="button" aria-haspopup="listbox" aria-expanded=${open}
      title="กรองตามหมวดธุรกิจ" onClick=${()=>setOpen(o=>!o)}>
      <${CatIcon} seg=${selN===1 ? selected[0] : "Other"} size=${16}
        cls=${"cd-ic"} />
      <span class="cd-lb">${label}</span>
      ${!allOn && !noneOn && html`<span class="cd-count">${selN}</span>`}
      <svg class="cd-caret" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
    </button>

    ${open && html`<div class="cd-pop">
      <div class="cd-head">
        <span class="cd-title">หมวดธุรกิจ</span>
        ${allOn
          ? html`<button class="cd-lnk" type="button" onClick=${()=>onSetAll&&onSetAll(false)}>ล้างตัวกรอง</button>`
          : html`<button class="cd-lnk" type="button" onClick=${()=>onSetAll&&onSetAll(true)}>เลือกทั้งหมด</button>`}
      </div>

      <div class="cd-list" ref=${list} role="listbox" aria-multiselectable="true"
        aria-label="หมวดธุรกิจ" onKeyDown=${onKey}>
        ${segments.map(s=>{ const on=!!active[s];
          return html`<button key=${s} class=${"cd-item"+(on?" on":"")} type="button" role="option"
            aria-selected=${on} style=${{"--seg":SEG_COLOR[s]}} onClick=${()=>onToggle&&onToggle(s)}>
            <span class="cd-box">${CHECK}</span>
            <${CatIcon} seg=${s} size=${16}/>
            <span class="cd-name">${segTH(s)}</span></button>`; })}
      </div>

      <div class="cd-foot"><span>เลือก ${selN} จาก ${segments.length} หมวด</span></div>
    </div>`}

    <span class="cd-sr" role="status" aria-live="polite">เลือก ${selN} จาก ${segments.length} หมวด</span>
  </div>`;
}
