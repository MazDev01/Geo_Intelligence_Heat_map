import {html, useState, useEffect, useRef, useApp, Icon, num, money, moneyC, SEG_COLOR, fetchDrivingRoute} from "../lib.js";
import {Card, Kpi, Btn, Badge, Table} from "../ui.js";
import {Gauge} from "../charts.js";

const L = window.L;
const hav = (a,b)=>{ const R=6371, dLat=(b.latitude-a.latitude)*Math.PI/180, dLng=(b.longitude-a.longitude)*Math.PI/180;
  const s=Math.sin(dLat/2)**2+Math.cos(a.latitude*Math.PI/180)*Math.cos(b.latitude*Math.PI/180)*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(s)); };

export function Customer(){
  const {db, nav, selectedCustomer, setSelectedCustomer} = useApp();
  const [q, setQ] = useState("");
  const c = db.customers.find(x=>x.id===selectedCustomer) || db.customers[0];

  const results = q ? db.customers.filter(x=>x.businessName.toLowerCase().includes(q.toLowerCase())||x.id.toLowerCase().includes(q.toLowerCase())).slice(0,40) : [];

  // nearest neighbour route among same-province customers
  const route = buildRoute(c, db.customers.filter(x=>x.province===c.province && x.id!==c.id));

  return html`<div class="page fade-in">
    <div class="page-head">
      <div>
        <div class="eyebrow">Customer Detail · ${c.id}</div>
        <h1>${c.businessName}</h1>
        <div class="sub">${c.businessType} · ${c.province}, ${c.country}</div>
      </div>
      <div class="ph-right" style=${{position:"relative"}}>
        <div class="searchbox">
          <${Icon} name="search" size=${15}/>
          <input placeholder="Find customer by name or ID…" value=${q} onInput=${e=>setQ(e.target.value)}/>
        </div>
        <${Btn} variant="ghost" icon="area" onClick=${()=>nav("area",{province:c.province})}>Area Dashboard</${Btn}>
        ${results.length>0 && html`<div class="dropdown" style=${{top:"46px",maxHeight:"320px",overflowY:"auto",minWidth:"300px"}}>
          ${results.map(r=>html`<div key=${r.id} class="dd-item" onClick=${()=>{setSelectedCustomer(r.id);setQ("");}}>
            <${Icon} name="building" size=${15}/><div><div style=${{fontSize:"12.5px",fontWeight:600}}>${r.businessName}</div>
            <div class="dim" style=${{fontSize:"12.5px"}}>${r.id} · ${r.province}</div></div></div>`)}
        </div>`}
      </div>
    </div>

    <div class="grid" style=${{gridTemplateColumns:"1.15fr 1fr",alignItems:"start"}}>
      <div style=${{display:"flex",flexDirection:"column",gap:"16px"}}>
        <!-- Profile -->
        <${Card} title="Customer Profile">
          ${row("Business Name", c.businessName)}
          ${row("Business Type", c.businessType)}
          ${row("Segment", html`<span class="row" style=${{gap:"7px",justifyContent:"flex-end"}}>
            <span class="dotc" style=${{background:SEG_COLOR[c.segment]}}></span>${c.segment}</span>`)}
          ${row("Address", c.address+", "+c.province)}
          ${row("Latitude", html`<span class="mono">${c.latitude.toFixed(4)}</span>`)}
          ${row("Longitude", html`<span class="mono">${c.longitude.toFixed(4)}</span>`)}
          ${row("Trading Status", html`<${Badge} tone=${c.tradingStatus==="Active"?"good":c.tradingStatus==="Dormant"?"neutral":"warn"}>${c.tradingStatus}</${Badge}>`)}
        </${Card}>

        <!-- Trading summary -->
        <div class="grid g3">
          <${Kpi} label="Sales Value" value=${moneyC(c.salesValue)} icon="money" iconBg="rgba(138,123,255,.18)"/>
          <${Kpi} label="Potential" value=${c.potentialScore+"/100"} icon="trend" iconBg="rgba(255, 59, 92,.18)"/>
          <${Kpi} label="Last Purchase" value=${c.lastPurchaseDate} icon="clock" iconBg="rgba(51,214,159,.18)"/>
        </div>

        <${Card} title="Route Planning" sub=${`Optimised nearest-neighbour route · ${route.stops.length} stops · ${route.total.toFixed(1)} km`}>
          <${RouteMap} center=${[c.latitude,c.longitude]} route=${route} origin=${c}/>
          <div class="table-wrap" style=${{marginTop:"12px",maxHeight:"170px"}}>
            <${Table} cols=${[
              {h:"Stop", w:"46px", render:(r,i)=>html`<b class="dim">${i+1}</b>`},
              {h:"Business", render:r=>r.businessName},
              {h:"Segment", w:"90px", render:r=>r.segment},
              {h:"Leg (km)", w:"80px", render:r=>html`<span class="mono">${r.leg.toFixed(1)}</span>`},
            ]} rows=${route.stops} onRow=${r=>setSelectedCustomer(r.id)}/>
          </div>
        </${Card}>
      </div>

      <div style=${{display:"flex",flexDirection:"column",gap:"16px"}}>
        <${Card} title="Opportunity Score" sub="Statistical potential model">
          <div style=${{display:"grid",placeItems:"center",padding:"8px 0"}}>
            <${Gauge} value=${c.opportunityScore} size=${180} label="Opportunity"/>
          </div>
          <div class="muted" style=${{fontSize:"12.5px",lineHeight:1.7,textAlign:"center"}}>
            Derived from potential score, segment density and area coverage using the density-mining engine.</div>
        </${Card}>

        <${Card} title="Location">
          <${MiniLocate} lat=${c.latitude} lng=${c.longitude} name=${c.businessName}/>
        </${Card}>

        <${Card} title="Quick Actions">
          <div style=${{display:"flex",flexDirection:"column",gap:"9px"}}>
            <${Btn} variant="primary" icon="route">Assign to sales route</${Btn}>
            <${Btn} variant="solid" icon="reports" onClick=${()=>nav("reports",{area:c.province})}>Include in report</${Btn}>
            <${Btn} variant="ghost" icon="map" onClick=${()=>nav("country",{country:c.country})}>Show on country map</${Btn}>
          </div>
        </${Card}>
      </div>
    </div>
  </div>`;
}

