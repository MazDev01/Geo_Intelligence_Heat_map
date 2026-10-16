import {t} from "./i18n.js";   // สลับภาษา TH/EN — ดู src/i18n.js
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
.uidd-pop.has-search{max-height:292px}
.uidd-search{position:sticky;top:-5px;z-index:1;margin:-5px -5px 4px;padding:8px 8px 6px;background:var(--panel);border-bottom:1px solid var(--stroke)}
.uidd-search input{width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid var(--stroke2);background:var(--surface);color:var(--txt);
  font-family:var(--font);font-size:13px;outline:none}
.uidd-search input:focus{border-color:var(--accent)}
.uidd-empty{padding:12px 11px;font-size:12.5px;color:var(--muted)}
`;
  document.head.appendChild(st);
}

const SEARCH_FROM = 10;

// options: [[value,label], ...] หรือ [{value,label}, ...]
export function Dropdown({value, onChange, options=[], placeholder=t("เลือก…", "Select…"), disabled=false, title}){
  const [open,setOpen]=useState(false);
  const [hl,setHl]=useState(-1);
  const [q,setQ]=useState("");
  const [nav,setNav]=useState(0);
  const ref=useRef(null); const popRef=useRef(null); const btnRef=useRef(null); const inRef=useRef(null);
  // ตัวเลือกรับได้ 3 แบบ: "ค่า" · [ค่า,ป้าย] · {value,label,disabled,note}
  const opts = options.map(o=>Array.isArray(o)?{value:o[0],label:o[1]}:o);
  const enabled = i => opts[i] && !opts[i].disabled;
  const cur = opts.find(o=>String(o.value)===String(value));
  const searchable = opts.length > SEARCH_FROM;
  const needle = searchable ? q.trim().toLowerCase() : "";
  const shown = opts.map((o,i)=>i).filter(i=>!needle || String(opts[i].label).toLowerCase().includes(needle) || String(opts[i].value).toLowerCase().includes(needle));
  useEffect(()=>{ if(!open){ setQ(""); return; }
    setHl(opts.findIndex(o=>String(o.value)===String(value)));
    if(searchable && inRef.current) inRef.current.focus();
    const onDoc=e=>{ if(ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown",onDoc); return ()=>document.removeEventListener("mousedown",onDoc); },[open]);
  useEffect(()=>{ const pop=popRef.current; if(!open || !pop) return;
    const el = pop.querySelector(".uidd-opt.hl") || pop.querySelector(".uidd-opt.on"); if(!el) return;
    const head = searchable ? pop.querySelector(".uidd-search").offsetHeight : 0;
    const top = el.offsetTop, bottom = top + el.offsetHeight;
    if(top < pop.scrollTop + head) pop.scrollTop = Math.max(0, top - head - 5);
    else if(bottom > pop.scrollTop + pop.clientHeight) pop.scrollTop = bottom - pop.clientHeight + 5; },[open,nav]);
  const close=()=>{ setOpen(false); if(btnRef.current) btnRef.current.focus(); };
  const pick=o=>{ if(o.disabled) return; onChange&&onChange(o.value); searchable ? close() : setOpen(false); };
  const onSearch=e=>{ const v=e.target.value; setQ(v); setNav(n=>n+1);
    const n=v.trim().toLowerCase();
    setHl(opts.findIndex(o=>!o.disabled && (!n || String(o.label).toLowerCase().includes(n) || String(o.value).toLowerCase().includes(n)))); };
  const stepShown=dir=>{ setNav(n=>n+1); setHl(h=>{ const at=shown.indexOf(h);
    for(let k=(at<0 ? (dir>0?0:shown.length-1) : at+dir); k>=0 && k<shown.length; k+=dir){ if(enabled(shown[k])) return shown[k]; }
    return h; }); };
  const onSearchKey=e=>{
    if(e.key==="Escape"){ e.preventDefault(); e.stopPropagation(); close(); return; }
    if(e.key==="Enter"){ e.preventDefault(); if(hl>=0 && shown.includes(hl) && enabled(hl)) pick(opts[hl]); return; }
    if(e.key==="ArrowDown"){ e.preventDefault(); stepShown(1); }
    else if(e.key==="ArrowUp"){ e.preventDefault(); stepShown(-1); }
  };
  // เลื่อนไฮไลต์ข้ามตัวเลือกที่ปิดไว้
  const step=(from,dir)=>{ let i=from; for(let k=0;k<opts.length;k++){ i+=dir;
    if(i<0||i>=opts.length) return from; if(enabled(i)) return i; } return from; };
  const onKey=e=>{
    if(e.key==="Escape"){ setOpen(false); return; }
    if(e.key==="Enter"||e.key===" "){ e.preventDefault(); if(!open){setOpen(true);return;} if(hl>=0&&enabled(hl)) pick(opts[hl]); return; }
    if(e.key==="ArrowDown"){ e.preventDefault(); if(!open){setOpen(true);return;} setNav(n=>n+1); setHl(h=>step(h,1)); }
    else if(e.key==="ArrowUp"){ e.preventDefault(); setNav(n=>n+1); setHl(h=>step(h,-1)); }
  };
  return html`<div class="uidd" ref=${ref}>
    <button type="button" ref=${btnRef} class=${"uidd-btn"+(open?" open":"")} disabled=${disabled} title=${title||""}
      aria-haspopup="listbox" aria-expanded=${open} onClick=${()=>!disabled&&setOpen(o=>!o)} onKeyDown=${onKey}>
      <span class=${"uidd-val"+(cur?"":" ph")}>${cur?cur.label:placeholder}</span>
      <${Icon} name="chevron" size=${14} color="var(--muted)" style=${{transform:open?"rotate(180deg)":"none",transition:".15s",flex:"none"}}/>
    </button>
    ${open?html`<div class=${"uidd-pop"+(searchable?" has-search":"")} role="listbox" ref=${popRef} onClick=${e=>e.preventDefault()}>
      ${searchable?html`<div class="uidd-search"><input ref=${inRef} type="text" autocomplete="off" value=${q} placeholder=${t("ค้นหา…", "Search…")}
        aria-label=${t("ค้นหา", "Search")} onInput=${onSearch} onKeyDown=${onSearchKey}/></div>`:""}
      ${searchable && !shown.length?html`<div class="uidd-empty">${t("ไม่พบรายการ", "No matches")}</div>`:""}
      ${shown.map(i=>{ const o=opts[i]; return html`<div key=${o.value} role="option" aria-selected=${String(o.value)===String(value)}
        aria-disabled=${!!o.disabled} title=${o.note||""}
        class=${"uidd-opt"+(String(o.value)===String(value)?" on":"")+(i===hl&&!o.disabled?" hl":"")+(o.disabled?" off":"")}
        onMouseEnter=${()=>!o.disabled&&setHl(i)} onClick=${()=>pick(o)}>
        <span>${o.label}</span>${o.note?html`<span class="uidd-note">${o.note}</span>`:""}</div>`; })}
    </div>`:""}
  </div>`;
}
