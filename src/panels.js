import {html, useState, useEffect, useRef, Icon, SegmentIcon, num, money, moneyC, pct, SEG_COLOR, SEGMENTS,
  segTH, gapTH, typeTH, tradingTH, provinceTH, districtTH, fetchDrivingRoute} from "./lib.js";
import {basemap} from "./basemap.js";
import {Btn, Badge, Grade, Meter, toast, InfoTip} from "./ui.js";
import {Donut, BarChart, Gauge, rampRed} from "./charts.js";
import {analyzeArea, downloadCSV} from "./data.js";
import {statusMeta, responsibleOf, nextAppointment, urgencyOf, beDate, INTEREST, OUTCOME, CANCEL_REASONS} from "./visit-rounds.js";

// Grade → short next-action label (mirrors the prospect recommendation tiers A≥85 / B≥70 / C)
const GRADE_DESC = {A:"ควรติดต่อด่วน", B:"ควรนัดหมายเข้าพบ", C:"ติดตามในรอบถัดไป"};
// Plain-language "where this comes from" tooltips (NO weight numbers — those stay Admin-only)
const POTENTIAL_TIP = html`<b>คะแนนนี้พิจารณาจาก:</b><br/>• ความตรงกับหมวดหมู่ธุรกิจที่มองหา<br/>• คะแนนรีวิวและจำนวนรีวิว<br/>• การมีเว็บไซต์หรือเบอร์โทรติดต่อ<br/><br/>คำนวณจากข้อมูลที่นำเข้าจากฐานข้อมูลลูกค้า`;
// Renders a 0–5 rating as filled/empty star icons (rounded to the nearest whole star) plus the raw number.
const StarRating = (rating, reviewCount) => html`<span class="row" style=${{gap:"2px",justifyContent:"flex-end",flexWrap:"nowrap"}}>
  ${[1,2,3,4,5].map(i=>html`<${Icon} key=${i} name="star" size=${13} color=${i<=Math.round(rating)?"#ffb02e":"var(--stroke2)"}/>`)}
  <span style=${{marginLeft:"5px",fontWeight:600}}>${rating.toFixed(1)}</span>
  <span class="dim" style=${{marginLeft:"2px"}}>(${num(reviewCount)})</span>
</span>`;

