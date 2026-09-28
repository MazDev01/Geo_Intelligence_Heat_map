import {html, useState, useEffect, useRef} from "./lib.js";
import {t} from "./i18n.js";

// ═══════════════════════════════════════════════════════════════════════════
//  PRODUCT TOUR — reusable guided-tour framework (engine only, content-agnostic)
//
//  Renders a dark overlay that spotlights one UI element at a time and floats a
//  tooltip card beside it. Fully controlled by the parent:
//
//     <ProductTour open steps=${steps} onFinish=${..} onSkip=${..} onChange=${..}/>
//
//  Each step = {
//     target?:   CSS selector of the element to highlight (omit → centered card)
//     title?:    heading text
//     body?:     description text (string or html)
//     placement? 'top' | 'bottom' | 'left' | 'right' | 'center' | 'auto'  (default 'auto')
//     padding?:  extra px around the highlighted element (default 8)
//     before?:   () => void   — run when the step is entered (e.g. open a panel)
//  }
//
//  The tour never navigates or mutates app state on its own — it only reads the
//  DOM to position itself. Steps supply their own `before` hooks when wired later.
// ═══════════════════════════════════════════════════════════════════════════
export function ProductTour({open, steps, onFinish, onSkip, onChange}){
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);
  const list = steps || [];
  // keep the latest steps in a ref so the effects don't churn on array identity changes
  const stepsRef = useRef(list); stepsRef.current = list;

  // reset to the first step every time the tour opens
  useEffect(()=>{ if(open) setI(0); },[open]);

  // run the step's optional entry hook (switch view / open a panel — supplied by content)
  useEffect(()=>{ if(open){ const s=stepsRef.current[i]; if(s && typeof s.before==="function") s.before(); } },[open,i]);

  // keep the spotlight glued to its target across layout, scroll, resize & animation
  useEffect(()=>{
    if(!open) return;
    // ⚠ บางขั้นเล็งไปที่ของที่ "บางจังหวะไม่มี" (เช่นหมุดเดี่ยวตอนแผนที่ยังรวมเป็นกลุ่ม)
    //    ถ้าไม่เจอจะไม่มีไฟส่อง = ผู้ใช้ไม่รู้ว่ากำลังพูดถึงอะไร จึงให้ใส่ตัวสำรองได้หลายตัว
    //    (target เป็นสตริงเดียวหรืออาเรย์ก็ได้ — ไล่หาจากตัวแรกไปจนเจอ)
    const measure = ()=>{
      const s = stepsRef.current[i];
      const list = !s || !s.target ? [] : (Array.isArray(s.target) ? s.target : [s.target]);
      let found = null;
      for(const sel of list){
        const el = document.querySelector(sel);
        if(!el) continue;
        const r = el.getBoundingClientRect();
        // กล่องครอบที่ลูกเป็น absolute ทั้งหมดจะมีขนาด 0×0 — ส่องแล้วเห็นเป็นจุดจิ๋ว ข้ามไปหาตัวถัดไป
        if(r.width < 4 || r.height < 4) continue;
        found = r; break;
      }
      setRect(found);
    };
    measure();
    const iv = setInterval(measure, 250);
    window.addEventListener("resize", measure, true);
    window.addEventListener("scroll", measure, true);
    return ()=>{ clearInterval(iv); window.removeEventListener("resize",measure,true); window.removeEventListener("scroll",measure,true); };
  },[open,i]);

  // keyboard: Esc skips · ← → step through
  useEffect(()=>{
    if(!open) return;
    const h = e=>{
      const n = stepsRef.current.length;
      if(e.key==="Escape") onSkip && onSkip();
      else if(e.key==="ArrowRight"){ if(i>=n-1) onFinish&&onFinish(); else setI(x=>Math.min(x+1,n-1)); }
      else if(e.key==="ArrowLeft"){ if(i>0) setI(x=>x-1); }
    };
    window.addEventListener("keydown",h);
    return ()=>window.removeEventListener("keydown",h);
  },[open,i]);

  // ⚠ hook ทุกตัวต้องถูกเรียกก่อน early return เสมอ — ไม่งั้นจำนวน hook เปลี่ยนตอนปิดทัวร์
  //    แล้ว React พังทั้งหน้า (เคยทำหน้าเว็บขาวมาแล้ว)
  const cardRef = useRef(null);
  const [size, setSize] = useState({w:344, h:200});
  useEffect(()=>{
    if(!open) return;
    const el = cardRef.current; if(!el) return;
    const fit = ()=>{ const r = el.getBoundingClientRect();
      setSize(p => (Math.abs(p.w-r.width)<1 && Math.abs(p.h-r.height)<1) ? p : {w:r.width, h:r.height}); };
    fit();
    if(typeof ResizeObserver==="undefined") return;
    const ro = new ResizeObserver(fit); ro.observe(el); return ()=>ro.disconnect();
  },[open, i]);

  if(!open || !list.length) return null;

  const step = list[i];
  const first = i===0, last = i===list.length-1;
  const go = n => { setI(n); onChange && onChange(n); };
  const next = ()=> last ? (onFinish&&onFinish()) : go(i+1);
  const prev = ()=> !first && go(i-1);
  const pad = step.padding ?? 8;

  // spotlight box geometry (fixed-position, purely visual — does not affect layout)
  const spot = rect ? {left:rect.left-pad, top:rect.top-pad, width:rect.width+2*pad, height:rect.height+2*pad} : null;

  const pos = cardPos(rect, step.placement||"auto", size);

  return html`<div class="tour-root">
    <!-- click blocker: keeps the rest of the UI inactive while the tour runs -->
    <div class="tour-catch"></div>
    ${spot
      ? html`<div class="tour-spot" style=${{left:spot.left+"px",top:spot.top+"px",width:spot.width+"px",height:spot.height+"px"}}></div>`
      : html`<div class="tour-dim"></div>`}

    <div class=${"tour-pos arw-"+pos.place} style=${{left:pos.left+"px",top:pos.top+"px",transform:pos.transform}}>
      ${pos.place!=="center" && html`<span class="tour-arrow" style=${pos.arrowStyle}></span>`}
      <div class="tour-card" ref=${cardRef} key=${i}>
        <button class="tour-x" onClick=${onSkip} aria-label=${t("ข้าม", "Skip")}>✕</button>
        <div class="tour-count">${i+1} / ${list.length}</div>
        ${step.title && html`<h3 class="tour-title">${step.title}</h3>`}
        ${step.body && html`<div class="tour-body">${step.body}</div>`}
        <div class="tour-foot">
          <div class="tour-dots">${list.map((_,k)=>html`<span key=${k} class=${"tour-dot"+(k===i?" on":"")} onClick=${()=>go(k)}></span>`)}</div>
          <div class="tour-btns">
            ${!step.final && html`<button class="tour-link" onClick=${onSkip}>${t("ข้าม", "Skip")}</button>`}
            ${!first && !step.final && html`<button class="tour-btn ghost" onClick=${prev}>${t("ย้อนกลับ", "Back")}</button>`}
            ${last
              ? html`<button class="tour-btn primary" onClick=${()=>onFinish&&onFinish()}>${step.finishLabel||t("เสร็จสิ้น", "Done")}</button>`
              : html`<button class="tour-btn primary" onClick=${next}>${t("ถัดไป", "Next")}</button>`}
          </div>
        </div>
      </div>
    </div>
    <style>${CSS}</style>
  </div>`;
}

