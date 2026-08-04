// ═══════════════════════════════════════════════════════════════════════════
// src/category-chips.js — แถบชิปหมวดหมู่ธุรกิจ 12 หมวด "แถวเดียว เลื่อนแนวนอน" (ดีไซน์ v2)
// v2: ลบชิป "ทั้งหมด" → ใช้ปุ่มเบา "ล้างตัวกรอง ×" ปักซ้าย (โผล่เมื่อกรองบางส่วน) · ลดกล่องกรอบ
//     ชิปแต่ละตัวลอยบนแผนที่โดยตรง (พิลกลม + เงาบาง) · ตัดเครื่องหมาย ✓ · ใช้ไอคอน lucide (SVG จริง ไม่ใช้อีโมจิ)
// แก้เฉพาะหน้าตา/การจัด — ไม่แตะตรรกะการกรอง/heatmap/แผนที่ · ทุกข้อความภาษาไทย
// ═══════════════════════════════════════════════════════════════════════════
import {html, useState, useEffect, useRef, Icon, SEGMENTS, SEG_COLOR, SEG_SVG, segKey, segTH} from "./lib.js";
import {prefersReducedMotion} from "./config/animation.js";

// คอมโพเนนต์ไอคอนหมวด — ดึงจาก SEG_SVG กลาง (แหล่งเดียว) เพื่อระบบสัญลักษณ์เดียวกันทั้งชิป/หมุด/ตาราง/ป๊อปอัพ
// (ไอคอน lucide 12 หมวดถูกนิยามครั้งเดียวที่ mock/geoData.js → SEG_SVG)
export const CatIcon = ({seg, size=16, cls="cc-ic"}) => html`<svg class=${cls} width=${size} height=${size}
  viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
  aria-hidden="true" dangerouslySetInnerHTML=${{__html: SEG_SVG[segKey(seg)]}}></svg>`;
// เลือกสีตัวอักษร/ไอคอนบนพื้นสีหมวด ให้ contrast พอ (พื้นสว่าง→ตัวเข้ม, พื้นเข้ม→ตัวขาว)
const inkOn = hex => { const h=hex.replace("#",""); const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);
  return (0.299*r+0.587*g+0.114*b)/255 > 0.58 ? "#0b1220" : "#ffffff"; };

