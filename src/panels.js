import {html, useState, useEffect, useRef, Icon, SegmentIcon, num, pct, SEG_COLOR, SEGMENTS,
  segTH, gapTH, provinceTH, districtTH, fetchDrivingRoute} from "./lib.js";
import {basemap} from "./basemap.js";
import {Btn, Badge, Meter, toast} from "./ui.js";
import {Donut, BarChart, Gauge, rampRed} from "./charts.js";
import {analyzeArea, downloadCSV} from "./data.js";
import {demandGap, gapBySegment, GAP_REF, GAP_TH as GAP_LV_TH} from "./mock/geoData.js";
import {statusMeta, responsibleOf, nextAppointment, urgencyOf, beDate, INTEREST, OUTCOME, CANCEL_REASONS} from "./visit-rounds.js";

// คำอธิบายแบบภาษาชาวบ้านว่า "ตัวเลขนี้มาจากไหน" (ไม่โชว์น้ำหนักสูตร — เก็บไว้ในหน้าผู้ดูแล)
// ระดับช่องว่าง → โทนสีของ Badge
const gapTone = lv => lv==="High" ? "bad" : lv==="Medium" ? "warn" : "good";

/* Lead ของ "หมวดธุรกิจนี้ ในอำเภอนี้" — ใช้ในแผงรายละเอียด Lead
   ระบบไม่ให้คะแนนรายบริษัทแล้ว สิ่งที่บอกได้คือ หมวดของธุรกิจรายนี้ยังขาดอยู่แค่ไหนในย่านของเขา */
function segGapOf(db, rec){
  if(!db || !rec) return null;
  const inD = x => x.province===rec.province && x.district===rec.district;
  const cs=(db.customers||[]).filter(inD), ps=(db.prospects||[]).filter(inD);
  if(!cs.length && !ps.length) return null;
  const row = gapBySegment(cs, ps).find(x=>x.seg===rec.segment);
  const area = demandGap(cs, ps, GAP_REF.district);
  return row ? {...row, areaLevel:area.gapLevel, areaScore:area.gapScore, areaGapCount:area.gapCount} : null;
}

const L = window.L;
// derive Sales Owner + Sales History deterministically from the record (no extra API needed)
const OWNERS=["สมชาย กิตติ","ปรียา วงศ์","ณัฐพงษ์ ศรี","อรุณี ทองดี","David Chen","วิชัย มณี","กมลชนก พร"];
const hashOf=s=>{let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))|0;return Math.abs(h);};
const salesOwner=c=>OWNERS[hashOf(c.id)%OWNERS.length];
// (เดิมมี salesHistory() สร้างประวัติการซื้อขายจำลอง — ถอดออกแล้ว
//  ข้อมูลลูกค้าจริงจาก Barter ไม่มียอดขาย/ประวัติการซื้อ จึงไม่แต่งตัวเลขขึ้นมาแสดง)
// ── ข้อมูลติดต่อของลูกค้า = ฟิลด์จริงจากไฟล์ Barter (โทรศัพท์ · เว็บไซต์ · เฟซบุ๊ก) ──
//    ไม่มีการสร้างเบอร์/เว็บไซต์ตัวอย่างอีกแล้ว — ถ้าไฟล์ไม่มีค่า จะแสดง "ไม่มีข้อมูล"
// tel: ใช้รูปแบบสากล +66 (ตัดเลข 0 ตัวหน้าออก) เพื่อให้กดโทรออกได้บนมือถือ/แท็บเล็ต
//    เบอร์ในไฟล์บางรายมีหลายเบอร์คั่นด้วย , → ใช้เบอร์แรกเป็นลิงก์โทรออก
const telHref = s => "tel:+66"+String(s).split(",")[0].replace(/[^0-9]/g,"").replace(/^0/,"");
// เว็บไซต์/เฟซบุ๊กในไฟล์มีทั้งแบบมีและไม่มี https:// → เติมให้เป็นลิงก์ที่กดได้เสมอ
const extHref = u => /^https?:\/\//i.test(String(u)) ? String(u) : "https://"+String(u);
// วันที่เริ่มเป็นลูกค้า (ISO) → พ.ศ. แบบไทย · และจำนวนปีที่เป็นลูกค้ามาแล้ว
const yearsWith = iso => { const d = new Date(iso); if(isNaN(d)) return null;
  const y = Math.floor((Date.now()-d.getTime())/(365.25*864e5)); return y>0 ? y : null; };
// ที่อยู่เต็ม ประกอบจากฟิลด์จริงที่มีอยู่ (ที่อยู่ + อำเภอ/เขต + จังหวัด) ไม่ได้แต่งขึ้นใหม่
const fullAddress = c => [c.address, c.district?districtTH(c.district):"", provinceTH(c.province)].filter(Boolean).join(" · ");
// สไตล์เฉพาะส่วน "ข้อมูลการติดต่อ" ของ panel ลูกค้าปัจจุบัน
const CUST_CSS = `
.cd-item{display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-bottom:1px solid var(--stroke);
  text-decoration:none;color:var(--txt)}
a.cd-item:hover .cd-v{color:var(--accent)}
.cd-tx{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.cd-k{font-size:11px;color:var(--muted)}
.cd-v{font-size:12.5px;font-weight:600;word-break:break-word}
.cd-nav{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:11px;padding:10px;
  border-radius:11px;text-decoration:none;font-family:var(--font);font-size:12.5px;font-weight:700;
  color:var(--accent-deep);background:var(--accent-soft);border:1px solid var(--accent)}
.cd-nav:hover{background:var(--accent);color:#fff}
.cd-note{margin-top:9px;font-size:10.5px;line-height:1.5;color:var(--muted)}`;

