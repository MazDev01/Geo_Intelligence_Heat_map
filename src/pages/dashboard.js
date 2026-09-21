import {html, useApp, Icon, num, pct, segTH, SEG_COLOR, SEGMENTS, provinceTH} from "../lib.js";
import {Card, Kpi, Badge, Table, Meter, Btn, toast} from "../ui.js";
import {Donut, BarChart, Sparkline} from "../charts.js";
import {t} from "../i18n.js";   // สลับภาษา TH/EN — ดู src/i18n.js

export function Dashboard(){
  const {db, nav} = useApp();
  if(!db.customers) return html`<div class="page"><div class="emptybox">${t("กำลังโหลดข้อมูลธุรกิจ…", "Loading business data…")}</div></div>`;

  const custs=db.customers, pros=db.prospects, areas=db.areas;
  const provincesWithCust = areas.filter(a=>a.customerCount>0).length;

  // segment distribution (existing customers)
  const segCount = SEGMENTS.map(s=>({label:segTH(s), value:custs.filter(c=>c.segment===s).length, color:SEG_COLOR[s]}));

  // ดัชนี Lead สูงรายจังหวัด — คำนวณไว้แล้วใน areas.json (gapScore)
  const ranked=[...areas].map(a=>({...a, opp:a.gapScore||0})).sort((x,y)=>y.opp-x.opp);
  const avgOpp = Math.round(ranked.reduce((s,a)=>s+a.opp,0)/ranked.length);

  const topByCust=[...areas].sort((a,b)=>b.customerCount-a.customerCount).slice(0,6)
    .map(a=>({label:provinceTH(a.province), value:a.customerCount}));

  const heatLvl=o=> o>=70?{t:t("สูง", "High"),tone:"bad"}: o>=55?{t:t("ปานกลาง", "Medium"),tone:"warn"}:{t:t("ต่ำ", "Low"),tone:"info"};
  const heatColor=o=> o>=70?"linear-gradient(90deg,#ff7a2e,#ff3b1e)":o>=55?"linear-gradient(90deg,#ffb02e,#ff7a2e)":"linear-gradient(90deg,#2563eb,#38bdf8)";

  const notifs=[
    {icon:"refresh",tone:"good",t:t("ซิงค์ข้อมูล ERP เสร็จสมบูรณ์", "ERP sync completed"),time:t("วันนี้ 06:02", "Today 06:02")},
    {icon:"target",tone:"info",t:t("นำเข้า Prospect ใหม่ 128 ราย", "128 new prospects imported"),time:t("วันนี้ 05:40", "Today 05:40")},
    {icon:"download",tone:"warn",t:t("ส่งออกรายงานโอกาสเสร็จสิ้น", "Opportunity report exported"),time:t("เมื่อวาน 18:12", "Yesterday 18:12")},
    {icon:"audit",tone:"bad",t:t("พบข้อมูลซ้ำ 12 รายการ รอตรวจสอบ", "12 duplicate records found, awaiting review"),time:t("เมื่อวาน 09:30", "Yesterday 09:30")},
  ];
  const acts=[
    {u:t("ผู้ดูแลระบบ", "System Administrator"),a:t("ส่งออกรายงานโอกาส (PDF)", "Exported the opportunity report (PDF)"),icon:"download",time:t("5 นาทีที่แล้ว", "5 minutes ago")},
    {u:t("ผู้ประสานงานการค้า (TC)", "Trade Coordinator (TC)"),a:t("นำเข้าลูกค้า 45 ราย", "Imported 45 customers"),icon:"users",time:t("32 นาทีที่แล้ว", "32 minutes ago")},
    {u:t("ระบบอัตโนมัติ", "Automation"),a:t("ซิงค์ข้อมูล ERP", "ERP data sync"),icon:"refresh",time:t("2 ชม.ที่แล้ว", "2 hours ago")},
    {u:"David Chen",a:t("อัปเดตข้อมูลลูกค้า CUS00231", "Updated customer CUS00231"),icon:"edit",time:t("3 ชม.ที่แล้ว", "3 hours ago")},
  ];
  const spark=pts=>html`<${Sparkline} points=${pts} w=${130} h=${26}/>`;

  return html`<div class="page fade-in">
    <div class="page-head">
      <div><div class="eyebrow">${t("ภาพรวมธุรกิจ", "Business overview")}</div><h1>${t("แดชบอร์ด", "Dashboard")}</h1>
        <div class="sub">${t("สรุปลูกค้า Lead และโอกาสทางธุรกิจ · อัปเดตล่าสุด 13 ก.ค. 2026", "Customers, Leads and opportunities · last updated 13 Jul 2026")}</div></div>
      <div class="ph-right"><${Btn} variant="primary" icon="globe" onClick=${()=>nav("workspace")}>${t("เปิดแผนที่วิเคราะห์", "Open the analysis map")}</${Btn}></div>
    </div>

    <!-- SECTION 1: Business KPI -->
    <div class="grid g4" style=${{marginBottom:"18px"}}>
      <${Kpi} label=${t("ลูกค้าปัจจุบัน", "Existing customers")} value=${num(custs.length)} icon="users" iconBg="rgba(230, 0, 35,.2)" delta=${t("+4.2% จากเดือนก่อน", "+4.2% vs. last month")} deltaUp=${true} spark=${spark([12,18,15,22,26,24,30])}/>
      <${Kpi} label="Lead (Prospect)" value=${num(pros.length)} icon="target" iconBg="rgba(255, 59, 92,.18)" delta=${t("+8.1% จากเดือนก่อน", "+8.1% vs. last month")} deltaUp=${true} spark=${spark([20,24,30,28,36,40,44])}/>
      <${Kpi} label=${t("จังหวัดที่มีลูกค้า", "Provinces with customers")} value=${num(provincesWithCust)+" / 77"} icon="pin" iconBg="rgba(51,214,159,.18)" delta=${t("ครอบคลุมทั่วประเทศ", "Nationwide coverage")} deltaUp=${true}/>
      <${Kpi} label=${t("Lead เฉลี่ย", "Average Lead index")} value=${avgOpp+"/100"} icon="bolt" iconBg="rgba(255,176,46,.18)" delta=${t("หมวดที่ยังขาดในเครือข่าย", "Categories missing from the network")} deltaUp=${true}/>
    </div>

    <!-- SECTION 2 & 3: charts -->
    <div class="grid g2" style=${{marginBottom:"18px"}}>
      <${Card} title=${t("การกระจายลูกค้าตามกลุ่มธุรกิจ", "Customer distribution by business category")} sub=${t("แบ่งจำนวนลูกค้าตามประเภทธุรกิจ", "Customer counts split by business type")}>
        <${Donut} data=${segCount} center=${{value:num(custs.length),label:t("ลูกค้า", "Customers")}}/>
      </${Card}>
      <${Card} title=${t("จังหวัดที่มีลูกค้าสูงสุด", "Provinces with the most customers")} sub=${t("Top 6 จังหวัด", "Top 6 provinces")}>
        <${BarChart} horizontal=${true} data=${topByCust} format=${num}/>
      </${Card}>
    </div>

    <!-- SECTION 4 & 5: rankings -->
    <div class="grid g2" style=${{marginBottom:"18px",alignItems:"start"}}>
      <${Card} title=${t("อันดับพื้นที่ Lead สูง", "High-Lead area ranking")} sub=${t("เรียงตามดัชนี Lead (0–100) จากมากไปน้อย", "Sorted by Lead index (0–100), highest first")} pad0=${true}>
        <${Table} cols=${[
          {h:t("จังหวัด", "provinces"), render:r=>provinceTH(r.province)},
          {h:"Existing", render:r=>num(r.customerCount)},
          {h:"Prospect", render:r=>num(r.prospectCount)},
          {h:t("ดัชนีช่องว่าง", "Gap index"), render:r=>html`<b>${r.opp}</b>`},
          {h:"Coverage", render:r=>pct(r.coverage)},
        ]} rows=${ranked.slice(0,10)} onRow=${r=>nav("area",{province:r.province})}/>
      </${Card}>
      <${Card} title=${t("Heat Ranking — พื้นที่โอกาสสูง", "Heat ranking — high-opportunity areas")} sub=${t("10 จังหวัดที่มีโอกาสสูงสุด", "The 10 highest-opportunity provinces")}>
        ${ranked.slice(0,10).map((a,i)=>{const h=heatLvl(a.opp);return html`<div key=${a.province} class="row between" onClick=${()=>nav("area",{province:a.province})}
          style=${{padding:"9px 0",borderBottom:"1px solid var(--stroke)",cursor:"pointer",gap:"10px"}}>
          <div class="row" style=${{gap:"11px",flex:1,minWidth:0}}>
            <div style=${{width:"22px",height:"22px",borderRadius:"7px",flex:"none",display:"grid",placeItems:"center",fontSize:"12.5px",fontWeight:700,
              background:i<3?"rgba(255,90,60,.18)":"rgba(30,45,80,.07)",color:i<3?"#ff8a6e":"var(--muted)"}}>${i+1}</div>
            <span style=${{fontSize:"13px",fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>${provinceTH(a.province)}</span></div>
          <div style=${{width:"84px"}}><${Meter} value=${a.opp} color=${heatColor(a.opp)}/></div>
          <b style=${{width:"28px",textAlign:"right"}}>${a.opp}</b>
          <${Badge} tone=${h.tone}>${h.t}</${Badge}>
        </div>`;})}
      </${Card}>
    </div>

    <!-- SECTION 6,7,8 -->
    <div class="grid g3">
      <${Card} title=${t("การซิงค์ข้อมูล ERP", "ERP data sync")} sub="Data Synchronization">
        ${syncRow(t("ซิงค์ล่าสุด", "Last sync"),"2026-07-13 06:00")}
        ${syncRow(t("ซิงค์ครั้งถัดไป", "Next sync"),"2026-07-14 06:00")}
        ${syncRow(t("จำนวนข้อมูลทั้งหมด", "Total records"),num(custs.length+pros.length)+t(" รายการ", " records"))}
        <div class="row between" style=${{padding:"11px 0 14px"}}><span class="muted" style=${{fontSize:"13px"}}>${t("สถานะ", "Status")}</span><${Badge} tone="good" icon="check">${t("สำเร็จ", "Success")}</${Badge}></div>
        <${Btn} variant="solid" icon="refresh" onClick=${()=>toast(t("เริ่มซิงค์ข้อมูล ERP…", "Starting the ERP sync…"),"info")}>${t("ซิงค์ทันที", "Sync now")}</${Btn}>
      </${Card}>
      <${Card} title=${t("การแจ้งเตือน", "Notifications")} sub=${t("ธุรกิจล่าสุด", "Latest businesses")}>
        ${notifs.map((n,i)=>html`<div key=${i} class="row" style=${{gap:"11px",padding:"9px 0",borderBottom:"1px solid var(--stroke)",alignItems:"flex-start"}}>
          <div style=${{width:"28px",height:"28px",borderRadius:"8px",flex:"none",display:"grid",placeItems:"center",background:"rgba(30,45,80,.05)"}}>
            <${Icon} name=${n.icon} size=${14} color=${n.tone==="good"?"#33d69f":n.tone==="bad"?"#ff8a6e":n.tone==="warn"?"#ffb02e":"#e60023"}/></div>
          <div style=${{flex:1}}><div style=${{fontSize:"12.5px"}}>${n.t}</div><div class="dim" style=${{fontSize:"12px",marginTop:"2px"}}>${n.time}</div></div></div>`)}
      </${Card}>
      <${Card} title=${t("กิจกรรมล่าสุด", "Recent activity")} sub=${t("ของผู้ใช้งาน", "by users")}>
        ${acts.map((a,i)=>html`<div key=${i} class="row" style=${{gap:"11px",padding:"9px 0",borderBottom:"1px solid var(--stroke)"}}>
          <div style=${{width:"28px",height:"28px",borderRadius:"8px",flex:"none",display:"grid",placeItems:"center",background:"rgba(230, 0, 35,.14)"}}>
            <${Icon} name=${a.icon} size=${14} color="#e60023"/></div>
          <div style=${{flex:1}}><div style=${{fontSize:"12.5px"}}>${a.a}</div><div class="dim" style=${{fontSize:"12px",marginTop:"2px"}}>${a.u} · ${a.time}</div></div></div>`)}
      </${Card}>
    </div>
  </div>`;
}

function syncRow(k,v){ return html`<div class="row between" style=${{padding:"10px 0",borderBottom:"1px solid var(--stroke)",fontSize:"13px"}}>
  <span class="muted">${k}</span><span class="mono" style=${{fontWeight:600}}>${v}</span></div>`; }
