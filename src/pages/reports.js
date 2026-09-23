import {html, useState, useMemo, useRef, useEffect, useApp, Icon, SegmentBadge, num, pct, SEG_COLOR, STATUS_COLOR, SEGMENTS, segTH, gapTH, countryTH, provinceTH, districtTH, thDate, thMonth, TH_MONTHS, useLang} from "../lib.js";
import {basemap} from "../basemap.js";
import {createPortal} from "react-dom";   // portal the Export dialog to <body> so the full-screen .slide-panel (overflow:hidden) can't clip it
import {Card, Kpi, Btn, Badge, Table, Toggle, Meter, DateField, TCReportNav} from "../ui.js";
import {Donut, BarChart, Gauge, LineChart, ChartTip, useTip} from "../charts.js";
import {segZero, segOnly, segAllTrue, OTHER_COLOR} from "../mock/geoData.js";
import {globalKpis, rankAreas, rankDistricts, analyzeArea, buildClusters, topGapLeads, custPass, prosPass, defaultFilters, downloadCSV} from "../data.js";
import {demandGap, gapBySegment, gapLevelOf, GAP_REF} from "../mock/geoData.js";
import {LeafletMap} from "../lmap.js";   // ใช้แผนที่ Leaflet ตัวเดียวกับหน้าหลักซ้ำ (ไม่สร้าง instance ใหม่)
import {toast} from "../ui.js";
import {Dropdown} from "../select.js";   // dropdown กำหนดสไตล์เอง (โชว์ 6 ตัวเลือก+เลื่อน · hover แดงอ่อน · ที่เลือกพื้นขาวตัวอักษรแดงเข้ม)
import {Monitoring} from "./admin.js";   // แดชบอร์ดผู้บริหาร (แดชบอร์ดภาพรวมธุรกิจ) — ใช้เป็นแดชบอร์ดของผู้บริหารในหน้ารายงาน
import {canExport} from "../export-perms.js";   // สิทธิ์ส่งออกตามบทบาท (กรองประเภทไฟล์ + ด่านตรวจก่อนส่งออก)
import {pushAudit} from "../audit.js";           // บันทึกการส่งออกลงประวัติการเข้าถึงระบบ (สำเร็จ/ล้มเหลว)
import {t} from "../i18n.js";   // สลับภาษา TH/EN — ดู src/i18n.js

// name เป็น getter — ค่าคงที่ระดับโมดูลถูกประเมินครั้งเดียวตอนโหลด ห่อ t() ตรง ๆ จะค้างเป็นภาษาแรก
const TYPES = [
  {id:"summary",     get name(){ return t("สรุปแดชบอร์ด","Dashboard summary"); },              icon:"dashboard"},
  // ยุบ "รายงานเชิงภูมิศาสตร์" + "รายงานความครอบคลุม" เป็นเมนูเดียว แล้วสลับดูด้วยแท็บภายในหน้า
  {id:"areasummary", get name(){ return t("รายงานสรุปข้อมูลรายพื้นที่","Area summary report"); }, icon:"globe"},
  {id:"gap",         get name(){ return t("รายงานวิเคราะห์ช่องว่าง","Gap analysis report"); },   icon:"gap"},
  {id:"opportunity", get name(){ return t("รายงาน Lead","Lead report"); },                      icon:"bolt"},
  {id:"route",       get name(){ return t("รายงานการวางแผนเส้นทาง","Route planning report"); },  icon:"route"},
];

// เป้าหมายอัตราความครอบคลุม (ปรับได้จุดเดียว) — ใช้ทั้ง KPI และแถบเปรียบเทียบจังหวัด
const REPORT_COV_TARGET = 80;
// 3 มุมมองของแผนที่สรุป (สลับภายในแผนที่เดียว — ไม่ใช่แท็บของทั้งหน้า)
const MAP_VIEWS = [
  {id:"kde",       get lb(){ return t("ความหนาแน่น (KDE)","Density (KDE)"); }},
  {id:"cluster",   get lb(){ return t("กลุ่มลูกค้า (Cluster)","Customer clusters"); }},
  {id:"territory", get lb(){ return t("เขตรับผิดชอบ TC","TC territories"); }},
];
// สีประจำ TC (ใช้ในโหมดเขตรับผิดชอบ) — ไล่ตามรายชื่อที่เรียงแล้ว
const TC_PALETTE = ["#e60023","#2563eb","#33d69f","#ff8f3c","#8a5cf6","#14b8a6"];

