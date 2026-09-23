import {React, html, useState, useEffect, useMemo, createRoot, AppCtx, Icon, brandMark, num, roleTH, countryTH, provinceTH} from "./lib.js";
import {t, useLang, getLang, setLang} from "./lib.js";   // สลับภาษา TH/EN — ดู src/i18n.js
import {getLayerOpacity, subscribeLayerOpacity} from "./layer-opacity.js";   // ความทึบ = ตั้งที่แอดมินที่เดียว
import {loadCountries, loadWorld, loadAreas, loadProvincesGeo, loadDetail, loadCountry, loadDistricts, defaultFilters} from "./data.js";
import {LoadingScreen, ToastHost, Badge, Btn, toast, LangToggle} from "./ui.js";
import {Login} from "./pages/login.js";
import * as auth from "./auth.js";   // โทเคน/บัญชีจริง (ดู api/auth.js · auth-store.cjs)
import {GeoStage} from "./stage.js";
import {Dashboard} from "./pages/dashboard.js";
import {AreaPanel, CustomerPanel} from "./panels.js";
import {Reports} from "./pages/reports.js";
import {Profile} from "./pages/profile.js";
import {Users, Config, Audit, Monitoring, SEED_USERS} from "./pages/admin.js";
import {loadTerritory} from "./territory-store.js";   // การมอบหมาย TC ↔ จังหวัด/โซน ที่แอดมินบันทึกไว้
import {BKK} from "./mock/geoData.js";
import {loadZoneRegistry, zoneRegistry, zonesOf, zoneLabel} from "./zone-registry.js";   // ทะเบียนโซน (แหล่งเดียว)
import {MasterData} from "./pages/master-data.js";
import {DataManagement, DataImport, DataFiles, DataLeads, TerritoryManager} from "./pages/data-management.js";
import {VisitPlanReport} from "./pages/visit-plan-report.js";
import {WelcomeDialog, isOnboarded, markOnboarded} from "./onboarding.js";
import {ProductTour} from "./tour.js";
import {HelpTips} from "./help.js";
import {VisitPlanner} from "./visit-planner.js";
import {AddRecordsForm, USER_SOURCE} from "./add-records.js";
import {OFFICE, officeFor, clusterCustomers, optimizeOrder} from "./visit.js";
import {pushAudit} from "./audit.js";
import {buildNotifs} from "./notifications.js";   // กระดิ่ง: กรองตามบทบาท + ขอบเขตพื้นที่ + สวิตช์จริง
import {deriveVisitStatus, planTodayKey} from "./visit-rounds.js";

// Country / Area / Customer are NOT nav items — they are interaction states of the one map.
// ⚠ ต้องเป็น "ฟังก์ชัน" ไม่ใช่ค่าคงที่ระดับโมดูล — label ผ่าน t() ซึ่งอ่านภาษาปัจจุบัน ณ เวลาที่เรียก
// ถ้าประกาศเป็น const array ตอนโหลดโมดูล ป้ายเมนูจะถูกล็อกเป็นภาษาแรกที่โหลดและไม่เปลี่ยนตอนสลับภาษา
const NAV = () => [
  {group:t("การดูแลระบบ","Administration"), admin:true, items:[
    {id:"monitoring", label:t("แดชบอร์ด","Dashboard"), icon:"monitor"},
    {id:"users", label:t("จัดการผู้ใช้","User Management"), icon:"users"},
    {id:"data-management", label:t("จัดการข้อมูล","Data Management"), icon:"layers", sub:[
      {id:"data-import", label:t("นำเข้าข้อมูล","Data Import")},
      {id:"data-files",  label:t("จัดการไฟล์นำเข้า","Import Files")},
      {id:"data-leads",  label:t("จัดการ Lead","Lead Management")},
    ]},
    {id:"territory", label:t("จัดการขอบเขตพื้นที่การขาย","Sales Territory Management"), icon:"map"},
    {id:"config", label:t("ตั้งค่าระบบ","System Settings"), icon:"config", sub:[
      {id:"master-data", label:t("ข้อมูลหลัก","Master Data")},
    ]},
    {id:"audit", label:t("บันทึกการตรวจสอบ","Audit Log"), icon:"audit"},
  ]},
];
const ADMIN = new Set(["users","data-management","data-import","data-files","data-leads","territory","config","master-data","audit","monitoring"]);
const MODALS = {reports:Reports, "visit-plans":VisitPlanReport, profile:Profile, users:Users, "data-management":DataManagement, "data-import":DataImport, "data-files":DataFiles, "data-leads":DataLeads, territory:TerritoryManager, config:Config, "master-data":MasterData, audit:Audit, monitoring:Monitoring};
// workspace/reports are no longer sidebar items, but other code (report breadcrumb, view state) still
// looks up these labels via TITLES, so keep them here explicitly.
const TITLES = () => ({...Object.fromEntries(NAV().flatMap(g=>g.items).flatMap(i=>[[i.id,i.label], ...(i.sub||[]).map(sb=>[sb.id,sb.label])])),
  workspace:t("แผนที่วิเคราะห์","Analysis Map"), reports:t("รายงาน","Reports"),
  "visit-plans":t("รายงานแผนการเข้าพบ","Visit Plan Report"), profile:t("โปรไฟล์","Profile")});
const THAILAND_CENTER = [13.2, 101];   // hardcoded fly-in target for the post-login intro (no search/query)
const INTRO_KEY = "geointel_intro";    // sessionStorage flag — the globe intro plays once per session

