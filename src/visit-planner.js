// ไม่นำเข้า fetchDrivingRoute / fmtKm / fmtDuration / legMinutes อีกต่อไป
// เพราะแผงนี้ไม่ใช้บริการคำนวณเส้นทาง และไม่แสดงตัวเลขระยะทาง/เวลาเดินทางแล้ว
import {html, useState, useEffect, useRef, Icon, segTH, provinceTH, districtTH} from "./lib.js";
import {basemap} from "./basemap.js";
import {clusterCustomers, clusterRoute, computeRoute, optimizeOrder, haversine} from "./visit.js";
import {PLAN_TODAY, deriveStatus, overdueAppt, beDate} from "./visit-rounds.js";

// สรุป "งานเข้าพบวันนี้" ของ TC — derive สดจากรอบการเข้าพบของLeadในจังหวัดที่รับผิดชอบ (ไม่มี cron)
function daySummary(db, office){
  const ps = ((db&&db.prospects)||[]).filter(p=>p.province===office.province);
  let visited=0, appt=0, overdue=0, lastAppt=null;
  ps.forEach(p=>{ const r=p.visitRounds||[];
    if(r.some(x=>x.status==="เสร็จสิ้น" && String(x.doneDate||"").slice(0,10)===PLAN_TODAY)) visited++;
    if(deriveStatus(r)==="appointment") appt++;
    if(overdueAppt(r)) overdue++;
    r.forEach(x=>{ if(x.status==="นัดแล้ว" && x.apptDate && (!lastAppt||x.apptDate>lastAppt)) lastAppt=x.apptDate; });
  });
  return { visited, appt, overdue, lastAppt };
}

// สรุปพื้นที่ของแผนจากจุดที่เลือกไว้จริง — หาจังหวัดที่มีจุดมากที่สุด แล้วรวบอำเภอที่ไม่ซ้ำในจังหวัดนั้น
function planArea(plan){
  if(!plan || !plan.length) return null;
  const นับจังหวัด = {};
  plan.forEach(c=>{ if(c.province) นับจังหวัด[c.province] = (นับจังหวัด[c.province]||0)+1; });
  const เรียง = Object.entries(นับจังหวัด).sort((a,b)=>b[1]-a[1]);
  if(!เรียง.length) return null;
  const จังหวัดหลัก = เรียง[0][0];
  const อำเภอ = [...new Set(plan.filter(c=>c.province===จังหวัดหลัก).map(c=>c.district).filter(Boolean))].map(districtTH);
  return { จังหวัด: provinceTH(จังหวัดหลัก), อำเภอ, จังหวัดอื่น: เรียง.length-1, รวม: plan.length };
}
// สัญลักษณ์สีตามเกรดLead (เฉพาะLeadเท่านั้นที่มีเกรดในระบบ)
const สีเกรด = g => g==="A" ? "🟢" : g==="B" ? "🟡" : "⚪";

const L = window.L;
const CLUSTER_COLORS = ["#38bdf8","#ff3b5c","#ffb02e","#8a7bff","#ff7a2e","#33d69f","#ff5a5a","#f472b6"];

// ── Customer Visit Planning panel — lives on the map (no navigation) ──
// Selected customers are grouped into geographic CLUSTERS; each cluster gets a nearest-neighbour visit
// order with per-leg distance/time. Routes recompute automatically whenever the plan changes.
// แนะนำLeadที่ควรไปเยี่ยมต่อ — จับคู่กับลูกค้าเก่าที่ใกล้ที่สุดเพื่ออ้างอิงเส้นทาง
// rule-based ล้วน: คัดLeadคะแนนสูงสุด 10 ราย (ตามจังหวัดของ office) แล้วหาลูกค้าเก่าที่ใกล้สุดของแต่ละราย
function buildNearbyRecommendations(office, allCustomers, allProspects){
  const cs = allCustomers.filter(c=>c.province===office.province);
  const ps = allProspects.filter(p=>p.province===office.province)
    .sort((a,b)=>b.potentialScore-a.potentialScore).slice(0,10);
  return ps.map(p=>{
    let nearest=null, minD=Infinity;
    cs.forEach(c=>{ const d=haversine(p,c); if(d<minD){ minD=d; nearest=c; } });
    return {...p, nearestCustomer:nearest, distanceKm:nearest?+minD.toFixed(1):null};
  });
}