if(typeof document!=="undefined" && !document.getElementById("cc-css")){
  const st=document.createElement("style"); st.id="cc-css";
  st.textContent=`
.cc-wrap{position:relative;flex:1;min-width:0;display:flex;align-items:center;gap:8px}
.cc-area{position:relative;flex:1;min-width:0;display:flex;align-items:center}
.cc-strip{flex:1;min-width:0;display:flex;align-items:center;gap:8px;overflow-x:auto;flex-wrap:nowrap;
  scroll-snap-type:x proximity;scroll-padding-inline:34px;padding:3px 2px;cursor:grab}
.cc-strip.drag{cursor:grabbing;scroll-behavior:auto}
.cc-strip::-webkit-scrollbar{display:none}
.cc-strip{scrollbar-width:none;-ms-overflow-style:none}
/* ชิปหมวด — พิลกลมลอยบนแผนที่โดยตรง (ไม่มีกล่องหลักครอบ) */
.cc-chip{flex:none;height:35px;display:inline-flex;align-items:center;gap:7px;padding:0 13px;border-radius:999px;
  border:1px solid var(--stroke2);background:var(--panel);backdrop-filter:blur(6px);box-shadow:var(--shadow-sm);
  color:var(--txt);cursor:pointer;scroll-snap-align:start;font-family:var(--font);font-size:12.5px;font-weight:600;
  white-space:nowrap;max-width:200px;transition:background .15s,border-color .15s,color .15s}
.cc-chip .cc-ic{color:var(--seg);flex:none}
.cc-chip:hover{background:var(--surface);border-color:var(--seg)}
.cc-chip.on{border-color:var(--seg);font-weight:700}
.cc-chip.on .cc-ic{color:var(--ontext)}
.cc-chip:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.cc-lb{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* ปุ่มล้างตัวกรอง — เบา จาง ปักซ้ายสุด ไม่แข่งเด่นกับชิปหมวด */
.cc-clear{flex:none;height:35px;display:inline-flex;align-items:center;gap:6px;padding:0 12px;border-radius:999px;
  border:1px solid var(--stroke2);background:var(--surface);color:var(--muted);cursor:pointer;
  font-family:var(--font);font-size:12px;font-weight:600;white-space:nowrap}
.cc-clear:hover{color:var(--txt);border-color:var(--muted)}
/* fade mask + ปุ่มลูกศร วงกลมเล็กโปร่ง (สีเดียวกับชิป ไม่มีพื้นต่าง) */
.cc-fade{position:absolute;top:0;bottom:0;width:34px;pointer-events:none;z-index:3;opacity:0;transition:opacity .2s}
.cc-fade.l{left:0;background:linear-gradient(90deg,var(--bg),rgba(0,0,0,0))}
.cc-fade.r{right:0;background:linear-gradient(270deg,var(--bg),rgba(0,0,0,0))}
.cc-fade.on{opacity:.9}
.cc-arrow{position:absolute;top:50%;transform:translateY(-50%);z-index:4;width:24px;height:24px;border-radius:999px;
  display:grid;place-items:center;border:1px solid var(--stroke2);background:var(--panel);color:var(--txt);cursor:pointer;
  font-size:15px;line-height:1;box-shadow:var(--shadow-sm);backdrop-filter:blur(6px)}
.cc-arrow.l{left:1px}.cc-arrow.r{right:1px}
.cc-more{flex:none;width:35px;height:35px;border-radius:999px;display:grid;place-items:center;cursor:pointer;
  border:1px solid var(--stroke2);background:var(--panel);color:var(--txt);backdrop-filter:blur(6px);box-shadow:var(--shadow-sm);font-size:17px}
.cc-more:hover{border-color:var(--accent)}
.cc-pop{position:absolute;top:46px;right:0;z-index:900;width:340px;max-width:calc(100vw - 32px);padding:14px;
  border-radius:16px;background:var(--panel);border:1px solid var(--stroke2);backdrop-filter:blur(14px);box-shadow:var(--shadow)}
.cc-pop-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:10px 0}
.cc-pop-item{display:flex;align-items:center;gap:8px;padding:8px 9px;border-radius:10px;cursor:pointer;font-size:12.5px;color:var(--txt);border:1px solid transparent}
.cc-pop-item .cc-ic{color:var(--seg);flex:none}
.cc-pop-item:hover{background:var(--surface)}
.cc-pop-item.on{border-color:var(--stroke2);background:var(--surface)}
.cc-pop-foot{display:flex;gap:8px;justify-content:space-between;align-items:center;padding-top:10px;border-top:1px solid var(--stroke)}
.cc-lnk{background:none;border:none;color:var(--accent2);font-family:var(--font);font-size:12.5px;font-weight:700;cursor:pointer}
.cc-apply{border:none;border-radius:10px;padding:8px 16px;background:var(--accent);color:#fff;font-family:var(--font);font-size:12.5px;font-weight:700;cursor:pointer}
.cc-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
@media(max-width:1023px){.cc-more{display:none}}
/* มือถือ: แถบนำทางแยกเป็น 2 บรรทัด — ชิปหมวดหมู่เต็มความกว้างบรรทัดล่าง · เป้ากดใหญ่ขึ้น */
@media(max-width:767px){
  .map-nav{flex-wrap:wrap!important}
  .map-nav [data-tour="segments"]{order:3;flex-basis:100%!important}
  .cc-chip,.cc-clear{height:40px;font-size:13px}
  .cc-strip{scroll-padding-inline:10px;padding-left:8px;padding-right:8px}
}`;
  document.head.appendChild(st);
}

