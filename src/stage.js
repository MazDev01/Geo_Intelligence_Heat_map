import {html, useState, useEffect, useRef, useMemo, Icon, num, SEGMENTS, SEG_COLOR, SEG_ICON, STATUS_COLOR, segTH, countryTH, provinceTH} from "./lib.js";
import {Btn, Toggle, Badge} from "./ui.js";
import {Globe} from "./globe.js";
import {LeafletMap} from "./lmap.js";
import {filterData} from "./data.js";
import {CategoryChips} from "./category-chips.js";

// Post-login globe picker: a FIXED shortlist of four featured provinces.
// "Pattaya" ใช้ key นี้ทั้งระบบ โดยอิงขอบเขต/พิกัดของพื้นที่ชายฝั่งตะวันออกเดิม
const FEATURED_PROVINCES = [
  {province:"Bangkok Metropolis", label:"กรุงเทพมหานคร"},
  {province:"Chiang Mai",         label:"เชียงใหม่"},
  {province:"Phuket",             label:"ภูเก็ต"},
  {province:"Pattaya",            label:"พัทยา"},
];
const CALLOUT_CSS = `
/* ── หน้าเลือกจังหวัด: 3 คอลัมน์ 30/40/30 — การ์ดคงที่ซ้าย-ขวา ลูกโลกอยู่ตรงกลาง ──
   การ์ดอยู่นิ่งเสมอ ไม่ขยับตามการหมุนของลูกโลก (ไม่มีการฉายพิกัด 3 มิติเป็นพิกัดจออีกต่อไป) */
/* gap ต้องเป็น 0 — ไม่งั้น 30%+40%+30% (=100%) บวก gap แล้วล้นกรอบ ทำให้การ์ดฝั่งขวาโดนตัด
   เว้นระยะระหว่างคอลัมน์ด้วย padding ภายในคอลัมน์แทน */
.pick-grid{position:absolute;inset:0;z-index:8;display:grid;grid-template-columns:30% 40% 30%;
  align-items:center;pointer-events:none;padding:92px 20px 72px;gap:0}
.pick-col{display:flex;flex-direction:column;justify-content:center;gap:16px;pointer-events:none;min-width:0}
/* เขยิบการ์ด 2 ฝั่งเข้ามาใกล้กลางจอ (ลดช่องว่างกลางที่กว้างเกิน) ด้วย padding ด้านใน */
.pick-col.left{padding-right:10px;padding-left:76px;align-items:flex-start}
.pick-col.right{padding-left:10px;padding-right:76px;align-items:flex-end}
.pick-head{position:absolute;top:16px;left:50%;transform:translateX(-50%);z-index:20;text-align:center;
  pointer-events:none;width:min(92%,760px)}
.pick-title{color:#fff;font-size:19px;font-weight:700;text-shadow:0 2px 12px rgba(0,0,0,.6)}
.pick-sub{color:#fff;opacity:.85;font-size:13.5px;font-weight:500;text-shadow:0 2px 12px rgba(0,0,0,.7);margin-top:3px}
.pick-card{width:100%;max-width:292px;pointer-events:auto;cursor:pointer;color:var(--txt);text-align:left;display:block;
  background:rgba(255,255,255,.9);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
  border:1px solid rgba(30,45,80,.14);border-radius:14px;padding:13px 14px;box-shadow:0 14px 40px rgba(0,0,0,.35);
  font-family:var(--font);transition:transform .16s ease,border-color .16s,box-shadow .16s}
.pick-card:hover,.pick-card.on{transform:translateY(-2px) scale(1.03);border-color:var(--accent2);box-shadow:0 18px 52px rgba(230, 0, 35,.4)}
.pick-card:active{transform:scale(.98)}
.pick-card.is-clicking{animation:calloutFlash .45s ease}
@keyframes calloutFlash{0%{box-shadow:0 0 0 0 rgba(255, 59, 92,.6)}100%{box-shadow:0 0 0 26px rgba(255, 59, 92,0)}}
.pick-head-row{display:flex;align-items:center;gap:7px;margin-bottom:11px}
.pick-name{font-size:14.5px;font-weight:800;color:var(--txt);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pick-body{display:grid;grid-template-columns:1fr 1fr;gap:6px;text-align:center;margin-bottom:11px}
.pick-metric{display:flex;flex-direction:column;gap:2px;min-width:0}
.pick-num{font-size:21px;font-weight:800;line-height:1.05;color:var(--txt)}
.pick-num.p{color:#2563eb}
.pick-lab{font-size:10.5px;color:var(--muted);font-weight:500}
.pick-cta{display:flex;align-items:center;justify-content:center;gap:3px;width:100%;font-family:var(--font);
  font-size:11.5px;font-weight:700;color:var(--accent-deep,#b30019);cursor:pointer;
  background:rgba(255, 59, 92,.1);border:1px solid rgba(255, 59, 92,.34);border-radius:20px;padding:7px 10px}
.pick-card:hover .pick-cta{background:var(--accent,#e60023);border-color:var(--accent,#e60023);color:#fff}
/* จอแคบ: เหลือคอลัมน์เดียว เรียงการ์ดต่อกันและเลื่อนดูได้ */
@media (max-width:900px){
  .pick-grid{grid-template-columns:1fr;align-items:start;overflow-y:auto;padding:90px 16px 68px}
  .pick-col.left,.pick-col.right{padding-left:0;padding-right:0}
  .pick-col.right{align-items:stretch}
  .pick-card{max-width:none}
}
.globe-reset{position:absolute;top:18px;right:18px;z-index:22;pointer-events:auto;display:inline-flex;align-items:center;gap:6px;
  padding:8px 13px;border-radius:20px;font-family:var(--font);font-size:12px;font-weight:600;color:#fff;cursor:pointer;
  background:rgba(12,17,28,.7);border:1px solid rgba(255,255,255,.18);backdrop-filter:blur(10px);transition:.16s}
.globe-reset:hover{border-color:var(--accent2);color:#ffd0e0}
.globe-hint{position:absolute;right:18px;bottom:18px;z-index:10;pointer-events:none;display:flex;gap:9px;align-items:center;
  padding:8px 13px;border-radius:20px;font-size:11.5px;color:rgba(255,255,255,.82);
  background:rgba(12,17,28,.62);border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(10px)}
`;