export function VisitPlanner({db, office, plan, setPlan, route, setRoute, savePlan, plans, activePlanId, setActivePlanId, createPlan, deletePlan, renamePlan, onPickCustomers, visitDate, setVisitDate}){
  const [justSaved, setJustSaved] = useState(false);
  const [showPlanMenu, setShowPlanMenu] = useState(false);
  const [newPlanName, setNewPlanName] = useState("");
  const activePlan = plans && plans.find(p=>p.id===activePlanId);
  const [open, setOpen] = useState(false);
  const count = plan.length;

  // cluster + route the selected customers (auto — recomputed on every plan change)
  const clusters = count ? clusterCustomers(plan, 50, office) : [];
  const routes = clusters.map(cl=>clusterRoute(office, cl));

  // keep the MAIN map's route overlay in sync (a single path threading the clusters, office → …)
  useEffect(()=>{
    if(!plan.length){ setRoute(null); return; }
    const flat = clusterCustomers(plan, 50, office).flatMap(cl=>optimizeOrder(office, cl));
    setRoute(computeRoute(office, flat));
  },[plan]);

  const remove = id => setPlan(plan.filter(x=>x.id!==id));
  const clearAll = ()=> setPlan([]);

  // collapsed → floating pill with the selected-count badge
  if(!open) return html`<button class="vp-pill" onClick=${()=>setOpen(true)}>
    <${Icon} name="route" size=${16} color="#ff3b5c"/><span>แผนการเข้าพบ</span>
    ${count>0 && html`<span class="vp-count">${count}</span>`}
    <style>${CSS}</style>
  </button>`;

  return html`<div class="vp-panel">
    <div class="vp-head">
      <div class="row" style=${{gap:"9px"}}>
        <${Icon} name="route" size=${16} color="#ff3b5c"/>
        <b style=${{fontSize:"13.5px"}}>แผนการเข้าพบลูกค้า</b>
        ${count>0 && html`<span class="vp-count sm">${count}</span>`}
      </div>
      <button class="vp-x" onClick=${()=>setOpen(false)} aria-label="ย่อ"><${Icon} name="chevron" size=${15}/></button>
    </div>

    <!-- เนื้อหาทั้งหมดใต้หัวแผงเลื่อนรวมกันในกล่องเดียว — เวลาเลื่อนลง สรุปงานวันนี้/เลือกแผน/จุดเริ่มต้น/วันที่ จะเลื่อนหายไป เปิดพื้นที่ให้ปุ่ม "เลือกลูกค้า" เสมอ -->
    <div class="vp-scroll">
    <!-- (นำสรุป "งานเข้าพบวันนี้" ออกตามคำขอ) -->

    <!-- จุดเริ่มต้นเส้นทาง = ที่ตั้งสาขา Barter ในจังหวัดที่รับผิดชอบ (ไม่ใช่สำนักงานใหญ่กรุงเทพฯ จุดเดียวทั้งประเทศ) -->
    <div class="vp-startbar">
      <span class="vp-start-ic"><${Icon} name="pin" size=${13} color="#ff3b5c"/></span>
      <div style=${{minWidth:0}}>
        <div class="vp-start-lb">จุดเริ่มต้น (สาขา)</div>
        <div class="vp-start-nm">${office?office.businessName:"—"}</div>
      </div>
    </div>

    ${plans && html`<div class="vp-plans">
      <button class="vp-plan-current" onClick=${()=>setShowPlanMenu(v=>!v)}>
        <span style=${{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>${activePlan?activePlan.name:"แผนที่ 1"}${activePlan&&!activePlan.saved?" (ยังไม่บันทึก)":""}</span>
        <${Icon} name="chevron" size=${13} style=${{transform:showPlanMenu?"rotate(180deg)":"none",flex:"none"}}/>
      </button>
      ${showPlanMenu && html`<div class="vp-plan-menu">
        ${plans.map(p=>html`<div key=${p.id} class=${"vp-plan-item"+(p.id===activePlanId?" active":"")}>
          <button class="vp-plan-select" onClick=${()=>{ setActivePlanId(p.id); setShowPlanMenu(false); }}>
            <span style=${{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>${p.name}</span>
            <span class="dim" style=${{fontSize:"11px",flex:"none"}}>${p.customers.length} ราย${p.saved?" · บันทึกแล้ว":""}</span>
          </button>
          ${plans.length>1 && html`<button class="vp-plan-del" onClick=${()=>{ if(confirm('ลบแผน "'+p.name+'" ?')) deletePlan(p.id); }} aria-label="ลบแผน">
            <${Icon} name="close" size=${13}/></button>`}
        </div>`)}
        <div class="vp-plan-new">
          <input class="vp-plan-input" placeholder="ชื่อแผนใหม่…" value=${newPlanName}
            onInput=${e=>setNewPlanName(e.target.value)}
            onKeyDown=${e=>{ if(e.key==="Enter" && newPlanName.trim()){ createPlan(newPlanName.trim()); setNewPlanName(""); setShowPlanMenu(false); } }}/>
          <button class="vp-plan-add" onClick=${()=>{ if(newPlanName.trim()){ createPlan(newPlanName.trim()); setNewPlanName(""); setShowPlanMenu(false); } }}>
            <${Icon} name="plus" size=${14}/></button>
        </div>
      </div>`}
    </div>`}

    <!-- วันที่เข้าพบตามแผน — กำหนดก่อนวางแผน · ใช้เป็น "วันที่นัดหมาย" ในหน้ารายละเอียดLeadตอนปิดดีล -->
    <div class="vp-datebar">
      <label class="vp-date-lb"><${Icon} name="clock" size=${14} color="#ff3b5c"/> วันที่เข้าพบตามแผน</label>
      <input class="vp-date-in" type="date" value=${visitDate||""} onInput=${e=>setVisitDate&&setVisitDate(e.target.value)}/>
    </div>

    <!-- สรุปพื้นที่แผนงาน — คำนวณจากจังหวัด/อำเภอของจุดที่เลือกไว้จริง (แทนที่ "จุดเริ่มต้น" เดิม) -->
    ${(()=>{ const พื้นที่ = planArea(plan); if(!พื้นที่) return "";
      return html`<div class="vp-office">
        <span class="vp-office-ic"><${Icon} name="pin" size=${14} color="#ff3b5c"/></span>
        <div style=${{flex:1,minWidth:0}}>
          <div class="vp-office-lb">📌 สรุปพื้นที่แผนงาน</div>
          <div class="vp-office-nm">จังหวัด: ${พื้นที่.จังหวัด}${พื้นที่.อำเภอ.length?` (โซน ${พื้นที่.อำเภอ.join(" / ")})`:""}</div>
          <div class="vp-area-sub">รายการที่เลือกไว้: ${พื้นที่.รวม} สถานที่${พื้นที่.จังหวัดอื่น?` · มีอีก ${พื้นที่.จังหวัดอื่น} จังหวัด`:""}</div>
        </div>
      </div>`; })()}

    <div class="vp-body">
      ${count===0 ? html`
        <div class="vp-empty">
          <div class="vp-empty-ic"><${Icon} name="target" size=${26} color="#ff3b5c"/></div>
          <div class="vp-empty-t">เริ่มสร้างแผนการเข้าพบลูกค้า</div>
          <div class="vp-empty-s">เลือกลูกค้าจากแผนที่แล้วกด "เพิ่มในแผนการเข้าพบ" เพื่อจัดกลุ่มและวางเส้นทาง</div>
          <button class="vp-btn primary" style=${{marginTop:"14px"}} onClick=${()=>{ setOpen(false); onPickCustomers && onPickCustomers(); }}>เลือกลูกค้า</button>
        </div>`
      : html`
        <${PlanMiniMap} office=${office} clusters=${clusters} routes=${routes}/>
        <div class="vp-mapnote">เส้นแสดงลำดับการเข้าพบโดยประมาณ ไม่ใช่เส้นทางถนนจริง</div>
        <div class="vp-overall" style=${{gridTemplateColumns:"repeat(2,1fr)"}}>
          <div><b>${clusters.length}</b> กลุ่ม</div><div><b>${count}</b> สถานที่</div>
        </div>

        <!-- รายชื่อสถานที่พร้อมรายละเอียดจริงของแต่ละจุด (ประเภทธุรกิจ · เกรด · อำเภอ) -->
        <div class="vp-cl-head" style=${{marginTop:"14px"}}><b>📍 รายชื่อสถานที่ในกลุ่มนี้</b></div>
        ${routes.flatMap(r=>r.order).map((c,i)=>{
          const เป็นLead = c.status!=="Existing";
          return html`<div key=${c.id} class="vp-stop">
            <span class="vp-seq">${i+1}</span>
            <div style=${{flex:1,minWidth:0}}>
              <div class="vp-nm">${c.businessName}</div>
              <div class="vp-meta">
                🏷️ ${segTH(c.segment)}
                ${เป็นLead && c.grade ? ` | ${สีเกรด(c.grade)} เกรด ${c.grade}` : ""}
                ${c.district ? ` | 📍 ${districtTH(c.district)}` : ` | 📍 ${provinceTH(c.province)}`}
              </div>
            </div>
            <button class="vp-remove" onClick=${()=>remove(c.id)} title="ลบออกจากแผน" aria-label="ลบออกจากแผน">
              <${Icon} name="trash" size=${13}/></button>
          </div>`; })}

        ${db && html`<div class="vp-recommend">
          <div class="vp-cl-head" style=${{marginTop:"14px"}}><b>Leadใกล้เคียงที่ควรไปเยี่ยมต่อ</b></div>
          ${buildNearbyRecommendations(office, db.customers, db.prospects).map(p=>html`<div key=${p.id} class="vp-stop" style=${{cursor:"default"}}>
            <div style=${{flex:1,minWidth:0}}>
              <div class="vp-nm">${p.businessName} <span class="vp-cl-meta">${segTH(p.segment)}</span></div>
              <div class="vp-meta">${provinceTH(p.province)}</div>
              ${p.nearestCustomer && html`<div class="vp-leg">📍 อยู่ใกล้ลูกค้าเดิม "${p.nearestCustomer.businessName}" ที่สุด</div>`}
            </div>
          </div>`)}
          ${buildNearbyRecommendations(office, db.customers, db.prospects).length===0 && html`<div class="dim" style=${{fontSize:"13px",padding:"8px 0"}}>ไม่พบLeadในจังหวัดนี้</div>`}
        </div>`}
      `}
    </div>
    </div>

    <!-- แถวปุ่มท้ายแผง: เรียงลงเป็นคอลัมน์เต็มความกว้าง ระยะห่างเท่ากัน (เหลือ 2 ปุ่มก็ยังพอดี ไม่มีช่องว่างค้าง) -->
    ${count>0 && html`<div class="vp-foot">
      <button class="vp-btn primary" onClick=${()=>{ if(!visitDate){ alert("กรุณาเลือกวันที่เข้าพบตามแผนก่อนบันทึก"); return; } savePlan && savePlan(); setJustSaved(true); setTimeout(()=>setJustSaved(false),2200); }}>
        <${Icon} name="check" size=${14} color="#04121a"/>${justSaved?"บันทึกแล้ว ✓":"บันทึกแผนนี้"}</button>
      <button class="vp-btn ghost" onClick=${clearAll}>ล้างรายการทั้งหมด</button>
    </div>`}
    <style>${CSS}</style>
  </div>`;
}

// small Leaflet map — selected customers coloured by cluster, per-cluster route lines, office marker
function PlanMiniMap({office, clusters, routes}){
  const ref = useRef();
  const sig = clusters.map(cl=>cl.map(c=>c.id).join(",")).join("|");
  useEffect(()=>{
    if(!ref.current) return;
    const map = L.map(ref.current,{zoomControl:false,attributionControl:true});
    basemap(map, "th");
    const all=[[office.latitude,office.longitude]];
    L.circleMarker([office.latitude,office.longitude],{radius:6,color:"#fff",weight:2,fillColor:"#111",fillOpacity:1}).addTo(map).bindTooltip("จุดเริ่มต้น · "+(office.businessName||""));
    let alive=true;
    routes.forEach((r,gi)=>{ const col=CLUSTER_COLORS[gi%CLUSTER_COLORS.length];
      const pts=r.order.map(c=>[c.latitude,c.longitude]); pts.forEach(p=>all.push(p));
      // เส้นตรงเชื่อมจุดตามลำดับเท่านั้น (เส้นประ) — ไม่เรียกบริการคำนวณเส้นทางใดๆ อีกต่อไป
      if(pts.length>1) L.polyline(pts,{color:col,weight:2,dashArray:"4 4",opacity:.85}).addTo(map);
      r.order.forEach((c,i)=>L.circleMarker([c.latitude,c.longitude],{radius:7,color:"#04121a",weight:1,fillColor:col,fillOpacity:1})
        .addTo(map).bindTooltip(`${i+1}. ${c.businessName}`));
    });
    map.fitBounds(L.latLngBounds(all).pad(0.3));
    setTimeout(()=>map.invalidateSize(),60);
    return ()=>{ alive=false; map.remove(); };
  },[sig]);
  return html`<div ref=${ref} class="vp-minimap"></div>`;
}


const CSS = `
/* ย้ายมาอยู่กลุ่มปุ่มควบคุมขวาบน (ใต้ปุ่มเลเยอร์) แทนการลอยเดี่ยวๆ มุมล่างขวาเดิม */
.vp-pill{position:absolute;right:16px;top:70px;z-index:620;display:inline-flex;align-items:center;gap:9px;
  font-family:var(--font);font-size:12.5px;font-weight:600;color:var(--txt);cursor:pointer;
  padding:11px 16px;border-radius:24px;background:var(--panel);border:1px solid var(--stroke2);
  backdrop-filter:blur(12px);box-shadow:0 14px 40px rgba(0,0,0,.4);animation:vpIn .26s ease}
.vp-pill:hover{border-color:var(--accent)}
/* ปุ่ม/แผงแผนการเข้าพบตรึงตำแหน่งคงที่เสมอ ไม่ขยับหนีแผงเลเยอร์อีกต่อไป
   แผงเลเยอร์มี z สูงกว่า (700 > 620) จึงวางซ้อนทับปุ่มนี้ได้ตอนเปิด ซึ่งเป็นพฤติกรรมที่ต้องการ */
.vp-count{display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 6px;border-radius:11px;
  font-size:12.5px;font-weight:800;color:#04121a;background:linear-gradient(135deg,#ff3b5c,#e60023)}
.vp-count.sm{min-width:18px;height:18px;font-size:12px}
.vp-panel{position:absolute;right:16px;top:70px;z-index:620;width:338px;max-width:calc(100vw - 32px);
  max-height:calc(100% - 86px);display:flex;flex-direction:column;font-family:var(--font);
  background:var(--panel);border:1px solid var(--stroke2);border-radius:16px;
  box-shadow:0 24px 64px rgba(0,0,0,.5);backdrop-filter:blur(14px);animation:vpPop .3s cubic-bezier(.2,.9,.25,1)}
.vp-head{display:flex;align-items:center;justify-content:space-between;padding:13px 14px;border-bottom:1px solid var(--stroke);flex:none}
/* กล่องเลื่อนรวมทุกส่วนใต้หัวแผง — หัวแผงคงที่บน + ปุ่มท้ายคงที่ล่าง · ที่เหลือเลื่อนได้หมด (บล็อกธรรมดา เพื่อให้ overflow เลื่อนจริง ไม่ใช่บีบเนื้อหา) */
.vp-scroll{flex:1;min-height:0;overflow-y:auto}
.vp-daybar{padding:10px 14px;border-bottom:1px solid var(--stroke);background:rgba(255, 59, 92,.05)}
.vp-day-t{font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
.vp-day-row{display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:var(--muted)}
.vp-day-row b{color:var(--txt);font-size:13px}
.vp-day-warn{color:#e60023}.vp-day-warn b{color:#e60023}
.vp-day-sub{margin-top:5px;font-size:11.5px;color:var(--muted)}
.vp-startbar{display:flex;align-items:center;gap:9px;padding:10px 14px;border-bottom:1px solid var(--stroke);background:rgba(255, 59, 92,.05)}
.vp-start-ic{flex:none;width:26px;height:26px;border-radius:8px;display:grid;place-items:center;background:rgba(255,122,168,.14)}
.vp-start-lb{font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.5px}
.vp-start-nm{font-size:12.5px;font-weight:700;color:var(--txt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vp-datebar{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;border-bottom:1px solid var(--stroke)}
.vp-date-lb{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:var(--txt)}
.vp-date-in{flex:none;padding:7px 10px;border-radius:8px;border:1px solid var(--stroke2);background:var(--bg);color:var(--txt);font-size:12.5px;font-family:var(--font)}
.vp-plans{position:relative;padding:0 14px 10px;border-bottom:1px solid var(--stroke)}
.vp-plan-current{width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;
  padding:8px 11px;border-radius:9px;background:rgba(255,122,168,.08);border:1px solid rgba(255,122,168,.25);
  color:var(--txt);font-size:12.5px;font-weight:600;cursor:pointer;font-family:var(--font)}
/* dropdown เลือกแผนการเข้าพบ — ใช้ Design token กลางเดียวกับ dropdown อื่นทั้งระบบ */
.vp-plan-menu{position:absolute;top:calc(100% - 4px);left:14px;right:14px;z-index:50;background:var(--dropdown-bg);
  border:var(--dropdown-border);border-radius:12px;box-shadow:var(--dropdown-shadow);padding:6px;max-height:240px;overflow-y:auto}
.vp-plan-item{display:flex;align-items:center;gap:4px;border-radius:8px}
.vp-plan-item:hover{background:var(--dropdown-hover-bg)}
.vp-plan-item.active{background:var(--dropdown-active-bg)}
.vp-plan-item.active .vp-plan-select{color:var(--dropdown-active-text);font-weight:700}
.vp-plan-select{flex:1;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 9px;
  background:none;border:none;color:var(--dropdown-text);font-size:12.5px;cursor:pointer;text-align:left;font-family:var(--font)}
.vp-plan-del{flex:none;width:26px;height:26px;display:grid;place-items:center;border-radius:6px;
  background:none;border:none;color:var(--dim);cursor:pointer}
.vp-plan-del:hover{background:rgba(255,90,90,.12);color:#ff5a5a}
.vp-plan-new{display:flex;gap:6px;padding:8px 4px 4px;margin-top:4px;border-top:1px solid var(--stroke)}
.vp-plan-input{flex:1;padding:7px 9px;border-radius:8px;border:1px solid var(--stroke2);background:var(--bg);
  color:var(--txt);font-size:12px;font-family:var(--font)}
.vp-plan-add{flex:none;width:30px;height:30px;display:grid;place-items:center;border-radius:8px;
  background:var(--accent2);border:none;color:#04121a;cursor:pointer}
.vp-x{width:26px;height:26px;border:none;border-radius:8px;cursor:pointer;background:rgba(255,255,255,.05);color:var(--muted);transition:.15s}
.vp-x:hover{background:rgba(255,255,255,.1);color:var(--txt)}
.vp-x svg{transform:rotate(90deg)}
.vp-office{display:flex;align-items:center;gap:10px;padding:11px 14px;border-bottom:1px solid var(--stroke);background:rgba(255,122,168,.05)}
.vp-office-ic{flex:none;width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:rgba(255,122,168,.14)}
.vp-office-lb{font-size:11.5px;color:var(--dim);text-transform:uppercase;letter-spacing:.6px}
/* สรุปพื้นที่แผนงานอาจยาวหลายอำเภอ จึงให้ขึ้นบรรทัดใหม่ได้ ไม่ตัดท้ายทิ้ง */
.vp-office-nm{font-size:12.5px;font-weight:600;color:var(--txt);line-height:1.5;word-break:break-word}
.vp-area-sub{margin-top:2px;font-size:11.5px;color:var(--muted)}
/* หมายเหตุใต้แผนที่ย่อ — ย้ำว่าเส้นเป็นเส้นตรงประมาณการ ไม่ใช่เส้นทางถนนจริง */
.vp-mapnote{margin:-6px 0 12px;font-size:11px;line-height:1.5;color:var(--muted);
  background:rgba(255, 59, 92,.07);border:1px solid rgba(255, 59, 92,.2);border-radius:9px;padding:7px 10px}
.vp-body{padding:12px 14px}
.vp-empty{text-align:center;padding:22px 6px 10px}
.vp-empty-ic{width:56px;height:56px;margin:0 auto 12px;border-radius:16px;display:grid;place-items:center;background:rgba(255, 59, 92,.12)}
.vp-empty-t{font-size:14px;font-weight:700;color:var(--txt)}
.vp-empty-s{font-size:12px;color:var(--muted);margin-top:6px;line-height:1.6}
.vp-minimap{height:170px;border-radius:12px;overflow:hidden;border:1px solid var(--stroke2);margin-bottom:12px}
.vp-overall{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:14px;text-align:center}
.vp-overall>div{padding:8px 4px;border-radius:10px;background:rgba(255, 59, 92,.07);border:1px solid rgba(255, 59, 92,.2);font-size:12.5px;color:var(--muted)}
.vp-overall b{display:block;font-size:14px;color:var(--txt);line-height:1.3}
.vp-cluster{margin-bottom:14px;border:1px solid var(--stroke2);border-radius:12px;overflow:hidden;background:var(--surface)}
.vp-cl-head{display:flex;align-items:center;gap:8px;padding:9px 11px;background:rgba(255,255,255,.03);border-bottom:1px solid var(--stroke)}
.vp-cl-dot{width:11px;height:11px;border-radius:50%;flex:none}
.vp-cl-head b{font-size:12.5px}
.vp-cl-meta{margin-left:auto;font-size:12.5px;color:var(--dim)}
.vp-stop{display:flex;align-items:flex-start;gap:10px;padding:10px 11px;border-top:1px solid var(--stroke)}
.vp-stop:first-of-type{border-top:none}
.vp-seq{flex:none;width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:800;
  color:#04121a;background:linear-gradient(135deg,#ff3b5c,#e60023);margin-top:1px}
.vp-nm{font-size:12.5px;font-weight:600;color:var(--txt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vp-meta{font-size:12.5px;color:var(--muted);margin-top:2px}
.vp-leg{font-size:12px;color:var(--accent2);margin-top:5px;line-height:1.4}
.vp-remove{flex:none;width:24px;height:24px;border:none;border-radius:7px;cursor:pointer;background:transparent;color:var(--muted);transition:.15s}
.vp-remove:hover{background:rgba(255,90,60,.16);color:#ff8a70}
.vp-foot{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border-top:1px solid var(--stroke);flex:none}
.vp-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;font-family:var(--font);font-size:13px;font-weight:600;
  cursor:pointer;border-radius:10px;padding:11px 14px;transition:.16s;width:100%}
.vp-btn.primary{border:none;color:#04121a;background:linear-gradient(135deg,#ff3b5c,#e60023);box-shadow:0 6px 16px rgba(255,122,168,.3)}
.vp-btn.primary:hover{box-shadow:0 9px 22px rgba(255,122,168,.45)}
.vp-btn.ghost{background:transparent;border:1px solid var(--stroke2);color:var(--muted)}
.vp-btn.ghost:hover{color:var(--txt);border-color:rgba(120,160,220,.4)}
@keyframes vpIn{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:none}}
@keyframes vpPop{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:none}}
@media (max-width:520px){.vp-panel{width:calc(100vw - 32px)}}
`;