const L = window.L;
// derive Sales Owner + Sales History deterministically from the record (no extra API needed)
const OWNERS=["สมชาย กิตติ","ปรียา วงศ์","ณัฐพงษ์ ศรี","อรุณี ทองดี","David Chen","วิชัย มณี","กมลชนก พร"];
const hashOf=s=>{let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))|0;return Math.abs(h);};
const salesOwner=c=>OWNERS[hashOf(c.id)%OWNERS.length];
function salesHistory(c){ const h=hashOf(c.id), n=3+(h%2), base=c.salesValue||400000, out=[];
  for(let i=0;i<n;i++){ const yr=2026-i, mo=((h>>(i*3))%12)+1;
    out.push({date:`${yr}-${String(mo).padStart(2,"0")}-${String(8+(h>>i)%20).padStart(2,"0")}`,
      amount:Math.round(base*(0.35+((h>>(i*2))%60)/100))}); }
  return out;
}
// ── ข้อมูลติดต่อตัวอย่าง: ชุดข้อมูลจริงยังไม่มีเบอร์โทร/เว็บไซต์ จึงสร้างขึ้นแบบ "คงที่" จากรหัสลูกค้า
//    (ใช้ hashOf(c.id) ไม่ใช่การสุ่ม) ค่าจึงเหมือนเดิมทุกครั้งที่เปิดดูลูกค้ารายเดิม ไม่เปลี่ยนไปมาระหว่างเรนเดอร์
const MOBILE_PREFIX = ["081","082","086","089","091","094","096","098"];
function mockPhone(c){
  const h = hashOf(c.id+"เบอร์");
  // กรุงเทพฯ ครึ่งหนึ่งใช้เบอร์บ้าน 02 · ที่เหลือใช้เบอร์มือถือ
  if(c.province==="Bangkok Metropolis" && h%2===0)
    return `02-${String(200+h%700)}-${String(1000+((h>>3)%9000))}`;
  return `${MOBILE_PREFIX[h%MOBILE_PREFIX.length]}-${String(100+((h>>2)%900))}-${String(1000+((h>>5)%9000))}`;
}
// tel: ใช้รูปแบบสากล +66 (ตัดเลข 0 ตัวหน้าออก) เพื่อให้กดโทรออกได้บนมือถือ/แท็บเล็ต
const telHref = s => "tel:+66"+String(s).replace(/[^0-9]/g,"").replace(/^0/,"");
// โดเมนตั้งตามชื่อธุรกิจ (คงเฉพาะตัวอักษร/ตัวเลข) — ธุรกิจไทยจึงลงท้าย .co.th
function mockWebsite(c){
  const slug = String(c.businessName||"").toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,24);
  return (slug || ("cus"+(hashOf(c.id)%9999)))+".co.th";
}
// ที่อยู่เต็ม ประกอบจากฟิลด์จริงที่มีอยู่ (ที่อยู่ + อำเภอ/เขต + จังหวัด) ไม่ได้แต่งขึ้นใหม่
const fullAddress = c => [c.address, c.district?districtTH(c.district):"", provinceTH(c.province)].filter(Boolean).join(" · ");
// สไตล์เฉพาะส่วน "ข้อมูลการติดต่อ" ของ panel ลูกค้าปัจจุบัน
const CUST_CSS = `
.cd-item{display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-bottom:1px solid var(--stroke);
  text-decoration:none;color:var(--txt)}
a.cd-item:hover .cd-v{color:var(--accent)}
.cd-ic{font-size:14px;line-height:1.5;flex:none;width:18px;text-align:center}
.cd-tx{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.cd-k{font-size:11px;color:var(--muted)}
.cd-v{font-size:12.5px;font-weight:600;word-break:break-word}
.cd-nav{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:11px;padding:10px;
  border-radius:11px;text-decoration:none;font-family:var(--font);font-size:12.5px;font-weight:700;
  color:var(--accent-deep);background:var(--accent-soft);border:1px solid var(--accent)}
.cd-nav:hover{background:var(--accent);color:#fff}
.cd-note{margin-top:9px;font-size:10.5px;line-height:1.5;color:var(--muted)}`;