function App(){
  // Seed an EMPTY-but-shaped db so the app paints the globe skeleton on frame 1
  // (no null-gate, no dark loading screen). Each stage fills a slice progressively.
  // ภาษาปัจจุบัน (th|en) — hook เดียวของทั้งแอป: สลับภาษาแล้ว App re-render ทั้งต้นไม้
  // ทุก t() ในทุกไฟล์อ่านค่าใหม่พร้อมกัน · ส่งต่อทาง ctx ให้แผนที่ใช้เป็น dep ของ useEffect ด้วย
  const lang = useLang();
  const [db,setDb] = useState({countries:[], world:null, areas:[], areaByProvince:{}, districts:[], customers:[], prospects:[], provincesGeo:null});
  const [user,setUser] = useState(null);
  const [tcDenied,setTcDenied] = useState(null);   // หน้า 403 ของ TC เมื่อพยายามเข้าถึงข้อมูลนอกพื้นที่รับผิดชอบ
  const [zoneEdit,setZoneEdit] = useState(false);    // โหมดแก้รูปโซน: แถบเครื่องมือมาแทนแถบค้นหาบนแมพ
  const [zoneEditFrom,setZoneEditFrom] = useState(null);  // หน้าที่กดเข้ามา — กด "ออก" ต้องพากลับไปหน้านั้น
  // เซิร์ฟเวอร์เปิดโหมดเดโมอยู่ไหม — ใช้ตัดสินว่าจะโชว์เมนู "สลับบทบาท" ไหม
  // (เดิมดูแค่ ?demo= ใน URL พอเข้าผ่านหน้าล็อกอินจริงเมนูเลยหาย ทั้งที่ยังเป็นเครื่องเดโม)
  const [serverDemo,setServerDemo] = useState(false);
  useEffect(()=>{ let alive=true;
    auth.call("info").then(r=>{ if(alive && r.ok && r.demo) setServerDemo(true); });
    return ()=>{ alive=false; };
  },[]);
  const [territory,setTerritory] = useState(null);  // { คีย์หน่วย: id ของ TC } จากเซิร์ฟเวอร์ · null = ยังไม่เคยตั้ง
  // ?zone=LP — บทบาท "TC รายโซน" สำหรับเดโม: ล็อกโซนจาก URL ตรง ๆ ไม่ต้องรอการมอบหมายจากแอดมิน
  const demoZone = useMemo(()=>{ try{ return new URLSearchParams(location.search).get("zone")||null; }catch(e){ return null; } },[]);
  // ทะเบียนโซน — เมนู "TC รายโซน" และป้ายชื่อเขตอ่านจากตรงนี้ เพิ่มโซนใหม่แล้วโผล่เองไม่ต้องแก้โค้ด
  const [zonesReg,setZonesReg] = useState(()=>zoneRegistry());
  useEffect(()=>{ let alive=true; loadZoneRegistry().then(g=>{ if(alive) setZonesReg(g); }); return ()=>{ alive=false; }; },[]);
  // โหลดการมอบหมายหลังล็อกอิน — โหลดไม่ได้/ยังไม่เคยตั้ง = null แล้วแมพทำงานแบบเดิมทุกประการ
  useEffect(()=>{ if(!user){ setTerritory(null); return; }
    let alive=true;
    loadTerritory().then(r=>{ if(alive) setTerritory(r ? r.assign : null); });
    return ()=>{ alive=false; }; },[user]);

  // ── โซนที่ TC คนนี้ถือ (กทม. แบ่งเป็น SL/LP/TL) ─────────────────────────────
  // ⚠ ต้องอยู่เหนือ early return ทุกตัวของคอมโพเนนต์นี้ — ถ้าไปประกาศไว้ล่างกว่านั้น
  //   จำนวน hook ต่อรอบ render จะไม่เท่ากัน แล้ว React โยน error #310 หน้าขาวทั้งแอป
  // ตาราง assign เก็บเจ้าของเป็น "id" แต่ user ที่ล็อกอินมีแค่ email → จับคู่ผ่าน SEED_USERS
  // (บัญชีสาธิต tc@geointel.io ไม่มีใน SEED_USERS จึง fallback ไปเทียบ role + จังหวัด)
  const tcId = useMemo(()=>{
    if(!user || user.role!=="Trade Coordinator") return null;
    const byEmail = SEED_USERS.find(u=>u.email===user.email);
    if(byEmail) return byEmail.id;
    const byProv = SEED_USERS.find(u=>u.role==="Trade Coordinator" && u.province===user.province);
    return byProv ? byProv.id : null;
  },[user]);
  // null = ไม่จำกัดระดับโซน (เห็นทั้งจังหวัดเหมือนเดิม) — ทั้งตอนยังไม่เคยมอบหมาย
  // และตอน TC ถือครบทุกโซนในจังหวัด ซึ่งไม่ต่างอะไรกับดูทั้งจังหวัด
  const lockZones = useMemo(()=>{
    // เดโมรายโซนมาก่อนเสมอ — ใช้ดูว่า TC ของโซนนั้นเห็นอะไร โดยไม่ต้องตั้งค่าอะไรล่วงหน้า
    if(demoZone && user && user.role==="Trade Coordinator") return [demoZone];
    if(!territory || tcId==null || !user || !user.province) return null;
    const pre = user.province + "/";
    const all  = Object.keys(territory).filter(k=>k.startsWith(pre));
    const mine = all.filter(k=>territory[k]===tcId).map(k=>k.slice(pre.length));
    return (!mine.length || mine.length===all.length) ? null : mine;
  },[territory, tcId, user, demoZone]);
  const [view,setView] = useState("dashboard");        // dashboard (business overview) | workspace (globe/map)
  const [mode,setMode] = useState("globe");            // globe | map (within workspace)
  const [activeCountry,setActiveCountry] = useState(null);
  const [flyTarget,setFlyTarget] = useState(null);
  const [addForm,setAddForm] = useState(null);   // ฟอร์มเพิ่มลูกค้า/Lead: null=ปิด, {}=เพิ่มใหม่, {edit:record}=แก้ไข
  const [overlay,setOverlay] = useState(null);         // area|customer|reports|profile|admin…
  const [filters,setFilters] = useState(defaultFilters());
  // cluster defaults OFF so the map opens on individual data points rather than grouped count bubbles.
  // (lmap.js still falls back to light canvas dots automatically when a viewport gets too dense — see dotMode.)
  // zoomModes:true = เปิดโหมดแสดงผลตามระดับซูม 3 ขั้น (ซูมออก=Heat / กลาง=Cluster / ใกล้=Marker) เฉพาะแผนที่หลัก
  // existing/prospect เริ่มต้นเปิด เพราะเมื่อซูมเข้าถึงชั้น Cluster/Marker ต้องมีหมุดให้เห็น (ไม่งั้นซูมเข้าแล้วว่างเปล่า)
  const [layers,setLayers] = useState({heat:true,cluster:false,existing:true,prospect:true,province:false,zoomModes:true,route:true,
    op:getLayerOpacity()});   // ความทึบมาจาก "ตั้งค่าระบบ › การจัดการเลเยอร์" (แอดมิน) — ผู้ใช้ปรับเองไม่ได้แล้ว
  // แอดมินกดบันทึกที่หน้าตั้งค่า → แผนที่ปรับความทึบทันที ไม่ต้องรีเฟรช
  useEffect(()=>subscribeLayerOpacity(op=>setLayers(x=>({...x, op}))), []);
  const [selectedProvince,setSelectedProvince] = useState(null);
  const [selectedCustomer,setSelectedCustomer] = useState(null);
  const [collapsed,setCollapsed] = useState(false);
  const [menu,setMenu] = useState(null);
  const [roleSub,setRoleSub] = useState(false);   // เมนูย่อย "สลับบทบาท (เดโม)" เปิด/ปิด
  const [langSub,setLangSub] = useState(false);   // เมนูย่อย "ภาษา" เปิด/ปิด
  // (ภาษาปัจจุบันประกาศไว้แล้วที่บรรทัด 61 — merge จาก remote เคยทำให้ซ้ำกันสองที่)
  const [gsearch,setGsearch] = useState("");
  const [loadingData,setLoadingData] = useState(false);
  const [profileTab,setProfileTab] = useState("info");   // which Profile tab "View Profile / Change Password / Notifications" opens
  const [showWelcome,setShowWelcome] = useState(false);  // first-login onboarding welcome dialog
  const [tourOpen,setTourOpen] = useState(false);        // product tour framework
  const [tourPanel,setTourPanel] = useState(null);       // panel the tour pins open ("layers" | "filter")
  const [tourFocus,setTourFocus] = useState(null);       // map fly-to target for marker/cluster tour steps
  const [globeUnder,setGlobeUnder] = useState(false);    // keep the globe rendered beneath the map during the arrival fade
  const [introPlaying,setIntroPlaying] = useState(false); // post-login globe intro animation in progress (shows the Skip button)
  // Customer Visit Planning — รองรับหลายแผน แต่ละแผนมี id/ชื่อ/รายชื่อลูกค้า/เส้นทาง/สถานะบันทึกของตัวเอง
  const [visitPlans,setVisitPlans] = useState([{id:"plan-1", name:t("แผนที่ 1", "Plan 1"), customers:[], route:null, saved:false, visitDate:""}]);
  const [activePlanId,setActivePlanId] = useState("plan-1");
  const activePlan = visitPlans.find(p=>p.id===activePlanId) || visitPlans[0];
  const visitPlan = activePlan ? activePlan.customers : [];
  const visitRoute = activePlan ? activePlan.route : null;
  const setVisitPlan = updater => setVisitPlans(prev => prev.map(p =>
    p.id===activePlanId ? {...p, customers: typeof updater==="function" ? updater(p.customers) : updater} : p));
  const setVisitRoute = route => setVisitPlans(prev => prev.map(p => p.id===activePlanId ? {...p, route} : p));
  const createPlan = name => { const id = "plan-"+Date.now(); setVisitPlans(prev=>[...prev, {id, name, customers:[], route:null, saved:false, visitDate:""}]); setActivePlanId(id); };
  const deletePlan = id => setVisitPlans(prev=>{
    const next = prev.filter(p=>p.id!==id);
    if(next.length===0) next.push({id:"plan-"+Date.now(), name:t("แผนที่ 1", "Plan 1"), customers:[], route:null, saved:false, visitDate:""});
    if(activePlanId===id) setActivePlanId(next[0].id);
    return next;
  });
  const renamePlan = (id, name) => setVisitPlans(prev=>prev.map(p=>p.id===id?{...p,name}:p));
  const savePlan = ()=> setVisitPlans(prev=>prev.map(p=>p.id===activePlanId?{...p,saved:true}:p));
  const setVisitDate = d => setVisitPlans(prev=>prev.map(p=>p.id===activePlanId?{...p,visitDate:d}:p));
  const addToPlan = c => { setVisitPlan(p=> p.find(x=>x.id===c.id)? p : [...p, c]); setVisitRoute(null); };
  // กด "เลือกลูกค้า" ในแผงวางแผนเข้าพบ → ซูมเข้าไปในพื้นที่จนเห็นหมุดระดับไอคอน (zoom 13) เพื่อให้แตะเลือกลูกค้าได้
  // เล็งไปที่จุดศูนย์กลางของลูกค้า+Leadในจังหวัดที่กำลังดูอยู่ (ไม่ใช่ที่ตั้งสำนักงานใหญ่ ซึ่งอยู่คนละจังหวัด)
  const focusPickCustomers = ()=>{
    const prov = (filters.province && filters.province!=="All") ? filters.province : selectedProvince;
    const all = [...(db.customers||[]), ...(db.prospects||[])].filter(x=> (!prov || x.province===prov) && x.latitude && x.longitude);
    let lat, lng;
    if(all.length){ lat = all.reduce((s,x)=>s+x.latitude,0)/all.length; lng = all.reduce((s,x)=>s+x.longitude,0)/all.length; }
    else { const a = db.areaByProvince && prov && db.areaByProvince[prov]; if(a && a.center){ lng=a.center[0]; lat=a.center[1]; } }
    if(lat==null || lng==null) return;
    setTourFocus({lat, lng, zoom:12, seq:Date.now()});   // zoom 12 = ระดับที่ซูมออกกว้างสุดที่ยังเห็นหมุดไอคอนรายจุด (ต่ำกว่านี้กลายเป็นกลุ่ม cluster)
  };

  // ── เพิ่ม/แก้ไข/ลบ ลูกค้า-Leadที่ผู้ใช้กรอกเอง (source = ผู้ใช้เพิ่มเอง) ──
  const addRecords = recs => {
    setDb(prev=>{
      const custs=[...(prev.customers||[])], pros=[...(prev.prospects||[])];
      recs.forEach(r=> r.status==="Existing" ? custs.push(r) : pros.push(r));
      return {...prev, customers:custs, prospects:pros};
    });
    setFilters(f=>({...f, province:"All"}));   // แสดงทุกจังหวัดเพื่อให้หมุดใหม่โผล่แน่นอน
    setLayers(x=>({...x,
      existing: recs.some(r=>r.status==="Existing") ? true : x.existing,
      prospect: recs.some(r=>r.status==="Prospect") ? true : x.prospect }));
    toast(`${t("เพิ่มข้อมูล", "Added")} ${recs.length} ${t("รายการเรียบร้อย", "records")}`, "good");
    setAddForm(null);
  };
  const updateRecord = recs => {   // โหมดแก้ไข: recs มี 1 รายการ ใช้ id เดิม (อาจย้ายประเภทลูกค้า↔Lead)
    const r = recs[0];
    setDb(prev=>{
      const custs=(prev.customers||[]).filter(x=>x.id!==r.id);
      const pros=(prev.prospects||[]).filter(x=>x.id!==r.id);
      if(r.status==="Existing") custs.push(r); else pros.push(r);
      return {...prev, customers:custs, prospects:pros};
    });
    setSelectedCustomer(r);
    toast(t("บันทึกการแก้ไขแล้ว", "Changes saved"),"good");
    setAddForm(null);
  };
  // ลบระเบียนจากหน้า "จัดการข้อมูล" (ผู้ดูแลระบบ) — ไม่ติดเงื่อนไข "เฉพาะรายการที่เพิ่มเอง" แบบแผงบนแผนที่
  const adminDeleteRecord = rec => {
    setDb(prev=>({...prev,
      customers:(prev.customers||[]).filter(x=>x.id!==rec.id),
      prospects:(prev.prospects||[]).filter(x=>x.id!==rec.id) }));
    pushAudit({ user:(user&&user.email)||"system", action:t("ลบระเบียน", "Delete record"), category:"ลบ",
      detail:`${rec.businessName} (${rec.accountNo||rec.id})` });
    toast(t("ลบรายการแล้ว", "Record deleted"),"good");
  };
  const deleteRecord = rec => {
    if(rec.source!==USER_SOURCE){ toast(t("ลบได้เฉพาะรายการที่คุณเพิ่มเอง", "You can only delete records you added yourself"),"warn"); return; }
    setDb(prev=>({...prev,
      customers:(prev.customers||[]).filter(x=>x.id!==rec.id),
      prospects:(prev.prospects||[]).filter(x=>x.id!==rec.id) }));
    setSelectedCustomer(null); setOverlay(null);
    toast(t("ลบรายการแล้ว", "Record deleted"),"good");
  };
  // เปลี่ยนสถานะการเข้าพบของLead (สลับสองทางได้) — แก้ในชุดข้อมูลจริงแล้วซิงค์กับ panel ที่เปิดอยู่
  // ใช้เฉพาะLeadเท่านั้น (ลูกค้าเดิมไม่มีสถานะนี้) หน้ารายงานที่อ่าน db.prospects จะอัปเดตตามทันที
  const setVisitStatus = (rec, status)=>{
    setDb(prev=>({...prev,
      prospects:(prev.prospects||[]).map(x=> x.id===rec.id ? {...x, visit_status:status} : x) }));
    setSelectedCustomer(x=> x && x.id===rec.id ? {...x, visit_status:status} : x);
    toast(status==="ครอบคลุมแล้ว" ? t("บันทึกว่าเข้าพบแล้ว", "Marked as visited") : t("ปรับกลับเป็นยังไม่เข้าพบ", "Reset to not visited"), "good");
  };
  // เพิ่มรอบการเข้าพบ 1 รอบ → สถานะLead derive ใหม่อัตโนมัติ + visit_status สรุปกลับ (back-compat) + Audit Log
  const addVisitRound = (rec, round)=>{
    const merge = x => { const rs=[...(x.visitRounds||[]), round]; return {...x, visitRounds:rs, visit_status:deriveVisitStatus(rs)}; };
    setDb(prev=>({...prev, prospects:(prev.prospects||[]).map(x=> x.id===rec.id ? merge(x) : x) }));
    setSelectedCustomer(x=> x && x.id===rec.id ? merge(x) : x);
    pushAudit({ user:(user&&user.email)||"system", action:t("บันทึกรอบการเข้าพบ", "Visit round saved"), category:"แก้ไข",
      detail:`${rec.businessName} ${t("· รอบที่", "· round")} ${round.round} · ${round.status}${round.outcome?" · "+round.outcome:""}` });
    toast(t("บันทึกการติดตามการเข้าพบแล้ว", "Visit follow-up saved"),"good");
  };

  // ── TC ยกเลิกการเข้าพบ Lead ──
  // ถอด Lead ออกจากทุกแผน (รวมแผนที่บันทึกยืนยันแล้ว) เพื่อคืนให้ TC คนอื่นรับต่อได้
  // แต่ "ประวัติ" ไม่ถูกลบ — บันทึกเป็นรอบสถานะ "ยกเลิก" พร้อมเหตุผล ให้ TC คนถัดไปเห็นว่าทำไมถึงถูกปล่อย
  const cancelVisit = (rec, reason, note)=>{
    const round = { round:((rec.visitRounds||[]).length)+1, status:"ยกเลิก", reason, note:note||"",
      date:planTodayKey(), by:(user&&user.name)||"TC" };
    addVisitRound(rec, round);
    setVisitPlans(prev=>prev.map(p=>{
      const left=(p.customers||[]).filter(x=>x.id!==rec.id);
      return left.length===(p.customers||[]).length ? p : {...p, customers:left, route:null};
    }));
  };

  // ── โฟลว์ปิดดีลLead → แอดมินอนุมัติเปลี่ยนเป็นลูกค้า ──
  // TC ส่งสถานะ "ดีลสำเร็จ" (แนบเอกสารได้) → prospect.dealStatus="pending" เข้าคิวรออนุมัติในหน้าจัดการข้อมูล
  const submitDeal = (prospect, doc)=>{
    const stamp = { dealStatus:"pending", dealDoc:doc||"", dealVisitor:(user&&user.name)||"TC",
      dealVisitDate:(activePlan&&activePlan.visitDate)||"", dealSubmittedDate:new Date().toISOString().slice(0,10) };
    setDb(prev=>({...prev, prospects:(prev.prospects||[]).map(x=> x.id===prospect.id ? {...x, ...stamp} : x) }));
    setSelectedCustomer(x=> x && x.id===prospect.id ? {...x, ...stamp} : x);
    pushAudit({ user:(user&&user.email)||"system", action:t("ส่งดีลปิดการขาย", "Deal submitted for closing"), category:"แก้ไข",
      detail:`${prospect.businessName} ${t("· รออนุมัติเปลี่ยนเป็นลูกค้า", "· awaiting approval to convert to customer ")}${doc?t(" · แนบ ", " · attached ")+doc:""}` });
    toast(t("ส่งดีลให้แอดมินตรวจสอบแล้ว", "Deal sent to the admin for review"),"good");
  };
  // แอดมินอนุมัติ → ย้าย Lead ไปเป็นสมาชิกเครือข่าย (status Existing) → Lead ของหมวดนั้นลดลง heat/marker ทั้งระบบขยับตาม
  const approveDeal = (prospect)=>{
    // ลูกค้าที่เกิดจากการปิดดีลใช้ฟิลด์ชุดเดียวกับข้อมูลลูกค้าจริง (ไม่มียอดขาย/สถานะการค้า)
    const asCust = {...prospect, status:"Existing", dealStatus:"approved",
      accountNo: prospect.id, dateJoin: new Date().toISOString().slice(0,10),
      phone: prospect.phone||null, website: prospect.website||null, facebook: prospect.facebook||null,
      convertedFrom:"prospect" };
    setDb(prev=>({...prev,
      prospects:(prev.prospects||[]).filter(x=>x.id!==prospect.id),
      customers:[...(prev.customers||[]), asCust] }));
    setSelectedCustomer(x=> x && x.id===prospect.id ? asCust : x);
    pushAudit({ user:(user&&user.email)||"system", action:t("อนุมัติดีล เปลี่ยนเป็นลูกค้า", "Deal approved — converted to customer"), category:"แก้ไข",
      detail:`${prospect.businessName} · ${provinceTH(prospect.province)}` });
    toast(`${t("อนุมัติดีล — \"", "Deal approved — \"")}${prospect.businessName}${t("\" เป็นลูกค้าแล้ว", "\" is now a customer")}`,"good");
  };
  const rejectDeal = (prospect)=>{
    setDb(prev=>({...prev, prospects:(prev.prospects||[]).map(x=> x.id===prospect.id ? {...x, dealStatus:"rejected"} : x) }));
    pushAudit({ user:(user&&user.email)||"system", action:t("ตีกลับดีล", "Deal returned"), category:"แก้ไข", detail:`${prospect.businessName}` });
    toast(t("ตีกลับดีลแล้ว — ส่งกลับให้ TC", "Deal returned — sent back to the TC"),"warn");
  };

  // STARTUP: progressive streaming. Stage 1 (tiny country aggregates) lets the globe
  // dots draw; stages 2-3 (borders, province aggregates) stream in without blocking.
  useEffect(()=>{ (async()=>{
    const countries = await loadCountries();                                   // Stage 1 (2.5 KB)
    setDb(prev=>({...prev, countries}));
    loadWorld().then(world=>setDb(prev=>({...prev, world}))).catch(()=>{});     // Stage 2 (borders)
    loadAreas().then(a=>setDb(prev=>({...prev, areas:a.areas, areaByProvince:a.areaByProvince}))).catch(()=>{}); // Stage 3 (aggregates)
    loadDistricts().then(districts=>setDb(prev=>({...prev, districts}))).catch(()=>{});                          // Stage 3b (district aggregates)

    const q=new URLSearchParams(location.search);
    if(q.get("demo")){ let demo=q.get("demo");
      // บทบาท "ผู้ใช้ธุรกิจ (user)" เดิมถูกยกเลิก → เปลี่ยนเส้นทางเป็น TC และแก้ URL ให้ตรง (คงพารามิเตอร์ go/prov เดิม)
      if(demo==="user"){ demo="tc"; const u=new URL(location.href); u.searchParams.set("demo","tc"); history.replaceState(null,"",u.pathname+u.search+u.hash); }
      const admin=demo==="admin"; const tc=demo==="tc";
      // ── TC: เข้าสู่ระบบแล้วเข้า "หน้าจังหวัดที่รับผิดชอบ" ทันที ไม่ผ่านลูกโลก · จังหวัดมาจาก session (ในเดโมฝังใน user) ──
      if(tc){
        const noprov=q.get("noprov")==="1"; const prov=noprov?null:(q.get("prov")||"Chiang Mai");
        // ⚠ บัญชีเดโมต้องเป็น "คนเดียวกัน" กับที่แอดมินเห็นในหน้ามอบหมาย ไม่งั้นมอบหมายให้ ณัฐริกา
        //   แล้วเปิดเดโมกลับไม่เห็นอะไรเลย เพราะตาราง assign เก็บเป็น id ของบัญชีจริงใน SEED_USERS
        //   จึงหยิบ TC ตัวจริงของจังหวัดนั้นมาใช้ (?tc=<email> ระบุเองได้ถ้าจังหวัดมี TC หลายคน)
        const wantEmail = q.get("tc");
        const seedTC = SEED_USERS.find(u=>u.role==="Trade Coordinator" &&
          (wantEmail ? u.email===wantEmail : (prov ? u.province===prov : false)));
        const initialsOf = n => (n||"TC").trim().slice(0,2);
        setUser(seedTC
          ? {role:"Trade Coordinator", name:seedTC.name, email:seedTC.email, initials:initialsOf(seedTC.name), province:prov}
          : {role:"Trade Coordinator", name:"ธนพล ศรีวัฒน์", email:"tc@geointel.io", initials:"TC", province:prov});
        pushAudit({user:(seedTC&&seedTC.email)||"tc@geointel.io", action:t("เข้าสู่ระบบ", "Sign in"), category:"เข้าสู่ระบบ", detail: prov?(t("พื้นที่รับผิดชอบ: ", "Territory: ")+provinceTH(prov)):t("ยังไม่กำหนดพื้นที่รับผิดชอบ", "No territory assigned yet")});
        if(prov){
          // เข้าหน้าจังหวัดทันที (ตั้ง view/map ก่อน) แล้วค่อยโหลดข้อมูลเบื้องหลัง —
          // กันอาการค้างที่ลูกโลกถ้า loadCountry ช้า/ล้มเหลว (TC ต้องอยู่หน้าจังหวัดที่รับผิดชอบเสมอ)
          setActiveCountry("Thailand"); setSelectedProvince(prov); setFilters(f=>({...f, province:prov}));
          setView("workspace"); setMode("map");
          const go=q.get("go");
          loadCountry("Thailand").then(cd=>{ setDb(prev=>({...prev,...cd}));
            if(go==="reports") setOverlay("reports");
            else if(go==="visit-plans") setOverlay("visit-plans");
            else if(go==="customer"){ const c=(cd.customers||[]).find(x=>x.province===prov); if(c){ setSelectedCustomer(c); setOverlay("customer"); } }
            else if(go==="area") setOverlay("area");
          }).catch(()=>{});
        }
        if(q.get("tour")) setTourOpen(true);
        return;   // จบเส้นทาง TC — ไม่เข้าเส้นทาง admin/user (ที่ลง globe)
      }
      // ไม่ใช่ TC แล้ว → ผู้ดูแลระบบ (admin) หรือ ผู้บริหาร (management/ค่าอื่น) · ไม่มีบทบาท "ผู้ใช้ธุรกิจ" อีกต่อไป
      setUser(admin
        ? {role:"Administrator", name:t("ผู้ดูแลระบบ", "System Administrator"), email:"admin@geointel.io", initials:"SA"}
        : {role:"Management", name:t("ผู้บริหาร", "Management"), email:"management@geointel.io", initials:"MG"});
      setView("workspace"); setMode("globe");   // everyone lands on the Geo Intelligence Workspace
      const go=q.get("go");
      // ผู้บริหาร: ลูกโลกหมุนเข้าหาประเทศไทยเอง แล้วเปิดแผนที่ทั้งประเทศ (ไม่ต้องเลือกจังหวัดก่อน)
      if(!admin && !go){
        setFilters(f=>({...f, province:"All"}));
        selectCountry("Thailand", THAILAND_CENTER);
      }
      if(go==="country"||go==="area"||go==="customer"){
        const cd=await loadCountry("Thailand"); setDb(prev=>({...prev,...cd}));
        setView("workspace"); setActiveCountry("Thailand"); setMode("map");
        // แอดมินไม่มีแผงวิเคราะห์พื้นที่ — ?go=area จึงพาไปที่จังหวัดเฉย ๆ ไม่เปิดแผง
        if(go==="area"){ setSelectedProvince(cd.areas[0].province); setOverlay(admin ? null : "area"); }
        else if(go==="customer"){ setSelectedCustomer(cd.customers[0]); setOverlay("customer"); }
      }
      // รายงานแผนการเข้าพบเป็นของ TC เท่านั้น — admin/ผู้บริหารเข้า URL ตรง ถูกเปลี่ยนเส้นทางออก (คงอยู่หน้า workspace)
      else if(go==="visit-plans"){ toast(t("หน้านี้สำหรับผู้ประสานงานการค้าเท่านั้น", "This page is for Trade Coordinators only"),"bad"); }
      // เปิดหน้าก่อนแล้วค่อยโหลดเบื้องหลัง ถ้ารอโหลดก่อนแล้วคำขอล้มเหลว หน้าจะไม่ถูกเปิดเลย
      // กันบทบาทที่ไม่ใช่ Administrator บังคับเปิดหน้าผู้ดูแลผ่าน ?go= (เช่น master-data) — ไม่ตั้ง overlay เลย (ไม่มีสิทธิ์)
      else if(go && MODALS[go] && (!ADMIN.has(go) || admin)){ setOverlay(go); ensureData("Thailand").catch(()=>{}); }
      if(q.get("tour")) setTourOpen(true);   // dev/test entry point for the product-tour framework
    }
  })().catch(()=>toast(t("โหลดข้อมูลเริ่มต้นไม่สำเร็จ ลองรีเฟรชหน้าอีกครั้ง", "Could not load the initial data — please refresh the page"),"bad")); },[]);

  // close the top-right menus when clicking anywhere outside them
  useEffect(()=>{ if(!menu) return;
    const h=e=>{ if(!e.target.closest(".tb-right")) setMenu(null); };
    document.addEventListener("mousedown",h);
    return ()=>document.removeEventListener("mousedown",h);
  },[menu]);
  const openProfile=(tab="info")=>{ setProfileTab(tab); setMenu(null); setOverlay("profile"); };

  // First login only: show the welcome dialog once. Dismissing (either button) marks it seen.
  useEffect(()=>{ if(user && !isOnboarded(user.email)) setShowWelcome(true); },[user]);
  const startTour = ()=>{ markOnboarded(user.email); setShowWelcome(false); setTourOpen(true); };
  const skipWelcome = ()=>{ markOnboarded(user.email); setShowWelcome(false); };
  const endTour = ()=>{ setTourOpen(false); setTourPanel(null); setTourFocus(null); };

  // Tour view orchestration — the workspace switches between the globe and the country
  // map as interaction states of the SAME screen (no navigation). Used by step `before` hooks.
  const tourShowGlobe = ()=>{ setTourPanel(null); setOverlay(null); setView("workspace"); setMode("globe"); setActiveCountry(null); };
  const tourShowMap = async (panel=null)=>{ const cd=await ensureData("Thailand"); setView("workspace"); setActiveCountry("Thailand"); setMode("map"); setOverlay(null); setTourPanel(panel); return cd; };
  // open a customer detail drawer (map interaction state — no navigation) for the Detail-Panel step
  const tourShowDetail = async ()=>{ const cd=await ensureData("Thailand"); setView("workspace"); setActiveCountry("Thailand"); setMode("map"); setTourPanel(null);
    const c = cd.customers && cd.customers[0]; if(c){ setSelectedCustomer(c); setOverlay("customer"); } };
  const TOUR_STEPS = [
    { target:"#globe-canvas", placement:"center", padding:0, before:tourShowGlobe,
      title:t("ลูกโลกสามมิติ", "3D globe"),
      body:html`${t("นี่คือพื้นที่หลักของระบบ", "This is the main workspace")}<br/>${t("ใช้สำหรับวิเคราะห์ข้อมูลเชิงพื้นที่", "used for spatial analysis.")}` },
    { target:'[data-tour="country"]', placement:"bottom", before:tourShowGlobe,
      title:t("เลือกประเทศ", "Pick a country"),
      body:html`${t("เลือกประเทศที่ต้องการวิเคราะห์", "Pick the country you want to analyse —")}<br/>${t("ลูกโลกจะหมุนไปยังประเทศนั้นโดยอัตโนมัติ", "the globe spins to it automatically,")}<br/>${t("โดยไม่เปลี่ยนหน้า", "without leaving the page.")}` },
    { target:'[data-tour="search"]', placement:"bottom", before:()=>tourShowMap(),
      title:t("ค้นหาจังหวัด / ลูกค้า", "Search provinces / customers"),
      body:html`${t("พิมพ์ชื่อจังหวัด ลูกค้า หรือLead", "Type a province, customer or Lead name")}<br/>${t("เพื่อค้นหาและซูมไปยังตำแหน่งนั้นได้ทันที", "to find it and zoom straight to that location.")}` },
    { target:'[data-tour="segments"]', placement:"right", before:()=>tourShowMap(),
      title:t("กรองตามหมวดธุรกิจ", "Filter by business category"),
      body:html`${t("เลือกหมวดธุรกิจจาก dropdown ท้ายแผงเลเยอร์ เพื่อเปิด/ปิดการแสดงผลบนแผนที่", "Pick business categories from the dropdown at the bottom of the layer panel to show or hide them on the map")}` },
    { target:'[data-tour="layers"]', placement:"left", before:()=>tourShowMap(),
      title:t("เลเยอร์แผนที่", "Map layers"),
      body:html`${t("ปรับการแสดงผลบนแผนที่ได้ 2 ชั้น", "The map has two display layers:")}
        <div style=${{margin:"8px 0 0",lineHeight:1.9}}>${t("• Heat map Lead สูง (อัตโนมัติตามระดับซูม)", "• High-Lead heatmap (automatic, by zoom level)")}<br/>${t("• สถานะ marker (ลูกค้าปัจจุบัน/Lead แยกทึบแสงได้)", "• Marker status (customers / Leads, with separate opacity)")}<br/>${t("• ชั้นพื้นที่จังหวัด — สีไล่ระดับตามดัชนีช่องว่าง", "• Province layer — shaded by the gap index")}</div>` },
    { target:".geo-mk", placement:"auto", padding:6,
      before:async ()=>{ const cd=await tourShowMap(null); const c=cd&&cd.customers&&cd.customers[0];
        if(c) setTourFocus({lat:c.latitude,lng:c.longitude,zoom:12,seq:Date.now()}); },
      title:t("หมุดลูกค้า (Marker)", "Customer markers"),
      body:html`${t("Marker แสดงตำแหน่งลูกค้า", "Markers show where customers are.")}
        <div style=${{margin:"8px 0 0",lineHeight:1.9}}>${t("ลูกค้าปัจจุบัน", "Existing customers")}<br/>Lead</div>
        <div style=${{marginTop:"8px"}}>${t("ค่าเริ่มต้น marker ปิดอยู่ ต้องเปิดเองที่กล่องเลเยอร์แผนที่", "Markers are off by default — turn them on in the map layers panel.")}</div>
        <div style=${{marginTop:"8px"}}>${t("คลิกเพื่อดูรายละเอียด", "Click one for details.")}</div>` },
    { target:'[data-tour="detail"]', placement:"left", before:tourShowDetail,
      title:t("รายละเอียดลูกค้า", "Customer details"),
      body:html`${t("เมื่อคลิก Marker", "When you click a marker,")}<br/>${t("ระบบจะแสดงข้อมูลลูกค้า", "the customer's details appear.")}<br/>${t("โดยไม่เปลี่ยนหน้า", "without leaving the page.")}
        <div style=${{marginTop:"8px"}}>${t("ลูกค้าปัจจุบันแสดงฝั่งซ้าย", "Existing customers show on the left,")}<br/>${t("Leadแสดงฝั่งขวา", "Leads on the right.")}</div>` },
    { placement:"center", final:true, finishLabel:t("เริ่มใช้งาน", "Get started"), before:()=>setTourPanel(null),
      title:t("พร้อมเริ่มใช้งาน", "You're all set"),
      body:html`${t("คุณพร้อมใช้งานระบบแล้ว", "You're ready to go —")}<br/>${t("เริ่มวิเคราะห์ข้อมูลลูกค้า ค้นหาโอกาสทางธุรกิจ", "start analysing customer data, finding opportunities,")}<br/>${t("และวางแผนการเข้าพบลูกค้าได้ทันที", "and planning customer visits right away.")}` },
  ];

  // Lazily fetch + cache one country's working set, merge into db.
  const ensureData = async (country="Thailand")=>{
    const cd = await loadCountry(country);
    setDb(prev=>({...prev, ...cd}));
    return cd;
  };
  // ครอบการโหลดที่ต้องบังหน้าจอไว้ ใช้เฉพาะเส้นทางที่ต้องได้ข้อมูลก่อนถึงจะรู้ว่าจะเปิดอะไร
  // ที่ต้องมี finally เพราะเดิมเขียน setLoadingData(false) ต่อท้ายบรรทัดเฉยๆ
  // พอคำขอไฟล์ล้มเหลว (เน็ตสะดุด เซิร์ฟเวอร์รีสตาร์ต ฯลฯ) await จะโยนข้อผิดพลาดออกไปก่อน
  // บรรทัดปิดหน้าจอโหลดจึงไม่ถูกรันเลย ทำให้กล่อง "กำลังโหลดข้อมูล…" ค้างทับลูกโลกถาวร
  // คืนค่า null เมื่อโหลดไม่สำเร็จ ผู้เรียกต้องเช็คก่อนใช้งานต่อเสมอ
  const withLoading = async (งาน)=>{
    setLoadingData(true);
    try { return await งาน(); }
    catch(err){ toast(t("โหลดข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง", "Could not load the data — please try again"),"bad"); return null; }
    finally { setLoadingData(false); }
  };
  // โหลดเบื้องหลังแบบไม่บังหน้าจอ ใช้กับหน้าที่มีข้อความรอโหลดของตัวเองอยู่แล้ว
  const โหลดเบื้องหลัง = ()=>{ ensureData("Thailand").catch(()=>toast(t("โหลดข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง", "Could not load the data — please try again"),"bad")); };
  // Everyone lands on the Geo Intelligence Workspace (globe). The Business Overview lives only in the 'แดชบอร์ดผู้บริหาร (monitoring)' admin page.
  const handleLogin = (u)=>{
    setIntroPlaying(false);
    // หน้า login ส่งข้อมูลบัญชีจริงมา (ไม่มี initials) — ทำตัวย่อจากชื่อให้เอง
    u = u && { ...u, initials: u.initials || String(u.name||"?").trim().slice(0,2) };
    // TC ต้องถูกล็อกอยู่ "จังหวัดที่รับผิดชอบ" เสมอ — เข้าหน้าจังหวัดโดยตรง ไม่ผ่านลูกโลก และต้องมี province เสมอ
    // (หน้า login ไม่ได้ส่ง province มา จึงกำหนดค่าเริ่มต้นที่นี่ · ในระบบจริงค่านี้จะมาจากบัญชีผู้ใช้)
    if(u && u.role==="Trade Coordinator"){
      const prov = u.province || "Chiang Mai";
      setUser({...u, province:prov});
      setActiveCountry("Thailand"); setSelectedProvince(prov); setFilters(f=>({...f, province:prov}));
      setView("workspace"); setMode("map");
      loadCountry("Thailand").then(cd=>setDb(prev=>({...prev,...cd}))).catch(()=>{});
      return;
    }
    setUser(u); setView("workspace"); setMode("globe");
    // ผู้บริหาร: ลูกโลกหมุนเข้าหาประเทศไทยเองทันทีหลังเข้าระบบ แล้วเปิดแผนที่ทั้งประเทศ
    // (ไม่ต้องเลือกจังหวัดจากการ์ดก่อน — การ์ดจะไม่ขึ้นเพราะ flyTarget ถูกตั้งแล้ว)
    // จังหวัดยังกรองได้จากช่อง "ทุกจังหวัด" บนแถบเหนือแผนที่
    if(u && u.role!=="Administrator"){
      setFilters(f=>({...f, province:"All"}));
      selectCountry("Thailand", THAILAND_CENTER);
    }
    // ผู้ดูแลระบบยังเข้าหน้าลูกโลกแบบเลือกจังหวัดเองตามเดิม
  };
  // A featured-province card was clicked on the globe: scope every data stage to that province, warm the
  // caches, then fly the globe in. arriveCountry (the globe's onArrive) reveals the map; the province
  // filter is already set, so the map zooms to that province's bounds and shows only its data.
  const selectProvinceFromGlobe = (province, center)=>{
    setSelectedProvince(province); setFilters(f=>({...f, province}));
    loadAreas().then(a=>setDb(prev=>({...prev, areas:a.areas, areaByProvince:a.areaByProvince}))).catch(()=>{});
    loadDistricts().then(districts=>setDb(prev=>({...prev, districts}))).catch(()=>{});
    loadProvincesGeo().then(geo=>setDb(prev=>({...prev, provincesGeo:geo}))).catch(()=>{});
    loadDetail("Thailand").catch(()=>{});
    setFlyTarget({country:"Thailand", center, seq:Date.now()});
  };
  const skipIntro = ()=>{ setIntroPlaying(false); arriveCountry("Thailand"); };   // jump straight to the map
  // Warm every map stage the moment a market is picked, so each is cached by the time
  // the globe finishes flying in (aggregates → outlines → detail).
  const selectCountry = (country,center)=>{
    loadAreas().then(a=>setDb(prev=>({...prev, areas:a.areas, areaByProvince:a.areaByProvince}))).catch(()=>{});
    loadDistricts().then(districts=>setDb(prev=>({...prev, districts}))).catch(()=>{});
    loadProvincesGeo().catch(()=>{});
    loadDetail(country).catch(()=>{});
    setFlyTarget({country,center,seq:Date.now()});
  };
  // Globe finished flying in → reveal the 2D map on the SAME page. Staged, non-blocking:
  //   • enter the map immediately with province AGGREGATES → a coarse high-demand-gap heat paints at once
  //   • province outlines and the individual markers / fine heatmap stream in after
  const arriveCountry = async (country)=>{
    setIntroPlaying(false);                               // the globe intro (if any) is finished — hide the Skip button
    const a = await loadAreas();                          // tiny (22 KB, usually already cached)
    setDb(prev=>({...prev, areas:a.areas, areaByProvince:a.areaByProvince}));
    setGlobeUnder(true);
    setView("workspace"); setActiveCountry(country); setMode("map"); setOverlay(null);
    setTimeout(()=>setGlobeUnder(false), 900);
    loadProvincesGeo().then(geo=>setDb(prev=>({...prev, provincesGeo:geo}))).catch(()=>{});
    loadDetail(country).then(d=>setDb(prev=>({...prev, customers:d.customers, prospects:d.prospects}))).catch(()=>{});
    loadDistricts().then(districts=>setDb(prev=>({...prev, districts}))).catch(()=>{});
  };
  // Back to the globe / province-picker screen. Clearing flyTarget is essential: the Globe unmounts while the
  // map is up, so returning here REMOUNTS it — a stale flyTarget would make its mount effect re-fly to the last
  // province and then fire onArrive, bouncing the user straight back into the map.
  // กระดิ่ง: เหตุการณ์ที่บทบาทนี้มีสิทธิ์ได้รับ · ข้อความนับจากข้อมูลจริงในขอบเขตของผู้ใช้
  const notifs = useMemo(()=>buildNotifs(user, db), [user, db.customers, db.prospects]);

  const backToGlobe = ()=>{ setView("workspace"); setMode("globe"); setActiveCountry(null); setSelectedProvince(null); setFilters(f=>({...f,province:"All"})); setOverlay(null); setFlyTarget(null); };
  // คลิกจังหวัด = กรองแผนที่ไปที่จังหวัดนั้น · แผงวิเคราะห์พื้นที่เปิดให้ "ผู้บริหาร" เท่านั้น
  //   TC    ดูแค่เขตที่รับผิดชอบ ไม่ต้องวิเคราะห์ภาพรวม
  //   แอดมิน งานคือดูแลระบบ/ขอบเขต/ผู้ใช้ ไม่ใช่วิเคราะห์ตลาด — แผงนี้บังแมพตอนลากขอบโซนด้วย
  const pickProvince = p =>{ setSelectedProvince(p); setFilters(f=>({...f,province:p}));
    setOverlay(isTC || isAdmin ? null : "area"); };
  const pickCustomer = c =>{ setSelectedCustomer(c); setOverlay("customer"); };
  // topbar-search province result → just zoom to the province (the province-filter effect flies there); no panel
  const pickProvinceZoom = p =>{ if(tcGuard(p, t("พื้นที่ ", "Area ")+provinceTH(p))) return; setSelectedProvince(p); setFilters(f=>({...f,province:p})); setOverlay(null); };
  // TC เข้าถึงได้เฉพาะพื้นที่ที่รับผิดชอบ — ถ้าจังหวัดของทรัพยากรไม่ตรง session → 403 (บันทึก Audit Log)
  const tcGuard = (prov, name)=>{
    if(user && user.role==="Trade Coordinator" && user.province && prov && prov!==user.province){
      setTcDenied({name: name||t("ข้อมูลนี้","this record")});
      pushAudit({user:user.email||"tc@geointel.io", action:t("พยายามเข้าถึงข้อมูลนอกพื้นที่", "Attempted to access data outside their territory"), category:"ปฏิเสธการเข้าถึง",
        detail:(name?name+" · ":"")+t("อยู่ในพื้นที่ ", "is in ")+provinceTH(prov)+t(" (นอกเขตรับผิดชอบ)", " (outside their territory)")});
      return true; }
    return false; };
  // enter the map workspace focused on an area / customer (from dashboard tables, search, etc.)
  const openArea = async (p)=>{ if(tcGuard(p, t("พื้นที่ ", "Area ")+provinceTH(p))) return; if(!await withLoading(()=>ensureData("Thailand"))) return;
    setView("workspace"); setActiveCountry("Thailand"); setMode("map"); setSelectedProvince(p); setFilters(f=>({...f,province:p})); setOverlay(isAdmin ? null : "area"); };
  const openCustomer = async (c)=>{ if(tcGuard(c&&c.province, c&&c.businessName)) return; if(!await withLoading(()=>ensureData("Thailand"))) return;
    setView("workspace"); setActiveCountry("Thailand"); setMode("map"); setSelectedCustomer(c); setOverlay("customer"); };

  // เมนูย่อยที่ผู้ใช้สั่งพับเอง — กดเมนูหลักซ้ำ = สลับกาง/พับ (ค่าเริ่มต้นคือกางเมื่ออยู่ในกลุ่มนั้น)
  const [subShut, setSubShut] = useState({});
  const toggleSub = id => setSubShut(m=>({...m, [id]: !m[id]}));
  const navItem = async (id)=>{ setMenu(null);
    setSubShut(m=> m[id] ? {...m, [id]:false} : m);   // ไปหน้าไหน ให้กางเมนูย่อยของหน้านั้นเสมอ
    if(id==="dashboard") return navItem("workspace");   // 'แดชบอร์ด' landing removed → Business Overview now lives in 'แดชบอร์ดผู้บริหาร (monitoring)'
    if(id==="workspace") return backToGlobe();
    // สองเส้นทางนี้ยังต้องรอข้อมูลจริง เพราะต้องใช้ข้อมูลมาเลือกว่าจะเปิดจังหวัด/ลูกค้ารายไหนเป็นค่าตั้งต้น
    // จึงยังบังหน้าจอไว้ แต่ผ่าน withLoading ที่ปิดหน้าจอโหลดให้เสมอแม้โหลดไม่สำเร็จ
    if(id==="area"){ const cd=await withLoading(()=>ensureData("Thailand"));
      if(!cd || !cd.areas || !cd.areas.length) return; return openArea(selectedProvince||cd.areas[0].province); }
    if(id==="customer"){ const cd=await withLoading(()=>ensureData("Thailand"));
      if(!cd || !cd.customers || !cd.customers.length) return; return openCustomer(selectedCustomer||cd.customers[0]); }
    // สองหน้านี้มีข้อความ "กำลังโหลดข้อมูลธุรกิจ…" ของตัวเองอยู่แล้ว จึงเปิดหน้าไปเลยแล้วค่อยโหลดเบื้องหลัง
    // ไม่ต้องบังทั้งจอ และถ้าโหลดไม่สำเร็จก็ไม่มีอะไรค้างให้ผู้ใช้ติดอยู่
    if(id==="reports"){ setOverlay(id); โหลดเบื้องหลัง(); return; }
    // รายงานแผนการเข้าพบ — เฉพาะ TC ที่มีจังหวัดรับผิดชอบ · บทบาทอื่นถูกเปลี่ยนเส้นทางออก
    if(id==="visit-plans"){
      if(user && user.role==="Trade Coordinator" && user.province){ setOverlay(id); โหลดเบื้องหลัง(); }
      else { toast(t("หน้านี้สำหรับผู้ประสานงานการค้าเท่านั้น", "This page is for Trade Coordinators only"),"bad"); return backToGlobe(); }
      return;
    }
    if(id==="monitoring"){ setOverlay(id); โหลดเบื้องหลัง(); return; }
    // "จัดการข้อมูล" + เมนูย่อย — ตารางข้อมูลต้องใช้ db.customers/db.prospects จึงโหลดเบื้องหลังไว้
    if(id==="data-management" || id==="data-import" || id==="data-files" || id==="data-leads"){
      setOverlay(id); โหลดเบื้องหลัง(); return; }
    setOverlay(id);   // profile / other admin — no customer data needed
  };
  const nav = (target, params={})=>{
    if(target==="area" && (params.province||params.area)) return openArea(params.province||params.area);
    if(target==="customer" && params.id){ const o=(db.customers||[]).find(x=>x.id===params.id)||(db.prospects||[]).find(x=>x.id===params.id); if(o) return openCustomer(o); }
    return navItem(target);
  };
  // Full reset on logout: the Globe/map state persists across a login→logout→login cycle (the app doesn't
  // remount), so clearing only user/view leaves the next session stuck on the previously-picked province and
  // globe camera. Reset every piece of workspace state; setFlyTarget(null) also triggers the globe's
  // resetView() so the camera zooms back out to the default wide view.
  const logout = ()=>{
    auth.clearAuth();                       // ทิ้งโทเคนด้วย ไม่งั้นรีเฟรชแล้วกลับเข้ามาเอง
    setUser(null); setView("dashboard"); setMode("globe"); setActiveCountry(null); setOverlay(null);
    setSelectedProvince(null); setSelectedCustomer(null); setFlyTarget(null); setMenu(null);
    setVisitPlans([{id:"plan-1", name:t("แผนที่ 1", "Plan 1"), customers:[], route:null, saved:false, visitDate:""}]); setActivePlanId("plan-1");
    setFilters(defaultFilters());
  };

  // No blocking full-screen loader — the globe skeleton renders on frame 1 and data streams in.

  // จุดเริ่มต้นวางแผน = สาขา Barter ในจังหวัดที่กำลังทำงานอยู่ (TC ใช้จังหวัดที่รับผิดชอบ · บทบาทอื่นใช้จังหวัดที่กำลังดู)
  const planProvince = (user && user.province) || selectedProvince || (filters.province && filters.province!=="All" ? filters.province : null);
  const planOffice = officeFor(planProvince);

  // เลเยอร์ "เส้นทางดำเนินการ" — เส้นเชื่อมเส้นทางของ "แผนอื่นๆ ที่บันทึกไว้ในระบบ" (แผนที่กำลังแก้ไข = active วาดโดย overlay หลักอยู่แล้ว)
  // คำนวณเส้นทาง (สาขา → ลูกค้าตามลำดับ) ต่อแผน แล้วส่งให้แผนที่วาด (เปิด/ปิดด้วย layers.route)
  const savedPlanRoutes = useMemo(()=> (visitPlans||[])
    .filter(p=> p.id!==activePlanId && (p.customers||[]).length)
    .map(p=>{ const flat = clusterCustomers(p.customers,50,planOffice).flatMap(cl=>optimizeOrder(planOffice,cl));
      return { id:p.id, name:p.name, saved:!!p.saved,
        pts:[[planOffice.latitude,planOffice.longitude], ...flat.map(s=>[s.latitude,s.longitude])],
        stops:flat.map(s=>({lat:s.latitude,lng:s.longitude,name:s.businessName})) }; })
  , [visitPlans, activePlanId, planOffice]);

  // ปิดหน้ารายงาน(overlay) กลับไปแผนที่วิเคราะห์เต็มจอ — ใช้จากปุ่มในแดชบอร์ด TC (ไม่สร้างแผนที่ซ้ำสองที่)
  const goMap = ()=>{ setView("workspace"); setMode("map"); setOverlay(null); };
  // เข้าโหมดแก้รูปโซน: ปิดหน้าจัดการขอบเขต → ไปแมพใหญ่ → แถบเครื่องมือขึ้นแทนแถบค้นหา
  // ⚠ เดิมสั่งแค่ "ไปแมพ" โดยไม่สนว่าข้อมูลประเทศโหลดแล้วหรือยัง และไม่ตั้ง activeCountry
  //    เข้าจากหน้าที่โหลดข้อมูลไว้แล้ว = ได้แมพมีเส้นขอบ/ตัวกรองใช้ได้ · เข้าจากหน้าที่ยังไม่โหลด = ได้แมพเปล่า
  //    จึงบังคับให้ได้สภาพเดียวกันทุกครั้ง: มีข้อมูล → ตั้งประเทศ → ค่อยเข้าโหมด
  const startZoneEdit = ()=>{
    // ต้องมี provincesGeo (รูปจังหวัด) ไม่ใช่แค่ areas (รายชื่อพื้นที่) ไม่งั้นแมพไม่มีเส้นขอบ เลือกจังหวัดแล้วไม่ขยับ
    // โหลดแบบเบื้องหลัง ไม่บังหน้าจอ — เข้าโหมดได้ทันที แล้ว effect ในแมพวาดเพิ่มเองเมื่อข้อมูลมาถึง
    if(!(db.areas && db.areas.length && db.provincesGeo)) โหลดเบื้องหลัง();
    setZoneEditFrom(overlay); setActiveCountry("Thailand");
    setOverlay(null); setView("workspace"); setMode("map"); setZoneEdit(true);
  };
  // ⚠ ไม่ใช่แค่ปิดโหมด — ถ้าปล่อยไว้เฉย ๆ แอดมินจะค้างอยู่บนแมพใหญ่ที่ไม่มีเครื่องมืออะไรเลย
  const exitZoneEdit = ()=>{ setZoneEdit(false); if(zoneEditFrom) setOverlay(zoneEditFrom); setZoneEditFrom(null); };
  const ctx = {db,user,logout,nav,filters,setFilters,startZoneEdit,routeParams:{area:selectedProvince},profileTab,visitPlans,office:planOffice,lang,setLang,

    deletePlan,setActivePlanId,approveDeal,rejectDeal,addToPlan,goMap,updateRecord,adminDeleteRecord,
    selectedProvince,setSelectedProvince,selectedCustomer,setSelectedCustomer,selectedCountry:activeCountry};

  if(!user) return html`<${AppCtx.Provider} value=${ctx}><${Login} db=${db} onLogin=${handleLogin}/><${ToastHost}/></${AppCtx.Provider}>`;

  // sidebar highlight
  const activeNav = (overlay && MODALS[overlay]) ? overlay : view==="dashboard" ? "dashboard" : "workspace";
  const onGlobe = view==="workspace" && mode==="globe" && !overlay;
  const titles = TITLES();
  const stateLabel = overlay==="area" ? `${t("จังหวัด","Province")} · ${provinceTH(selectedProvince||"")}`
    : overlay==="customer" ? `${t("ลูกค้า","Customer")} · ${selectedCustomer?selectedCustomer.businessName:""}`
    : overlay==="reports" ? (filters.province && filters.province!=="All" ? `${provinceTH(filters.province)} · ${titles.reports}` : titles.reports)
    : (overlay && MODALS[overlay]) ? (titles[overlay]||"")
    : view==="dashboard" ? t("แดชบอร์ด","Dashboard")
    : mode==="globe" ? t("ลูกโลก 3 มิติ","3D Globe")
    : `${t("ประเทศ","Country")} · ${countryTH(activeCountry||"Thailand")}`;
  // จังหวัดที่กำลังดูอยู่ (ใช้ทำ breadcrumb: หน้าหลัก › ประเทศไทย › จังหวัด)
  const crumbProvince = (selectedProvince && selectedProvince!=="All") ? provinceTH(selectedProvince)
    : (filters.province && filters.province!=="All") ? provinceTH(filters.province) : null;
  const modalId = overlay && MODALS[overlay] && (!ADMIN.has(overlay) || user.role==="Administrator")
    && !(overlay==="visit-plans" && user.role!=="Trade Coordinator") ? overlay : null;
  const ModalComp = modalId ? MODALS[modalId] : null;
  const results = gsearch.length>1 ? searchAll(db,gsearch) : {areas:[],people:[]};

  // บทบาทภาคสนาม (ผู้บริหาร/TC) ใช้แผนที่เป็นหลัก — ไม่มีแถบเมนูซ้าย · ผู้ดูแลระบบเห็นแถบเมนูเต็ม
  const isBiz = user.role !== "Administrator";
  const isAdmin = user.role === "Administrator";
  const isTC = user.role === "Trade Coordinator";   // TC ถูกล็อกไว้ที่จังหวัดที่รับผิดชอบเท่านั้น (ไม่มีลูกโลก/ไม่สลับจังหวัด)
  const roleDemo = user.role==="Administrator" ? "admin" : isTC ? "tc" : "management";   // บทบาทปัจจุบันในรูป demo param
  const isDemoMode = /[?&]demo=/.test(location.search) || serverDemo;   // โชว์ตัวสลับบทบาทเฉพาะเครื่องเดโม
  const roleShort = {admin:"Admin", management:t("ผู้บริหาร", "Management"), tc:"TC"}[roleDemo];
  const switchRole = (d, zone) => { const u=new URL(location.href); u.searchParams.set("demo",d);
    u.searchParams.delete("prov"); u.searchParams.delete("noprov"); u.searchParams.delete("go");
    u.searchParams.delete("tc"); u.searchParams.delete("zone");
    // TC รายโซน: ล็อกโซนตรง ๆ จาก URL ไม่ต้องรอให้แอดมินมอบหมายก่อน (ไว้ดูเดโมให้ลูกค้า)
    if(d==="tc" && zone){
      u.searchParams.set("prov", BKK); u.searchParams.set("zone", zone);
      location.href=u.pathname+u.search; return;
    }
    // สลับไป TC: เลือกจังหวัด + บัญชีจากการมอบหมายจริงที่แอดมินบันทึกไว้
    // ไม่งั้นจะตกไปใช้ค่าเริ่มต้น "Chiang Mai" ทุกครั้ง แล้วดูไม่เห็นผลของโซนที่เพิ่งมอบหมาย
    if(d==="tc" && territory){
      const keys = Object.keys(territory).filter(k=>territory[k]);
      const pick = keys.find(k=>k.includes("/")) || keys[0];   // มีโซน = เคสที่น่าดูที่สุด เลือกอันนั้นก่อน
      if(pick){
        u.searchParams.set("prov", pick.split("/")[0]);
        const owner = SEED_USERS.find(x=>x.id===territory[pick]);
        if(owner) u.searchParams.set("tc", owner.email);       // เข้าเป็นเจ้าของพื้นที่นั้นจริง ๆ
      }
    }
    location.href=u.pathname+u.search; };

  return html`<${AppCtx.Provider} value=${ctx}>
  <div class=${"shell"+(isBiz?" no-nav":collapsed?" collapsed":"")}>
    ${!isBiz && html`<aside class="sidebar">
      <div class="sb-brand"><div class="mk">${brandMark()}</div><div class="nm">GeoIntel<small>GEO INTELLIGENCE</small></div></div>
      <div class="sb-scroll">
        ${NAV().filter(g=>!g.admin||user.role==="Administrator").map(g=>html`<div key=${g.group}>
          <div class="sb-group">${g.group}</div>
          ${g.items.filter(it=>!it.admin||user.role==="Administrator").map(it=>{
            // เมนูย่อยจะกางเมื่ออยู่ที่เมนูหลักนั้นหรือหน้าใดหน้าหนึ่งในเมนูย่อยของมัน
            const subs = it.sub||[];
            const inGroup = activeNav===it.id || subs.some(sb=>sb.id===activeNav);
            const openSub = subs.length>0 && inGroup && !subShut[it.id];
            // กดเมนูหลักขณะที่อยู่หน้านั้นอยู่แล้ว = พับ/กางเมนูย่อย · กดจากที่อื่น = ไปหน้านั้นแล้วกาง
            const onMain = ()=> (subs.length && activeNav===it.id) ? toggleSub(it.id) : navItem(it.id);
            return html`<div key=${it.id}>
              <div class=${"nav-item"+(activeNav===it.id?" on":"")+(openSub?" has-sub":"")} onClick=${onMain}>
                <span class="ic"><${Icon} name=${it.icon} size=${18}/></span><span class="lb">${it.label}</span></div>
              ${openSub && subs.length ? html`<div class="nav-sub">
                ${subs.map(sb=>html`<div key=${sb.id} class=${"nav-subitem"+(activeNav===sb.id?" on":"")}
                  onClick=${()=>navItem(sb.id)}><span class="lb">${sb.label}</span></div>`)}
              </div>` : ""}
            </div>`;
          })}
        </div>`)}
      </div>
      <div class="sb-foot"><div class="row" style=${{gap:"7px"}}>
        <span style=${{width:"7px",height:"7px",borderRadius:"50%",background:"var(--good)",boxShadow:"0 0 7px var(--good)"}}></span>
        ${t("เครื่องมือ: การทำเหมืองเชิงสถิติ", "Engine: statistical mining")}</div>
        <div style=${{marginTop:"4px"}}>${t("เวอร์ชัน 1.0 ·", "Version 1.0 ·")} ${num(db.countries.reduce((a,c)=>a+c.customerCount+c.prospectCount,0))} ${t("รายการ", "records")}</div></div>
    </aside>`}

    <div class="main">
      <header class="topbar">
        ${isBiz
          ? html`<button class="tb-brand" title=${isTC?t("เขตที่รับผิดชอบ", "My territory"):t("กลับสู่ลูกโลก", "Back to the globe")} onClick=${isTC?null:()=>navItem("workspace")} style=${isTC?{cursor:"default"}:null}>
              <div class="mk">${brandMark()}</div><div class="nm">GeoIntel<small>GEO INTELLIGENCE</small></div></button>`
          : html`<button class="hamb" onClick=${()=>setCollapsed(c=>!c)}><${Icon} name="grid" size=${17}/></button>`}
        ${onGlobe ? html`<div style=${{marginRight:"auto"}}></div>`
        : (view==="workspace" && mode==="map")
          ? (isTC
              /* TC ถูกล็อกที่จังหวัดเดียว — breadcrumb เป็นข้อความคงที่ ไม่มีลิงก์กลับประเทศ/ลูกโลก */
              ? html`<div class="crumbs"><span class="crumb-cur">${t("เขตที่รับผิดชอบ ·", "Territory ·")} <b>${provinceTH(user.province||"")}${
                  lockZones && lockZones.length===1 ? " · "+zoneLabel(lockZones[0]) : ""}</b></span></div>`
              : html`<div class="crumbs crumbs-nav">
              <button class="crumb-link" onClick=${backToGlobe}>${t("หน้าหลัก", "Home")}</button>
              <span class="crumb-sep">›</span>
              <button class="crumb-link" onClick=${backToGlobe}>${t("ประเทศไทย", "Thailand")}</button>
              ${crumbProvince && html`<span class="crumb-sep">›</span><span class="crumb-cur">${crumbProvince}</span>`}
            </div>`)
          : html`<div class="crumbs">${t("พื้นที่ทำงาน ·", "Workspace ·")} <b>${stateLabel}</b></div>`}
        <div class="tb-right">
          <!-- สลับภาษา ไทย/อังกฤษ — แสดงทุกบทบาท · ค่าถูกจำไว้ใน localStorage -->
          <${LangToggle}/>
          ${isBiz && view==="workspace" && mode==="map" && html`<button title=${t("เปิดหน้ารายงาน","Open reports")} onClick=${()=>navItem("reports")}
            style=${{display:"inline-flex",alignItems:"center",gap:"7px",height:"38px",padding:"0 14px",marginRight:"8px",
              borderRadius:"10px",border:"1px solid var(--stroke2)",background:"var(--panel)",color:"var(--txt)",
              fontFamily:"var(--font)",fontSize:"12.5px",fontWeight:600,cursor:"pointer",backdropFilter:"blur(8px)"}}>
            <${Icon} name="reports" size=${15} color="var(--accent)"/> ${t("รายงาน", "Reports")}</button>`}
          <div style=${{position:"relative"}}>
            <button class="icon-btn" onClick=${()=>setMenu(menu==="notif"?null:"notif")}><${Icon} name="bell" size=${18}/>
              ${notifs.length ? html`<span class="dot"></span>` : ""}</button>
            ${menu==="notif" && (()=>{ const shown = notifs;
              return html`<div class="dropdown" style=${{width:"300px"}}>
              <div class="row between" style=${{padding:"6px 10px 10px"}}><b style=${{fontSize:"13px"}}>${t("การแจ้งเตือน", "Notifications")}</b>
                ${shown.length? html`<${Badge} tone="bad">${shown.length}</${Badge}>`:""}</div>
              ${shown.length ? shown.map((n,i)=>html`<div key=${n.key} class="dd-item" style=${{alignItems:"flex-start",cursor:"default"}}>
                <${Icon} name=${n.icon} size=${15} color="var(--accent2)"/>
                <div style=${{flex:1}}><div style=${{fontSize:"12.5px",color:"var(--txt)"}}>${n.t}</div>
                  <div class="dim" style=${{fontSize:"12px",marginTop:"2px"}}>${n.time}${t("ที่แล้ว", " ago")}</div></div></div>`)
                : html`<div class="dim" style=${{padding:"14px 10px",fontSize:"12.5px",textAlign:"center"}}>${t("ไม่มีการแจ้งเตือน", "No notifications")}</div>`}
            </div>`; })()}
          </div>
          <div style=${{position:"relative"}}>
            <button class="userbtn" onClick=${()=>setMenu(menu==="user"?null:"user")} title=${user.name}
              aria-label=${t("เมนูผู้ใช้", "User menu")} aria-haspopup="true" aria-expanded=${menu==="user"}
              style=${{padding:"2px",gap:0,borderRadius:"50%"}}>
              <span class="avatar">${user.initials}</span>
            </button>
            ${menu==="user" && html`<div class="dropdown userdd" role="menu" aria-label=${t("เมนูผู้ใช้", "User menu")}
                style=${{width:"284px",maxHeight:"calc(100vh - 84px)",display:"flex",flexDirection:"column",padding:0,overflow:"hidden"}}>
              <!-- ส่วนหัวบัญชี (ตรึงบนสุด): avatar + ชื่อผู้ใช้ + บทบาท + อีเมล + badge (TC เพิ่มบรรทัดจังหวัด) -->
              <div class="dd-account" style=${{margin:0,borderRadius:0,flex:"none"}}>
                <span class="avatar" style=${{width:"42px",height:"42px",fontSize:"15px",flex:"none"}}>${user.initials}</span>
                <div style=${{flex:1,minWidth:0}}>
                  <div style=${{fontSize:"13.5px",fontWeight:700,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>${user.name}</div>
                  <div class="dim" style=${{fontSize:"12px",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>${roleTH(user.role)}</div>
                  <div class="dim" style=${{fontSize:"12.5px",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>${user.email}</div>
                </div>
              </div>

              <!-- รายการเมนู (เลื่อนได้) — 5 รายการ ไม่มีหัวข้อย่อย -->
              <div style=${{flex:1,minHeight:0,overflowY:"auto",padding:"6px"}}>
                <div class="dd-item" role="menuitem" tabindex="0" onClick=${()=>openProfile("info")}><${Icon} name="profile" size=${16}/>${t("ดูโปรไฟล์", "View profile")}</div>
                <div class="dd-item" role="menuitem" tabindex="0" onClick=${()=>openProfile("password")}><${Icon} name="config" size=${16}/>${t("ตั้งค่า", "Settings")}</div>
                ${isDemoMode && html`<div>
                  <div class="dd-item" role="menuitem" tabindex="0" aria-haspopup="true" aria-expanded=${roleSub} onClick=${()=>setRoleSub(s=>!s)}>
                    <${Icon} name="user" size=${16}/>${t("สลับบทบาท (เดโม)", "Switch role (demo)")}
                    <span style=${{marginLeft:"auto",display:"inline-flex",alignItems:"center",gap:"7px"}}>
                      <span style=${{fontSize:"11px",fontWeight:700,color:"var(--accent2)"}}>${roleShort}</span>
                      <${Icon} name="chevron" size=${13} style=${{transform:roleSub?"rotate(180deg)":"none",transition:".2s"}}/></span></div>
                  ${roleSub && html`<div style=${{paddingLeft:"12px"}}>
                    ${[["admin",t("ผู้ดูแลระบบ", "System Administrator")],["management",t("ผู้บริหาร", "Management")],["tc",t("ผู้ประสานงานการค้า (TC)", "Trade Coordinator (TC)")]].map(([d,l])=>html`
                      <div key=${d} class="dd-item" role="menuitem" tabindex="0" onClick=${()=>switchRole(d)}>
                        <${Icon} name="user" size=${15}/>${l}
                        ${roleDemo===d && !demoZone ?html`<span style=${{marginLeft:"auto",color:"var(--accent2)",fontSize:"12px",fontWeight:700}}>${t("ปัจจุบัน", "Current")}</span>`:""}</div>`)}
                    <!-- TC รายโซน: ดูแมพแบบที่ TC ของโซนนั้นเห็นจริง ๆ โดยไม่ต้องไปมอบหมายในหน้าแอดมินก่อน -->
                    <div style=${{fontSize:"11px",color:"var(--dim)",padding:"7px 12px 3px",letterSpacing:".02em"}}>
                      ${t("TC รายโซน (กรุงเทพฯ)", "TC by zone (Bangkok)")}</div>
                    ${zonesOf(BKK).map(z=>html`
                      <div key=${"z"+z.zone_id} class="dd-item" role="menuitem" tabindex="0" onClick=${()=>switchRole("tc", z.zone_id)}>
                        <span style=${{width:"9px",height:"9px",borderRadius:"999px",background:z.color,flex:"none"}}></span>
                        ${t("TC · ", "TC · ")}${zoneLabel(z.zone_id)}
                        ${demoZone===z.zone_id?html`<span style=${{marginLeft:"auto",color:"var(--accent2)",fontSize:"12px",fontWeight:700}}>${t("ปัจจุบัน", "Current")}</span>`:""}</div>`)}
                  </div>`}
                </div>`}
                <div class="dd-item" role="menuitem" tabindex="0" onClick=${()=>{setMenu(null);toast(t("ศูนย์ช่วยเหลือ GeoIntel · เวอร์ชัน 1.0", "GeoIntel Help Centre · version 1.0"),"info");}}><${Icon} name="reports" size=${16}/>${t("ช่วยเหลือ", "Help")}</div>
              </div>

              <!-- ออกจากระบบ (ตรึงล่างสุด · สี destructive · ไม่ใช่ default focus) -->
              <div style=${{flex:"none",borderTop:"1px solid var(--stroke)",padding:"6px"}}>
                <div class="dd-item" role="menuitem" tabindex="0" onClick=${logout} style=${{color:"var(--bad,#b91c1c)",fontWeight:600}}><${Icon} name="logout" size=${16}/>${t("ออกจากระบบ", "Sign out")}</div>
              </div>
            </div>`}
          </div>
        </div>
      </header>

      <!-- Business Overview (แดชบอร์ด)  OR  Geo Intelligence Workspace (แผนที่วิเคราะห์) -->
      <div class="workspace" style=${{position:"relative",flex:1,minHeight:0,display:"flex"}}>
        ${(view==="dashboard" && user.role==="Administrator")
          ? html`<${Dashboard}/>`
          : html`<${GeoStage} db=${db} mode=${mode} activeCountry=${activeCountry} flyTarget=${flyTarget} globeUnder=${globeUnder}
              lockProvince=${isTC ? user.province : null} lockZones=${lockZones}
              zoneMode=${isTC && lockZones ? "lock" : user.role==="Management" ? "outline" : null}
              canEditZones=${isAdmin} noMask=${isAdmin} zoneEdit=${zoneEdit && isAdmin} onExitZoneEdit=${exitZoneEdit}
              onArriveCountry=${arriveCountry} onSelectCountry=${selectCountry} onSelectProvince=${selectProvinceFromGlobe} onBackToGlobe=${backToGlobe}
              filters=${filters} setFilters=${setFilters} layers=${layers} setLayers=${setLayers}
              onPickProvince=${pickProvince} onPickCustomer=${pickCustomer}
              onOpenReports=${isBiz ? (()=>navItem("reports")) : undefined}
              focusProvince=${overlay==="area"?selectedProvince:null}
              highlightCustomer=${overlay==="customer"?selectedCustomer:null} tourPanel=${tourPanel} tourFocus=${tourFocus}
              visitPlan=${visitPlan} visitRoute=${visitRoute} office=${planOffice} planRoutes=${savedPlanRoutes}
              gsearch=${gsearch} setGsearch=${setGsearch} searchResults=${results}
              onPickProvinceZoom=${pickProvinceZoom} onPickCustomerNav=${p=>nav("customer",{id:p.id})}/>`}

        ${view==="workspace" && overlay==="area" && selectedProvince && !isTC && !isAdmin && html`<${AreaPanel} key=${selectedProvince} db=${db} filters=${filters}
          province=${selectedProvince} onClose=${()=>setOverlay(null)}
          onReport=${user.role==="Administrator" ? (p=>{setSelectedProvince(p);setOverlay("reports");}) : undefined}
          onOpenCustomer=${p=>{setSelectedCustomer(p);setOverlay("customer");}}/>`}

        ${view==="workspace" && overlay==="customer" && selectedCustomer && html`<${CustomerPanel} key=${selectedCustomer.id} db=${db}
          customer=${selectedCustomer} onClose=${()=>setOverlay(null)} topOffset=${isBiz?64:16}
          onOpenArea=${p=>openArea(p)}
          setCustomer=${setSelectedCustomer}
          canEditOwn=${isBiz && selectedCustomer.source===USER_SOURCE}
          onSetVisit=${setVisitStatus} onAddRound=${addVisitRound}
          onEditRecord=${r=>setAddForm({edit:r})} onDeleteRecord=${deleteRecord}
          onAddToPlan=${addToPlan} inPlan=${visitPlan.some(x=>x.id===selectedCustomer.id)}
          user=${user} onSubmitDeal=${submitDeal} onCancelVisit=${cancelVisit}
          dealPlan=${(()=>{ const sp=visitPlans.find(p=>p.saved && (p.customers||[]).some(x=>x.id===selectedCustomer.id)); return sp?{visitDate:sp.visitDate, visitor:(user&&user.name)||"—", planName:sp.name}:null; })()}/>`}

        ${isTC && view==="workspace" && mode==="map" && !onGlobe && html`<${VisitPlanner} db=${db} office=${planOffice}
          plan=${visitPlan} setPlan=${setVisitPlan} route=${visitRoute} setRoute=${setVisitRoute} savePlan=${savePlan}
          plans=${visitPlans} activePlanId=${activePlanId} setActivePlanId=${setActivePlanId}
          createPlan=${createPlan} deletePlan=${deletePlan} renamePlan=${renamePlan} onPickCustomers=${focusPickCustomers}
          visitDate=${activePlan?activePlan.visitDate:""} setVisitDate=${setVisitDate}/>`}

        <!-- ไม่ส่ง allowImport → แถบอัปโหลด Excel/CSV ปิดอยู่ในหน้าทำงานของ TC และผู้บริหาร
             การนำเข้าไฟล์ทำที่ แอดมิน › จัดการข้อมูล › นำเข้าข้อมูล ที่เดียว -->
        ${addForm && html`<${AddRecordsForm} editRecord=${addForm.edit} db=${db} prospectOnly=${isTC || user.role==="Management"}
          onClose=${()=>setAddForm(null)} onSave=${addForm.edit ? updateRecord : addRecords}/>`}

        ${ModalComp && html`<div style=${{position:"absolute",inset:0,zIndex:700,background:"var(--surface)",animation:"fade .25s"}}>
          <div class="slide-panel" style=${{position:"absolute",inset:0,overflow:"hidden",background:"var(--surface)"}}>
            <button class="icon-btn" style=${{position:"absolute",top:"16px",right:"16px",zIndex:5,width:"34px",height:"34px",background:"var(--surface)"}}
              onClick=${()=>setOverlay(null)}><${Icon} name="close" size=${16}/></button>
            <!-- ใส่ mdl-page ไว้ให้ CSS รู้ว่าหน้านี้มีปุ่มกากบาทลอยอยู่มุมขวาบน จะได้เว้นที่ด้านขวาของหัวข้อให้ -->
            <div class="mdl-page" style=${{height:"100%",overflow:"auto"}}><${ModalComp} key=${modalId}/></div>
          </div>
        </div>`}

        ${isTC && !user.province && html`<div style=${{position:"absolute",inset:0,zIndex:1400,background:"var(--bg)",display:"grid",placeItems:"center",padding:"24px"}}>
          <div style=${{textAlign:"center",maxWidth:"440px"}}>
            <div style=${{width:"72px",height:"72px",borderRadius:"50%",background:"rgba(255,176,46,.14)",display:"grid",placeItems:"center",margin:"0 auto 16px"}}><${Icon} name="pin" size=${32} color="var(--warn)"/></div>
            <h2 style=${{margin:"0 0 8px"}}>${t("บัญชีของคุณยังไม่ได้กำหนดพื้นที่ที่ดูแล", "Your account has no territory assigned yet")}</h2>
            <p class="muted" style=${{fontSize:"14px",lineHeight:1.6}}>${t("กรุณาติดต่อผู้ดูแลระบบเพื่อกำหนดพื้นที่รับผิดชอบก่อนเริ่มใช้งาน", "Please ask an administrator to assign your territory before you start.")}</p>
            <div style=${{marginTop:"18px"}}><button class="btn outline" onClick=${logout}>${t("ออกจากระบบ", "Sign out")}</button></div>
          </div></div>`}

        ${tcDenied && html`<div style=${{position:"absolute",inset:0,zIndex:1400,background:"var(--bg)",display:"grid",placeItems:"center",padding:"24px"}}>
          <div style=${{textAlign:"center",maxWidth:"460px"}}>
            <div style=${{width:"72px",height:"72px",borderRadius:"50%",background:"rgba(255,90,90,.12)",display:"grid",placeItems:"center",margin:"0 auto 16px"}}><${Icon} name="gap" size=${32} color="var(--bad)"/></div>
            <h2 style=${{margin:"0 0 8px"}}>${t("ไม่สามารถเข้าถึงข้อมูลที่ขอได้", "You cannot access the requested data")}</h2>
            <p class="muted" style=${{fontSize:"14px",lineHeight:1.6}}>${t("ข้อมูลที่คุณเปิดอยู่นอกพื้นที่ที่คุณดูแล หากคิดว่าเป็นความผิดพลาด กรุณาติดต่อผู้ดูแลระบบ", "The record you opened is outside your territory. If you think this is a mistake, contact an administrator.")}</p>
            <div style=${{marginTop:"18px"}}><button class="btn outline" onClick=${()=>{ setTcDenied(null); setOverlay(null); setSelectedProvince(user.province); setFilters(f=>({...f,province:user.province})); }}>
              ${t("← กลับไปหน้าจังหวัด", "← Back to the province ")}${provinceTH(user.province||"")}</button></div>
          </div></div>`}

        ${loadingData && html`<div style=${{position:"absolute",inset:0,zIndex:900,background:"rgba(4,7,14,.5)",backdropFilter:"blur(2px)",display:"grid",placeItems:"center"}}>
          <div class="card" style=${{display:"flex",alignItems:"center",gap:"14px",padding:"16px 22px"}}>
            <div style=${{width:"22px",height:"22px",borderRadius:"50%",border:"3px solid rgba(120,160,220,.25)",borderTopColor:"var(--accent2)",animation:"spin 1s linear infinite"}}></div>
            <div><div style=${{fontSize:"13px",fontWeight:700}}>${t("กำลังโหลดข้อมูล…", "Loading data…")}</div>
              <div class="dim" style=${{fontSize:"13px"}}>${t("ลูกค้า · จังหวัด · แผนที่ความร้อน", "Customers · provinces · heatmap")}</div></div>
          </div>
          <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
        </div>`}
      </div>
    </div>
  </div>
  ${introPlaying && mode==="globe" && html`<button class="intro-skip" onClick=${skipIntro}>${t("ข้าม", "Skip")}<${Icon} name="chevronR" size=${14}/></button>`}
  ${showWelcome && html`<${WelcomeDialog} onStart=${startTour} onSkip=${skipWelcome}/>`}
  <${ProductTour} open=${tourOpen} steps=${TOUR_STEPS} onFinish=${endTour} onSkip=${endTour}/>
  <${HelpTips} user=${user} disabled=${showWelcome||tourOpen}/>
  <${ToastHost}/>
  </${AppCtx.Provider}>`;
}

// Unified topbar search — two categories: provinces (by name) and people (customers + prospects,
// matched on business name / id / address). Returns grouped results for a headed dropdown.
function searchAll(db,q){
  const s=q.toLowerCase();
  const areas = (db.areas||[]).filter(a=>a.province.toLowerCase().includes(s)||provinceTH(a.province).includes(q))
    .slice(0,5).map(a=>({province:a.province, title:provinceTH(a.province),
      sub:`${num(a.customerCount)} ${t("ลูกค้า · Lead", "Customers · Leads")} ${a.gapScore}`}));
  const people = [...(db.customers||[]), ...(db.prospects||[])]
    .filter(c=>c.businessName.toLowerCase().includes(s) || c.id.toLowerCase().includes(s) || (c.address||"").toLowerCase().includes(s))
    .slice(0,8).map(c=>({id:c.id, title:c.businessName,
      sub:`${c.status==="Existing"?t("ลูกค้าปัจจุบัน", "Existing customers"):"Lead"} · ${provinceTH(c.province)}${c.address?" · "+c.address:""}`}));
  return {areas, people};
}

createRoot(document.getElementById("root")).render(html`<${App}/>`);
