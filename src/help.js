import {html, useState, useEffect, useRef, Icon} from "./lib.js";

// ── Contextual help — small one-time tips shown the first time a user touches a feature ──
// Persisted per user; each tip appears at most once and is dismissible.
const KEY = "geointel.tip";
function seenTip(email,k){ try{ return localStorage.getItem(`${KEY}.${email||"guest"}.${k}`)==="1"; }catch{ return false; } }
function markTip(email,k){ try{ localStorage.setItem(`${KEY}.${email||"guest"}.${k}`,"1"); }catch{} }

// Each feature → the selector that identifies it + the tip text. Order = priority
// (more specific first, so the heat row wins over the whole layer panel).
const TIPS = [
  { key:"heat",    sel:'[data-help="heat"]',   text:"แสดง Lead สูง — หมวดธุรกิจที่ยังขาดในพื้นที่" },
  { key:"layer",   sel:'[data-tour="layers"]', text:"ใช้เปิดหรือปิดข้อมูลบนแผนที่" },
  { key:"opp",     sel:'[data-help="opp"]',    text:"ดัชนี Lead สูงที่ระบบใช้จัดลำดับพื้นที่" },
  { key:"route",   sel:'[data-help="route"]',  text:"ใช้วางแผนการเดินทาง" },
  { key:"cluster", sel:'.geo-cluster',         text:"รวม Marker ที่อยู่ใกล้กัน" },
  { key:"marker",  sel:'.geo-mk',              text:"คลิกเพื่อดูรายละเอียดลูกค้า" },
];

export function HelpTips({user, disabled}){
  const [tip, setTip] = useState(null);   // { key, text, x, y, place }
  const shownRef = useRef(false);         // a tip is currently on screen
  const email = user && user.email;

  useEffect(()=>{
    if(disabled){ setTip(null); shownRef.current=false; return; }
    const onOver = e=>{
      if(shownRef.current) return;                       // one tip at a time
      const t = e.target && e.target.nodeType===1 ? matchTip(e.target) : null;
      if(!t || seenTip(email,t.key)) return;
      const el = e.target.closest(t.sel);
      if(!el) return;
      shownRef.current = true;
      markTip(email,t.key);                              // once per user, the moment it shows
      setTip(place(t, el.getBoundingClientRect()));
    };
    document.addEventListener("mouseover", onOver, true);
    return ()=>document.removeEventListener("mouseover", onOver, true);
  },[email, disabled]);

  const dismiss = ()=>{ setTip(null); shownRef.current=false; };
  // auto-hide after a while (still counts as seen); the user can dismiss sooner
  useEffect(()=>{ if(!tip) return; const t=setTimeout(dismiss, 7000); return ()=>clearTimeout(t); },[tip]);

  if(!tip) return null;
  return html`<div class=${"help-tip help-"+tip.place} style=${{left:tip.x+"px",top:tip.y+"px"}} role="status">
    <span class="help-ic"><${Icon} name="info" size=${13} color="#e60023"/></span>
    <span class="help-txt">${tip.text}</span>
    <button class="help-x" onClick=${dismiss} aria-label="ปิด">✕</button>
    <style>${CSS}</style>
  </div>`;
}

function matchTip(node){ for(const t of TIPS){ if(node.closest(t.sel)) return t; } return null; }

// Position the tip beside its anchor: wide panels → to the side, small marks → below/above.
function place(t, r){
  const W=248, m=12, vw=window.innerWidth, vh=window.innerHeight;
  let x, y, place;
  if(r.width>200){                                   // a panel — sit alongside it
    if(r.left > vw-r.right){ x=r.left-W-m; place="left"; } else { x=r.right+m; place="right"; }
    y=clamp(r.top, m, vh-90);
  } else {                                            // a marker / gauge — below, else above
    x=clamp(r.left+r.width/2-W/2, m, vw-W-m);
    if(r.bottom+70<vh){ y=r.bottom+m; place="bottom"; } else { y=r.top-70; place="top"; }
  }
  return {...t, x, y, place};
}
const clamp=(v,a,b)=>Math.max(a,Math.min(v,b));

const CSS = `
.help-tip{position:fixed;z-index:2200;width:248px;display:flex;align-items:flex-start;gap:9px;
  padding:11px 12px;border-radius:12px;font-family:var(--font);
  background:var(--panel);border:1px solid rgba(255, 59, 92,.4);
  box-shadow:0 14px 40px rgba(0,0,0,.5), 0 0 0 1px rgba(255, 59, 92,.1) inset;
  backdrop-filter:blur(14px);animation:help-in .26s cubic-bezier(.2,.9,.25,1)}
.help-ic{flex:none;width:22px;height:22px;border-radius:7px;display:grid;place-items:center;
  background:rgba(255, 59, 92,.14);margin-top:1px}
.help-txt{flex:1;font-size:12.5px;line-height:1.55;color:var(--txt)}
.help-x{flex:none;width:20px;height:20px;border:none;border-radius:6px;cursor:pointer;background:transparent;
  color:var(--muted);font-size:12.5px;transition:.15s}
.help-x:hover{background:rgba(30,45,80,.10);color:var(--txt)}
@keyframes help-in{from{opacity:0;transform:translateY(6px) scale(.97)}to{opacity:1;transform:none}}
`;