// คำแนะนำอิง Lead ของหมวด/พื้นที่ ไม่ใช่คะแนนรายบริษัท
function recommendation(c, segGap){
  if(c.status==="Prospect"){
    const g = segGap ? segGap.gap : 0;
    return g>=6 ? `เร่งติดต่อ — หมวด${segTH(c.segment)}ในย่านนี้ยังขาดอีก ${g} ราย`
      : g>=1 ? `ควรนัดหมายเข้าพบ — หมวด${segTH(c.segment)}ในย่านนี้ยังขาดอีก ${g} ราย`
      : `หมวด${segTH(c.segment)}ในย่านนี้มีสมาชิกครบแล้ว — ติดตามในรอบถัดไป`;
  }
  // ลูกค้าปัจจุบัน: ข้อมูลจริงไม่มียอดขาย/สถานะการค้า จึงแนะนำจากสิ่งที่รู้จริง — อายุการเป็นลูกค้า และ TC ที่ดูแล
  const yrs = yearsWith(c.dateJoin);
  if(!c.tc_owner) return `ยังไม่มี TC ดูแลพื้นที่${provinceTH(c.province)} — ควรมอบหมายผู้รับผิดชอบก่อน`;
  return yrs!=null && yrs>=10 ? `ลูกค้าเก่าแก่ ${yrs} ปี — รักษาความสัมพันธ์และเสนอบริการเพิ่มเติม`
    : yrs!=null && yrs>=3 ? `เป็นลูกค้ามาแล้ว ${yrs} ปี — ติดตามต่อเนื่องและขยายการใช้บริการ`
    : "ลูกค้าใหม่ — ควรเข้าพบเพื่อสร้างความสัมพันธ์ในช่วงแรก";
}
const DRAWER_RIGHT = {position:"absolute",top:0,right:0,bottom:0,width:"440px",maxWidth:"94vw",zIndex:800,
  background:"var(--surface)",borderLeft:"1px solid var(--stroke2)",boxShadow:"-24px 0 70px rgba(0,0,0,.55)",
  overflowY:"auto",backdropFilter:"blur(4px)"};
const DRAWER_LEFT = {position:"absolute",top:0,left:0,bottom:0,width:"440px",maxWidth:"94vw",zIndex:800,
  background:"var(--surface)",borderRight:"1px solid var(--stroke2)",boxShadow:"24px 0 70px rgba(0,0,0,.55)",
  overflowY:"auto",backdropFilter:"blur(4px)"};
const HEAD = {position:"sticky",top:0,zIndex:2,padding:"18px 20px 16px",borderBottom:"1px solid var(--stroke)",
  background:"var(--surface)",backdropFilter:"blur(10px)"};

// Stand-in for a real photo (the dataset has none): the business-category emoji on a tint of that
// category's own colour.
function HeroBanner({segment, tone}){
  return html`<div style=${{height:"160px",display:"grid",placeItems:"center",
    background:`linear-gradient(160deg, ${tone}22, ${tone}0a)`,borderBottom:"1px solid var(--stroke)"}}>
    <${SegmentIcon} seg=${segment} size=${64} color=${tone} stroke=${1.6}/>
  </div>`;
}

function DrawerShell({eyebrow, title, sub, onClose, children, dataTour, heroSegment, heroTone, side="right", topOffset=16}){
  const isLeft = side==="left";
  const isTopRight = side==="topright";
  // มุมมองใหม่: การ์ดลอยมุมขวาบน (แทน drawer เต็มความสูง) — วางไว้ครึ่งบนของฝั่งขวา เว้นครึ่งล่างให้ Layer Panel
  const style = isTopRight
    // drawer เต็มความสูง ชิดขอบขวา — ใช้สไตล์เดียวทั้งลูกค้า/Lead, ทับ (overlay) ไอคอนเลเยอร์ + ปุ่มแผนการเข้าพบ (z สูงกว่า)
    ? {position:"absolute", top:0, right:0, bottom:0, width:"340px", maxWidth:"94vw",
       zIndex:900, background:"var(--surface)", borderLeft:"1px solid var(--stroke2)",
       boxShadow:"-24px 0 70px rgba(0,0,0,.5)", overflowY:"auto", backdropFilter:"blur(6px)"}
    : (isLeft?DRAWER_LEFT:DRAWER_RIGHT);
  return html`<aside class=${isLeft?"slide-panel-left":"slide-panel"} data-tour=${dataTour} style=${style}>
    ${isLeft && heroTone && html`<${HeroBanner} segment=${heroSegment} tone=${heroTone}/>`}
    <div style=${HEAD}>
      <div class="row between" style=${{alignItems:"flex-start"}}>
        <div class="row" style=${{gap:"11px",minWidth:0,alignItems:isTopRight?"center":"flex-start"}}>
          ${isTopRight && heroTone && html`<div style=${{width:"42px",height:"42px",flex:"none",borderRadius:"11px",display:"grid",placeItems:"center",background:heroTone+"22",border:"1px solid "+heroTone+"44"}}><${SegmentIcon} seg=${heroSegment} size=${22} color=${heroTone}/></div>`}
          <div style=${{minWidth:0}}>
            <div class="eyebrow">${eyebrow}</div>
            <h2 style=${{margin:"4px 0 0",fontSize:"20px"}}>${title}</h2>
            ${sub&&html`<div class="sub" style=${{marginTop:"3px"}}>${sub}</div>`}
          </div>
        </div>
        <button class="icon-btn" style=${{width:"30px",height:"30px",flex:"none"}} onClick=${onClose}><${Icon} name="close" size=${15}/></button>
      </div>
    </div>
    <div style=${{padding:"18px 20px 28px"}}>${children}</div>
  </aside>`;
}