export function CategoryChips({ segments=SEGMENTS, active={}, onToggle, onSetAll }){
  const ref=useRef(null);
  const [edges,setEdges]=useState({l:false,r:false});
  const [more,setMore]=useState(false);
  const drag=useRef({on:false,x:0,left:0,moved:false});
  const selN = segments.filter(s=>active[s]).length;

  const updateEdges=()=>{ const el=ref.current; if(!el) return;
    setEdges({ l: el.scrollLeft>2, r: el.scrollLeft < el.scrollWidth-el.clientWidth-2 }); };
  useEffect(()=>{ const el=ref.current; if(!el) return; updateEdges();
    const ro=new ResizeObserver(updateEdges); ro.observe(el); el.addEventListener("scroll",updateEdges,{passive:true});
    return ()=>{ ro.disconnect(); el.removeEventListener("scroll",updateEdges); }; },[]);
  useEffect(updateEdges,[active]);

  const scrollByDir=dir=>{ const el=ref.current; if(!el) return;
    el.scrollBy({ left: dir*el.clientWidth*0.75, behavior: prefersReducedMotion()?"auto":"smooth" }); };
  // ลากด้วยเมาส์ (แยก "ลาก" กับ "คลิก" ด้วย threshold 5px)
  const onDown=e=>{ const el=ref.current; if(!el) return; drag.current={on:true,x:e.clientX,left:el.scrollLeft,moved:false}; el.classList.add("drag"); };
  const onMove=e=>{ const d=drag.current; if(!d.on) return; const dx=e.clientX-d.x; if(Math.abs(dx)>5) d.moved=true; ref.current.scrollLeft=d.left-dx; };
  const onUp=()=>{ drag.current.on=false; const el=ref.current; if(el) el.classList.remove("drag"); };
  const onClickCap=e=>{ if(drag.current.moved){ e.stopPropagation(); e.preventDefault(); drag.current.moved=false; } };
  // wheel: เลื่อนแนวนอนเฉพาะ shift+wheel หรือ trackpad แนวนอน — ไม่ยึด wheel แนวตั้ง (ปล่อยให้ zoom แผนที่ได้)
  const onWheel=e=>{ const el=ref.current; if(!el) return;
    if(e.shiftKey || Math.abs(e.deltaX)>Math.abs(e.deltaY)){ el.scrollLeft += (e.deltaX||e.deltaY); e.preventDefault(); } };
  // คีย์บอร์ด: ← → เลื่อนโฟกัสชิป · Home/End ไปหัว/ท้าย
  const onKey=e=>{ const el=ref.current; if(!el) return;
    const chips=[...el.querySelectorAll(".cc-chip")]; const i=chips.indexOf(document.activeElement);
    let n=-1;
    if(e.key==="ArrowRight") n=Math.min(chips.length-1,i+1);
    else if(e.key==="ArrowLeft") n=Math.max(0,i-1);
    else if(e.key==="Home") n=0;
    else if(e.key==="End") n=chips.length-1;
    if(n>=0){ e.preventDefault(); chips[n].focus(); chips[n].scrollIntoView({inline:"nearest",block:"nearest"}); } };

  return html`<div class="cc-wrap" role="group" aria-label="กรองตามหมวดหมู่ธุรกิจ">
    <div class="cc-area">
      ${edges.l?html`<button class="cc-arrow l" aria-label="เลื่อนไปทางซ้าย" onClick=${()=>scrollByDir(-1)}>‹</button>`:""}
      <div class=${"cc-fade l"+(edges.l?" on":"")} aria-hidden="true"></div>
      <div class="cc-strip" ref=${ref} onMouseDown=${onDown} onMouseMove=${onMove} onMouseUp=${onUp} onMouseLeave=${onUp}
        onClickCapture=${onClickCap} onWheel=${onWheel} onKeyDown=${onKey}>
        ${segments.map(s=>{ const on=!!active[s]; const c=SEG_COLOR[s]; const ink=inkOn(c);
          // คลิก = สลับเลือกเท่านั้น · ไม่จัดลำดับใหม่ ไม่เลื่อน (ชิปอยู่ที่เดิม) · เลือกแล้ว = พื้นสีประจำหมวด
          return html`<button key=${s} class=${"cc-chip"+(on?" on":"")} aria-pressed=${on} title=${segTH(s)}
            style=${on?{"--seg":c,"--ontext":"#fff",background:c,borderColor:c,color:"#fff"}:{"--seg":c}} onClick=${()=>onToggle&&onToggle(s)}>
            <${CatIcon} seg=${s} size=${16}/>
            <span class="cc-lb">${segTH(s)}</span></button>`; })}
      </div>
      <div class=${"cc-fade r"+(edges.r?" on":"")} aria-hidden="true"></div>
      ${edges.r?html`<button class="cc-arrow r" aria-label="เลื่อนไปทางขวา" onClick=${()=>scrollByDir(1)}>›</button>`:""}
    </div>

    <span class="cc-sr" role="status" aria-live="polite">เลือก ${selN} จาก ${segments.length} หมวด</span>
  </div>`;
}