function recommendation(c){
  if(c.status==="Prospect") return c.potentialScore>=85?"ติดต่อด่วน — ศักยภาพสูงมาก ควรเสนอเข้าพบทันที"
    :c.potentialScore>=70?"ควรนัดหมายเข้าพบภายในเดือนนี้":"ติดตามในรอบถัดไป";
  return c.tradingStatus==="At Risk"?"เสี่ยงเสียลูกค้า — ควรดูแลอย่างเร่งด่วน"
    :c.tradingStatus==="Dormant"?"กระตุ้นการซื้อซ้ำด้วยข้อเสนอพิเศษ":"รักษาความสัมพันธ์ · เสนอสินค้าเพิ่มเติม";
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

const miniKpi = (k,v,color)=>html`<div style=${{background:"rgba(255,255,255,.03)",border:"1px solid var(--stroke)",
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
    `ให้ความสำคัญกับกลุ่ม${segTH(a.topSegment)} — มีความหนาแน่นทางธุรกิจสูงสุดในพื้นที่นี้`,
    a.gap==="High" ? `ช่องว่างสูง (1:${a.ratio}) ควรจัดพนักงานขาย ${Math.max(2,Math.round(a.prospectCount/120))} คนเพื่อเปลี่ยนLeadเป็นลูกค้า`
                   : `ความครอบคลุมสมดุล — เน้นรักษาลูกค้าที่ใช้งานอยู่ ${a.customerCount} ราย`,
    `มุ่งเป้าLeadเกรด A อันดับต้นเพื่อเพิ่มความครอบคลุม ~+${Math.round(a.opportunity/4)}% ภายใน 90 วัน`,
  ];
  return html`<${DrawerShell} eyebrow=${"วิเคราะห์พื้นที่"+(a.center?` · ${a.center[1].toFixed(2)}°N, ${a.center[0].toFixed(2)}°E`:"")}
    title=${provinceTH(province)} sub=${`${num(a.customerCount+a.prospectCount)} ธุรกิจ · การทำเหมืองเชิงสถิติ`} onClose=${onClose}>

    <div style=${{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px",marginBottom:"16px"}}>
      ${miniKpi("ลูกค้า", num(a.customerCount))}
      ${miniKpi("Lead", num(a.prospectCount), "#0369a1")}
      ${miniKpi("ความครอบคลุม", pct(a.coverage), "#0f7a3d")}
      ${miniKpi("ยอดขาย", moneyC(a.salesTotal), "#6d28d9")}
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

    <div class="sec-label">Leadอันดับต้น</div>
    ${a.topProspects.map((p,i)=>html`<div key=${p.id} class="row" onClick=${()=>onOpenCustomer(p)}
      style=${{gap:"11px",padding:"9px 0",borderBottom:"1px solid var(--stroke)",cursor:"pointer"}}>
      <b class="dim" style=${{width:"18px"}}>${i+1}</b>
      <div style=${{flex:1,minWidth:0}}><div style=${{fontSize:"12.5px",fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>${p.businessName}</div>
        <div class="dim" style=${{fontSize:"12.5px"}}>${segTH(p.category)} · ★${p.rating}</div></div>
      <b>${p.potentialScore}</b><${Grade} g=${p.grade}/></div>`)}

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
function custReportRows(c){
  const isCust = c.status==="Existing";
  const rows = [["รายงานลูกค้า GeoIntel", c.businessName], ["รหัสลูกค้า", c.id],
    ["สถานะ", isCust?"ลูกค้าปัจจุบัน":"Lead"], ["ประเภทธุรกิจ", typeTH(c.businessType||c.category)],
    ["กลุ่มธุรกิจ", segTH(c.segment)], ["จังหวัด", provinceTH(c.province)],
    ["ละติจูด", c.latitude.toFixed(4)], ["ลองจิจูด", c.longitude.toFixed(4)],
    ["คะแนนศักยภาพ", c.opportunityScore??c.potentialScore??"-"], ["คำแนะนำ", recommendation(c)]];
  if(isCust){
    rows.push(["สถานะการซื้อขาย", tradingTH(c.tradingStatus)], ["มูลค่ายอดขาย", c.salesValue], ["ซื้อครั้งล่าสุด", c.lastPurchaseDate],
      [], ["ประวัติการซื้อขาย","มูลค่า"]);
    salesHistory(c).forEach(h=>rows.push([h.date, h.amount]));
  } else {
    rows.push(["เกรดโอกาส", c.grade], ["คะแนนรีวิว", c.rating+" ("+num(c.reviewCount)+")"]);
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

export function CustomerPanel({db, customer, onClose, onOpenArea, setCustomer, onAddToPlan, inPlan, topOffset, canEditOwn, onSetVisit, onEditRecord, onDeleteRecord, onAddRound, user, onSubmitDeal, dealPlan}){
  const [added,setAdded]=useState(false);
  const [roundForm,setRoundForm]=useState(null);   // {kind:'visit'|'appt'|'cancel', interest, outcome, apptDate, reason, note}
  const [openR,setOpenR]=useState(0);               // index รอบที่กาง (0 = ล่าสุด)
  const [dealDoc,setDealDoc]=useState("");          // ชื่อไฟล์เอกสารปิดดีลที่แนบ (โหมดปิดดีล)
  const [confirmSend,setConfirmSend]=useState(false); // ป็อปอัพยืนยันส่งดีล
  const c = customer;
  const isCust = c.status==="Existing";
  const planned = inPlan || added;   // already in the visit plan?
  const isTC = !!(user && user.role === "Trade Coordinator");   // เฉพาะ TC เท่านั้นที่ "เพิ่มเข้าพบ/ส่งดีล" ได้ — แอดมิน/ผู้บริหารเห็นสถานะ+ผู้เข้าพบแบบอ่านอย่างเดียว
  const row=(k,v)=>html`<div class="row between" style=${{padding:"10px 0",borderBottom:"1px solid var(--stroke)",fontSize:"12.5px"}}>
    <span class="muted">${k}</span><span style=${{fontWeight:600,textAlign:"right"}}>${v}</span></div>`;

  return html`<${DrawerShell} dataTour="detail" eyebrow=${(isCust?"ลูกค้า":"Lead")+" · "+c.id} title=${c.businessName}
    sub=${`${segTH(c.segment)} · ${provinceTH(c.province)}`} onClose=${onClose}
    side="topright" topOffset=${topOffset} heroSegment=${c.segment} heroTone=${SEG_COLOR[c.segment]}>

    <!-- Hero block at the top of the panel. Existing customers and prospects show DIFFERENT things:
         a prospect is scored/graded (Barter Connect, gen.mjs), while an existing customer is already won —
         grading them would apply a screening scale that doesn't apply, so show their trading status instead. -->
    ${isCust ? html`
      <!-- แถบสถานะแนวนอนแบบกระชับ — ยุบจากกล่องใหญ่กลางจอเดิม (ไอคอน 84px) เหลือแถวเดียว ประหยัดความสูง -->
      <div class="row between" style=${{gap:"10px",flexWrap:"wrap",padding:"9px 12px",borderRadius:"11px",
        background:"rgba(255,255,255,.02)",border:"1px solid var(--stroke)"}}>
        <${Badge} tone=${c.tradingStatus==="Active"?"good":c.tradingStatus==="Dormant"?"neutral":"warn"}>
          ${c.tradingStatus==="Active"?"🟢":c.tradingStatus==="Dormant"?"⚪":"🟠"} ${tradingTH(c.tradingStatus)}
        </${Badge}>
        <div style=${{fontSize:"12.5px",whiteSpace:"nowrap"}}>
          <span class="muted">ยอดขายรวม: </span><b style=${{fontSize:"14px"}}>${moneyC(c.salesValue)}</b></div>
      </div>`
    : html`
      <div class="sec-label" style=${{marginTop:0,display:"flex",alignItems:"center",gap:"7px"}}>คะแนนศักยภาพ <${InfoTip} text=${POTENTIAL_TIP}/></div>
      <div style=${{display:"flex",flexDirection:"column",alignItems:"center",textAlign:"center",gap:"10px",padding:"22px 14px",
        borderRadius:"12px",background:"rgba(255,255,255,.02)",border:"1px solid var(--stroke)"}}>
        <div class="grade-hero" data-g=${c.grade}
          style=${{width:"84px",height:"84px",borderRadius:"20px",fontSize:"42px"}}>${c.grade}</div>
        <div style=${{fontSize:"15px",fontWeight:700}}>เกรด ${c.grade}${GRADE_DESC[c.grade]?` — ${GRADE_DESC[c.grade]}`:""}</div>
        <div class="muted" style=${{fontSize:"13px"}}>ได้คะแนน <b style=${{color:"var(--txt)",fontSize:"15px"}}>${c.potentialScore}</b> จาก 100 คะแนน</div>
      </div>`}

    <!-- โฟลว์ปิดดีลLead (2 สถานะ) —
         A) ยังไม่ถูกบันทึกในแผนที่ยืนยันแล้ว → โชว์เฉพาะปุ่ม "เพิ่มในแผนการเข้าพบ" (ไม่แสดงผู้รับผิดชอบ/บันทึกผลเข้าพบ/นัดหมาย/ยกเลิก)
         B) TC เพิ่มเข้าแผน + กด "บันทึกแผนนี้" แล้ว → โชว์ผู้เข้าพบ + วันนัด(จากแผน) + แนบเอกสาร + ส่งดีลสำเร็จ → เข้าคิวรอแอดมินอนุมัติ -->
    ${!isCust && (()=>{
      const confirmed = !!dealPlan;                  // อยู่ในแผนที่บันทึก(ยืนยัน)แล้ว
      const submitted = c.dealStatus==="pending";    // ส่งดีลแล้ว รออนุมัติ
      const rejected  = c.dealStatus==="rejected";
      // ── สถานะ A: ยังไม่ยืนยันเข้าแผน → ปุ่มเพิ่มในแผนเท่านั้น ──
      if(!confirmed && !submitted){
        const inActivePlan = inPlan || added;
        return html`<div style=${{marginTop:"16px",marginBottom:"18px"}}>
          ${inActivePlan
            ? html`<div class="deal-note info"><${Icon} name="check" size=${15} color="#38bdf8"/>เพิ่มในแผนแล้ว — กด "บันทึกแผนนี้" ในแผงวางแผนการเข้าพบเพื่อยืนยัน</div>`
            : (isTC
                ? html`<${Btn} variant="primary" icon="route" onClick=${()=>{ onAddToPlan&&onAddToPlan(c); setAdded(true); toast("✔ เพิ่มLeadเข้าสู่แผนการเข้าพบแล้ว","good"); }}>เพิ่มในแผนการเข้าพบ</${Btn}>`
                : html`<div class="deal-note info"><${Icon} name="clock" size=${15} color="#0369a1"/>ยังไม่ถูกเพิ่มเข้าแผนการเข้าพบ</div>`)}
          ${rejected? html`<div class="deal-note warn" style=${{marginTop:"8px"}}><${Icon} name="info" size=${14} color="#f59e0b"/>ดีลถูกตีกลับจากแอดมิน กรุณาตรวจสอบและส่งใหม่</div>`:""}
        </div>`;
      }
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
                <${Icon} name="check" size=${15} color="#04121a"/>ส่งสถานะว่าดีลสำเร็จแล้ว</button>
            </div>`
            : html`<div class="deal-note info" style=${{marginTop:"10px"}}><${Icon} name="clock" size=${15} color="#0369a1"/>อยู่ระหว่างดำเนินการโดยผู้ประสานงานการค้า — ยังไม่ได้ส่งดีล</div>`)}
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

    ${isCust && (planned || isTC) ? html`<div style=${{marginTop:"12px",marginBottom:"18px"}}>
      ${planned
        ? html`<div class="row" style=${{gap:"8px",justifyContent:"center",padding:"12px",borderRadius:"11px",
            background:"rgba(51,214,159,.12)",border:"1px solid rgba(51,214,159,.35)",color:"#0f7a3d",fontSize:"13px",fontWeight:600}}>
            <${Icon} name="check" size=${15} color="#0f7a3d"/>เพิ่มลูกค้าเข้าสู่แผนการเข้าพบแล้ว</div>`
        : html`<${Btn} variant="primary" icon="route" onClick=${()=>{ onAddToPlan&&onAddToPlan(c); setAdded(true); toast("✔ เพิ่มลูกค้าเข้าสู่แผนการเข้าพบแล้ว","good"); }}>เพิ่มในแผนการเข้าพบ</${Btn}>`}
    </div>`:""}

    ${canEditOwn && html`<div style=${{display:"flex",gap:"9px",marginBottom:"16px"}}>
      <button onClick=${()=>onEditRecord&&onEditRecord(c)} style=${{flex:1,display:"inline-flex",alignItems:"center",justifyContent:"center",gap:"7px",
        padding:"11px",borderRadius:"11px",border:"1px solid var(--stroke2)",background:"transparent",color:"var(--txt)",cursor:"pointer",fontFamily:"var(--font)",fontSize:"13px",fontWeight:600}}>
        <${Icon} name="edit" size=${14}/>แก้ไข</button>
      <button onClick=${()=>{ if(confirm('ลบรายการ "'+c.businessName+'" ?')) onDeleteRecord&&onDeleteRecord(c); }} style=${{flex:1,display:"inline-flex",alignItems:"center",justifyContent:"center",gap:"7px",
        padding:"11px",borderRadius:"11px",border:"1px solid rgba(255,90,90,.35)",background:"rgba(255,90,90,.08)",color:"#ff5a5a",cursor:"pointer",fontFamily:"var(--font)",fontSize:"13px",fontWeight:600}}>
        <${Icon} name="trash" size=${14}/>ลบรายการนี้</button>
    </div>`}

    ${isCust ? html`
      <!-- ── ข้อมูลการติดต่อ ── -->
      <div class="sec-label">📞 ข้อมูลการติดต่อ</div>
      <a class="cd-item" href=${telHref(mockPhone(c))}>
        <span class="cd-ic">📞</span>
        <span class="cd-tx"><span class="cd-k">เบอร์โทรศัพท์</span><span class="cd-v">${mockPhone(c)}</span></span>
      </a>
      <div class="cd-item">
        <span class="cd-ic">📍</span>
        <span class="cd-tx"><span class="cd-k">ที่อยู่</span><span class="cd-v">${fullAddress(c)}</span></span>
      </div>
      <a class="cd-item" href=${"https://"+mockWebsite(c)} target="_blank" rel="noopener noreferrer">
        <span class="cd-ic">🌐</span>
        <span class="cd-tx"><span class="cd-k">เว็บไซต์</span><span class="cd-v">${mockWebsite(c)}</span></span>
      </a>
      <div class="cd-note">เบอร์โทรศัพท์และเว็บไซต์เป็นข้อมูลตัวอย่างสำหรับการสาธิต ยังไม่ได้เชื่อมกับข้อมูลติดต่อจริง</div>

      <!-- ── สถิติการซื้อขาย (ใช้ข้อมูลจริงทั้งหมด) ── -->
      <div class="sec-label">📊 สถิติการซื้อขาย</div>
      ${row("ยอดขายสะสม", moneyC(c.salesValue))}
      ${row("ซื้อครั้งล่าสุด", c.lastPurchaseDate)}
      <style>${CUST_CSS}</style>`
    : html`
      ${row("รหัสลูกค้า", html`<span class="mono">${c.id}</span>`)}
      ${row("ชื่อลูกค้า", c.businessName)}
      ${row("สถานะ", html`<${Badge} tone="neutral">Lead</${Badge}>`)}
      ${row("ประเภทธุรกิจ", typeTH(c.businessType||c.category))}
      ${row("ที่อยู่", (c.address||"")+", "+provinceTH(c.province))}
      ${row("ผู้ดูแลการขาย", salesOwner(c))}
      ${c.source ? row("แหล่งที่มา", html`<${Badge} tone="neutral">${c.source}</${Badge}>`) : ""}
      ${row("คะแนนรีวิว", StarRating(c.rating, c.reviewCount))}`}

    <div style=${{marginTop:"14px",padding:"12px 14px",borderRadius:"12px",background:"rgba(51,214,159,.08)",border:"1px solid rgba(51,214,159,.32)"}}>
      <div class="row" style=${{gap:"8px",marginBottom:"5px"}}><${Icon} name="bolt" size=${14} color="#0f7a3d"/><b style=${{fontSize:"12px",color:"#0f7a3d"}}>คำแนะนำ</b></div>
      <div style=${{fontSize:"12.5px",lineHeight:1.6}}>${recommendation(c)}</div>
    </div>


    <style>${VR_CSS}</style>
  </${DrawerShell}>`;
}

const VR_CSS = `
/* ── โหมดปิดดีลLead (deal-close) ── */
.deal-note{display:flex;align-items:center;gap:8px;padding:11px 13px;border-radius:11px;font-size:12.5px;font-weight:600;line-height:1.5}
.deal-note.info{background:rgba(56,189,248,.12);border:1px solid rgba(56,189,248,.32);color:#0369a1}
.deal-note.warn{background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.32);color:#f59e0b}
.deal-note.pending{margin-top:10px;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.32);color:#f59e0b}
.deal-box{margin-top:8px;padding:12px 13px;border-radius:12px;border:1px solid var(--stroke2);background:var(--surface);display:flex;flex-direction:column;gap:7px}
.deal-row{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12.5px}
.deal-row .muted{font-size:12px}
.deal-attach{display:flex;align-items:center;gap:8px;padding:11px 13px;border-radius:11px;cursor:pointer;font-size:12.5px;font-weight:600;
  color:var(--txt);border:1px dashed var(--stroke2);background:rgba(255,255,255,.02)}
.deal-attach:hover{border-color:var(--accent)}
.deal-submit{display:inline-flex;align-items:center;justify-content:center;gap:7px;width:100%;font-family:var(--font);font-size:13px;font-weight:700;
  cursor:pointer;border:none;border-radius:11px;padding:12px 14px;color:#04121a;background:linear-gradient(135deg,#ff3b5c,#e60023);box-shadow:0 6px 16px rgba(255,122,168,.3)}
.deal-submit:hover{box-shadow:0 9px 22px rgba(255,122,168,.45)}
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
.vr-item{border:1px solid var(--stroke);border-radius:10px;overflow:hidden;background:rgba(255,255,255,.02)}
.vr-item-h{width:100%;display:flex;align-items:center;gap:8px;padding:9px 11px;background:none;border:none;cursor:pointer;
  color:var(--txt);font-family:var(--font);font-size:12.5px;text-align:left}
.vr-item-h:hover{background:rgba(255,255,255,.03)}
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
