import {html, useApp, Icon, num, pct, segTH, SEG_COLOR, SEGMENTS, provinceTH} from "../lib.js";
import {Card, Kpi, Badge, Table, Meter, Btn, toast} from "../ui.js";
import {Donut, BarChart, Sparkline} from "../charts.js";

export function Dashboard(){
  const {db, nav} = useApp();
  if(!db.customers) return html`<div class="page"><div class="emptybox">กำลังโหลดข้อมูลธุรกิจ…</div></div>`;

  const custs=db.customers, pros=db.prospects, areas=db.areas;
  const provincesWithCust = areas.filter(a=>a.customerCount>0).length;

  // segment distribution (existing customers)
  const segCount = SEGMENTS.map(s=>({label:segTH(s), value:custs.filter(c=>c.segment===s).length, color:SEG_COLOR[s]}));

  // ดัชนี Lead สูงรายจังหวัด — คำนวณไว้แล้วใน areas.json (gapScore)
  const ranked=[...areas].map(a=>({...a, opp:a.gapScore||0})).sort((x,y)=>y.opp-x.opp);
  const avgOpp = Math.round(ranked.reduce((s,a)=>s+a.opp,0)/ranked.length);

  const topByCust=[...areas].sort((a,b)=>b.customerCount-a.customerCount).slice(0,6)
    .map(a=>({label:provinceTH(a.province), value:a.customerCount}));

  const heatLvl=o=> o>=70?{t:"สูง",tone:"bad"}: o>=55?{t:"ปานกลาง",tone:"warn"}:{t:"ต่ำ",tone:"info"};
  const heatColor=o=> o>=70?"linear-gradient(90deg,#ff7a2e,#ff3b1e)":o>=55?"linear-gradient(90deg,#ffb02e,#ff7a2e)":"linear-gradient(90deg,#2563eb,#38bdf8)";

  const notifs=[
    {icon:"refresh",tone:"good",t:"ซิงค์ข้อมูล ERP เสร็จสมบูรณ์",time:"วันนี้ 06:02"},
    {icon:"target",tone:"info",t:"นำเข้า Prospect ใหม่ 128 ราย",time:"วันนี้ 05:40"},
    {icon:"download",tone:"warn",t:"ส่งออกรายงานโอกาสเสร็จสิ้น",time:"เมื่อวาน 18:12"},
    {icon:"audit",tone:"bad",t:"พบข้อมูลซ้ำ 12 รายการ รอตรวจสอบ",time:"เมื่อวาน 09:30"},
  ];
  const acts=[
    {u:"ผู้ดูแลระบบ",a:"ส่งออกรายงานโอกาส (PDF)",icon:"download",time:"5 นาทีที่แล้ว"},
    {u:"ผู้ประสานงานการค้า (TC)",a:"นำเข้าลูกค้า 45 ราย",icon:"users",time:"32 นาทีที่แล้ว"},
    {u:"ระบบอัตโนมัติ",a:"ซิงค์ข้อมูล ERP",icon:"refresh",time:"2 ชม.ที่แล้ว"},
    {u:"David Chen",a:"อัปเดตข้อมูลลูกค้า CUS00231",icon:"edit",time:"3 ชม.ที่แล้ว"},
  ];
  const spark=pts=>html`<${Sparkline} points=${pts} w=${130} h=${26}/>`;

  return html`<div class="page fade-in">
    <div class="page-head">
      <div><div class="eyebrow">ภาพรวมธุรกิจ</div><h1>แดชบอร์ด</h1>
        <div class="sub">สรุปลูกค้า Lead และโอกาสทางธุรกิจ · อัปเดตล่าสุด 13 ก.ค. 2026</div></div>
      <div class="ph-right"><${Btn} variant="primary" icon="globe" onClick=${()=>nav("workspace")}>เปิดแผนที่วิเคราะห์</${Btn}></div>
    </div>

    <!-- SECTION 1: Business KPI -->
    <div class="grid g4" style=${{marginBottom:"18px"}}>
      <${Kpi} label="ลูกค้าปัจจุบัน" value=${num(custs.length)} icon="users" iconBg="rgba(230, 0, 35,.2)" delta="+4.2% จากเดือนก่อน" deltaUp=${true} spark=${spark([12,18,15,22,26,24,30])}/>
      <${Kpi} label="Lead (Prospect)" value=${num(pros.length)} icon="target" iconBg="rgba(255, 59, 92,.18)" delta="+8.1% จากเดือนก่อน" deltaUp=${true} spark=${spark([20,24,30,28,36,40,44])}/>
      <${Kpi} label="จังหวัดที่มีลูกค้า" value=${num(provincesWithCust)+" / 77"} icon="pin" iconBg="rgba(51,214,159,.18)" delta="ครอบคลุมทั่วประเทศ" deltaUp=${true}/>
      <${Kpi} label="Lead เฉลี่ย" value=${avgOpp+"/100"} icon="bolt" iconBg="rgba(255,176,46,.18)" delta="หมวดที่ยังขาดในเครือข่าย" deltaUp=${true}/>
    </div>

    <!-- SECTION 2 & 3: charts -->
    <div class="grid g2" style=${{marginBottom:"18px"}}>
      <${Card} title="การกระจายลูกค้าตามกลุ่มธุรกิจ" sub="แบ่งจำนวนลูกค้าตามประเภทธุรกิจ">
        <${Donut} data=${segCount} center=${{value:num(custs.length),label:"ลูกค้า"}}/>
      </${Card}>
      <${Card} title="จังหวัดที่มีลูกค้าสูงสุด" sub="Top 6 จังหวัด">
        <${BarChart} horizontal=${true} data=${topByCust} format=${num}/>
      </${Card}>
    </div>

    <!-- SECTION 4 & 5: rankings -->
    <div class="grid g2" style=${{marginBottom:"18px",alignItems:"start"}}>
      <${Card} title="อันดับพื้นที่ Lead สูง" sub="เรียงตามดัชนี Lead (0–100) จากมากไปน้อย" pad0=${true}>
        <${Table} cols=${[
          {h:"จังหวัด", render:r=>provinceTH(r.province)},
          {h:"Existing", render:r=>num(r.customerCount)},
          {h:"Prospect", render:r=>num(r.prospectCount)},
          {h:"ดัชนีช่องว่าง", render:r=>html`<b>${r.opp}</b>`},
          {h:"Coverage", render:r=>pct(r.coverage)},
        ]} rows=${ranked.slice(0,10)} onRow=${r=>nav("area",{province:r.province})}/>
      </${Card}>
      <${Card} title="Heat Ranking — พื้นที่โอกาสสูง" sub="10 จังหวัดที่มีโอกาสสูงสุด">
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
      <${Card} title="การซิงค์ข้อมูล ERP" sub="Data Synchronization">
        ${syncRow("ซิงค์ล่าสุด","2026-07-13 06:00")}
        ${syncRow("ซิงค์ครั้งถัดไป","2026-07-14 06:00")}
        ${syncRow("จำนวนข้อมูลทั้งหมด",num(custs.length+pros.length)+" รายการ")}
        <div class="row between" style=${{padding:"11px 0 14px"}}><span class="muted" style=${{fontSize:"13px"}}>สถานะ</span><${Badge} tone="good" icon="check">สำเร็จ</${Badge}></div>
        <${Btn} variant="solid" icon="refresh" onClick=${()=>toast("เริ่มซิงค์ข้อมูล ERP…","info")}>ซิงค์ทันที</${Btn}>
      </${Card}>
      <${Card} title="การแจ้งเตือน" sub="ธุรกิจล่าสุด">
        ${notifs.map((n,i)=>html`<div key=${i} class="row" style=${{gap:"11px",padding:"9px 0",borderBottom:"1px solid var(--stroke)",alignItems:"flex-start"}}>
          <div style=${{width:"28px",height:"28px",borderRadius:"8px",flex:"none",display:"grid",placeItems:"center",background:"rgba(30,45,80,.05)"}}>
            <${Icon} name=${n.icon} size=${14} color=${n.tone==="good"?"#33d69f":n.tone==="bad"?"#ff8a6e":n.tone==="warn"?"#ffb02e":"#e60023"}/></div>
          <div style=${{flex:1}}><div style=${{fontSize:"12.5px"}}>${n.t}</div><div class="dim" style=${{fontSize:"12px",marginTop:"2px"}}>${n.time}</div></div></div>`)}
      </${Card}>
      <${Card} title="กิจกรรมล่าสุด" sub="ของผู้ใช้งาน">
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