function row(k,v){ return html`<div class="row between" style=${{padding:"11px 0",borderBottom:"1px solid var(--stroke)",fontSize:"13px"}}>
  <span class="muted">${k}</span><span style=${{fontWeight:600,textAlign:"right"}}>${v}</span></div>`; }

function buildRoute(origin, pool){
  const near=[...pool].map(p=>({...p, d:hav(origin,p)})).sort((a,b)=>a.d-b.d).slice(0,6);
  const stops=[]; let cur=origin; let total=0; const remaining=[...near];
  while(remaining.length){ remaining.sort((a,b)=>hav(cur,a)-hav(cur,b)); const nxt=remaining.shift();
    const leg=hav(cur,nxt); total+=leg; stops.push({...nxt, leg}); cur=nxt; }
  return {stops, total};
}

function RouteMap({center, route, origin}){
  const ref=useRef();
  useEffect(()=>{
    const map=L.map(ref.current,{zoomControl:false,attributionControl:true}).setView(center,12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{subdomains:"abc",attribution:'&copy; OpenStreetMap'}).addTo(map);
    const pts=[[origin.latitude,origin.longitude],...route.stops.map(s=>[s.latitude,s.longitude])];
    L.circleMarker([origin.latitude,origin.longitude],{radius:8,color:"#34e0d0",fillColor:"#34e0d0",fillOpacity:.9,weight:2}).addTo(map).bindTooltip("Origin: "+origin.businessName);
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
  return html`<div ref=${ref} style=${{height:"230px",borderRadius:"12px",overflow:"hidden",border:"1px solid var(--stroke)"}}></div>`;
}
function MiniLocate({lat,lng,name}){
  const ref=useRef();
  useEffect(()=>{
    const map=L.map(ref.current,{zoomControl:false,attributionControl:true,dragging:false,scrollWheelZoom:false}).setView([lat,lng],13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{subdomains:"abc",attribution:'&copy; OpenStreetMap'}).addTo(map);
    L.circleMarker([lat,lng],{radius:9,color:"#2563eb",fillColor:"#38bdf8",fillOpacity:.9,weight:2}).addTo(map).bindTooltip(name);
    setTimeout(()=>map.invalidateSize(),60);
    return ()=>map.remove();
  },[lat,lng]);
  return html`<div ref=${ref} style=${{height:"180px",borderRadius:"12px",overflow:"hidden",border:"1px solid var(--stroke)"}}></div>`;
}
