import {html, useState, useApp, Icon, num, pct, moneyC, SEG_COLOR, SEGMENTS} from "../lib.js";
import {Card, Kpi, Btn, Badge, Grade, Meter, Table} from "../ui.js";
import {Donut, BarChart, Gauge} from "../charts.js";
import {analyzeArea} from "../data.js";

export function Area(){
  const {db, nav, filters, selectedProvince, setSelectedProvince} = useApp();
  const province = selectedProvince || db.areas[0].province;
  const a = analyzeArea(db, province, filters);

  const gapTone = a.gap==="High"?"bad":a.gap==="Medium"?"warn":"good";
  const donutData = SEGMENTS.map(s=>({label:s, value:a.segMix.find(m=>m.seg===s).total, color:SEG_COLOR[s]}));

  const recs = buildRecs(a);

  return html`<div class="page fade-in">
    <div class="page-head">
      <div>
        <div class="eyebrow">Area Dashboard · ${a.center?`${a.center[1].toFixed(2)}°N, ${a.center[0].toFixed(2)}°E`:""}</div>
        <h1>${province}</h1>
        <div class="sub">Statistical analysis of ${num(a.customerCount+a.prospectCount)} businesses in this area</div>
      </div>
      <div class="ph-right">
        <select class="input" value=${province} onChange=${e=>setSelectedProvince(e.target.value)}>
          ${db.areas.map(x=>html`<option key=${x.province} value=${x.province}>${x.province}</option>`)}
        </select>
        <${Btn} variant="ghost" icon="map" onClick=${()=>nav("country",{country:"Thailand"})}>View on Map</${Btn}>
        <${Btn} variant="primary" icon="reports" onClick=${()=>nav("reports",{area:province})}>Generate Report</${Btn}>
      </div>
    </div>

    <div class="grid g4" style=${{marginBottom:"16px"}}>
      <${Kpi} label="Customers" value=${num(a.customerCount)} icon="users" iconBg="rgba(230, 0, 35,.2)"/>
      <${Kpi} label="Prospects" value=${num(a.prospectCount)} icon="target" iconBg="rgba(255, 59, 92,.18)"/>
      <${Kpi} label="Coverage" value=${pct(a.coverage)} icon="coverage" iconBg="rgba(51,214,159,.18)"/>
      <${Kpi} label="Sales Value" value=${moneyC(a.salesTotal)} icon="money" iconBg="rgba(138,123,255,.18)"/>
    </div>

    <div class="grid g3" style=${{marginBottom:"16px"}}>
      <!-- Opportunity + Gap -->
      <${Card} title="Opportunity & Gap Analysis" sub="Density-mining model">
        <div class="row" style=${{gap:"20px",alignItems:"center",marginBottom:"14px"}}>
          <${Gauge} value=${a.opportunity} size=${140} label="Opportunity"/>
          <div>
            <div class="row" style=${{gap:"8px",marginBottom:"10px"}}>Market Gap: <${Badge} tone=${gapTone}>${a.gap}</${Badge}></div>
            <div class="muted" style=${{fontSize:"12.5px",lineHeight:1.7}}>
              Prospect-to-customer ratio <b style=${{color:"var(--txt)"}}>1 : ${a.ratio}</b><br/>
              Avg potential score <b style=${{color:"var(--txt)"}}>${a.avgPotential}/100</b><br/>
              Top segment <b style=${{color:"var(--txt)"}}>${a.topSegment}</b></div>
          </div>
        </div>
        <div class="sec-label" style=${{margin:"6px 0 8px"}}>Coverage</div>
        <${Meter} value=${a.coverage} height=${11}/>
        <div class="row between" style=${{fontSize:"12.5px",marginTop:"6px"}}>
          <span class="dim">Existing ${a.customerCount}</span><span class="dim">Prospects ${a.prospectCount}</span></div>
      </${Card}>

      <!-- Segments donut -->
      <${Card} title="Business Segments" sub="Distribution">
        <${Donut} data=${donutData} size=${150} center=${{value:a.customerCount+a.prospectCount, label:"Total"}}/>
      </${Card}>

      <!-- Recommendation -->
      <${Card} title="Recommendation" sub="Prescriptive insight">
        <div style=${{display:"flex",flexDirection:"column",gap:"11px"}}>
          ${recs.map((r,i)=>html`<div key=${i} class="row" style=${{gap:"10px",alignItems:"flex-start"}}>
            <div style=${{width:"22px",height:"22px",borderRadius:"7px",flex:"none",display:"grid",placeItems:"center",
              background:"rgba(51,214,159,.15)"}}><${Icon} name="check" size=${13} color="#33d69f"/></div>
            <div style=${{fontSize:"12.5px",lineHeight:1.5}}>${r}</div></div>`)}
        </div>
      </${Card}>
    </div>

    <div class="grid g2">
      <!-- segment bars -->
      <${Card} title="Segment Density" sub="Existing vs prospect by segment">
        <${BarChart} horizontal=${true} data=${a.segMix.map(m=>({label:m.seg, value:m.total, color:SEG_COLOR[m.seg]}))} format=${num}/>
        <div class="hr"></div>
        ${a.segMix.map(m=>html`<div key=${m.seg} class="row between" style=${{fontSize:"12px",padding:"4px 0"}}>
          <span class="row" style=${{gap:"8px"}}><span class="dotc" style=${{background:SEG_COLOR[m.seg]}}></span>${m.seg}</span>
          <span class="muted">${m.cust} existing · ${m.pros} prospects · <b style=${{color:"var(--txt)"}}>${m.pct}%</b></span></div>`)}
      </${Card}>

      <!-- business ranking -->
      <${Card} title="Business Ranking" sub="Top prospects by potential score" pad0=${true}>
        <${Table}
          cols=${[
            {h:"#", w:"36px", render:(r,i)=>html`<b class="dim">${i+1}</b>`},
            {h:"Business", render:r=>html`<div><div style=${{fontWeight:600}}>${r.businessName}</div>
              <div class="dim" style=${{fontSize:"12.5px"}}>${r.category} · ★${r.rating}</div></div>`},
            {h:"Score", w:"70px", render:r=>html`<b>${r.potentialScore}</b>`},
            {h:"Grade", w:"56px", render:r=>html`<${Grade} g=${r.grade}/>`},
          ]}
          rows=${a.topProspects}
          onRow=${r=>nav("customer",{id:r.id})}/>
      </${Card}>
    </div>
  </div>`;
}

function buildRecs(a){
  const out=[];
  out.push(`Prioritise the ${a.topSegment} segment — it shows the highest business density in ${a.province}.`);
  if(a.gap==="High") out.push(`High market gap (1:${a.ratio}). Deploy ${Math.max(2,Math.round(a.prospectCount/120))} field reps to convert untapped prospects.`);
  else out.push(`Balanced coverage. Focus on retention of ${a.customerCount} active accounts and upsell.`);
  const topA=a.topProspects.filter(p=>p.grade==="A").length;
  out.push(`Target the ${topA} A-grade prospects first for a projected +${Math.round(a.opportunity/4)}% coverage lift within 90 days.`);
  return out;
}
