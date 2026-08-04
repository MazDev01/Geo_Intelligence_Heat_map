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
  font-family:var(--font);font-size:13px;cursor:pointer;text-align:left;line-height:1.3}
.uidd-btn:hover,.uidd-btn.open{border-color:var(--accent)}
.uidd-btn:disabled{opacity:.6;cursor:not-allowed}
.uidd-val{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.uidd-val.ph{color:var(--muted)}
/* รายการตัวเลือก — สูงสุด ~6 แถวแล้วเลื่อน (6 × ~40px + padding) */
.uidd-pop{position:absolute;z-index:3000;top:calc(100% + 5px);left:0;right:0;max-height:246px;overflow-y:auto;
  background:var(--panel);border:1px solid var(--stroke2);border-radius:11px;
  box-shadow:var(--shadow-md,0 18px 50px rgba(0,0,0,.35));backdrop-filter:blur(14px);padding:5px}
.uidd-opt{display:flex;align-items:center;gap:8px;padding:9px 11px;border-radius:8px;cursor:pointer;
  font-size:13px;color:var(--txt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.uidd-opt:not(.on):hover,.uidd-opt:not(.on).hl{background:var(--accent-soft);color:var(--accent-deep,#b30019)}
.uidd-opt.on{background:var(--surface);color:var(--accent-deep,#b30019);font-weight:700}
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
  const opts = options.map(o=>Array.isArray(o)?{value:o[0],label:o[1]}:o);
  const cur = opts.find(o=>String(o.value)===String(value));
  useEffect(()=>{ if(!open) return;
    setHl(opts.findIndex(o=>String(o.value)===String(value)));
    const onDoc=e=>{ if(ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown",onDoc); return ()=>document.removeEventListener("mousedown",onDoc); },[open]);
  const pick=v=>{ onChange&&onChange(v); setOpen(false); };
  const onKey=e=>{
    if(e.key==="Escape"){ setOpen(false); return; }
    if(e.key==="Enter"||e.key===" "){ e.preventDefault(); if(!open){setOpen(true);return;} if(hl>=0&&opts[hl]) pick(opts[hl].value); return; }
    if(e.key==="ArrowDown"){ e.preventDefault(); if(!open){setOpen(true);return;} setHl(h=>Math.min(opts.length-1,h+1)); }
    else if(e.key==="ArrowUp"){ e.preventDefault(); setHl(h=>Math.max(0,h-1)); }
  };
  return html`<div class="uidd" ref=${ref}>
    <button type="button" class=${"uidd-btn"+(open?" open":"")} disabled=${disabled} title=${title||""}
      aria-haspopup="listbox" aria-expanded=${open} onClick=${()=>!disabled&&setOpen(o=>!o)} onKeyDown=${onKey}>
      <span class=${"uidd-val"+(cur?"":" ph")}>${cur?cur.label:placeholder}</span>
      <${Icon} name="chevron" size=${14} color="var(--muted)" style=${{transform:open?"rotate(180deg)":"none",transition:".15s",flex:"none"}}/>
    </button>
    ${open?html`<div class="uidd-pop" role="listbox" ref=${popRef}>
      ${opts.map((o,i)=>html`<div key=${o.value} role="option" aria-selected=${String(o.value)===String(value)}
        class=${"uidd-opt"+(String(o.value)===String(value)?" on":"")+(i===hl?" hl":"")}
        onMouseEnter=${()=>setHl(i)} onClick=${()=>pick(o.value)}>${o.label}</div>`)}
    </div>`:""}
  </div>`;
}
