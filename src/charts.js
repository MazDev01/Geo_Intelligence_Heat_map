import {html, cx, useRef, useEffect, useState} from "./lib.js";
import {createPortal} from "react-dom";   // portal tooltip ไป <body> เพื่อไม่ให้ .slide-panel (transform+overflow:hidden) ดึงตำแหน่ง fixed ให้เพี้ยน/ถูกตัด — tooltip จึงลอยบนสุดตรงเมาส์เสมอ
import {DONUT, LINE, EASE, prefersReducedMotion} from "./config/animation.js";

/* Dependency-free SVG charts, theme-aware */

// ── ฉีด keyframes + สไตล์ tooltip ครั้งเดียว (ใช้ร่วมกันทุกกราฟ) ──
if(typeof document!=="undefined" && !document.getElementById("chart-anim-css")){
  const st=document.createElement("style"); st.id="chart-anim-css";
  st.textContent=`
@keyframes donutDraw{to{stroke-dashoffset:0}}
@keyframes lineReveal{to{transform:scaleX(1)}}
@keyframes markPop{to{opacity:1;transform:scale(1)}}
.chart-tip{position:fixed;z-index:9999;pointer-events:none;background:var(--surface);border:1px solid var(--stroke2);
  border-radius:10px;padding:9px 11px;box-shadow:var(--shadow-lg,0 12px 34px rgba(0,0,0,.14));font-size:12px;min-width:120px;max-width:240px}
.chart-tip .ct-title{font-weight:800;color:var(--txt);margin-bottom:6px;font-size:12.5px}
.chart-tip .ct-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:2px 0;color:var(--muted)}
.chart-tip .ct-row i{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:6px;vertical-align:-1px}
.chart-tip .ct-row b{color:var(--txt);font-variant-numeric:tabular-nums}`;
  document.head.appendChild(st);
}
const nf = v => Number(v).toLocaleString("th-TH");

// ── Tooltip ร่วม (§3): ตามเมาส์ · offset 12px · flip เมื่อชนขอบขวา/ล่าง · pointer-events:none ──
export function ChartTip({state}){
  if(!state) return null;
  const {x,y,title,rows} = state;
  const fx = x > (typeof window!=="undefined"?window.innerWidth:1280)-240;   // ชนขอบขวา → พลิกไปซ้าย
  const fy = y > (typeof window!=="undefined"?window.innerHeight:800)-150;    // ชนขอบล่าง → พลิกขึ้นบน
  const style = { left:(fx?x-12:x+12)+"px", top:(fy?y-12:y+12)+"px",
    transform:`translate(${fx?"-100%":"0"},${fy?"-100%":"0"})` };
  const node = html`<div class="chart-tip" style=${style}>
    ${title?html`<div class="ct-title">${title}</div>`:""}
    ${(rows||[]).map((r,i)=>html`<div key=${i} class="ct-row">
      <span>${r.color?html`<i style=${{background:r.color}}></i>`:""}${r.label}</span><b>${r.value}</b></div>`)}
  </div>`;
  // portal ไป <body> — หลุดจาก stacking context/transform ของ .slide-panel จึงลอยบนสุดและอิงพิกัดเมาส์จริง
  return (typeof document!=="undefined") ? createPortal(node, document.body) : node;
}
export function useTip(){
  const [tip,setTip]=useState(null);
  const show=(e,title,rows)=>{ const t=(e&&e.touches&&e.touches[0])||e; setTip({x:t.clientX,y:t.clientY,title,rows}); };
  const hide=()=>setTip(null);
  return {tip,show,hide};
}