// Decide where the tooltip card sits relative to the highlighted rect, clamped
// to the viewport. Returns anchor left/top, the CSS transform that places the
// card, the resolved placement, and an arrow offset that keeps pointing at the target.
function cardPos(rect, placement, size){
  const m = 16;
  const W = (size && size.w) || 344;
  const H = (size && size.h) || 200;
  const vw = typeof window!=="undefined" ? window.innerWidth : 1440;
  const vh = typeof window!=="undefined" ? window.innerHeight : 900;
  if(!rect || placement==="center"){ return {left:vw/2, top:vh/2, transform:"translate(-50%,-50%)", place:"center", arrowStyle:{}}; }

  // เลือกด้านที่มีที่ว่างพอสำหรับ "ความสูงจริง" ของการ์ด ไม่ใช่ค่าคงที่
  let place = placement;
  const fitsBelow = rect.bottom + m + H + m <= vh;
  const fitsAbove = rect.top - m - H - m >= 0;
  const fitsRight = rect.right + m + W + m <= vw;
  if(place==="auto") place = fitsBelow ? "bottom" : fitsAbove ? "top" : fitsRight ? "right" : "left";
  // ด้านที่ระบุมาแต่ไม่มีที่พอ → พลิกไปด้านตรงข้ามแทนที่จะปล่อยให้ล้น
  else if(place==="bottom" && !fitsBelow && fitsAbove) place = "top";
  else if(place==="top" && !fitsAbove && fitsBelow) place = "bottom";
  else if(place==="right" && !fitsRight && rect.left - m - W - m >= 0) place = "left";
  else if(place==="left" && rect.left - m - W - m < 0 && fitsRight) place = "right";

  // มุมซ้ายบนของกล่องตามด้านที่เลือก แล้วดันทั้งใบให้อยู่ในจอ
  const tx = rect.left + rect.width/2, ty = rect.top + rect.height/2;
  let bx, by;
  if(place==="bottom"){ bx = tx - W/2; by = rect.bottom + m; }
  else if(place==="top"){ bx = tx - W/2; by = rect.top - m - H; }
  else if(place==="right"){ bx = rect.right + m; by = ty - H/2; }
  else { bx = rect.left - m - W; by = ty - H/2; }
  bx = clamp(bx, m, Math.max(m, vw - m - W));
  by = clamp(by, m, Math.max(m, vh - m - H));

  // หลังดันเข้าจอแล้วการ์ดอาจไปทับเป้าหมายเอง (เป้าหมายชิดขอบ/การ์ดกว้างกว่าที่ว่าง)
  // ลองด้านอื่นที่ไม่ทับ ถ้าไม่มีเลยก็ยอมทับ (ยังดีกว่าดันออกนอกจอ)
  const hits = (x,y) => !(x+W <= rect.left-4 || x >= rect.right+4 || y+H <= rect.top-4 || y >= rect.bottom+4);
  if (hits(bx,by)) {
    const tries = [
      ["bottom", tx - W/2, rect.bottom + m],
      ["top",    tx - W/2, rect.top - m - H],
      ["right",  rect.right + m, ty - H/2],
      ["left",   rect.left - m - W, ty - H/2],
    ];
    for (const [pl, x0, y0] of tries) {
      const x = clamp(x0, m, Math.max(m, vw - m - W)), y = clamp(y0, m, Math.max(m, vh - m - H));
      if (!hits(x,y)) { place = pl; bx = x; by = y; break; }
    }
  }

  // ลูกศรชี้กลับไปที่เป้าหมาย และต้องไม่เลยมุมโค้งของการ์ด
  const arrowStyle = (place==="bottom" || place==="top")
    ? { left: clamp(tx - bx, 18, W - 18) + "px", [place==="bottom" ? "top" : "bottom"]: "-6px" }
    : { top:  clamp(ty - by, 18, H - 18) + "px", [place==="right" ? "left" : "right"]: "-6px" };

  return {left:bx, top:by, transform:"none", place, arrowStyle};
}
const clamp = (v,a,b)=> Math.max(a, Math.min(v,b));

