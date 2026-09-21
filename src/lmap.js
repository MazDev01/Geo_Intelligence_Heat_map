import {html, useRef, useEffect, useApp, segTH, provinceTH, segIconSVG, SEG_COLOR, gapTH} from "./lib.js";
import {custPass, prosPass} from "./data.js";
import {demandGap, GAP_REF} from "./mock/geoData.js";
import {basemap, relabel, EARTH} from "./basemap.js";   // EARTH มาจาก namedFlavor("light") ไม่ใช่ literal
import {t, useLang} from "./lib.js";
import {createZoneLayer} from "./zone-layer.js";   // โซน SL/LP/TL ของ กทม.
import {mountZoneEditor} from "./zone-editor.js";  // โหมดลากขอบ เปิดด้วย ?edit=1
import {createZoneResolver} from "./resolveZone.js";   // หาว่าพิกัดอยู่ในโซนไหน (กรองข้อมูลของ TC)
import {BASEMAP_MAXZOOM} from "../config/basemap.js";
import {roleCode} from "./permissions.js";   // แปลง role → code (ADMIN/SALES_MANAGER/TC) กันสตริงดิบกระจาย

// อ้าง window.L แบบปลอดภัย — เผื่อถูก import ฝั่ง Node (ทดสอบ SSR/พาร์ส) ที่ไม่มี window
// พฤติกรรมในเบราว์เซอร์เหมือนเดิมทุกประการ (ยังเท่ากับ window.L เสมอเมื่อรันจริง)
const L = (typeof window !== "undefined") ? window.L : undefined;
const TH_BOUNDS = [[5.6,97.3],[20.7,105.7]];   // whole-Thailand framing bounds (overview view)

// ── ชั้นแผ่นดินโลก (world.geojson) วาดใต้ tile ──
// ไฟล์ basemap-th-*.pmtiles เป็น extract เฉพาะไทย (ตรวจจาก directory จริง: z6 ครอบ lon 95.6–106.9 · z5 ครอบ 90–112.5)
// นอกกรอบนั้นไม่มี tile เลย จอกว้างจึงเห็นเป็นพื้นสีน้ำล้วนรอบประเทศ
// แก้โดยวาดรูปแผ่นดินของทุกประเทศจาก world.geojson (180 ประเทศ) ไว้ "ใต้" tile
// ในกรอบที่มี tile → tile ทับหมด เห็นรายละเอียดเหมือนเดิม · นอกกรอบ → เห็นแผ่นดินเพื่อนบ้านเป็นแผนที่ปกติ
const LAND_FILL = EARTH;       // สีพื้นดินจาก Protomaps style — ต่อเนื่องกับพื้นดินของ tile
const LAND_EDGE = "#c3bdb4";   // เส้นเขตแดนประเทศ อ่อนกว่าพื้นเล็กน้อย

// ── ขอบเขตของฟีเจอร์ "แผ่นดินสำรอง + พื้นสีทะเล" ──
// false = บทบาท TC ข้ามทั้งหมด ใช้ผลลัพธ์เดิม (ไม่สร้าง layer ไม่โหลด geojson ไม่เปลี่ยนสีพื้น)
// สลับเป็น true เมื่อไหร่ TC จะได้เหมือนบทบาทอื่นทันที
const APPLY_TO_TC = false;

// ── world.geojson — โหลด/แคชครั้งเดียวทั้งแอป (ใช้ทั้งเส้นขอบไทยและชั้นแผ่นดินโลก) ──
let _world;
function loadWorld(){
  if(_world===undefined){
    _world = fetch("./data/world.geojson").then(r=>r.json()).catch(()=>null);
  }
  return _world;
}
// ขอบเขตประเทศไทย สำหรับวาดเส้นขอบประเทศเหนือ mask
async function loadThaiOutline(){
  const w = await loadWorld();
  const f = w && (w.features||[]).find(x=>x.properties && x.properties.name==="Thailand");
  return f ? f.geometry : null;
}
// เครื่องหมายพื้นที่วงแหวน (shoelace) — ใช้ตัดสินทิศ winding เพื่อเจาะรู (hole) ของ mask ได้ทุกไฟล์
function ringArea(r){ let a=0; for(let i=0,j=r.length-1;i<r.length;j=i++){ a += r[j][1]*r[i][0] - r[i][1]*r[j][0]; } return a; }

// ดัชนี Lead (0–1) -> สี choropleth
function rampColor(t){ // 0 blue -> 1 red
  const stops=[[0,[43,111,255]],[.4,[37,208,224]],[.65,[255,176,46]],[1,[255,59,30]]];
  for(let i=0;i<stops.length-1;i++){ const [a,ca]=stops[i],[b,cb]=stops[i+1];
    if(t>=a&&t<=b){ const k=(t-a)/(b-a); return `rgb(${ca.map((v,j)=>Math.round(v+(cb[j]-v)*k)).join(",")})`; } }
  return "rgb(255,59,30)";
}

// ── โหมดแสดงผลตามระดับซูม (Progressive Disclosure) — เปิดเมื่อ layers.zoomModes=true (เฉพาะแผนที่หลัก) ──
// ค่าคงที่เป็น zoom ระดับสัมบูรณ์ จึงสม่ำเสมอทุกจังหวัด (จังหวัดเล็ก/ใหญ่ใช้เกณฑ์เดียวกัน)
const ZOOM_HEAT_MAX   = 10;   // zoom < 10  → Heat Map (มุมมองทั้งจังหวัด)
const ZOOM_CLUSTER_MAX= 12;   // 10 ≤ zoom < 12 → Marker Clustering ; zoom ≥ 12 → หมุดเดี่ยว
// รัศมี/ทึบแสงของ Heat Map — ย้ายจาก slider ในแผงเลเยอร์มาเป็นค่าคงที่ (Heat เป็นอัตโนมัติตามซูมแล้ว ผู้ใช้ไม่ต้องปรับ)
const HEAT_RADIUS = 18;
const HEAT_OPACITY = 80;   // เปอร์เซ็นต์
// ── Kernel Density Estimation (KDE) แบบอิงรัศมีเชิงภูมิศาสตร์ (เมตร) — ใช้ในแผนที่สรุปหน้ารายงาน (layers.kde=true) ──
// รัศมีเป็นเมตรจริง ไม่ใช่พิกเซลคงที่ → ที่ซูมกว้าง วงจะเล็กมาก พื้นที่ว่างจึงไม่มีสี (กัน False Point Artifacts)
const KDE_METERS = 800;   // แบนด์วิดท์ ~800 เมตร (อยู่ในช่วง 500ม.–1กม. ที่กำหนด)
// แปลงเมตร → พิกเซล ที่ระดับซูม/ละติจูดหนึ่งๆ (ตามสูตร Web Mercator) แล้วหนีบไว้ 2–40px
function kdeRadiusPx(map){
  const lat=map.getCenter().lat, z=map.getZoom();
  const mpp = 40075016.686 * Math.cos(lat*Math.PI/180) / Math.pow(2, z+8);   // เมตรต่อพิกเซล
  return Math.max(2, Math.min(40, Math.round(KDE_METERS/mpp)));
}
/* ── น้ำหนัก "Lead สูง" ของแต่ละ Lead สำหรับ heat map ──────────────────
   heat ไม่ได้แปลว่า "จุดหนาแน่น" อีกต่อไป แต่แปลว่า "หมวดธุรกิจที่ Barter ยังขาดในย่านนั้น"
   น้ำหนักของ Lead หนึ่งราย = ขนาดช่องว่างของ (อำเภอ × หมวดธุรกิจ) ของตัวเอง เทียบช่องว่างสูงสุดในชุดข้อมูล
     ช่องว่าง = max(0, จำนวน Lead − จำนวนสมาชิกเครือข่ายปัจจุบัน) ในอำเภอ+หมวดเดียวกัน
   หมวดที่มีสมาชิกครบแล้วจึงเกือบไม่ให้ความร้อน ส่วนหมวดที่ขาดหนักจะร้อนสุด                       */
const GAP_KEY = x => x.province+"|"+x.district+"|"+x.segment;
function gapWeigher(cs, ps){
  const supply=new Map(), demand=new Map();
  for(const c of cs){ const k=GAP_KEY(c); supply.set(k,(supply.get(k)||0)+1); }
  for(const q of ps){ const k=GAP_KEY(q); demand.set(k,(demand.get(k)||0)+1); }
  const gap=new Map(); let max=1;
  for(const [k,d] of demand){ const g=Math.max(0, d-(supply.get(k)||0)); gap.set(k,g); if(g>max) max=g; }
  // 0.12 = พื้นจาง ๆ ให้ยังเห็นว่ามีธุรกิจอยู่ แม้หมวดนั้นไม่ขาดแล้ว
  return x => 0.12 + 0.88*((gap.get(GAP_KEY(x))||0)/max);
}

// แปลงระดับซูมเป็นชื่อโหมด
function zoomModeOf(z){ return z < ZOOM_HEAT_MAX ? "heat" : z < ZOOM_CLUSTER_MAX ? "cluster" : "marker"; }