const miniKpi = (k,v,color)=>html`<div style=${{background:"rgba(30,45,80,.05)",border:"1px solid var(--stroke)",
  borderRadius:"12px",padding:"12px 13px"}}>
  <div class="kk" style=${{fontSize:"11.5px"}}>${k}</div>
  <div class="kv tnum" style=${{fontSize:"22px",color:color||"var(--txt)"}}>${v}</div></div>`;

/* ============ AREA DRAWER ============ */
export function AreaPanel({db, filters, province, onClose, onReport, onOpenCustomer}){
  const a = analyzeArea(db, province, filters);
  // แสดงเฉพาะ 5 หมวดธุรกิจที่มีจำนวนมากที่สุด เรียงจากมาก→น้อย
  const segTop5 = [...a.segMix].sort((x,y)=>y.total-x.total).slice(0,5);
  const donut = segTop5.map(m=>({label:segTH(m.seg), value:m.total, color:SEG_COLOR[m.seg]}));
  const recs = [
    a.topGapSegment
      ? `หมวดที่ยังขาดมากที่สุดคือ${segTH(a.topGapSegment)} — ยังขาดอีก ${num((a.gapSegs[0]||{}).gap||0)} ราย ควรเติมก่อน`
      : `ทุกหมวดในพื้นที่นี้มีสมาชิกเครือข่ายครบแล้ว — เน้นรักษาสมาชิก ${num(a.customerCount)} ราย`,
    a.gapLevel==="High" ? `Lead ระดับสูง (ดัชนี ${a.gapScore}) — ขาดรวม ${num(a.gapCount)} ราย ใน ${a.gapBreadth} หมวด ควรจัดทีมเข้าเติมอย่างน้อย ${Math.max(2,Math.round(a.gapCount/120))} คน`
      : a.gapLevel==="Medium" ? `Lead ปานกลาง (ดัชนี ${a.gapScore}) — ยังเติมได้อีก ${num(a.gapCount)} ราย`
      : `Lead ต่ำ (ดัชนี ${a.gapScore}) — เครือข่ายในพื้นที่นี้ค่อนข้างครบ เน้นรักษาสมาชิกเดิม`,
    `ความครอบคลุมปัจจุบัน ${a.coverage}% — เติมหมวดที่ขาดให้ครบจะดันความครอบคลุมขึ้นได้อีก ~${Math.min(100-a.coverage, Math.round(a.gapCount/Math.max(1,a.customerCount+a.prospectCount)*100))}%`,
  ];
  return html`<${DrawerShell} eyebrow=${"วิเคราะห์พื้นที่"+(a.center?` · ${a.center[1].toFixed(2)}°N, ${a.center[0].toFixed(2)}°E`:"")}
    title=${provinceTH(province)} sub=${`${num(a.customerCount+a.prospectCount)} ธุรกิจ · วิเคราะห์ Lead สูง`} onClose=${onClose}>

    <div style=${{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px",marginBottom:"16px"}}>
      ${miniKpi("สมาชิกเครือข่าย", num(a.customerCount))}
      ${miniKpi("Lead", num(a.prospectCount), "#0369a1")}
      ${miniKpi("Lead", a.gapScore+"/100", "#b45309")}
      ${miniKpi("ยังขาด (ราย)", num(a.gapCount), "#6d28d9")}
    </div>
    <div class="row" style=${{gap:"8px",marginBottom:"14px",flexWrap:"wrap"}}>
      <${Badge} tone=${gapTone(a.gapLevel)}>Lead${GAP_LV_TH[a.gapLevel]}</${Badge}>
      <span class="dim" style=${{fontSize:"12px"}}>ความครอบคลุม ${pct(a.coverage)} · ขาด ${a.gapBreadth} หมวด</span>
    </div>

    <div class="sec-label">กลุ่มธุรกิจ · 5 อันดับแรก</div>
    <${Donut} data=${donut} size=${132} center=${{value:a.customerCount+a.prospectCount, label:"รวม"}}/>
    <div style=${{height:"14px"}}></div>
    <${BarChart} horizontal=${true} data=${segTop5.map((m,i)=>({label:segTH(m.seg),value:m.total,color:rampRed(i,segTop5.length)}))} format=${num}/>

    <div class="sec-label">คำแนะนำ</div>
    ${recs.map((r,i)=>html`<div key=${i} class="row" style=${{gap:"9px",alignItems:"flex-start",marginBottom:"9px"}}>
      <div style=${{width:"20px",height:"20px",borderRadius:"6px",flex:"none",display:"grid",placeItems:"center",background:"rgba(51,214,159,.15)"}}>
        <${Icon} name="check" size=${12} color="#33d69f"/></div>
      <div style=${{fontSize:"12.5px",lineHeight:1.5}}>${r}</div></div>`)}

    <div class="sec-label">หมวดที่ยังขาดในพื้นที่นี้</div>
    ${a.gapSegs.length ? a.gapSegs.map(g=>html`<div key=${g.seg} class="row"
      style=${{gap:"11px",padding:"9px 0",borderBottom:"1px solid var(--stroke)"}}>
      <${SegmentIcon} seg=${g.seg} size=${18} color=${SEG_COLOR[g.seg]}/>
      <div style=${{flex:1,minWidth:0}}><div style=${{fontSize:"12.5px",fontWeight:600}}>${segTH(g.seg)}</div>
        <div class="dim" style=${{fontSize:"11.5px"}}>อุปสงค์ ${num(g.demand)} · มีสมาชิกแล้ว ${num(g.supply)}</div></div>
      <b style=${{color:"var(--txt)"}}>ขาด ${num(g.gap)}</b></div>`)
      : html`<div class="dim" style=${{fontSize:"12.5px",padding:"8px 0"}}>ไม่มีหมวดที่ขาดในพื้นที่นี้</div>`}

    <div class="sec-label">Lead ในหมวดที่ขาดมากที่สุด</div>
    ${a.topProspects.map((p,i)=>html`<div key=${p.id} class="row" onClick=${()=>onOpenCustomer(p)}
      style=${{gap:"11px",padding:"9px 0",borderBottom:"1px solid var(--stroke)",cursor:"pointer"}}>
      <b class="dim" style=${{width:"18px"}}>${i+1}</b>
      <div style=${{flex:1,minWidth:0}}><div style=${{fontSize:"12.5px",fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>${p.businessName}</div>
        <div class="dim" style=${{fontSize:"12.5px"}}>${segTH(p.category||p.segment)}${p.district?" · "+districtTH(p.district):""}</div></div>
      <${Badge} tone="warn">ขาด ${num(p.segGap||0)}</${Badge}></div>`)}

    ${/* report link shown only when a report handler is supplied (Admin). Field roles (Management/TC) reach
         reports from the topbar button instead, so this area-panel link is omitted for them. */
      onReport && html`<div class="row" style=${{gap:"9px",marginTop:"18px"}}>
      <${Btn} variant="primary" icon="reports" onClick=${()=>onReport(province)}>ดูรายงานพื้นที่นี้</${Btn}>
    </div>`}
  </${DrawerShell}>`;
}

/* ============ CUSTOMER DRAWER ============ */
const hav=(a,b)=>{const R=6371,dLat=(b.latitude-a.latitude)*Math.PI/180,dLng=(b.longitude-a.longitude)*Math.PI/180;
  const s=Math.sin(dLat/2)**2+Math.cos(a.latitude*Math.PI/180)*Math.cos(b.latitude*Math.PI/180)*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(s));};
function buildRoute(origin,pool){ const near=pool.map(p=>({...p,d:hav(origin,p)})).sort((a,b)=>a.d-b.d).slice(0,6);
  const stops=[];let cur=origin,total=0;const rem=[...near];
  while(rem.length){rem.sort((a,b)=>hav(cur,a)-hav(cur,b));const n=rem.shift();const leg=hav(cur,n);total+=leg;stops.push({...n,leg});cur=n;}
  return {stops,total}; }

// Individual customer report rows (used by the PDF/Excel/CSV exports in the detail panel).
function custReportRows(c, segGap){
  const isCust = c.status==="Existing";
  const rows = [["รายงานลูกค้า GeoIntel", c.businessName], ["รหัสลูกค้า", c.accountNo||c.id],
    ["สถานะ", isCust?"ลูกค้าปัจจุบัน":"Lead"],
    ["หมวดธุรกิจ", segTH(c.segment)], ["จังหวัด", provinceTH(c.province)],
    ["อำเภอ / เขต", c.district?districtTH(c.district):"-"], ["ที่อยู่", c.address||"-"],
    ["ละติจูด", c.latitude.toFixed(6)], ["ลองจิจูด", c.longitude.toFixed(6)],
    ["คำแนะนำ", recommendation(c, segGap)]];
  if(isCust){
    // ฟิลด์ตามไฟล์ข้อมูลลูกค้าจริง (ไม่รวมคอลัมน์ "สถานะ" ท้ายไฟล์)
    rows.push(["เบอร์โทรศัพท์", c.phone||"-"], ["เว็บไซต์", c.website||"-"], ["เฟซบุ๊ก", c.facebook||"-"],
      ["วันที่เริ่มเป็นลูกค้า", c.dateJoin||"-"], ["ผู้ประสานงานการค้า (TC)", c.tc_owner||"ยังไม่มีผู้ดูแล"]);
  } else if(segGap){
    rows.push(["อีเมล", c.email||"-"]);
    rows.push(["หมวดที่ยังขาดในย่านนี้", segTH(c.segment)+" — ขาด "+segGap.gap+" ราย"],
      ["อุปสงค์ในหมวดนี้ (ราย)", segGap.demand], ["สมาชิกเครือข่ายในหมวดนี้ (ราย)", segGap.supply],
      ["ดัชนี Lead ของย่าน", segGap.areaScore+" ("+GAP_LV_TH[segGap.areaLevel]+")"]);
  }
  return rows;
}
function downloadXLS(filename, rows){   // Excel-openable spreadsheet (ms-excel HTML table)
  const esc = s => String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const body = rows.map(r=>"<tr>"+(r.length?r.map(c=>`<td>${esc(c)}</td>`).join(""):"<td></td>")+"</tr>").join("");
  const doc = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table border="1">${body}</table></body></html>`;
  const url = URL.createObjectURL(new Blob(["﻿"+doc], {type:"application/vnd.ms-excel"}));
  const a = document.createElement("a"); a.href=url; a.download=filename; a.click(); URL.revokeObjectURL(url);
}

export function CustomerPanel({db, customer, onClose, onOpenArea, setCustomer, onAddToPlan, inPlan, topOffset, canEditOwn, onSetVisit, onEditRecord, onDeleteRecord, onAddRound, user, onSubmitDeal, dealPlan, onCancelVisit}){
  const [added,setAdded]=useState(false);
  const [roundForm,setRoundForm]=useState(null);   // {kind:'visit'|'appt'|'cancel', interest, outcome, apptDate, reason, note}
  const [openR,setOpenR]=useState(0);               // index รอบที่กาง (0 = ล่าสุด)
  const [dealDoc,setDealDoc]=useState("");          // ชื่อไฟล์เอกสารปิดดีลที่แนบ (โหมดปิดดีล)
  const [confirmSend,setConfirmSend]=useState(false); // ป็อปอัพยืนยันส่งดีล
  const c = customer;
  const segGap = c && c.status!=="Existing" ? segGapOf(db, c) : null;   // Lead ของหมวดนี้ในอำเภอนี้
  const isCust = c.status==="Existing";
  const isTC = !!(user && user.role === "Trade Coordinator");   // เฉพาะ TC เท่านั้นที่ "เพิ่มเข้าพบ/ส่งดีล" ได้ — แอดมิน/ผู้บริหารเห็นสถานะ+ผู้เข้าพบแบบอ่านอย่างเดียว
  // โหมดปิดดีล = Lead ถูกยืนยันเข้าแผนแล้วหรือส่งดีลไปแล้ว → แผงโฟกัสที่การเข้าพบอย่างเดียว
  // ไม่แสดงรายละเอียด Lead (รหัส/ชื่อ/หมวด/ที่อยู่/อีเมล) และกล่องคำแนะนำ เพราะ TC ตัดสินใจไปแล้ว
  const dealMode = !isCust && (!!dealPlan || c.dealStatus==="pending");
  const rounds = (c.visitRounds||[]);
  const row=(k,v)=>html`<div class="row between" style=${{padding:"10px 0",borderBottom:"1px solid var(--stroke)",fontSize:"12.5px"}}>
    <span class="muted">${k}</span><span style=${{fontWeight:600,textAlign:"right"}}>${v}</span></div>`;

  return html`<${DrawerShell} dataTour="detail" eyebrow=${isCust?"ลูกค้า":"Lead"} title=${c.businessName}
    sub=${`${segTH(c.segment)} · ${provinceTH(c.province)}`} onClose=${onClose}
    side="topright" topOffset=${topOffset} heroSegment=${c.segment} heroTone=${SEG_COLOR[c.segment]}>

    <!-- ไม่มีแถบสรุปด้านบนของแผงแล้ว — ทั้งลูกค้าและ Lead เข้าเนื้อหาเลย
         (ปีที่เริ่มเป็นลูกค้าอยู่ในตารางรายละเอียดด้านล่างอยู่แล้ว จึงไม่ต้องมีกล่องซ้ำ) -->

    <!-- โฟลว์ปิดดีลLead (2 สถานะ) —
         A) ยังไม่ถูกบันทึกในแผนที่ยืนยันแล้ว → โชว์เฉพาะปุ่ม "เพิ่มในแผนการเข้าพบ" (ไม่แสดงผู้รับผิดชอบ/บันทึกผลเข้าพบ/นัดหมาย/ยกเลิก)
         B) TC เพิ่มเข้าแผน + กด "บันทึกแผนนี้" แล้ว → โชว์ผู้เข้าพบ + วันนัด(จากแผน) + แนบเอกสาร + ส่งดีลสำเร็จ → เข้าคิวรอแอดมินอนุมัติ -->
    ${!isCust && (()=>{
      const confirmed = !!dealPlan;                  // อยู่ในแผนที่บันทึก(ยืนยัน)แล้ว
      const submitted = c.dealStatus==="pending";    // ส่งดีลแล้ว รออนุมัติ
      // ── สถานะ A: ยังไม่ยืนยันเข้าแผน → ปุ่ม/สถานะแผนย้ายไปไว้ท้ายรายละเอียด (เหนือกล่องคำแนะนำ) ──
      if(!confirmed && !submitted) return "";
      // ── สถานะ B: ยืนยันเข้าแผนแล้ว → โหมดปิดดีล ──
      return html`
        <div class="sec-label" style=${{marginTop:"16px"}}>ปิดดีลการขาย</div>
        <div class="deal-box">
          <div class="deal-row"><span class="muted">ผู้เข้าพบ</span><b>${(dealPlan&&dealPlan.visitor)||(user&&user.name)||"—"}</b></div>
          <div class="deal-row"><span class="muted">วันที่นัดหมาย</span><b>${dealPlan&&dealPlan.visitDate?beDate(dealPlan.visitDate):(c.dealVisitDate?beDate(c.dealVisitDate):"—")}</b></div>
          ${dealPlan&&dealPlan.planName? html`<div class="deal-row"><span class="muted">จากแผน</span><span>${dealPlan.planName}</span></div>`:""}
        </div>
        ${submitted
          ? html`<div class="deal-note pending"><${Icon} name="clock" size=${15} color="#f59e0b"/>ส่งดีลแล้ว — รอแอดมินตรวจสอบอนุมัติ${c.dealDoc?" · แนบ: "+c.dealDoc:""}</div>`
          : (isTC
            ? html`<div style=${{display:"flex",flexDirection:"column",gap:"9px",marginTop:"10px"}}>
              <label class="deal-attach">
                <input type="file" style=${{display:"none"}} onChange=${e=>{ const f=e.target.files&&e.target.files[0]; if(f) setDealDoc(f.name); }}/>
                <${Icon} name="upload" size=${15} color=${dealDoc?"#33d69f":"var(--muted)"}/>
                <span>${dealDoc||"แนบเอกสารปิดดีล"}</span>
              </label>
              <button class="deal-submit" onClick=${()=>setConfirmSend(true)}>
                <${Icon} name="check" size=${15} color="#fff"/>ส่งสถานะว่าดีลสำเร็จแล้ว</button>
              <button class="deal-cancel" onClick=${()=>setRoundForm({kind:"cancel", reason:CANCEL_REASONS[0], note:""})}>
                <${Icon} name="close" size=${14}/>ยกเลิกการเข้าพบ</button>
            </div>`
            : html`<div class="deal-note info" style=${{marginTop:"10px"}}><${Icon} name="clock" size=${15} color="#0369a1"/>อยู่ระหว่างดำเนินการโดยผู้ประสานงานการค้า — ยังไม่ได้ส่งดีล</div>`)}
        ${roundForm&&roundForm.kind==="cancel" ? html`<div class="deal-modal-back" onClick=${()=>setRoundForm(null)}>
          <div class="deal-modal" onClick=${e=>e.stopPropagation()}>
            <div class="deal-modal-t">ยกเลิกการเข้าพบ</div>
            <div class="deal-modal-b">ปล่อย "${c.businessName}" ออกจากแผนของคุณ · เหตุผลจะถูกบันทึกไว้ในประวัติ ให้ TC คนอื่นเห็นและรับไปนัดต่อได้</div>
            <div class="vr-f" style=${{marginTop:"12px"}}>เหตุผล
              <select value=${roundForm.reason} onChange=${e=>setRoundForm(f=>({...f, reason:e.target.value}))}>
                ${CANCEL_REASONS.map(r=>html`<option key=${r} value=${r}>${r}</option>`)}</select></div>
            <div class="vr-f" style=${{marginTop:"9px"}}>หมายเหตุเพิ่มเติม (ไม่บังคับ)
              <input value=${roundForm.note} placeholder="เช่น ขอให้ติดต่อใหม่เดือนหน้า"
                onInput=${e=>setRoundForm(f=>({...f, note:e.target.value}))}/></div>
            <div class="row" style=${{gap:"8px",justifyContent:"flex-end",marginTop:"14px"}}>
              <${Btn} variant="ghost" size="sm" onClick=${()=>setRoundForm(null)}>ปิด</${Btn}>
              <${Btn} variant="danger" size="sm" onClick=${()=>{ onCancelVisit&&onCancelVisit(c, roundForm.reason, roundForm.note);
                setRoundForm(null); setAdded(false); toast("ยกเลิกการเข้าพบแล้ว — บันทึกเหตุผลไว้ในประวัติ","warn"); onClose&&onClose(); }}>ยืนยันยกเลิก</${Btn}>
            </div>
          </div>
        </div>`:""}
        ${confirmSend? html`<div class="deal-modal-back" onClick=${()=>setConfirmSend(false)}>
          <div class="deal-modal" onClick=${e=>e.stopPropagation()}>
            <div class="deal-modal-t">ยืนยันส่งดีล</div>
            <div class="deal-modal-b">ส่งดีลของ "${c.businessName}" ให้แอดมินตรวจสอบเพื่ออนุมัติเปลี่ยนเป็นลูกค้า?${dealDoc?"":" (ยังไม่ได้แนบเอกสาร)"}</div>
            <div class="row" style=${{gap:"8px",justifyContent:"flex-end",marginTop:"14px"}}>
              <${Btn} variant="ghost" size="sm" onClick=${()=>setConfirmSend(false)}>ยกเลิก</${Btn}>
              <${Btn} variant="primary" size="sm" onClick=${()=>{ onSubmitDeal&&onSubmitDeal(c, dealDoc); setConfirmSend(false); }}>ยืนยันส่ง</${Btn}>
            </div>
          </div>
        </div>`:""}`;
    })()}

    <!-- ลูกค้าปัจจุบันไม่มีปุ่ม "เพิ่มในแผนการเข้าพบ" แล้ว — แผนการเข้าพบใช้กับ Lead เท่านั้น -->

    ${canEditOwn && html`<div style=${{display:"flex",gap:"9px",marginBottom:"16px"}}>
      <button onClick=${()=>onEditRecord&&onEditRecord(c)} style=${{flex:1,display:"inline-flex",alignItems:"center",justifyContent:"center",gap:"7px",
        padding:"11px",borderRadius:"11px",border:"1px solid var(--stroke2)",background:"transparent",color:"var(--txt)",cursor:"pointer",fontFamily:"var(--font)",fontSize:"13px",fontWeight:600}}>
        <${Icon} name="edit" size=${14}/>แก้ไข</button>
      <button onClick=${()=>{ if(confirm('ลบรายการ "'+c.businessName+'" ?')) onDeleteRecord&&onDeleteRecord(c); }} style=${{flex:1,display:"inline-flex",alignItems:"center",justifyContent:"center",gap:"7px",
        padding:"11px",borderRadius:"11px",border:"1px solid rgba(255,90,90,.35)",background:"rgba(255,90,90,.08)",color:"#ff5a5a",cursor:"pointer",fontFamily:"var(--font)",fontSize:"13px",fontWeight:600}}>
        <${Icon} name="trash" size=${14}/>ลบรายการนี้</button>
    </div>`}

    ${isCust ? html`
      <!-- ── รายละเอียดลูกค้า: ตรงตามคอลัมน์ในไฟล์ข้อมูลจริงจาก Barter (ไม่รวมคอลัมน์สุดท้าย "สถานะ") ── -->
      <div class="sec-label">รายละเอียดลูกค้า</div>
      ${row("ชื่อร้านค้า / ชื่อธุรกิจ", c.businessName)}
      ${row("หมวดธุรกิจ", segTH(c.segment))}
      ${row("จังหวัด", provinceTH(c.province))}
      ${row("อำเภอ / เขต", c.district ? districtTH(c.district) : html`<span class="dim">—</span>`)}

      <!-- ── ข้อมูลการติดต่อ (ค่าจริงจากไฟล์ · ว่างได้) ── -->
      <div class="sec-label">ข้อมูลการติดต่อ</div>
      <div class="cd-item">
        <span class="cd-tx"><span class="cd-k">ที่อยู่</span><span class="cd-v">${fullAddress(c)}</span></span>
      </div>
      ${c.phone ? html`<a class="cd-item" href=${telHref(c.phone)}>
        <span class="cd-tx"><span class="cd-k">เบอร์โทรศัพท์</span><span class="cd-v">${c.phone}</span></span>
      </a>` : html`<div class="cd-item">
        <span class="cd-tx"><span class="cd-k">เบอร์โทรศัพท์</span><span class="cd-v dim">ไม่มีข้อมูล</span></span>
      </div>`}
      ${c.website ? html`<a class="cd-item" href=${extHref(c.website)} target="_blank" rel="noopener noreferrer">
        <span class="cd-tx"><span class="cd-k">เว็บไซต์</span><span class="cd-v">${c.website}</span></span>
      </a>` : ""}
      ${c.facebook ? html`<a class="cd-item" href=${extHref(c.facebook)} target="_blank" rel="noopener noreferrer">
        <span class="cd-tx"><span class="cd-k">เฟซบุ๊ก</span><span class="cd-v">${c.facebook}</span></span>
      </a>` : ""}
      <style>${CUST_CSS}</style>`
    : (dealMode ? "" : html`
      ${row("ชื่อ Lead", c.businessName)}
      ${row("สถานะ", html`<${Badge} tone="neutral">Lead</${Badge}>`)}
      ${row("หมวดธุรกิจ", segTH(c.segment))}
      ${row("ที่อยู่", (c.address||"")+", "+provinceTH(c.province))}
      ${row("ผู้ดูแลการขาย", salesOwner(c))}
      ${c.source ? row("แหล่งที่มา", html`<${Badge} tone="neutral">${c.source}</${Badge}>`) : ""}
      ${row("อีเมล", c.email||html`<span class="dim">—</span>`)}`)}

    <!-- ปุ่ม/สถานะ "แผนการเข้าพบ" ของ Lead — ท้ายสุดของรายละเอียด เหนือกล่องคำแนะนำ และจัดกึ่งกลาง
         กดเพิ่มแล้วปิดแผงทันที เพื่อเลือกหมุดถัดไปได้เลย ไม่ต้องกดปิดเอง -->
    ${!isCust && !dealPlan && c.dealStatus!=="pending" ? html`<div style=${{marginTop:"16px",display:"flex",flexDirection:"column",gap:"8px"}}>
      ${(inPlan||added)
        ? html`<div class="deal-note ok" style=${{justifyContent:"center"}}><${Icon} name="check" size=${15} color="#0f7a3d"/>เพิ่มในแผนแล้ว</div>`
        : (isTC
            ? html`<div style=${{display:"flex",justifyContent:"center"}}>
                <${Btn} variant="primary" icon="route" onClick=${()=>{ onAddToPlan&&onAddToPlan(c); setAdded(true); toast("✔ เพิ่มLeadเข้าสู่แผนการเข้าพบแล้ว","good"); onClose&&onClose(); }}>เพิ่มในแผนการเข้าพบ</${Btn}></div>`
            : html`<div class="deal-note info" style=${{justifyContent:"center"}}><${Icon} name="clock" size=${15} color="#0369a1"/>ยังไม่ถูกเพิ่มเข้าแผนการเข้าพบ</div>`)}
      ${c.dealStatus==="rejected" ? html`<div class="deal-note warn"><${Icon} name="info" size=${14} color="#f59e0b"/>ดีลถูกตีกลับจากแอดมิน กรุณาตรวจสอบและส่งใหม่</div>`:""}
    </div>` : ""}

    <!-- ประวัติการนัดเข้าพบ — เห็นได้ทุกบทบาท ไม่ถูกลบเมื่อยกเลิก
         รอบที่ "ยกเลิก" จะติดเหตุผลไว้ ให้ TC คนถัดไปรู้ว่าทำไม Lead รายนี้ถึงถูกปล่อยกลับมา -->
    ${rounds.length ? html`<div class="sec-label" style=${{marginTop:"16px"}}>ประวัติการนัดเข้าพบ</div>
      <div class="vr-timeline">
        ${[...rounds].reverse().map((r,i)=>html`<div key=${i} class="vr-item">
          <div class="vr-item-h" style=${{cursor:"default"}}>
            <span class="vr-dot" style=${{background:r.status==="ยกเลิก"?"#d03b3b":r.status==="เสร็จสิ้น"?"#0f7a3d":"#f59e0b"}}></span>
            <b>รอบที่ ${r.round}</b><span class="muted">${r.status}</span>
            <span class="dim" style=${{marginLeft:"auto"}}>${r.date?beDate(r.date):""}</span></div>
          <div class="vr-item-b">
            ${r.by ? html`<div><span class="muted">โดย </span>${r.by}</div>` : ""}
            ${r.reason ? html`<div><span class="muted">เหตุผล </span><b>${r.reason}</b></div>` : ""}
            ${r.note ? html`<div><span class="muted">หมายเหตุ </span>${r.note}</div>` : ""}
          </div></div>`)}
      </div>` : ""}

    ${dealMode ? "" : html`<div style=${{marginTop:"14px",padding:"12px 14px",borderRadius:"12px",background:"rgba(51,214,159,.08)",border:"1px solid rgba(51,214,159,.32)"}}>
      <div class="row" style=${{gap:"8px",marginBottom:"5px"}}><${Icon} name="bolt" size=${14} color="#0f7a3d"/><b style=${{fontSize:"12px",color:"#0f7a3d"}}>คำแนะนำ</b></div>
      <div style=${{fontSize:"12.5px",lineHeight:1.6}}>${recommendation(c, segGap)}</div>
    </div>`}


    <style>${VR_CSS}</style>
  </${DrawerShell}>`;
}

const VR_CSS = `
/* ── โหมดปิดดีลLead (deal-close) ── */
.deal-note{display:flex;align-items:center;gap:8px;padding:11px 13px;border-radius:11px;font-size:12.5px;font-weight:600;line-height:1.5}
.deal-note.info{background:rgba(56,189,248,.12);border:1px solid rgba(56,189,248,.32);color:#0369a1}
.deal-note.ok{background:rgba(51,214,159,.12);border:1px solid rgba(51,214,159,.35);color:#0f7a3d}
.deal-note.warn{background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.32);color:#f59e0b}
.deal-note.pending{margin-top:10px;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.32);color:#f59e0b}
.deal-box{margin-top:8px;padding:12px 13px;border-radius:12px;border:1px solid var(--stroke2);background:var(--surface);display:flex;flex-direction:column;gap:7px}
.deal-row{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12.5px}
.deal-row .muted{font-size:12px}
.deal-attach{display:flex;align-items:center;gap:8px;padding:11px 13px;border-radius:11px;cursor:pointer;font-size:12.5px;font-weight:600;
  color:var(--txt);border:1px dashed var(--stroke2);background:rgba(30,45,80,.05)}
.deal-attach:hover{border-color:var(--accent)}
.deal-submit{display:inline-flex;align-items:center;justify-content:center;gap:7px;width:100%;font-family:var(--font);font-size:13px;font-weight:700;
  cursor:pointer;border:none;border-radius:11px;padding:12px 14px;color:#fff;background:linear-gradient(135deg,#ff3b5c,#e60023);box-shadow:0 6px 16px rgba(255,122,168,.3)}
.deal-submit:hover{box-shadow:0 9px 22px rgba(255,122,168,.45)}
.deal-cancel{display:inline-flex;align-items:center;justify-content:center;gap:7px;width:100%;font-family:var(--font);font-size:12.5px;font-weight:700;
  cursor:pointer;border:1px solid rgba(208,59,59,.35);border-radius:11px;padding:11px 14px;color:#b30019;background:rgba(208,59,59,.07)}
.deal-cancel:hover{background:rgba(208,59,59,.13)}
.deal-modal-back{position:fixed;inset:0;z-index:1200;display:grid;place-items:center;background:rgba(4,10,20,.55);backdrop-filter:blur(3px)}
.deal-modal{width:min(340px,calc(100vw - 40px));background:var(--panel);border:1px solid var(--stroke2);border-radius:16px;
  box-shadow:0 24px 64px rgba(0,0,0,.5);padding:18px 18px 16px;font-family:var(--font);animation:dealPop .22s cubic-bezier(.2,.9,.25,1)}
@keyframes dealPop{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:none}}
.deal-modal-t{font-size:15px;font-weight:800;color:var(--txt)}
.deal-modal-b{margin-top:8px;font-size:13px;line-height:1.6;color:var(--muted)}
.vr-head{margin-top:8px;padding:11px 13px;border-radius:12px}
.vr-badge{display:inline-flex;align-items:center;gap:6px;padding:4px 11px;border-radius:999px;font-size:12.5px;font-weight:800}
.vr-urg{padding:1px 8px;border-radius:999px;font-size:11px;font-weight:700}
.vr-urg.bad{background:rgba(208,59,59,.16);color:#ff7a7a}
.vr-urg.warn{background:rgba(255,176,46,.16);color:#b45309}
.vr-urg.info{background:rgba(57,135,229,.16);color:#63a4ee}
.vr-timeline{margin-top:10px;display:flex;flex-direction:column;gap:7px}
.vr-item{border:1px solid var(--stroke);border-radius:10px;overflow:hidden;background:rgba(30,45,80,.05)}
.vr-item-h{width:100%;display:flex;align-items:center;gap:8px;padding:9px 11px;background:none;border:none;cursor:pointer;
  color:var(--txt);font-family:var(--font);font-size:12.5px;text-align:left}
.vr-item-h:hover{background:rgba(30,45,80,.05)}
.vr-dot{width:9px;height:9px;border-radius:50%;flex:none}
.vr-item-b{padding:2px 13px 11px 30px;display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--txt)}
.vr-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.vr-closed{margin-top:12px;padding:9px 12px;border-radius:10px;background:rgba(13,148,136,.1);border:1px solid rgba(13,148,136,.3);font-size:12.5px}
.vr-form{margin-top:12px;padding:13px;border-radius:12px;border:1px solid var(--stroke2);background:var(--surface);display:flex;flex-direction:column;gap:9px}
.vr-form-t{font-size:13px;font-weight:800;color:var(--txt)}
.vr-f{display:flex;flex-direction:column;gap:4px;font-size:11.5px;font-weight:700;color:var(--dim)}
.vr-f select,.vr-f input{padding:8px 10px;border-radius:9px;border:var(--dropdown-border);background:var(--dropdown-bg);
  color:var(--dropdown-text);font-family:var(--font);font-size:12.5px;font-weight:400;box-shadow:var(--dropdown-shadow)}
.vr-f select{color-scheme:light}
.vr-hint{font-size:10.5px;font-weight:500;color:var(--muted)}
`;

function RouteMap({origin, route}){
  const ref=useRef();
  useEffect(()=>{
    const map=L.map(ref.current,{zoomControl:false,attributionControl:true}).setView([origin.latitude,origin.longitude],12);
    basemap(map, "th");
    const pts=[[origin.latitude,origin.longitude],...route.stops.map(s=>[s.latitude,s.longitude])];
    L.circleMarker(pts[0],{radius:8,color:"#34e0d0",fillColor:"#34e0d0",fillOpacity:.9,weight:2}).addTo(map).bindTooltip("จุดเริ่ม: "+origin.businessName);
    route.stops.forEach((s,i)=>L.marker([s.latitude,s.longitude]).addTo(map).bindTooltip(`${i+1}. ${s.businessName}`));
    let line = L.polyline(pts,{color:"#38bdf8",weight:2.5,dashArray:"6 6"}).addTo(map);
    map.fitBounds(L.latLngBounds(pts).pad(0.25));
    setTimeout(()=>map.invalidateSize(),60);
    let alive=true;
    fetchDrivingRoute(pts).then(realPts=>{
      if(!alive || !realPts) return;
      map.removeLayer(line);
      line = L.polyline(realPts,{color:"#38bdf8",weight:2.5,opacity:.9}).addTo(map);
    });
    return ()=>{ alive=false; map.remove(); };
  },[origin.id]);
  return html`<div ref=${ref} style=${{height:"210px",borderRadius:"12px",overflow:"hidden",border:"1px solid var(--stroke)"}}></div>`;
}