export function BarChart({data, height=180, color, horizontal, format=(v)=>v, tipTitle, tipRows}){
  // data: [{label, value, color?}] · tipTitle/tipRows (ไม่บังคับ) = เนื้อหา tooltip เมื่อ hover
  const {tip,show,hide}=useTip();
  const [hi,setHi]=useState(-1);
  const max = Math.max(1, ...data.map(d=>d.value));
  const hover=(e,d,i)=>{ setHi(i); if(tipRows) show(e, tipTitle?tipTitle(d,i):d.label, tipRows(d,i)); };
  const leave=()=>{ setHi(-1); hide(); };
  if(horizontal){
    // บรรทัดเดียว: ชื่อ | แท่งสีบางๆ (ไม่มี track เทา ยาวตามสัดส่วน = บอก %) | ตัวเลขอยู่นอกแท่งด้านขวา (มีที่ว่างคั่น)
    return html`<div style=${{display:"flex",flexDirection:"column",gap:"12px",position:"relative"}}>
      <${ChartTip} state=${tip}/>
      ${data.map((d,i)=>html`<div key=${i} style=${{display:"flex",alignItems:"center",gap:"12px",fontSize:"12.5px",cursor:tipRows?"pointer":"default"}}
        onMouseMove=${e=>hover(e,d,i)} onMouseLeave=${leave} ontouchstart=${e=>hover(e,d,i)}>
        <div style=${{width:"92px",color:"var(--muted)",flex:"none",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>${d.label}</div>
        <div style=${{flex:1,minWidth:0,display:"flex",alignItems:"center"}}>
          <div style=${{width:(d.value/max*100)+"%",height:"8px",borderRadius:"999px",flex:"none",
            background:d.color||color||"linear-gradient(90deg,#e60023,#ff3b5c)",transition:"width .5s,filter .15s",
            filter:hi===i?"brightness(1.08)":"none"}}></div>
        </div>
        <div style=${{flex:"none",color:"var(--txt)",whiteSpace:"nowrap",textAlign:"right",minWidth:"30px"}}>${format(d.value, d)}</div>
      </div>`)}
    </div>`;
  }
  const W=Math.max(data.length*46, 260), gap=14, bw=(W-gap*(data.length+1))/data.length;
  return html`<svg viewBox=${`0 0 ${W} ${height}`} width="100%" height=${height} preserveAspectRatio="none">
    ${[0,.25,.5,.75,1].map(t=>html`<line key=${t} x1="0" x2=${W} y1=${height-20-t*(height-30)} y2=${height-20-t*(height-30)} stroke="rgba(120,160,220,.09)"/>`)}
    ${data.map((d,i)=>{const h=(d.value/max)*(height-34);const x=gap+i*(bw+gap);
      return html`<g key=${i}>
        <rect x=${x} y=${height-20-h} width=${bw} height=${h} rx="5" fill=${d.color||color||"url(#barg)"}/>
        <text x=${x+bw/2} y=${height-6} text-anchor="middle" fill="var(--dim)" font-size="10">${d.label}</text>
        <text x=${x+bw/2} y=${height-26-h} text-anchor="middle" fill="var(--muted)" font-size="10" font-weight="700">${format(d.value)}</text>
      </g>`;})}
    <defs><linearGradient id="barg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff3b5c"/><stop offset="1" stop-color="#e60023"/></linearGradient></defs>
  </svg>`;
}

// ── โดนัท (§1): หมุนวาดทีละส่วนตามเข็มจาก 12 นาฬิกา + เลขกลางนับไต่ขึ้น + hover tooltip/ดัน arc ──
let donutSeq=0;
// จานสีแดงไล่เฉด (เข้ม→อ่อน) ตาม design system — ส่วนที่มีจำนวนมากได้สีเข้มสุด ไล่จางลงตามลำดับ
const DONUT_RED_RAMP=["#8a0014","#b30019","#e60023","#ff4d67","#ff8a9c","#ffbcc5"];
// rampRed(i,n): สีของอันดับ i (เริ่ม 0) จาก n รายการที่เรียงมาก→น้อยแล้ว — มากสุด=เข้มสุด
export const rampRed=(i,n)=> n<=1 ? "#e60023" : DONUT_RED_RAMP[Math.round(i*(DONUT_RED_RAMP.length-1)/(n-1))];
export function Donut({data, size=150, thickness=14, center, animate=true}){
  const total = data.reduce((a,d)=>a+d.value,0)||1;
  // เรียงจากมาก→น้อย แล้วไล่สีแดงเข้ม→อ่อน (มากสุด = เข้มสุด)
  const segs = [...data].sort((a,b)=>b.value-a.value).map((d,i,arr)=>({...d,color:rampRed(i,arr.length)}));
  const r=(size-thickness)/2, c=2*Math.PI*r;
  const reduce = prefersReducedMotion();
  const anim = animate && !reduce;
  const {tip,show,hide}=useTip();
  const [hi,setHi]=useState(-1);
  // count-up เลขกลางวง 0 → ค่าจริง (เล่นตอน mount — remount ผ่าน key จาก parent เมื่อ filter เปลี่ยน)
  const cval = center ? center.value : 0;
  const [cv,setCv]=useState(anim?0:cval);
  useEffect(()=>{ if(!center) return; if(!anim){ setCv(cval); return; }
    let raf; const t0=performance.now(); const dur=DONUT.duration; const ease=t=>1-Math.pow(1-t,3);
    const step=now=>{ const p=Math.min(1,(now-t0)/dur); setCv(cval*ease(p)); if(p<1) raf=requestAnimationFrame(step); else setCv(cval); };
    raf=requestAnimationFrame(step); return ()=>cancelAnimationFrame(raf);
  },[]);   // eslint-disable-line — จงใจ mount-only
  const cfmt = (center&&center.format)||(v=>Math.round(v));
  let off=0;
  const arcs=segs.map((d,i)=>{ const frac=d.value/total, dash=frac*c, startOff=off, startAngle=(startOff/c)*360; off+=dash;
    return {d,i,dash,startOff,startAngle}; });
  const hover=(e,a)=>{ setHi(a.i); show(e, a.d.label,
    [{label:"จำนวน",value:nf(a.d.value)+" ราย"},{label:"สัดส่วน",value:Math.round(a.d.value/total*100)+"%"}]); };
  return html`<div style=${{display:"flex",alignItems:"center",justifyContent:"center",gap:"18px",flexWrap:"wrap",position:"relative"}}>
    <${ChartTip} state=${tip}/>
    <svg width=${size} height=${size} viewBox=${`0 0 ${size} ${size}`} style=${{overflow:"visible"}}>
      <circle cx=${size/2} cy=${size/2} r=${r} fill="none" stroke="rgba(15,23,42,.06)" stroke-width=${thickness}/>
      ${arcs.map(a=>{
        // เว้นช่องว่างเล็ก ๆ ระหว่างส่วน (ตาม design-system) เมื่อมีมากกว่า 1 ส่วน
        const gap = segs.length>1 ? 6 : 0;
        const dd = Math.max(0.001, a.dash - gap);
        const drawStyle = anim
          ? {strokeDasharray:`${dd} ${c}`, strokeDashoffset:dd,
             animation:`donutDraw ${DONUT.duration}ms ${EASE} ${a.i*DONUT.stagger}ms forwards`}
          : {strokeDasharray:`${dd} ${c}`, strokeDashoffset:0};
        return html`<circle key=${a.i} cx=${size/2} cy=${size/2} r=${r} fill="none" stroke=${a.d.color}
          stroke-width=${hi===a.i?thickness+5:thickness}
          transform=${`rotate(${a.startAngle-90} ${size/2} ${size/2})`}
          style=${{...drawStyle, cursor:"pointer", transition:"stroke-width .15s"}}
          onMouseMove=${e=>hover(e,a)} onMouseLeave=${()=>{setHi(-1);hide();}} ontouchstart=${e=>hover(e,a)}/>`;
      })}
      ${center&&html`<text x=${size/2} y=${size/2-2} text-anchor="middle" fill="var(--txt)" font-size="22" font-weight="700">${cfmt(Math.round(cv))}</text>`}
      ${center&&html`<text x=${size/2} y=${size/2+16} text-anchor="middle" fill="var(--dim)" font-size="10">${center.label}</text>`}
    </svg>
    <div style=${{display:"flex",flexDirection:"column",gap:"8px",minWidth:"160px"}}>
      ${segs.map((d,i)=>html`<div key=${i} class="legend-row" style=${{cursor:"pointer",opacity:hi===-1||hi===i?1:.5,transition:"opacity .15s"}}
        onMouseMove=${e=>hover(e,{d,i})} onMouseLeave=${()=>{setHi(-1);hide();}}>
        <span class="dotc" style=${{background:d.color}}></span><span style=${{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>${d.label}</span>
        <b style=${{color:"var(--txt)",marginLeft:"10px",fontVariantNumeric:"tabular-nums"}}>${d.value}</b></div>`)}
    </div></div>`;
}

export function Gauge({value, size=120, label}){
  const r=52, c=Math.PI*r, v=Math.max(0,Math.min(100,value));
  const col = v>=85?"#33d69f":v>=70?"#ffb02e":"#ff5a5a";
  return html`<svg width=${size} height=${size*0.62} viewBox="0 0 120 74">
    <path d="M8 66 A52 52 0 0 1 112 66" fill="none" stroke="rgba(30,45,80,.10)" stroke-width="11" stroke-linecap="round"/>
    <path d="M8 66 A52 52 0 0 1 112 66" fill="none" stroke=${col} stroke-width="11" stroke-linecap="round"
      stroke-dasharray=${c} stroke-dashoffset=${c-(v/100)*c} style=${{transition:"stroke-dashoffset .6s"}}/>
    <text x="60" y="54" text-anchor="middle" fill="var(--txt)" font-size="26" font-weight="700">${Math.round(v)}</text>
    <text x="60" y="70" text-anchor="middle" fill="var(--dim)" font-size="9">${label||"/100"}</text>
  </svg>`;
}

// ── กราฟเส้น (§2): มีแกน X (ป้ายเดือน) · แกน Y (สเกลตัวเลข + เส้น grid) · legend (ผู้เรียกวางเอง) · crosshair tooltip ──
let lineSeq=0;
// ปัดเพดานแกน Y ให้เป็นเลขกลม เพื่อให้ป้ายสเกลอ่านง่าย (1/2/2.5/5/10 × 10^k)
const _niceMax = m => { if(m<=0) return 1; const p=Math.pow(10,Math.floor(Math.log10(m)));
  const n=m/p; const nice = n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10; return nice*p; };
export function LineChart({series, height=190, format=(v)=>v, labels=[], animate=true}){
  const ref = useRef(null);
  const [W, setW] = useState(560);
  useEffect(()=>{ const el=ref.current; if(!el) return;
    const upd=()=>{ const w=Math.round(el.clientWidth); if(w>0) setW(w); };
    upd(); const ro=new ResizeObserver(upd); ro.observe(el); return ()=>ro.disconnect();
  }, []);
  const reduce = prefersReducedMotion();
  const anim = animate && !reduce;
  const rtl = LINE.direction==="rtl";
  const fmt = format||(v=>v);
  const {tip,show,hide}=useTip();
  const [hx,setHx]=useState(-1);
  const uid = useRef(++lineSeq).current;
  const all = series.flatMap(s=>s.points);
  const rawMax=Math.max(1,...all), min=Math.min(0,...all), domMax=_niceMax(rawMax);
  const n=series[0].points.length;
  // padL เผื่อป้ายแกน Y · padB เผื่อป้ายเดือนแกน X (เฉพาะเมื่อส่ง labels มา)
  const padL=42, padR=14, padT=14, padB=labels.length?26:12;
  const plotW=Math.max(1,W-padL-padR), plotH=Math.max(1,height-padT-padB);
  const yBase=padT+plotH;
  const X=i=> n<=1 ? padL+plotW/2 : padL + i*(plotW/(n-1));
  const Y=v=> yBase - ((v-min)/((domMax-min)||1))*plotH;
  const ticks=[0,.25,.5,.75,1].map(t=>min+(domMax-min)*t);   // ป้าย/เส้น grid แกน Y (5 ระดับ)
  const onMove=e=>{ const box=e.currentTarget.getBoundingClientRect();
    const cx0=(e.touches&&e.touches[0]?e.touches[0].clientX:e.clientX)-box.left;
    const rx=cx0/box.width*W; let i = n<=1?0:Math.round((rx-padL)/(plotW/(n-1)));
    i=Math.max(0,Math.min(n-1,i)); setHx(i);
    const total=series.reduce((a,s)=>a+(s.points[i]||0),0);
    show(e, labels[i]||("จุดที่ "+(i+1)),
      [...series.map(s=>({label:s.label,color:s.color,value:fmt(Math.round(s.points[i]||0))})),
       {label:"รวม",value:fmt(Math.round(total))}]);
  };
  const onLeave=()=>{ setHx(-1); hide(); };
  return html`<div ref=${ref} style=${{width:"100%",position:"relative"}}>
    <${ChartTip} state=${tip}/>
    <svg viewBox=${`0 0 ${W} ${height}`} width="100%" height=${height} preserveAspectRatio="none"
      onMouseMove=${onMove} onMouseLeave=${onLeave} ontouchstart=${onMove} ontouchmove=${onMove}>
      <defs>
        <clipPath id=${"lcrev"+uid}>
          <rect x="0" y="0" width=${W} height=${height} style=${anim
            ? {transformBox:"fill-box",transformOrigin:rtl?"right":"left",transform:"scaleX(0)",animation:`lineReveal ${LINE.duration}ms ${EASE} forwards`}
            : {}}/>
        </clipPath>
        <!-- ไล่เฉดพื้นที่ใต้เส้น (ตาม design-system): เข้มใกล้เส้น → จางลงล่าง -->
        ${series.map((s,si)=>html`<linearGradient key=${"g"+si} id=${"lcg"+uid+"-"+si} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color=${s.color} stop-opacity="0.24"/>
          <stop offset="100%" stop-color=${s.color} stop-opacity="0"/>
        </linearGradient>`)}
      </defs>
      <!-- แกน Y: เส้น grid แนวนอน + ป้ายตัวเลขสเกล -->
      ${ticks.map((tv,ti)=>{ const yy=Y(tv);
        return html`<g key=${"t"+ti}>
          <line x1=${padL} x2=${W-padR} y1=${yy} y2=${yy} stroke="rgba(15,23,42,.09)" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>
          <text x=${padL-7} y=${yy+3} text-anchor="end" fill="var(--muted)" font-size="10">${fmt(Math.round(tv))}</text>
        </g>`; })}
      <!-- เส้นแกน X/Y -->
      <line x1=${padL} x2=${padL} y1=${padT} y2=${yBase} stroke="rgba(15,23,42,.16)" vector-effect="non-scaling-stroke"/>
      <line x1=${padL} x2=${W-padR} y1=${yBase} y2=${yBase} stroke="rgba(15,23,42,.16)" vector-effect="non-scaling-stroke"/>
      <!-- แกน X: ป้ายเดือน (พ.ศ.) -->
      ${labels.map((lb,i)=> i<n ? html`<text key=${"x"+i} x=${X(i)} y=${height-8} text-anchor="middle" fill="var(--muted)" font-size="10">${lb}</text>` : "")}
      ${hx>=0?html`<line x1=${X(hx)} x2=${X(hx)} y1=${padT} y2=${yBase} stroke="rgba(15,23,42,.32)" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>`:""}
      <g clip-path=${anim?`url(#lcrev${uid})`:undefined}>
        ${series.map((s,si)=>{const d=s.points.map((p,i)=>`${i?"L":"M"}${X(i)},${Y(p)}`).join(" ");
          return html`<g key=${si}>
            <path d=${`${d} L${X(n-1)},${yBase} L${X(0)},${yBase} Z`} fill=${`url(#lcg${uid}-${si})`}/>
            <path d=${d} fill="none" stroke=${s.color} stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
          </g>`;})}
      </g>
      ${series.map((s,si)=> s.points.map((p,i)=>{
        const order = rtl ? (n-1-i) : i;
        const delay = si*LINE.seriesStagger + order*LINE.markerStagger;
        const mstyle = anim ? {opacity:0,transformBox:"fill-box",transformOrigin:"center",transform:"scale(0)",
          animation:`markPop 300ms ${EASE} ${delay}ms forwards`} : {};
        return html`<circle key=${si+"-"+i} cx=${X(i)} cy=${Y(p)} r=${hx===i?5:3} fill=${s.color}
          stroke="#fff" stroke-width="1" vector-effect="non-scaling-stroke" style=${mstyle}/>`;
      }))}
    </svg>
  </div>`;
}

export function Sparkline({points, color="#ff3b5c", w=120, h=26}){
  const max=Math.max(...points), min=Math.min(...points);
  const d=points.map((p,i)=>`${i?"L":"M"}${i*(w/(points.length-1))},${h-2-((p-min)/(max-min||1))*(h-4)}`).join(" ");
  return html`<svg width=${w} height=${h} viewBox=${`0 0 ${w} ${h}`} preserveAspectRatio="none">
    <path d=${d} fill="none" stroke=${color} stroke-width="1.8"/>
    <path d=${`${d} L${w},${h} L0,${h} Z`} fill=${color} opacity="0.12"/></svg>`;
}