export function LeafletMap({db, filters, layers, country="Thailand", onPickArea, onPickCustomer, onMapMode, focusProvince, highlight, focusPoint, plan, route, office, planRoutes, clusters, territories, dark, lockProvince, lockZones, zoneMode, onPickZone}){
  const ref = useRef();
  const M = useRef({});
  // useApp() คืน undefined ถ้าอยู่นอก Provider → ถือว่า "ไม่เข้าเงื่อนไข" ไว้ก่อน (ปลอดภัยฝั่ง TC)
  const app = useApp();
  const seaFallback = APPLY_TO_TC || (!!app && !!app.user && roleCode(app.user.role) !== "TC");
  const lang = useLang();   // ป้ายชื่อสถานที่บนแผนที่ตามภาษาปัจจุบัน (ดู effect "สลับภาษาป้ายชื่อ" ด้านล่าง)

  // init once
  useEffect(()=>{
    const map = L.map(ref.current, {zoomControl:true, attributionControl:true, preferCanvas:true, maxZoom:BASEMAP_MAXZOOM})
      .setView(country==="Thailand"?[13.2,101]:[13,101], country==="Thailand"?6:5);
    // แผนที่ฐาน Protomaps (vector, self-host) ผ่านโมดูลรวมศูนย์ — เลือกไฟล์ตาม viewport อัตโนมัติ
    // ป้ายชื่อสถานที่/ถนนใช้ภาษาปัจจุบันของแอป (.pmtiles มีทั้ง name:th และ name:en อยู่แล้ว) · ไม่แสดง POI
    // เก็บทั้ง base และ lbl — ทุกที่ที่ add/remove ต้องทำพร้อมกัน (ป้ายชื่อห้ามลอยบนพื้นเปล่า)
    const bm = basemap(map);
    M.current.bm = bm;
    M.current.baseLayer = bm.base; M.current.labelLayer = bm.lbl;
    M.current.map = map; M.current.alive = true;
    // ── Panes ของ mask ขอบเขตจังหวัด ──
    // maskPane (z250) อยู่เหนือ tilePane(200) จึงปิด base ได้ · แต่ต่ำกว่า overlayPane(400)
    // choropleth/heat/หมุด/เส้นทางจึงอยู่เหนือ mask เสมอ (ข้อมูลไม่ถูกบัง) · outlinePane(350) วาดเส้นขอบประเทศเหนือ mask
    // landPane (z150) อยู่ "ใต้" tilePane(200) — tile ที่มีข้อมูลจึงทับแผ่นดินหยาบนี้เสมอ
    map.createPane("landPane");    map.getPane("landPane").style.zIndex="150";    map.getPane("landPane").style.pointerEvents="none";
    map.createPane("maskPane");    map.getPane("maskPane").style.zIndex="250";    map.getPane("maskPane").style.pointerEvents="none";
    map.createPane("outlinePane"); map.getPane("outlinePane").style.zIndex="350"; map.getPane("outlinePane").style.pointerEvents="none";
    // Canvas renderer ต่อ pane — ผูกกับ container โดยตรง เลื่อนพร้อม tile (CSS transform) จึง "ไม่กระพริบ" ตอน drag
    // (ถ้าใช้ SVG renderer ดีฟอลต์ SVG overlay จะ repaint ช้ากว่า tile layer ทำให้เห็น tile ใต้ mask แว่บนึง)
    // padding กว้าง (mask 1.5) กัน "แถบไม่ถูก mask" โผล่ที่ขอบตอนลากไกล
    // ⚠ padding แพงกว่าที่เห็นมาก — Leaflet ตั้ง canvas = getSize() × (1+2p) ทั้งสองแกน
    //   พื้นที่จึงเป็น (1+2p)² เท่าของ viewport แล้ว L.Canvas ยังคูณ 2 อีกชั้นเมื่อ Browser.retina
    //   (จอ scaling ≥125% ก็นับเป็น retina) รวมเป็น (1+2p)² × 4 เท่าของพิกเซลบนจอ
    //   p=1.5 บนจอ 1920×1080 = ~499 MB ต่อผืน × 3 ผืน ≈ 1.5 GB — ทุก moveend Leaflet clearRect เต็มผืนแล้ววาดใหม่
    //   ค่าตั้งต้นของ L.canvas คือ 0.1 · เหลือ padding ไว้เฉพาะ mask ที่ต้องกันแถบไม่ถูก mask โผล่ตอนลาก
    M.current.landRenderer    = L.canvas({pane:"landPane",    padding:0.1});
    M.current.maskRenderer    = L.canvas({pane:"maskPane",    padding:0.3});   // ตัวเดียวที่ต้องมีกันชน
    M.current.outlineRenderer = L.canvas({pane:"outlinePane", padding:0.1});
    M.current.provinceLayer = L.geoJSON(null).addTo(map);
    M.current.heat = null; M.current.cluster = null;
    // VIEWPORT rendering: re-render only visible markers after a pan/zoom settles (§9, debounced)
    // call the CURRENT buildMarkers (via ref) — not the one captured at init — so a pan/zoom
    // after a layer toggle (e.g. clustering off) or a LOD form switch uses fresh state.
    // ⚠ อย่าผูก build() กับ moveend ตรง ๆ — buildMarkers() ทิ้ง markerClusterGroup ทั้งก้อนแล้วสร้างใหม่
    //   การสร้างใหม่ = _generateInitialClusters วน DistanceGrid ตั้งแต่ minZoom ถึง maxZoom (0–18 = 19 ระดับ)
    //   แล้ว insert หมุดทุกตัวเข้าไปทุกระดับ · ทำแบบนี้ทุกครั้งที่ลากแผนที่ = ค้าง
    //   markercluster มี removeOutsideVisibleBounds:true เป็นค่าตั้งต้นอยู่แล้ว จึงคัดหมุดนอกจอให้เอง
    //   สิ่งที่เปลี่ยนจริงตอน ซูม คือระดับ LOD/ขนาดไอคอน → ผูกกับ zoomend พอ
    const rebuild = ()=>{ clearTimeout(M.current.mt);
      M.current.mt = setTimeout(()=>{ if(M.current.build) M.current.build(); }, 80); };
    map.on("zoomend", rebuild);        // ซูมเปลี่ยน = LOD/ขนาดไอคอน/โหมดซูมเปลี่ยนจริง
    map.on("moveend", ()=>{ if(M.current.clustered) return;   // คลัสเตอร์คัดหมุดนอกจอเอง ไม่ต้องสร้างใหม่
      rebuild(); });                    // โหมดไม่คลัสเตอร์เท่านั้นที่ยังต้อง cull ตาม viewport
    // ดับเบิลคลิก (ระดับแผนที่ ยิงชัวร์เสมอ) → ยกเลิกการเปิดแผงวิเคราะห์พื้นที่ที่ค้างจากคลิกเดียว แล้วปล่อยให้ doubleClickZoom ซูมเข้าตามปกติ
    map.on("dblclick", ()=>{ if(M.current.areaCT){ clearTimeout(M.current.areaCT); M.current.areaCT=null; } });
    // clip ป้ายชื่อ: SVG ของ clipPath อยู่ "ใน labelPane" จึงใช้ระบบพิกัดเดียวกับเนื้อหาใน pane
    // ตอนลาก Leaflet ไม่ได้เปลี่ยน origin ของ layer point — แค่ transform ตัว map-pane ทั้งก้อน clip จึงเลื่อนตามเอง
    // ค่า layer point เปลี่ยนเฉพาะตอน _resetView (ซูม) → ผูกแค่ viewreset/zoomend ก็พอ ไม่ต้อง move/movestart/moveend
    // ผลคือ clip ตรงตลอดทั้งระหว่างลากและตอนหยุด และไม่มี reflow ทุกเฟรม
    map.on("viewreset zoomend", ()=>updateLabelClip());
    setTimeout(()=>{ if(!M.current.alive) return; map.invalidateSize();
      // frame the whole country so it is centred and fully visible (~75% of the viewport) — BUT only when no
      // province is selected. If we mount already scoped to a province (post-login picker → fly to province),
      // this whole-country fitBounds would clobber the province zoom, so let the province-view effect frame it.
      const sel = filters.province && filters.province!=="All";
      if(country==="Thailand" && !sel) map.fitBounds(L.latLngBounds(TH_BOUNDS), {padding:[28,28]});
    }, 80);
    // ยาม perf (เฉพาะ ?perf=1) — โหลดแบบ dynamic โหมดปกติไม่แตะไฟล์นี้เลย
    if(/[?&]perf=1/.test(location.search)){
      import("./dev/mapPerfGuard.js")
        .then(m=>m.installMapPerfGuard(map, {getGroup:()=>M.current.cluster}))
        .catch(e=>console.warn("[map-perf] โหลด guard ไม่สำเร็จ", e));
    }
    // ── โซนขอบเขตการขายของ กทม. (SL/LP/TL) ──
    // ⚠ ไม่มี public/ ในโปรเจกต์นี้ — server.mjs เสิร์ฟ static จากรากโปรเจกต์ ไฟล์จึงอยู่ที่ /data/
    // ⚠ ไม่มี bundler จึงไม่มี import.meta.env.DEV — ใช้ ?perf=1 เป็นสวิตช์ dev เหมือน mapPerfGuard
    // ⚠ ห้ามใส่ zones ใน deps ของ effect นี้ — cleanup ของมันคือ map.remove()
    let zonesCancelled = false;
    // รูปโซน: เอาของที่แอดมินเซฟขึ้นเซิร์ฟเวอร์ก่อน (204 = ยังไม่เคยเซฟ) ไม่มีค่อยใช้ไฟล์ที่มากับ repo
    // no-store เพราะเซฟเสร็จแล้วรีเฟรชต้องเห็นเส้นใหม่ทันที ไม่ใช่ของที่เบราว์เซอร์แคชไว้
    const loadZones = () => fetch("/api/zones", {cache:"no-store"})
      .then(r => (r.ok && r.status!==204) ? r.json() : null)
      .catch(()=>null)
      .then(gj => gj || fetch("/data/zones.geojson", {cache:"no-store"}).then(r=>r.json()));
    loadZones().then(gj=>{
      if(zonesCancelled || !M.current.alive || !M.current.map) return;
      M.current.zonesGeo = gj;        // เก็บรูปดิบไว้ให้ buildMask() เจาะรูตามโซน (ข้อ 4)
      M.current.zones = createZoneLayer(map, gj, {
        zIndex: 420,                                  // > overlayPane(400) ที่ heat อยู่ · < labelPane(450)
        mustBeAbove: ["overlayPane"],                 // L.heatLayer วาดลง overlayPane (ยืนยันจากโค้ดแล้ว)
        mustBeBelow: ["labelPane","markerPane"],
        interactive: false,                           // เป็นภาพพื้นหลัง ไม่แย่งคลิกจากหมุด/จังหวัด
        onPick: id => onPickZone && onPickZone(id),
        debug: /[?&]perf=1/.test(location.search),
      }).addTo(map);
      M.current.zoneEditor = mountZoneEditor(map, M.current.zones);   // คืน null ถ้าไม่มี ?edit=1
      applyLockZones();                                              // โซนอาจมาถึงหลัง effect ของ lockZones แล้ว
      buildMask();                                                   // รูปโซนเพิ่งมา — เจาะรูใหม่ตามโซนถ้า TC ถูกล็อกโซนไว้
      buildBase();                                                   // และกรองข้อมูลให้เหลือเฉพาะในโซน (หมุด/คลัสเตอร์/heat)
    }).catch(e=>console.warn("[zone-layer] โหลด /data/zones.geojson ไม่สำเร็จ", e));

    buildBase();
    return ()=>{ M.current.alive = false; zonesCancelled = true; clearTimeout(M.current.mt);
      if(M.current.zoneEditor){ M.current.zoneEditor.disable(); M.current.zoneEditor.panel && M.current.zoneEditor.panel.destroy(); M.current.zoneEditor = null; }
      M.current.zones && M.current.zones.destroy(); M.current.zones = null;
      map.remove(); };
  },[]);

  // ── สลับภาษาป้ายชื่อสถานที่บนแผนที่ ──
  // label layer เป็นวัตถุ Leaflet ที่สร้างครั้งเดียวตอน init (deps []) — React re-render ไม่แตะมัน
  // จึงต้องมี effect แยกที่ผูกกับ lang: ถอด label layer เดิม สร้างใหม่ด้วยภาษาใหม่
  // (ห้ามใส่ lang เข้าไปใน deps ของ effect init — cleanup ของมันคือ map.remove() = สร้างแผนที่ใหม่ทั้งใบ)
  // clip ผูกอยู่กับ labelPane (DOM) ไม่ใช่ตัว layer จึงไม่หลุดตอนสลับ
  useEffect(()=>{
    const m=M.current; if(!m.alive||!m.map||!m.bm) return;
    m.bm = relabel(m.map, m.bm, lang);
    m.labelLayer = m.bm.lbl;
    updateLabelClip();
  },[lang]);

  // ── โซนที่ TC รับผิดชอบ (มาจากตารางมอบหมายที่แอดมินบันทึกไว้) ───────────────
  // เน้นโซนนั้นบนแมพ + ให้แผ่นทึบเจาะรูตามรูปโซนแทนรูปจังหวัด (ดู buildMask)
  // null = ไม่จำกัดระดับโซน — พฤติกรรมเดิมทุกประการ
  // การแสดงผลโซน 3 แบบตามบทบาท:
  //   lock    (TC)        ซ่อนชั้นสีโซน · แผ่นทึบปิดนอกเขต · ข้อมูลเฉพาะโซนของตัวเอง
  //   outline (ผู้บริหาร)  เส้นสีเทาบาง ไม่ระบายสี · ไม่มีแผ่นทึบ · ข้อมูลเฉพาะในโซนทั้งหมด
  //   null    (แอดมิน)     สีโซนเต็มรูปแบบ — เครื่องมือดูภาพรวมการแบ่งพื้นที่
  const ZONE_OUTLINE = {color:"#94a3b8", weight:1.4, opacity:0.9, fillOpacity:0, fill:false};
  const applyLockZones = ()=>{ const m=M.current;
    if(!m.zones) return;                                   // โซนยังโหลดไม่เสร็จ — init effect จะเรียกซ้ำให้เอง
    const z = m.lockZones, mode = m.zoneMode;
    // TC: ซ่อนชั้นสีทิ้ง (ยังคง m.zonesGeo ไว้ เพราะ buildMask ต้องใช้รูปโซนไปเจาะรู)
    m.zones.setVisible(mode !== "lock");
    if(mode === "outline") m.zones.layer.setStyle(ZONE_OUTLINE);   // hover ไม่ทับสไตล์นี้ เพราะ interactive=false
    m.zones.setActive(mode === "lock" && z && z.length===1 ? z[0] : null);
  };
  useEffect(()=>{
    const next = (lockZones && lockZones.length) ? lockZones : null;
    // เทียบเป็นสตริงกัน buildMask/buildBase ทำงานซ้ำเมื่อ React ส่งอาเรย์ตัวใหม่ที่ค่าเหมือนเดิมมา
    const sig = JSON.stringify([zoneMode||null, next]);
    if(M.current.zoneSig === sig) return;
    M.current.zoneSig = sig;
    M.current.zoneMode = zoneMode || null;
    M.current.lockZones = next;
    applyLockZones();
    buildMask();
    buildBase();          // ชุดข้อมูลที่แสดงเปลี่ยนตามโซนด้วย ไม่ใช่แค่รูปที่วาด
  },[lockZones, zoneMode]);

  // ── ชั้นแผ่นดินโลก + พื้นสีทะเล · เฉพาะบทบาทที่เข้าเงื่อนไข ──
  // ไม่เข้าเงื่อนไข = ออกตั้งแต่บรรทัดแรก ไม่ fetch ไม่สร้าง layer ไม่แตะคลาสของ container
  useEffect(()=>{
    const m=M.current; if(!m.alive||!m.map) return;
    if(!seaFallback) return;
    m.map.getContainer().classList.add("map-sea");      // พื้น = สีน้ำจาก style (กฎ .map-sea ใน index.html)
    let cancelled=false;
    loadWorld().then(w=>{
      if(cancelled || !m.alive || !m.map || !w || m.landLayer) return;
      m.landLayer = L.geoJSON(w, {pane:"landPane", renderer:m.landRenderer, interactive:false,
        style:{fillColor:LAND_FILL, fillOpacity:1, color:LAND_EDGE, weight:0.7, opacity:1}}).addTo(m.map);
    });
    return ()=>{ cancelled=true; };
  },[seaFallback]);

  // Rebuild province + heat when filters/layers change OR when a data stage streams in
  // (aggregates → province outlines → customer detail). Skip first run — init already built.
  const firstRun = useRef(true);
  useEffect(()=>{ if(firstRun.current){ firstRun.current=false; return; } if(M.current.alive) buildBase(); },
    [filters, layers, db.customers, db.provincesGeo, db.areas]);

  // Province filter drives the map view BOTH ways from one place: a specific province flies
  // INTO it; "ทั้งหมด" (All) flies back OUT to the whole country. Keeping both directions in a
  // single effect (keyed on the actual filter value) prevents the zoom-in/zoom-out asymmetry.
  const firstView = useRef(true);
  useEffect(()=>{
    const m=M.current; if(!m.alive||!m.map) return;
    clearTimeout(m._provRetry);   // cancel a pending fly from a previous province selection
    const toAll = !filters.province || filters.province==="All";
    if(firstView.current){ firstView.current=false; if(toAll) return; }   // init already frames the country
    if(toAll){
      m.map.flyToBounds(L.latLngBounds(TH_BOUNDS), {padding:[28,28], duration:0.8});
    } else {
      // Fly to the province's outline bounds. The outline may not exist yet (the ~1.19MB geojson can still be
      // streaming, or buildBase deferred until the map is sized), so poll briefly until provFeatures has it —
      // otherwise selecting a province right after the globe fly-in would silently not zoom.
      let tries=0;
      const flyProv=()=>{ if(!m.alive||!m.map) return;
        const f=m.provFeatures && m.provFeatures[filters.province];
        if(f){ m.map.flyToBounds(f.getBounds(), {padding:[40,40], duration:0.8, maxZoom:LOD_ZOOM}); }
        else if(tries++ < 25){ m._provRetry=setTimeout(flyProv, 150); } };   // up to ~3.75s
      flyProv();
    }
    // db.provincesGeo is in the deps so a province selected BEFORE the geojson loaded also re-runs on arrival.
  },[filters.province, db.provincesGeo]);

  // ── ล็อกแผนที่ให้ TC อยู่เฉพาะจังหวัดที่รับผิดชอบ (maxBounds + minZoom) — มองข้าม/เลื่อนไปจังหวัดอื่นไม่ได้ ──
  useEffect(()=>{
    const m=M.current; if(!m.alive||!m.map) return; const map=m.map;
    if(!lockProvince){
      map.setMaxBounds(null);
      if(country!=="Thailand"){ map.setMinZoom(0); return; }
      // TC (ที่ยังไม่มีจังหวัดรับผิดชอบ) — ใช้ค่าเดิม ไม่แตะ
      if(!seaFallback){ map.setMinZoom(3); return; }
      // ผู้บริหาร/แอดมิน: เพดานซูมออกที่ผู้ใช้กำหนด = ลึกกว่า "ทั้งประเทศพอดีจอ" 1 ระดับ
      // วัดแล้ว: ระดับพอดีจอ (getBoundsZoom) ที่จอ 1900px กว้าง 41.8° lon — เห็นอินเดีย/ฟิลิปปินส์ กว้างเกินที่ต้องการ
      // ลึกลงอีก 1 ระดับ = ~20.9° lon เห็นไทยกับเพื่อนบ้านติดกันพอดี (ตัดปลายเหนือ-ใต้ไปบ้าง ซึ่งผู้ใช้ยอมรับ)
      // ยังผูกกับ getBoundsZoom จึงขยับตามขนาดจอเสมอ ไม่ใช่เลขตายตัว
      const OUT_LIMIT_OFFSET = 1;
      const fit=()=>{
        if(!m.alive||!m.map) return;
        const mz=map.getBoundsZoom(L.latLngBounds(TH_BOUNDS), false, L.point(28,28)) + OUT_LIMIT_OFFSET;
        map.setMinZoom(mz);
        if(map.getZoom()<mz) map.setZoom(mz);
      };
      fit();
      map.on("resize", fit);            // ย่อ/ขยายหน้าต่างแล้วเพดานต้องขยับตาม
      return ()=>map.off("resize", fit);
    }
    let tries=0;
    const apply=()=>{ if(!m.alive||!map) return;
      const f=m.provFeatures && m.provFeatures[lockProvince];
      if(!f){ if(tries++<25) setTimeout(apply,150); return; }
      const raw=f.getBounds();
      map.setMaxBounds(raw.pad(0.12));                        // buffer ~12% รอบขอบจังหวัด
      map.options.maxBoundsViscosity=1.0;                    // ดีดกลับเข้าเขตทันที ลากออกไม่ได้
      const mz=map.getBoundsZoom(raw);                        // ระดับซูมที่จังหวัดเต็มจอ = ซูมออกไกลสุด
      map.setMinZoom(mz);                                     // ซูมออกให้เห็นทั้งประเทศไม่ได้
      if(map.getZoom()<mz) map.setZoom(mz);
    };
    apply();
  },[lockProvince, country, seaFallback, db.provincesGeo]);

  // ── Mask ขอบเขตจังหวัด: ปิดทุกอย่างนอกจังหวัดที่แสดง (กันประเทศเพื่อนบ้าน/ทะเล/จังหวัดอื่นเลอะ) ──
  // TC → จังหวัดที่รับผิดชอบ · เลือกจังหวัดเดียว → จังหวัดนั้น · ภาพรวม → จังหวัดนำร่องทั้งหมด + เส้นขอบประเทศไทย
  useEffect(()=>{
    const m=M.current; if(!m.alive||!m.map) return;
    let cancelled=false;
    loadThaiOutline().then(outline=>{ if(cancelled||!m.alive) return;
      m.outlineGeom = outline;      // เก็บไว้ให้ buildMask() ที่ถูกเรียกจากที่อื่น (โซนมาถึงทีหลัง) ใช้ซ้ำได้
      buildMask(outline); });
    return ()=>{ cancelled=true; };
  },[filters.province, lockProvince, db.provincesGeo, db.areaByProvince, dark]);

  // สร้าง polygon ครอบโลกแล้วเจาะรูตามรูปจังหวัดที่ต้องแสดง (สีทึบปิด base) + เส้นขอบประเทศ
  function buildMask(outlineGeom = M.current.outlineGeom){
    const m=M.current, map=m.map; if(!map || !db.provincesGeo) return;
    // เลือกจังหวัดที่จะ"เปิด" (เจาะรูให้เห็น base)
    let reveal;
    // ภาพรวมทั้งประเทศ (ไม่ล็อกจังหวัด และไม่ได้กรองจังหวัด) → เห็นแผนที่ไทยเต็มตัว ไม่มีแผ่นทึบปิด
    const wholeCountry = !lockProvince && (!filters.province || filters.province==="All");
    if(lockProvince) reveal = new Set([lockProvince]);
    else if(filters.province && filters.province!=="All") reveal = new Set([filters.province]);
    else reveal = new Set(db.provincesGeo.features.map(f=>f.properties.name));   // ครบ 77 จังหวัด
    if(m.maskLayer){ map.removeLayer(m.maskLayer); m.maskLayer=null; }
    if(m.outlineLayer){ map.removeLayer(m.outlineLayer); m.outlineLayer=null; }
    if(m.provEdge){ map.removeLayer(m.provEdge); m.provEdge=null; }
    // ── TC ที่ถูกมอบหมายเป็น "รายโซน" → เจาะรูตามรูปโซน ไม่ใช่รูปจังหวัด ──────────
    // รูปโซนมาจาก data/zones.geojson (ไฟล์เดียวกับที่แอดมินลากขอบ) โหลดแบบ async
    // ถ้ายังมาไม่ถึง ให้ตกกลับไปใช้รูปจังหวัดตามเดิมก่อน — ไม่งั้นจะไม่มีรูให้เจาะ แล้วแผ่นทึบบังทั้งจอ
    // (โหลดเสร็จเมื่อไหร่ ตัว fetch จะเรียก buildMask() ซ้ำให้เอง)
    const zoneIds   = m.zoneMode === "lock" ? m.lockZones : null;   // เจาะรูตามโซนเฉพาะโหมดล็อก (TC)
    const zoneFeats = (zoneIds && m.zonesGeo && m.zonesGeo.features)
      ? m.zonesGeo.features.filter(f=>f.properties && zoneIds.includes(f.properties.zone_id))
      : null;
    const useZones  = !!(zoneFeats && zoneFeats.length);
    const srcFeatures = useZones
      ? zoneFeats
      : db.provincesGeo.features.filter(f=>reveal.has(f.properties.name));

    const world = [[-89,-179],[-89,179],[89,179],[89,-179]];      // วงนอกครอบทั้งโลก (lat,lng)
    const outerSign = Math.sign(ringArea(world));
    const holes = [];
    srcFeatures.forEach(f=>{
      const g=f.geometry, polys = g.type==="Polygon" ? [g.coordinates] : g.type==="MultiPolygon" ? g.coordinates : [];
      polys.forEach(poly=>{ if(!poly[0]) return;
        const ring = poly[0].map(([lng,lat])=>[lat,lng]);
        if(Math.sign(ringArea(ring))===outerSign) ring.reverse();  // hole ต้องวนสวนทาง outer จึงเจาะทะลุได้ทุก winding
        holes.push(ring); });
    });
    if(!holes.length) return;   // ยังไม่มี geojson / ไม่ตรงชื่อ → ไม่ต้อง mask (กันบังทั้งจอ)
    const MASK = dark ? "#0e1626" : "#e9ecf1";                    // สีนอกพื้นที่ (สลับตาม dark mode ของแผนที่)
    if(!wholeCountry)   // มุมมองทั้งประเทศไม่ต้องมีแผ่นทึบ — เห็นแผนที่ไทยเต็มตัว
      m.maskLayer = L.polygon([world, ...holes], {pane:"maskPane", renderer:m.maskRenderer, stroke:false, fillColor:MASK, fillOpacity:1, interactive:false}).addTo(map);
    if(outlineGeom){                                              // เส้นขอบประเทศไทย (จางสุด 1px) เหนือ mask — บริบทภาพรวม
      const OUT = dark ? "rgba(226,232,240,.28)" : "rgba(30,45,80,.26)";
      m.outlineLayer = L.geoJSON(outlineGeom, {pane:"outlinePane", renderer:m.outlineRenderer, interactive:false, style:{color:OUT, weight:1, fill:false}}).addTo(map);
    }
    // เส้นกรอบของพื้นที่ที่ "เปิด" — จังหวัด หรือ โซนของ TC (เข้มกว่าเส้นขอบประเทศเล็กน้อย)
    const revealFeatures = srcFeatures;
    if(revealFeatures.length){
      const EDGE = dark ? "rgba(226,232,240,.5)" : "rgba(43,52,64,.5)";
      m.provEdge = L.geoJSON({type:"FeatureCollection", features:revealFeatures},
        {pane:"outlinePane", renderer:m.outlineRenderer, interactive:false, style:{color:EDGE, weight:1.2, fill:false}}).addTo(map);
    }
    // clip ป้ายชื่อ(labelPane) ให้เหลือเฉพาะรูปจังหวัดที่เปิด → label ไม่โผล่ทับพื้นที่ที่ถูก mask
    m.revealFeatures = revealFeatures;
    updateLabelClip();
  }

  // clip labelPane ตามรูปจังหวัดที่เปิด — ใช้ layer point (พิกัดเดียวกับ content ของ pane)
  // SVG ต้องอยู่ "ใน labelPane" ไม่ใช่ document.body ไม่งั้น userSpaceOnUse คนละระบบพิกัดกับ pane
  // marker ไม่โดน clip นี้เพราะอยู่คนละ pane (markerPane)
  function updateLabelClip(){
    const m=M.current, map=m.map; if(!map) return;
    const pane=map.getPane("labelPane"); if(!pane) return;
    const feats=m.revealFeatures;
    if(!feats || !feats.length){ pane.style.clipPath="none"; return; }   // ไม่มี reveal → ไม่ clip (โชว์ label ทั้งหมด)
    const rings=[];
    feats.forEach(f=>{ const g=f.geometry, polys= g.type==="Polygon" ? [g.coordinates] : g.type==="MultiPolygon" ? g.coordinates : [];
      polys.forEach(poly=>{ if(!poly[0]) return;
        const pts=poly[0].map(([lng,lat])=>{ const p=map.latLngToLayerPoint([lat,lng]); return p.x.toFixed(1)+","+p.y.toFixed(1); });
        rings.push(pts.join(" ")); }); });
    let svg=pane.querySelector("#label-clip-svg");
    if(!svg){ svg=document.createElementNS("http://www.w3.org/2000/svg","svg"); svg.id="label-clip-svg";
      svg.setAttribute("width","0"); svg.setAttribute("height","0");
      svg.style.cssText="position:absolute;width:0;height:0;overflow:hidden"; pane.appendChild(svg); }
    svg.innerHTML='<defs><clipPath id="label-clip" clipPathUnits="userSpaceOnUse">'+rings.map(p=>'<polygon points="'+p+'"/>').join("")+'</clipPath></defs>';
    pane.style.clipPath="url(#label-clip)";
  }

  useEffect(()=>{ // product tour: fly to a point/zoom so markers or clusters become visible
    const m=M.current; if(!m.alive||!m.map||!focusPoint) return;
    m.map.flyTo([focusPoint.lat,focusPoint.lng], focusPoint.zoom||12, {duration:0.7});
  },[focusPoint&&focusPoint.seq]);

  // Customer Visit Planning: highlight selected customers, and draw the suggested visit route
  // (line + numbered ①②③ sequence markers) once it has been calculated. Non-interactive overlay.
  useEffect(()=>{
    const m=M.current; if(!m.alive||!m.map) return;
    if(m.planLayer){ m.map.removeLayer(m.planLayer); m.planLayer=null; }
    const sel=plan||[];
    if(layers.route===false || (!sel.length && !route)) return;   // ปิดเลเยอร์ "เส้นทางดำเนินการ" → ซ่อน overlay แผนที่กำลังแก้ไข
    const grp=L.layerGroup();
    sel.forEach(c=>L.marker([c.latitude,c.longitude],{interactive:false,zIndexOffset:900,
      icon:L.divIcon({className:"",iconSize:[42,42],iconAnchor:[21,21],html:'<div class="plan-ring"></div>'})}).addTo(grp));
    if(route && route.order && route.order.length){
      const o=office||{latitude:13.7563,longitude:100.5018};
      const pts=[[o.latitude,o.longitude],...route.order.map(s=>[s.latitude,s.longitude])];
      L.polyline(pts,{color:"#38bdf8",weight:3,opacity:.92}).addTo(grp);
      L.marker(pts[0],{interactive:false,zIndexOffset:1000,
        icon:L.divIcon({className:"",iconSize:[30,30],iconAnchor:[15,15],html:'<div class="plan-office"><span>⌂</span></div>'})}).addTo(grp);
      route.order.forEach((s,i)=>L.marker([s.latitude,s.longitude],{interactive:false,zIndexOffset:1000,
        icon:L.divIcon({className:"",iconSize:[30,30],iconAnchor:[15,15],html:`<div class="plan-num">${i+1}</div>`})}).addTo(grp));
      m.map.flyToBounds(L.latLngBounds(pts).pad(0.28),{duration:0.7});
    }
    grp.addTo(m.map); m.planLayer=grp;
  },[plan, route, office, layers.route]);

  // ── เลเยอร์ "เส้นทางดำเนินการ" — เส้นเชื่อมเส้นทางของแผนอื่นๆ ที่ TC บันทึกไว้ในระบบ (เปิด/ปิดด้วย layers.route) ──
  const ROUTE_COLORS = ["#8a7bff","#33d69f","#ffb02e","#ff7a2e","#f472b6","#ff5a5a"];
  useEffect(()=>{
    const m=M.current; if(!m.alive||!m.map) return;
    if(m.routesLayer){ m.map.removeLayer(m.routesLayer); m.routesLayer=null; }
    if(layers.route===false || !planRoutes || !planRoutes.length) return;
    const grp=L.layerGroup();
    planRoutes.forEach((pr,gi)=>{ const col=ROUTE_COLORS[gi%ROUTE_COLORS.length];
      if(pr.pts && pr.pts.length>1){
        L.polyline(pr.pts,{color:col,weight:2.5,opacity:.85,dashArray:"6 5",interactive:true})
          .addTo(grp).bindTooltip(t("แผน: ", "Plan: ")+(pr.name||""),{sticky:true,direction:"top",className:"gc-tt"});
        // จุดสาขา (จุดเริ่มต้น) ของเส้นทางนี้
        L.circleMarker(pr.pts[0],{radius:5,color:"#fff",weight:2,fillColor:"#111",fillOpacity:1,interactive:false}).addTo(grp);
      }
      (pr.stops||[]).forEach(s=>L.circleMarker([s.lat,s.lng],{radius:4,color:"#fff",weight:1.5,fillColor:col,fillOpacity:1,interactive:false}).addTo(grp));
    });
    grp.addTo(m.map); m.routesLayer=grp;
  },[planRoutes, layers.route]);

  useEffect(()=>{ // locate + pulse the selected customer marker on the SAME map
    const m=M.current; if(!m.alive||!m.map) return;
    if(m.hl){ m.map.removeLayer(m.hl); m.hl=null; }
    if(highlight){
      const icon=L.divIcon({className:"", iconSize:[48,48], iconAnchor:[24,24], html:'<div class="mk-pulse"></div>'});
      m.hl=L.marker([highlight.latitude,highlight.longitude],{icon,zIndexOffset:1000,interactive:false}).addTo(m.map);
      m.map.flyTo([highlight.latitude,highlight.longitude], Math.max(m.map.getZoom(),10), {duration:0.8});
    }
  },[highlight]);

  // ── ชั้นขอบเขต Cluster (ใช้เฉพาะรายงานเชิงภูมิศาสตร์ — หน้าหลักไม่ส่ง prop นี้มา จึงไม่มีผล) ──
  // วาดรูปหลายเหลี่ยม hull ของแต่ละกลุ่มด้วยสีต่างกัน + ป้ายรหัสกลุ่มที่จุดศูนย์กลาง
  useEffect(()=>{
    const m=M.current; if(!m.alive||!m.map) return;
    if(m.clusterLayer){ m.map.removeLayer(m.clusterLayer); m.clusterLayer=null; }
    if(!clusters || !clusters.length) return;
    const grp=L.layerGroup();
    const STY=cl=>({color:cl.color,weight:2,opacity:.9,fillColor:cl.color,fillOpacity:.18,interactive:false,dashArray:"5 5"});
    clusters.forEach(cl=>{
      // กลุ่มที่มี >=3 เขต → วาด convex hull polygon จริง · กลุ่ม 1-2 เขต → วาดวงกลม (วาด polygon ไม่ได้เพราะจุดน้อยเกินไป)
      if((cl.memberCount||0) >= 3 && cl.hull && cl.hull.length>=3){
        L.polygon(cl.hull, STY(cl)).addTo(grp);
      } else if(cl.center){
        // รัศมีวงกลม fallback อิงจากขนาด hull ที่ data.js คำนวณไว้ (ปรับสเกลตามจังหวัด) แปลงองศา→เมตร
        const p0=cl.hull&&cl.hull[0]; let rM=6500;
        if(p0){ const dLat=p0[0]-cl.center.lat, dLng=p0[1]-cl.center.lng; rM=Math.max(3000, Math.sqrt(dLat*dLat+dLng*dLng)*111000); }
        L.circle([cl.center.lat,cl.center.lng], {radius:rM, ...STY(cl)}).addTo(grp);
      }
      if(cl.center) L.marker([cl.center.lat,cl.center.lng],{interactive:false,zIndexOffset:600,
        icon:L.divIcon({className:"",iconSize:[26,26],iconAnchor:[13,13],
          html:`<div style="width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font:800 13px/1 var(--font);color:#fff;background:${cl.color};box-shadow:0 2px 8px rgba(0,0,0,.4);border:2px solid #fff">${cl.code}</div>`})}).addTo(grp);
    });
    grp.addTo(m.map); m.clusterLayer=grp;
  },[clusters]);

  // ── ชั้นเขตรับผิดชอบ TC (Territory Boundaries) — วาด convex hull ต่อ TC + ไฮไลต์พื้นที่ทับซ้อน ──
  // reports.js เป็นผู้คำนวณ hull/overlap แล้วส่งมา (คำนวณจาก tc_owner จริง) · หน้าอื่นไม่ส่ง prop นี้จึงไม่มีผล
  useEffect(()=>{
    const m=M.current; if(!m.alive||!m.map) return;
    if(m.terrLayer){ m.map.removeLayer(m.terrLayer); m.terrLayer=null; }
    if(!territories || !territories.hulls || !territories.hulls.length) return;
    const grp=L.layerGroup();
    // ขอบเขตของแต่ละ TC — โปร่งแสง สีตาม TC
    // ⚠ ตัวแปรวนลูปต้องไม่ชื่อ t — จะบัง t() ของ i18n ที่เรียกอยู่ในบล็อกนี้
    territories.hulls.forEach(h=>{ if(!h.latlngs||h.latlngs.length<3) return;
      const poly=L.polygon(h.latlngs, {color:h.color,weight:2,opacity:.95,fillColor:h.color,fillOpacity:.14,dashArray:"6 5"});
      poly.bindTooltip(t("เขตรับผิดชอบ: ", "Territory: ")+h.tc, {sticky:true, direction:"top", className:"gc-tt"});
      poly.addTo(grp);
    });
    // พื้นที่ทับซ้อน — ไฮไลต์ต่างออกไป (แดงโปร่ง + ขอบขาวประ) พร้อม tooltip บอกว่า TC คนไหนซ้อนกัน
    (territories.overlaps||[]).forEach(o=>{ if(!o.latlngs||o.latlngs.length<3) return;
      const poly=L.polygon(o.latlngs, {color:"#ffffff",weight:1.5,opacity:.95,fillColor:"#ff2d55",fillOpacity:.42,dashArray:"3 3", className:"terr-overlap"});
      poly.bindTooltip(t("พื้นที่ทับซ้อน: ", "Overlapping area: ")+(o.tcs||[]).join(" ↔ "), {sticky:true, direction:"top", className:"gc-tt"});
      poly.addTo(grp);
    });
    grp.addTo(m.map); m.terrLayer=grp;
  },[territories]);

  // ตัวกรอง "อยู่ในโซนของ TC ไหม" — คืน null ถ้าไม่ได้ถูกล็อกโซน (ทุกบทบาทอื่นเห็นเหมือนเดิม)
  // สร้าง resolver ครั้งเดียวต่อชุดโซน แล้วแคชไว้ที่ M.current (โพลิกอน LP ตัวเดียวมี ~2,300 จุด)
  function zoneFilter(){
    const m=M.current;
    if(!m.zonesGeo) return null;
    // ตัดข้อมูลเฉพาะ TC ที่ถูกล็อกโซนเท่านั้น
    // ผู้บริหาร (outline) เห็นข้อมูลครบทุกราย — เส้นโซนสีเทาเป็นแค่บริบทไว้ดูขอบเขต ไม่ใช่ตัวกรอง
    const ids = m.zoneMode === "lock" ? m.lockZones : null;
    if(!ids || !ids.length) return null;
    const key = ids.slice().sort().join(",");
    if(m.zoneResKey !== key){
      const feats = (m.zonesGeo.features||[]).filter(f=>f.properties && ids.includes(f.properties.zone_id));
      m.zoneRes = feats.length ? createZoneResolver({type:"FeatureCollection", features:feats}) : null;
      m.zoneResKey = key;
    }
    const res = m.zoneRes;
    return res ? (x => !!res.zoneAt(+x.latitude, +x.longitude)) : null;
  }

  // province choropleth + CACHED heatmap — recomputed only when the filtered data changes, never on pan (§10)
  function buildBase(){
    const map=M.current.map;
    if(!M.current.alive) return;
    if(!ref.current || ref.current.clientHeight<10){ setTimeout(()=>{ if(M.current.alive) buildBase(); },120); return; }
    // TC ที่ถูกล็อกโซน: เห็นเฉพาะข้อมูล "ในเขตของตัวเอง" — ตัดสินจากพิกัดจริง (point-in-polygon)
    // ไม่ใช่ชื่อเขต เพราะขอบที่แอดมินลากไม่ได้ตรงกับขอบเขตปกครองเสมอไป
    const zf = zoneFilter();
    const cs0=db.customers.filter(c=>c.country===country && custPass(c,filters));
    const ps0=db.prospects.filter(p=>p.country===country && prosPass(p,filters));
    const cs = zf ? cs0.filter(zf) : cs0;
    const ps = zf ? ps0.filter(zf) : ps0;
    M.current.cs=cs; M.current.ps=ps; M.current.op=layers.op||{};   // stash for viewport marker rendering + opacity
    const opProv=((layers.op&&layers.op.province)??100)/100;

    // ── ระดับสีรายจังหวัด = ดัชนี Lead สูง (ไม่ใช่จำนวนระเบียนดิบ) ──
    const cnt={}; [...cs,...ps].forEach(x=>{cnt[x.province]=(cnt[x.province]||0)+1;});
    const provGap={};
    { const byProv={};
      cs.forEach(c=>{ (byProv[c.province]=byProv[c.province]||{c:[],p:[]}).c.push(c); });
      ps.forEach(q=>{ (byProv[q.province]=byProv[q.province]||{c:[],p:[]}).p.push(q); });
      for(const [pv,o] of Object.entries(byProv)) provGap[pv]=demandGap(o.c,o.p,GAP_REF.province); }
    const maxc=100;   // gapScore เป็นสเกล 0–100 อยู่แล้ว
    // Per-province count for the hover TOOLTIP — must reflect the HOVERED province regardless of which
    // province is currently selected. `cnt` above is filtered by filters.province, so once a province is
    // selected every OTHER province's cnt is 0; recompute here ignoring the province filter (segment /
    // status / score still apply, matching the no-selection case).
    const tipF={...filters, province:"All"};
    const cntTip={}, tipBy={};
    db.customers.forEach(c=>{ if(c.country===country && custPass(c,tipF)){ cntTip[c.province]=(cntTip[c.province]||0)+1; (tipBy[c.province]=tipBy[c.province]||{c:[],p:[]}).c.push(c); } });
    db.prospects.forEach(p=>{ if(p.country===country && prosPass(p,tipF)){ cntTip[p.province]=(cntTip[p.province]||0)+1; (tipBy[p.province]=tipBy[p.province]||{c:[],p:[]}).p.push(p); } });
    const provGapTip={};
    for(const [pv,o] of Object.entries(tipBy)) provGapTip[pv]=demandGap(o.c,o.p,GAP_REF.province);

    M.current.provinceLayer.clearLayers();
    M.current.provFeatures={};
    // Build the province OUTLINES whenever the geojson is available — INDEPENDENT of the choropleth toggle.
    // provFeatures[name] is what the "fly to province" effect uses for zoom-to-bounds, so it must exist even
    // when layers.province (the coloured fill) is OFF; otherwise selecting a province can't zoom to it.
    // When the fill is off the polygons are drawn fully transparent + non-interactive, so the map looks and
    // behaves exactly as before — the only difference is that the bounds are now available for zooming.
    if(country==="Thailand" && db.provincesGeo){
      const showFill = layers.province;   // toggle controls the choropleth COLOUR + hover only; provinces stay clickable either way
      const selected = layers.province && filters.province && filters.province!=="All" ? filters.province : null;   // เด่น/หมองเฉพาะเมื่อเปิดสวิตช์ "พื้นที่จังหวัด" เท่านั้น
      const gj=L.geoJSON(db.provincesGeo,{
        interactive: true,   // ALWAYS clickable so a click opens the province AreaPanel even when the fill is hidden
        // Selecting a province highlights it (white outline) and DIMS the others (dark fill) — works whether or not
        // the choropleth fill is on. fillOpacity must stay a hair above 0 even on the "off" polygons: the canvas
        // renderer (preferCanvas) won't hit-test a fully-transparent fill, so 0 = dead clicks.
        style:f=>{
          const t=((provGap[f.properties.name]||{}).gapScore||0)/maxc;
          const isSelected = selected===f.properties.name;
          const isDimmed = selected && !isSelected;
          const baseFillOpacity = showFill ? (cnt[f.properties.name]?0.16+t*0.4:0.04)*opProv : 0;
          if(isSelected) return {color:"#ffffff",weight:2.6,fillColor:rampColor(t),fillOpacity:Math.max(baseFillOpacity,0.22)};
          if(isDimmed) return {color:"rgba(120,160,220,.12)",weight:1,fillColor:"#04121a",fillOpacity:0.45};
          // no province selected: keep fill ≥0.01 so clicks still hit-test even when the choropleth is off
          return {color: showFill?"rgba(120,160,220,.35)":"rgba(120,160,220,0)", weight: showFill?1:0,
            fillColor:rampColor(t), fillOpacity: Math.max(baseFillOpacity, 0.01)}; },
        onEachFeature:(f,lyr)=>{ const pname=f.properties.name; M.current.provFeatures[pname]=lyr;
          // เฉพาะ 4 จังหวัดที่มีข้อมูล (areaByProvince) เท่านั้นที่เปิดแผงวิเคราะห์พื้นที่ได้ · นอกเหนือจากนี้ = แผนที่ธรรมดา (คลิกไม่มีผล)
          const featured = !!(db.areaByProvince && db.areaByProvince[pname]);
          // คลิกเดียว = เปิดแผงรายละเอียดเชิงพื้นที่ (หน่วง 260ms เพื่อแยกจากดับเบิลคลิก) · ดับเบิลคลิก = ซูมเข้า
          // ตัวจับเวลาเก็บไว้ที่ M.current.areaCT แล้วให้ map "dblclick" (ยิงชัวร์กว่า layer dblclick บน canvas renderer) เป็นตัวยกเลิก
          lyr.on("click",()=>{
            if(!featured) return;                              // นอก 4 จังหวัด → ไม่เปิดแผงเลย (แผนที่ธรรมดา)
            if(M.current.areaCT) clearTimeout(M.current.areaCT);
            M.current.areaCT = setTimeout(()=>{ M.current.areaCT=null; onPickArea && onPickArea(pname); }, 260);
          });
          if(!showFill) return;   // tooltip + hover highlight only when the choropleth fill is visible
          const a=db.areaByProvince[pname];
          const gTip=provGapTip[pname];
          lyr.bindTooltip(`<div class="mk-tip"><b>${provinceTH(pname)}</b><br/>${t("ธุรกิจในพื้นที่:", "Businesses in this area:")} ${cntTip[pname]||0}`
            + (gTip ? `<br/>Lead ${gTip.gapScore} (${gapTH(gTip.gapLevel)}${t(") · ยังขาด", ") · still short")} ${gTip.gapCount} ${t("ราย", "businesses")}` : (a?`<br/>Lead ${a.gapScore}`:""))
            + `</div>`,{sticky:true});
          lyr.on("mouseover",()=>lyr.setStyle({weight:2.4,color:"#38bdf8"}));
          lyr.on("mouseout",()=>gj.resetStyle(lyr));
        }});
      gj.addTo(M.current.provinceLayer);
    }

    // heatmap — FINE (from customers) once detail has loaded, otherwise a COARSE aggregate
    // from province centroids so the overview paints within ~3s while detail streams in.
    const fine = cs.length>0;
    const areasLen = (db.areas||[]).length;
    // โหมดซูมอัตโนมัติ (แผนที่หลัก): สร้างเลเยอร์ heat ไว้เสมอ แล้วคุมการมองเห็นด้วยความทึบใน buildMarkers (fade ตามซูม)
    // โหมดแมนนวล (แผนที่สรุปหน้ารายงาน): สร้าง heat ตาม layers.heat เหมือนเดิม
    const wantHeat = layers.zoomModes ? true : !!layers.heat;
    const kde = !!layers.kde;   // โหมด KDE (รัศมีเมตร) สำหรับแผนที่สรุปหน้ารายงาน
    const kr = kde ? kdeRadiusPx(map) : 0;
    // heat = Lead สูง จึงคิดจาก "Lead" (อุปสงค์ที่ยังไม่ถูกเติม) เป็นหลัก
    // ลูกค้าปัจจุบันคือฝั่งอุปทาน — ไม่เพิ่มความร้อน แต่ไป "หักลบ" ช่องว่างในน้ำหนักของ gapWeigher()
    // ปิดเลเยอร์ "Lead" บนแผนที่หลัก (zoomModes) = ปิด heat ไปด้วย เพราะไม่มีอุปสงค์ให้วัด
    const autoHeat   = !!layers.zoomModes;
    const showPsHeat = !autoHeat || layers.prospect!==false;
    const heatSig = wantHeat ? (fine?"f":"a")+"|"+cs.length+"|"+ps.length+"|"+areasLen+"|"+(kde?"kde":HEAT_RADIUS)+"|"+(filters.province||"All")+"|"+
      (showPsHeat?"P":"")+"|"+
      Object.keys(filters.segments).filter(k=>filters.segments[k]).join() : "off";
    if(M.current.heatSig!==heatSig){
      if(M.current.heat){ map.removeLayer(M.current.heat); M.current.heat=null; }
      if(wantHeat){
        const wGap = fine ? gapWeigher(cs, ps) : null;
        const pts = fine
          ? (showPsHeat?ps:[]).map(x=>[x.latitude,x.longitude, wGap(x)])   // Lead ถ่วงน้ำหนักด้วยช่องว่างของหมวดในอำเภอนั้น
          : (db.areas||[]).filter(a=>a.center).map(a=>[a.center[0],a.center[1], Math.min(1,(showPsHeat?(a.gapCount||0):0)/GAP_REF.province)]).filter(p=>p[2]>0);
        M.current.heat=L.heatLayer(pts,
          // KDE: รัศมีเมตร(แปลงเป็นพิกเซลตามซูม) blur เล็กตามรัศมี · ปกติ: รัศมีพิกเซลคงที่แบบเดิม
          // smaller radius/blur → the true point distribution shows through instead of blurring into a smooth
          // symmetric blob; higher `max` spreads the ramp across density levels so only the densest cores go deep red.
          {radius: kde?kr:(fine?HEAT_RADIUS:36), blur: kde?Math.max(2,Math.round(kr*0.6)):(fine?12:22), maxZoom:11, max: fine?8:1.1, minOpacity:0.2,
           // full rainbow spectrum (Longdo Map style): น้ำเงิน → ฟ้า → เขียว → เหลือง → ส้ม → แดง
           // ไล่จาก "Lead ต่ำ" (หมวดที่มีสมาชิกครบแล้ว) ไป "Lead สูง" (หมวดที่ Barter ยังขาดหนัก)
           gradient:{0.1:"#1a4bd8",0.25:"#1ec7e6",0.4:"#26e07a",0.55:"#c8e622",0.7:"#ffc233",0.85:"#ff6a1a",1:"#d81e1e"}}).addTo(map);
        // leaflet.heat@0.2.0 hardcodes its canvas into overlayPane (ignores any `pane` option), so markers and
        // choropleth share that pane with it. A NEGATIVE z-index forces the heat canvas into overlayPane's
        // lowest paint layer, so the marker/choropleth canvas (z-index auto) always draws above it — a stable
        // CSS guarantee instead of the DOM/paint order that used to flip on every pan/zoom.
        if(M.current.heat._canvas){ const hc=M.current.heat._canvas; hc.style.pointerEvents="none"; hc.style.transition="opacity .25s ease"; hc.style.zIndex="-1"; }
      }
      M.current.heatSig=heatSig;
    }
    // ความทึบของ heat ถูกกำหนดใน buildMarkers (ตามโหมดซูมเมื่อ auto / ตาม layers.op เมื่อแมนนวล) เพื่อให้ fade ตอนสลับโหมดที่เดียว
    buildMarkers();
  }

  // LEVEL-OF-DETAIL. Colour ALWAYS encodes customer STATUS (dark blue = existing, light blue = prospect).
  //  • wide / dense view: each point is a tiny bare 6px STATUS-COLOURED DOT drawn on a single shared
  //    CANVAS via L.circleMarker — NO stroke / border / shadow / DOM per point, so thousands of
  //    overlapping points read as a light density scatter (see buildMarkers).
  //  • province level AND not too dense: points get a full L.marker/divIcon status-coloured circle that
  //    reveals the business-category icon in its centre (markerIcon below).
  //  The dot→icon switch is gated on BOTH zoom (>= LOD_ZOOM) and viewport density (<= ICON_CAP, in
  //  buildMarkers) — a zoom threshold alone can't stay smooth because heaviness tracks marker COUNT.
  const LOD_ZOOM = 9;    // icons appear once a single PROVINCE fills the screen (~z9); country z5 stays tiny dots
  function markerIcon(x, op, zoom, colorOverride){
    const color = colorOverride || SEG_COLOR[x.segment] || "#64748b";   // สีหมุดตามหมวดธุรกิจ (ไม่ใช่สถานะแล้ว)
    // เริ่มต้นเท่าเส้นผ่านศูนย์กลางจริงของจุดกลม (circleMarker) ที่ zoom=LOD_ZOOM พอดี
    // (dotRadius ที่ zoom=9 = 4.4 → เส้นผ่านศูนย์กลาง 8.8 ≈ 9) เพื่อสลับจากจุดกลมเป็นไอคอนแบบไร้รอยต่อ
    // แล้วขยายต่อเนื่องเป็นเส้นตรงไปจนถึง 34px ที่ zoom 13
    const size = Math.max(9, Math.min(34, 9 + ((zoom??LOD_ZOOM)-LOD_ZOOM)*(34-9)/(13-LOD_ZOOM)));
    const glyphSize = Math.round(size*0.6);   // ไอคอนเส้นหมวดธุรกิจ (สีขาว) สัดส่วนตามวงกลมที่เล็ก/ใหญ่ขึ้น
    const glyph = segIconSVG(x.segment, {size:glyphSize, color:"#fff", stroke:2.6});
    return L.divIcon({className:"", iconSize:[size,size], iconAnchor:[size/2,size/2],
      html:`<div class="geo-mk" style="background:${color};opacity:${op/100}">${glyph}</div>`});
  }

  // VIEWPORT marker rendering — render only what is on screen; cluster by PROXIMITY only
  function buildMarkers(){
    const map=M.current.map;
    if(!M.current.alive || !map) return;
    // ── โหมดแสดงผลตามระดับซูม (เฉพาะแผนที่หลักที่ส่ง layers.zoomModes) ──
    // heat = ซูมออก · cluster = ซูมกลาง · marker = ซูมใกล้ · โหมดคิดจาก map.getZoom() เท่านั้น (ไม่พึ่ง hover/hit-test → ไม่เกิด feedback loop)
    const auto = !!layers.zoomModes;
    const mode = auto ? zoomModeOf(map.getZoom()) : null;
    // ความทึบของ heat: fade เข้า/ออกด้วย CSS transition (.25s) ที่ตั้งไว้ตอนสร้าง — เปลี่ยนโหมดจึงไม่กระพริบ
    if(M.current.heat && M.current.heat._canvas){
      const heatVis = auto ? (mode==="heat") : !!layers.heat;
      const heatOp  = auto ? HEAT_OPACITY : (((layers.op&&layers.op.heat)??HEAT_OPACITY));
      M.current.heat._canvas.style.opacity = heatVis ? (heatOp/100) : 0;
      // KDE: อัปเดตรัศมี(พิกเซล)ให้ตรงกับ ~800ม.จริง ทุกครั้งที่ซูมเปลี่ยน เพื่อคงความหมายเชิงพื้นที่ + กันสีล้นพื้นที่ว่าง
      if(layers.kde && M.current.heat.setOptions){ const kr=kdeRadiusPx(map);
        if(M.current.kr!==kr){ M.current.kr=kr; M.current.heat.setOptions({radius:kr, blur:Math.max(2,Math.round(kr*0.6))}); } }
    }
    // แจ้งโหมดปัจจุบันออกไปภายนอก (สเตจใช้โชว์ legend ความหนาแน่นเฉพาะตอนอยู่โหมด heat)
    if(auto && onMapMode && M.current.lastMode!==mode){ M.current.lastMode=mode; onMapMode(mode); }
    if(M.current.cluster){ map.removeLayer(M.current.cluster); M.current.cluster=null; }
    // วาดหมุด/คลัสเตอร์เมื่อ: (auto) ไม่ได้อยู่โหมด heat · (แมนนวล) เปิดเลเยอร์ marker/cluster อย่างน้อยหนึ่ง
    const showPoints = auto ? (mode!=="heat") : (layers.cluster || layers.existing || layers.prospect);
    // โหมด heat: ไม่มีหมุดให้สร้างใหม่ · ปล่อย clustered=false ให้ moveend เรียกเข้ามาได้
    // (เข้ามาแล้วอัปเดตความทึบ heat ด้านบนแล้ว return ทันที — ราคาเกือบศูนย์)
    if(!showPoints){ M.current.clustered = false; return; }
    const allCs=(layers.existing!==false?(M.current.cs||[]):[]);
    const allPs=(layers.prospect!==false?(M.current.ps||[]):[]);
    // auto: ชั้น cluster เมื่ออยู่โหมด cluster · แมนนวล: ตาม layers.cluster + เกณฑ์จำนวนเดิม
    // ⚠ นับจาก "ชุดเต็ม" ไม่ใช่จำนวนในจอ — เดิมนับในจอทำให้สลับเข้า/ออกโหมดคลัสเตอร์ไปมาระหว่างลาก
    const useCluster = auto ? (mode!=="heat") : (layers.cluster && (allCs.length+allPs.length)>60);
    // คลัสเตอร์คัดหมุดนอกจอให้เองแล้ว (removeOutsideVisibleBounds) จึงส่งชุดเต็มเข้าไป
    // เหลือ cull เองเฉพาะโหมดไม่คลัสเตอร์ ซึ่งหมุดเป็น DOM/แคนวาสตรง ๆ ไม่มีใครคัดให้
    const b=map.getBounds().pad(0.25);
    const inView=x=>b.contains([x.latitude,x.longitude]);
    const cs = useCluster ? allCs : allCs.filter(inView);
    const ps = useCluster ? allPs : allPs.filter(inView);
    M.current.clustered = useCluster;   // moveend ใช้ค่านี้ตัดสินว่าต้องสร้างใหม่ไหม
    // ระยะรวมคลัสเตอร์ (พิกเซล) ตามระดับซูม — ยิ่งซูมเข้ายิ่งแคบ จนเหลือรวมแค่หมุดที่ทับกันจริง
    const clusterRadiusAtZoom = z => z>=17 ? 14 : z>=16 ? 18 : z>=15 ? 24 : z>=14 ? 30 : z>=13 ? 38 : z>=12 ? 48 : 70;
    const grp = useCluster
      ? L.markerClusterGroup({chunkedLoading:true, maxClusterRadius:clusterRadiusAtZoom, showCoverageOnHover:false,
          spiderfyDistanceMultiplier:1.6,   // หมุดที่พิกัดซ้ำกันเป๊ะ ต้องกางออกให้ห่างพอจะกดทีละอันได้
          zoomToBoundsOnClick:false, iconCreateFunction:clusterIcon})   // custom clusterclick (below) drives zoom / spiderfy
      : L.layerGroup();
    if(useCluster){   // hover reveals the full breakdown (with names) — also covers small count-only bubbles
      grp.on("clustermouseover", e=>{
        const r=clusterRadius(e.layer.getChildCount());
        e.layer.bindTooltip(clusterBreakdown(e.layer), {direction:"top", offset:[0,-r], className:"gc-tt"}).openTooltip();
      });
      grp.on("clustermouseout", e=>e.layer.closeTooltip());
      // คลิกคลัสเตอร์ → ซูมเข้าไปให้มันแตกออก (พฤติกรรมมาตรฐาน)
      // ถ้าซูมต่อแล้วก็ยังแตกไม่ได้ (พิกัดซ้ำกัน/แน่นสุด ๆ) → กางหมุดออกเป็นวง (spiderfy) ให้กดเลือกทีละอันได้
      // tooltip สรุปหมวดธุรกิจตอน hover ยังทำงานแยกจากกันตามเดิม
      grp.on("clusterclick", e=>{
        const cl=e.layer, bounds=cl.getBounds(), cur=map.getZoom();
        const fitZoom=map.getBoundsZoom(bounds);
        if(fitZoom > cur){
          map.flyToBounds(bounds, {padding:[48,48], duration:0.55, maxZoom:Math.min(fitZoom, cur+3)});
        } else if(cl.spiderfy){
          cl.spiderfy();
        }
      });
    }
    const op=M.current.op||{}, zoom=map.getZoom();   // LOD form depends on current zoom
    // Show the full icon markers only when (a) zoomed to province level (>= LOD_ZOOM) AND (b) the
    // viewport isn't too dense. Full markers are DOM divIcons — rendering many at once is janky
    // (measured: ~200 = smooth, ~1,180 = fps 3), so ultra-dense areas (Bangkok / central Thailand with
    // clustering off) stay LIGHT canvas dots until the user zooms in enough to thin below ICON_CAP.
    const ICON_CAP = 400;
    // จุดกลม (dot) เมื่อ (a) ยังไม่ซูมเกินระดับจังหวัด zoom<=LOD_ZOOM  — เข้ามาแรก/ซูมกว้างต้องเป็นจุดเล็กเสมอ
    // ไม่ว่าจะเปิดกี่เลเยอร์ (ไม่สลับไป-มา icon↔dot ตามจำนวน) — หรือ (b) แน่นเกิน ICON_CAP (กัน DOM ค้าง)
    const dotMode = !useCluster && (zoom <= LOD_ZOOM || (cs.length+ps.length) > ICON_CAP);
    const dotRadius = Math.max(2, Math.min(5, 2 + (zoom-5)*0.6));   // ~2px (ซูมกว้างสุด z5) → ~5px (ใกล้จุดสลับเป็นไอคอน); ต่อเนื่องกับ size เริ่มต้นของ markerIcon
    // โหมดเน้นสถานะการเข้าพบ (เปิดผ่าน layers.visit เท่านั้น) — ใช้ในหน้ารายงานสรุปข้อมูลรายพื้นที่
    // Leadที่ "ยังไม่เข้าพบ" = เทา (ช่องว่างที่ยังไม่เข้าถึง) · Lead ในหมวดที่พื้นที่ยังขาดและเข้าพบแล้ว = แดง
    // ถ้าไม่ได้เปิด layers.visit จะคืน null ทุกกรณี สีหมุดจึงเหมือนเดิมทุกหน้า (ไม่กระทบที่อื่น)
    const GRAY_UNVISIT="#9aa4b2", RED_GAP="#ff3b1e";
    const wGapMk = layers.visit ? gapWeigher(M.current.cs||[], M.current.ps||[]) : null;
    const visitColor = x => { if(!layers.visit || x.status!=="Prospect") return null;
      // ⚠ "ยังไม่เข้าพบ" เป็นค่าที่เก็บอยู่ในเรกคอร์ด (visit_status) ไม่ใช่ข้อความบนหน้าจอ — ห้ามแปล
      if((x.visit_status||"ยังไม่เข้าพบ")==="ยังไม่เข้าพบ") return GRAY_UNVISIT;
      return wGapMk(x) >= 0.5 ? RED_GAP : null; };
    const add=(arr,isCust)=>arr.forEach(x=>{
      const o=(isCust?(op.existing??90):(op.prospect??40))/100;   // ลูกค้า = ทึบชัด · Lead = จาง (แยกด้วยความทึบ ไม่ใช่สี)
      const cov=visitColor(x);
      let m;
      if(dotMode){   // tiny solid STATUS-coloured dot, canvas-rendered — no stroke/border/shadow at all.
        // Draw on the map's DEFAULT shared canvas (same renderer as the province choropleth) — NOT a
        // separate L.canvas. One canvas hit-tests BOTH dots and polygons, so a click on empty ground
        // still reaches the province polygon underneath. A separate dots-canvas would sit on top and
        // swallow every polygon click (the regression). Dots are added after the polygons, so they
        // still draw on top and stay clickable themselves.
        m=L.circleMarker([x.latitude,x.longitude],{radius:dotRadius, stroke:false,
          fillColor:cov||SEG_COLOR[x.segment]||"#64748b", fillOpacity:o,
          seg:x.segment, status:x.status, prov:x.province});
      } else {
        m=L.marker([x.latitude,x.longitude],{icon:markerIcon(x,isCust?(op.existing??90):(op.prospect??40),zoom,cov),
          seg:x.segment, status:x.status, prov:x.province, keyboard:false});
      }
      m.bindTooltip(`<div class="mk-tip"><b>${x.businessName}</b><br/>${x.id} · ${segTH(x.segment)} · ${isCust?t("สมาชิกเครือข่ายปัจจุบัน", "Current network members"):"Lead"}</div>`,{direction:"top",offset:[0,-16]});
      m.on("click",()=>onPickCustomer&&onPickCustomer(x));   // detail panel reads THIS marker
      grp.addLayer(m);
    });
    add(cs,true); add(ps,false);
    grp.addTo(map); M.current.cluster=grp;
  }
  M.current.build = buildMarkers;   // keep the moveend rebuild pointed at the current closure

  // Cluster radius — LOGARITHMIC scale (data spans 2 … ~4,100 per cluster), clamped to a
  // fixed [20,44]px ceiling. The 44px cap (paired with the wider merge distance below) keeps
  // even the densest central bubbles from overlapping while still showing a clear size range.
  const CL_MINR=20, CL_MAXR=44, CL_MINN=2, CL_MAXN=4100;
  function clusterRadius(n){
    const t=(Math.log(Math.max(n,CL_MINN))-Math.log(CL_MINN))/(Math.log(CL_MAXN)-Math.log(CL_MINN));
    return Math.round(Math.max(CL_MINR, Math.min(CL_MAXR, CL_MINR+(CL_MAXR-CL_MINR)*t)));
  }
  // Cluster bubble — count always shown; density by ring colour. The category breakdown is
  // shown INLINE only when the bubble is big enough (r≥35px), width-constrained inside the
  // circle; smaller bubbles keep it for HOVER only (clustermouseover) — no overflow either way.
  function clusterIcon(cluster){
    const n=cluster.getChildCount(), r=clusterRadius(n), size=r*2;
    const dcol=n>200?"#ff5a3c":n>50?"#ffb02e":"#38bdf8";
    const label=n>999?(n/1000).toFixed(1)+"k":""+n;
    const cf=Math.max(14, Math.min(26, Math.round(r*0.6)));
    let inner=`<div class="gc-count" style="font-size:${cf}px">${label}</div>`;
    if(r>=35){
      const counts={}; cluster.getAllChildMarkers().forEach(m=>{const s=m.options.seg; if(s)counts[s]=(counts[s]||0)+1;});
      const cats=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,3)
        .map(([s,c])=>`<span class="gc-cat">${segIconSVG(s,{size:13})}<b>${c}</b></span>`).join("");
      inner+=`<div class="gc-cats">${cats}</div>`;
    }
    return L.divIcon({className:"", iconSize:[size,size],
      html:`<div class="geo-cluster" style="width:${size}px;height:${size}px;border-color:${dcol}">${inner}</div>`});
  }
  // Build the business-category breakdown tooltip for a cluster (shown only on hover).
  function clusterBreakdown(cluster){
    const kids=cluster.getAllChildMarkers(), counts={};
    kids.forEach(m=>{const s=m.options.seg; if(s)counts[s]=(counts[s]||0)+1;});
    const rows=Object.entries(counts).sort((a,b)=>b[1]-a[1])
      .map(([s,c])=>`<span class="gc-row" style="display:flex;align-items:center;gap:6px">${segIconSVG(s,{size:14})} ${segTH(s)} · <b>${c}</b></span>`).join("");
    return `<div class="mk-tip gc-tip"><b>${t("รวม", "Total")} ${kids.length} ${t("ราย", "businesses")}</b>${rows}</div>`;
  }

  // โหมดมืด: ใส่คลาส map-dark → CSS filter ทำงานเฉพาะ .leaflet-tile-pane (แผ่นไทล์ OSM) เท่านั้น
  // heat/marker อยู่คนละ pane (overlayPane) จึงไม่ถูก filter กระทบ — สียังคมชัดทั้งสองโหมด
  return html`<div ref=${ref} class=${"map-reveal"+(dark?" map-dark":"")} style=${{position:"absolute",inset:0}}></div>`;
}
