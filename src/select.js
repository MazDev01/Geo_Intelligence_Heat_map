// ═══════════════════════════════════════════════════════════════════════════
// src/select.js — Dropdown เลือกค่าแบบกำหนดสไตล์เอง (แทน native <select> ที่คุมหน้าตาไม่ได้)
// โชว์สูงสุด ~6 ตัวเลือกแล้วเลื่อนลง · hover = แดงอ่อน (--accent-soft ตามเทมเพลต)
// ตัวเลือกที่เลือกอยู่ = พื้นขาว (--surface) ตัวอักษรแดงเข้ม (--accent-deep) · ปิดเมื่อคลิกนอก/Esc · คีย์บอร์ด ↑↓ Enter
// ใช้ซ้ำได้ทุก dropdown ทุกบทบาท
// ═══════════════════════════════════════════════════════════════════════════
import {html, useState, useEffect, useRef, Icon} from "./lib.js";

if(typeof document!=="undefined" && !document.getElementById("sel-css")){
  const st=document.createElement("style"); st.id="sel-css";
  st.textContent=`
.uidd{position:relative;width:100%;font-family:var(--font)}
.uidd-btn{width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;
  padding:9px 12px;border-radius:10px;border:1px solid var(--stroke2);background:var(--surface);color:var(--txt);
  font-family:var(--font);font-size:13px;font-weight:400;cursor:pointer;text-align:left;line-height:1.3}
.uidd-btn:hover,.uidd-btn.open{border-color:var(--accent)}
.uidd-btn:disabled{opacity:.6;cursor:not-allowed}
.uidd-val{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.uidd-val.ph{color:var(--muted)}
/* รายการตัวเลือก — สูงสุด ~6 แถวแล้วเลื่อน (6 × ~40px + padding) */
.uidd-pop{position:absolute;z-index:3000;top:calc(100% + 5px);left:0;right:0;max-height:246px;overflow-y:auto;
  background:var(--panel);border:1px solid var(--stroke2);border-radius:11px;
  box-shadow:var(--shadow-md,0 18px 50px rgba(0,0,0,.35));backdrop-filter:blur(14px);padding:5px}
.uidd-opt{display:flex;align-items:center;gap:8px;padding:9px 11px;border-radius:8px;cursor:pointer;
  font-size:13px;font-weight:400;color:var(--txt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.uidd-opt:not(.on):not(.off):hover,.uidd-opt:not(.on):not(.off).hl{background:var(--accent-soft);color:var(--accent-deep,#b30019)}
/* ตัวเลือกที่ใช้ไปแล้ว/เลือกไม่ได้ — จางลงและกดไม่ติด */
.uidd-opt.off{opacity:.45;cursor:not-allowed;justify-content:space-between}
.uidd-opt.off:hover{background:none;color:var(--txt)}
.uidd-note{font-size:11px;color:var(--dim);flex:none;margin-left:10px}
.uidd-opt.on{background:var(--surface);color:var(--accent-deep,#b30019)}
/* ในแถบตัวกรอง (op-slicers): ให้ป็อปอัพกว้างตามเนื้อหา เห็นข้อความเต็มทุกตัวเลือก — โดยปุ่ม/ช่องแสดงตัวกรองคงขนาดเดิม */
.op-slicers .uidd-pop{right:auto;min-width:100%;width:max-content;max-width:min(360px,90vw)}
`;
  document.head.appendChild(st);
}

// options: [[value,label], ...] หรือ [{value,label}, ...]
export function Dropdown({value, onChange, options=[], placeholder="เลือก…", disabled=false, title}){
  const [open,setOpen]=useState(false);
  const [hl,setHl]=useState(-1);
  const ref=useRef(null); const popRef=useRef(null);
  // ตัวเลือกรับได้ 3 แบบ: "ค่า" · [ค่า,ป้าย] · {value,label,disabled,note}
  const opts = options.map(o=>Array.isArray(o)?{value:o[0],label:o[1]}:o);
  const enabled = i => opts[i] && !opts[i].disabled;
  const cur = opts.find(o=>String(o.value)===String(value));
  useEffect(()=>{ if(!open) return;
    setHl(opts.findIndex(o=>String(o.value)===String(value)));
    const onDoc=e=>{ if(ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown",onDoc); return ()=>document.removeEventListener("mousedown",onDoc); },[open]);
  const pick=o=>{ if(o.disabled) return; onChange&&onChange(o.value); setOpen(false); };
  // เลื่อนไฮไลต์ข้ามตัวเลือกที่ปิดไว้
  const step=(from,dir)=>{ let i=from; for(let k=0;k<opts.length;k++){ i+=dir;
    if(i<0||i>=opts.length) return from; if(enabled(i)) return i; } return from; };
  const onKey=e=>{
    if(e.key==="Escape"){ setOpen(false); return; }
    if(e.key==="Enter"||e.key===" "){ e.preventDefault(); if(!open){setOpen(true);return;} if(hl>=0&&enabled(hl)) pick(opts[hl]); return; }
    if(e.key==="ArrowDown"){ e.preventDefault(); if(!open){setOpen(true);return;} setHl(h=>step(h,1)); }
    else if(e.key==="ArrowUp"){ e.preventDefault(); setHl(h=>step(h,-1)); }
  };
  return html`<div class="uidd" ref=${ref}>
    <button type="button" class=${"uidd-btn"+(open?" open":"")} disabled=${disabled} title=${title||""}
      aria-haspopup="listbox" aria-expanded=${open} onClick=${()=>!disabled&&setOpen(o=>!o)} onKeyDown=${onKey}>
      <span class=${"uidd-val"+(cur?"":" ph")}>${cur?cur.label:placeholder}</span>
      <${Icon} name="chevron" size=${14} color="var(--muted)" style=${{transform:open?"rotate(180deg)":"none",transition:".15s",flex:"none"}}/>
    </button>
    ${open?html`<div class="uidd-pop" role="listbox" ref=${popRef}>
      ${opts.map((o,i)=>html`<div key=${o.value} role="option" aria-selected=${String(o.value)===String(value)}
        aria-disabled=${!!o.disabled} title=${o.note||""}
        class=${"uidd-opt"+(String(o.value)===String(value)?" on":"")+(i===hl&&!o.disabled?" hl":"")+(o.disabled?" off":"")}
        onMouseEnter=${()=>!o.disabled&&setHl(i)} onClick=${()=>pick(o)}>
        <span>${o.label}</span>${o.note?html`<span class="uidd-note">${o.note}</span>`:""}</div>`)}
    </div>`:""}
  </div>`;
}
