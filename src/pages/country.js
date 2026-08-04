import {html, useState, useApp, Icon, num, SEGMENTS, SEG_COLOR, moneyC} from "../lib.js";
import {Btn, Toggle, Badge, Grade} from "../ui.js";
import {LeafletMap} from "../lmap.js";
import {filterData} from "../data.js";

export function Country(){
  const {db, nav, filters, setFilters, selectedCountry} = useApp();
  const country = selectedCountry || "Thailand";
  const [layers, setLayers] = useState({heat:true, cluster:true, existing:true, prospect:true, province:true, radius:22});
  const [pick, setPick] = useState(null);      // clicked marker
  const [focus, setFocus] = useState(null);
  const [search, setSearch] = useState("");

  const {customers, prospects} = filterData(db, filters, country);
  const provinces = country==="Thailand" ? ["All", ...db.areas.map(a=>a.province)] : ["All"];

  const setSeg = s => setFilters(f=>({...f, segments:{...f.segments, [s]:!f.segments[s]}}));
  const setStatus = s => setFilters(f=>({...f, status:{...f.status, [s]:!f.status[s]}}));
  const L = (k)=>setLayers(x=>({...x,[k]:!x[k]}));

  const doSearch = ()=>{ if(!search) return;
    const hit = db.areas.find(a=>a.province.toLowerCase().includes(search.toLowerCase()));
    if(hit){ setFilters(f=>({...f,province:hit.province})); setFocus(hit.province); }
  };

  const layerRows = [
    {k:"heat", name:"Heatmap", c:"linear-gradient(90deg,#2b6fff,#ff3b1e)"},
    {k:"cluster", name:"Clustering", c:"#8a7bff"},
    {k:"existing", name:"Existing Customers", c:"#2563eb"},
    {k:"prospect", name:"Prospects", c:"#38bdf8"},
    {k:"province", name:"Province Choropleth", c:"#34e0d0"},
  ];

  return html`<div class="page flush">
    <div class="topbar" style=${{borderTop:"1px solid var(--stroke)",height:"52px"}}>
      <${Btn} variant="ghost" size="sm" icon="globe" onClick=${()=>nav("dashboard")}>Globe</${Btn}>
      <div class="crumbs">Country Dashboard · <b>${country}</b></div>
      <div class="tb-right">
        <${Badge} tone="info">${num(customers.length)} customers</${Badge}>
        <${Badge} tone="neutral">${num(prospects.length)} prospects</${Badge}>
      </div>
    </div>

    <div style=${{position:"relative",flex:1,minHeight:0}}>
      <${LeafletMap} db=${db} filters=${filters} layers=${layers} country=${country}
        focusProvince=${focus}
        onPickArea=${p=>nav("area",{province:p})}
        onPickCustomer=${x=>setPick(x)}/>

      <!-- FILTERS overlay -->
      <div class="map-panel slide-panel" style=${{position:"absolute",top:"16px",left:"16px",width:"268px",padding:"16px",zIndex:500,maxHeight:"calc(100% - 32px)",overflowY:"auto"}}>
        <div class="row" style=${{gap:"8px",marginBottom:"14px"}}><${Icon} name="filter" size=${16} color="#e60023"/><b style=${{fontSize:"13px"}}>Filters</b></div>

        <div class="searchbox" style=${{minWidth:0,marginBottom:"14px"}}>
          <${Icon} name="search" size=${15}/>
          <input placeholder="Search province…" value=${search}
            onInput=${e=>setSearch(e.target.value)} onKeyDown=${e=>e.key==="Enter"&&doSearch()}/>
        </div>

        <div class="field" style=${{marginBottom:"14px"}}><label>Province</label>
          <select class="input" value=${filters.province} onChange=${e=>{setFilters(f=>({...f,province:e.target.value})); if(e.target.value!=="All")setFocus(e.target.value);}}>
            ${provinces.map(p=>html`<option key=${p} value=${p}>${p==="All"?"All Provinces":p}</option>`)}
          </select></div>

        <div style=${{marginBottom:"14px"}}>
          <label style=${{fontSize:"12.5px",color:"var(--dim)",textTransform:"uppercase",letterSpacing:".8px"}}>Segment</label>
          <div class="chip-row" style=${{marginTop:"7px"}}>
            ${SEGMENTS.map(s=>html`<button key=${s} class=${"chip"+(filters.segments[s]?" on":"")} onClick=${()=>setSeg(s)}>
              <span class="dotc" style=${{background:SEG_COLOR[s],display:"inline-block",marginRight:"5px",verticalAlign:"middle"}}></span>${s}</button>`)}
          </div>
        </div>

        <div style=${{marginBottom:"14px"}}>
          <label style=${{fontSize:"12.5px",color:"var(--dim)",textTransform:"uppercase",letterSpacing:".8px"}}>Status</label>
          <div class="chip-row" style=${{marginTop:"7px"}}>
            <button class=${"chip"+(filters.status.Existing?" on":"")} onClick=${()=>setStatus("Existing")}>Existing</button>
            <button class=${"chip"+(filters.status.Prospect?" on":"")} onClick=${()=>setStatus("Prospect")}>Prospect</button>
          </div>
        </div>

        <div style=${{marginBottom:"12px"}}>
          <label style=${{fontSize:"12.5px",color:"var(--dim)",textTransform:"uppercase",letterSpacing:".8px"}}>
            Min Potential Score <b style=${{color:"var(--accent2)",float:"right"}}>${filters.minScore}+</b></label>
          <input type="range" min="0" max="100" value=${filters.minScore}
            onInput=${e=>setFilters(f=>({...f,minScore:+e.target.value}))} style=${{marginTop:"8px"}}/>
        </div>

        <div>
          <label style=${{fontSize:"12.5px",color:"var(--dim)",textTransform:"uppercase",letterSpacing:".8px"}}>
            Heat Radius <b style=${{color:"var(--accent2)",float:"right"}}>${layers.radius}px</b></label>
          <input type="range" min="12" max="45" value=${layers.radius}
            onInput=${e=>setLayers(x=>({...x,radius:+e.target.value}))} style=${{marginTop:"8px"}}/>
        </div>
      </div>

      <!-- LAYERS + LEGEND overlay -->
      <div class="map-panel slide-panel" style=${{position:"absolute",top:"16px",right:"16px",width:"238px",padding:"16px",zIndex:500}}>
        <div class="row" style=${{gap:"8px",marginBottom:"12px"}}><${Icon} name="layers" size=${16} color="#34e0d0"/><b style=${{fontSize:"13px"}}>Layers</b></div>
        ${layerRows.map(r=>html`<div key=${r.k} class="row between" style=${{padding:"7px 0"}}>
          <div class="row" style=${{gap:"10px"}}><span class="dotc" style=${{background:r.c,width:"11px",height:"11px",borderRadius:"3px"}}></span>
            <span style=${{fontSize:"12.5px"}}>${r.name}</span></div>
          <${Toggle} on=${layers[r.k]} onChange=${()=>L(r.k)}/></div>`)}
        <div class="hr"></div>
        <div style=${{fontSize:"12.5px",color:"var(--dim)",textTransform:"uppercase",letterSpacing:".8px",marginBottom:"9px"}}>Legend</div>
        <div class="legend-row" style=${{marginBottom:"6px"}}><span class="dotc" style=${{background:"#2563eb"}}></span>Existing customer</div>
        <div class="legend-row" style=${{marginBottom:"6px"}}><span class="dotc" style=${{background:"#38bdf8"}}></span>Prospect</div>
        <div class="legend-row"><span class="dotc" style=${{background:"linear-gradient(90deg,#2b6fff,#ffb02e,#ff3b1e)"}}></span>Low → High density</div>
      </div>

      <!-- picked marker slide panel -->
      ${pick && html`<div class="slide-panel" style=${{position:"absolute",right:"16px",bottom:"16px",width:"300px",zIndex:600}}>
        <div class="card">
          <div class="row between" style=${{marginBottom:"6px"}}>
            <${Badge} tone=${pick.status==="Existing"?"info":"neutral"}>${pick.status}</${Badge}>
            <button class="icon-btn" style=${{width:"28px",height:"28px"}} onClick=${()=>setPick(null)}><${Icon} name="close" size=${14}/></button>
          </div>
          <h3 style=${{margin:"4px 0"}}>${pick.businessName}</h3>
          <div class="muted" style=${{fontSize:"12px",marginBottom:"12px"}}>${pick.segment} · ${pick.province}</div>
          ${pick.status==="Existing" ? html`<div class="row between" style=${{fontSize:"12.5px",marginBottom:"6px"}}>
              <span class="muted">Sales value</span><b>${moneyC(pick.salesValue)}</b></div>
            <div class="row between" style=${{fontSize:"12.5px",marginBottom:"12px"}}>
              <span class="muted">Trading</span><span>${pick.tradingStatus}</span></div>`
          : html`<div class="row between" style=${{fontSize:"12.5px",marginBottom:"6px"}}>
              <span class="muted">Potential</span><b>${pick.potentialScore}/100 <span class=${"grade gr-"+pick.grade} style=${{display:"inline-grid",verticalAlign:"middle",width:"20px",height:"20px"}}>${pick.grade}</span></b></div>
            <div class="row between" style=${{fontSize:"12.5px",marginBottom:"12px"}}>
              <span class="muted">Rating</span><span>★ ${pick.rating} (${num(pick.reviewCount)})</span></div>`}
          <div class="row" style=${{gap:"8px"}}>
            ${pick.status==="Existing" && html`<${Btn} variant="primary" size="sm" icon="eye"
              onClick=${()=>nav("customer",{id:pick.id})}>Full Detail</${Btn}>`}
            <${Btn} variant="ghost" size="sm" icon="area" onClick=${()=>nav("area",{province:pick.province})}>Area</${Btn}>
          </div>
        </div>
      </div>`}
    </div>
  </div>`;
}