const CSS = `
.tour-root{position:fixed;inset:0;z-index:2400;font-family:var(--font);animation:tour-fade .3s ease}
.tour-catch{position:absolute;inset:0;cursor:default}
.tour-dim{position:absolute;inset:0;background:rgba(4,7,14,.72);pointer-events:none}
.tour-spot{position:fixed;border-radius:14px;pointer-events:none;
  box-shadow:0 0 0 9999px rgba(4,7,14,.72), 0 0 0 2px rgba(255, 59, 92,.9), 0 0 26px 4px rgba(255, 59, 92,.55);
  transition:left .38s cubic-bezier(.4,0,.2,1),top .38s cubic-bezier(.4,0,.2,1),width .38s cubic-bezier(.4,0,.2,1),height .38s cubic-bezier(.4,0,.2,1)}
.tour-pos{position:fixed;z-index:2}
.tour-arrow{position:absolute;width:12px;height:12px;background:var(--panel);border:1px solid var(--stroke2);transform:rotate(45deg)}
.arw-bottom .tour-arrow{border-right:none;border-bottom:none}
.arw-top .tour-arrow{border-left:none;border-top:none}
.arw-right .tour-arrow{border-top:none;border-right:none}
.arw-left .tour-arrow{border-bottom:none;border-left:none}
.tour-card{position:relative;width:344px;max-width:calc(100vw - 32px);max-height:calc(100vh - 32px);overflow-y:auto;
  padding:20px 20px 16px;border-radius:18px;
  background:var(--panel);border:1px solid var(--stroke2);box-shadow:0 24px 64px rgba(0,0,0,.55);
  backdrop-filter:blur(14px);animation:tour-in .32s cubic-bezier(.2,.9,.25,1)}
.tour-x{position:absolute;top:12px;right:12px;width:26px;height:26px;border:none;border-radius:8px;cursor:pointer;
  background:transparent;color:var(--muted);font-size:13px;transition:.15s}
.tour-x:hover{background:rgba(30,45,80,.07);color:var(--txt)}
.tour-count{font-size:12.5px;font-weight:700;letter-spacing:.6px;color:var(--accent2)}
.tour-title{font-size:16px;font-weight:700;line-height:1.45;color:var(--txt);margin:8px 0 8px;padding-right:22px}
.tour-body{font-size:13px;line-height:1.75;color:var(--muted);margin:0 0 16px}
.tour-foot{display:flex;align-items:center;justify-content:space-between;gap:12px}
.tour-dots{display:flex;gap:6px}
.tour-dot{width:6px;height:6px;border-radius:50%;background:var(--stroke2);cursor:pointer;transition:.2s}
.tour-dot.on{background:var(--accent2);width:18px;border-radius:3px}
.tour-btns{display:flex;align-items:center;gap:8px}
.tour-link{background:none;border:none;color:var(--dim);font-family:var(--font);font-size:12.5px;cursor:pointer;padding:6px 4px}
.tour-link:hover{color:var(--txt)}
.tour-btn{font-family:var(--font);font-size:12.5px;font-weight:600;cursor:pointer;border-radius:9px;padding:8px 14px;transition:.15s}
.tour-btn.ghost{background:transparent;border:1px solid var(--stroke2);color:var(--muted)}
.tour-btn.ghost:hover{color:var(--txt);border-color:rgba(120,160,220,.4)}
.tour-btn.primary{border:none;color:#fff;background:linear-gradient(135deg,#e60023,#e60023);box-shadow:0 6px 16px rgba(230, 0, 35,.4)}
.tour-btn.primary:hover{box-shadow:0 9px 22px rgba(230, 0, 35,.55)}
@keyframes tour-fade{from{opacity:0}to{opacity:1}}
@keyframes tour-in{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
@media (max-width:480px){.tour-card{width:calc(100vw - 32px)}}
`;

// Placeholder step so the framework is testable before the real content is authored.
// The actual multi-screen tour steps are added in a later task.
export const PLACEHOLDER_STEPS = [
  { placement:"center",
    get title(){ return t("ระบบแนะนำการใช้งานพร้อมทำงาน","Product tour is ready"); },
    get body(){ return t("นี่คือโครงของทัวร์แนะนำการใช้งาน เนื้อหาของแต่ละขั้นตอนจะถูกเพิ่มในลำดับถัดไป",
      "This is the tour framework — the content for each step will be added later."); } }
];