// ── เรขาคณิตสำหรับ Territory (คำนวณฝั่ง client จาก tc_owner จริง) ──
// convex hull ของกลุ่มพิกัด [[lat,lng],...] → คืน [[lat,lng],...] เรียงทวนเข็ม (ทำงานในสเปซ x=lng,y=lat)
function hullLL(pts){
  if(pts.length<3) return pts.map(p=>[p[0],p[1]]);
  const P=pts.map(p=>[p[1],p[0]]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cr=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const lo=[],up=[];
  for(const q of P){ while(lo.length>=2&&cr(lo[lo.length-2],lo[lo.length-1],q)<=0)lo.pop(); lo.push(q); }
  for(let i=P.length-1;i>=0;i--){ const q=P[i]; while(up.length>=2&&cr(up[up.length-2],up[up.length-1],q)<=0)up.pop(); up.push(q); }
  lo.pop(); up.pop(); return lo.concat(up).map(p=>[p[1],p[0]]);
}
// จุดตัดของรูปหลายเหลี่ยมนูนสองรูป (Sutherland–Hodgman) — คืน [[lat,lng],...] หรือ [] ถ้าไม่ทับกัน
function convexClipLL(subject, clip){
  let out=subject.map(p=>[p[1],p[0]]);          // x=lng,y=lat
  const C=clip.map(p=>[p[1],p[0]]);
  const inside=(p,a,b)=> ((b[0]-a[0])*(p[1]-a[1]) - (b[1]-a[1])*(p[0]-a[0])) >= -1e-12;   // ซ้ายของ a→b (ทวนเข็ม = ด้านใน)
  const cut=(a,b,e1,e2)=>{ const dx=b[0]-a[0],dy=b[1]-a[1],ex=e2[0]-e1[0],ey=e2[1]-e1[1];
    const den=dx*ey-dy*ex; if(Math.abs(den)<1e-12) return b.slice();
    const t=((e1[0]-a[0])*ey-(e1[1]-a[1])*ex)/den; return [a[0]+t*dx, a[1]+t*dy]; };
  for(let i=0;i<C.length;i++){ const e1=C[i], e2=C[(i+1)%C.length], input=out; out=[];
    for(let j=0;j<input.length;j++){ const cur=input[j], prev=input[(j-1+input.length)%input.length];
      const ci=inside(cur,e1,e2), pi=inside(prev,e1,e2);
      if(ci){ if(!pi) out.push(cut(prev,cur,e1,e2)); out.push(cur); }
      else if(pi) out.push(cut(prev,cur,e1,e2)); }
    if(!out.length) return []; }
  return out.map(p=>[p[1],p[0]]);
}
// สร้างข้อมูล Territory: hull ต่อ TC + พื้นที่ทับซ้อนรายคู่ (จากพิกัดจริงของ record ที่มี tc_owner นั้น)
function buildTerritories(recs){
  const byTC={};
  recs.forEach(r=>{ if(r.tc_owner && typeof r.latitude==="number") (byTC[r.tc_owner]=byTC[r.tc_owner]||[]).push([r.latitude,r.longitude]); });
  const names=Object.keys(byTC).sort();
  const hulls=names.map((tc,i)=>({tc, color:TC_PALETTE[i%TC_PALETTE.length], n:byTC[tc].length, latlngs:hullLL(byTC[tc])}))
    .filter(h=>h.latlngs.length>=3);
  const overlaps=[];
  for(let a=0;a<hulls.length;a++)for(let b=a+1;b<hulls.length;b++){
    const inter=convexClipLL(hulls[a].latlngs, hulls[b].latlngs);
    if(inter.length>=3) overlaps.push({tcs:[hulls[a].tc,hulls[b].tc], latlngs:inter});
  }
  return {hulls, overlaps};
}

// ───────────────────────── หน้ารายงาน = แดชบอร์ดสรุปภาพรวมเชิงพื้นที่ (หน้าเดียวจบ ไม่มีแท็บ) ─────────────────────────
// รวมทุกอย่างไว้ในหน้าเดียว: KPI · แผนที่สรุปหลายจังหวัด (สลับ 3 มุมมอง) · เปรียบเทียบจังหวัด · ตารางเชิงปฏิบัติ
// แผนที่นี้เป็น "มุมมองสรุปภาพรวม" ต่างจากแผนที่หลัก — ปิดการคลิกดูรายละเอียด/เพิ่มข้อมูล/สร้างแผนเข้าพบ (ส่ง handler เปล่า)
// เลขวิ่ง (count-up) — tween ค่าเดิม→ค่าใหม่แบบ easeOutCubic เมื่อ value เปลี่ยน · ให้ตัวเลข KPI ไหลลื่น ไม่วูบ
function CountUp({value, fmt=num, dur=750}){
  const [shown, setShown] = useState(value);
  const curRef = useRef(value); curRef.current = shown;   // ค่าที่แสดงอยู่จริง (กันค่า stale ใน closure)
  useEffect(()=>{
    const from = curRef.current, to = value;
    if(from===to) return;
    let raf; const t0=performance.now(); const ease=t=>1-Math.pow(1-t,3);
    const step=now=>{ const p=Math.min(1,(now-t0)/dur); setShown(from+(to-from)*ease(p));
      if(p<1) raf=requestAnimationFrame(step); else setShown(to); };
    raf=requestAnimationFrame(step);
    return ()=>cancelAnimationFrame(raf);
  },[value,dur]);
  return html`${fmt(Math.round(shown))}`;
}

/* ── ตัวกรองช่วงเวลาแบบเร็ว: 7 วัน · 30 วัน · 1 ปี (วางระหว่าง "หมวดหมู่ธุรกิจ" กับ "ปฏิทินวันเริ่ม") ──
   ตั้งค่า from/to (created_at) ให้อัตโนมัติ โดยยึด "วันที่ข้อมูลใหม่สุดในระบบ" เป็นจุดอ้างอิง
   ไม่อิงนาฬิกาของเครื่อง เพื่อให้ช่วงที่เลือกมีข้อมูลจริงเสมอ · "กำหนดเอง" = ใช้ปฏิทินเลือกวันเอง */
const _QR_DAY = 864e5;
// วันที่ข้อมูลใหม่สุด (created_at) ในระบบ — รูปแบบ YYYY-MM-DD เทียบเป็นสตริงได้ตรง
function dataAnchor(db){
  let mx=""; const scan=arr=>{ for(const o of (arr||[])){ if(o.created_at && o.created_at>mx) mx=o.created_at; } };
  scan(db&&db.customers); scan(db&&db.prospects);
  return mx;   // "" ถ้ายังไม่มีข้อมูล
}
// ถอยหลังจากวันอ้างอิง n วัน คืนค่าเป็น YYYY-MM-DD (คิดแบบ UTC ให้ผลคงที่ทุกเขตเวลา)
function daysBack(anchor, n){
  const t = Date.parse(anchor+"T00:00:00Z") - n*_QR_DAY;
  return new Date(t).toISOString().slice(0,10);
}
const QR_PRESETS = [
  {id:"7d",  get label(){ return t("7 วันล่าสุด","Last 7 days"); },  days:6},
  {id:"30d", get label(){ return t("30 วันล่าสุด","Last 30 days"); }, days:29},
  {id:"1y",  get label(){ return t("1 ปีล่าสุด","Last year"); },      days:364}];
// ตัวควบคุมช่วงเวลาด่วน — ค่าปัจจุบันสืบจาก from/to (ถ้าตรงพรีเซ็ตไหนก็โชว์อันนั้น ไม่งั้น "กำหนดเอง")
function QuickRange({db, from, to, setFrom, setTo}){
  const anchor = dataAnchor(db);
  const cur = anchor ? QR_PRESETS.find(p=> from===daysBack(anchor,p.days) && to===anchor) : null;
  const val = cur ? cur.id : "custom";
  const onPick = id=>{
    if(id==="custom"){ setFrom(""); setTo(""); return; }
    const p = QR_PRESETS.find(x=>x.id===id); if(!p||!anchor) return;
    setFrom(daysBack(anchor, p.days)); setTo(anchor);
  };
  return html`<label class="op-lab">${t("⏱️ ช่วงเวลาด่วน", "⏱️ Quick period")}
    <${Dropdown} value=${val} onChange=${onPick}
      options=${[...QR_PRESETS.map(p=>[p.id,p.label]),["custom",t("กำหนดเอง", "Custom")]]}/></label>`;
}

export function Reports(){
  const {db, filters, visitPlans, user, addToPlan, goMap, nav} = useApp();
  // เมื่อผู้ใช้เป็น TC → หน้ารายงานนี้คือ "แดชบอร์ดของ TC": ล็อกจังหวัดที่รับผิดชอบ ไม่มีตัวเลือกข้ามจังหวัด/TC คนอื่น (กันข้อมูลรั่ว)
  const isTC   = !!(user && user.role==="Trade Coordinator" && user.province);
  const tcProv = isTC ? user.province : null;
  const [prov, setProv]           = useState(isTC ? tcProv : "All");    // TC ล็อกจังหวัด · อื่น ๆ = ทั้งหมด/รายจังหวัด
  const [segSel, setSegSel]       = useState("All");    // ตัวกรอง Segment ธุรกิจ
  const [from, setFrom]           = useState("");       // ช่วงเวลา: วันที่เริ่ม (created_at)
  const [to, setTo]               = useState("");       // ช่วงเวลา: วันที่สิ้นสุด (created_at)
  const [tcSel, setTcSel]         = useState("All");    // ตัวกรอง TC ผู้รับผิดชอบ
  const [distSel, setDistSel]     = useState("All");    // ตัวกรองอำเภอ (เฉพาะ TC — เจาะดูในจังหวัดที่รับผิดชอบ)
  const [tcScope, setTcScope]     = useState("All");    // ขอบเขตตาราง "รายชื่อที่ควรไปต่อ" (TC): ทั้งหมด / เฉพาะหมวดที่ยังขาด
  const [mapView, setMapView]     = useState("kde");    // kde | cluster | territory
  const [exportOpen, setExportOpen] = useState(false);
  const [tablePage, setTablePage] = useState(1);        // หน้าปัจจุบันของตารางรายโซน (ข้อ 4)
  const [gapHi, setGapHi]         = useState(false);    // ไฮไลต์ตารางเมื่อคลิกการ์ด Gap (ข้อ 6)
  const {tip, show:showTip, hide:hideTip} = useTip();   // tooltip ระดับหน้า (KPI (i) / progress / badge)
  const tableRef = useRef(null);
  // เปลี่ยนตัวกรอง → กลับหน้า 1 เสมอ (ข้อ 4)
  useEffect(()=>{ setTablePage(1); }, [prov,segSel,from,to,tcSel,distSel]);
  if(!db.customers) return html`<div class="page"><div class="emptybox">${t("กำลังโหลดข้อมูลธุรกิจ…", "Loading business data…")}</div></div>`;
  // แดชบอร์ดของผู้บริหาร (ไม่ใช่ TC) ในหน้ารายงาน = ใช้ "แดชบอร์ดภาพรวมธุรกิจ" (Monitoring) แทนของเดิม
  // hook ทุกตัวถูกเรียกครบก่อนบรรทัดนี้แล้ว การ return ก่อนจึงไม่ทำให้ลำดับ hook เพี้ยน
  if(!isTC) return html`<${Monitoring} defaultTab="business"/>`;
  const f = filters;
  const today = t("11 ก.ค. 2569", "11 Jul 2026");   // วันที่ พ.ศ. (ไม่ปน ค.ศ.)

  // ── ค่าที่ปุ่มส่งออกต้องใช้ (คงตรรกะเดิม ไม่แก้สูตร) ──
  const k = globalKpis(db, f);
  const rankOpp = rankAreas(db, f, "gapScore"), rankCov = rankAreas(db, f, "coverage"),
        rankGap = rankAreas(db, f, "gapCount"), rankOppDist = rankDistricts(db, f, "gapScore"), rankGapDist = rankDistricts(db, f, "gapCount");
  const ROLE_TH={Administrator:t("ผู้ดูแลระบบ", "System Administrator"),Management:t("ผู้บริหาร", "Management"),"Trade Coordinator":t("ผู้ประสานงานการค้า", "Trade Coordinator")};
  const handleExport = ({format, filename, opts, dataSel, count, scope})=>{
    const name = (filename||"").trim().replace(/[\\/:*?"<>|]+/g,"_") || defaultReportName(scope);
    const fmtLabel = {pdf:"PDF",excel:"Excel",csv:"CSV"}[format]||format;
    const scopeStr = scope ? `${scope.areaLabel||t("ทั้งประเทศ","Nationwide")} · ${scope.segLabel||t("ทั้งหมด","All")} · ${scope.dateLabel||t("ทั้งหมด","All")}` : "";
    // §5 ด่านตรวจสิทธิ์ (นอกเหนือจากการซ่อนตัวเลือก) — บทบาทไม่มีสิทธิ์ = ปฏิเสธ + บันทึกความล้มเหลว
    // TODO(server): ต้องบังคับด่านนี้ที่เซิร์ฟเวอร์จริงตอนเรียก API ส่งออก การตรวจฝั่ง client เป็นชั้นเสริมเท่านั้น
    if(!canExport(user.role, format)){
      pushAudit({user:user.name, action:t("ส่งออกรายงานถูกปฏิเสธ", "Report export refused"), category:"ส่งออก",
        detail:`${t("บทบาท", "Role")} ${ROLE_TH[user.role]||user.role} ${t("ไม่มีสิทธิ์ส่งออก", "No export permission")} ${fmtLabel} · ${scopeStr} · ${num(count||0)} ${t("รายการ", "records")}`});
      toast(`${t("บทบาทของคุณไม่มีสิทธิ์ส่งออกไฟล์", "Your role cannot export files")} ${fmtLabel}`,"bad"); setExportOpen(false); return;
    }
    const rows = buildReportRows("coverage", {today, k, rankOpp, rankCov, rankGap, rankOppDist, rankGapDist, filters:f}, {...opts, dataSel});
    setExportOpen(false);
    if(format==="csv"){ downloadCSV(name+".csv", rows); toast(t("ส่งออกไฟล์ CSV แล้ว", "CSV file exported"),"good"); }
    else if(format==="excel"){ downloadXLS(name+".xls", rows); toast(t("ส่งออกไฟล์ Excel แล้ว", "Excel file exported"),"good"); }
    else { toast(t("กำลังเตรียมไฟล์ PDF…", "Preparing the PDF…"),"info"); setTimeout(()=>window.print(),350); }
    // §6 บันทึกการส่งออกสำเร็จ: ผู้ส่งออก · ประเภท+ชื่อไฟล์ · ขอบเขต · จำนวนรายการ (เวลาเป็น พ.ศ. โดย audit log)
    pushAudit({user:user.name, action:t("ส่งออกรายงาน", "Export report"), category:"ส่งออก",
      detail:`${fmtLabel} · ${name} · ${scopeStr} · ${num(count||0)} ${t("รายการ", "records")}`});
  };

  // ขอบเขตวิเคราะห์: "ทั้งหมด" = 4 จังหวัดหลัก (ที่มีข้อมูลระดับเขต) · หรือจังหวัดเดียวที่เลือก
  // ไม่รวมจังหวัดอื่นที่ไม่มีข้อมูลระดับเขต (เช่น ขอนแก่น) เพราะ cluster/เขตรองรับแค่ 4 จังหวัดนี้
  const scopeProvs = prov==="All" ? CLUSTER_PROVS : [prov];
  // ── Global Filters: Segment + ช่วงเวลา(created_at) + TC — ใช้ร่วมกันทุก Section ──
  const segObj = segSel==="All" ? f.segments : segOnly(segSel);
  const cfFor = p => ({status:{Existing:true,Prospect:true}, segments:segObj, province:p});
  const segOk = o => !!segObj[o.segment];   // ผ่านตัวกรอง Segment ธุรกิจ (ใช้กับ component ที่นับตรงจาก vdb เช่น กราฟแนวโน้ม)
  const inDate = o => (!from || (o.created_at && o.created_at>=from)) && (!to || (o.created_at && o.created_at<=to));
  const tcOk = o => tcSel==="All" || o.tc_owner===tcSel;
  const distOk = o => !isTC || distSel==="All" || o.district===distSel;   // TC: กรองตามอำเภอในจังหวัดที่รับผิดชอบ
  const pass = o => inDate(o) && tcOk(o) && distOk(o);
  // รายชื่ออำเภอในจังหวัดของ TC (สำหรับตัวกรองอำเภอ) — ดึงจากข้อมูลจริง
  const tcDistricts = isTC ? [...new Set(db.customers.concat(db.prospects).filter(x=>x.province===tcProv).map(x=>x.district).filter(Boolean))].sort() : [];
  // ชุดข้อมูลกรองตามช่วงเวลา/TC (ยังไม่จำกัดจังหวัด) — ใช้กับ Area Comparison 4 จังหวัด
  const fdb = {...db, customers: db.customers.filter(pass), prospects: db.prospects.filter(pass)};
  // ชุดข้อมูลในขอบเขตจังหวัดที่เลือก + กรองเวลา/TC — ป้อนเข้าสูตรเดิม (analyzeArea/buildClusters) ไม่แก้สูตร
  const vdb = {...db, customers: fdb.customers.filter(c=>scopeProvs.includes(c.province)),
                      prospects: fdb.prospects.filter(p=>scopeProvs.includes(p.province))};
  const tcList = [...new Set(db.customers.concat(db.prospects).filter(x=>CLUSTER_PROVS.includes(x.province)).map(x=>x.tc_owner).filter(Boolean))].sort();
  // ── ขอบเขตข้อมูลสำหรับกล่องส่งออก (§2) — สืบจากตัวกรองบนหน้าจอ จำนวนเป็นเลขจริงที่ตรงกับหน้า ──
  const _exSeg = o => segSel==="All" || o.segment===segSel;
  const _beTH = s => s ? thDate(s) : "";   // ใช้ตัวแปลงกลาง
  const exportScope = {
    areaName: isTC ? (distSel!=="All"?districtTH(distSel):provinceTH(tcProv)) : (prov==="All"?t("ทั้งประเทศ", "Nationwide"):provinceTH(prov)),
    areaLabel: isTC ? (`${t("จังหวัด", "Province ")}${provinceTH(tcProv)}`+(distSel!=="All"?` ${t("· อ.", "· dist.")}${districtTH(distSel)}`:"")) : (prov==="All"?t("ทั้งประเทศ (4 จังหวัดหลัก)", "Nationwide (4 main provinces)"):`${t("จังหวัด", "Province ")}${provinceTH(prov)}`),
    segLabel: segSel==="All"?t("ทั้งหมด", "All"):segTH(segSel),
    dateLabel: (from||to)?`${from?_beTH(from):t("เริ่มต้น", "Start")} – ${to?_beTH(to):t("ล่าสุด", "Latest")}`:t("ทั้งหมด", "All"),
    counts:{ existing: vdb.customers.filter(_exSeg).length, prospect: vdb.prospects.filter(_exSeg).length },
  };
  // สถิติรายจังหวัด — ในขอบเขต และของ 4 จังหวัดหลักเสมอ (ไว้เปรียบเทียบ) · คิดจากชุดที่กรองแล้ว
  const provStats = scopeProvs.map(p=>analyzeArea(vdb, p, cfFor(p)));
  const mainStats = CLUSTER_PROVS.map(p=>({province:p, s:analyzeArea(fdb, p, cfFor(p))}));
  // คลัสเตอร์ทุกจังหวัดในขอบเขต (สำหรับขอบเขตบนแผนที่ + ตาราง) — เรียงตามดัชนี Lead สูง→ต่ำ
  const clusters = scopeProvs.flatMap(p=> buildClusters(vdb, p, cfFor(p)).map(c=>({...c, province:p})) )
    .sort((a,b)=>b.gapScore-a.gapScore);

  // ── Section 1: KPI ──
  const totExisting = provStats.reduce((a,s)=>a+s.customerCount,0);
  const totProspect = provStats.reduce((a,s)=>a+s.prospectCount,0);
  const totalMembers = totExisting+totProspect;
  const coverage = totalMembers ? Math.round(totExisting/totalMembers*100) : 0;               // ความครอบคลุมรวมในขอบเขต
  // โซนช่องว่างโอกาส = โซนที่ความครอบคลุมต่ำกว่าค่าเฉลี่ยของพื้นที่ (ยังเจาะได้อีก) — นิยามแบบเทียบค่าเฉลี่ย
  // ไม่ผูกกับเกณฑ์ ratio ตายตัว เพราะ 4 จังหวัดหลักเป็นพื้นที่ครอบคลุมดีอยู่แล้ว เกณฑ์ ratio จะได้ 0 ตลอดจนดูเหมือนบั๊ก
  const gapZones = clusters.filter(c=>c.coverage < coverage).length;

  // ── Section 2: แผนที่สรุป — ใช้ vdb (กรองจังหวัด/เวลา/TC แล้ว) + layer ตามมุมมอง ──
  const mapFilters = {status:{Existing:true,Prospect:true}, segments:segObj, province:prov};
  const mapLayers = mapView==="kde"
      ? {heat:true, kde:true, existing:false, prospect:false, cluster:false, op:{heat:80}}       // KDE ความหนาแน่น (รัศมี ~800ม.)
    : mapView==="cluster"
      ? {heat:false, existing:true, prospect:true, cluster:true, visit:true, op:{existing:90,prospect:85}, radius:18}  // กลุ่มลูกค้า/Lead
      : {heat:false, existing:false, prospect:false, cluster:false};                             // territory (วาดขอบเขตผ่าน prop territories)
  // โหมดเขตรับผิดชอบ: คำนวณ hull ต่อ TC + พื้นที่ทับซ้อน จากพิกัดจริงในขอบเขต (เฉพาะตอนเปิดโหมดนี้ เพื่อประหยัด)
  const territories = mapView==="territory" ? buildTerritories(vdb.customers.concat(vdb.prospects)) : null;

  // ── Section 3: ตารางโซน (พร้อมสัดส่วนสถานะการเข้าพบ) ──
  const maxMarket = Math.max(1, ...clusters.map(c=>c.market));
  const zoneRows = clusters.map((c,i)=>{
    const set=new Set(c.districts);
    const ps=vdb.prospects.filter(p=>p.province===c.province && set.has(p.district) && prosPass(p,cfFor(c.province)));
    const covered=ps.filter(p=>(p.visit_status||"ยังไม่เข้าพบ")==="ครอบคลุมแล้ว").length;
    // TC ที่ดูแลโซนนี้มากที่สุด (จากพิกัดจริงในเขตของกลุ่ม) — ใช้แสดงสถานะ Territory ในตาราง
    const tally={}; vdb.customers.concat(vdb.prospects).forEach(x=>{ if(x.province===c.province && set.has(x.district) && x.tc_owner) tally[x.tc_owner]=(tally[x.tc_owner]||0)+1; });
    const dom=Object.entries(tally).sort((a,b)=>b[1]-a[1])[0];
    return {...c, priority:i+1, psTotal:ps.length, covered, density:densityLabel(c.market, maxMarket),
      domTC: dom?dom[0]:"—", gapLv: c.gapLevel};
  });
  // ── ตารางรายโซน: แบ่งหน้า 5 แถว/หน้า (ข้อ 4) ──
  const PAGE_SIZE = 5;
  const totalPages = Math.max(1, Math.ceil(zoneRows.length/PAGE_SIZE));
  const curPage = Math.min(tablePage, totalPages);
  const pageRows = zoneRows.slice((curPage-1)*PAGE_SIZE, curPage*PAGE_SIZE);
  const pageStart = zoneRows.length ? (curPage-1)*PAGE_SIZE+1 : 0, pageEnd = Math.min(curPage*PAGE_SIZE, zoneRows.length);
  // รายการเลขหน้า — ย่อเป็น 1 … N เมื่อเกิน 7 หน้า
  const pageList = (()=>{ const t=totalPages, c=curPage;
    if(t<=7) return Array.from({length:t},(_,i)=>i+1);
    if(c<=4) return [1,2,3,4,5,"…",t];
    if(c>=t-3) return [1,"…",t-4,t-3,t-2,t-1,t];
    return [1,"…",c-1,c,c+1,"…",t]; })();

  const cardSt = {background:"var(--panel)",border:"1px solid var(--stroke)",borderRadius:"var(--r)",padding:"16px 18px",display:"flex",flexDirection:"column",gap:"7px"};
  const capSt  = {display:"flex",alignItems:"center",gap:"8px",color:"var(--muted)",fontSize:"12.5px",fontWeight:600};
  const bigSt  = {fontSize:"26px",fontWeight:800,color:"var(--txt)",lineHeight:1.1};
  const covColor = cov => cov>=REPORT_COV_TARGET ? "#33d69f" : cov>=50 ? "#ffb02e" : "#ff5a3c";
  const cmpSorted = [...mainStats].sort((a,b)=>b.s.coverage-a.s.coverage);
  const covGap = Math.max(0, REPORT_COV_TARGET - coverage);   // ส่วนต่างที่ยังต่ำกว่าเป้า (จุด %)

  // ลายเซ็นตัวกรอง — ใช้เป็น key ให้กราฟ "เล่นอนิเมชันใหม่" เฉพาะเมื่อตัวกรองเปลี่ยน (ไม่เล่นซ้ำตอน hover/resize/แบ่งหน้า)
  const animSig = [prov,segSel,from,to,tcSel].join("|");

  // ── delta เทียบช่วงก่อนหน้า (30 วันล่าสุด vs 30 วันก่อนหน้า) จาก created_at ในขอบเขต+Segment ──
  const DAY=864e5, T0=Date.parse("2026-07-13"), PLAN_TODAY="2026-07-13";   // วันอ้างอิง "วันนี้" ของข้อมูลสาธิต
  const inWin=(o,a,b)=>o.created_at && Date.parse(o.created_at)>T0-b*DAY && Date.parse(o.created_at)<=T0-a*DAY;
  const deltaOf = recs => recs.filter(o=>segOk(o)&&inWin(o,0,30)).length - recs.filter(o=>segOk(o)&&inWin(o,30,60)).length;
  const custDelta = deltaOf(vdb.customers), prosDelta = deltaOf(vdb.prospects);

  // (i) จุดข้อมูล — hover ขึ้น tooltip อธิบายนิยาม/สูตร (ใช้ tooltip ระดับหน้าเดียวกัน · รองรับแตะค้างบนมือถือ)
  const infoDot = (title,text)=>html`<span class="rp-info" tabindex="0"
    onMouseMove=${e=>showTip(e,title,[{label:text,value:""}])} onMouseLeave=${hideTip}
    ontouchstart=${e=>{e.stopPropagation();showTip(e,title,[{label:text,value:""}]);}}>i</span>`;
  // ป้าย delta เทียบช่วงก่อน (เขียว=เพิ่ม / แดง=ลด / เทา=เท่าเดิม)
  const deltaBadge = d => html`<div class=${"rp-delta "+(d>0?"up":d<0?"down":"flat")}>
    <span>${d===0 ? "—" : html`<${Icon} name=${d>0?"trend":"trendDown"} size=${14} stroke=${2.2}/>`}</span><span>${d>0?"+":""}${num(d)} ${t("จากช่วงก่อน", "vs. the previous period")}</span></div>`;

  // ── หมวดธุรกิจที่เครือข่ายยังขาด: Lead รายหมวดของขอบเขตที่เลือก ──
  // ช่องว่าง = จำนวน Lead ในหมวดนั้น − จำนวนสมาชิกเครือข่ายในหมวดเดียวกัน (ไม่ต่ำกว่า 0)
  // ยังกรองตาม Segment/ช่วงเวลา/TC ตาม Global Filter เหมือนเดิม
  const gapCusBase = (prov==="All" ? fdb.customers : fdb.customers.filter(c=>c.province===prov)).filter(c=>custPass(c,cfFor(c.province)));
  const gapProBase = (prov==="All" ? fdb.prospects : fdb.prospects.filter(p=>p.province===prov)).filter(p=>prosPass(p,cfFor(p.province)));
  const gapScope   = demandGap(gapCusBase, gapProBase, prov==="All"?GAP_REF.country:GAP_REF.province);
  const gapTotal   = gapScope.gapCount;
  const GAP_BAR_COLORS = ["#dc2626","#ff6a1a","#ffb02e","#c8e622","#26e07a"];
  const gradeBars = gapScope.gapSegs.map((g,i)=>({label:segTH(g.seg), value:g.gap, color:GAP_BAR_COLORS[i]||OTHER_COLOR, seg:g.seg, demand:g.demand, supply:g.supply}));
  // Top 5 พื้นที่ Lead สูงสุด · ดัชนีเท่ากัน tie-break ด้วยจำนวนที่ยังขาด
  const topAreas = rankDistricts(fdb, f, "gapScore").filter(d=>scopeProvs.includes(d.province))
    .sort((a,b)=> b.gapScore-a.gapScore || b.gapCount-a.gapCount).slice(0,5);

  // ── Growth Trend: ยอดสะสมรายเดือนจาก created_at — แยก 2 เส้น ลูกค้าปัจจุบัน / Lead ──
  const custMon={}, prosMon={};   // นับจำนวนต่อเดือน (YYYY-MM) แยกลูกค้า/Lead — กรอง Segment ด้วย (segOk)
  vdb.customers.forEach(r=>{ if(r.created_at && segOk(r)){ const m=r.created_at.slice(0,7); custMon[m]=(custMon[m]||0)+1; } });
  vdb.prospects.forEach(r=>{ if(r.created_at && segOk(r)){ const m=r.created_at.slice(0,7); prosMon[m]=(prosMon[m]||0)+1; } });
  const months = [...new Set([...Object.keys(custMon), ...Object.keys(prosMon)])].sort();  // แกนเดือนร่วม
  let _cc=0, _cp=0;
  const cumCust = months.map(m=>(_cc += (custMon[m]||0)));   // เส้นที่ 1: ลูกค้าปัจจุบันสะสม
  const cumPros = months.map(m=>(_cp += (prosMon[m]||0)));   // เส้นที่ 2: Leadสะสม
  const cumLast = (cumCust[cumCust.length-1]||0) + (cumPros[cumPros.length-1]||0);  // ยอดรวมสุดท้าย
  const monLabel = thMonth;   // ใช้ตัวแปลงกลาง

  // ── กราฟโดนัท Segment ธุรกิจ (Section 2 ขวา) — reuse Donut เดิม จากหน้าสรุปแดชบอร์ด ──
  // แหล่งข้อมูล = vdb (กรองตามจังหวัด/ช่วงเวลา/TC แล้ว) แสดงสัดส่วนครบทุกกลุ่ม · เมื่อเลือก Segment เจาะจง จะ "ไฮไลต์" กลุ่มนั้น
  const segRecs = vdb.customers.concat(vdb.prospects);
  const segDim = hex => hex+"33";   // ทำสีจางลงสำหรับกลุ่มที่ไม่ถูกเลือก (โปร่งแสง ~20%)
  // 12 เซกเมนต์ → โดนัทแสดง top-5 + "อื่น ๆ" (รวมที่เหลือ) แทน hardcode 4 หมวด (§8.4)
  const segCountAll = SEGMENTS.map(s=>({s, label:segTH(s), value:segRecs.filter(x=>x.segment===s).length}))
    .filter(x=>x.value>0).sort((a,b)=>b.value-a.value);
  const segTop = segCountAll.slice(0,5), segRest = segCountAll.slice(5);
  const restSum = segRest.reduce((a,x)=>a+x.value,0);
  const dimOK = seg => segSel==="All" || segSel===seg;   // ไฮไลต์กลุ่มที่เลือก
  const segTotals = segTop.map(x=>({label:x.label,
      color: dimOK(x.s) ? SEG_COLOR[x.s] : segDim(SEG_COLOR[x.s]), value:x.value}))
    .concat(restSum>0 ? [{label:t("อื่น ๆ (", "Other (")+segRest.length+t(" หมวด)", " categories)"),
      color: (segSel==="All"||segRest.some(r=>r.s===segSel)) ? OTHER_COLOR : segDim(OTHER_COLOR), value:restSum}] : []);
  const segCenterVal = segSel==="All" ? segRecs.length : segRecs.filter(x=>x.segment===segSel).length;  // ตรงกลาง = ยอดกลุ่มที่เลือก

  // ═══════════════ แดชบอร์ด TC — ตัวชี้วัด/งานเฉพาะพื้นที่รับผิดชอบ (ใช้เฉพาะเมื่อ isTC) ═══════════════
  const USER_SRC = "ผู้ใช้เพิ่มเอง";   // ค่า source ของระเบียนที่ TC/ผู้ใช้กรอกเอง
  // Lead รายหมวดของเขตที่รับผิดชอบ — ใช้จัดลำดับว่า Lead รายไหนอยู่ในหมวดที่ "ยังขาด" มากที่สุด
  const tcGapSegs = gapBySegment(vdb.customers.filter(segOk), vdb.prospects.filter(segOk));
  const tcGapMap  = Object.fromEntries(tcGapSegs.map(x=>[x.seg, x.gap]));
  const tcGapOf   = p => tcGapMap[p.segment]||0;
  const tcNotVisited  = vdb.prospects.filter(p=>segOk(p) && (p.visit_status||"ยังไม่เข้าพบ")==="ยังไม่เข้าพบ").length;
  const tcConvMonth   = vdb.customers.filter(o=>segOk(o) && inWin(o,0,30)).length;    // แปลงเป็นลูกค้าใน 30 วันล่าสุด
  const tcPlannedStops= new Set((visitPlans||[]).flatMap(p=>(p.customers||[]).map(c=>c.id))).size;
  const tcVisitedWeek = vdb.prospects.filter(p=>(p.visitRounds||[]).some(r=>r.status==="เสร็จสิ้น" && r.doneDate && Date.parse(r.doneDate)>T0-7*DAY)).length;
  const actNoOwner = vdb.prospects.filter(p=>segOk(p) && !p.tc_owner && tcGapOf(p)>0).sort((a,b)=>tcGapOf(b)-tcGapOf(a));
  const actDeals = vdb.prospects.filter(p=> p.dealStatus==="pending" || (p.visitRounds||[]).some(r=>/ปิดการขาย|พร้อมปิดดีล/.test(r.outcome||"")));
  const actPending = vdb.customers.concat(vdb.prospects).filter(x=> x.source===USER_SRC && x.dealStatus!=="approved");
  const tcNewProspects7 = vdb.prospects.filter(p=>p.created_at && Date.parse(p.created_at)>T0-7*DAY).length;
  const tcTopProspects = topGapLeads(vdb.prospects.filter(p=>segOk(p)), tcGapSegs, 8);
  const tcLast6 = months.slice(-6);
  const tcNewCustBars = tcLast6.map(m=>({label:monLabel(m), value:custMon[m]||0}));
  const tcDistCov = tcDistricts.map(d=>{ const cs=vdb.customers.filter(c=>c.district===d&&segOk(c)).length, ps=vdb.prospects.filter(p=>p.district===d&&segOk(p)).length, tot=cs+ps;
    return {district:d, cov: tot?Math.round(cs/tot*100):0, cs, ps, tot}; }).sort((a,b)=>b.cov-a.cov);
  const tcOppAvg  = clusters.length ? Math.round(clusters.reduce((a,c)=>a+c.gapScore,0)/clusters.length) : 0;
  const tcRankCov = [...mainStats].sort((a,b)=>b.s.coverage-a.s.coverage).findIndex(x=>x.province===tcProv)+1;
  const tcTopDistricts = topAreas.slice(0,3);

  // ═══════════ TC Dashboard (ออกแบบใหม่) — ทุกตัวเลขมาจากข้อมูลจริงในเขตที่รับผิดชอบเท่านั้น ═══════════
  // แถว 1 · งานที่ต้องทำวันนี้ (ซ่อนแถวที่นับได้ 0 · ถ้าว่างทั้งหมดแสดง "ไม่มีงานค้าง")
  const apptToday    = vdb.prospects.filter(p=>(p.visitRounds||[]).some(r=>r.status==="นัดแล้ว" && r.date===PLAN_TODAY)).length;
  const apptOverdue  = vdb.prospects.filter(p=>(p.visitRounds||[]).some(r=>r.status==="นัดแล้ว" && r.date && r.date<PLAN_TODAY)).length;
  const dealPending  = vdb.prospects.filter(p=>p.dealStatus==="pending").length;
  const gapNotVisit = vdb.prospects.filter(p=>segOk(p) && tcGapOf(p)>0 && (p.visit_status||"ยังไม่เข้าพบ")==="ยังไม่เข้าพบ").length;
  const scrollToTable = ()=>{ tableRef.current&&tableRef.current.scrollIntoView({behavior:"smooth",block:"start"}); };
  const tcTasks = [
    {icon:"calendar", label:t("เข้าพบตามนัดวันนี้", "Appointments today"),             count:apptToday,      tone:"bad",  act:scrollToTable},
    {icon:"clock",    label:t("นัดหมายที่เลยกำหนด", "Overdue appointments"),             count:apptOverdue,    tone:"warn", act:scrollToTable},
    {icon:"check",    label:t("คำขอเปลี่ยนเป็นลูกค้าที่รอผล", "Conversion requests awaiting a decision"),     count:dealPending,    tone:"info", act:()=>goMap&&goMap()},
    {icon:"target",   label:t("Lead ในหมวดที่ยังขาด · ยังไม่ได้เข้าพบ", "Leads in under-served categories · not visited yet"), count:gapNotVisit, tone:"bad",  act:()=>{ setTcScope("gap"); scrollToTable(); }},
  ].filter(t=>t.count>0);

  // แถว 2.1 · สัดส่วนที่เป็นลูกค้าแล้ว (donut) — ไม่ใช้คำว่า Coverage
  const totBiz = totExisting + totProspect;
  const custShare = totBiz ? Math.round(totExisting/totBiz*100) : 0;
  const shareDonut = totBiz ? [
    {label:t("เป็นลูกค้าแล้ว", "Now customers"), value:totExisting, color:STATUS_COLOR.Existing},
    {label:t("ยังเป็น Lead", "Still Leads"),   value:totProspect, color:STATUS_COLOR.Prospect},
  ] : [];

  // แถว 2.2 · Lead แยกตามอำเภอ (แท่งซ้อน ลูกค้า/Lead) top 4 + อื่น ๆ · เฉพาะอำเภอในจังหวัดของผู้ใช้
  const distAll = tcDistricts.map(d=>{ const cs=vdb.customers.filter(c=>c.district===d&&segOk(c)).length, ps=vdb.prospects.filter(p=>p.district===d&&segOk(p)).length;
    return {d, cs, ps, tot:cs+ps}; }).filter(x=>x.tot>0).sort((a,b)=>b.tot-a.tot);
  const distRest = distAll.slice(4);
  const distBars = distAll.slice(0,4).concat(distRest.length ? [{d:"__other", otherN:distRest.length,
    cs:distRest.reduce((a,x)=>a+x.cs,0), ps:distRest.reduce((a,x)=>a+x.ps,0), tot:distRest.reduce((a,x)=>a+x.tot,0)}] : []);
  const distMax = Math.max(1, ...distBars.map(b=>b.tot));

  // แถว 2.3 · Lead แยกตามหมวดธุรกิจ top 5 + อื่น ๆ (สีตามข้อมูลหลัก)
  const segLeadAll = SEGMENTS.map(s=>({s, label:segTH(s), value:vdb.prospects.filter(p=>p.segment===s).length, color:SEG_COLOR[s]}))
    .filter(x=>x.value>0).sort((a,b)=>b.value-a.value);
  const segLeadRest = segLeadAll.slice(5);
  const segLeadBars = segLeadAll.slice(0,5).map(x=>({label:x.label, value:x.value, color:x.color}))
    .concat(segLeadRest.length ? [{label:t("อื่น ๆ (", "Other (")+segLeadRest.length+t(" หมวด)", " categories)"), value:segLeadRest.reduce((a,x)=>a+x.value,0), color:OTHER_COLOR}] : []);

  // แถว 3.1 · เส้น 6 เดือน — ลูกค้าใหม่/เดือน + Lead ใหม่/เดือน (จากวันที่ในระเบียนจริง)
  const last6 = months.slice(-6);
  const lineCust = last6.map(m=>custMon[m]||0);
  const linePros = last6.map(m=>prosMon[m]||0);
  const line6Total = lineCust.reduce((a,b)=>a+b,0)+linePros.reduce((a,b)=>a+b,0);

  // แถว 3.2 · funnel เส้นทางจาก Lead สู่ลูกค้า (นับเฉพาะการกระทำของผู้ใช้ตั้งแต่ขั้นที่ 2)
  const fVisited     = vdb.prospects.filter(p=>(p.visit_status||"ยังไม่เข้าพบ")!=="ยังไม่เข้าพบ" || (p.visitRounds||[]).length>0).length;
  const fVisitedDone = vdb.prospects.filter(p=>(p.visit_status||"")==="ครอบคลุมแล้ว" || (p.visitRounds||[]).some(r=>r.status==="เสร็จสิ้น")).length;
  const fRequested   = vdb.prospects.filter(p=>p.dealStatus==="pending"||p.dealStatus==="approved").length;
  const fConverted   = vdb.prospects.filter(p=>p.dealStatus==="approved").length;
  const funnel = [
    {label:t("Lead ในเขตที่รับผิดชอบ", "Leads in your territory"),    value:totProspect},
    {label:t("เริ่มเข้าไปเข้าพบแล้ว", "Visits started"),       value:fVisited},
    {label:t("เข้าพบแล้วอย่างน้อย 1 ครั้ง", "Visited at least once"), value:fVisitedDone},
    {label:t("ส่งคำขอเปลี่ยนเป็นลูกค้า", "Conversion requested"),     value:fRequested},
    {label:t("อนุมัติเป็นลูกค้าแล้ว", "Approved as customers"),        value:fConverted},
  ];
  const funnelMax = Math.max(1, totProspect);

  // (ตาราง "รายชื่อที่ควรไปต่อ" ถูกถอดออกจากแดชบอร์ด TC แล้ว — จึงไม่ต้องคำนวณรายชื่ออีก)

  // ── เทียบลูกค้า/Lead รายหมวด ครบทั้ง 12 หมวด (แดชบอร์ด TC) ──
  // แสดงทุกหมวดแม้ค่าเป็น 0 เพราะ "หมวดที่ยังไม่มีใครเลย" คือข้อมูลที่ TC ต้องเห็น
  const segCompare = SEGMENTS.map(sg=>({ sg, label:segTH(sg), color:SEG_COLOR[sg],
    cust: vdb.customers.filter(c=>c.segment===sg).length,
    lead: vdb.prospects.filter(x=>x.segment===sg).length }))
    .sort((a,b)=> (b.cust+b.lead)-(a.cust+a.lead));
  const segCmpMax = Math.max(1, ...segCompare.map(x=>Math.max(x.cust, x.lead)));
  // สเกลแกน Y: ปัดขึ้นเป็นเลขกลม (1/2/2.5/5 × 10^n) ให้เส้นกริดอ่านง่าย ~4 ขั้น
  const niceStep = v => { const pw=Math.pow(10,Math.floor(Math.log10(v||1))); const r=(v||1)/pw;
    return (r<=1?1:r<=2?2:r<=2.5?2.5:r<=5?5:10)*pw; };
  const scStep = niceStep(segCmpMax/4);
  const scYMax = Math.max(scStep, Math.ceil(segCmpMax/scStep)*scStep);
  const scTicks = Array.from({length:Math.round(scYMax/scStep)+1},(_,i)=>i*scStep);
  // เรขาคณิตของกราฟ (หน่วย viewBox) — กว้างคงที่ต่อหมวด แล้วให้กล่องเลื่อนแนวนอนถ้าจอแคบ
  const SC_GW=76, SC_PL=52, SC_PR=14, SC_TOP=18, SC_PLOT=250, SC_BOT=104;
  const SC_W = SC_PL + segCompare.length*SC_GW + SC_PR;
  const SC_H = SC_TOP + SC_PLOT + SC_BOT;
  const scY = v => SC_TOP + SC_PLOT - (v/scYMax)*SC_PLOT;

  // ── Lead แยกตามอำเภอ (แท่งความคืบหน้า) · หมวดที่เติบโต/ชะลอตัวในเขต (90 วัน) · สิ่งที่พบจากข้อมูล (เฉพาะพื้นที่รับผิดชอบ) ──
  const distLeadMax = Math.max(1, ...distAll.map(d=>d.ps));
  const _inR = (t,a,b)=>{ const x=Date.parse(t); return x>T0-a*DAY && x<=T0-b*DAY; };
  const tcSegDelta = SEGMENTS.map(s=>{ const cs=vdb.customers.filter(c=>c.segment===s&&c.created_at);
      const cur=cs.filter(c=>_inR(c.created_at,90,0)).length, prev=cs.filter(c=>_inR(c.created_at,180,90)).length;
      return {s, label:segTH(s), cur, prev, delta:cur-prev}; }).filter(x=>x.cur||x.prev);
  const tcGainers = tcSegDelta.slice().sort((a,b)=>b.delta-a.delta).slice(0,3).filter(x=>x.delta>0);
  const tcLosers  = tcSegDelta.slice().sort((a,b)=>a.delta-b.delta).slice(0,3).filter(x=>x.delta<0);
  const _tcGain0 = tcGainers[0];
  const tcInsights = [
    {icon:"gap",    tone:"bad",  title:`${t("อัตราการเปลี่ยนเป็นลูกค้า", "Conversion rate")} ${custShare}%`, body:`${t("เป็นลูกค้าแล้ว", "Now customers")} ${num(totExisting)} ${t("ราย · ยังเป็น Lead", "customers · still Leads")} ${num(totProspect)} ${t("ราย ในเขต", "in the territory of ")}${provinceTH(tcProv)}`},
    {icon:"target", tone:"warn", title:`${t("หมวดธุรกิจที่เขตนี้ยังขาด", "Categories this territory is short of")}`, body:`${num(gapNotVisit)} ${t("ราย ที่ยังไม่ได้เข้าพบ — อยู่ในหมวดที่เครือข่ายยังขาด ควรเข้าดูแลก่อน", "not yet visited — they sit in categories the network is short of, so handle these first")}`},
  ];
  if(_tcGain0) tcInsights.push({icon:"trend", tone:"good", title:`${t("หมวด", "categories ")}${_tcGain0.label} ${t("กำลังเติบโต", "is growing")}`, body:`${t("ลูกค้าใหม่", "New customers")} ${num(_tcGain0.cur)} ${t("ราย ใน 90 วันล่าสุด (+", "in the last 90 days (+")}${num(_tcGain0.delta)} ${t("จากช่วงก่อน)", "vs. the previous period)")}`});
  const tcInsTone = t => t==="bad"?"var(--accent)":t==="warn"?"#f0a022":t==="good"?"#33d69f":"#2f7fe0";
  // แท่งซ้อนแนวนอน (ลูกค้าเข้ม + Lead จาง) สำหรับกราฟรายอำเภอ
  const stackBar = (label,cs,ps,max,onClick,sub)=>{ const tot=cs+ps;
    return html`<div class="tcd-sbar" onClick=${onClick} style=${onClick?{cursor:"pointer"}:null}>
      <div class="tcd-sbar-h"><span>${label}</span><b>${num(tot)}</b></div>
      <div class="tcd-sbar-track">
        <div class="tcd-sbar-f" style=${{width:(cs/max*100)+"%",background:STATUS_COLOR.Existing}}></div>
        <div class="tcd-sbar-f" style=${{width:(ps/max*100)+"%",background:STATUS_COLOR.Prospect,opacity:.55}}></div>
      </div>
      <div class="dim" style=${{fontSize:"11px",marginTop:"2px"}}>${sub||`${t("ลูกค้า", "Customers")} ${num(cs)} · Lead ${num(ps)}`}</div>
    </div>`; };
  const statChip = (lb,val,color)=>html`<div class="tc-chip"><div class="tc-chip-k">${lb}</div><div class="tc-chip-v" style=${{color:color||"var(--txt)"}}>${val}</div></div>`;
  const tcActionRow = (icon,label,count,tone,detail)=>html`<div class="tc-act">
    <div class=${"tc-act-ic "+tone}><${Icon} name=${icon} size=${16}/></div>
    <div style=${{flex:1,minWidth:0}}><div class="tc-act-t">${label}</div><div class="tc-act-d">${detail}</div></div>
    <${Badge} tone=${tone==="info"?"neutral":tone}>${num(count)} ${t("รายการ", "records")}</${Badge}>
  </div>`;

  // TC ได้เมนูรายงานเป็นคอลัมน์ซ้าย (TCReportNav) · บทบาทอื่นไม่มีเมนูนี้ จึงเป็นหน้าเดี่ยวเหมือนเดิม
  return html`<div class=${"page fade-in"+(isTC?" tcrp-wrap":"")} style=${{overflow:"visible"}}>
    <${ChartTip} state=${tip}/>
    ${isTC ? html`<${TCReportNav} active="reports" nav=${nav}/>`:""}
    <!-- ═════ Header: ชื่อหน้า + เลือกจังหวัด + ปุ่มส่งออก (เว้นมุมขวาบนให้ปุ่มปิด ✕ ของ modal) ═════ -->
    <div class="page-head" style=${{paddingRight:"56px", flexWrap:"wrap"}}>
      <div><div class="eyebrow">${isTC?t("แดชบอร์ดผู้ประสานงานการค้า (TC)", "Trade Coordinator dashboard"):t("ข่าวกรองเชิงพื้นที่ GeoIntel", "GeoIntel spatial intelligence")}</div>
        <h1>${isTC?`${t("ภาพรวมจังหวัด", "Province overview ")}${provinceTH(tcProv)}`:t("แดชบอร์ดสรุปภาพรวมเชิงพื้นที่", "Spatial overview dashboard")}</h1>
        <div class="sub">${isTC?`${user.name} · `:""}${t("จัดทำเมื่อ", " Prepared on")} ${today} ${t("· เครื่องมือทำเหมืองเชิงสถิติ · เอกสารลับ", "· statistical mining tool · confidential")}</div></div>
      <div class="ph-right" style=${{gap:"10px"}}>
        <button class="export-btn export-secondary" onClick=${()=>setExportOpen(true)}>
          <${Icon} name="download" size=${16} color="var(--accent)"/><span>${t("ส่งออก PDF/Excel", "Export PDF/Excel")}</span>
        </button>
      </div>
    </div>

    <!-- ═════ Global Filter Bar (5 ตัว): จังหวัด · Segment ธุรกิจ · ช่วงเวลา(created_at) · TC · Export ═════ -->
    <div class="op-slicers">
      ${isTC
        ? html`<label class="op-lab">${t("อำเภอ", "District")}
            <${Dropdown} value=${distSel} onChange=${setDistSel}
              options=${[["All",t("ทุกอำเภอ", "All districts")], ...tcDistricts.map(d=>[d,districtTH(d)])]}/></label>`
        : html`<label class="op-lab">${t("จังหวัด", "Province")}
            <${Dropdown} value=${prov} onChange=${setProv}
              options=${[["All",t("ทั้งหมด (4 จังหวัด)", "All (4 provinces)")], ...CLUSTER_PROVS.map(p=>[p,provinceTH(p)])]}/></label>`}
      <label class="op-lab">${t("Segment ธุรกิจ", "Business segment")}
        <${Dropdown} value=${segSel} onChange=${setSegSel}
          options=${[["All",t("ทุกกลุ่ม", "All segments")], ...SEGMENTS.map(s=>[s,segTH(s)])]}/></label>
      <${QuickRange} db=${db} from=${from} to=${to} setFrom=${setFrom} setTo=${setTo}/>
      <label class="op-lab">${t("ช่วงเวลา (ตั้งแต่)", "Period (from)")}
        <${DateField} className="op-sel" value=${from} onChange=${setFrom}/></label>
      <label class="op-lab">${t("ถึง", "to")}
        <${DateField} className="op-sel" value=${to} onChange=${setTo}/></label>
      ${!isTC && html`<label class="op-lab">TC
        <${Dropdown} value=${tcSel} onChange=${setTcSel}
          options=${[["All",t("ทุกคน", "Everyone")], ...tcList.map(t=>[t,t])]}/></label>`}
      ${((!isTC&&(prov!=="All"||tcSel!=="All"))||(isTC&&distSel!=="All")||segSel!=="All"||from||to) && html`<button class="op-clear" onClick=${()=>{if(!isTC){setProv("All");setTcSel("All");}else{setDistSel("All");}setSegSel("All");setFrom("");setTo("");}}>${t("ล้างตัวกรอง", "Clear filters")}</button>`}
    </div>

    ${exportOpen && html`<${ExportDialog} scope=${exportScope} role=${user.role}
      buildPreviewRows=${opts=>buildReportRows("coverage", {today, k, rankOpp, rankCov, rankGap, rankOppDist, rankGapDist, filters:f}, opts)}
      onClose=${()=>setExportOpen(false)} onExport=${handleExport}/>`}

    ${isTC ? html`
      <!-- TC Dashboard · grid 8/4 (ซ้ายสถิติหลัก · ขวาข้อค้นพบ) -->
      <div class="tcd8">
        <!-- ═══ ฝั่งซ้าย (8) ═══ -->
        <div class="tcd8-left">
          <!-- การ์ดงานเร่งด่วนวันนี้ -->
          <div class="tcd8-urgent">
            <div class="tcd8-urgent-main">
              <div class="tcd8-urgent-ic"><${Icon} name="target" size=${24}/></div>
              <div><div class="tcd8-urgent-k">${t("งานที่ต้องทำวันนี้", "Today's work")}</div>
                <div class="tcd8-urgent-t">${t("Lead ในหมวดที่ยังขาด · ยังไม่ได้เข้าพบ", "Leads in under-served categories · not visited yet")}</div></div>
            </div>
            <div class="tcd8-urgent-r">
              <span class="tcd8-urgent-n"><${CountUp} value=${gapNotVisit}/></span>
            </div>
          </div>

          <!-- โดนัทสัดส่วน | Lead แยกตามอำเภอ -->
          <div class="tcd8-2col">
            <${Card} title=${t("อัตราการเปลี่ยนเป็นลูกค้า", "Conversion rate")} sub=${`${t("สัดส่วนลูกค้าต่อธุรกิจที่รู้จักในพื้นที่ ณ ปัจจุบัน · จากธุรกิจ", "Customers as a share of known businesses in the area right now · out of")} ${num(totBiz)} ${t("แห่ง", "places")}`}>
              ${totBiz ? html`<div style=${{display:"flex",flexDirection:"column",alignItems:"center"}}>
                <${Donut} key=${"tcd-donut-"+animSig} data=${shareDonut} center=${{value:custShare, label:t("เป็นลูกค้าแล้ว", "Now customers"), format:v=>v+"%"}}/>
                <div class="tcd8-ringfoot"><span>${t("เป็นลูกค้าแล้ว", "Now customers")} <b>${num(totExisting)}</b></span><span>${t("ยังเป็น Lead", "Still Leads")} <b>${num(totProspect)}</b></span></div>
              </div>` : html`<div class="emptybox">${t("ยังไม่มีข้อมูลเพียงพอสำหรับแสดงกราฟนี้", "Not enough data to draw this chart yet")}</div>`}
            </${Card}>
            <${Card} title=${t("Lead แยกตามอำเภอ", "Leads by district")} sub=${t("เฉพาะอำเภอในจังหวัดของคุณ · เรียงจากมากไปน้อย", "Only districts in your province · highest first")}>
              ${distAll.length ? html`<div class="tcd8-dbars">
                ${distAll.slice(0,4).map(d=>html`<div key=${d.d} class="tcd8-dbar">
                  <div class="tcd8-dbar-h"><span class="tcd8-dbar-l">${districtTH(d.d)}</span><span class="tcd8-dbar-v">${num(d.ps)} ${t("ราย", "businesses")}</span></div>
                  <div class="tcd8-dbar-track"><div class="tcd8-dbar-fill" style=${{width:(d.ps/distLeadMax*100)+"%"}}></div></div>
                </div>`)}
              </div>` : html`<div class="emptybox">${t("ยังไม่มีข้อมูลเพียงพอสำหรับแสดงกราฟนี้", "Not enough data to draw this chart yet")}</div>`}
            </${Card}>
          </div>

          <!-- เทียบลูกค้า vs Lead รายหมวด ครบ 12 หมวด — แท่งคู่ต่อหนึ่งหมวด -->
          <${Card} title=${t("ลูกค้า เทียบ Lead รายหมวดธุรกิจ", "Customers vs. Leads by business category")}
            sub=${`${t("ทั้ง", "All")} ${SEGMENTS.length} ${t("หมวดในพื้นที่รับผิดชอบ · เรียงจากจำนวนรวมมากไปน้อย", "categories in your territory · sorted by total, highest first")}`}
            right=${html`<div class="sc-legend">
              <span class="sc-lg"><i class="sc-sw cust"></i>${t("ลูกค้า", "Customers")}</span>
              <span class="sc-lg"><i class="sc-sw lead"></i>Lead</span></div>`}>
            <div class="sc-scroll">
              <svg class="sc-svg" width=${SC_W} height=${SC_H} viewBox=${"0 0 "+SC_W+" "+SC_H}
                role="img" aria-label=${t("กราฟแท่งเทียบจำนวนลูกค้ากับ Lead รายหมวดธุรกิจ", "Bar chart comparing customers with Leads by business category")}>
                <!-- เส้นกริดแนวนอน + ตัวเลขแกน Y -->
                ${scTicks.map(t=>html`<g key=${"t"+t}>
                  <line x1=${SC_PL} y1=${scY(t)} x2=${SC_W-SC_PR} y2=${scY(t)} class=${t===0?"sc-axis":"sc-grid"}/>
                  <text x=${SC_PL-10} y=${scY(t)+4} class="sc-ytx">${num(t)}</text>
                </g>`)}
                ${segCompare.map((r,i)=>{
                  const cx = SC_PL + i*SC_GW + SC_GW/2;          // กึ่งกลางกลุ่ม
                  const bw = 24, gap = 6;
                  const xc = cx - bw - gap/2, xl = cx + gap/2;   // แท่งลูกค้า / แท่ง Lead
                  const hc = Math.max(r.cust?2:0, (r.cust/scYMax)*SC_PLOT);
                  const hl = Math.max(r.lead?2:0, (r.lead/scYMax)*SC_PLOT);
                  const base = SC_TOP + SC_PLOT;
                  const short = r.label.length>15 ? r.label.slice(0,15)+"…" : r.label;
                  return html`<g key=${r.sg}>
                    <rect x=${xc} y=${base-hc} width=${bw} height=${hc} rx="3" class="sc-col cust"/>
                    <rect x=${xl} y=${base-hl} width=${bw} height=${hl} rx="3" class="sc-col lead"/>
                    ${r.cust?html`<text x=${xc+bw/2} y=${base-hc-6} class="sc-nv">${num(r.cust)}</text>`:""}
                    ${r.lead?html`<text x=${xl+bw/2} y=${base-hl-6} class="sc-nv">${num(r.lead)}</text>`:""}
                    <text class="sc-xtx" transform=${"rotate(-40 "+cx+" "+(base+16)+")"} x=${cx} y=${base+16}>${short}</text>
                    <title>${r.label} ${t("· ลูกค้า", "· customers")} ${num(r.cust)} · Lead ${num(r.lead)}</title>
                  </g>`;
                })}
              </svg>
            </div>
          </${Card}>

          <!-- ตาราง "รายชื่อที่ควรไปต่อ" ถูกถอดออกจากแดชบอร์ด TC ตามที่ผู้ใช้กำหนด -->
        </div>

        <!-- ═══ ฝั่งขวา (4) ═══ -->
        <div class="tcd8-right">
          <${Card} title=${t("สิ่งที่พบจากข้อมูล", "What the data shows")}>
            <div class="tcd8-ins">
              ${tcInsights.map((a,i)=>html`<div key=${i} class=${"tcd8-ins-card "+a.tone}>
                <div class="tcd8-ins-h"><${Icon} name=${a.icon} size=${15} color=${tcInsTone(a.tone)}/><span>${a.title}</span></div>
                <div class="tcd8-ins-b">${a.body}</div>
              </div>`)}
            </div>
          </${Card}>

          <${Card} title=${t("หมวดธุรกิจที่เติบโตและชะลอตัว", "Growing and slowing categories")} sub=${t("ลูกค้าใหม่ 90 วันล่าสุด เทียบ 90 วันก่อนหน้า", "New customers in the last 90 days vs. the 90 before")}>
            <div class="tcd8-grow">
              <div class="tcd8-grow-box up">
                <div class="tcd8-grow-h up">${t("เติบโต", "Growing")}</div>
                ${tcGainers.length ? tcGainers.map(g=>html`<div key=${g.s} class="tcd8-grow-row"><span class="tcd8-grow-l">${g.label}</span><span class="tcd8-grow-n up">+${num(g.delta)}</span></div>`)
                  : html`<div class="dim" style=${{fontSize:"11.5px",padding:"6px 0"}}>${t("ยังไม่มีหมวดที่เติบโต", "No category is growing yet")}</div>`}
              </div>
              <div class="tcd8-grow-box down">
                <div class="tcd8-grow-h down">${t("ชะลอตัว", "is slowing")}</div>
                ${tcLosers.length ? tcLosers.map(g=>html`<div key=${g.s} class="tcd8-grow-row"><span class="tcd8-grow-l">${g.label}</span><span class="tcd8-grow-n down">${num(g.delta)}</span></div>`)
                  : html`<div class="dim" style=${{fontSize:"11.5px",padding:"6px 0"}}>${t("ไม่มีหมวดที่ลดลง", "No category is declining")}</div>`}
              </div>
            </div>
          </${Card}>
        </div>
      </div>
    ` : html`
    <!-- ═════ Section 1: Executive KPI 4 การ์ด (ลูกค้าปัจจุบัน · Lead · Coverage Rate · Gap) ═════ -->
    <div class="grid g4" style=${{marginBottom:"16px"}}>
      <div class="rp-kpi" style=${cardSt}>
        <div style=${capSt}><${Icon} name="users" size=${15} color="var(--accent)"/>${t("ลูกค้าปัจจุบัน (Existing)", "Existing customers ")}${infoDot(t("ลูกค้าปัจจุบัน (Existing)", "Existing customers"),t("นับจากระเบียนที่สถานะ = ลูกค้าปัจจุบัน ภายในจังหวัด/Segment/ช่วงเวลาที่เลือก · อ้างอิงฐานข้อมูลลูกค้าที่นำเข้าระบบ · อัปเดตล่าสุด ", "Counted from records with status = existing customer, within the selected province / segment / period · based on the imported customer database · last updated ")+today)}</div>
        <div style=${bigSt}><${CountUp} value=${totExisting}/></div>
        <div class="dim" style=${{fontSize:"11.5px"}}>${t("จำนวนลูกค้าที่ปิดการขายแล้วในขอบเขตที่กรอง", "Customers already closed within the filtered scope")}</div>
        ${deltaBadge(custDelta)}
      </div>
      <div class="rp-kpi" style=${cardSt}>
        <div style=${capSt}><${Icon} name="target" size=${15} color=${STATUS_COLOR.Prospect}/>Lead (Prospects)${infoDot("Lead (Prospects)",t("นับจากระเบียนที่สถานะ = Lead — ธุรกิจที่ยังไม่อยู่ในเครือข่าย Barter · เป็นฝั่งอุปสงค์ที่ใช้คำนวณ Lead สูง", "Counted from records with status = Lead — businesses not yet in the Barter network · they form the demand side of the Lead index"))}</div>
        <div style=${bigSt}><${CountUp} value=${totProspect}/></div>
        <div class="dim" style=${{fontSize:"11.5px"}}>${t("Leadที่ยังไม่ปิดการขายในขอบเขตที่กรอง", "Leads not yet closed within the filtered scope")}</div>
        ${deltaBadge(prosDelta)}
      </div>
      <div class="rp-kpi" style=${cardSt}>
        <div style=${capSt}><${Icon} name="coverage" size=${15} color="#33d69f"/>Coverage Rate${infoDot("Coverage Rate",t("สูตร: ลูกค้าปัจจุบัน ÷ (ลูกค้าปัจจุบัน + Lead) × 100 · เป้าหมายองค์กร ", "Formula: existing customers ÷ (existing customers + Leads) × 100 · company target ")+REPORT_COV_TARGET+t("% · ตอนนี้ต่ำกว่าเป้า ", "% · currently below target by ")+covGap+t(" จุด", " points"))}</div>
        <div style=${bigSt}><${CountUp} value=${coverage} fmt=${v=>v+"%"}/> <span style=${{fontSize:"13px",fontWeight:600,color:coverage>=REPORT_COV_TARGET?"#33d69f":"var(--muted)"}}>${t("(เป้า", "(target")} ${REPORT_COV_TARGET}%)</span></div>
        <div class="sd-target"><div class="sd-target-f" style=${{width:Math.min(100,coverage)+"%",background:covColor(coverage)}}></div>
          <div class="sd-target-goal" style=${{left:REPORT_COV_TARGET+"%"}}></div></div>
        <div class="dim" style=${{fontSize:"11.5px"}}>${coverage}${t("% · เป้า", "% · target")} ${REPORT_COV_TARGET}${t("% · ขาดอีก", "% · short by")} <b style=${{color:"var(--txt)"}}>${covGap} ${t("จุด", "points")}</b></div>
      </div>
      <div class="rp-kpi" style=${{...cardSt,cursor:"pointer"}} title=${t("คลิกเพื่อไปที่ตารางสรุปรายโซน", "Click to jump to the zone summary table")}
        onClick=${()=>{ setGapHi(true); tableRef.current&&tableRef.current.scrollIntoView({behavior:"smooth",block:"center"}); setTimeout(()=>setGapHi(false),2200); }}>
        <div style=${capSt}><${Icon} name="gap" size=${15} color="#ff5a3c"/>Gap Identification${infoDot("Gap Identification",t("โซนที่ Coverage ต่ำกว่าเกณฑ์ แต่มีLeadหนาแน่น (Heat Score ≥ 40) — คือพื้นที่ที่ควรขยายก่อน · คลิกการ์ดเพื่อไปที่ตารางสรุปรายโซน", "Zones below the coverage threshold but dense with Leads (heat score ≥ 40) — expand into these first · click the card to jump to the zone summary table"))}</div>
        <div style=${bigSt}><${CountUp} value=${gapZones}/></div>
        <div class="dim" style=${{fontSize:"11.5px"}}>${t("โซนที่มีช่องว่างโอกาสสูง จาก", "zones with a large opportunity gap, out of")} ${num(clusters.length)} ${t("โซน ·", "zones ·")} <span style=${{color:"var(--accent)",fontWeight:700}}>${t("ดูในตาราง ↓", "see the table ↓")}</span></div>
      </div>
    </div>

    <!-- ═════ Section 2 · แถวที่ 1: แผนที่ (70%) + กราฟโดนัท Segment ธุรกิจ (30%) ═════ -->
    <div class="rp-map-row" style=${{marginBottom:"16px"}}>
      <${Card} title=${t("แผนที่ภูมิสารสนเทศ", "Geospatial map")} sub=${t("มุมมองสรุปหลายจังหวัด (แสดงผลอย่างเดียว) · สลับ 3 มุมมอง", "Multi-province summary view (display only) · three views to switch between")}>
        <div class="sd-views">
          ${MAP_VIEWS.map(v=>html`<button key=${v.id} class=${"sd-view"+(mapView===v.id?" on":"")} onClick=${()=>setMapView(v.id)}>
            ${v.lb}</button>`)}
        </div>
        <!-- Legend ตาม Template: Heat Score 80-100(แดง) / 40-79(เหลือง) / 0-39(เขียว) / ขอบเขต Territory -->
        <div class="as-vlegend2">
          <span><span class="as-vdot2" style=${{background:"#d81e1e"}}></span>Heat Score 80-100</span>
          <span><span class="as-vdot2" style=${{background:"#ffc233"}}></span>40-79</span>
          <span><span class="as-vdot2" style=${{background:"#26e07a"}}></span>0-39</span>
          <span><span class="as-vdot2" style=${{background:"transparent",border:"2px solid #2563eb"}}></span>${t("ขอบเขต Territory", "Territory boundaries")}</span>
          ${mapView==="territory" ? html`<span><span class="as-vdot2" style=${{background:"#ff2d55"}}></span>${t("พื้นที่ทับซ้อน (", "Overlapping areas (")}${num((territories&&territories.overlaps||[]).length)} ${t("จุด)", "points)")}</span>` : ""}
        </div>
        <div class="geo-map">
          <${LeafletMap} db=${vdb} filters=${mapFilters} layers=${mapLayers} country="Thailand"
            clusters=${mapView==="cluster"?clusters:[]} territories=${territories}
            onPickArea=${()=>{}} onPickCustomer=${()=>{}}/>
        </div>
        ${mapView==="cluster" && clusters.length ? html`<div class="geo-clegend">
          ${clusters.map(c=>html`<span key=${c.province+c.code} class="geo-cl"><span class="geo-cdot" style=${{background:c.color}}>${c.code}</span>${clusterName(c)}</span>`)}
        </div>` : ""}
      </${Card}>
      <div class="rp-right-col">
        <${Card} title=${t("การกระจายกลุ่มธุรกิจ", "Business segment mix")} sub=${segSel==="All"?t("สัดส่วนตามกลุ่มธุรกิจในขอบเขตที่กรอง", "Share by business segment within the filtered scope"):t("ไฮไลต์กลุ่ม ", "Highlighting ")+segTH(segSel)+t(" ตามตัวกรอง", " from the filter")}>
          ${segTotals.length ? html`<${Donut} key=${"donut-"+animSig} data=${segTotals} center=${{value:segCenterVal, label:segSel==="All"?t("รายการ", "records"):segTH(segSel), format:num}}/>`
                             : html`<div class="emptybox">${t("ไม่มีข้อมูลตามตัวกรองที่เลือก", "No data matches the current filters")}</div>`}
        </${Card}>
        <!-- ย้ายมาจาก Section 3 · เปลี่ยนจากแถบความคืบหน้าเป็น Bar Chart · นับฐานLeadทั้งประเทศ ตาม Global Filter -->
        <${Card} title=${t("หมวดธุรกิจที่เครือข่ายยังขาด", "Categories the network is short of")} sub=${t("5 หมวดที่มี Lead มากที่สุด (Lead − สมาชิกปัจจุบัน)", "The 5 categories with the highest Lead demand (Leads − current members)")+(prov==="All"?t(" · ทุกจังหวัด", " · all provinces"):" · "+provinceTH(prov))}>
          ${gapTotal ? html`<div>
            <${BarChart} data=${gradeBars} height=${150} horizontal=${true} format=${(v)=>num(v)}
              tipTitle=${d=>d.label} tipRows=${d=>[
                {label:t("ยังขาด", "still short"),value:num(d.value)+t(" ราย", " businesses")},
                {label:t("อุปสงค์ (Lead)", "Demand (Leads)"),value:num(d.demand)+t(" ราย", " businesses")},
                {label:t("สมาชิกเครือข่ายแล้ว", "Already members"),value:num(d.supply)+t(" ราย", " businesses")},
                {label:t("สัดส่วนของช่องว่างทั้งหมด", "Share of the total gap"),value:(gapTotal?Math.round(d.value/gapTotal*100):0)+"%"}]}/>
            <div class="rp-grade-sum">${t("ยังขาดรวม", "Short by")} <b><${CountUp} value=${gapTotal}/></b> ${t("ราย · ดัชนีช่องว่าง", "in total · gap index")} <b>${gapScope.gapScore}</b>/100 (${gapTH(gapScope.gapLevel)})</div>
          </div>` : html`<div class="emptybox">${t("ไม่มีข้อมูลตามตัวกรองที่เลือก", "No data matches the current filters")}</div>`}
        </${Card}>
      </div>
    </div>

    <!-- ═════ Section 2 · แถวที่ 2: แนวโน้มการเติบโต (เต็มความกว้าง) — ย้ายมาจาก Section 3 ═════ -->
    <${Card} title=${t("แนวโน้มการเติบโตของฐานข้อมูล", "Database growth trend")} sub=${t("ยอดสะสม ลูกค้า+Lead ตาม created_at", "Cumulative customers + Leads by created_at")+(months.length?" · "+monLabel(months[0])+"–"+monLabel(months[months.length-1]):"")} style=${{marginBottom:"16px"}}>
      ${months.length>=2 ? html`<div>
        <div class="rp-gt-legend">
          <span><i style=${{background:STATUS_COLOR.Existing}}></i>${t("ลูกค้าปัจจุบัน", "Existing customers")} <b><${CountUp} value=${cumCust[cumCust.length-1]||0}/></b></span>
          <span><i style=${{background:STATUS_COLOR.Prospect}}></i>Lead <b><${CountUp} value=${cumPros[cumPros.length-1]||0}/></b></span>
        </div>
        <${LineChart} key=${"line-"+animSig} labels=${months.map(monLabel)} series=${[
          {label:t("ลูกค้าปัจจุบัน", "Existing customers"), color:STATUS_COLOR.Existing, points:cumCust},
          {label:"Lead",   color:STATUS_COLOR.Prospect, points:cumPros}
        ]} height=${210} format=${num}/>
        <div class="row between" style=${{fontSize:"11.5px",marginTop:"4px"}}>
          <span class="dim">${monLabel(months[0])}</span>
          <span style=${{fontWeight:700}}>${t("ยอดสะสมรวม", "Cumulative total")} <${CountUp} value=${cumLast}/> ${t("รายการ", "records")}</span>
          <span class="dim">${monLabel(months[months.length-1])}</span>
        </div></div>` : html`<div class="emptybox">${t("ข้อมูลไม่พอสร้างกราฟแนวโน้ม", "Not enough data to draw a trend")}</div>`}
    </${Card}>

    <!-- ═════ Section 3: 2 คอลัมน์ — ซ้าย: อันดับพื้นที่ & หมวดที่ขาด · ขวา: เปรียบเทียบจังหวัด (เต็มคอลัมน์) ═════ -->
    <div class="geo-2col" style=${{marginBottom:"16px"}}>
      <${Card} title=${t("อันดับพื้นที่โอกาสสูงสุด (5 อันดับ)", "Top 5 opportunity areas")} sub=${t("อำเภอที่มีคะแนนโอกาส (Heat Ranking Score) สูงสุด · คะแนนเท่ากันเรียงตามจำนวนLead", "Districts with the highest heat ranking score · ties are broken by Lead count")}>
        ${topAreas.length ? topAreas.map((d,i)=>{const tipRows=[{label:t("ดัชนี Lead", "Lead index"),value:num(d.gapScore)},{label:t("ยังขาด (ราย)", "Still short"),value:num(d.gapCount)},{label:t("ลูกค้าในพื้นที่", "Customers in the area"),value:num(d.customerCount)},{label:t("Leadในพื้นที่", "Leads in the area"),value:num(d.prospectCount)}];
          return html`<div key=${d.province+d.district} class="sd-top-row" style=${{cursor:"pointer"}}
          onMouseMove=${e=>showTip(e, districtTH(d.district)+" · "+provinceTH(d.province), tipRows)} onMouseLeave=${hideTip}
          ontouchstart=${e=>showTip(e, districtTH(d.district)+" · "+provinceTH(d.province), tipRows)}>
          <span class=${"sd-top-rank"+(i<3?" medal m"+(i+1):"")}>${i+1}</span>
          <div style=${{flex:1,minWidth:0}}><b style=${{fontSize:"13.5px"}}>${districtTH(d.district)}</b>
            <span class="dim" style=${{fontSize:"12px"}}> · ${provinceTH(d.province)}</span></div>
          <${Badge} tone=${d.gapScore>=67?"bad":d.gapScore>=34?"warn":"info"}>${t("ดัชนี", "Index")} ${d.gapScore}</${Badge}>
        </div>`;}) : html`<div class="dim" style=${{fontSize:"12px"}}>${t("ไม่มีข้อมูลพื้นที่ในขอบเขตที่เลือก", "No area data within the selected scope")}</div>`}
      </${Card}>
      <${Card} title=${t("เปรียบเทียบรายจังหวัด (ลูกค้า vs เป้าหมาย Coverage)", "Province comparison (customers vs. coverage target)")} sub=${t("เกณฑ์เทียบ 4 จังหวัดหลัก · เรียงครอบคลุมมาก→น้อย", "Benchmark across the 4 main provinces · sorted by coverage, highest first")+(prov!=="All"?t(" · ไฮไลต์ ", " · highlighting ")+provinceTH(prov):"")}>
        <div class="sd-cmp">
          ${cmpSorted.map(m=>{const cmpTip=[{label:t("ลูกค้า", "Customers"),value:num(m.s.customerCount)},{label:"Lead",value:num(m.s.prospectCount)},{label:"Coverage",value:m.s.coverage+"%"},{label:t("เป้าหมาย", "Target"),value:REPORT_COV_TARGET+"%"},{label:t("ต่ำกว่าเป้า", "below target"),value:Math.max(0,REPORT_COV_TARGET-m.s.coverage)+t(" จุด", " points")}];
            return html`<div key=${m.province} class=${"sd-cmp-row"+(prov!=="All"&&m.province===prov?" on":"")} style=${{cursor:"pointer"}}
            onMouseMove=${e=>showTip(e, provinceTH(m.province), cmpTip)} onMouseLeave=${hideTip} ontouchstart=${e=>showTip(e, provinceTH(m.province), cmpTip)}>
            <div class="sd-cmp-top"><b>${provinceTH(m.province)}</b><span style=${{color:covColor(m.s.coverage),fontWeight:700}}>${m.s.coverage}% <span class="dim" style=${{fontWeight:400}}>${t("/ เป้า", "/ target")} ${REPORT_COV_TARGET}%</span></span></div>
            <div class="sd-cmp-bar"><div class="sd-cmp-fill" style=${{width:Math.min(100,m.s.coverage)+"%",background:covColor(m.s.coverage)}}></div>
              <div class="sd-cmp-goal" style=${{left:REPORT_COV_TARGET+"%"}}></div></div>
            <div class="dim" style=${{fontSize:"11.5px"}}>${t("ลูกค้า", "Customers")} ${num(m.s.customerCount)} · Lead ${num(m.s.prospectCount)} ${t("· ช่องว่าง", "· gap")} ${m.s.gapScore}</div>
          </div>`;})}
        </div>
      </${Card}>
    </div>

    <!-- ═════ Section 4: ตารางสรุปเชิงปฏิบัติ (คอลัมน์ตาม Template) — แบ่งหน้า 5 แถว ═════ -->
    <div ref=${tableRef} class=${gapHi?"rp-table-hi":""} style=${{borderRadius:"var(--r)",marginBottom:"16px"}}>
    <${Card} title=${t("ตารางสรุปเชิงปฏิบัติรายโซน", "Actionable zone summary")} sub=${t("โซน · ลูกค้า · Lead · ดัชนี Lead · ระดับช่องว่าง · สถานะ Territory/Coverage · Action", "Zone · customers · Leads · Lead index · gap level · territory/coverage status · action")} pad0=${true}>
      ${zoneRows.length ? html`<${Table} cols=${[
        {h:t("โซน/พื้นที่", "Zone / area"), render:c=>html`<div class="row" style=${{gap:"8px"}}><span class="geo-cdot sm" style=${{background:c.color}}>${c.code}</span>
          <div><b>${clusterName(c)}</b><div class="dim" style=${{fontSize:"11px"}}>${provinceTH(c.province)}</div></div></div>`},
        {h:t("ลูกค้า", "Customers"), render:c=>html`<b>${num(c.existing)}</b>`},
        {h:"Lead", render:c=>html`<b style=${{color:STATUS_COLOR.Prospect}}>${num(c.prospect)}</b>`},
        {h:t("ดัชนีช่องว่าง", "Gap index"), render:c=>html`<${Badge} tone=${c.gapScore>=67?"bad":c.gapScore>=34?"warn":"good"}>${c.gapScore}</${Badge}>`},
        {h:t("ระดับช่องว่าง", "Gap level"), render:c=>html`<b style=${{fontSize:"13px",color:c.gapLv==="High"?"#c81e1e":c.gapLv==="Medium"?"#b45309":"#0f7a3d"}}>${gapTH(c.gapLv)}</b>`},
        {h:t("สถานะ Territory/Coverage", "Territory / coverage status"), render:c=>html`<div style=${{minWidth:"160px"}}>
          <div style=${{fontSize:"11.5px",marginBottom:"3px"}}>${c.domTC}</div>
          <div style=${{fontSize:"12px"}}><b>${c.coverage.toFixed(0)}%</b> · <${Badge} tone=${c.gapLevel==="High"?"bad":c.gapLevel==="Medium"?"warn":"good"}>${t("ขาด", "Short")} ${num(c.gapCount)} ${t("ราย", "businesses")}</${Badge}></div></div>`},
        {h:"Action Suggested", render:c=>html`<span style=${{fontSize:"12px"}}>${expansionGuidance(c.priority, c.topSegment, c.coverage)}</span>`},
      ]} rows=${pageRows}/>` : html`<div class="emptybox" style=${{margin:"18px"}}>${t("ไม่มีข้อมูลโซนในพื้นที่ที่เลือก", "No zone data in the selected area")}</div>`}
      ${zoneRows.length>PAGE_SIZE && html`<div class="rp-pager">
        <span class="rp-pager-sum">${t("แสดง", "Showing")} ${pageStart}–${pageEnd} ${t("จาก", "of")} ${num(zoneRows.length)} ${t("โซน", "Zone")}</span>
        <div class="rp-pager-ctrl">
          <button class="rp-pg" disabled=${curPage<=1} onClick=${()=>setTablePage(p=>Math.max(1,p-1))}>‹</button>
          ${pageList.map((p,i)=> p==="…"
            ? html`<span key=${"e"+i} class="rp-pg-gap">…</span>`
            : html`<button key=${p} class=${"rp-pg"+(p===curPage?" on":"")} onClick=${()=>setTablePage(p)}>${p}</button>`)}
          <button class="rp-pg" disabled=${curPage>=totalPages} onClick=${()=>setTablePage(p=>Math.min(totalPages,p+1))}>›</button>
        </div>
      </div>`}
    </${Card}>
    </div>
    `}

    <style>${GEO_CSS}${REPORT_SD_CSS}${TC_CSS}</style>
    <style>@media print{
      .sidebar,.topbar,.page-head,.sd-views,.export-btn{display:none!important}
      .shell{grid-template-columns:1fr!important}
      .page{overflow:visible!important;padding:0!important}
      body{overflow:visible!important}
    }</style>
  </div>`;
}
const TC_CSS = `
/* ── TC Dashboard (ออกแบบใหม่) ── */
.tcd-tasks{display:flex;flex-direction:column;gap:9px}
.tcd-task{display:flex;align-items:center;gap:12px;width:100%;padding:12px 14px;border-radius:12px;border:1px solid var(--stroke2);
  background:var(--surface);cursor:pointer;font-family:var(--font);text-align:left;transition:.15s}
.tcd-task:hover{border-color:var(--accent);background:var(--accent-soft)}
.tcd-task-ic{width:38px;height:38px;border-radius:11px;display:grid;place-items:center;flex:none;color:#fff}
.tcd-task-ic.bad{background:var(--accent)}.tcd-task-ic.warn{background:#f0a022}.tcd-task-ic.info{background:#2f7fe0}.tcd-task-ic.good{background:#33d69f}
.tcd-task-l{flex:1;min-width:0;font-size:13.5px;font-weight:600;color:var(--txt)}
.tcd-task-c{font-size:20px;font-weight:800;color:var(--txt);min-width:44px;text-align:right}
.tcd-empty{display:flex;align-items:center;gap:13px;padding:16px;border-radius:12px;background:var(--surface2);border:1px solid var(--stroke2)}
.tcd-row3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
@media(max-width:1000px){.tcd-row3{grid-template-columns:1fr}}
.tcd-bars,.tcd-funnel{display:flex;flex-direction:column;gap:12px;padding-top:4px}
.tcd-sbar-h,.tcd-frow-h{display:flex;justify-content:space-between;align-items:baseline;font-size:12.5px;margin-bottom:4px}
.tcd-sbar-h b,.tcd-frow-h b{font-size:13.5px;color:var(--txt)}
.tcd-sbar-track{display:flex;height:8px;border-radius:999px;overflow:hidden;background:var(--surface2)}
.tcd-sbar-f{height:100%}
.tcd-ftrack{height:8px;border-radius:999px;background:var(--surface2);overflow:hidden}
.tcd-ffill{height:100%;border-radius:999px;background:linear-gradient(90deg,var(--accent-deep),var(--accent));transition:width .5s}
.tcd-tbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid var(--stroke)}
.tcd-gchip{padding:5px 13px;border-radius:999px;border:1px solid var(--stroke2);background:var(--surface);color:var(--muted);
  font-family:var(--font);font-size:12.5px;font-weight:600;cursor:pointer;transition:.15s}
.tcd-gchip:hover{border-color:var(--accent)}
.tcd-gchip.on{background:var(--accent);border-color:var(--accent);color:#fff}
/* ───────── TC Dashboard · โครง 8/4 ───────── */
.tcd8{display:grid;grid-template-columns:repeat(12,1fr);gap:24px;align-items:start}
.tcd8-left{grid-column:span 8}.tcd8-right{grid-column:span 4}
.tcd8-left,.tcd8-right{display:flex;flex-direction:column;gap:24px}
@media(max-width:1023px){.tcd8-left,.tcd8-right{grid-column:1/-1}}
/* การ์ดงานเร่งด่วน */
.tcd8-urgent{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 20px;border-radius:18px;
  background:linear-gradient(90deg,var(--accent-soft),var(--surface));border:1px solid var(--accent-soft)}
.tcd8-urgent-main{display:flex;align-items:center;gap:14px;min-width:0}
.tcd8-urgent-ic{width:48px;height:48px;border-radius:13px;background:var(--accent);color:#fff;display:grid;place-items:center;flex:none}
.tcd8-urgent-k{font-size:11.5px;font-weight:700;color:var(--accent-deep);text-transform:uppercase;letter-spacing:.4px}
.tcd8-urgent-t{font-size:15px;font-weight:800;color:var(--txt);margin-top:2px}
.tcd8-urgent-r{display:flex;align-items:center;gap:12px;flex:none}
.tcd8-urgent-n{font-size:30px;font-weight:800;color:var(--accent-deep);line-height:1}
.tcd8-chev{width:38px;height:38px;border-radius:10px;border:1px solid var(--stroke2);background:var(--surface);color:var(--txt);
  display:grid;place-items:center;cursor:pointer;transition:.15s}
.tcd8-chev:hover{border-color:var(--accent);background:var(--accent-soft)}
.tcd8-2col{display:grid;grid-template-columns:1fr 1fr;gap:24px}
@media(max-width:700px){.tcd8-2col{grid-template-columns:1fr}}
.tcd8-ringfoot{display:flex;justify-content:space-between;gap:12px;width:100%;margin-top:10px;padding-top:10px;border-top:1px solid var(--stroke);font-size:12px;color:var(--muted)}
.tcd8-ringfoot b{color:var(--txt)}
/* แท่ง Lead รายอำเภอ */
/* ── กราฟแท่งคู่: ลูกค้า vs Lead รายหมวด (แดชบอร์ด TC) ── */
.sc-scroll{overflow-x:auto;padding-bottom:2px}
.sc-svg{display:block;font-family:var(--font)}
.sc-grid{stroke:var(--stroke);stroke-width:1;stroke-dasharray:3 4}
.sc-axis{stroke:var(--stroke2);stroke-width:1.4}
.sc-ytx{fill:var(--dim);font-size:11px;text-anchor:end;font-variant-numeric:tabular-nums}
.sc-xtx{fill:var(--muted);font-size:11.5px;text-anchor:end}
.sc-nv{fill:var(--muted);font-size:10.5px;font-weight:700;text-anchor:middle;font-variant-numeric:tabular-nums}
.sc-col.cust{fill:#15a34a}
.sc-col.lead{fill:#e60023}
.sc-legend{display:flex;gap:14px;align-items:center;font-size:12px;color:var(--muted)}
.sc-lg{display:inline-flex;align-items:center;gap:6px}
.sc-sw{width:11px;height:11px;border-radius:3px;display:inline-block}
.sc-sw.cust{background:#15a34a}
.sc-sw.lead{background:#e60023}
@media(max-width:720px){.sc-row{grid-template-columns:118px 1fr;gap:9px}.sc-name{font-size:11.5px}}
.tcd8-dbars{display:flex;flex-direction:column;gap:13px}
.tcd8-dbar-h{display:flex;justify-content:space-between;align-items:baseline;font-size:12.5px;margin-bottom:5px}
.tcd8-dbar-l{font-weight:600;color:var(--txt)}
.tcd8-dbar-v{color:var(--muted)}
.tcd8-dbar-track{height:8px;border-radius:999px;background:var(--surface2);overflow:hidden}
.tcd8-dbar-fill{height:100%;border-radius:999px;background:var(--accent);transition:width .5s}
/* แท็บเลือกขอบเขตในหัวตาราง */
.tcd8-tabs{display:flex;gap:3px;background:var(--surface2);padding:3px;border-radius:9px}
.tcd8-tab{padding:5px 12px;border-radius:7px;border:none;background:transparent;color:var(--muted);font-family:var(--font);font-size:12px;font-weight:600;cursor:pointer}
.tcd8-tab.on{background:var(--surface);color:var(--accent-deep);box-shadow:0 1px 3px rgba(0,0,0,.08)}
.tc-table .rt{text-align:right}
.tcd8-score{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:7px;background:rgba(51,214,159,.14);color:#0f7a3d;font-weight:700}
/* ข้อค้นพบ (การ์ดสีตามประเภท) */
.tcd8-ins{display:flex;flex-direction:column;gap:12px}
.tcd8-ins-card{border-radius:12px;padding:12px 13px;border:1px solid var(--stroke2)}
.tcd8-ins-card.bad{background:rgba(230, 0, 35,.07);border-color:rgba(230, 0, 35,.18)}
.tcd8-ins-card.warn{background:rgba(240,160,34,.1);border-color:rgba(240,160,34,.22)}
.tcd8-ins-card.good{background:rgba(51,214,159,.1);border-color:rgba(51,214,159,.22)}
.tcd8-ins-h{display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:800;color:var(--txt)}
.tcd8-ins-b{font-size:11.5px;color:var(--muted);line-height:1.5;margin-top:5px}
/* เติบโต/ชะลอตัว */
.tcd8-grow{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.tcd8-grow-box{border-radius:12px;padding:11px 12px;border:1px solid var(--stroke2)}
.tcd8-grow-box.up{background:rgba(51,214,159,.06)}.tcd8-grow-box.down{background:rgba(230, 0, 35,.05)}
.tcd8-grow-h{font-size:12px;font-weight:800;margin-bottom:7px}
.tcd8-grow-h.up{color:#0f7a3d}.tcd8-grow-h.down{color:#b30019}
.tcd8-grow-row{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:11.5px;padding:4px 0}
.tcd8-grow-l{color:var(--txt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tcd8-grow-n{font-weight:800}.tcd8-grow-n.up{color:#0f7a3d}.tcd8-grow-n.down{color:#b30019}
.tc-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:16px}
@media(max-width:1100px){.tc-kpis{grid-template-columns:repeat(2,1fr)}}
@media(max-width:560px){.tc-kpis{grid-template-columns:1fr}}
.tc-actions{display:flex;flex-direction:column;gap:9px}
.tc-act{display:flex;align-items:center;gap:12px;padding:11px 13px;border-radius:12px;border:1px solid var(--stroke);background:var(--surface)}
.tc-act-ic{flex:none;width:36px;height:36px;border-radius:10px;display:grid;place-items:center;color:#fff}
.tc-act-ic.bad{background:#ff5a3c}.tc-act-ic.warn{background:#ffb02e}.tc-act-ic.good{background:#33d69f}.tc-act-ic.info{background:#38bdf8}
.tc-act-t{font-size:13px;font-weight:700;color:var(--txt)}
.tc-act-d{font-size:11.5px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tc-chips{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px}
.tc-chip{padding:10px;border-radius:10px;background:var(--surface2);text-align:center}
.tc-chip-k{font-size:10.5px;color:var(--muted);line-height:1.3}
.tc-chip-v{font-size:18px;font-weight:800;margin-top:3px}
.tc-rank-h{font-size:12px;font-weight:700;color:var(--muted);margin:4px 0 4px}
.tc-rank{display:flex;align-items:center;gap:9px;padding:7px 0;font-size:12.5px;border-top:1px solid var(--stroke)}
.tc-rank-n{flex:none;width:20px;height:20px;border-radius:6px;display:grid;place-items:center;font-size:11px;font-weight:800;background:var(--accent-soft);color:var(--accent-deep,#b30019)}
.tc-table-wrap{overflow-x:auto}
.tc-table{width:100%;border-collapse:collapse;font-size:12.5px}
.tc-table th{text-align:left;padding:10px 12px;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;border-bottom:1px solid var(--stroke);white-space:nowrap}
.tc-table td{padding:10px 12px;border-bottom:1px solid var(--stroke);vertical-align:middle}
.tc-table tbody tr:last-child td{border-bottom:none}
.tc-table tbody tr:hover{background:var(--surface2)}
.tc-addbtn{display:inline-flex;align-items:center;gap:5px;font-family:var(--font);font-size:12px;font-weight:700;cursor:pointer;
  color:#fff;background:linear-gradient(135deg,#ff3b5c,#e60023);border:none;border-radius:9px;padding:7px 11px;white-space:nowrap}
.tc-addbtn:hover{box-shadow:0 4px 12px rgba(255,122,168,.4)}
.tc-inplan{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;color:#0f7a3d;white-space:nowrap}
.tc-distcov{display:flex;flex-direction:column;gap:13px}
.tc-distrow-h{display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:5px}
`;
const REPORT_SD_CSS = `
/* Section 2 แถวที่ 1: แผนที่ 70% + โดนัท 30% (ใช้ 7fr/3fr เพื่อให้ gap ไม่ทำให้ล้น) · จอแคบสลับเป็นซ้อนแนวตั้ง */
.rp-map-row{display:grid;grid-template-columns:7fr 3fr;gap:16px;align-items:start}
@media(max-width:900px){.rp-map-row{grid-template-columns:1fr}}
.rp-right-col{display:flex;flex-direction:column;gap:16px;min-width:0}
/* micro-interaction: การ์ด KPI ยกตัวเล็กน้อยเมื่อ hover */
.rp-kpi{transition:transform .22s cubic-bezier(.22,1,.36,1),border-color .22s,box-shadow .22s}
.rp-kpi:hover{border-color:var(--accent)}
/* (i) จุดข้อมูลอธิบายนิยาม */
.rp-info{display:inline-grid;place-items:center;width:15px;height:15px;margin-left:6px;border-radius:50%;flex:none;
  font-size:10px;font-weight:800;font-style:normal;line-height:1;color:var(--muted);background:rgba(30,45,80,.10);
  border:1px solid var(--stroke2);cursor:help;transition:.15s}
.rp-info:hover{color:var(--txt);background:var(--accent-soft);border-color:var(--accent)}
/* ป้าย delta เทียบช่วงก่อน */
.rp-delta{display:inline-flex;align-items:center;gap:5px;margin-top:2px;font-size:12px;font-weight:700;padding:2px 9px;border-radius:999px;width:fit-content}
.rp-delta.up{color:#0ca30c;background:rgba(12,163,12,.12)}
.rp-delta.down{color:#d03b3b;background:rgba(208,59,59,.12)}
.rp-delta.flat{color:var(--muted);background:rgba(30,45,80,.07)}
/* เหรียญอันดับ 1-3 */
.sd-top-rank.m1{background:linear-gradient(160deg,#ffe08a,#f0b429);color:#4a3400;box-shadow:0 2px 8px rgba(240,180,41,.5)}
.sd-top-rank.m2{background:linear-gradient(160deg,#e9edf2,#b9c2cc);color:#2a3038;box-shadow:0 2px 8px rgba(180,190,200,.4)}
.sd-top-rank.m3{background:linear-gradient(160deg,#f0b487,#cd7f45);color:#3d1e00;box-shadow:0 2px 8px rgba(205,127,69,.4)}
/* แบ่งหน้าตาราง */
.rp-pager{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:12px 16px;border-top:1px solid var(--stroke)}
.rp-pager-sum{font-size:12.5px;color:var(--muted)}
.rp-pager-ctrl{display:flex;align-items:center;gap:5px}
.rp-pg{min-width:30px;height:30px;padding:0 8px;border-radius:8px;border:1px solid var(--stroke2);background:var(--surface);
  color:var(--txt);font-family:var(--font);font-size:13px;font-weight:600;cursor:pointer;transition:.15s}
.rp-pg:hover:not(:disabled){border-color:var(--accent);color:var(--accent)}
.rp-pg.on{background:var(--accent);border-color:var(--accent);color:#fff}
.rp-pg:disabled{opacity:.4;cursor:not-allowed}
.rp-pg-gap{padding:0 4px;color:var(--muted)}
/* ไฮไลต์ตารางเมื่อคลิกการ์ด Gap */
.rp-table-hi{animation:rpTableHi 2.2s ease}
@keyframes rpTableHi{0%,100%{box-shadow:0 0 0 0 rgba(230, 0, 35,0)}15%,60%{box-shadow:0 0 0 3px var(--accent)}}
.rp-grade-sum{margin-top:10px;font-size:12.5px;color:var(--muted);text-align:right}
.rp-grade-sum b{color:var(--txt);font-weight:800}
.rp-gt-legend{display:flex;gap:22px;margin-bottom:6px;font-size:12.5px}
.rp-gt-legend span{display:inline-flex;align-items:center;gap:7px;color:var(--muted)}
.rp-gt-legend i{width:14px;height:4px;border-radius:2px;display:inline-block}
.rp-gt-legend b{color:var(--txt);font-weight:700}
.sd-grade{display:flex;flex-direction:column;gap:11px}
.sd-grade-row{display:flex;align-items:center;gap:10px}
.sd-grade-dot{width:11px;height:11px;border-radius:3px;flex:none}
.sd-grade-lb{font-size:12.5px;flex:none;width:150px;color:var(--txt)}
.sd-grade-track{flex:1;height:9px;border-radius:5px;background:var(--stroke);overflow:hidden}
.sd-grade-fill{height:100%;border-radius:5px;transition:width .4s}
.sd-grade-n{font-size:13px;font-weight:800;width:44px;text-align:right;flex:none;color:var(--txt)}
.sd-divider{height:1px;background:var(--stroke);margin:14px 0}
.sd-toph{font-size:12.5px;font-weight:700;color:var(--txt);margin-bottom:8px}
.sd-top-row{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--stroke)}
.sd-top-rank{width:22px;height:22px;border-radius:7px;flex:none;display:grid;place-items:center;font-size:12px;font-weight:800;background:var(--accent-soft);color:var(--accent)}
.sd-views{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.sd-view{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:10px;cursor:pointer;
  font-family:var(--font);font-size:12.5px;font-weight:600;color:var(--muted);background:var(--surface);border:1.5px solid var(--stroke2);transition:.15s}
.sd-view:hover{border-color:var(--accent);color:var(--txt)}
.sd-view.on{color:var(--accent);border-color:var(--accent);background:var(--accent-soft);font-weight:700}
.sd-target{position:relative;height:7px;border-radius:4px;background:var(--stroke);margin-top:4px}
.sd-target-f{height:100%;border-radius:4px;transition:width .4s}
.sd-target-goal{position:absolute;top:-2px;width:2px;height:11px;background:var(--txt);opacity:.55}
.sd-cmp{display:flex;flex-direction:column;gap:15px;padding:4px 2px}
.sd-cmp-row{display:flex;flex-direction:column;gap:5px;border-radius:9px;transition:background .2s}
.sd-cmp-row.on{background:var(--accent-soft);box-shadow:inset 3px 0 0 var(--accent);padding:8px 10px;margin:-4px -6px}
.sd-cmp-top{display:flex;justify-content:space-between;align-items:center;font-size:13.5px}
.sd-cmp-bar{position:relative;height:9px;border-radius:5px;background:var(--stroke)}
.sd-cmp-fill{height:100%;border-radius:5px;transition:width .4s}
.sd-cmp-goal{position:absolute;top:-2px;width:2px;height:13px;background:var(--txt);opacity:.5}
.as-vlegend2{display:flex;flex-wrap:wrap;gap:8px 16px;margin-bottom:10px;font-size:12px;color:var(--muted)}
.as-vlegend2 .as-vdot2{display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:6px;vertical-align:middle}
`;

// Rule-based insight/recommendation — no AI/LLM call. Picks the district with the highest demand gap
// score in the currently-focused province and phrases it as a plain-language recommendation, using
// whatever signals are already computed (gap tier, top segment, comparison to the province's own average).
function buildDistrictInsight(provinceArea, distRows){
  if(!distRows || distRows.length===0) return null;
  const top = distRows[0];   // distRows is already sorted gapScore high→low (rankDistricts)
  const gapPhrase = top.gapLevel==="High" ? `${t("Lead สูง — ยังขาดสมาชิกเครือข่าย", "High Lead demand — the network is still short by")} ${num(top.gapCount)} ${t("ราย ใน", "businesses across")} ${top.gapBreadth} ${t("หมวด เหมาะเป็นเป้าหมายเติมก่อน", "categories, a good place to start filling")}`
    : top.gapLevel==="Medium" ? `${t("Lead ปานกลาง — ยังเติมได้อีก", "Medium Lead demand — room for another")} ${num(top.gapCount)} ${t("ราย", "businesses")}`
    : t("ช่องว่างตลาดต่ำ — ตลาดค่อนข้างอิ่มตัวแล้วในอำเภอนี้", "Low market gap — this district is fairly saturated");
  const vsProvince = provinceArea && provinceArea.gapScore!=null
    ? (top.gapScore > provinceArea.gapScore
        ? `${t("สูงกว่าค่าเฉลี่ยของทั้งจังหวัด (", "above the province average (")}${provinceArea.gapScore}${t(") อยู่", ") by")} ${top.gapScore-provinceArea.gapScore} ${t("หน่วย", "points")}`
        : top.gapScore < provinceArea.gapScore
          ? `${t("ต่ำกว่าค่าเฉลี่ยของทั้งจังหวัด (", "below the province average (")}${provinceArea.gapScore}${t(") อยู่", ") by")} ${provinceArea.gapScore-top.gapScore} ${t("หน่วย", "points")}`
          : `${t("เท่ากับค่าเฉลี่ยของทั้งจังหวัด", "equal to the province average")}`)
    : null;
  const sentence = `${t("อำเภอ", "District ")}${districtTH(top.district)}${t("มีดัชนี Lead สูงสุดในจังหวัดนี้ที่", " has the highest Lead index in this province at")} ${top.gapScore}`
    + (vsProvince ? ` ${vsProvince}` : "")
    + ` ${t("กลุ่มธุรกิจที่พบมากที่สุดคือ", "The most common business segment is ")}${segTH(top.topSegment)} ${t("และมี", "with ")}${gapPhrase}`;
  return {top, sentence};
}

// สร้างข้อความวิเคราะห์เชิงพื้นที่แบบ bullet — rule-based ล้วน ไม่ใช้ AI
// คำนวณจากข้อมูลจริงที่มีอยู่แล้ว (customerCount/prospectCount ระดับอำเภอ) เท่านั้น
// ไม่แต่งตัวเลขที่ไม่มีอยู่จริงในระบบ (เช่น มูลค่าซื้อเฉลี่ยแยกโซน ซึ่งไม่มีข้อมูลนี้เก็บไว้)
function buildSpatialBullets(provinceArea, distRows){
  if(!distRows || distRows.length===0) return [];
  const totalCust = distRows.reduce((a,d)=>a+d.customerCount,0);
  const totalPros = distRows.reduce((a,d)=>a+d.prospectCount,0);
  const total = totalCust+totalPros;
  const sorted = [...distRows].sort((a,b)=>(b.customerCount+b.prospectCount)-(a.customerCount+a.prospectCount));
  const top = sorted[0];
  const topShare = total ? Math.round((top.customerCount+top.prospectCount)/total*100) : 0;
  const lowDensity = distRows.filter(d=>d.prospectCount>0 && d.customerCount===0)
    .sort((a,b)=>b.prospectCount-a.prospectCount).slice(0,2);
  const bullets = [];
  if(top) bullets.push(`${t("จุดกระจุกตัวหลัก: ลูกค้าและLeadกว่า", "Main concentration: over")} ${topShare}${t("% กระจุกตัวอยู่ในอำเภอ", "% of customers and Leads sit in ")}${districtTH(top.district)}`);
  if(lowDensity.length) bullets.push(`${t("โอกาสในพื้นที่รอบนอก: อำเภอ", "Opportunity on the fringe:")}${lowDensity.map(d=>districtTH(d.district)).join(t(" และ", " and "))} ${t("มีLeadอยู่แต่ยังไม่มีลูกค้าเลย เหมาะจัดแคมเปญการตลาดเฉพาะพื้นที่", "have Leads but no customers at all — good candidates for a local campaign")}`);
  return bullets;
}

/* ═══════════════ รายงานวิเคราะห์ช่องว่าง (Gap Analysis) — ออกแบบใหม่ 6 ส่วน ═══════════════
   หน่วยวิเคราะห์ = เขต/อำเภอ ของ 4 จังหวัดที่มีข้อมูลระดับเขต · ระบบไม่มีข้อมูลระดับแขวง/ตำบล
   จึงใช้หน่วยเขต/อำเภอทั้งหน้า (ไม่สร้างหน่วยย่อยปลอม) · ทุกตัวเลขคำนวณจากข้อมูลจริง */
const GAP_PROVS = ["Bangkok Metropolis","Chiang Mai","Phuket","Pattaya"];

// สถานะช่องว่างตาม % ความครอบคลุม (สอดคล้องหน้า Coverage ที่ >=70 = "พื้นที่อิ่มตัว" และแยกช่วง 30-70 ละเอียดขึ้น)
function gapStatus(cov){
  if(cov<30) return {label:t("ช่องว่างสูงมาก", "Very large gap"), tone:"bad",  color:"#ff5a3c"};
  if(cov<50) return {label:t("ช่องว่างสูง", "Large gap"),   tone:"warn", color:"#ff8f3c"};
  if(cov<70) return {label:t("เข้าถึงปานกลาง", "Moderate reach"), tone:"warn", color:"#ffb02e"};
  return         {label:t("พื้นที่อิ่มตัว", "Saturated area"),   tone:"good", color:"#33d69f"};
}
// กลยุทธ์การขยายธุรกิจต่อเขต แบบ rule-based (ไม่ใช้ AI) — อิงลำดับความสำคัญ + กลุ่มธุรกิจเด่น
function expansionGuidance(priority, topSegment, cov){
  const s = segTH(topSegment);
  if(priority===1) return `${t("จัดตั้งทีมขายเฉพาะกิจ เจาะกลุ่ม", "Set up a dedicated sales team to target ")}${s}${t("และธุรกิจขนาดใหญ่ในพื้นที่โดยเร็ว", " and the larger businesses in the area, quickly")}`;
  if(cov<50)       return `${t("เพิ่มกิจกรรมการตลาดกลุ่ม", "Increase marketing activity for ")}${s} ${t("สร้างการรับรู้ก่อนขยายเต็มรูปแบบ", "to build awareness before a full rollout")}`;
  return                 `${t("รักษาความสัมพันธ์ลูกค้ากลุ่ม", "Maintain relationships with existing ")}${s}${t("เดิม และเฝ้าติดตามเป็นระยะ", " customers and check in periodically")}`;
}

// มัธยฐาน (median) ของอาเรย์ตัวเลข — ใช้แบ่ง quadrant ของ Bubble Matrix จากข้อมูลจริง (ไม่ hardcode)
function gapMedian(arr){ const s=[...arr].sort((a,b)=>a-b), n=s.length; if(!n) return 0;
  return n%2 ? s[(n-1)/2] : (s[n/2-1]+s[n/2])/2; }
// จัดระดับ Density Score เป็นสี badge: แดง=สูงสุด / ส้ม=รอง / เทา=ต่ำ
function densityTier(d){ return d>=67 ? {tone:"bad"} : d>=34 ? {tone:"warn"} : {tone:"neutral"}; }

// Demand-Gap Matrix (Bubble Chart) 2x2 — X=ลูกค้า, Y=Lead, ขนาด=ดัชนี Lead, แบ่ง 4 quadrant ด้วยมัธยฐาน
function gapBubbleMatrix(rows, selDist, onPick){
  if(!rows.length) return html`<div class="emptybox">${t("ไม่มีข้อมูล", "No data")}</div>`;
  const W=760, H=430, padL=58, padR=18, padT=30, padB=48, plotW=W-padL-padR, plotH=H-padT-padB;
  const maxX=Math.max(1,...rows.map(r=>r.existing)), maxY=Math.max(1,...rows.map(r=>r.prospect)), maxHeat=Math.max(1,...rows.map(r=>r.heatScore));
  const medX=gapMedian(rows.map(r=>r.existing)), medY=gapMedian(rows.map(r=>r.prospect));
  const sx=v=>padL + v/maxX*plotW, sy=v=>padT + plotH - v/maxY*plotH, rad=h=>7 + (h/maxHeat)*15;
  const x0=padL, x1=padL+plotW, y0=padT, y1=padT+plotH, mx=sx(medX), my=sy(medY);
  // quadrant: บน=Leadสูง / ขวา=ลูกค้าสูง
  const quad=r=> r.existing>=medX ? (r.prospect>=medY?"p1":"keep") : (r.prospect>=medY?"gap":"low");
  const QC={p1:"#ff5a3c", gap:"#ffb02e", keep:"#33d69f", low:"#8aa0be"};
  return html`<svg viewBox="0 0 ${W} ${H}" width="100%" style=${{maxWidth:W+"px",display:"block",margin:"0 auto",fontFamily:"var(--font)"}}>
    <rect x=${mx} y=${y0} width=${x1-mx} height=${my-y0} fill="rgba(255,90,60,.08)"/>
    <rect x=${x0} y=${y0} width=${mx-x0} height=${my-y0} fill="rgba(255,176,46,.08)"/>
    <rect x=${mx} y=${my} width=${x1-mx} height=${y1-my} fill="rgba(51,214,159,.08)"/>
    <rect x=${x0} y=${my} width=${mx-x0} height=${y1-my} fill="rgba(120,140,170,.08)"/>
    <text x=${x1-6} y=${y0+14} text-anchor="end" font-size="10.5" font-weight="700" fill="#ff5a3c">${t("Priority 1: ลุยทันที", "Priority 1: go now")}</text>
    <text x=${x0+6} y=${y0+14} text-anchor="start" font-size="10.5" font-weight="700" fill="#d98b1a">${t("ช่องว่างสูง / เน้นทำตลาด", "Large gap / focus on marketing")}</text>
    <text x=${x1-6} y=${y1-8} text-anchor="end" font-size="10.5" font-weight="700" fill="#1e9e73">${t("รักษาฐานลูกค้า", "Retain the customer base")}</text>
    <text x=${x0+6} y=${y1-8} text-anchor="start" font-size="10.5" font-weight="700" fill="#7f93ac">${t("โอกาสต่ำ", "Low opportunity")}</text>
    <line x1=${mx} y1=${y0} x2=${mx} y2=${y1} stroke="rgba(120,160,220,.45)" stroke-dasharray="4 4"/>
    <line x1=${x0} y1=${my} x2=${x1} y2=${my} stroke="rgba(120,160,220,.45)" stroke-dasharray="4 4"/>
    <line x1=${x0} y1=${y1} x2=${x1} y2=${y1} stroke="var(--stroke2)"/>
    <line x1=${x0} y1=${y0} x2=${x0} y2=${y1} stroke="var(--stroke2)"/>
    <text x=${(x0+x1)/2} y=${H-8} text-anchor="middle" font-size="11" fill="var(--muted)">${t("จำนวนลูกค้าปัจจุบัน →", "Existing customers →")}</text>
    <text x=${16} y=${(y0+y1)/2} text-anchor="middle" font-size="11" fill="var(--muted)" transform=${`rotate(-90 16 ${(y0+y1)/2})`}>${t("จำนวนLead →", "Leads →")}</text>
    <text x=${mx} y=${y1+14} text-anchor="middle" font-size="9" fill="var(--dim)">${t("มัธยฐาน", "median")} ${Math.round(medX)}</text>
    <text x=${x0-5} y=${my-3} text-anchor="end" font-size="9" fill="var(--dim)">${t("มัธยฐาน", "median")} ${Math.round(medY)}</text>
    ${rows.map(r=>{ const cx=sx(r.existing), cy=sy(r.prospect), rr=rad(r.heatScore), col=QC[quad(r)], on=selDist===r.district;
      return html`<g key=${r.district} style=${{cursor:"pointer"}} onClick=${()=>onPick&&onPick(r.district)}>
        <circle cx=${cx} cy=${cy} r=${rr} fill=${col} fill-opacity=${on?0.85:0.5} stroke=${col} stroke-width=${on?2.6:1.2}/>
        <text x=${cx} y=${cy-rr-3} text-anchor="middle" font-size="9" fill="var(--muted)" style=${{pointerEvents:"none"}}>${districtTH(r.district)}</text>
        <title>${districtTH(r.district)} ${t("· ลูกค้า", "· customers")} ${r.existing} · Lead ${r.prospect} · Heat ${r.heatScore}</title>
      </g>`; })}
  </svg>`;
}

function GapReport({db, f}){
  const [province, setProvince] = useState(GAP_PROVS.includes(f.province) ? f.province : "Bangkok Metropolis");
  const [segment, setSegment]   = useState("All");
  const [onlyGap, setOnlyGap]   = useState("All");   // "All" = ทุก Lead · "gap" = เฉพาะ Lead ในหมวดที่เขตนั้นยังขาด
  const [layers, setLayers]     = useState({existing:true, prospect:true, heat:true});
  const [selDist, setSelDist]   = useState(null);    // เขตที่คลิกเลือก (click-to-filter)
  const [view, setView]         = useState("both");  // สลับมุมมอง: both | matrix | table

  const segOK   = (r)=> segment==="All" || r.segment===segment;

  // ── สถิติรายเขต/อำเภอ ของจังหวัดที่เลือก (เคารพตัวกรอง segment + โหมด "เฉพาะหมวดที่ยังขาด") ──
  const rows = useMemo(()=>{
    const dl = [...new Set((db.districts||[]).filter(d=>d.province===province).map(d=>d.district))];
    const list = dl.map(dist=>{
      const cs = db.customers.filter(c=>c.province===province && c.district===dist && segOK(c));
      const allPs = db.prospects.filter(p=>p.province===province && p.district===dist && segOK(p));
      const g = demandGap(cs, allPs, GAP_REF.district);
      const gapSet = new Set(g.gapSegs.map(x=>x.seg));
      const ps = onlyGap==="gap" ? allPs.filter(p=>gapSet.has(p.segment)) : allPs;
      const existing=cs.length, prospect=ps.length, market=existing+prospect;
      const coverage = market ? existing/market*100 : 0;
      const ratio  = existing ? prospect/existing : prospect;
      const segCounts=segZero();
      cs.forEach(c=>segCounts[c.segment]++); ps.forEach(p=>segCounts[p.segment]++);
      return { district:dist, existing, prospect, market, coverage, ratio:+ratio.toFixed(1), ...g,
        gapRai:g.gapCount,
        segCounts, topSegment:Object.entries(segCounts).sort((a,b)=>b[1]-a[1])[0][0] };
    }).filter(r=>r.market>0);
    // ── สองสูตรคะแนนที่ "ต่างกันจริง" ──
    // normDensity = ความหนาแน่นLead normalize 0-100 เทียบเขตที่Leadมากสุดในจังหวัด
    const maxPros = Math.max(1, ...list.map(r=>r.prospect));
    list.forEach(r=>{
      r.normDensity  = Math.round(100 * r.prospect / maxPros);
      // (1) Density Score [ส่วนที่ 5] = ความหนาแน่นLead "ล้วน" ไม่รวม coverage
      r.densityScore = r.normDensity;
      // (2) Heat Ranking Score [ส่วนที่ 3,6] = ถ่วงน้ำหนัก ความหนาแน่นLead + ความครอบคลุมต่ำ
      //     heat = 0.6*normDensity + 0.4*(100 - coverage%)  → Leadเยอะ "และ" ครอบคลุมต่ำ = คะแนนสูง
      //     ต่างจาก Density Score ตรงพจน์ 0.4*(100-coverage) ที่ให้น้ำหนักความครอบคลุมต่ำเพิ่ม
      r.heatScore    = Math.round(0.6*r.normDensity + 0.4*(100 - r.coverage));
      r.priority     = r.heatScore>=90 ? 1 : 2;
      r.status       = gapStatus(r.coverage);
    });
    return list;
  },[db, province, segment, onlyGap]);

  const mapFilters = useMemo(()=>{
    const segF = segment==="All" ? segAllTrue()
                                 : segOnly(segment);
    return {status:{Existing:true,Prospect:true}, segments:segF, province};
  },[province, segment]);
  const mapLayers = useMemo(()=>({existing:layers.existing, prospect:layers.prospect, heat:layers.heat,
    op:{heat:80, existing:90, prospect:85}, radius:18}),[layers]);

  // ── ส่วนที่ 2: KPI ภาพรวมจังหวัด (คำนวณเป็นภาพรวมเดียว ไม่ใช่ผลรวมต่อเขต) ──
  const provExisting = db.customers.filter(c=>c.province===province && segOK(c)).length;
  const provProspect = db.prospects.filter(p=>p.province===province && segOK(p)).length;
  const totalMarket  = provExisting + provProspect;
  const provCoverage = totalMarket ? provExisting/totalMarket*100 : 0;
  const p2cRatio     = provExisting ? (provProspect/provExisting) : provProspect;

  // อันดับ/ตารางย่อย
  const heatTop5 = [...rows].sort((a,b)=>b.heatScore-a.heatScore).slice(0,5);
  const master   = [...rows].sort((a,b)=>b.densityScore-a.densityScore);   // Master Table เรียงตาม Density Score สูง→ต่ำ
  // ใช้ต่อในกล่อง insight (rule-based เดิม): พื้นที่คุณภาพสูง + สัดส่วน Priority 1
  let targets = rows.filter(r=>r.coverage<50 && r.prospect>=r.existing).sort((a,b)=>b.densityScore-a.densityScore);
  if(!targets.length) targets = [...rows].sort((a,b)=>b.densityScore-a.densityScore).slice(0,6);
  const matrix = [...rows].sort((a,b)=>b.heatScore-a.heatScore);
  const p1 = matrix.filter(r=>r.priority===1);
  const p1Pct = matrix.length ? Math.round(p1.length/matrix.length*100) : 0;
  const microZone = targets[0];
  const sel = selDist ? rows.find(r=>r.district===selDist) : null;

  const cardSt = {background:"var(--panel)",border:"1px solid var(--stroke)",borderRadius:"var(--r)",padding:"16px 18px",display:"flex",flexDirection:"column",gap:"7px"};
  const capSt  = {display:"flex",alignItems:"center",gap:"8px",color:"var(--muted)",fontSize:"12.5px",fontWeight:600};
  const bigSt  = {fontSize:"26px",fontWeight:800,color:"var(--txt)",lineHeight:1.1};

  return html`<div class="fade-in">
    <!-- ═════ ชั้น 2: Top KPI Cards Summary (4 กล่อง) — ลำดับที่ 2 ใต้ Header ═════ -->
    <div class="grid g4" style=${{marginBottom:"16px"}}>
      <div style=${cardSt}>
        <div style=${capSt}><${Icon} name="users" size=${15} color="#8a5cf6"/>${t("ธุรกิจในพื้นที่ทั้งหมด", "All businesses in the area")}</div>
        <div style=${bigSt}>${num(totalMarket)}</div>
        <div class="dim" style=${{fontSize:"11.5px"}}>${t("ลูกค้า", "Customers")} ${num(provExisting)} + Lead ${num(provProspect)}</div>
      </div>
      <div style=${cardSt}>
        <div style=${capSt}><${Icon} name="target" size=${15} color=${STATUS_COLOR.Prospect}/>${t("ช่องว่างโอกาสรวม", "Total opportunity gap")}</div>
        <div style=${bigSt}>${num(provProspect)}</div>
        <div class="dim" style=${{fontSize:"11.5px"}}>${t("Leadทั้งหมดที่ยังไม่ถูกแปลงเป็นลูกค้า", "All Leads not yet converted to customers")}</div>
      </div>
      <div style=${cardSt}>
        <div style=${capSt}><${Icon} name="gap" size=${15} color="#ff8f3c"/>${t("อัตราส่วนLeadต่อลูกค้า", "Leads per customer")}</div>
        <div style=${bigSt}>${p2cRatio.toFixed(1)} : 1</div>
        <div class="dim" style=${{fontSize:"11.5px"}}>${t("ยิ่งสูง = โอกาสขยายฐานลูกค้ายิ่งมาก", "The higher it is, the more room to grow the customer base")}</div>
      </div>
      <div style=${cardSt}>
        <div style=${capSt}><${Icon} name="coverage" size=${15} color="#33d69f"/>${t("อัตราความครอบคลุมรวม", "Overall coverage rate")}</div>
        <div style=${bigSt}>${provCoverage.toFixed(2)}%</div>
        <div class="dim" style=${{fontSize:"11.5px"}}>${t("ลูกค้า ÷ (ลูกค้า + Lead) × 100", "customers ÷ (customers + Leads) × 100")}</div>
      </div>
    </div>

    <!-- ═════ ชั้น 3: Contextual Filter Bar — จังหวัด/ประเภทธุรกิจ/ขอบเขต Lead (ย้ายมาไว้ใต้ KPI ตาม pattern มาตรฐาน) ═════ -->
    <div class="gap-filters">
      <label class="gap-lab">${t("จังหวัด", "Province")}
        <select class="gap-sel" value=${province} onChange=${e=>{ setProvince(e.target.value); setSelDist(null); }}>
          ${GAP_PROVS.map(p=>html`<option key=${p} value=${p}>${provinceTH(p)}</option>`)}
        </select></label>
      <label class="gap-lab">${t("ประเภทธุรกิจ", "Business type")}
        <select class="gap-sel" value=${segment} onChange=${e=>setSegment(e.target.value)}>
          <option value="All">${t("ทุกกลุ่ม", "All segments")}</option>
          ${SEGMENTS.map(s=>html`<option key=${s} value=${s}>${segTH(s)}</option>`)}
        </select></label>
      <label class="gap-lab">${t("ขอบเขต Lead", "Lead scope")}
        <select class="gap-sel" value=${onlyGap} onChange=${e=>setOnlyGap(e.target.value)}>
          <option value="All">${t("ทุก Lead", "All Leads")}</option>
          <option value="gap">${t("เฉพาะหมวดที่ยังขาด", "Under-served categories only")}</option>
        </select></label>
      <div class="gap-hint">${num(rows.length)} ${t("เขต/อำเภอ · จังหวัด", "District · province ")}${provinceTH(province)}</div>
    </div>

    <!-- ═════ ส่วนที่ 3: Heatmap + Heat Ranking Top 5 ═════ -->
    <div class="grid" style=${{gridTemplateColumns:"1fr 320px", gap:"16px", alignItems:"start", marginBottom:"16px"}}>
      <${Card} title=${t("แผนที่ความหนาแน่นช่องว่าง (White Space Heatmap)", "White-space heatmap")}
        sub=${t("หมุดลูกค้า (น้ำเงินเข้ม) ทับLead (น้ำเงินอ่อน) · โซนสีร้อน = Leadหนาแน่นแต่ลูกค้าน้อย · คลิกหมุดเพื่อโฟกัสเขต", "Customer pins (dark blue) over Lead pins (light blue) · hot zones are dense with Leads but thin on customers · click a pin to focus that district")}>
        <div class="gap-layers">
          <label class="gap-lyr"><span class="gap-sw" style=${{background:STATUS_COLOR.Existing}}></span><span>${t("ลูกค้าปัจจุบัน", "Existing customers")}</span>
            <${Toggle} on=${layers.existing} onChange=${()=>setLayers(x=>({...x,existing:!x.existing}))}/></label>
          <label class="gap-lyr"><span class="gap-sw" style=${{background:STATUS_COLOR.Prospect}}></span><span>Lead</span>
            <${Toggle} on=${layers.prospect} onChange=${()=>setLayers(x=>({...x,prospect:!x.prospect}))}/></label>
          <label class="gap-lyr"><span class="gap-sw" style=${{background:"linear-gradient(90deg,#2b6fff,#26e07a,#ffb02e,#ff3b1e)"}}></span><span>${t("ความหนาแน่น (Heatmap)", "Density (heatmap)")}</span>
            <${Toggle} on=${layers.heat} onChange=${()=>setLayers(x=>({...x,heat:!x.heat}))}/></label>
        </div>
        ${sel && html`<div class="gap-focus">
          <${Icon} name="pin" size=${14} color="var(--accent)"/>
          <span>${t("โฟกัส", "Focused on")} <b>${districtTH(sel.district)}</b> ${t("· ลูกค้า", "· customers")} ${num(sel.existing)} · Lead ${num(sel.prospect)} ${t("· ครอบคลุม", "· coverage")} ${sel.coverage.toFixed(1)}% · Heat ${sel.heatScore}</span>
          <button class="gap-focus-x" onClick=${()=>setSelDist(null)} aria-label=${t("ล้าง", "Clear")}>✕</button>
        </div>`}
        <div class="gap-map">
          <${LeafletMap} db=${db} filters=${mapFilters} layers=${mapLayers} country="Thailand"
            onPickArea=${()=>{}} onPickCustomer=${rec=>setSelDist(rec.district)}/>
        </div>
      </${Card}>
      <${Card} title=${t("5 อันดับพื้นที่ควรขยาย", "Top 5 areas to expand into")} sub=${t("Heat Ranking Score สูงสุด", "Highest heat ranking score")} pad0=${true}>
        ${heatTop5.map((r,i)=>html`<div key=${r.district} class=${"gap-hr"+(selDist===r.district?" on":"")} onClick=${()=>setSelDist(r.district)}>
          <span class="gap-hr-rank">${i+1}</span>
          <div style=${{flex:1,minWidth:0}}>
            <div class="gap-hr-nm">${districtTH(r.district)}</div>
            <div class="gap-hr-meta">Lead ${num(r.prospect)} ${t("· ครอบคลุม", "· coverage")} ${r.coverage.toFixed(0)}%</div>
          </div>
          <span class="gap-hr-score" style=${{color:r.priority===1?"#ff5a3c":"var(--accent)"}}>${r.heatScore}</span>
        </div>`)}
        ${heatTop5.length===0 && html`<div class="dim" style=${{padding:"16px",fontSize:"13px"}}>${t("ไม่มีข้อมูล", "No data")}</div>`}
      </${Card}>
    </div>

    <!-- ═════ ส่วนที่ 4-5 (ใหม่): Opportunity Matrix (Bubble) + Master Table + View Toggle ═════ -->
    <div class="gap-viewbar">
      <div>
        <div class="gap-viewtitle">${t("การวิเคราะห์ช่องว่างเชิงลึก", "In-depth gap analysis")}</div>
        <div class="gap-viewsub">${t("Bubble Matrix แบ่ง 4 quadrant ด้วยมัธยฐานจริงของจังหวัด · ตารางเดียวรวมทุกมิติ (Density + Heat + กลยุทธ์)", "A bubble matrix split into four quadrants by the province's real medians · one table covering every dimension (density + heat + strategy)")}</div>
      </div>
      <div class="gap-toggle" role="group" aria-label=${t("สลับมุมมอง", "Switch view")}>
        <button class=${view==="both"?"on":""} onClick=${()=>setView("both")}>${t("ทั้งคู่", "Both")}</button>
        <button class=${view==="matrix"?"on":""} onClick=${()=>setView("matrix")}>${t("มุมมองภาพรวม", "Overview")}</button>
        <button class=${view==="table"?"on":""} onClick=${()=>setView("table")}>${t("มุมมองตาราง", "Table")}</button>
      </div>
    </div>

    ${(view==="both"||view==="matrix") && html`<${Card} title=${t("เมทริกซ์ Lead รายเขต/อำเภอ", "Lead matrix by district")}
      sub=${t("แกน X = ลูกค้าปัจจุบัน · แกน Y = Lead · ขนาดวงกลม = ดัชนี Lead · เส้นแบ่งที่มัธยฐาน (median) จริง · คลิกวงเพื่อโฟกัส", "X = existing customers · Y = Leads · bubble size = Lead index · dividers sit at the real medians · click a bubble to focus")} style=${{marginBottom:"16px"}}>
      ${gapBubbleMatrix(rows, selDist, setSelDist)}
    </${Card}>`}

    ${(view==="both"||view==="table") && html`<${Card} title=${t("ตารางวิเคราะห์รวม (Master Table)", "Combined analysis table")}
      sub=${t("รวม 3 ตารางเดิมเป็นตารางเดียว · เรียงตาม Density Score สูง→ต่ำ · คลิกแถวเพื่อโฟกัส", "Three former tables merged into one · sorted by density score, highest first · click a row to focus")} pad0=${true} style=${{marginBottom:"16px"}}>
      <${Table} onRow=${r=>setSelDist(r.district)} cols=${[
        {h:t("ลำดับ", "Order"), render:(r,i)=>html`<b>${i+1}</b>`},
        {h:t("เขตพื้นที่", "District"), render:r=>html`<b style=${{color:selDist===r.district?"var(--accent)":"var(--txt)"}}>${districtTH(r.district)}</b>`},
        {h:"Density Score", render:r=>html`<${Badge} tone=${densityTier(r.densityScore).tone}>${r.densityScore}</${Badge}>`},
        {h:t("ลูกค้า / Lead", "Customers / Leads"), render:r=>html`<span><b>${num(r.existing)}</b> <span class="dim">/</span> <b style=${{color:STATUS_COLOR.Prospect}}>${num(r.prospect)}</b></span>`},
        {h:t("ความครอบคลุม", "Coverage"), render:r=>html`<div style=${{minWidth:"66px"}}>
          <b style=${{fontSize:"12.5px"}}>${r.coverage.toFixed(1)}%</b>
          <div class="gap-covbar"><div class="gap-covbar-f" style=${{width:Math.min(100,r.coverage)+"%"}}></div></div></div>`},
        {h:t("สถานะช่องว่าง", "Gap status"), render:r=>html`<${Badge} tone=${r.priority===1?"bad":"neutral"}>${r.priority===1?t("Priority 1 · ขยายทันที", "Priority 1 · expand now"):t("Priority 2 · เป้าหมายรอง", "Priority 2 · secondary target")}</${Badge}>`},
        {h:t("กลยุทธ์การขยายที่แนะนำ", "Recommended expansion strategy"), render:r=>html`<span style=${{fontSize:"12.5px"}}>${expansionGuidance(r.priority, r.topSegment, r.coverage)}</span>`},
      ]} rows=${master}/>
    </${Card}>`}

    ${matrix.length>0 && html`<div class="gap-insight">
      <div class="gap-ins-h"><${Icon} name="bolt" size=${15} color="#33d69f"/> ${t("ข้อเสนอเชิงปฏิบัติอัตโนมัติ", "Automatic practical recommendations")}</div>
      <div class="gap-ins-body">
        <div>• <b>${t("จัดสรรทรัพยากรทีมขาย:", "Allocate sales resources:")}</b> ${t("พบพื้นที่ Priority 1 จำนวน", "found")} ${num(p1.length)} ${t("จาก", "of")} ${num(matrix.length)} ${t("เขต (คิดเป็น", "Priority 1 districts (")} ${p1Pct}${t("%) — ควรมุ่งทีมขายหลักไปยังกลุ่มนี้ก่อน เพราะ Heat สูงจากLeadหนาแน่น + ความครอบคลุมต่ำ", "%) — point the main sales team here first: high heat from dense Leads plus low coverage")}</div>
        ${microZone && html`<div style=${{marginTop:"6px"}}>• <b>${t("เจาะพื้นที่ที่ขาดมากสุด:", "Target the biggest gaps:")}</b> ${districtTH(microZone.district)} ${t("ยังขาด", "still short")} ${num(microZone.gapCount)} ${t("ราย ใน", "businesses across")} ${microZone.gapBreadth} ${t("หมวด (หมวดที่ขาดสุด:", "categories (the largest gap:")} ${microZone.topGapSegment?segTH(microZone.topGapSegment):"—"} · Density ${microZone.densityScore}${t(") ควรตั้งเป็นเป้าหมายเจาะแรก", ") should be the first target")}</div>`}
        <div style=${{marginTop:"6px"}}>• <b>${t("จัดเขตทีมขาย:", "Structure the sales territories:")}</b> ${t("แบ่งความรับผิดชอบตามลำดับ Heat Ranking โดยแยกทีมดูแล Priority 1 (", "split ownership by heat ranking, with a separate team on Priority 1 (")}${num(p1.length)} ${t("เขต) ออกจาก Priority 2 เพื่อลดการทับซ้อนและใช้กำลังคนคุ้มค่า", "districts) apart from Priority 2, to reduce overlap and use people well")}</div>
      </div>
    </div>`}
    <style>${GAP_CSS}</style>
  </div>`;
}

const GAP_CSS = `
.gap-filters{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-bottom:16px;padding:12px 14px;
  background:var(--panel);border:1px solid var(--stroke);border-radius:var(--r)}
.gap-lab{display:flex;flex-direction:column;gap:4px;font-size:11.5px;font-weight:700;color:var(--dim)}
.gap-sel{padding:8px 10px;border-radius:9px;border:var(--dropdown-border);background:var(--dropdown-bg);color:var(--dropdown-text);box-shadow:var(--dropdown-shadow);
  font-family:var(--font);font-size:12.5px;min-width:150px}
.gap-hint{margin-left:auto;align-self:center;font-size:12.5px;color:var(--muted)}
.gap-layers{display:flex;flex-wrap:wrap;gap:10px 20px;margin-bottom:12px}
.gap-lyr{display:flex;align-items:center;gap:9px;font-size:12.5px;color:var(--txt);cursor:pointer}
.gap-sw{width:22px;height:10px;border-radius:5px;flex:none}
.gap-map{height:440px;border-radius:12px;overflow:hidden;border:1px solid var(--stroke2);position:relative}
.gap-map .leaflet-container{height:100%;width:100%;background:var(--surface)}
.gap-focus{display:flex;align-items:center;gap:9px;margin-bottom:10px;padding:8px 12px;font-size:12.5px;color:var(--txt);
  background:var(--accent-soft);border:1px solid rgba(230, 0, 35,.25);border-radius:9px}
.gap-focus-x{margin-left:auto;border:none;background:transparent;color:var(--muted);cursor:pointer;font-size:13px}
.gap-hr{display:flex;align-items:center;gap:11px;padding:11px 15px;border-top:1px solid var(--stroke);cursor:pointer;transition:background .12s}
.gap-hr:first-of-type{border-top:none}
.gap-hr:hover,.gap-hr.on{background:rgba(120,160,220,.07)}
.gap-hr-rank{flex:none;width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:800;
  color:#fff;background:linear-gradient(135deg,#ff3b5c,#e60023)}
.gap-hr-nm{font-size:13px;font-weight:600;color:var(--txt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gap-hr-meta{font-size:11.5px;color:var(--muted);margin-top:2px}
.gap-hr-score{font-size:16px;font-weight:800;flex:none}
.gap-dbar{width:70px;height:8px;border-radius:5px;background:rgba(120,160,220,.15);overflow:hidden;flex:none}
.gap-dbar-f{height:100%;border-radius:5px;background:linear-gradient(90deg,#ffb02e,#ff5a3c)}
.gap-insight{background:linear-gradient(135deg,rgba(51,214,159,.1),rgba(51,214,159,.02));
  border:1px solid rgba(51,214,159,.3);border-radius:var(--r);padding:15px 17px;margin-bottom:16px}
.gap-ins-h{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:800;color:var(--txt);
  margin-bottom:9px;text-transform:uppercase;letter-spacing:.4px}
.gap-ins-body{font-size:13px;line-height:1.65;color:var(--txt)}
/* แถบหัว + ปุ่มสลับมุมมอง (Matrix / Table / ทั้งคู่) */
.gap-viewbar{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px}
.gap-viewtitle{font-size:15px;font-weight:800;color:var(--txt)}
.gap-viewsub{font-size:12px;color:var(--muted);margin-top:2px}
.gap-toggle{display:inline-flex;border:1px solid var(--stroke2);border-radius:10px;overflow:hidden;background:var(--surface);flex:none}
.gap-toggle button{border:none;background:transparent;padding:8px 14px;font-family:var(--font);font-size:12.5px;font-weight:600;color:var(--muted);cursor:pointer;transition:.15s}
.gap-toggle button+button{border-left:1px solid var(--stroke2)}
.gap-toggle button:hover{color:var(--txt)}
.gap-toggle button.on{background:var(--accent);color:#fff}
/* mini progress bar คอลัมน์ความครอบคลุมใน Master Table */
.gap-covbar{height:5px;width:64px;border-radius:3px;background:rgba(120,160,220,.15);overflow:hidden;margin-top:4px}
.gap-covbar-f{height:100%;border-radius:3px;background:linear-gradient(90deg,#33d69f,#12b886);transition:width .4s}
`;

/* ═══════════════ รายงานเชิงภูมิศาสตร์ (Geographic) — หน่วยวิเคราะห์ = Cluster ═══════════════
   Cluster = กลุ่มเขต/อำเภอที่อยู่ใกล้กันและความหนาแน่นใกล้เคียงกัน generate อัตโนมัติจากข้อมูลจริง
   (buildClusters ใน data.js) รองรับ 4 จังหวัดที่มีข้อมูลระดับเขต · จำนวนกลุ่มไม่ตายตัว */
const CLUSTER_PROVS = ["Bangkok Metropolis","Chiang Mai","Phuket","Pattaya"];
// ชื่อกลุ่มแบบ auto-generate จากเขตหนาแน่นสุดในกลุ่ม (ไม่ hardcode ชื่อเฉพาะ)
const clusterName = c => c.memberCount>1 ? `${t("กลุ่มพื้นที่", "Area cluster ")}${districtTH(c.anchor)}${t("และใกล้เคียง", " and nearby")}` : `${t("กลุ่มพื้นที่", "Area cluster ")}${districtTH(c.anchor)}`;

// กราฟแท่งคู่: ลูกค้าปัจจุบัน vs Lead แยกตาม cluster (แกน X = รหัสกลุ่ม, แกน Y = จำนวนราย)
function geoGroupedBar(clusters){
  const max = Math.max(1, ...clusters.flatMap(c=>[c.existing, c.prospect]));
  return html`<div>
    <div class="geo-gb-legend">
      <span><span class="geo-dot" style=${{background:STATUS_COLOR.Existing}}></span>${t("ลูกค้าปัจจุบัน", "Existing customers")}</span>
      <span><span class="geo-dot" style=${{background:STATUS_COLOR.Prospect}}></span>Lead</span>
    </div>
    <div class="geo-gb">
      ${clusters.map(c=>html`<div key=${c.code} class="geo-gb-grp" title=${clusterName(c)}>
        <div class="geo-gb-bars">
          <div class="geo-gb-bar" style=${{height:Math.round(c.existing/max*100)+"%",background:STATUS_COLOR.Existing}}><span>${num(c.existing)}</span></div>
          <div class="geo-gb-bar" style=${{height:Math.round(c.prospect/max*100)+"%",background:STATUS_COLOR.Prospect}}><span>${num(c.prospect)}</span></div>
        </div>
        <div class="geo-gb-lb">${c.code}</div>
      </div>`)}
    </div>
  </div>`;
}

// กราฟแท่งซ้อน 100%: แต่ละแท่ง = 1 cluster ยาวเต็ม 100% แบ่งสีตาม segment (รวมทุก segment = 100% พอดี เพราะ segCounts ครอบคลุมทุกราย)
function geoStacked100(clusters){
  return html`<div>
    <div class="geo-gb-legend">
      ${SEGMENTS.map(s=>html`<span key=${s}><span class="geo-dot" style=${{background:SEG_COLOR[s]}}></span>${segTH(s)}</span>`)}
    </div>
    <div class="geo-st">
      ${clusters.map(c=>{ const t=c.market||0;
        return html`<div key=${c.code} class="geo-st-row">
          <div class="geo-st-lb"><span class="geo-cdot sm" style=${{background:c.color}}>${c.code}</span>${clusterName(c)}</div>
          <div class="geo-st-track">
            ${t>0 ? SEGMENTS.map(s=>{ const w=c.segCounts[s]/t*100;
              return w>0 ? html`<div key=${s} class="geo-st-seg" style=${{width:w+"%",background:SEG_COLOR[s]}}
                title=${segTH(s)+" "+num(c.segCounts[s])+" ("+Math.round(w)+"%)"}></div>` : ""; })
              : html`<div class="geo-st-empty">${t("ไม่มีข้อมูล", "No data")}</div>`}
          </div>
        </div>`; })}
    </div>
  </div>`;
}

// ── รายงานสรุปข้อมูลรายพื้นที่ — ยุบ 2 หน้าเดิมไว้ด้วยกัน ──
// ตัวกรอง (จังหวัด/ประเภทธุรกิจ) และแท็บที่เลือก ถูกเก็บไว้ที่ Reports() แล้วส่งลงมา
// จึงคงค่าเดิมเสมอเมื่อสลับแท็บ และปุ่มส่งออกก็อ่านแท็บเดียวกันนี้ได้
// เป้าหมายอัตราความครอบคลุม (ปรับได้จุดเดียว) — ใช้เทียบใน KPI "อัตราความครอบคลุม"
const COVERAGE_TARGET = 80;
// ระดับความหนาแน่นของโซน คิดจากขนาดตลาดรวม (ลูกค้า+Lead) เทียบกับโซนที่ใหญ่สุดในจังหวัด
// k = คีย์ไว้เทียบในโค้ด (ห้ามแปล) · t = ป้ายที่แสดง เป็น getter เพราะผลลัพธ์ถูกเก็บใน useMemo
// ถ้าเก็บเป็นสตริงตรง ๆ ค่าที่ memo ไว้จะค้างภาษาเดิมตอนสลับภาษา
const densityLabel = (market, maxMarket)=>{ const r = maxMarket? market/maxMarket : 0;
  return r>=0.66 ? {k:"high",   tone:"bad",     get t(){ return t("สูง","High"); }}
       : r>=0.33 ? {k:"medium", tone:"warn",    get t(){ return t("ปานกลาง","Medium"); }}
       :           {k:"low",    tone:"neutral", get t(){ return t("ต่ำ","Low"); }}; };

// รายงานสรุปข้อมูลรายพื้นที่ — รีดีไซน์เป็น 3 ส่วน (KPI / แผนที่+กราฟ / ตารางเชิงปฏิบัติ)
// วิเคราะห์ทีละจังหวัด (จัดกลุ่มพื้นที่ภายในจังหวัดด้วย buildClusters) จึงยึด 4 จังหวัดที่มีข้อมูลระดับเขต
function AreaSummaryReport({db, f, k, nav, tab, setTab, province, setProvince, segment, setSegment}){
  const geoProv = CLUSTER_PROVS.includes(province) ? province : CLUSTER_PROVS[0];
  const geoFallback = !CLUSTER_PROVS.includes(province);
  // ตัวกรองใหม่เฉพาะหน้านี้: ทีม TC + ช่วงวันที่ (created_at) — เก็บเป็น state ในหน้า ค่าเริ่มต้นว่าง = ทั้งหมด
  const [tc,setTc]     = useState("All");
  const [from,setFrom] = useState("");
  const [to,setTo]     = useState("");
  // Validation: ถ้า "ถึง" น้อยกว่า "จาก" ให้สลับค่าอัตโนมัติเวลาใช้กรอง แล้วแจ้งผู้ใช้
  const swapped = !!(from && to && to < from);
  const dFrom = swapped ? to : from, dTo = swapped ? from : to;

  // รายชื่อ TC สำหรับ dropdown — ดึงจากข้อมูลจริง (เฉพาะไทย) เรียงตามตัวอักษร
  const tcList = useMemo(()=>[...new Set(
    db.customers.concat(db.prospects).filter(x=>x.country==="Thailand").map(x=>x.tc_owner).filter(Boolean)
  )].sort(),[db]);

  // ── กรองข้อมูลตั้งต้นตาม TC + ช่วงวันที่ ก่อนส่งเข้าสูตรทุกตัว (สูตรหลักไม่เปลี่ยน เปลี่ยนแค่ชุดข้อมูล) ──
  const inRange = o => (!dFrom || (o.created_at && o.created_at>=dFrom)) && (!dTo || (o.created_at && o.created_at<=dTo));
  const tcOk = o => tc==="All" || o.tc_owner===tc;
  const vdb = useMemo(()=>({...db,
    customers: db.customers.filter(c=>tcOk(c)&&inRange(c)),
    prospects: db.prospects.filter(p=>tcOk(p)&&inRange(p)) }),[db,tc,dFrom,dTo]);

  // ตัวกรองกลุ่มธุรกิจร่วม (ใช้รูปแบบเดียวกับหน้าเดิม) — ป้อนให้ buildClusters/analyzeArea
  const segF = segment==="All" ? segAllTrue()
                               : segOnly(segment);
  const cf = {status:{Existing:true,Prospect:true}, segments:segF, province:geoProv};

  const clusters = useMemo(()=>buildClusters(vdb, geoProv, cf),[vdb, geoProv, segment]);
  const provStat = useMemo(()=>analyzeArea(vdb, geoProv, cf),[vdb, geoProv, segment]);

  // ── ข้อมูลสถานะการเข้าพบต่อโซน (ใช้ทั้ง KPI แผนที่สรุป และตาราง) ──
  const maxMarket = Math.max(1, ...clusters.map(c=>c.market));
  const zoneRows = clusters.map((c,i)=>{
    const set=new Set(c.districts);
    const ps=vdb.prospects.filter(p=>p.province===geoProv && set.has(p.district) && prosPass(p,cf));
    const covered=ps.filter(p=>(p.visit_status||"ยังไม่เข้าพบ")==="ครอบคลุมแล้ว").length;
    return {...c, priority:i+1, psTotal:ps.length, covered, uncovered:ps.length-covered,
      density:densityLabel(c.market, maxMarket)};
  });

  // ── Section 1: KPI ──
  // 1) โซนโอกาสหนาแน่นสูง = จำนวนกลุ่มพื้นที่ที่มีความหนาแน่น (ลูกค้า+Lead) ระดับ "สูง"
  const highZones = zoneRows.filter(z=>z.density.k==="high").length;
  // 2) อัตราความครอบคลุม (จากสูตรเดิมของ analyzeArea) เทียบเป้าหมาย
  const coverage = provStat.coverage;
  // 3) ช่องว่างที่ยังไม่เข้าถึง = Lead ในหมวดที่จังหวัดนี้ "ยังขาด" และยังไม่เข้าพบ
  const provGapMap = Object.fromEntries(gapBySegment(
    vdb.customers.filter(c=>c.province===geoProv && custPass(c,cf)),
    vdb.prospects.filter(p=>p.province===geoProv && prosPass(p,cf))).map(x=>[x.seg,x.gap]));
  const unserved = vdb.prospects.filter(p=>p.province===geoProv && prosPass(p,cf)
    && (provGapMap[p.segment]||0)>0 && (p.visit_status||"ยังไม่เข้าพบ")==="ยังไม่เข้าพบ").length;
  // สรุปสถานะการเข้าพบทั้งจังหวัด (ไว้โชว์ใต้แผนที่)
  const provProspects = vdb.prospects.filter(p=>p.province===geoProv && prosPass(p,cf));
  const provCovered = provProspects.filter(p=>(p.visit_status||"ยังไม่เข้าพบ")==="ครอบคลุมแล้ว").length;
  const provUnvisited = provProspects.length - provCovered;

  const mapFilters = {status:{Existing:true,Prospect:true}, segments:segF, province:geoProv};
  const [mlayers,setMlayers] = useState({existing:true, prospect:true, heat:false});
  const mapLayers = {existing:mlayers.existing, prospect:mlayers.prospect, heat:mlayers.heat,
    visit:true, op:{heat:72, existing:90, prospect:85}, radius:18};

  const cardSt = {background:"var(--panel)",border:"1px solid var(--stroke)",borderRadius:"var(--r)",padding:"16px 18px",display:"flex",flexDirection:"column",gap:"7px"};
  const capSt  = {display:"flex",alignItems:"center",gap:"8px",color:"var(--muted)",fontSize:"12.5px",fontWeight:600};
  const bigSt  = {fontSize:"26px",fontWeight:800,color:"var(--txt)",lineHeight:1.1};

  const clearFilters = ()=>{ setTc("All"); setFrom(""); setTo(""); };

  return html`<div class="fade-in">
    <!-- ═════ Header ═════ -->
    <div class="as-head">
      <div><div class="as-head-t">${t("สรุปข่าวกรองเชิงพื้นที่", "Spatial intelligence summary")}</div>
        <div class="as-head-s">${t("ภาพรวมโอกาส ความครอบคลุม และสถานะการเข้าพบ รายกลุ่มพื้นที่ในจังหวัด", "Opportunity, coverage and visit status by area cluster within the province ")}${provinceTH(geoProv)}</div></div>
    </div>

    <!-- ═════ ชั้นที่ 3: แถบตัวกรอง (จังหวัด · ช่วงวันที่ · TC) ═════ -->
    <div class="op-slicers">
      <label class="op-lab">${t("จังหวัด", "Province")}
        <select class="op-sel" value=${province} onChange=${e=>setProvince(e.target.value)}>
          <option value="All">${t("ทั้งประเทศ", "Nationwide")}</option>
          ${CLUSTER_PROVS.map(p=>html`<option key=${p} value=${p}>${provinceTH(p)}</option>`)}
        </select></label>
      <label class="op-lab">${t("กลุ่มธุรกิจ", "Business segment")}
        <select class="op-sel" value=${segment} onChange=${e=>setSegment(e.target.value)}>
          <option value="All">${t("ทุกกลุ่ม", "All segments")}</option>
          ${SEGMENTS.map(s=>html`<option key=${s} value=${s}>${segTH(s)}</option>`)}
        </select></label>
      <${QuickRange} db=${db} from=${from} to=${to} setFrom=${setFrom} setTo=${setTo}/>
      <label class="op-lab">${t("ตั้งแต่วันที่", "From")}
        <${DateField} className="op-sel" value=${from} onChange=${setFrom}/></label>
      <label class="op-lab">${t("ถึงวันที่", "To")}
        <${DateField} className="op-sel" value=${to} onChange=${setTo}/></label>
      <label class="op-lab">${t("ผู้ประสานงาน (TC)", "Coordinator (TC)")}
        <select class="op-sel" value=${tc} onChange=${e=>setTc(e.target.value)}>
          <option value="All">${t("ทุกคน", "Everyone")}</option>
          ${tcList.map(t=>html`<option key=${t} value=${t}>${t}</option>`)}
        </select></label>
      ${(tc!=="All"||from||to) && html`<button class="op-clear" onClick=${clearFilters}>${t("ล้างตัวกรอง", "Clear filters")}</button>`}
      <div class="rpt-daterange-note">
        ${swapped ? html`<span style=${{color:"#b45309"}}>${t("สลับช่วงวันที่ให้อัตโนมัติแล้ว (วันที่ถึงมาก่อนวันที่ตั้งแต่)", "The date range was swapped automatically (the end date came before the start date)")}</span><br/>` : ""}
        ${geoFallback ? html`${t("วิเคราะห์ทีละจังหวัด — กำลังแสดง", "One province at a time — currently showing")} <b>${provinceTH(geoProv)}</b> · ` : ""}
        ${t("ลูกค้า", "Customers")} ${num(provStat.customerCount)} · Lead ${num(provStat.prospectCount)}
      </div>
    </div>

    <!-- ═════ Section 1: KPI (3 การ์ด — ตัด Route Efficiency ออกตามที่กำหนด) ═════ -->
    <div class="grid g3" style=${{marginBottom:"16px"}}>
      <div style=${cardSt}>
        <div style=${capSt}><${Icon} name="layers" size=${15} color="#8a5cf6"/>${t("โซนโอกาสหนาแน่นสูง", "High-density opportunity zones")}</div>
        <div style=${bigSt}>${num(highZones)}</div>
        <div class="dim" style=${{fontSize:"11.5px"}}>${t("จากทั้งหมด", "out of")} ${num(clusters.length)} ${t("กลุ่มพื้นที่ (ความหนาแน่นระดับสูง)", "area clusters (high density)")}</div>
      </div>
      <div style=${cardSt}>
        <div style=${capSt}><${Icon} name="coverage" size=${15} color="#33d69f"/>${t("อัตราความครอบคลุม", "Coverage rate")}</div>
        <div style=${bigSt}>${coverage}% <span style=${{fontSize:"13px",fontWeight:600,color:coverage>=COVERAGE_TARGET?"#33d69f":"var(--muted)"}}>${t("(เป้าหมาย", "(target")} ${COVERAGE_TARGET}%)</span></div>
        <div class="as-target"><div class="as-target-f" style=${{width:Math.min(100,coverage)+"%",background:coverage>=COVERAGE_TARGET?"#33d69f":"#ffb02e"}}></div>
          <div class="as-target-goal" style=${{left:COVERAGE_TARGET+"%"}}></div></div>
      </div>
      <div style=${cardSt}>
        <div style=${capSt}><${Icon} name="target" size=${15} color="#ff5a3c"/>${t("ช่องว่างที่ยังไม่เข้าถึง", "Gap not yet reached")}</div>
        <div style=${bigSt}>${num(unserved)}</div>
        <div class="dim" style=${{fontSize:"11.5px"}}>${t("Lead ในหมวดที่ยังขาด · ยังไม่เข้าพบ", "Leads in under-served categories · not visited")}</div>
      </div>
    </div>

    <!-- ═════ Section 2: แผนที่สรุป (ซ้าย) + กราฟเปรียบเทียบรายโซน (ขวา) ═════ -->
    <div class="geo-2col" style=${{marginBottom:"16px"}}>
      <${Card} title=${t("แผนที่สรุปความหนาแน่นและช่องว่าง", "Density and gap summary map")}
        sub=${t("แดง = Lead ในหมวดที่ยังขาด · เทา = ยังไม่เข้าพบ (ช่องว่าง) · ขอบเขตสี = กลุ่มพื้นที่", "Red = Leads in under-served categories · grey = not visited (the gap) · coloured outlines = area clusters")}>
        <div class="geo-layers">
          <label class="geo-lyr"><span class="geo-sw" style=${{background:STATUS_COLOR.Existing}}></span>
            <span>${t("ลูกค้าปัจจุบัน", "Existing customers")}</span><${Toggle} on=${mlayers.existing} onChange=${()=>setMlayers(x=>({...x,existing:!x.existing}))}/></label>
          <label class="geo-lyr"><span class="geo-sw" style=${{background:STATUS_COLOR.Prospect}}></span>
            <span>Lead</span><${Toggle} on=${mlayers.prospect} onChange=${()=>setMlayers(x=>({...x,prospect:!x.prospect}))}/></label>
          <label class="geo-lyr"><span class="geo-sw" style=${{background:"linear-gradient(90deg,#2b6fff,#26e07a,#ffb02e,#ff3b1e)"}}></span>
            <span>Lead (Heatmap)</span><${Toggle} on=${mlayers.heat} onChange=${()=>setMlayers(x=>({...x,heat:!x.heat}))}/></label>
        </div>
        <!-- คำอธิบายสีเน้นสถานะการเข้าพบ -->
        <div class="as-vlegend">
          <span><span class="as-vdot" style=${{background:"#ff3b1e"}}></span>${t("อยู่ในหมวดที่ยังขาด (เข้าพบแล้ว)", "in under-served categories (already visited)")}</span>
          <span><span class="as-vdot" style=${{background:"#9aa4b2"}}></span>${t("ยังไม่เข้าพบ", "Not visited")} ${num(provUnvisited)} ${t("ราย", "businesses")}</span>
          <span><span class="as-vdot" style=${{background:STATUS_COLOR.Existing}}></span>${t("ลูกค้าปัจจุบัน", "Existing customers")}</span>
        </div>
        <div class="geo-map">
          <${LeafletMap} db=${vdb} filters=${mapFilters} layers=${mapLayers} country="Thailand" clusters=${clusters}
            onPickArea=${()=>{}} onPickCustomer=${()=>{}}/>
        </div>
        <div class="geo-clegend">
          ${clusters.map(c=>html`<span key=${c.code} class="geo-cl"><span class="geo-cdot" style=${{background:c.color}}>${c.code}</span>${clusterName(c)}</span>`)}
        </div>
      </${Card}>
      <${Card} title=${t("เปรียบเทียบความครอบคลุมกับช่องว่างรายโซน", "Coverage vs. gap by zone")}
        sub=${t("แท่งคู่ต่อกลุ่มพื้นที่ · ลูกค้าปัจจุบัน (ครอบคลุม) เทียบLead (ช่องว่างโอกาส)", "Paired bars per area cluster · existing customers (coverage) against Leads (the opportunity gap)")}>
        ${clusters.length ? geoGroupedBar(clusters) : html`<div class="emptybox">${t("ไม่มีข้อมูลตามตัวกรองที่เลือก", "No data matches the current filters")}</div>`}
      </${Card}>
    </div>

    <!-- ═════ Section 3: ตารางเชิงปฏิบัติ ═════ -->
    <${Card} title=${t("สรุปเชิงปฏิบัติรายกลุ่มพื้นที่", "Actionable summary by area cluster")} sub=${t("เรียงตามคะแนนโอกาสสูง→ต่ำ", "Sorted by opportunity score, highest first")} pad0=${true} style=${{marginBottom:"16px"}}>
      ${zoneRows.length ? html`<${Table} cols=${[
        {h:t("กลุ่มพื้นที่", "Area cluster"), render:c=>html`<div class="row" style=${{gap:"8px"}}><span class="geo-cdot sm" style=${{background:c.color}}>${c.code}</span><b>${clusterName(c)}</b></div>`},
        {h:t("ระดับความหนาแน่น", "Density level"), render:c=>html`<${Badge} tone=${c.density.tone}>${c.density.t}</${Badge}> <span class="dim" style=${{fontSize:"11.5px"}}>${num(c.market)} ${t("ราย", "businesses")}</span>`},
        {h:t("สถานะการเข้าพบ (Lead)", "Visit status (Leads)"), render:c=> c.psTotal ? html`<div style=${{minWidth:"150px"}}>
          <div style=${{fontSize:"12px",marginBottom:"4px"}}><b style=${{color:"#0f7a3d"}}>${t("ครอบคลุม", "Coverage")} ${num(c.covered)}</b> · <b style=${{color:"#b45309"}}>${t("ยังไม่เข้าพบ", "Not visited")} ${num(c.uncovered)}</b></div>
          <div class="as-vbar"><div class="as-vbar-f" style=${{width:Math.round(c.covered/c.psTotal*100)+"%"}}></div></div>
        </div>` : html`<span class="dim">—</span>`},
        {h:t("ดัชนีช่องว่าง", "Gap index"), render:c=>html`<b style=${{fontSize:"14px"}}>${c.gapScore}</b>`},
        {h:t("คำแนะนำ", "Recommendation"), render:c=>html`<span style=${{fontSize:"12px"}}>${expansionGuidance(c.priority, c.topSegment, c.coverage)}</span>`},
      ]} rows=${zoneRows}/>` : html`<div class="emptybox" style=${{margin:"18px"}}>${t("ไม่มีข้อมูลตามตัวกรองที่เลือก", "No data matches the current filters")}</div>`}
    </${Card}>

    <style>${GEO_CSS}${AREA_SUM_CSS}</style>
  </div>`;
}
const AREA_SUM_CSS = `
.as-head{margin-bottom:14px}
.as-head-t{font-size:18px;font-weight:800;color:var(--txt);letter-spacing:.2px}
.as-head-s{font-size:12.5px;color:var(--muted);margin-top:3px}
.as-target{position:relative;height:7px;border-radius:4px;background:var(--stroke);overflow:visible;margin-top:4px}
.as-target-f{height:100%;border-radius:4px;transition:width .4s}
.as-target-goal{position:absolute;top:-2px;width:2px;height:11px;background:var(--txt);opacity:.55}
.as-vlegend{display:flex;flex-wrap:wrap;gap:8px 16px;margin:10px 0;font-size:12px;color:var(--muted)}
.as-vlegend .as-vdot{display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:6px;vertical-align:middle}
.as-vbar{height:6px;border-radius:4px;background:rgba(255,176,46,.28);overflow:hidden}
.as-vbar-f{height:100%;background:#33d69f;border-radius:4px;transition:width .4s}
`;

function GeographicReport({db, f, province, segment}){
  const [layers, setLayers]     = useState({existing:true, prospect:true, heat:false});
  const [picked, setPicked]     = useState(null);
  // เปลี่ยนจังหวัดแล้วล้างเขตที่คลิกเลือกไว้ (เดิมทำในตัวเลือกจังหวัดที่ย้ายไปอยู่แถบตัวกรองร่วม)
  useEffect(()=>{ setPicked(null); },[province]);

  // เปลี่ยนจังหวัด/ประเภทธุรกิจ → cluster ทั้งหมด generate ใหม่ (สมาชิกกลุ่มคงที่ต่อจังหวัด สถิติคิดตาม segment)
  const clusters = useMemo(()=>{
    const segF = segment==="All" ? segAllTrue()
                                 : segOnly(segment);
    const cf = {status:{Existing:true,Prospect:true}, segments:segF, province};
    return buildClusters(db, province, cf);
  },[db, province, segment]);

  const mapFilters = useMemo(()=>{
    const segF = segment==="All" ? segAllTrue()
                                 : segOnly(segment);
    return {status:{Existing:true,Prospect:true}, segments:segF, province};
  },[province, segment]);
  const mapLayers = useMemo(()=>({existing:layers.existing, prospect:layers.prospect, heat:layers.heat,
    op:{heat:72, existing:90, prospect:85}, radius:18}),[layers]);

  // ── ตัวเลขรวมระดับจังหวัด (ตาม segment) จากผลรวมทุกคลัสเตอร์ ──
  const existing = clusters.reduce((a,c)=>a+c.existing,0);
  const prospect = clusters.reduce((a,c)=>a+c.prospect,0);
  const market = existing+prospect;
  const coverage = market ? existing/market*100 : 0;
  const primary = [...clusters].sort((a,b)=>b.gapCount-a.gapCount)[0];   // คลัสเตอร์ที่ยังขาดมากที่สุด
  const topOpp  = clusters[0];   // clusters เรียงตามดัชนี Lead มาก→น้อยแล้ว

  const cardSt = {background:"var(--panel)",border:"1px solid var(--stroke)",borderRadius:"var(--r)",padding:"16px 18px",display:"flex",flexDirection:"column",gap:"7px"};
  const capSt  = {display:"flex",alignItems:"center",gap:"8px",color:"var(--muted)",fontSize:"12.5px",fontWeight:600};
  const bigSt  = {fontSize:"26px",fontWeight:800,color:"var(--txt)",lineHeight:1.1};
  const pctOf  = (n)=> market? Math.round(n/market*100) : 0;

  // ข้อความข้อเสนอเชิงกลยุทธ์ (ใช้ทั้งแสดงผลและปุ่มคัดลอก — เป็นแหล่งเดียวกันไม่ให้หลุดจากกัน)
  const insightLines = (primary && topOpp) ? [
    `${t("ควรเร่งจัดสรรทีมขายเข้า", "Send a sales team into")} ${clusterName(primary)} ${t("(กลุ่ม", "(cluster")} ${primary.code}${t(") — มีLeadหนาแน่น", ") urgently — it has")} ${num(primary.prospect)} ${t("ราย แต่ความครอบคลุมเพียง", "dense Leads but only")} ${primary.coverage.toFixed(1)}${t("% (ยังขาด", "% coverage (short by")} ${num(primary.gapCount)} ${t("ราย ใน", "businesses across")} ${primary.gapBreadth} ${t("หมวด)", "categories)")}`,
    `${t("กลุ่มที่มี Lead สูงสุดคือ", "The cluster with the highest Lead index is")} ${clusterName(topOpp)} ${t("(ดัชนี", "(index")} ${topOpp.gapScore}${t(") โดยหมวด", ") and the category ")}${topOpp.topGapSegment?segTH(topOpp.topGapSegment):segTH(topOpp.topSegment)}${t("ยังขาดมากที่สุด ควรออกแบบแคมเปญเจาะหมวดนี้เป็นหลัก", " has the biggest gap — build the campaign around it")}`,
    `${t("แนะนำแบ่งเขตความรับผิดชอบทีมขายตาม", "Consider splitting sales ownership across the")} ${num(clusters.length)} ${t("กลุ่มพื้นที่ที่จัดได้ในจังหวัด", "area clusters identified in ")}${provinceTH(province)} ${t("เพื่อให้ครอบคลุมทั่วถึงและลดการทับซ้อนของพื้นที่ดูแล", "for even coverage with less overlap")}`,
  ] : [];
  const copyInsight = ()=>{
    const txt = `${t("ข้อเสนอเชิงกลยุทธ์ · รายงานเชิงภูมิศาสตร์ · จังหวัด", "Strategic recommendations · geographic report · province ")}${provinceTH(province)}\n` + insightLines.map(l=>"• "+l).join("\n");
    try{ navigator.clipboard.writeText(txt).then(()=>toast(t("คัดลอกข้อความแล้ว", "Text copied"),"good")).catch(()=>toast(t("คัดลอกไม่สำเร็จ", "Could not copy"),"bad")); }
    catch(e){ toast(t("คัดลอกไม่สำเร็จ", "Could not copy"),"bad"); }
  };

  return html`<div class="fade-in">
    <!-- ═════ ชั้น 2: Top KPI Cards Summary (4 กล่อง) — ลำดับที่ 2 ใต้ Header ═════ -->
    <div class="grid g4" style=${{marginBottom:"16px"}}>
      <div style=${cardSt}>
        <div style=${capSt}><${Icon} name="users" size=${15} color=${STATUS_COLOR.Existing}/>${t("ลูกค้า + Lead", "Customers + Leads")}</div>
        <div style=${bigSt}>${num(market)}</div>
        <div class="dim" style=${{fontSize:"11.5px"}}>${t("ลูกค้า", "Customers")} ${num(existing)} · Lead ${num(prospect)}</div>
      </div>
      <div style=${cardSt}>
        <div style=${capSt}><${Icon} name="layers" size=${15} color="#8a5cf6"/>${t("จำนวนกลุ่มพื้นที่หลัก", "Main area clusters")}</div>
        <div style=${bigSt}>${num(clusters.length)}</div>
        <div class="dim" style=${{fontSize:"11.5px"}}>${t("กลุ่มที่จัดได้จาก", "clusters formed from")} ${num(clusters.reduce((a,c)=>a+c.memberCount,0))} ${t("เขต/อำเภอ", "districts")}</div>
      </div>
      <div style=${cardSt}>
        <div style=${capSt}><${Icon} name="coverage" size=${15} color="#33d69f"/>${t("อัตราความครอบคลุมรวม", "Overall coverage rate")}</div>
        <div style=${bigSt}>${coverage.toFixed(2)}%</div>
        <div class="dim" style=${{fontSize:"11.5px"}}>${t("ลูกค้า ÷ (ลูกค้า + Lead) × 100", "customers ÷ (customers + Leads) × 100")}</div>
      </div>
      <div style=${cardSt}>
        <div style=${capSt}><${Icon} name="bolt" size=${15} color="#ff8f3c"/>${t("คลัสเตอร์เป้าหมายหลัก", "Primary target cluster")}</div>
        ${primary ? html`<div style=${{fontSize:"15px",fontWeight:800,color:"var(--txt)",lineHeight:1.25}}>${primary.code} · ${clusterName(primary)}</div>
          <div class="dim" style=${{fontSize:"11.5px"}}>Lead ${num(primary.prospect)} ${t("ราย · ยังขาด", "businesses · short by")} ${num(primary.gapCount)} ${t("ราย", "businesses")}</div>`
          : html`<div class="dim">—</div>`}
      </div>
    </div>

    <!-- ═════ ชั้น 3: Contextual Filter Bar — จังหวัด/ประเภทธุรกิจ (ย้ายมาไว้ใต้ KPI ตาม pattern มาตรฐาน) ═════ -->
    <!-- ตัวเลือกจังหวัด/ประเภทธุรกิจ ย้ายไปอยู่แถบตัวกรองร่วมด้านบนของหน้าแล้ว เหลือไว้แค่คำอธิบายการแบ่งกลุ่ม -->
    <div class="geo-filters">
      <div class="geo-hint">${t("แบ่งพื้นที่เป็น", "Splitting the area into")} <b>${num(clusters.length)}</b> ${t("กลุ่มอัตโนมัติ (ตามความใกล้เชิงภูมิศาสตร์ + ความหนาแน่น)", "clusters automatically (by geographic proximity and density)")}</div>
    </div>

    <!-- ═════ ส่วนที่ 3: Interactive Spatial Cluster Map ═════ -->
    <${Card} title=${t("แผนที่กลุ่มพื้นที่เชิงพื้นที่", "Area cluster map")}
      sub=${t("ขอบเขตแต่ละกลุ่มแสดงด้วยสีต่างกัน · คลิกหมุดเพื่อดูรายละเอียด · เปิด/ปิดชั้นข้อมูลได้", "Each cluster has its own colour · click a pin for details · layers can be toggled")} style=${{marginBottom:"16px"}}>
      <div class="geo-layers">
        <label class="geo-lyr"><span class="geo-sw" style=${{background:STATUS_COLOR.Existing}}></span>
          <span>${t("ลูกค้าปัจจุบัน", "Existing customers")}</span><${Toggle} on=${layers.existing} onChange=${()=>setLayers(x=>({...x,existing:!x.existing}))}/></label>
        <label class="geo-lyr"><span class="geo-sw" style=${{background:STATUS_COLOR.Prospect}}></span>
          <span>Lead</span><${Toggle} on=${layers.prospect} onChange=${()=>setLayers(x=>({...x,prospect:!x.prospect}))}/></label>
        <label class="geo-lyr"><span class="geo-sw" style=${{background:"linear-gradient(90deg,#2b6fff,#26e07a,#ffb02e,#ff3b1e)"}}></span>
          <span>Lead (Heatmap)</span><${Toggle} on=${layers.heat} onChange=${()=>setLayers(x=>({...x,heat:!x.heat}))}/></label>
      </div>
      ${picked && html`<div class="geo-pick">
        <${Icon} name=${picked.status==="Existing"?"users":"target"} size=${15} color=${picked.status==="Existing"?STATUS_COLOR.Existing:STATUS_COLOR.Prospect}/>
        <span><b>${picked.businessName}</b> · ${segTH(picked.segment)} · ${districtTH(picked.district)}</span>
        <span class="geo-pick-tag">${picked.status==="Existing"
          ? t("ลูกค้าปัจจุบัน · เริ่มเป็นลูกค้า: ", "Existing customer · since: ")+(picked.dateJoin||"—")
          : t("Lead · หมวด", "Lead · category")+segTH(picked.segment)+t(" — ธุรกิจที่ยังไม่อยู่ในเครือข่าย", " — a business not yet in the network")}</span>
        <button class="geo-pick-x" onClick=${()=>setPicked(null)} aria-label=${t("ปิด", "Close")}>✕</button>
      </div>`}
      <div class="geo-map">
        <${LeafletMap} db=${db} filters=${mapFilters} layers=${mapLayers} country="Thailand" clusters=${clusters}
          onPickArea=${()=>{}} onPickCustomer=${rec=>setPicked(rec)}/>
      </div>
      <div class="geo-clegend">
        ${clusters.map(c=>html`<span key=${c.code} class="geo-cl"><span class="geo-cdot" style=${{background:c.color}}>${c.code}</span>${clusterName(c)}</span>`)}
      </div>
    </${Card}>

    <!-- ═════ ส่วนที่ 4 (จัดเรียงใหม่): กราฟ 2 คอลัมน์ ซ้าย-ขวา — แท่งคู่ / แท่งซ้อน 100%
         (กว้างเท่ากัน 50/50 บนจอกว้าง · สลับเรียงซ้อนแนวตั้งบนจอแคบ ผ่าน .geo-2col) ═════ -->
    <div class="geo-2col" style=${{marginBottom:"16px"}}>
      <${Card} title=${t("เปรียบเทียบลูกค้าปัจจุบันกับLeadรายกลุ่ม", "Existing customers vs. Leads by cluster")} sub=${t("แท่งคู่ต่อกลุ่มพื้นที่ (จำนวนราย)", "Paired bars per area cluster (counts)")}>
        ${clusters.length ? geoGroupedBar(clusters) : html`<div class="emptybox">${t("ไม่มีข้อมูล", "No data")}</div>`}
      </${Card}>
      <${Card} title=${t("สัดส่วนกลุ่มธุรกิจแยกตามกลุ่มพื้นที่", "Business segment mix by area cluster")} sub=${t("แต่ละแท่ง = 1 กลุ่ม ยาวเต็ม 100% แบ่งสีตามประเภทธุรกิจ", "Each bar is one cluster at 100%, coloured by business type")}>
        ${clusters.length ? geoStacked100(clusters) : html`<div class="emptybox">${t("ไม่มีข้อมูล", "No data")}</div>`}
      </${Card}>
    </div>

    <!-- ═════ ส่วนที่ 5 (จัดเรียงใหม่): ตารางเปรียบเทียบความหนาแน่นและการเจาะตลาด — เต็มความกว้าง หลังกราฟทั้งสอง ═════ -->
    <${Card} title=${t("เปรียบเทียบความหนาแน่นและการเจาะตลาดรายกลุ่ม", "Density and penetration by cluster")} sub=${t("เรียงตามคะแนนโอกาสสูง→ต่ำ", "Sorted by opportunity score, highest first")} pad0=${true} style=${{marginBottom:"16px"}}>
      <${Table} cols=${[
        {h:t("กลุ่มพื้นที่", "Area cluster"), render:c=>html`<div class="row" style=${{gap:"8px"}}><span class="geo-cdot sm" style=${{background:c.color}}>${c.code}</span><b>${clusterName(c)}</b></div>`},
        {h:t("เขตพื้นที่ครอบคลุม", "Districts covered"), render:c=>html`<span class="dim" style=${{fontSize:"12px"}}>${c.members.map(m=>districtTH(m.district)).join(", ")}</span>`},
        {h:t("ลูกค้าปัจจุบัน", "Existing customers"), render:c=>num(c.existing)},
        {h:"Lead", render:c=>num(c.prospect)},
        {h:t("รวมธุรกิจในพื้นที่", "Total businesses in the area"), render:c=>num(c.market)},
        {h:t("ความครอบคลุม", "Coverage"), render:c=>html`<div style=${{minWidth:"66px"}}>
          <b style=${{fontSize:"12.5px"}}>${c.coverage.toFixed(1)}%</b>
          <div class="geo-covbar"><div class="geo-covbar-f" style=${{width:Math.min(100,c.coverage)+"%"}}></div></div>
        </div>`},
        {h:t("ดัชนี Lead", "Lead index"), render:c=>{ const lv=c.gapLevel;
          // Colored Status Badge ตามระดับช่องว่าง: สูง=แดง(ต้องเติมก่อน) ปานกลาง=เหลือง ต่ำ=เขียว(เครือข่ายค่อนข้างครบ)
          return html`<${Badge} tone=${lv==="High"?"bad":lv==="Medium"?"warn":"good"}>${c.gapScore} · ${gapTH(lv)}</${Badge}>`; }},
      ]} rows=${clusters}/>
    </${Card}>

    <!-- ═════ ส่วนที่ 6: Actionable Insights & Strategic Recommendations ═════ -->
    ${primary && topOpp && html`<div class="geo-insight">
      <div class="geo-ins-h">
        <${Icon} name="bolt" size=${15} color="#33d69f"/> <span style=${{marginLeft:"6px"}}>${t("ข้อเสนอเชิงกลยุทธ์", "Strategic recommendations")}</span>
        <button class="geo-copy" onClick=${copyInsight} title=${t("คัดลอกข้อเสนอทั้งหมดไปยังคลิปบอร์ด", "Copy all recommendations to the clipboard")}>
          <${Icon} name="copy" size=${13}/> ${t("คัดลอกข้อความ", "Copy text")}</button>
      </div>
      <div class="geo-ins-body">
        ${insightLines.map((l,i)=>html`<div key=${i} style=${i>0?{marginTop:"6px"}:null}>• ${l}</div>`)}
      </div>
    </div>`}
    <style>${GEO_CSS}</style>
  </div>`;
}

const GEO_CSS = `
/* กราฟ 2 คอลัมน์ (แท่งคู่ | แท่งซ้อน 100%) — กว้างเท่ากัน 50/50 บนจอกว้าง, ซ้อนแนวตั้งบนจอแคบ */
.geo-2col{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}
@media(max-width:900px){.geo-2col{grid-template-columns:1fr}}
.geo-filters{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-bottom:16px;padding:12px 14px;
  background:var(--panel);border:1px solid var(--stroke);border-radius:var(--r)}
.geo-lab{display:flex;flex-direction:column;gap:4px;font-size:11.5px;font-weight:700;color:var(--dim)}
.geo-sel{padding:8px 10px;border-radius:9px;border:var(--dropdown-border);background:var(--dropdown-bg);color:var(--dropdown-text);box-shadow:var(--dropdown-shadow);
  font-family:var(--font);font-size:12.5px;min-width:150px}
.geo-hint{margin-left:auto;align-self:center;font-size:12.5px;color:var(--muted)}
.geo-layers{display:flex;flex-wrap:wrap;gap:10px 22px;margin-bottom:12px}
.geo-lyr{display:flex;align-items:center;gap:9px;font-size:12.5px;color:var(--txt);cursor:pointer}
.geo-sw{width:22px;height:10px;border-radius:5px;flex:none}
.geo-map{height:480px;border-radius:12px;overflow:hidden;border:1px solid var(--stroke2);position:relative}
.geo-map .leaflet-container{height:100%;width:100%;background:var(--surface)}
.geo-pick{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;padding:9px 13px;font-size:12.5px;color:var(--txt);
  background:var(--surface);border:1px solid var(--stroke2);border-radius:10px}
.geo-pick-tag{color:var(--muted)}
.geo-pick-x{margin-left:auto;border:none;background:transparent;color:var(--muted);cursor:pointer;font-size:13px}
.geo-clegend{display:flex;flex-wrap:wrap;gap:8px 16px;margin-top:12px;font-size:12px;color:var(--muted)}
.geo-cl{display:flex;align-items:center;gap:7px}
.geo-cdot{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;flex:none;
  font-size:11.5px;font-weight:800;color:#fff}
.geo-cdot.sm{width:20px;height:20px;font-size:11px}
.geo-seg{width:100%;border-collapse:collapse;font-size:12.5px}
.geo-seg th{text-align:left;padding:11px 14px;color:var(--dim);font-weight:700;font-size:11.5px;border-bottom:1px solid var(--stroke);white-space:nowrap}
.geo-seg td{padding:11px 14px;border-bottom:1px solid var(--stroke);color:var(--txt);vertical-align:middle}
.geo-sdot{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:6px;vertical-align:middle}
.geo-insight{background:linear-gradient(135deg,rgba(51,214,159,.1),rgba(51,214,159,.02));
  border:1px solid rgba(51,214,159,.3);border-radius:var(--r);padding:15px 17px;margin-bottom:16px}
.geo-ins-h{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:800;color:var(--txt);
  margin-bottom:9px;text-transform:uppercase;letter-spacing:.4px}
.geo-ins-body{font-size:13px;line-height:1.6;color:var(--txt)}
/* กราฟแท่งคู่ (ลูกค้า vs Lead) */
.geo-gb-legend{display:flex;gap:18px;margin-bottom:12px;font-size:12px;color:var(--muted)}
.geo-gb-legend .geo-dot{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:middle}
.geo-gb{display:flex;gap:20px;align-items:flex-end;height:190px;padding:14px 6px 0}
.geo-gb-grp{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;height:100%}
.geo-gb-bars{flex:1;display:flex;gap:7px;align-items:flex-end;justify-content:center;width:100%}
.geo-gb-bar{width:28px;max-width:40%;border-radius:5px 5px 0 0;min-height:2px;position:relative;display:flex;justify-content:center;transition:height .4s}
.geo-gb-bar span{position:absolute;top:-16px;font-size:10.5px;font-weight:700;color:var(--muted);white-space:nowrap}
.geo-gb-lb{margin-top:7px;font-size:11.5px;font-weight:700;color:var(--muted)}
/* กราฟแท่งซ้อน 100% */
.geo-st{display:flex;flex-direction:column;gap:12px}
.geo-st-row{display:flex;align-items:center;gap:12px}
.geo-st-lb{width:200px;flex:none;display:flex;align-items:center;gap:8px;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.geo-st-track{flex:1;height:22px;border-radius:6px;overflow:hidden;display:flex;background:rgba(120,160,220,.1);min-width:0}
.geo-st-seg{height:100%;transition:width .4s}
.geo-st-empty{margin:auto;font-size:11.5px;color:var(--dim)}
/* mini progress bar คอลัมน์ความครอบคลุม */
.geo-covbar{height:5px;width:64px;border-radius:3px;background:rgba(120,160,220,.15);overflow:hidden;margin-top:4px}
.geo-covbar-f{height:100%;border-radius:3px;background:linear-gradient(90deg,#33d69f,#12b886);transition:width .4s}
/* ปุ่มคัดลอกข้อเสนอ */
.geo-copy{margin-left:auto;display:inline-flex;align-items:center;gap:5px;font-family:var(--font);font-size:11px;font-weight:600;
  text-transform:none;letter-spacing:0;padding:5px 11px;border-radius:8px;border:1px solid var(--stroke2);
  background:var(--surface);color:var(--muted);cursor:pointer;transition:.15s}
.geo-copy:hover{color:var(--accent);border-color:var(--accent2)}
@media(max-width:640px){.geo-st-lb{width:120px}}
`;

/* ═══════════════ รายงานความครอบคลุม (Coverage) — ออกแบบใหม่ 5 ส่วน ═══════════════
   1) แถบตัวชี้วัดหลัก  2) แผนที่วิเคราะห์แบบโต้ตอบ (ใช้ LeafletMap ซ้ำ)
   3) แผงเปรียบเทียบ 3 กราฟ  4) ตารางจัดอันดับโอกาส  5) กล่องสรุปข้อค้นพบ
   ทุกตัวเลขคำนวณจากข้อมูลจริง (db.customers/prospects/areas/districts) — ไม่มีค่าตายตัว */

// ระดับ Lead ของพื้นที่ — ใช้เกณฑ์เดียวกับ gapLevelOf() ในแบบจำลองกลาง
// (Barter Connect Appendix B): A = 80–100, B = 60–79, C = 0–59 — ไม่สร้างเกณฑ์ใหม่แยก
const areaGapLevel = gapLevelOf;   // ระดับ Lead ของพื้นที่ (สูง ≥67 · ปานกลาง ≥34 · ต่ำ)

// สไตล์ section "คุณภาพกลุ่มเป้าหมาย" ใต้ Donut ในหน้าสรุปแดชบอร์ด
// การ์ดซ้ายเป็น flex column + กราฟหมวดที่ขาดยืดเติมพื้นที่ → ความสูงเท่ากับตารางฝั่งขวาพอดี (grid stretch)
const SUMMARY_CSS = `
.card.sum-left{display:flex;flex-direction:column}
.sum-body{flex:1;display:flex;flex-direction:column}
.sum-divider{height:1px;background:var(--stroke);margin:16px 0 14px;flex:none}
.sum-grade-h{font-size:13.5px;font-weight:800;color:var(--txt);flex:none}
.sum-grade-sub{font-size:11.5px;color:var(--muted);margin:3px 0 14px;line-height:1.5;flex:none}
.sum-grade{flex:1;display:flex;flex-direction:column;justify-content:space-around;gap:10px;min-height:100px}
.sum-grade-row{display:flex;align-items:center;gap:10px}
.sum-grade-dot{width:12px;height:12px;border-radius:50%;flex:none}
.sum-grade-lb{width:150px;flex:none;font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sum-grade-track{flex:1;height:8px;border-radius:999px;background:rgba(120,160,220,.12);overflow:hidden;min-width:0}
.sum-grade-fill{height:100%;border-radius:999px;transition:width .5s}
.sum-grade-n{width:46px;flex:none;text-align:right;font-size:13px;font-weight:800;color:var(--txt)}
@media(max-width:900px){.sum-grade-lb{width:118px}}
`;

// จัดระดับพื้นที่ตาม % ความครอบคลุม เป็น 3 ระดับตามสเปก
function covBand(cov){
  if(cov>=70) return {label:t("พื้นที่อิ่มตัว", "Saturated area"), color:"#33d69f", tone:"good"};
  if(cov>=30) return {label:t("พื้นที่ยังเติมได้อีก", "Room to fill"), color:"#ffb02e", tone:"warn"};
  return {label:t("พื้นที่ Lead สูง", "High-Lead area"), color:"#ff5a3c", tone:"bad"};
}

// คำแนะนำเชิงปฏิบัติแบบ rule-based (ไม่ใช้ AI) — อิงระดับ Lead + % ความครอบคลุม
// ใช้สำนวนแนวเดียวกับคำแนะนำที่มีอยู่แล้วใน buildDistrictInsight()
function covRecommend(level, cov){
  if(level==="High") return cov<30 ? t("เร่งส่งทีมเข้าเติมหมวดที่ขาด", "Send a team in to fill the missing categories")
                        : cov<70 ? t("จัดทำแผนการเข้าพบตามหมวดที่ขาด", "Build a visit plan around the missing categories")
                        : t("รักษาสมาชิกเดิม พื้นที่อิ่มตัว", "Retain existing members — the area is saturated");
  if(level==="Medium") return cov<30 ? t("วางแผนการตลาดเฉพาะหมวดที่ขาด", "Plan marketing for the missing categories only")
                        : t("เพิ่มกิจกรรมกระตุ้นการแลกเปลี่ยน", "Run more activity to encourage exchanges");
  return t("เฝ้าติดตามเป็นระยะ Lead เหลือน้อย", "Check in periodically — few Leads remain");
}

function CoverageReport({db, f, k, nav, scope, setScope}){
  // scope = "All" (ทั้งประเทศ) หรือชื่อจังหวัด (โฟกัสจังหวัดเดียว) — คลิกแผนที่/ตารางเพื่อเจาะลึก
  // เลเยอร์แผนที่ 3 ชั้น (โครงเดียวกับที่ LeafletMap ในหน้าหลักใช้)
  const [layers, setLayers] = useState({heat:true, existing:true, prospect:true,
    op:{heat:76, existing:90, prospect:85}, radius:18});

  const distProvinces = new Set((db.districts||[]).map(d=>d.province));   // จังหวัดที่มีข้อมูลระดับเขต/อำเภอ
  const focused = scope!=="All";
  const noDistrictData = focused && !distProvinces.has(scope);

  // ── ตัวเลขรวมตามขอบเขตปัจจุบัน (เคารพตัวกรอง segment/status/score แต่คุมพื้นที่ด้วย scope) ──
  const scopedF = {...f, province: scope};
  const cs = db.customers.filter(c=>custPass(c, scopedF));
  const ps = db.prospects.filter(p=>prosPass(p, scopedF));
  const existing = cs.length, prospects = ps.length, market = existing+prospects;
  // สูตรตามสเปก: coverage% = existing / (existing + prospects) × 100 (ทศนิยม 2 ตำแหน่ง)
  const coverage = market ? (existing/market*100) : 0;

  // ── แถวจัดอันดับ: ระดับจังหวัดเมื่อดูทั้งประเทศ / ระดับเขต-อำเภอเมื่อโฟกัสจังหวัดเดียว ──
  const overAll = {...f, province:"All"};   // ตารางภาพรวมต้องไม่ถูกบีบด้วย f.province
  let rows;
  if(!focused){
    rows = db.areas.map(a=>{ const x=analyzeArea(db, a.province, overAll);
      return {key:a.province, name:provinceTH(a.province), province:a.province,
        cust:x.customerCount, pros:x.prospectCount, cov:x.coverage, opp:x.gapScore,
        gapCount:x.gapCount, gapBreadth:x.gapBreadth, topGapSegment:x.topGapSegment}; })
      .filter(r=>r.cust+r.pros>0);
  } else {
    rows = rankDistricts(db, overAll, "gapScore").filter(d=>d.province===scope)
      .map(d=>({key:d.province+"|"+d.district, name:districtTH(d.district), province:d.province,
        cust:d.customerCount, pros:d.prospectCount, cov:d.coverage, opp:d.gapScore,
        gapCount:d.gapCount, gapBreadth:d.gapBreadth, topGapSegment:d.topGapSegment}));
  }
  rows.forEach(r=>{ r.market=r.cust+r.pros; r.gapRai=r.gapCount;
    r.level=areaGapLevel(r.opp); r.band=covBand(r.cov); });
  const ranked  = [...rows].sort((a,b)=>b.gapRai-a.gapRai);                    // Lead (ราย) สูง→ต่ำ
  const chartAs = [...rows].sort((a,b)=>b.market-a.market).slice(0,8);         // เทียบเฉพาะ 8 พื้นที่ใหญ่สุด
  const gmax    = Math.max(1, ...chartAs.flatMap(r=>[r.cust, r.pros]));        // สเกลร่วมของกราฟแท่งคู่

  // การกระจายกลุ่มธุรกิจ (รวมลูกค้าปัจจุบัน + Lead) ในขอบเขตปัจจุบัน
  const segTotals = SEGMENTS.map(s=>({label:segTH(s), color:SEG_COLOR[s],
    value: cs.filter(c=>c.segment===s).length + ps.filter(p=>p.segment===s).length})).filter(x=>x.value>0);

  // ── ส่วนที่ 5: ค้นหาอัตโนมัติจากตารางจัดอันดับ (ไม่ hardcode ชื่อพื้นที่/ตัวเลข) ──
  const highGap  = ranked.filter(r=>r.level==="High");
  const saturated= ranked.filter(r=>r.cov>=70);
  // ดัชนี "พื้นที่ที่ยังไม่ถูกเจาะ" = Lead × (100 − ความครอบคลุม) → Leadเยอะ + ครอบคลุมต่ำ = สูงสุด
  const blind = [...ranked].sort((a,b)=> (b.pros*(100-b.cov)) - (a.pros*(100-a.cov)))[0];

  // filters สำหรับแผนที่ (memo ไว้ไม่ให้ identity เปลี่ยนทุกเฟรมโดยไม่จำเป็น)
  const mapFilters = useMemo(()=>({...f, province: scope}), [f, scope]);

  const areaWord = focused ? t("เขต/อำเภอ", "districts") : t("จังหวัด", "Province");
  const cardSt = {background:"var(--panel)",border:"1px solid var(--stroke)",borderRadius:"var(--r)",padding:"16px 18px",display:"flex",flexDirection:"column",gap:"7px"};
  const capSt  = {display:"flex",alignItems:"center",gap:"8px",color:"var(--muted)",fontSize:"12.5px",fontWeight:600};
  const bigSt  = {fontSize:"26px",fontWeight:800,color:"var(--txt)",lineHeight:1.1};

  return html`<div class="fade-in">
    <!-- ═════ ชั้น 2: Top KPI Cards Summary (4 กล่อง) — ลำดับที่ 2 ใต้ Header ═════ -->
    <div class="grid g4" style=${{marginBottom:"16px"}}>
      <div style=${cardSt}>
        <div style=${capSt}><${Icon} name="users" size=${15} color=${STATUS_COLOR.Existing}/>${t("ลูกค้าปัจจุบันทั้งหมด", "All existing customers")}</div>
        <div style=${bigSt}>${num(existing)}</div>
        <div class="dim" style=${{fontSize:"11.5px"}}>${t("รายที่เป็นลูกค้าแล้วในขอบเขตนี้", "already customers within this scope")}</div>
      </div>
      <div style=${cardSt}>
        <div style=${capSt}><${Icon} name="target" size=${15} color=${STATUS_COLOR.Prospect}/>${t("Leadทั้งหมด", "All Leads")}</div>
        <div style=${bigSt}>${num(prospects)}</div>
        <div class="dim" style=${{fontSize:"11.5px"}}>${t("ธุรกิจเป้าหมายที่ยังไม่เป็นลูกค้า", "Target businesses that are not customers yet")}</div>
      </div>
      <div style=${cardSt}>
        <div style=${capSt}><${Icon} name="coverage" size=${15} color="#33d69f"/>${t("อัตราความครอบคลุมตลาดโดยรวม", "Overall market coverage rate")}</div>
        <div style=${bigSt}>${coverage.toFixed(2)}%</div>
        <div class="dim" style=${{fontSize:"11.5px"}}>${t("ลูกค้าปัจจุบัน ÷ (ลูกค้า + Lead) × 100", "existing customers ÷ (customers + Leads) × 100")}</div>
      </div>
      <div style=${cardSt}>
        <div style=${capSt}><${Icon} name="gap" size=${15} color="#ff8f3c"/>${t("มูลค่าโอกาสที่ยังเข้าไม่ถึง", "Opportunity not yet reached")}</div>
        <div style=${bigSt}>${num(prospects)} <span style=${{fontSize:"14px",fontWeight:600,color:"var(--muted)"}}>${t("ราย", "businesses")}</span></div>
        <!-- ระบบไม่เก็บ "มูลค่าเป็นเงิน" ทั้งของ Lead และลูกค้า (ข้อมูลลูกค้าจริงจาก Barter ไม่มียอดขาย)
             จึงแสดงเป็นจำนวนLeadที่ยังไม่ถูกแปลงเป็นลูกค้าแทน — เป็นตัวเลขจริงที่วัดได้ ไม่ปั้นค่าเงินปลอม -->
        <div class="dim" style=${{fontSize:"11.5px"}}>${t("Leadที่ยังไม่ถูกแปลงเป็นลูกค้า (ยังไม่มีข้อมูลมูลค่าเงินในระบบ)", "Leads not yet converted (the system holds no monetary values)")}</div>
      </div>
    </div>

    <!-- ═════ ชั้น 3: Contextual Bar — ขอบเขต (ทั้งประเทศ/จังหวัด) + ปุ่มกลับสู่ภาพรวม (ใต้ KPI ตาม pattern มาตรฐาน) ═════ -->
    <div class="cov-note">
      <${Icon} name="coverage" size=${15} color="var(--accent)"/>
      <span>${t("ขอบเขต:", "Scope:")} <b>${focused ? provinceTH(scope) : t("ทั้งประเทศไทย", "All of Thailand")}</b> · ${num(rows.length)} ${areaWord}${t("ที่มีข้อมูล", " with data")}</span>
      ${focused && html`<button class="cov-back" onClick=${()=>setScope("All")}>${t("← ดูภาพรวมทั้งประเทศ", "← See the national overview")}</button>`}
    </div>

    <!-- ═════ ส่วนที่ 2: แผนที่วิเคราะห์ความครอบคลุมแบบโต้ตอบ ═════ -->
    <${Card} title=${t("แผนที่วิเคราะห์ความครอบคลุม", "Coverage analysis map")}
      sub=${t("คลิกพื้นที่บนแผนที่เพื่อเจาะลึก ประเทศ → จังหวัด → เขต/อำเภอ · เปิด/ปิดชั้นข้อมูลได้ 3 ชั้น", "Click an area to drill in: country → province → district · three layers can be toggled")} style=${{marginBottom:"16px"}}>
      <div class="cov-layers">
        <label class="cov-lyr"><span class="cov-sw" style=${{background:STATUS_COLOR.Existing}}></span>
          <span>${t("ลูกค้าปัจจุบัน", "Existing customers")}</span><${Toggle} on=${layers.existing!==false} onChange=${()=>setLayers(x=>({...x,existing:x.existing===false}))}/></label>
        <label class="cov-lyr"><span class="cov-sw" style=${{background:STATUS_COLOR.Prospect}}></span>
          <span>Lead</span><${Toggle} on=${layers.prospect!==false} onChange=${()=>setLayers(x=>({...x,prospect:x.prospect===false}))}/></label>
        <label class="cov-lyr"><span class="cov-sw" style=${{background:"linear-gradient(90deg,#2b6fff,#26e07a,#ffb02e,#ff3b1e)"}}></span>
          <span>${t("ความหนาแน่น (Heatmap)", "Density (heatmap)")}</span><${Toggle} on=${layers.heat!==false} onChange=${()=>setLayers(x=>({...x,heat:x.heat===false}))}/></label>
      </div>
      <div class="cov-map">
        <${LeafletMap} db=${db} filters=${mapFilters} layers=${layers} country="Thailand"
          onPickArea=${p=>setScope(p)} onPickCustomer=${()=>{}}/>
      </div>
      ${noDistrictData && html`<div class="cov-fallback">
        <${Icon} name="info" size=${14} color="var(--muted)"/> ${t("ยังไม่มีข้อมูลระดับเขต/อำเภอสำหรับ", "No district-level data yet for ")}${provinceTH(scope)} —
        ${t("ปัจจุบันมีเฉพาะ กรุงเทพฯ, เชียงใหม่, ภูเก็ต และพัทยา", "currently only Bangkok, Chiang Mai, Phuket and Pattaya are covered")}</div>`}
    </${Card}>

    <!-- ═════ ส่วนที่ 3: แผงวิเคราะห์เปรียบเทียบ (3 กราฟ) ═════ -->
    ${chartAs.length===0 ? html`<div class="emptybox" style=${{marginBottom:"16px"}}>${t("ไม่มีข้อมูลพื้นที่ตามตัวกรองปัจจุบัน", "No area data matches the current filters")}</div>` : html`
    <div class="grid g2" style=${{marginBottom:"16px"}}>
      <!-- 3.1 กราฟแท่งคู่ Existing vs Prospect -->
      <${Card} title=${t("ลูกค้าปัจจุบันเทียบLead", "Existing customers vs. Leads")} sub=${t("แยกราย", "By")+areaWord+" · "+num(chartAs.length)+t(" พื้นที่ที่มีธุรกิจมากสุด", " areas with the most businesses")}>
        <div class="cov-legend">
          <span><span class="cov-dot" style=${{background:STATUS_COLOR.Existing}}></span>${t("ลูกค้าปัจจุบัน", "Existing customers")}</span>
          <span><span class="cov-dot" style=${{background:STATUS_COLOR.Prospect}}></span>Lead</span>
        </div>
        <div class="cov-gb">
          ${chartAs.map(r=>html`<div key=${r.key} class="cov-grow">
            <div class="cov-glabel" title=${r.name}>${r.name}</div>
            <div class="cov-gcol">
              <div class="cov-gtrack"><div class="cov-gfill" style=${{width:(r.cust/gmax*100)+"%",background:STATUS_COLOR.Existing}}></div><span class="cov-gval">${num(r.cust)}</span></div>
              <div class="cov-gtrack"><div class="cov-gfill" style=${{width:(r.pros/gmax*100)+"%",background:STATUS_COLOR.Prospect}}></div><span class="cov-gval">${num(r.pros)}</span></div>
            </div>
          </div>`)}
        </div>
      </${Card}>
      <!-- 3.2 การเจาะตลาด & ช่องว่างโอกาส (bullet) -->
      <${Card} title=${t("อัตราการเจาะตลาด & ช่องว่างโอกาส", "Penetration rate and opportunity gap")} sub=${t("% ความครอบคลุมเทียบเป้าหมาย 100% · สีบอกระดับพื้นที่", "% coverage against a 100% target · colour shows the area's level")}>
        <div class="cov-bullet">
          ${chartAs.map(r=>html`<div key=${r.key} class="cov-brow">
            <div class="cov-blabel" title=${r.name}>${r.name}</div>
            <div class="cov-btrack"><div class="cov-bfill" style=${{width:Math.min(100,r.cov)+"%",background:r.band.color}}></div></div>
            <div class="cov-bval">${r.cov}%</div>
            <${Badge} tone=${r.band.tone}>${r.band.label}</${Badge}>
          </div>`)}
        </div>
      </${Card}>
    </div>
    <!-- 3.3 การกระจายกลุ่มธุรกิจ (Donut) -->
    <${Card} title=${t("การกระจายกลุ่มธุรกิจ", "Business segment mix")} sub=${t("รวมลูกค้าปัจจุบันและLeadในขอบเขตปัจจุบัน", "Existing customers and Leads combined, within the current scope")} style=${{marginBottom:"16px"}}>
      ${segTotals.length ? html`<${Donut} data=${segTotals} center=${{value:market,label:t("ธุรกิจ", "Business")}}/>`
                         : html`<div class="emptybox">${t("ไม่มีข้อมูล", "No data")}</div>`}
    </${Card}>`}

    <!-- ═════ ส่วนที่ 4: ตารางจัดอันดับโอกาส ═════ -->
    ${ranked.length>0 && html`<${Card} title=${t("ตารางจัดอันดับ Lead", "Lead ranking table")}
      sub=${t("เรียงตามจำนวนที่ยังขาด สูง→ต่ำ · ", "Sorted by the remaining gap, largest first · ")+(focused?t("คลิกไม่ได้ในระดับเขต", "not clickable at district level"):t("คลิกแถวจังหวัดเพื่อเจาะลึก", "click a province row to drill in"))} pad0=${true} style=${{marginBottom:"16px"}}>
      <${Table} onRow=${!focused ? (r=>setScope(r.province)) : undefined} cols=${[
        {h: focused?t("เขต/อำเภอ", "districts"):t("จังหวัด", "Province"), render:r=>html`<b>${r.name}</b>`},
        {h:t("ลูกค้าปัจจุบัน", "Existing customers"), render:r=>num(r.cust)},
        {h:"Lead", render:r=>num(r.pros)},
        {h:t("รวมธุรกิจในพื้นที่", "Total businesses in the area"), render:r=>num(r.market)},
        {h:t("% ความครอบคลุม", "% coverage"), render:r=>html`<b>${r.cov}%</b>`},
        {h:t("ยังขาด (ราย)", "Still short"), render:r=>html`<span style=${{color:STATUS_COLOR.Prospect,fontWeight:700}}>+${num(r.gapRai)}</span>`},
        {h:t("ระดับช่องว่าง", "Gap level"), render:r=>html`<${Badge} tone=${r.level==="High"?"bad":r.level==="Medium"?"warn":"good"}>${gapTH(r.level)} · ${r.opp}</${Badge}>`},
        {h:t("คำแนะนำ", "Recommendation"), render:r=>html`<span style=${{fontSize:"12.5px"}}>${covRecommend(r.level, r.cov)}</span>`},
      ]} rows=${ranked}/>
    </${Card}>`}

    <!-- ═════ ส่วนที่ 5: กล่องสรุปข้อค้นพบ ═════ -->
    ${blind && html`<div class="cov-insight">
      <div class="cov-ins-block">
        <div class="cov-ins-h"><${Icon} name="bolt" size=${15} color="#ffb02e"/> ${t("ข้อค้นพบสำคัญ", "Key findings")}</div>
        <div class="cov-ins-body">${t("อัตราความครอบคลุมตลาด", "Market coverage ")}${focused?(t("ใน", "in")+provinceTH(scope)):t("โดยรวมทั้งประเทศ", "nationwide ")}${t("อยู่ที่", "stands at")}
          <b>${coverage.toFixed(2)}%</b> ${t("— พื้นที่ที่มีLeadกระจุกตัวสูงแต่ความครอบคลุมยังต่ำที่สุดคือ", "— the area with the densest Leads but the lowest coverage is")}
          <b>${blind.name}</b> (Lead ${num(blind.pros)} ${t("ราย · ครอบคลุมเพียง", "businesses · only")} ${blind.cov}${t("%) จึงเป็นพื้นที่ที่ควรให้ความสำคัญเป็นอันดับต้น", "% coverage), so it deserves top priority")}</div>
      </div>
      <div class="cov-ins-block">
        <div class="cov-ins-h"><${Icon} name="target" size=${15} color="#33d69f"/> ${t("กลยุทธ์ที่แนะนำ", "Recommended strategy")}</div>
        <div class="cov-ins-body">
          <div>${t("• มุ่งพื้นที่ Lead สูงก่อน: มี", "• Go for high-Lead areas first: there are")} <b>${num(highGap.length)}</b> ${areaWord}${t("ที่อยู่ระดับสูง", " at a high level,")}${highGap.length?html` ${t("เช่น", "such as")} ${highGap.slice(0,3).map(r=>r.name).join(", ")}`:""}</div>
          <div style=${{marginTop:"4px"}}>${t("• ลดงบพื้นที่อิ่มตัว: มี", "• Cut spend in saturated areas: there are")} <b>${num(saturated.length)}</b> ${areaWord}${t("ที่ความครอบคลุมเกิน 70%", " with coverage above 70%")}${saturated.length?html` (${saturated.slice(0,3).map(r=>r.name).join(", ")})`:""}</div>
        </div>
      </div>
    </div>`}
    <style>${COV_CSS}</style>
  </div>`;
}

const COV_CSS = `
.cov-note{display:flex;align-items:center;gap:9px;margin-bottom:14px;padding:9px 14px;font-size:12.5px;color:var(--txt);
  background:var(--panel);border:1px solid var(--stroke);border-radius:var(--r)}
.cov-back{margin-left:auto;padding:6px 12px;border-radius:8px;border:1px solid var(--stroke2);background:transparent;
  color:var(--accent);cursor:pointer;font-family:var(--font);font-size:12px;font-weight:600}
.cov-back:hover{background:var(--accent-soft)}
.cov-layers{display:flex;flex-wrap:wrap;gap:10px 22px;margin-bottom:12px}
.cov-lyr{display:flex;align-items:center;gap:9px;font-size:12.5px;color:var(--txt);cursor:pointer}
.cov-sw{width:22px;height:10px;border-radius:5px;flex:none}
.cov-map{height:460px;border-radius:12px;overflow:hidden;border:1px solid var(--stroke2);position:relative}
.cov-map .leaflet-container{height:100%;width:100%;background:var(--surface)}
.cov-fallback{display:flex;align-items:center;gap:7px;margin-top:10px;padding:9px 13px;font-size:12.5px;color:var(--muted);
  background:rgba(255,176,46,.08);border:1px solid rgba(255,176,46,.28);border-radius:9px}
.cov-legend{display:flex;gap:18px;margin-bottom:12px;font-size:12px;color:var(--muted)}
.cov-legend .cov-dot{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:middle}
.cov-gb{display:flex;flex-direction:column;gap:12px}
.cov-grow{display:flex;align-items:center;gap:10px}
.cov-glabel{width:96px;flex:none;font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cov-gcol{flex:1;display:flex;flex-direction:column;gap:4px;min-width:0}
.cov-gtrack{display:flex;align-items:center;gap:7px;height:13px}
.cov-gfill{height:13px;border-radius:4px;min-width:2px;transition:width .5s}
.cov-gval{font-size:11px;font-weight:700;color:var(--muted);flex:none}
.cov-bullet{display:flex;flex-direction:column;gap:12px}
.cov-brow{display:flex;align-items:center;gap:10px}
.cov-blabel{width:96px;flex:none;font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cov-btrack{flex:1;height:8px;border-radius:999px;background:rgba(120,160,220,.12);overflow:hidden;min-width:0}
.cov-bfill{height:100%;border-radius:999px;transition:width .5s}
.cov-bval{width:44px;flex:none;text-align:right;font-size:12px;font-weight:700;color:var(--txt)}
.cov-insight{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px}
.cov-ins-block{background:linear-gradient(135deg,rgba(230, 0, 35,.07),rgba(230, 0, 35,.02));
  border:1px solid var(--stroke);border-radius:var(--r);padding:15px 17px}
.cov-ins-h{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:800;color:var(--txt);
  margin-bottom:8px;text-transform:uppercase;letter-spacing:.4px}
.cov-ins-body{font-size:13px;line-height:1.65;color:var(--txt)}
@media(max-width:820px){.cov-insight{grid-template-columns:1fr}}
`;

// ── รายงาน Lead — 4 ส่วน: การ์ดสรุป · แผนภาพ · ตารางเจาะลึก · ตัวกรอง ──
// ดีลสร้างจากLeadจริง (open pipeline) มูลค่าประเมินจากยอดขายเฉลี่ยของสมาชิกในพื้นที่
function OpportunityReport({db, f, k}){
  const [region,setRegion]   = useState(f.province && f.province!=="All" ? f.province : "All");
  const [segment,setSegment] = useState("All");
  const [dFrom,setDFrom]     = useState("");
  const [dTo,setDTo]         = useState("");
  // ── ตาราง "Lead จัดลำดับตาม Lead ของหมวดในพื้นที่" ──
  const [q, setQ]             = useState("");           // ค้นหาชื่อ/รหัส
  const [pGapOnly, setPGapOnly] = useState("All");      // ทั้งหมด / เฉพาะหมวดที่ยังขาด
  const [pSeg, setPSeg]       = useState("All");        // ตัวกรองกลุ่มธุรกิจ
  const [pSort, setPSort]     = useState("segGap");     // เรียงเริ่มต้นตามขนาดช่องว่างของหมวด
  const [pDir, setPDir]       = useState("desc");
  const [perPage, setPerPage] = useState(25);           // จำนวนต่อหน้า 10/25/50/100
  const [page, setPage]       = useState(1);

  const provinces = [...new Set(db.prospects.map(p=>p.province))].sort();
  const regCusts = db.customers.filter(c=> region==="All" || c.province===region);
  // เดิมมี avgSale (ยอดขายเฉลี่ยต่อลูกค้า) ใช้คูณเป็น "มูลค่าโอกาส" — ถอดออกแล้ว
  // ข้อมูลลูกค้าจริงจาก Barter ไม่มียอดขาย รายงานนี้จึงวัดโอกาสเป็น "จำนวนราย" ล้วน

  // ── Lead รายหมวด ต่อจังหวัด — ฐานของทั้งหน้านี้ (ไม่มีคะแนนรายบริษัท) ──
  const gapByProv = {};
  for(const pv of provinces){
    gapByProv[pv] = Object.fromEntries(gapBySegment(
      db.customers.filter(c=>c.province===pv), db.prospects.filter(x=>x.province===pv)).map(x=>[x.seg,x.gap]));
  }
  const gapOf = r => (gapByProv[r.province]||{})[r.segment]||0;
  const maxGap = Math.max(1, ...db.prospects.map(gapOf));
  // สถานะ/กำหนดปิด อิงขนาดช่องว่างของหมวดในจังหวัดนั้น (ยิ่งขาดมาก ยิ่งควรเร่ง)
  const stOf = g => g>=maxGap*0.6 ? {th:t("ควรเร่งเติม", "Fill urgently"),tone:"good"} : g>=maxGap*0.25 ? {th:t("เฝ้าติดตาม", "Monitor"),tone:"warn"} : {th:t("หมวดใกล้ครบ", "Nearly complete"),tone:"info"};
  const closeOf = (g,idx)=>{ let mm = 6 + 1 + ((Math.round(120 - Math.min(120, g/maxGap*120)) + idx) % 6), yy = 2026;
    while(mm>11){ mm-=12; yy++; }
    return {iso:`${yy}-${String(mm+1).padStart(2,"0")}-15`, label:`${TH_MONTHS[mm]} ${yy}`}; };   // ใช้ตารางเดือนกลาง

  const deals = db.prospects.map((p,i)=>{ const g=gapOf(p), st=stOf(g), cd=closeOf(g,i);
    return {id:p.id,name:p.businessName,province:p.province,district:p.district,segment:p.segment,segGap:g,
      status:st.th,tone:st.tone,closeIso:cd.iso,close:cd.label,won:false}; });

  const segOk = d => segment==="All" || d.segment===segment;
  const regOk = d => region==="All" || d.province===region;
  const dateOk = d => (!dFrom || (d.closeIso && d.closeIso>=dFrom)) && (!dTo || (d.closeIso && d.closeIso<=dTo));
  const openF = deals.filter(d=>regOk(d)&&segOk(d)&&dateOk(d));


  const custN = regCusts.filter(segOk).length;
  const ratio = custN ? openF.length/custN : openF.length;
  const fSeg = segment==="All" ? f.segments : segOnly(segment);
  const areaGap = region!=="All" ? analyzeArea(db, region, {...f, segments:fSeg}) : k;
  const gapKey = areaGap.gapLevel;
  const gapTone = gapKey==="High" ? "bad" : gapKey==="Medium" ? "warn" : "good";
  const oppScore = areaGap.gapScore;

  // Viz 1 — โอกาสตามภูมิภาค (จังหวัดเมื่อดูรวม / อำเภอเมื่อเลือกจังหวัด)
  const gk = region==="All" ? "province" : "district";
  // นับ "จำนวน Lead" ต่อพื้นที่ แทนการรวมมูลค่าเป็นเงินแบบเดิม
  const byReg = {}; openF.forEach(d=>{ const key=d[gk]||t("อื่นๆ","Other"); byReg[key]=(byReg[key]||0)+1; });
  const regionData = Object.entries(byReg).sort((a,b)=>b[1]-a[1]).slice(0,8)
    .map(([key,v])=>({label: region==="All"?provinceTH(key):districtTH(key), value:v}));
  // Viz 2 — โอกาสตามกลุ่มลูกค้า
  const bySeg = SEGMENTS.map(s=>({label:segTH(s), value:openF.filter(d=>d.segment===s).length, color:SEG_COLOR[s]})).filter(x=>x.value>0);

  // ── ข้อมูลตาราง Lead: เฉพาะ Lead · ตัวเลขที่แสดงคือช่องว่างของ "หมวดในจังหวัดนั้น" ไม่ใช่คะแนนรายบริษัท ──
  const qNorm = q.trim().toLowerCase();
  const proAll = db.prospects.map(p=>({...p, segGap:gapOf(p)})).filter(p=>
    (pGapOnly==="All" || p.segGap>0) &&
    (pSeg==="All"   || p.segment===pSeg) &&
    (!qNorm || p.businessName.toLowerCase().includes(qNorm) || p.id.toLowerCase().includes(qNorm)));
  const proSortBy = key => { if(pSort===key) setPDir(d=>d==="asc"?"desc":"asc");
    else { setPSort(key); setPDir(["businessName","province","segment"].includes(key)?"asc":"desc"); } setPage(1); };
  const proArrow = key => pSort===key ? (pDir==="asc"?" ▲":" ▼") : "";
  const proSorted = [...proAll].sort((a,b)=>{ let av=a[pSort], bv=b[pSort];
    if(pSort==="province"){ av=provinceTH(a.province); bv=provinceTH(b.province); }
    else if(pSort==="segment"){ av=segTH(a.segment); bv=segTH(b.segment); }
    if(typeof av==="string" && typeof bv==="string") return pDir==="asc"?av.localeCompare(bv,"th"):bv.localeCompare(av,"th");
    return pDir==="asc" ? (av-bv) : (bv-av); });
  const proTotal = proSorted.length;
  const proPages = Math.max(1, Math.ceil(proTotal/perPage));
  const curPage  = Math.min(page, proPages);
  const proStart = proTotal ? (curPage-1)*perPage : 0;
  const proRows  = proSorted.slice(proStart, proStart+perPage);
  const showFrom = proTotal ? proStart+1 : 0;
  const showTo   = Math.min(proStart+perPage, proTotal);

  const cardSt = {background:"var(--panel)",border:"1px solid var(--stroke)",borderRadius:"var(--r)",padding:"16px 18px",display:"flex",flexDirection:"column",gap:"7px"};
  const capSt  = {display:"flex",alignItems:"center",gap:"8px",color:"var(--muted)",fontSize:"12.5px",fontWeight:600};
  const bigSt  = {fontSize:"26px",fontWeight:800,color:"var(--txt)",lineHeight:1.1};

  return html`<div class="fade-in">
    <!-- 1) การ์ดสรุป -->
    <div class="grid g4" style=${{marginBottom:"16px"}}>
      <div style=${cardSt}>
        <div style=${capSt}><${Icon} name="gap" size=${15} color="#ffb02e"/>${t("ยังขาด (ราย)", "Still short")}</div>
        <div style=${bigSt}>${num(areaGap.gapCount)}</div>
        <div class="dim" style=${{fontSize:"11.5px"}}>${t("ขนาด Lead รวมของพื้นที่ที่เลือก", "Total Lead volume in the selected area")}</div>
      </div>
      <div style=${cardSt}>
        <div style=${capSt}><${Icon} name="users" size=${15} color="#38bdf8"/>${t("จำนวนโอกาส", "Opportunities")}</div>
        <div style=${bigSt}>${num(openF.length)}</div>
        <div class="dim" style=${{fontSize:"11.5px"}}>${t("ดีลที่ยังเปิดอยู่ (Lead)", "Open deals (Leads)")}</div>
      </div>
      <div style=${cardSt}>
        <div style=${capSt}><${Icon} name="target" size=${15} color="#33d69f"/>${t("คะแนนโอกาส", "Opportunity score")}</div>
        <div style=${{display:"grid",placeItems:"center"}}><${Gauge} value=${oppScore} size=${108}/></div>
      </div>
      <div style=${cardSt}>
        <div style=${capSt}><${Icon} name="gap" size=${15} color="#8a7bff"/>${t("ช่องว่าง", "Gap")}</div>
        <div style=${{marginTop:"2px"}}><${Badge} tone=${gapTone}>${gapTH(gapKey)}</${Badge}></div>
        <div class="dim" style=${{fontSize:"11.5px"}}>${t("Leadต่อลูกค้า", "Leads per customer")} ${ratio.toFixed(1)} : 1</div>
      </div>
    </div>

    <!-- 4) ตัวกรอง (slicers) -->
    <div class="op-slicers">
      <label class="op-lab">${t("ภูมิภาค", "Region")}
        <select class="op-sel" value=${region} onChange=${e=>setRegion(e.target.value)}>
          <option value="All">${t("ทุกจังหวัด", "All provinces")}</option>
          ${provinces.map(p=>html`<option key=${p} value=${p}>${provinceTH(p)}</option>`)}
        </select></label>
      <label class="op-lab">${t("กลุ่มธุรกิจ", "Business segment")}
        <select class="op-sel" value=${segment} onChange=${e=>setSegment(e.target.value)}>
          <option value="All">${t("ทุกกลุ่ม", "All segments")}</option>
          ${SEGMENTS.map(s=>html`<option key=${s} value=${s}>${segTH(s)}</option>`)}
        </select></label>
      <label class="op-lab">${t("คาดปิดตั้งแต่", "Expected to close from")}
        <${DateField} className="op-sel" value=${dFrom} onChange=${setDFrom}/></label>
      <label class="op-lab">${t("ถึง", "to")}
        <${DateField} className="op-sel" value=${dTo} onChange=${setDTo}/></label>
      ${(region!=="All"||segment!=="All"||dFrom||dTo) && html`<button class="op-clear" onClick=${()=>{setRegion("All");setSegment("All");setDFrom("");setDTo("");}}>${t("ล้างตัวกรอง", "Clear filters")}</button>`}
    </div>

    <!-- 2) แผนภาพ (2 คอลัมน์) -->
    <div class="grid g2" style=${{marginBottom:"16px"}}>
      <${Card} title=${t("โอกาสตามภูมิภาค", "Opportunity by region")} sub=${region==="All"?t("จำนวน Lead แยกตามจังหวัด", "Lead counts by province"):t("แยกตามอำเภอใน ", "By district in ")+provinceTH(region)}>
        ${regionData.length ? html`<${BarChart} data=${regionData} horizontal=${true} format=${v=>num(v)+t(" ราย", " businesses")}/>`
                            : html`<div class="emptybox">${t("ไม่มีข้อมูลตามตัวกรองที่เลือก", "No data matches the current filters")}</div>`}
      </${Card}>
      <${Card} title=${t("โอกาสตามกลุ่มลูกค้า", "Opportunity by customer segment")} sub=${t("สัดส่วนจำนวนดีลแยกตามประเภทธุรกิจ", "Share of deals by business type")}>
        ${bySeg.length ? html`<${Donut} data=${bySeg} center=${{value:openF.length,label:t("ดีล", "deals")}}/>`
                       : html`<div class="emptybox">${t("ไม่มีข้อมูลตามตัวกรองที่เลือก", "No data matches the current filters")}</div>`}
      </${Card}>
    </div>

    <!-- 3) ตารางจัดลำดับ Lead ตาม Lead ของหมวดในจังหวัดนั้น -->
    <${Card} title=${t("Lead จัดลำดับตาม Lead ของหมวดธุรกิจ", "Leads ranked by their category's Lead index")}
      sub=${`${t("ช่องว่าง = จำนวน Lead ในหมวดนั้น − จำนวนสมาชิกเครือข่ายในหมวดเดียวกันของจังหวัดนั้น · เฉพาะ Lead · คลิกหัวคอลัมน์เพื่อเรียงลำดับ", "Gap = Leads in that category − network members in the same category in that province · Leads only · click a column header to sort")}`} pad0=${true}>
      <!-- แถบควบคุม: ค้นหา + ขอบเขต + กลุ่มธุรกิจ + จำนวนต่อหน้า -->
      <div class="op-tbar">
        <div class="op-search">
          <${Icon} name="search" size=${15} color="var(--muted)"/>
          <input placeholder=${t("ค้นหาชื่อLead / รหัส…", "Search Lead name or ID…")} value=${q} onInput=${e=>{setQ(e.target.value);setPage(1);}}/>
        </div>
        <label class="op-tf">${t("ขอบเขต", "Scope")}
          <select value=${pGapOnly} onChange=${e=>{setPGapOnly(e.target.value);setPage(1);}}>
            <option value="All">${t("ทุก Lead", "All Leads")}</option>
            <option value="gap">${t("เฉพาะหมวดที่ยังขาด", "Under-served categories only")}</option>
          </select></label>
        <label class="op-tf">${t("กลุ่มธุรกิจ", "Business segment")}
          <select value=${pSeg} onChange=${e=>{setPSeg(e.target.value);setPage(1);}}>
            <option value="All">${t("ทุกกลุ่ม", "All segments")}</option>
            ${SEGMENTS.map(s=>html`<option key=${s} value=${s}>${segTH(s)}</option>`)}
          </select></label>
        <label class="op-tf">${t("แสดงต่อหน้า", "Per page")}
          <select value=${perPage} onChange=${e=>{setPerPage(+e.target.value);setPage(1);}}>
            ${[10,25,50,100].map(n=>html`<option key=${n} value=${n}>${n}</option>`)}
          </select></label>
      </div>
      <div style=${{overflowX:"auto"}}>
        <table class="op-table">
          <thead><tr>
            <th onClick=${()=>proSortBy("businessName")}>${t("ชื่อสถานที่", "Place name ")}${proArrow("businessName")}</th>
            <th onClick=${()=>proSortBy("province")}>${t("จังหวัด/เขต", "Province / district ")}${proArrow("province")}</th>
            <th onClick=${()=>proSortBy("segment")}>${t("กลุ่มธุรกิจ", "Business segment ")}${proArrow("segment")}</th>
            <th onClick=${()=>proSortBy("email")}>${t("อีเมล", "Email ")}${proArrow("email")}</th>
            <th onClick=${()=>proSortBy("segGap")} style=${{textAlign:"right"}}>${t("หมวดนี้ยังขาด (ราย)", "Category gap ")}${proArrow("segGap")}</th>
          </tr></thead>
          <tbody>
            ${proRows.map(p=>html`
              <tr key=${p.id} class="op-row">
                <td><b>${p.businessName}</b> <span class="dim" style=${{fontSize:"11px"}}>${p.id}</span></td>
                <td>${provinceTH(p.province)}${p.district ? html`<span class="dim" style=${{fontSize:"11px"}}> · ${districtTH(p.district)}</span>` : ""}</td>
                <td><${SegmentBadge} seg=${p.segment}/></td>
                <td><span class="dim" style=${{fontSize:"11.5px"}}>${p.email||"—"}</span></td>
                <td style=${{textAlign:"right",fontWeight:800,color:"var(--txt)"}}>${num(p.segGap)}</td>
              </tr>
            `)}
            ${proRows.length===0 && html`<tr><td colspan="5"><div class="emptybox" style=${{margin:"14px"}}>${t("ไม่พบLeadตามเงื่อนไขที่เลือก", "No Leads match the current filters")}</div></td></tr>`}
          </tbody>
        </table>
      </div>
      <!-- แถบเลื่อนหน้า -->
      <div class="op-pager">
        <span class="dim" style=${{fontSize:"12px"}}>${t("แสดง", "Showing")} ${num(showFrom)}-${num(showTo)} ${t("จาก", "of")} ${num(proTotal)} ${t("รายการ", "records")}</span>
        <div class="op-pg-grp">
          <button class="op-pg" disabled=${curPage<=1} onClick=${()=>setPage(curPage-1)}>${t("‹ ก่อนหน้า", "‹ Previous")}</button>
          <span class="dim" style=${{fontSize:"12px"}}>${t("หน้า", "Page")} ${curPage} / ${proPages}</span>
          <button class="op-pg" disabled=${curPage>=proPages} onClick=${()=>setPage(curPage+1)}>${t("ถัดไป ›", "Next ›")}</button>
        </div>
      </div>
    </${Card}>

    <style>${OP_CSS}</style>
  </div>`;
}
// หมายเหตุ: คลาสของแถบตัวกรอง (.op-slicers/.op-lab/.op-sel/.op-clear) ย้ายไปไว้ที่ CSS ส่วนกลางใน index.html แล้ว
// เพราะเดิมประกาศไว้ตรงนี้ ซึ่งถูกฉีดเข้าหน้าเฉพาะตอนที่หน้ารายงานโอกาสถูกวาดเท่านั้น หน้าอื่นจึงใช้คลาสชุดเดียวกันไม่ได้
// ย้ายแล้วประกาศอยู่ที่เดียว ใช้ร่วมกันได้ทุกหน้า และหน้ารายงานโอกาสยังหน้าตาเหมือนเดิมทุกประการ
const OP_CSS = `
.op-table{width:100%;border-collapse:collapse;font-size:12.5px}
.op-table th{text-align:left;padding:11px 15px;color:var(--dim);font-weight:700;font-size:11.5px;
  border-bottom:1px solid var(--stroke);cursor:pointer;white-space:nowrap;user-select:none}
.op-table th:hover{color:var(--txt)}
.op-table td{padding:11px 15px;border-bottom:1px solid var(--stroke);color:var(--txt);vertical-align:middle}
.op-row{transition:background .12s}
.op-row:hover{background:rgba(120,160,220,.06)}
.op-detail>td{background:rgba(120,160,220,.05)}
/* แถบควบคุมตารางLead: ค้นหา + ตัวกรอง + จำนวนต่อหน้า */
.op-tbar{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;padding:12px 15px;border-bottom:1px solid var(--stroke)}
.op-search{display:flex;align-items:center;gap:7px;flex:1;min-width:220px;padding:8px 11px;border-radius:9px;
  border:var(--dropdown-border);background:var(--dropdown-bg);box-shadow:var(--dropdown-shadow)}
.op-search input{flex:1;border:0;outline:0;background:transparent;color:var(--dropdown-text);font-family:var(--font);font-size:12.5px}
.op-tf{display:flex;flex-direction:column;gap:4px;font-size:11.5px;font-weight:700;color:var(--dim)}
.op-tf select{padding:8px 10px;border-radius:9px;border:var(--dropdown-border);background:var(--dropdown-bg);color:var(--dropdown-text);
  box-shadow:var(--dropdown-shadow);font-family:var(--font);font-size:12.5px;min-width:128px}
/* แถบเลื่อนหน้า */
.op-pager{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;padding:12px 15px;border-top:1px solid var(--stroke)}
.op-pg-grp{display:flex;align-items:center;gap:12px}
.op-pg{padding:7px 14px;border-radius:9px;border:1px solid var(--stroke2);background:transparent;color:var(--txt);
  cursor:pointer;font-family:var(--font);font-size:12.5px}
.op-pg:hover:not(:disabled){border-color:rgba(120,160,220,.45)}
.op-pg:disabled{opacity:.4;cursor:not-allowed}
`;

function renderReport(id, {db,f,k,rankOpp,rankCov,rankGap,rankOppDist,rankGapDist,nav,visitPlans,office,expandedPlanId,setExpandedPlanId,deletePlan,setActivePlanId,areaTab,setAreaTab,areaProv,setAreaProv,areaSeg,setAreaSeg}){
  if(id==="summary"){
    const segTotals = SEGMENTS.map(s=>({label:segTH(s), value:
      db.customers.filter(c=>c.segment===s).length+db.prospects.filter(p=>p.segment===s).length, color:SEG_COLOR[s]}));
    // ── หมวดธุรกิจที่เครือข่ายยังขาด: ใช้ตัวกรองชุดเดียวกับ globalKpis (segment/status)
    const cusF  = db.customers.filter(c=> f.segments[c.segment] && f.status.Existing);
    const prosF = db.prospects.filter(p=> f.segments[p.segment] && f.status.Prospect);
    const gapAll = demandGap(cusF, prosF, GAP_REF.country);
    const GAP_ROW_COLORS = ["#dc2626","#ff6a1a","#ffb02e","#c8e622","#26e07a"];
    const gradeRows = gapAll.gapSegs.map((g,i)=>({g:g.seg,
      label:`${segTH(g.seg)} ${t("(ขาด", "(short")} ${num(g.gap)} ${t("จากอุปสงค์", "of demand")} ${num(g.demand)})`,
      color:GAP_ROW_COLORS[i]||OTHER_COLOR, n:g.gap}));
    const gmax = Math.max(1, ...gradeRows.map(r=>r.n));
    return html`<div>
      <!-- ไอคอน 3 กล่องแรกใช้สีชมพูเข้ม (สีแบรนด์หลัก) บนพื้นวงกลมชมพูจางเดิม → contrast ผ่าน WCAG AA (~3.7:1)
           กล่อง "มูลค่าไปป์ไลน์" ไอคอนเขียวบนพื้นเขียว contrast ดีอยู่แล้ว จึงคงเดิม -->
      <div class="grid g4" style=${{marginBottom:"16px"}}>
        <${Kpi} label=${t("ลูกค้าทั้งหมด", "All customers")} value=${num(k.customers)} icon="users" iconColor="var(--accent)"/>
        <${Kpi} label=${t("Leadทั้งหมด", "All Leads")} value=${num(k.prospects)} icon="target" iconColor="var(--accent)"/>
        <${Kpi} label=${t("ความครอบคลุม", "Coverage")} value=${pct(k.coverage)} icon="coverage" iconColor="var(--accent)"/>
        <${Kpi} label=${t("ยังขาด (ราย)", "Still short")} value=${num(k.gapCount)} icon="gap" iconBg="rgba(255,176,46,.18)" iconColor="#ffb02e"/>
      </div>
      <div class="grid g2">
        <!-- คอลัมน์ซ้าย: Donut เดิม (ไม่แตะ) + เส้นคั่น + กราฟคุณภาพกลุ่มเป้าหมายใหม่ · ทำเป็น flex column
             ให้กราฟหมวดที่ขาดยืดเติมพื้นที่ ความสูงคอลัมน์ซ้ายจึงเท่ากับตารางฝั่งขวาพอดี (grid stretch) -->
        <${Card} title=${t("การกระจายกลุ่มธุรกิจ", "Business segment mix")} sub=${t("รวมลูกค้าปัจจุบันและLead", "Existing customers and Leads combined")} className="sum-left">
          <div class="sum-body">
            <${Donut} data=${segTotals} center=${{value:k.customers+k.prospects,label:t("รายการ", "records")}}/>
            <div class="sum-divider"></div>
            <div class="sum-grade-h">${t("หมวดธุรกิจที่เครือข่ายยังขาด", "Categories the network is short of")}</div>
            <div class="sum-grade-sub">${t("5 หมวดที่มี Lead มากที่สุด · ยังขาดรวม", "The 5 categories with the highest Lead demand · short by")} ${num(gapAll.gapCount)} ${t("ราย · ดัชนี", "in total · index")} ${gapAll.gapScore}/100 (${gapTH(gapAll.gapLevel)})</div>
            <div class="sum-grade">
              ${gradeRows.map(r=>html`<div key=${r.g} class="sum-grade-row">
                <span class="sum-grade-dot" style=${{background:r.color}}></span>
                <span class="sum-grade-lb">${r.label}</span>
                <div class="sum-grade-track"><div class="sum-grade-fill" style=${{width:(r.n/gmax*100)+"%",background:r.color}}></div></div>
                <span class="sum-grade-n">${num(r.n)}</span>
              </div>`)}
            </div>
          </div>
        </${Card}>
        <${Card} title=${t("พื้นที่ Lead สูงสุด", "Highest-Lead areas")} sub=${t("ระดับอำเภอ · กรุงเทพฯ, เชียงใหม่, ภูเก็ต, พัทยา", "District level · Bangkok, Chiang Mai, Phuket, Pattaya")} pad0=${true}>${distTable(rankOppDist.slice(0,8))}</${Card}>
      </div>
      <style>${SUMMARY_CSS}</style></div>`;
  }
  if(id==="areasummary"){
    // รายงานสรุปข้อมูลรายพื้นที่ = ยุบ "เชิงภูมิศาสตร์" + "ความครอบคลุม" ไว้ในหน้าเดียว
    // ตัวกรอง (จังหวัด/ประเภทธุรกิจ) อยู่ที่ Reports() จึงคงค่าเดิมเมื่อสลับแท็บ
    return html`<${AreaSummaryReport} db=${db} f=${f} k=${k} nav=${nav}
      tab=${areaTab} setTab=${setAreaTab} province=${areaProv} setProvince=${setAreaProv}
      segment=${areaSeg} setSegment=${setAreaSeg}/>`;
  }
  if(id==="gap"){
    // หน้ารายงานวิเคราะห์ช่องว่างออกแบบใหม่ (6 ส่วน) หน่วยวิเคราะห์ = เขต/อำเภอ ของ 4 จังหวัดที่มีข้อมูลระดับเขต
    return html`<${GapReport} db=${db} f=${f}/>`;
  }
  if(id==="opportunity"){
    return html`<${OpportunityReport} db=${db} f=${f} k=${k}/>`;
  }
  if(id==="route"){
    const savedPlans = (visitPlans||[]).filter(p=>p.saved && p.customers.length>0);
    if(savedPlans.length===0){
      return html`<div>
        <!-- ชั้น KPI: แสดง 0 ทั้งสองการ์ดเมื่อยังไม่มีแผน (ไม่มีการ์ดระยะทาง) -->
        <div class="grid g2" style=${{marginBottom:"16px"}}>
          <${Kpi} label=${t("แผนที่บันทึกไว้", "Saved plans")} value=${num(0)} icon="route"/>
          <${Kpi} label=${t("จุดแวะรวมทุกแผน", "Stops across all plans")} value=${num(0)} icon="users"/>
        </div>
        <${Card} title=${t("แผนการเข้าพบลูกค้า", "Customer visit plan")} sub=${t("รายการแผนที่บันทึกไว้จากกล่องแผนการเข้าพบบนแผนที่", "Plans saved from the visit-plan box on the map")}>
          <div class="emptybox">${t("ยังไม่มีแผนที่บันทึกไว้ — ไปที่แผนที่ เลือกลูกค้า/Leadเข้าแผน แล้วกด \"บันทึกแผนนี้\" ข้อมูลจะมาแสดงที่นี่โดยอัตโนมัติ", "No saved plans yet — open the map, add customers or Leads to a plan, then press \"Save this plan\" and it will appear here automatically")}</div>
        </${Card}>
        <style>${ROUTE_CSS}</style>
      </div>`;
    }
    const totalStops = savedPlans.reduce((a,p)=>a+p.customers.length,0);
    return html`<div>
      <!-- ชั้น KPI: 2 การ์ด (ตัดการ์ด "ระยะทางรวม" ออก — ไม่มีข้อมูลระยะทางจริงรองรับ) -->
      <div class="grid g2" style=${{marginBottom:"16px"}}>
        <${Kpi} label=${t("แผนที่บันทึกไว้", "Saved plans")} value=${num(savedPlans.length)} icon="route"/>
        <${Kpi} label=${t("จุดแวะรวมทุกแผน", "Stops across all plans")} value=${num(totalStops)} icon="users"/>
      </div>
      ${savedPlans.map(p=>{ const isOpen = expandedPlanId===p.id; return html`
        <div key=${p.id} style=${{marginBottom:"12px"}}>
        <${Card} pad0=${true}>
          <!-- ส่วนหัว: ชื่อแผน + สรุปจำนวนจุดแวะ (ไม่มี กม./นาที) + ปุ่มคำสั่งมุมขวา -->
          <div class=${"rp-head"+(isOpen?" open":"")}>
            <div class="rp-head-main" onClick=${()=>setExpandedPlanId(isOpen?null:p.id)}>
              <div style=${{fontSize:"14.5px",fontWeight:700}}>${p.name}</div>
              <div class="dim" style=${{fontSize:"12.5px",marginTop:"3px"}}>${num(p.customers.length)} ${t("จุดแวะ", "stops")}</div>
            </div>
            <div class="rp-actions">
              <button class="rp-btn" title=${t("ส่งออกสรุปแผนเป็น PDF", "Export the plan summary as PDF")} onClick=${()=>printRoutePlan(p)}>
                <${Icon} name="pdf" size=${15}/><span>${t("ส่งออก PDF", "Export PDF")}</span></button>
              <button class="rp-btn" title=${t("แก้ไขแผนบนแผนที่หลัก", "Edit the plan on the main map")}
                onClick=${()=>{ if(setActivePlanId) setActivePlanId(p.id); nav("area",{province:(p.customers[0]&&p.customers[0].province)||undefined}); }}>
                <${Icon} name="edit" size=${15}/><span>${t("แก้ไขแผน", "Edit plan")}</span></button>
              <button class="rp-btn rp-danger" title=${t("ลบแผนนี้", "Delete this plan")}
                onClick=${()=>{ if(deletePlan && confirm(`${t("ต้องการลบแผน \"", "Delete the plan \"")}${p.name}${t("\" ใช่หรือไม่?", "\"?")}`)){ if(expandedPlanId===p.id) setExpandedPlanId(null); deletePlan(p.id); } }}>
                <${Icon} name="trash" size=${15}/><span>${t("ลบแผน", "Delete plan")}</span></button>
              <button class="rp-chev" title=${isOpen?t("ย่อ", "Collapse"):t("ขยาย", "Expand")} onClick=${()=>setExpandedPlanId(isOpen?null:p.id)}>
                <${Icon} name="chevron" size=${16} style=${{transform:isOpen?"rotate(180deg)":"none",transition:"transform .2s"}}/></button>
            </div>
          </div>
          ${isOpen && html`<div class="rp-split">
            <!-- ซ้าย 40%: ไทม์ไลน์จุดแวะ (มีเส้นเชื่อมแนวตั้ง · ไม่มีเวลา/ระยะทางระหว่างจุด) -->
            <div class="rp-timeline">
              ${p.customers.map((c,i)=>{ const pros = c.status!=="Existing"; const last = i===p.customers.length-1;
                return html`<div key=${c.id} class="rp-stop">
                  <div class="rp-rail">
                    <div class=${"rp-dot"+(pros?" pros":" cust")}>${i+1}</div>
                    ${!last && html`<div class="rp-conn"></div>`}
                  </div>
                  <div class="rp-info">
                    <div class="rp-name">${c.businessName}</div>
                    <div class="rp-badges">
                      <span class=${"rp-type"+(pros?" pros":" cust")}>${pros?"Lead":t("ลูกค้าปัจจุบัน", "Existing customers")}</span>
                    </div>
                    <div class="rp-addr">${c.address||"—"}${c.district?` · ${districtTH(c.district)}`:""} · ${provinceTH(c.province)}</div>
                    <a class="rp-gmap" href=${`https://www.google.com/maps?q=${c.latitude},${c.longitude}`} target="_blank" rel="noopener noreferrer">
                      <${Icon} name="route" size=${13}/> ${t("เปิดใน Google Maps", "Open in Google Maps")}</a>
                  </div>
                </div>`; })}
            </div>
            <!-- ขวา 60%: แผนที่ย่อ หมุดมีเลขลำดับ + เส้นตรงเชื่อมจุด (ไม่ใช่เส้นถนนจริง) -->
            <div class="rp-mapcol">
              <${RoutePlanMiniMap} stops=${p.customers}/>
              <div class="rp-mapnote">${t("เส้นทางแสดงตำแหน่งโดยประมาณ ไม่ใช่เส้นทางถนนจริง กรุณาวางแผนเส้นทางจริงผ่าน Google Maps", "The route shows approximate positions, not real roads — plan the actual route in Google Maps")}</div>
            </div>
          </div>`}
        </${Card}>
        </div>`; })}
      <style>${ROUTE_CSS}</style>
    </div>`;
  }
}

// ── แผนที่ย่อของแผนเดินทาง: หมุดเลขลำดับ + เส้นตรงเชื่อมจุด (ไม่เรียกบริการคำนวณเส้นทางใดๆ) ──
function RoutePlanMiniMap({stops}){
  const ref = useRef();
  const lang = useLang();   // สลับภาษา → สร้างแผนที่ย่อใหม่ (ป้ายชื่อสถานที่เปลี่ยนตาม)
  const sig = stops.map(c=>c.id).join(",");
  useEffect(()=>{
    if(!ref.current || typeof L==="undefined") return;
    const map = L.map(ref.current,{zoomControl:false,attributionControl:true});
    basemap(map);
    const pts = stops.map(c=>[c.latitude,c.longitude]);
    // เส้นตรงเชื่อมจุดตามลำดับ ใช้เส้นประ ตอกย้ำว่าเป็นเส้นประมาณการ ไม่ใช่เส้นถนนจริง
    if(pts.length>1) L.polyline(pts,{color:"#e60023",weight:2,dashArray:"5 4",opacity:.8}).addTo(map);
    stops.forEach((c,i)=>{ const pros = c.status!=="Existing"; const col = pros?"#e60023":"#38bdf8";
      L.marker([c.latitude,c.longitude],{icon:L.divIcon({className:"",iconSize:[26,26],iconAnchor:[13,13],
        html:`<div class="rp-pin" style="background:${col}">${i+1}</div>`})}).addTo(map).bindTooltip(`${i+1}. ${c.businessName}`);
    });
    if(pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.3));
    setTimeout(()=>map.invalidateSize(),60);
    return ()=>map.remove();
  },[sig,lang]);
  return html`<div ref=${ref} class="rp-minimap"></div>`;
}

// แปลงอักขระพิเศษก่อนนำไปใส่ในหน้าต่างพิมพ์
const escH = s => String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

// ── ภาพแผนที่ย่อสำหรับเอกสารส่งออก: เส้นตรงเชื่อมจุด + หมุดเลขลำดับ (ไม่มีตัวเลขระยะทาง/เวลา) ──
function routePlanSVG(stops){
  if(!stops.length) return "";
  const la=stops.map(c=>c.latitude), lo=stops.map(c=>c.longitude);
  let minLa=Math.min(...la),maxLa=Math.max(...la),minLo=Math.min(...lo),maxLo=Math.max(...lo);
  if(maxLa-minLa<0.01){maxLa+=0.01;minLa-=0.01;} if(maxLo-minLo<0.01){maxLo+=0.01;minLo-=0.01;}
  const W=540,H=340,pad=30;
  const X=v=>pad+(v-minLo)/(maxLo-minLo)*(W-2*pad);
  const Y=v=>pad+(maxLa-v)/(maxLa-minLa)*(H-2*pad);   // เหนืออยู่บน
  const line = stops.map(c=>`${X(c.longitude).toFixed(1)},${Y(c.latitude).toFixed(1)}`).join(" ");
  let s=`<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="#f5f6f8" rx="10"/>`;
  if(stops.length>1) s+=`<polyline points="${line}" fill="none" stroke="#e60023" stroke-width="2" stroke-dasharray="5 4" opacity="0.8"/>`;
  stops.forEach((c,i)=>{ const x=X(c.longitude),y=Y(c.latitude); const col=c.status!=="Existing"?"#e60023":"#38bdf8";
    s+=`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="12" fill="${col}"/><text x="${x.toFixed(1)}" y="${(y+4).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="700" fill="#fff" font-family="Tahoma,sans-serif">${i+1}</text>`; });
  return s+`</svg>`;
}

// ── ส่งออกสรุปแผนเดินทางเป็น PDF ผ่านหน้าต่างพิมพ์ของเบราว์เซอร์ (ไม่มีตัวเลข กม./นาที) ──
function printRoutePlan(plan){
  const stops = plan.customers||[];
  const rows = stops.map((c,i)=>{ const pros=c.status!=="Existing";
    const addr = `${escH(c.address||"—")}${c.district?" · "+escH(districtTH(c.district)):""} · ${escH(provinceTH(c.province))}`;
    return `<tr><td class="n">${i+1}</td><td><b>${escH(c.businessName)}</b><div class="tp">${pros?"Lead":t("ลูกค้าปัจจุบัน", "Existing customers")} · ${escH(segTH(c.segment))}</div></td><td class="ad">${addr}</td></tr>`;
  }).join("");
  const w = window.open("", "_blank");
  if(!w){ toast(t("เบราว์เซอร์บล็อกหน้าต่างใหม่ กรุณาอนุญาตป๊อปอัปเพื่อส่งออก PDF", "The browser blocked a new window — allow pop-ups to export the PDF"),"warn"); return; }
  w.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${escH(plan.name)}</title>
    <style>
      *{box-sizing:border-box} body{font-family:"Sarabun","Tahoma","Segoe UI",sans-serif;color:#1a1f2b;margin:28px;line-height:1.5}
      h1{font-size:22px;margin:0 0 4px} .sub{color:#667085;font-size:13px;margin-bottom:16px}
      .map{margin:8px 0 6px} .note{font-size:12px;color:#a15;background:#fdf0f4;border:1px solid #f6d3de;border-radius:8px;padding:9px 12px;margin-bottom:18px}
      table{width:100%;border-collapse:collapse;font-size:13px} th,td{text-align:left;padding:9px 12px;border-bottom:1px solid #e6e8ec;vertical-align:top}
      th{color:#475569;font-size:11.5px;text-transform:uppercase;letter-spacing:.4px} td.n{font-weight:700;color:#e60023;width:42px} td.ad{color:#475467}
      .tp{color:#667085;font-size:12px;margin-top:2px} @media print{body{margin:14px}}
    </style></head><body>
    <h1>${escH(plan.name)}</h1>
    <div class="sub">${t("สรุปแผนการเข้าพบ ·", "Visit plan summary ·")} ${stops.length} ${t("จุดแวะ", "stops")}</div>
    <div class="map">${routePlanSVG(stops)}</div>
    <div class="note">${t("เส้นทางแสดงตำแหน่งโดยประมาณ ไม่ใช่เส้นทางถนนจริง กรุณาวางแผนเส้นทางจริงผ่าน Google Maps", "The route shows approximate positions, not real roads — plan the actual route in Google Maps")}</div>
    <table><thead><tr><th>${t("ลำดับ", "Order")}</th><th>${t("สถานที่", "places")}</th><th>${t("ที่อยู่", "Address")}</th></tr></thead><tbody>${rows}</tbody></table>
    </body></html>`);
  w.document.close();
  setTimeout(()=>{ try{ w.focus(); w.print(); }catch(e){} }, 400);
}

// สไตล์เฉพาะหน้ารายงานการวางแผนเส้นทาง (ไทม์ไลน์ + แบ่งสองคอลัมน์)
const ROUTE_CSS = `
.rp-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;
  border-radius:var(--r) var(--r) 0 0;transition:background .18s}
.rp-head.open{background:var(--accent-soft)}
.rp-head-main{flex:1;cursor:pointer;min-width:0}
.rp-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.rp-btn{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:9px;border:1.5px solid var(--accent);
  background:transparent;color:var(--accent);cursor:pointer;font-family:var(--font);font-size:12.5px;font-weight:600;white-space:nowrap}
.rp-btn:hover{background:var(--accent-soft)}
.rp-btn.rp-danger{border-color:var(--stroke2);color:var(--muted)}
.rp-btn.rp-danger:hover{border-color:#e5484d;color:#e5484d;background:rgba(229,72,77,.08)}
.rp-chev{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9px;
  border:1px solid var(--stroke2);background:transparent;color:var(--muted);cursor:pointer}
.rp-chev:hover{color:var(--txt);border-color:rgba(120,160,220,.45)}
.rp-split{display:grid;grid-template-columns:2fr 3fr;gap:0;border-top:1px solid var(--stroke)}
.rp-timeline{padding:18px 16px;border-right:1px solid var(--stroke);display:flex;flex-direction:column}
.rp-stop{display:flex;gap:12px}
.rp-rail{display:flex;flex-direction:column;align-items:center;flex:none;width:30px}
.rp-dot{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-size:12.5px;font-weight:800;color:#fff;flex:none}
.rp-dot.pros{background:#e60023}
.rp-dot.cust{background:#38bdf8}
.rp-conn{flex:1;width:2px;min-height:22px;background:var(--stroke2);margin:3px 0}
.rp-info{flex:1;min-width:0;padding-bottom:18px}
.rp-name{font-size:13.5px;font-weight:700;color:var(--txt)}
.rp-badges{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin:5px 0 4px}
.rp-type{font-size:11.5px;font-weight:700;padding:2px 9px;border-radius:20px}
.rp-type.pros{background:var(--accent-soft);color:var(--accent-deep)}
.rp-type.cust{background:rgba(56,189,248,.16);color:#0284c7}
.rp-addr{font-size:12px;color:var(--muted);margin-bottom:6px}
.rp-gmap{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;color:var(--accent);text-decoration:none;
  padding:4px 10px;border-radius:8px;border:1px solid var(--stroke2)}
.rp-gmap:hover{background:var(--accent-soft);border-color:var(--accent)}
.rp-mapcol{padding:16px}
.rp-minimap{width:100%;height:340px;border-radius:12px;overflow:hidden;border:1px solid var(--stroke)}
.rp-mapnote{margin-top:9px;font-size:11.5px;color:var(--muted);background:var(--accent-soft);border:1px solid #f6d3de;
  border-radius:8px;padding:8px 11px;line-height:1.5}
.rp-pin{width:100%;height:100%;border-radius:50%;display:grid;place-items:center;font-family:var(--font);
  font-size:12px;font-weight:800;color:#fff;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)}
@media (max-width:820px){ .rp-split{grid-template-columns:1fr} .rp-timeline{border-right:0;border-bottom:1px solid var(--stroke)} }
`;

function provTable(rows){
  return html`<${Table} cols=${[
    {h:t("จังหวัด", "Province"), render:r=>provinceTH(r.province)},
    {h:t("ลูกค้า", "Customers"), render:r=>num(r.customerCount)},
    {h:"Lead", render:r=>num(r.prospectCount)},
    {h:t("ดัชนีช่องว่าง", "Gap index"), render:r=>html`<b>${r.gapScore}</b>`},
    {h:t("ยังขาด", "still short"), render:r=>html`<${Badge} tone=${r.gapLevel==="High"?"bad":r.gapLevel==="Medium"?"warn":"good"}>${num(r.gapCount)} ${t("ราย", "businesses")}</${Badge}>`},
  ]} rows=${rows}/>`;
}

function distTable(rows){
  // คอลัมน์ "ดัชนีช่องว่าง": data bar เป็นพื้นหลังของตัวเลข ความยาว normalize เทียบค่าสูงสุดในคอลัมน์
  // สีไล่ระดับตามค่า (ค่าสูง = ชมพูเข้มทึบ / ค่าต่ำ = ชมพูจาง) เพื่อกวาดตาเห็นแถวที่ขาดมากสุดได้ทันที
  const maxOpp = Math.max(1, ...rows.map(r=>r.gapScore||0));
  const oppBar = v => { const frac=Math.max(0, Math.min(1, (v||0)/maxOpp));
    return {w: Math.round(frac*100), bg:`rgba(230, 0, 35,${(0.16+frac*0.5).toFixed(2)})`}; };
  return html`<${Table} cols=${[
    {h:t("จังหวัด", "Province"), render:r=>provinceTH(r.province)},
    {h:t("อำเภอ/เขต", "District"), render:r=>districtTH(r.district)},
    {h:t("ลูกค้า", "Customers"), render:r=>num(r.customerCount)},
    {h:"Lead", render:r=>num(r.prospectCount)},
    {h:t("ดัชนีช่องว่าง", "Gap index"), render:r=>{ const b=oppBar(r.gapScore);
      return html`<div style=${{position:"relative",display:"inline-flex",alignItems:"center",minWidth:"58px",height:"22px",
        borderRadius:"6px",overflow:"hidden",background:"rgba(120,160,220,.10)"}} title=${t("ดัชนี Lead ", "Lead index ")+r.gapScore+t(" (สูงสุดในตาราง ", " (highest in the table ")+maxOpp+")"}>
        <div style=${{position:"absolute",left:0,top:0,bottom:0,width:b.w+"%",background:b.bg,borderRadius:"6px",transition:"width .4s"}}></div>
        <b style=${{position:"relative",padding:"0 10px",fontSize:"12.5px"}}>${r.gapScore}</b>
      </div>`; }},
    {h:t("ยังขาด", "still short"), render:r=>html`<${Badge} tone=${r.gapLevel==="High"?"bad":r.gapLevel==="Medium"?"warn":"good"}>${num(r.gapCount)} ${t("ราย", "businesses")}</${Badge}>`},
  ]} rows=${rows}/>`;
}

/* ============ EXPORT EXPERIENCE ============ */
const FORMATS = [
  {id:"pdf",   name:t("รายงาน PDF", "PDF report"),   ext:"PDF",    desc:t("เหมาะสำหรับการพิมพ์และนำเสนอ", "Best for printing and presenting"),   icon:"pdf"},
  {id:"excel", name:"Excel",         ext:".xlsx",  desc:t("เหมาะสำหรับการวิเคราะห์ข้อมูลต่อ", "Best for further analysis"), icon:"excel"},
  {id:"csv",   name:"CSV",           ext:".csv",   desc:t("เหมาะสำหรับการนำเข้าระบบอื่น", "Best for importing into another system"),    icon:"reports"},
];
// ตัวเลือก "ภาพประกอบ" เท่านั้น — CSV เก็บข้อความล้วน จึงซ่อนทั้งกลุ่มนี้เมื่อเลือก CSV
const EXPORT_OPTS = [
  {id:"snapshot", label:t("รวมภาพแผนที่", "Include the map image")},
  {id:"heat",     label:t("รวมแผนที่ความร้อน", "Include the heatmap")},
  {id:"route",    label:t("รวมเส้นทาง", "Include routes")},
];
// ตัวเลือก "ข้อมูลที่ต้องการ" (ขอบเขตข้อมูลที่จะส่งออก)
const DATA_SCOPE_OPTS = [
  {id:"existing", label:t("ลูกค้าปัจจุบันอย่างเดียว", "Existing customers only")},
  {id:"prospect", label:t("Lead อย่างเดียว", "Leads only")},
  {id:"both",     label:t("ทั้งลูกค้าและ Lead", "Both customers and Leads")},
];

// ชื่อไฟล์เริ่มต้น: รายงาน_[ชื่อพื้นที่]_[ปีพุทธศักราช-เดือน-วัน] · ห้ามใช้ปี ค.ศ.
// scope.areaName = ชื่ออำเภอถ้ากรองถึงระดับอำเภอ · ไม่งั้นชื่อจังหวัด · ไม่กรองพื้นที่ = "ทั้งประเทศ"
function defaultReportName(scope){
  let iso; try{ iso=new Date().toISOString().slice(0,10); }catch{ iso="2026-08-02"; }
  const [y,m,d]=iso.split("-"); const be=(+y+543)+"-"+m+"-"+d;
  const area=(scope&&scope.areaName)||t("ทั้งประเทศ","Nationwide");
  return t("รายงาน_", "report_")+area+"_"+be;
}
export {defaultReportName};

// Centered export dialog — the user chooses format + options, previews the exact rows that will
// be exported, and only then confirms (issue #18: nothing downloads until the preview is confirmed).
export function ExportDialog({scope={}, role, buildPreviewRows, onClose, onExport, formats, simple=false}){
  // formats: override รายการประเภทไฟล์ (เช่น รายงานแผนเข้าพบระบุ PDF+Excel) · ปกติกรองตามสิทธิ์บทบาท
  // simple: ซ่อนตัวเลือกเฉพาะรายงานพื้นที่ (ข้อมูลลูกค้า/Lead + ภาพประกอบ heat/route) สำหรับรายงานที่ไม่เกี่ยวข้อง
  const allowed = formats ? FORMATS.filter(f=>formats.includes(f.id)) : FORMATS.filter(f=>canExport(role, f.id));   // §5 กรองประเภทไฟล์ตามสิทธิ์ของบทบาท (ซ่อน ไม่ disable)
  const [step, setStep] = useState("options");   // "options" → "preview"
  const [format, setFormat] = useState((allowed[0]||{}).id||"pdf");
  const [filename, setFilename] = useState(()=>defaultReportName(scope));
  const [dataSel, setDataSel] = useState("both");   // §3 ข้อมูลที่ต้องการ: existing | prospect | both
  // §1 ตัวเลือกภาพยังคงสถานะเดิมเมื่อสลับประเภทไฟล์ (ไม่รีเซ็ต) แค่ซ่อนตอน CSV
  const [opts, setOpts] = useState({snapshot:true, heat:true, route:true});
  const toggle = id => setOpts(o=>({...o,[id]:!o[id]}));
  const activeFmt = FORMATS.find(x=>x.id===format) || FORMATS[0];
  const isCsv = format==="csv";
  const cE=(scope.counts&&scope.counts.existing)||0, cP=(scope.counts&&scope.counts.prospect)||0;
  const count = simple ? ((scope.counts&&scope.counts.total)||0)   // §2 จำนวนจริงตามตัวกรอง+ข้อมูลที่เลือก
    : (dataSel==="existing"?cE : dataSel==="prospect"?cP : cE+cP);
  const big = count>5000;
  const extLbl = activeFmt.ext.startsWith(".")?activeFmt.ext:"."+activeFmt.ext.toLowerCase();
  const payload = ()=>({format, filename, opts:isCsv?{}:opts, dataSel, count, scope});

  // กล่องแสดง "ขอบเขตข้อมูลที่จะส่งออก" — สืบจากตัวกรองบนหน้าจอเสมอ (แทน checkbox รวมตัวกรอง)
  const ScopeBox = ()=>html`<div class="xp-scope">
    <div class="xp-scope-h">${t("ขอบเขตข้อมูลที่จะส่งออก", "What will be exported")}</div>
    <div class="xp-scope-r">${scope.areaLabel||t("ทั้งประเทศ","Nationwide")}</div>
    <div class="xp-scope-r">${t("หมวดธุรกิจ:", "Business category:")} ${scope.segLabel||t("ทั้งหมด","All")}</div>
    <div class="xp-scope-r">${t("ช่วงเวลา:", "Period:")} ${scope.dateLabel||t("ทั้งหมด","All")}</div>
    <div class="xp-scope-c">${t("รวม", "Total")} ${num(count)} ${t("รายการ", "records")}</div>
    ${big?html`<div class="xp-scope-warn"><${Icon} name="gap" size=${13}/> ${t("ข้อมูลจำนวนมาก การส่งออกอาจใช้เวลาสักครู่", "That's a lot of data — the export may take a moment")}</div>`:""}
  </div>`;

  if(step==="preview"){
    const previewRows = buildPreviewRows({...opts, dataSel});
    return createPortal(html`<div class="xp-backdrop" onMouseDown=${e=>{ e.currentTarget.dataset.down = e.target.classList.contains("xp-backdrop") ? "1" : ""; }}
      onMouseUp=${e=>{ const started=e.currentTarget.dataset.down; e.currentTarget.dataset.down=""; if(started==="1" && e.target.classList.contains("xp-backdrop")) onClose(); }}>
      <div class="xp-card" role="dialog" aria-modal="true" aria-label=${t("ดูตัวอย่างรายงานก่อนส่งออก", "Preview the report before exporting")} style=${{width:"620px"}}>
        <div class="xp-head">
          <div>
            <h2 class="xp-title">${t("ดูตัวอย่างก่อนส่งออก", "Preview before exporting")}</h2>
            <div class="xp-desc">${filename}${extLbl} · ${num(count)} ${t("รายการ — ตรวจสอบให้แน่ใจก่อนยืนยัน", "records — check them before confirming")}</div>
          </div>
          <button class="xp-x" onClick=${onClose} aria-label=${t("ปิด", "Close")}><${Icon} name="close" size=${16}/></button>
        </div>
        <div class="xp-body">
          <div class="xp-preview">
            ${previewRows.map((r,i)=>html`<div key=${i} class=${"xp-prow"+(r.length===0?" blank":r.length===1?" head":"")}>
              ${r.length===0 ? html`<span>&nbsp;</span>` : r.map((c,j)=>html`<span key=${j}>${c}</span>`)}
            </div>`)}
          </div>
        </div>
        <div class="xp-foot">
          <button class="xp-btn ghost" onClick=${()=>setStep("options")}><${Icon} name="chevronR" size=${15} style=${{transform:"scaleX(-1)"}}/>${t("ย้อนกลับ", "Back")}</button>
          <button class="xp-btn primary" onClick=${()=>onExport(payload())}>
            <${Icon} name="download" size=${15} color="#fff"/>${t("ยืนยันส่งออก", "Confirm export")}</button>
        </div>
        <style>${EXPORT_CSS}</style>
      </div>
    </div>`, document.body);
  }

  return createPortal(html`<div class="xp-backdrop" onMouseDown=${e=>{ e.currentTarget.dataset.down = e.target.classList.contains("xp-backdrop") ? "1" : ""; }}
      onMouseUp=${e=>{ const started=e.currentTarget.dataset.down; e.currentTarget.dataset.down=""; if(started==="1" && e.target.classList.contains("xp-backdrop")) onClose(); }}>
    <div class="xp-card" role="dialog" aria-modal="true" aria-label=${t("ส่งออกรายงาน", "Export report")}>
      <div class="xp-head">
        <div>
          <h2 class="xp-title">${t("ส่งออกรายงาน", "Export report")}</h2>
          <div class="xp-desc">${t("ส่งออกตามขอบเขตของตัวกรองที่ตั้งไว้บนหน้าจอ", "Exports using the filters set on screen")}</div>
        </div>
        <button class="xp-x" onClick=${onClose} aria-label=${t("ปิด", "Close")}><${Icon} name="close" size=${16}/></button>
      </div>

      <div class="xp-body">
        ${ScopeBox()}

        ${allowed.length===0 ? html`<div class="xp-scope-warn" style=${{marginTop:"14px"}}><${Icon} name="gap" size=${13}/> ${t("บทบาทของคุณไม่มีสิทธิ์ส่งออกไฟล์ประเภทใด — ติดต่อผู้ดูแลระบบ", "Your role cannot export any file type — contact an administrator")}</div>` : html`
        <div class="xp-label" style=${{marginTop:"14px"}}>${t("ประเภทไฟล์", "File type")}</div>
        <div class="xp-formats">
          ${allowed.map(fmt=>html`<button key=${fmt.id} class=${"xp-fmt"+(format===fmt.id?" on":"")} onClick=${()=>setFormat(fmt.id)}>
            <span class="xp-fmt-ic"><${Icon} name=${fmt.icon} size=${18} color=${format===fmt.id?"#e60023":"var(--muted)"}/></span>
            <span class="xp-fmt-main">
              <span class="xp-fmt-name">${fmt.name} <small>${fmt.ext}</small></span>
              <span class="xp-fmt-desc">${fmt.desc}</span>
            </span>
            <span class=${"xp-radio"+(format===fmt.id?" on":"")}></span>
          </button>`)}
        </div>

        <div class="xp-label" style=${{marginTop:"13px"}}>${t("ชื่อไฟล์", "File name")}</div>
        <div class="xp-file">
          <input class="xp-input" value=${filename} onInput=${e=>setFilename(e.target.value)} spellcheck="false"/>
          <span class="xp-ext">${extLbl}</span>
        </div>

        ${simple ? "" : html`
        <div class="xp-label" style=${{marginTop:"13px"}}>${t("ข้อมูลที่ต้องการ", "Data to include")}</div>
        <div class="xp-opts">
          ${DATA_SCOPE_OPTS.map(o=>html`<label key=${o.id} class="xp-opt" onClick=${()=>setDataSel(o.id)}>
            <span class=${"xp-radio2"+(dataSel===o.id?" on":"")}></span>
            <span>${o.label}</span>
          </label>`)}
        </div>

        <div class="xp-label" style=${{marginTop:"13px"}}>${t("ภาพประกอบ", "Images")}</div>
        ${isCsv
          ? html`<div class="xp-csvnote"><${Icon} name="reports" size=${14} color="var(--muted)"/> ${t("ไฟล์ CSV เก็บข้อมูลตารางอย่างเดียว ไม่รองรับการแนบภาพ", "CSV holds table data only — images cannot be attached")}</div>`
          : html`<div class="xp-opts">
              ${EXPORT_OPTS.map(o=>html`<label key=${o.id} class="xp-opt">
                <span class=${"xp-check"+(opts[o.id]?" on":"")}>${opts[o.id]&&html`<${Icon} name="check" size=${12} color="#fff"/>`}</span>
                <input type="checkbox" checked=${opts[o.id]} onChange=${()=>toggle(o.id)} style=${{display:"none"}}/>
                <span>${o.label}</span>
              </label>`)}
            </div>`}
        `}`}
      </div>

      <div class="xp-foot">
        <button class="xp-btn ghost" onClick=${onClose}>${t("ยกเลิก", "Cancel")}</button>
        <button class="xp-btn secondary" disabled=${allowed.length===0} onClick=${()=>setStep("preview")}>
          <${Icon} name="reports" size=${15} color="var(--accent)"/>${t("ดูตัวอย่าง", "Preview")}</button>
        <button class="xp-btn primary" disabled=${allowed.length===0} onClick=${()=>onExport(payload())}>
          <${Icon} name="download" size=${15} color="#fff"/>${t("ส่งออกรายงาน", "Export report")}</button>
      </div>
      <style>${EXPORT_CSS}</style>
    </div>
  </div>`, document.body);
}

// Build report rows honoring the chosen options (filters section + included-section note).
function buildReportRows(active, {today, k, rankOpp, rankCov, rankGap, rankOppDist, rankGapDist, filters}, opts){
  // active อาจเป็นชนิดย่อยของ "รายงานสรุปข้อมูลรายพื้นที่" (geographic/coverage) ซึ่งไม่มีในเมนูแล้ว
  // จึงต้องมีชื่อสำรองไว้ ไม่งั้นการค้นหาในเมนูจะได้ undefined
  const SUBVIEW_NAME = {
    geographic:t("รายงานสรุปข้อมูลรายพื้นที่ · มุมมองภูมิศาสตร์", "Area summary report · geographic view"),
    coverage:t("รายงานสรุปข้อมูลรายพื้นที่ · มุมมองดัชนีการเจาะตลาด", "Area summary report · penetration index view"),
  };
  const reportName = (TYPES.find(t=>t.id===active)||{}).name || SUBVIEW_NAME[active] || t("รายงาน","Report");
  const rows = [[t("รายงาน GeoIntel", "GeoIntel report"), reportName], [t("จัดทำเมื่อ", "Prepared on"), today], []];
  // ขอบเขตข้อมูลติดไปกับไฟล์เสมอ (บังคับตามตัวกรองบนหน้าจอ — ไม่มี checkbox ให้ปิด)
  const dataSelTH = opts.dataSel==="existing"?t("ลูกค้าปัจจุบันอย่างเดียว", "Existing customers only"):opts.dataSel==="prospect"?t("Lead อย่างเดียว", "Leads only"):t("ทั้งลูกค้าและ Lead", "Both customers and Leads");
  rows.push([t("ขอบเขตข้อมูลที่ส่งออก", "Scope of the export")]);
  rows.push([t("จังหวัด", "Province"), filters.province==="All"?t("ทุกจังหวัด", "All provinces"):provinceTH(filters.province)]);
  rows.push([t("กลุ่มธุรกิจ", "Business segment"), SEGMENTS.filter(s=>filters.segments[s]).map(segTH).join(", ")]);
  rows.push([t("ข้อมูลที่ส่งออก", "Data exported"), dataSelTH]);
  rows.push([]);
  const inc = [opts.snapshot&&t("ภาพแผนที่", "Map image"), opts.heat&&t("แผนที่ความร้อน", "Heatmap"), opts.route&&t("เส้นทาง", "Routes")].filter(Boolean);
  if(inc.length){ rows.push([t("ส่วนที่รวมในรายงาน", "Sections included"), inc.join(", ")], []); }

  if(active==="summary"){
    rows.push([t("ตัวชี้วัด", "Metric"),t("ค่า", "Value")], [t("ลูกค้า", "Customers"),k.customers], ["Lead",k.prospects],
      [t("ความครอบคลุม %", "Coverage %"),k.coverage], [t("ดัชนี Lead", "Lead index"),k.gapScore], [t("ยังขาด (ราย)", "Still short"),k.gapCount]);
    if(rankOppDist?.length){
      rows.push([],[t("พื้นที่ Lead สูงสุด (ระดับอำเภอ)", "Highest-Lead areas (district level)")]);
      rows.push([t("จังหวัด", "Province"),t("อำเภอ/เขต", "District"),t("ลูกค้า", "Customers"),"Lead",t("ดัชนีช่องว่าง", "Gap index"),t("ยังขาด (ราย)", "Still short"),t("ระดับ", "Priority")]);
      rankOppDist.slice(0,8).forEach(d=>rows.push([provinceTH(d.province), districtTH(d.district), d.customerCount, d.prospectCount, d.gapScore, d.gapCount, gapTH(d.gapLevel)]));
    }
  } else if(active==="gap"){
    // Gap Analysis — full per-province demand-gap table (matches the on-screen columns).
    rows.push([t("วิเคราะห์ช่องว่าง (เรียงตามระดับสูง→ต่ำ)", "Gap analysis (highest first)")]);
    rows.push([t("จังหวัด", "Province"),t("ลูกค้าปัจจุบัน", "Existing customers"),"Lead",t("อัตราส่วน", "Ratio"),t("ช่องว่าง (ราย)", "Gap (businesses)"),t("หมวดที่ขาด", "Categories short"),t("หมวดที่ขาดมากสุด", "Largest gap category"),t("ระดับช่องว่าง", "Gap level")]);
    rankGap.forEach(a=>rows.push([provinceTH(a.province), a.customerCount, a.prospectCount,
      "1:"+a.ratio, a.gapCount, a.gapBreadth, a.topGapSegment?segTH(a.topGapSegment):"—", gapTH(a.gapLevel)]));
    if(rankGapDist?.length){
      rows.push([],[t("วิเคราะห์ช่องว่างระดับอำเภอ (กรุงเทพฯ, เชียงใหม่, ภูเก็ต, พัทยา)", "District-level gap analysis (Bangkok, Chiang Mai, Phuket, Pattaya)")]);
      rows.push([t("จังหวัด", "Province"),t("อำเภอ/เขต", "District"),t("ลูกค้าปัจจุบัน", "Existing customers"),"Lead",t("อัตราส่วน", "Ratio"),t("ช่องว่าง (ราย)", "Gap (businesses)"),t("หมวดที่ขาด", "Categories short"),t("หมวดที่ขาดมากสุด", "Largest gap category"),t("ระดับช่องว่าง", "Gap level")]);
      rankGapDist.forEach(d=>rows.push([provinceTH(d.province), districtTH(d.district), d.customerCount, d.prospectCount,
        "1:"+d.ratio, d.gapCount, d.gapBreadth, d.topGapSegment?segTH(d.topGapSegment):"—", gapTH(d.gapLevel)]));
    }
  } else if(active==="geographic"){
    // Mirror the on-screen scoping: focused on one province → export only that province's district rows.
    if(filters.province && filters.province!=="All"){
      const distRowsForExport = (rankOppDist||[]).filter(d=>d.province===filters.province);
      rows.push([t("การกระจายลูกค้าระดับอำเภอ — ", "District-level customer distribution — ")+provinceTH(filters.province)]);
      if(distRowsForExport.length){
        rows.push([t("จังหวัด", "Province"),t("อำเภอ/เขต", "District"),t("ลูกค้า", "Customers"),"Lead",t("ความครอบคลุม%", "Coverage %"),t("อัตราส่วน", "Ratio"),t("ดัชนีช่องว่าง", "Gap index"),t("ยังขาด (ราย)", "Still short"),t("ระดับ", "Priority")]);
        distRowsForExport.forEach(d=>rows.push([provinceTH(d.province), districtTH(d.district), d.customerCount, d.prospectCount, d.coverage, d.ratio, d.gapScore, d.gapCount, gapTH(d.gapLevel)]));
      } else {
        rows.push([t("ยังไม่มีข้อมูลระดับอำเภอสำหรับจังหวัดนี้ในระบบ — ปัจจุบันมีเฉพาะกรุงเทพฯ, เชียงใหม่, ภูเก็ต และพัทยา", "No district-level data for this province yet — currently only Bangkok, Chiang Mai, Phuket and Pattaya")]);
      }
    } else {
      rows.push([t("ความครอบคลุมตลาดตามประเทศ", "Market coverage by country")]);
      rows.push([t("จังหวัด", "Province"),t("ลูกค้า", "Customers"),"Lead",t("ความครอบคลุม%", "Coverage %"),t("อัตราส่วน", "Ratio"),t("ดัชนีช่องว่าง", "Gap index"),t("ยังขาด (ราย)", "Still short"),t("ระดับ", "Priority")]);
      rankOpp.forEach(a=>rows.push([provinceTH(a.province),a.customerCount,a.prospectCount,a.coverage,a.ratio,a.gapScore,a.gapCount,gapTH(a.gapLevel)]));
      if(rankOppDist?.length){
        rows.push([],[t("การกระจายลูกค้าระดับอำเภอ", "District-level customer distribution")]);
        rows.push([t("จังหวัด", "Province"),t("อำเภอ/เขต", "District"),t("ลูกค้า", "Customers"),"Lead",t("ความครอบคลุม%", "Coverage %"),t("อัตราส่วน", "Ratio"),t("ดัชนีช่องว่าง", "Gap index"),t("ยังขาด (ราย)", "Still short"),t("ระดับ", "Priority")]);
        rankOppDist.forEach(d=>rows.push([provinceTH(d.province), districtTH(d.district), d.customerCount, d.prospectCount, d.coverage, d.ratio, d.gapScore, d.gapCount, gapTH(d.gapLevel)]));
      }
    }
  } else {
    const src = active==="coverage"?rankCov : rankOpp;
    rows.push([t("จังหวัด", "Province"),t("ลูกค้า", "Customers"),"Lead",t("ความครอบคลุม%", "Coverage %"),t("อัตราส่วน", "Ratio"),t("ดัชนีช่องว่าง", "Gap index"),t("ยังขาด (ราย)", "Still short"),t("ระดับ", "Priority")]);
    src.forEach(a=>rows.push([provinceTH(a.province),a.customerCount,a.prospectCount,a.coverage,a.ratio,a.gapScore,a.gapCount,gapTH(a.gapLevel)]));
  }
  return rows;
}

// Excel-openable spreadsheet (HTML table with the ms-excel MIME → opens natively in Excel).
export function downloadXLS(filename, rows){
  const esc = s => String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const body = rows.map(r=>"<tr>"+(r.length?r.map(c=>`<td>${esc(c)}</td>`).join(""):"<td></td>")+"</tr>").join("");
  const doc = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head>`+
    `<body><table border="1">${body}</table></body></html>`;
  const url = URL.createObjectURL(new Blob(["﻿"+doc], {type:"application/vnd.ms-excel"}));
  const a = document.createElement("a"); a.href=url; a.download=filename; a.click(); URL.revokeObjectURL(url);
}

const EXPORT_CSS = `
.xp-scope{border:1px solid var(--stroke2);border-radius:12px;padding:13px 15px;background:var(--surface2);display:flex;flex-direction:column;gap:3px}
.xp-scope-h{font-size:12px;font-weight:700;color:var(--muted);margin-bottom:3px}
.xp-scope-r{font-size:13px;color:var(--txt)}
.xp-scope-c{font-size:13.5px;font-weight:800;color:var(--accent);margin-top:5px}
.xp-scope-warn{display:flex;align-items:center;gap:7px;margin-top:8px;font-size:12px;color:#b45309;
  background:rgba(255,176,46,.1);border:1px solid rgba(255,176,46,.3);border-radius:8px;padding:7px 10px}
.xp-radio2{width:17px;height:17px;border-radius:50%;border:2px solid var(--stroke2);flex:none;position:relative;transition:.15s}
.xp-radio2.on{border-color:var(--accent)}
.xp-radio2.on::after{content:"";position:absolute;inset:3px;border-radius:50%;background:var(--accent)}
.xp-csvnote{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--muted);
  background:var(--surface2);border:1px solid var(--stroke2);border-radius:10px;padding:11px 13px}
.xp-backdrop{position:fixed;inset:0;z-index:1200;overflow-y:auto;padding:20px;
  background:rgba(4,7,14,.6);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
  animation:xp-fade .25s ease;font-family:var(--font)}
/* ระยะขอบนอกกล่องกระชับขึ้น + เพดานความสูงคิดจากขอบจริง (padding ฉากหลัง 20px×2 + margin 26+18)
   เพื่อให้ "ตัวเลือกการส่งออก" อยู่ในพื้นที่ที่มองเห็นได้โดยไม่ต้องเลื่อน แม้บนจอเตี้ย */
.xp-card{width:472px;max-width:100%;margin:26px auto 18px;border-radius:22px;
  max-height:calc(100vh - 88px);display:flex;flex-direction:column;
  background:var(--panel);border:1px solid var(--stroke2);box-shadow:0 34px 90px rgba(0,0,0,.6);
  animation:xp-pop .34s cubic-bezier(.2,.9,.25,1)}
.xp-head{flex:none;display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:18px 22px 12px}
.xp-title{margin:0;font-size:19px;font-weight:700;color:var(--txt)}
.xp-desc{margin-top:5px;font-size:13px;color:var(--muted)}
.xp-x{flex:none;width:32px;height:32px;border:none;border-radius:9px;cursor:pointer;background:var(--surface);color:var(--muted);transition:.15s}
.xp-x:hover{background:rgba(30,45,80,.10);color:var(--txt)}
.xp-body{padding:0 22px;flex:1 1 auto;overflow-y:auto;min-height:0}
.xp-label{font-size:12.5px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;color:var(--dim);margin-bottom:7px}
.xp-formats{display:flex;flex-direction:column;gap:7px}
.xp-fmt{display:flex;align-items:center;gap:12px;width:100%;text-align:left;cursor:pointer;
  padding:10px 12px;border-radius:13px;background:var(--surface);border:1.5px solid var(--stroke2);
  font-family:var(--font);transition:.16s}
.xp-fmt:hover{border-color:rgba(120,160,220,.45)}
.xp-fmt.on{border-color:var(--accent2);background:rgba(255, 59, 92,.09)}
.xp-fmt-ic{flex:none;width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:rgba(30,45,80,.07)}
.xp-fmt.on .xp-fmt-ic{background:rgba(255, 59, 92,.16)}
.xp-fmt-main{flex:1;display:flex;flex-direction:column;gap:2px;min-width:0}
.xp-fmt-name{font-size:14px;font-weight:600;color:var(--txt)}
.xp-fmt-name small{font-size:12.5px;font-weight:600;color:var(--dim);margin-left:3px}
.xp-fmt-desc{font-size:12px;color:var(--muted)}
.xp-radio{flex:none;width:18px;height:18px;border-radius:50%;border:2px solid var(--stroke2);transition:.16s}
.xp-radio.on{border-color:var(--accent2);background:radial-gradient(circle,var(--accent2) 0 42%,transparent 46%)}
.xp-file{display:flex;align-items:center;gap:8px;background:var(--surface);border:1.5px solid var(--stroke2);border-radius:12px;padding:2px 12px 2px 4px}
.xp-input{flex:1;min-width:0;border:none;background:transparent;outline:none;color:var(--txt);font-family:var(--font);font-size:13.5px;padding:9px 10px}
.xp-ext{flex:none;font-size:12px;font-weight:700;color:var(--accent2)}
.xp-opts{display:grid;grid-template-columns:1fr 1fr;gap:9px 12px}
.xp-opt{display:flex;align-items:center;gap:9px;cursor:pointer;font-size:13px;color:var(--txt)}
.xp-check{flex:none;width:19px;height:19px;border-radius:6px;border:1.5px solid var(--stroke2);display:grid;place-items:center;transition:.15s}
.xp-check.on{background:var(--accent2);border-color:var(--accent2)}
.xp-preview{max-height:52vh;overflow:auto;border:1px solid var(--stroke2);border-radius:12px;background:var(--surface)}
.xp-prow{display:flex;gap:14px;padding:8px 14px;border-bottom:1px solid var(--stroke);font-size:12.5px;font-family:var(--mono,monospace)}
.xp-prow:last-child{border-bottom:none}
.xp-prow span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xp-prow.head{background:rgba(255, 59, 92,.08);font-weight:700;color:var(--accent2)}
.xp-prow.blank{padding:4px 14px;opacity:.4}
.xp-foot{flex:none;display:flex;justify-content:flex-end;gap:9px;flex-wrap:wrap;padding:15px 22px 18px;margin-top:0}
.xp-btn{display:inline-flex;align-items:center;gap:7px;font-family:var(--font);font-size:13.5px;font-weight:600;
  cursor:pointer;border-radius:11px;padding:11px 20px;transition:.16s}
.xp-btn.ghost{background:transparent;border:1px solid var(--stroke2);color:var(--muted)}
.xp-btn.ghost:hover{color:var(--txt);border-color:rgba(120,160,220,.45)}
.xp-btn.secondary{background:transparent;border:1.5px solid var(--accent);color:var(--accent)}
.xp-btn.secondary:hover{background:var(--accent-soft)}
.xp-btn.primary{border:none;color:#fff;background:linear-gradient(135deg,#e60023,#ff3b5c);box-shadow:0 8px 22px rgba(230, 0, 35,.4)}
.xp-btn.primary:hover{box-shadow:0 12px 30px rgba(230, 0, 35,.55);transform:translateY(-1px)}
@keyframes xp-fade{from{opacity:0}to{opacity:1}}
@keyframes xp-pop{from{opacity:0;transform:translateY(14px) scale(.965)}to{opacity:1;transform:none}}
@media (max-width:520px){.xp-card{width:100%}.xp-opts{grid-template-columns:1fr}.xp-foot{flex-direction:column-reverse}.xp-btn{width:100%;justify-content:center}}
`;