export function GeoStage({db, mode, activeCountry, flyTarget, globeUnder, onArriveCountry, onSelectCountry, onSelectProvince,
    filters, setFilters, layers, setLayers, onPickProvince, onPickCustomer, onOpenReports, onOpenAddForm, focusProvince, highlightCustomer, onBackToGlobe, tourPanel, tourFocus, visitPlan, visitRoute, office, planRoutes,
    gsearch, setGsearch, searchResults, onPickProvinceZoom, onPickCustomerNav, lockProvince, leadOnly}){
  const areaByProvince = db.areaByProvince||{};
  const [layersOpen, setLayersOpen] = useState(true);    // แผงเลเยอร์เปิดอยู่เป็นค่าเริ่มต้น · กดไอคอนเลเยอร์เพื่อย่อ/ขยาย
  // โหมดแสดงผลแผนที่ปัจจุบันตามระดับซูม (heat/cluster/marker) — แผนที่แจ้งมาผ่าน onMapMode ใช้โชว์ legend ความหนาแน่นเฉพาะตอนซูมออก
  const [mapMode, setMapMode] = useState("heat");
  // โหมดสีแผนที่ (สว่าง=ค่าเริ่มต้น / มืด) — เป็น preference ส่วนตัว เก็บใน localStorage แยกจาก session (logout ไม่รีเซ็ต)
  const [mapDark, setMapDark] = useState(()=>{ try{ return localStorage.getItem("geoMapTheme")==="dark"; }catch(e){ return false; } });
  const toggleMapDark = ()=> setMapDark(v=>{ const nv=!v; try{ localStorage.setItem("geoMapTheme", nv?"dark":"light"); }catch(e){} return nv; });
  // คลิกนอก popover (หรือกดปุ่มไอคอนซ้ำ) → หุบกลับ
  useEffect(()=>{
    if(!layersOpen) return;
    const onDoc = e => { if(!e.target.closest || !e.target.closest('[data-tour="layers"]')) setLayersOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return ()=>document.removeEventListener("mousedown", onDoc);
  }, [layersOpen]);
  const featuredCards = FEATURED_PROVINCES.map(f=>({...f, area:areaByProvince[f.province]}));

  // ── หน้าเลือกจังหวัด: การ์ดคงที่ 2 ฝั่งซ้าย-ขวา (ไม่ขยับตามการหมุนของลูกโลก) ──
  const [hoverId, setHoverId]   = useState(null);   // การ์ดที่ชี้อยู่ → ส่งให้ลูกโลกหมุนโฟกัสจังหวัดนั้น
  const [clicking, setClicking] = useState(null);   // การ์ดที่เพิ่งคลิก (เอฟเฟกต์ก่อนบินเข้าจังหวัด)
  const stageRef = useRef();     // กล่อง .globe-stage
  const globeApi = useRef(null); // handle รีเซ็ตมุมมองจากลูกโลก
  // reset hover/clicking เมื่อออกจากโหมดลูกโลก และเมื่อเริ่มบิน (กันสถานะ hover ค้างข้ามรอบ/ตอนออกจากระบบ)
  useEffect(()=>{ if(mode!=="globe"){ setHoverId(null); setClicking(null); } },[mode]);
  useEffect(()=>{ if(flyTarget) setHoverId(null); },[flyTarget]);

  // หมุด 4 จังหวัด (พิกัดจริง) — area.center = [lng,lat] จึง lat=center[1], lng=center[0]
  const pins = useMemo(()=> featuredCards.filter(f=>f.area&&f.area.center)
    .map(f=>({id:f.province, lat:f.area.center[1], lng:f.area.center[0]})), [db.areaByProvince]);

  // คลิกการ์ด: โชว์เอฟเฟกต์ก่อน แล้วค่อยบินเข้าจังหวัดตาม flow เดิม (onSelectProvince — ไม่แตะ flyToBounds/maxZoom)
  const clickCard = f => { if(!f.area || clicking) return; setClicking(f.province);
    setTimeout(()=>{ onSelectProvince(f.province, [f.area.center[1], f.area.center[0]]); }, 250); };
  // การ์ดจังหวัดคงที่ (ใช้ทั้งคอลัมน์ซ้ายและขวา) — ชี้เพื่อให้ลูกโลกหมุนไปหาจังหวัด · คลิกเพื่อเข้าแผนที่วิเคราะห์
  const provinceCard = f => html`<div key=${f.province}
    class=${"pick-card"+(hoverId===f.province?" on":"")+(clicking===f.province?" is-clicking":"")}
    onMouseEnter=${()=>setHoverId(f.province)} onMouseLeave=${()=>setHoverId(null)}
    onClick=${()=>clickCard(f)}>
    <div class="pick-head-row">
      <${Icon} name="pin" size=${15} color="#ff3b5c"/>
      <span class="pick-name">${f.label}</span>
    </div>
    ${f.area ? html`<div class="pick-body">
      <div class="pick-metric"><span class="pick-num">${num(f.area.customerCount)}</span><span class="pick-lab">ลูกค้า</span></div>
      <div class="pick-metric"><span class="pick-num p">${num(f.area.prospectCount)}</span><span class="pick-lab">Lead</span></div>
    </div>` : html`<div style=${{fontSize:"11.5px",color:"var(--muted)",marginBottom:"11px"}}>กำลังโหลด…</div>`}
    <div class="pick-cta">ดูแผนที่วิเคราะห์ <${Icon} name="chevronR" size=${11}/></div>
  </div>`;

  const inCountry = !!activeCountry;
  const {customers, prospects} = mode==="map" && db.customers ? filterData(db, filters, activeCountry||"Thailand") : {customers:[],prospects:[]};

  // business-category visibility (filters markers) — driven by the category pills on the search bar
  const setSeg = s => setFilters(f=>({...f, segments:{...f.segments,[s]:!f.segments[s]}}));

  return html`<div class="globe-stage" ref=${stageRef}>
    ${(mode==="globe"||globeUnder) && html`<${Globe} countries=${db.countries} world=${db.world} flyTo=${flyTarget} onArrive=${onArriveCountry}
      pins=${pins} hover=${hoverId} apiRef=${globeApi}/>`}
    ${mode==="globe" && html`
      <button class="globe-reset" onClick=${()=>globeApi.current&&globeApi.current.resetView()} title="กลับมุมมองเริ่มต้น (เห็นครบทั้ง 4 จังหวัด)">
        <${Icon} name="refresh" size=${14}/> รีเซ็ตมุมมอง</button>
      ${!flyTarget && html`
        <!-- สรุปหัวข้อบนสุด (ลอยบนลูกโลกมืด จึงใช้สีขาวชัดเจน ไม่ใช้ var(--txt) ที่เป็นสีเข้ม) -->
        <div class="pick-head" data-tour="country">
          <div class="pick-title">🌍 เริ่มต้นการวิเคราะห์ตลาดเชิงพื้นที่ (GEO Intelligence)</div>
          <div class="pick-sub">ชี้ที่การ์ดเพื่อหมุนโลกไปยังจังหวัดนั้น · คลิกเพื่อเข้าสู่หน้าแผนที่วิเคราะห์</div>
        </div>
        <!-- 3 คอลัมน์ 30/40/30 — การ์ดคงที่ซ้าย 2 ใบ / ลูกโลกกลาง / การ์ดคงที่ขวา 2 ใบ
             การ์ดอยู่นิ่งตลอด ไม่ผูกกับพิกัดฉายของหมุดบนลูกโลกอีกต่อไป -->
        <div class="pick-grid">
          <div class="pick-col left">${featuredCards.slice(0,2).map(f=>provinceCard(f))}</div>
          <div class="pick-col mid"></div>
          <div class="pick-col right">${featuredCards.slice(2,4).map(f=>provinceCard(f))}</div>
        </div>
        <!-- คำแนะนำ ย้ายมาเป็น floating tooltip มุมขวาล่างของลูกโลก -->
        <div class="globe-hint"><span>ลากเพื่อหมุน</span><span>·</span><span>เลื่อนเพื่อซูม</span><span>·</span><span>เลือกจังหวัดเพื่อเข้าชม</span></div>
      `}
      <style>${CALLOUT_CSS}</style>`}
    ${mode==="map" && html`
      <${LeafletMap} db=${db} filters=${filters} layers=${layers} country=${activeCountry||"Thailand"} dark=${mapDark}
        focusProvince=${focusProvince} highlight=${highlightCustomer} focusPoint=${tourFocus} onPickArea=${onPickProvince} onPickCustomer=${onPickCustomer}
        onMapMode=${setMapMode} plan=${visitPlan} route=${visitRoute} office=${office} planRoutes=${planRoutes} lockProvince=${lockProvince}/>

      <!-- แถบนำทางกระชับแถวเดียว: [ค้นหา] [หมวดหมู่ธุรกิจ] ───ดันขวา─── [เพิ่มลูกค้า] [รายงาน]
           หลักการ: ตัวกรอง (หมวดหมู่) อยู่ซ้าย/กลาง · ปุ่ม Action (เพิ่มข้อมูล/รายงาน) แยกไปอยู่ขวาสุด -->
      <div class="map-nav" style=${{position:"absolute",top:"16px",left:"56px",right:"16px",zIndex:500,display:"flex",alignItems:"center",gap:"10px"}}>
      <div data-tour="search" style=${{position:"relative",width:"300px",maxWidth:"100%",flex:"none"}}>
        <div class="searchbox map-fx" style=${{width:"100%",position:"relative",background:"var(--panel)",
          border:"1px solid var(--stroke2)",backdropFilter:"blur(14px)",boxShadow:"var(--shadow)"}}>
          <${Icon} name="search" size=${15}/>
          <input placeholder="ค้นหาลูกค้า, จังหวัด, ที่อยู่…" value=${gsearch} onInput=${e=>setGsearch(e.target.value)}/>
        </div>
        ${((searchResults?.areas?.length>0)||(searchResults?.people?.length>0)) && html`<div class="dropdown" style=${{position:"absolute",top:"calc(100% + 8px)",left:0,width:"100%",maxHeight:"380px",overflowY:"auto",zIndex:30}}>
          ${searchResults.areas.length>0 && html`<div class="dd-label">จังหวัด</div>`}
          ${searchResults.areas.map((a,i)=>html`<div key=${"a"+i} class="dd-item" onClick=${()=>{onPickProvinceZoom(a.province);setGsearch("");}}>
            <${Icon} name="area" size=${15}/><div><div style=${{fontSize:"12.5px",fontWeight:600}}>${a.title}</div>
            <div class="dim" style=${{fontSize:"12.5px"}}>${a.sub}</div></div></div>`)}
          ${searchResults.people.length>0 && html`<div class="dd-label">ลูกค้า / Lead</div>`}
          ${searchResults.people.map((p,i)=>html`<div key=${"p"+i} class="dd-item" onClick=${()=>{onPickCustomerNav(p);setGsearch("");}}>
            <${Icon} name="building" size=${15}/><div><div style=${{fontSize:"12.5px",fontWeight:600}}>${p.title}</div>
            <div class="dim" style=${{fontSize:"12.5px"}}>${p.sub}</div></div></div>`)}
        </div>`}
      </div>

      <!-- ตัวกรองหมวดหมู่ธุรกิจ 12 หมวด — แถวเดียว เลื่อนแนวนอนได้ (data-tour="segments") -->
      <div data-tour="segments" style=${{flex:"1",minWidth:0,display:"flex"}}>
        <${CategoryChips} active=${filters.segments} onToggle=${setSeg}
          onSetAll=${v=>setFilters(f=>({...f, segments:Object.fromEntries(SEGMENTS.map(s=>[s,v]))}))}/>
      </div>

      <!-- ปุ่ม Action (ขวาสุด · flex-shrink-0) — เหลือเฉพาะ "เพิ่มลูกค้า/Lead" สไตล์การ์ดขาวเรียบ (มีแต่ + เป็นสีแบรนด์)
           ปุ่ม "รายงาน" ย้ายไปไว้บน header (มุมขวาบน) เพราะเป็นการเปิด "อีกหน้าหนึ่ง" ไม่ใช่ควบคุมแผนที่ -->
      <div class="map-nav-actions" style=${{display:"flex",gap:"9px",alignItems:"center",flex:"none"}}>
        ${onOpenAddForm && html`<button class="tool-pill" title=${leadOnly?"เพิ่มLeadด้วยตนเอง":"เพิ่มลูกค้า/Leadด้วยตนเอง"}
          style=${{fontWeight:600,background:"var(--panel)",borderColor:"var(--stroke2)",color:"var(--txt)"}} onClick=${onOpenAddForm}>
          <${Icon} name="plus" size=${14} color="var(--accent)"/> ${leadOnly?"เพิ่มLead":"เพิ่มลูกค้า/Lead"}</button>`}
      </div>
      </div>

      <!-- กลุ่มปุ่มควบคุมแผนที่ (ขวาบน) — z สูงกว่าปุ่ม "แผนการเข้าพบ" (620) เพื่อให้แผงวางซ้อนทับปุ่มได้ตอนเปิด
           (ปุ่มนั้นตรึงตำแหน่งคงที่แล้ว ไม่ขยับหนีอีกต่อไป) · ยังต่ำกว่า drawer รายละเอียด (900)

           สำคัญ: ทั้ง "ไอคอนเลเยอร์" และ "แผงเลเยอร์" ยึดมุมขวาบนของกล่องนี้ตรงกัน (top:0 right:0)
           จึงมีขอบบนตรงกันเป๊ะ เหมือนแผงงอกออกมาจากตำแหน่งไอคอนพอดี แล้วขยายความสูงลงล่างตามเนื้อหา
           (เดิมวางซ้อนแบบ flex column ทำให้แผงถูกดันลงมา = ความสูงแถวไอคอน 46px + ระยะห่าง 8px) -->
      <!-- จัดวางเป็นคอลัมน์แนวตั้ง "ใต้ปุ่มซูม (+/-)": ปุ่มซูมอยู่ ~top:10–74, left:10 → วางไอคอนต่อลงมาที่ top:82, left:10
           เรียงบนลงล่าง: [+/-] ซูม → 🌙 สลับโทนแผนที่ → ⧉ เลเยอร์ (แต่ละปุ่มห่างกัน 54px) · เปิดแผงเลเยอร์แล้วกางออกด้านขวา -->
      <div class="layers-widget" data-tour="layers"
        style=${{position:"absolute",top:"82px",left:"10px",zIndex:700}}>
        <!-- ปุ่มสลับโทนสี (🌙/☀️): อยู่ใต้ปุ่มซูมทันที (บนสุดของกลุ่มไอคอน) -->
        <button class="layers-fab" title=${mapDark?"สลับเป็นโหมดสว่าง":"สลับเป็นโหมดมืด"}
          aria-label=${mapDark?"สลับเป็นโหมดสว่าง":"สลับเป็นโหมดมืด"} onClick=${toggleMapDark}
          style=${{position:"absolute",top:0,left:0}}>
          <${Icon} name=${mapDark?"sun":"moon"} size=${19}/></button>
        <!-- ไอคอนเลเยอร์: อยู่ "ใต้" ปุ่มสลับโทน (แนวตั้ง ห่าง 54px) · เมื่อแผงเปิด แผงงอกออกด้านขวา -->
        ${!layersOpen && html`<button class="layers-fab" title="เลเยอร์แผนที่" aria-label="เลเยอร์แผนที่" onClick=${()=>setLayersOpen(true)}
          style=${{position:"absolute",top:"54px",left:0}}>
          <${Icon} name="layers" size=${20}/>
        </button>`}
        ${layersOpen && html`<div class="map-panel tool-panel map-fx layers-pop"
          style=${{position:"absolute",top:"54px",left:0,width:"240px",maxWidth:"calc(100vw - 60px)",maxHeight:"calc(100vh - 200px)",overflowY:"auto",padding:"12px 14px"}}>

        <!-- หัวแผง + ปุ่มย่อแผง — ใช้ "ไอคอนเลเยอร์" ตัวเดียวกับตอนเปิด จึงเป็นปุ่มสลับชุดเดียวกัน
             (กดที่ไอคอนนี้ = ย่อกลับเป็นไอคอน · กดไอคอนอีกทีก็กางแผงกลับมา) -->
        <div class="row between" style=${{marginBottom:"10px",paddingBottom:"9px",borderBottom:"1px solid var(--stroke)"}}>
          <b style=${{fontSize:"12.5px"}}>เลเยอร์แผนที่</b>
          <button class="layers-close" title="ย่อแผงเลเยอร์" aria-label="ย่อแผงเลเยอร์" onClick=${()=>setLayersOpen(false)}>
            <${Icon} name="layers" size=${15}/>
          </button>
        </div>

        <!-- Heat map เปลี่ยนเป็นแสดงอัตโนมัติตามระดับซูม (ซูมออก=Heat / กลาง=Cluster / ใกล้=Marker) แล้ว
             จึงตัด toggle/ทึบแสง/รัศมี ของ Heat ออกจากแผงนี้ · ค่ารัศมี(18)/ทึบแสง(80%) ย้ายเป็นค่าคงที่ใน lmap.js -->
        <!-- แสดง/ซ่อน marker ตามสถานะลูกค้า (ทำงานร่วมกับโหมด Cluster/Marker) แต่ละอันปรับความทึบได้ -->
        <div>
          <div class="dim" style=${{fontSize:"11.5px",marginBottom:"6px"}}>สถานะ marker</div>
          ${[{k:"existing",name:"ลูกค้าปัจจุบัน",c:"#2563eb",opDef:90},
             {k:"prospect",name:"Lead",c:"#38bdf8",opDef:85}].map(r=>html`<div key=${r.k} style=${{paddingTop:"6px"}}>
            <div class="row between">
              <div class="row" style=${{gap:"9px",opacity:layers[r.k]!==false?1:.45,transition:"opacity .15s"}}>
                <span class="dotc" style=${{background:r.c,width:"11px",height:"11px",borderRadius:"3px"}}></span>
                <span style=${{fontSize:"12px",fontWeight:layers[r.k]!==false?600:400}}>${r.name}</span></div>
              <${Toggle} on=${layers[r.k]!==false} onChange=${()=>setLayers(x=>({...x,[r.k]:x[r.k]===false}))}/>
            </div>
            <div class="row" style=${{gap:"8px",marginTop:"6px",opacity:layers[r.k]!==false?1:.45,transition:"opacity .15s"}}>
              <span class="dim" style=${{fontSize:"11.5px",width:"42px",flex:"none"}}>ทึบแสง</span>
              <input type="range" min="10" max="100" value=${(layers.op&&layers.op[r.k])??r.opDef}
                onInput=${e=>setLayers(x=>({...x,op:{...x.op,[r.k]:+e.target.value}}))} style=${{flex:1}}/>
              <span class="mono" style=${{fontSize:"11.5px",width:"30px",textAlign:"right",flex:"none"}}>${(layers.op&&layers.op[r.k])??r.opDef}%</span></div>
            ${r.k==="prospect" && layers.prospect!==false && html`
              <!-- เกรดLead (A/B/C) — ตัวกรองย่อยของแถวLeadโดยเฉพาะ -->
              <div style=${{marginTop:"8px",paddingLeft:"20px",borderLeft:"2px solid var(--stroke)"}}>
                ${["A","B","C"].map(g=>html`
                  <div key=${g} class="row between" style=${{padding:"4px 0"}}>
                    <div class="row" style=${{gap:"9px"}}>
                      <span class="dotc" style=${{background:`var(--${g.toLowerCase()})`,width:"9px",height:"9px",borderRadius:"3px"}}></span>
                      <span class="dim" style=${{fontSize:"11.5px"}}>เกรด ${g}</span></div>
                    <${Toggle} on=${(layers.grades?layers.grades[g]:true)!==false}
                      onChange=${()=>setLayers(x=>({...x,grades:{A:true,B:true,C:true,...x.grades,[g]:(x.grades?x.grades[g]:true)===false}}))}/>
                  </div>`)}
              </div>`}
          </div>`)}
        </div>

        <!-- เลเยอร์ "เส้นทางดำเนินการ" (เฉพาะ TC) — ต่อจากLead · แสดงเส้นเชื่อมเส้นทางแผนเข้าพบที่ TC วางไว้ในระบบ -->
        ${lockProvince && html`<div style=${{paddingTop:"10px",borderTop:"1px solid var(--stroke)",marginTop:"10px"}}>
          <div class="row between">
            <div class="row" style=${{gap:"9px",opacity:layers.route!==false?1:.45,transition:"opacity .15s"}}>
              <span class="dotc" style=${{background:"repeating-linear-gradient(90deg,#8a7bff 0 5px,transparent 5px 9px)",width:"14px",height:"3px",borderRadius:"2px"}}></span>
              <span style=${{fontSize:"12px",fontWeight:layers.route!==false?600:400,color:"var(--txt)"}}>เส้นทางดำเนินการ</span></div>
            <${Toggle} on=${layers.route!==false} onChange=${()=>setLayers(x=>({...x,route:x.route===false}))}/></div>
          <div class="dim" style=${{fontSize:"11px",marginTop:"6px",paddingLeft:"23px"}}>เส้นเชื่อมเส้นทางแผนการเข้าพบที่วางไว้ในระบบ</div>
        </div>`}

        <!-- ชั้นแสดงพื้นที่จังหวัด (choropleth) — สลับดูแบบเจาะจงพื้นที่ (เห็นขอบเขต+สีไล่ระดับรายจังหวัด) หรือแบบรวม (ปิดไว้ ดูแค่ heat map ภาพรวม) -->
        <div style=${{paddingTop:"10px",borderTop:"1px solid var(--stroke)",marginTop:"10px"}}>
          <div class="row between">
            <div class="row" style=${{gap:"9px",opacity:layers.province?1:.45,transition:"opacity .15s"}}>
              <span class="dotc" style=${{background:"linear-gradient(90deg,#ffc233,#ff6a1a)",width:"11px",height:"11px",borderRadius:"3px"}}></span>
              <span style=${{fontSize:"12px",fontWeight:layers.province?600:400,color:"var(--txt)"}}>พื้นที่จังหวัด (เจาะจง)</span></div>
            <${Toggle} on=${!!layers.province} onChange=${()=>setLayers(x=>({...x,province:!x.province}))}/></div>
          ${layers.province && html`<div class="row" style=${{gap:"8px",marginTop:"8px"}}>
            <span class="dim" style=${{fontSize:"11.5px",width:"42px",flex:"none"}}>ทึบแสง</span>
            <input type="range" min="10" max="100" value=${(layers.op&&layers.op.province)??100}
              onInput=${e=>setLayers(x=>({...x,op:{...x.op,province:+e.target.value}}))} style=${{flex:1}}/>
            <span class="mono" style=${{fontSize:"11.5px",width:"30px",textAlign:"right",flex:"none"}}>${(layers.op&&layers.op.province)??100}%</span></div>`}
        </div>
        </div>`}
      </div>

      <!-- คำอธิบายความหนาแน่น (มุมซ้ายล่าง) — โผล่เฉพาะตอนแผนที่อยู่โหมด Heat (ซูมออก) ตามที่แจ้งผ่าน onMapMode -->
      ${mapMode==="heat" && html`<div class="map-panel map-fx" style=${{position:"absolute",bottom:"16px",left:"16px",zIndex:500,
        padding:"10px 14px",display:"flex",flexDirection:"column",gap:"6px"}}>
        <div style=${{fontSize:"11px",color:"var(--dim)",textTransform:"uppercase",letterSpacing:".6px"}}>ความหนาแน่น</div>
        <div style=${{width:"160px",height:"8px",borderRadius:"4px",
          background:"linear-gradient(90deg,#1a4bd8,#1ec7e6,#26e07a,#c8e622,#ffc233,#ff6a1a,#d81e1e)"}}></div>
        <div class="row between" style=${{fontSize:"10.5px",color:"var(--dim)"}}>
          <span>ต่ำ</span><span>ปานกลาง</span><span>สูง</span><span>สูงมาก</span>
        </div>
      </div>`}

      <!-- แถบสรุปบางๆ ใต้แถบนำทาง (แทนกล่องใหญ่ลอยทับแผนที่เดิม): ปุ่มกลับ + จังหวัด + ตัวเลขสรุปแบบกระชับ -->
      <div style=${{position:"absolute",top:"62px",left:"56px",zIndex:490,maxWidth:"calc(100% - 72px)"}}>
        <div class="map-panel map-fx" style=${{padding:"6px 11px",display:"flex",alignItems:"center",gap:"10px",flexWrap:"wrap",flex:"none"}}>
          ${lockProvince
            ? html`<span style=${{display:"inline-flex",alignItems:"center",gap:"6px",fontSize:"12.5px",fontWeight:700,color:"var(--accent2)"}}>
                <${Icon} name="pin" size=${14}/> เขตที่รับผิดชอบ: ${provinceTH(lockProvince)}</span>`
            : html`<${Btn} variant="ghost" size="sm" icon="arrowLeft" onClick=${onBackToGlobe}>กลับหน้ารวมสาขา</${Btn}>
          <span style=${{width:"1px",height:"15px",background:"var(--stroke2)",flex:"none"}}></span>
          <span style=${{fontSize:"12.5px",fontWeight:700}}>${filters.province&&filters.province!=="All"?provinceTH(filters.province):countryTH(activeCountry||"Thailand")}</span>`}
          <span style=${{fontSize:"12px",color:"var(--muted)"}}>${num(customers.length)} ลูกค้า · ${num(prospects.length)} Lead</span>
        </div>
      </div>`}
  </div>`;
}
