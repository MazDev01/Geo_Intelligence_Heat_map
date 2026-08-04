// ═══════════════════════════════════════════════════════════════════════════
// src/pages/visit-plan-report.js — "รายงานแผนการเข้าพบ" (visit-plans)
// รายการย่อยใต้เมนูรายงาน · route: /reports/visit-plans (?go=visit-plans)
//
// ขอบเขต: เฉพาะผู้ประสานงานการค้า (TC) — เห็นเฉพาะแผนที่ "ตนเอง" สร้าง ในจังหวัดที่ตนรับผิดชอบ
//   · ผู้ดูแลระบบ/ผู้บริหารไม่เห็นเมนู และเข้า URL ตรงจะถูก redirect ออก (กันที่ app.js)
//   · บังคับซ้ำที่เซิร์ฟเวอร์จาก token: /api/visit-plans ขอแผนของ owner คนอื่น = 403 (server.mjs)
//   · ไม่มีตัวกรองผู้รับผิดชอบ (มีแค่ตัวเอง) · ไม่มีตัวกรองจังหวัด (ล็อกที่จังหวัดตน → แสดงเป็นข้อความในหัวเรื่อง)
//
// หน้านี้ "อ่านอย่างเดียว" — ไม่มีปุ่มแก้ไข/เพิ่มจุด (วางแผนทำที่หน้าแผนที่เท่านั้น)
// แสดงข้อมูล ณ สภาพที่บันทึกไว้จริงในวันนั้น: เกรด/คะแนนเป็น snapshot ณ วันวางแผน (ไม่คำนวณใหม่)
// ห้ามเทียบ TC คนอื่น/ค่าเฉลี่ยทีม/จัดอันดับ · ห้ามแสดงจังหวัดอื่น · วันที่ทุกจุดเป็นพุทธศักราช
// ═══════════════════════════════════════════════════════════════════════════
import {html, useState, useMemo, useEffect, useRef, useApp, Icon, num, provinceTH, districtTH, segTH} from "../lib.js";
import {toast} from "../ui.js";
import {Dropdown} from "../select.js";
import {gradeOf} from "../mock/geoData.js";
import {officeFor, haversine, fmtKm} from "../visit.js";
import {pushAudit} from "../audit.js";
import {ExportDialog, downloadXLS, defaultReportName} from "./reports.js";

/* ---------- วันที่ พ.ศ. ---------- */
const VP_MON=["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
export function beDateVP(iso){ if(!iso) return "—"; const d=new Date(iso); if(isNaN(d)) return "—";
  return d.getDate()+" "+VP_MON[d.getMonth()]+" "+(d.getFullYear()+543); }
const isoDay = ms => new Date(ms).toISOString().slice(0,10);

/* ---------- RNG คงที่ (mock เดิมทุกครั้ง ต่อ จังหวัด+เจ้าของ) ---------- */
function mulberry32(a){ return function(){ let t=a+=0x6D2B79F5; t=Math.imul(t^t>>>15,t|1); t^=t+Math.imul(t^t>>>7,t|61); return ((t^t>>>14)>>>0)/4294967296; }; }
function hashStr(s){ let h=2166136261>>>0; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }

const REF = Date.parse("2026-08-03T00:00:00Z");   // "วันนี้" ของข้อมูลสาธิต (พ.ศ. 2569)
const DAY = 864e5;
const OUTCOMES = ["สนใจ ขอใบเสนอราคา","ต่อรองเงื่อนไข","ขอเวลาตัดสินใจ","ปิดการขาย","นัดคุยรอบถัดไป","ขอข้อมูลเพิ่มเติม"];
const V_NOTES  = ["เจ้าของร้านสนใจแพ็กเกจแลกเปลี่ยน","ขอเปรียบเทียบกับเจ้าอื่นก่อน","ติดประชุม ให้ผู้จัดการรับเรื่องแทน","พร้อมเปิดบิลแรกเดือนหน้า","ขอให้ส่งเอกสารทางอีเมล","สนใจแต่ขอต่อรองค่าธรรมเนียม"];

// สถานะแผนระดับรวม
export const VP_STATUS_TH = {complete:"เสร็จสมบูรณ์", partial:"ทำได้บางส่วน", none:"ไม่ได้ออกพื้นที่"};
// สถานะผู้ถูกนัดรายจุด
const VP_TARGET_TH = {visited:"เข้าพบแล้ว", missed:"ไม่ได้เข้าพบ", cancelled:"ยกเลิก"};

// ─────────────────────────────────────────────────────────────────────────────
// สร้างประวัติแผนการเข้าพบจาก "ข้อมูลจริง" ในจังหวัดของ TC (Lead ในจังหวัดนั้น)
// deterministic ตาม จังหวัด+อีเมลเจ้าของ · เกรด/คะแนนถูก "แช่แข็ง" ไว้บนแต่ละจุด ณ วันวางแผน
// ─────────────────────────────────────────────────────────────────────────────
export function genVisitPlans(prospects, province, ownerEmail){
  const pool = (prospects||[]).filter(p=>p.province===province && p.latitude!=null && p.longitude!=null);
  if(!pool.length) return [];
  const rnd = mulberry32(hashStr(province+"|"+(ownerEmail||"tc")));
  const office = officeFor(province);
  // สลับลำดับ pool แบบคงที่ (Fisher-Yates) แล้วเลือกจุดจากทั่วทั้ง pool → เกรดหลากหลายตามจริง (A/B/C) ไม่กระจุกที่ A
  const shuffled = pool.slice();
  for(let i=shuffled.length-1;i>0;i--){ const j=Math.floor(rnd()*(i+1)); const t=shuffled[i]; shuffled[i]=shuffled[j]; shuffled[j]=t; }
  const N = Math.min(18, Math.max(6, Math.round(shuffled.length/6)));   // จำนวนแผนย้อนหลัง
  const plans = [];
  let dayCursor = 3 + Math.floor(rnd()*4);   // แผนล่าสุดอยู่ ~3-6 วันก่อน
  for(let i=0;i<N;i++){
    const dateMs = REF - dayCursor*DAY;
    dayCursor += 3 + Math.floor(rnd()*7);     // ถอยหลัง 3-9 วันต่อแผน
    const nT = 4 + Math.floor(rnd()*5);       // 4-8 จุดต่อแผน
    // เลือก nT จุดต่อเนื่องจากตำแหน่งสุ่มใน shuffled (ไม่ซ้ำในแผนเดียว · เกรดคละกันตามธรรมชาติ)
    const start = Math.floor(rnd()*shuffled.length);
    const picks = []; for(let k=0;k<nT;k++) picks.push(shuffled[(start+k)%shuffled.length]);
    // ระดับความสำเร็จของแผน → จำนวนจุดที่เข้าพบจริง (จุดแรก ๆ ถูกเข้าพบก่อนตามลำดับวันจริง)
    const eff = rnd();
    const visitedCount = Math.max(0, Math.min(nT, Math.round(eff*nT)));
    let prev = office; let clockMin = 9*60 + Math.floor(rnd()*30);
    const targets = picks.map((p,k)=>{
      const dScore = Math.round((rnd()-0.5)*8);                 // คะแนน ณ วันนั้นต่างจากปัจจุบันเล็กน้อย
      const score_at = Math.max(0, Math.min(100, (p.potentialScore||0)+dScore));
      const grade_at = gradeOf(score_at);
      let status;
      if(k<visitedCount) status="visited";
      else status = (rnd()<0.18) ? "cancelled" : "missed";      // ที่เหลือ: ส่วนใหญ่ไม่ได้เข้าพบ · บางส่วนถูกยกเลิก
      const cur = {latitude:p.latitude, longitude:p.longitude};
      const distFromPrev = haversine(prev, cur); prev = cur;
      let time=null, outcome=null, note=null;
      if(status==="visited"){
        clockMin += 40 + Math.floor(rnd()*35);
        time = String(Math.floor(clockMin/60)).padStart(2,"0")+":"+String(clockMin%60).padStart(2,"0");
        outcome = OUTCOMES[Math.floor(rnd()*OUTCOMES.length)];
        note = V_NOTES[Math.floor(rnd()*V_NOTES.length)];
      }
      return {id:p.id, businessName:p.businessName, segment:p.segment, district:p.district,
        latitude:p.latitude, longitude:p.longitude, score_at, grade_at, status, time, outcome, note, distFromPrev};
    });
    const planned = targets.length;
    const visited = targets.filter(t=>t.status==="visited").length;
    const rate = planned ? Math.round(visited/planned*100) : 0;
    const status = visited===0 ? "none" : (visited===planned ? "complete" : "partial");
    const districts = [...new Set(targets.map(t=>t.district).filter(Boolean))];
    plans.push({ id:"VPL-"+hashStr(province).toString(36)+"-"+i, dateISO:isoDay(dateMs),
      office:{businessName:office.businessName, latitude:office.latitude, longitude:office.longitude},
      planned, visited, rate, status, districts, targets });
  }
  // เรียงใหม่ → เก่า
  return plans.sort((a,b)=>b.dateISO<a.dateISO?-1:1);
}

/* ปุ่มลัดช่วงเวลา → คืน {from,to} เป็น ISO (อิง REF) */
function presetRange(key){
  const to = isoDay(REF);
  if(key==="week"){ const d=new Date(REF); const dow=(d.getUTCDay()+6)%7; return {from:isoDay(REF-dow*DAY), to}; }  // จันทร์สัปดาห์นี้
  if(key==="month"){ const d=new Date(REF); return {from:isoDay(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1)), to}; }
  if(key==="90"){ return {from:isoDay(REF-89*DAY), to}; }
  return {from:"", to:""};
}

const PAGE_SIZE = 20;

export function VisitPlanReport(){
  const {db, user, nav} = useApp();
  const isTC = !!(user && user.role==="Trade Coordinator" && user.province);
  const province = isTC ? user.province : null;

  // ── สถานะตัวกรอง (init จาก URL เพื่อให้เปิด URL ตรง/รีเฟรช/ย้อนกลับได้) ──
  const readParams = ()=>{ const q=new URLSearchParams(location.search);
    return {from:q.get("from")||"", to:q.get("to")||"", dist:q.get("dist")||"all", status:q.get("status")||"all", plan:q.get("plan")||""}; };
  const p0 = readParams();
  const [from,setFrom]     = useState(p0.from);
  const [to,setTo]         = useState(p0.to);
  const [dist,setDist]     = useState(p0.dist);
  const [status,setStatus] = useState(p0.status);
  const [planId,setPlanId] = useState(p0.plan||null);
  const [page,setPage]     = useState(1);
  const [exportOpen,setExportOpen] = useState(false);
  const [denied,setDenied] = useState(false);       // ถูกปฏิเสธจากเซิร์ฟเวอร์ (403)
  const firstRun = useRef(true); const popping = useRef(false);

  // ── redirect บทบาทที่ไม่ใช่ TC ออกจากหน้านี้ (กันเข้า URL ตรง) ──
  useEffect(()=>{ if(!isTC){ toast("หน้านี้สำหรับผู้ประสานงานการค้าเท่านั้น","bad"); nav && nav("workspace"); } }, [isTC]);

  // ── บังคับสิทธิ์ที่เซิร์ฟเวอร์จาก token: ขอแผนของตัวเอง = 200 · ของคนอื่น = 403 ──
  useEffect(()=>{ if(!isTC) return; let alive=true;
    const tok = btoa(unescape(encodeURIComponent(JSON.stringify({email:user.email, role:user.role, province}))));
    fetch(`/api/visit-plans?owner=${encodeURIComponent(user.email)}`, {headers:{Authorization:"Bearer "+tok}})
      .then(r=>{ if(!alive) return; if(r.status===403||r.status===401){ setDenied(true); toast("เซิร์ฟเวอร์ปฏิเสธการเข้าถึงแผนนี้ (403)","bad"); } })
      .catch(()=>{});   // เซิร์ฟเวอร์รุ่นเก่า/ออฟไลน์: ไม่บล็อกการแสดงผล (data มาจากข้อมูลจริงในเครื่องอยู่แล้ว)
    return ()=>{ alive=false; };
  }, [isTC, province]);

  // ── ข้อมูลแผน (จากข้อมูลจริงในจังหวัดของ TC) ──
  const plans = useMemo(()=> isTC ? genVisitPlans(db.prospects||[], province, user.email) : [], [isTC, db.prospects, province, user && user.email]);
  // อำเภอทั้งหมดที่ปรากฏในแผน (ตัวเลือกตัวกรองอำเภอ) — จากข้อมูลจริง
  const distOpts = useMemo(()=>{ const s=new Set(); plans.forEach(pl=>pl.districts.forEach(d=>s.add(d)));
    return [["all","ทุกอำเภอ"], ...[...s].sort().map(d=>[d, districtTH(d)])]; }, [plans]);

  // ── กรอง ──
  const fPlans = useMemo(()=> plans.filter(pl=>{
    if(from && pl.dateISO<from) return false;
    if(to && pl.dateISO>to) return false;
    if(dist!=="all" && !pl.districts.includes(dist)) return false;
    if(status!=="all" && pl.status!==status) return false;
    return true;
  }), [plans, from, to, dist, status]);

  // ── สรุป (ทุกตัวเลขคำนวณจาก fPlans) ──
  const summary = useMemo(()=>{ const planned=fPlans.reduce((a,p)=>a+p.planned,0), visited=fPlans.reduce((a,p)=>a+p.visited,0);
    return {n:fPlans.length, planned, visited, rate: planned?Math.round(visited/planned*100):0}; }, [fPlans]);

  // ── เพจ ──
  const totalPages = Math.max(1, Math.ceil(fPlans.length/PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pageRows = fPlans.slice((pageSafe-1)*PAGE_SIZE, pageSafe*PAGE_SIZE);
  useEffect(()=>{ setPage(1); }, [from,to,dist,status]);

  // ── แผนที่เลือก (section 3) ──
  const selected = fPlans.find(pl=>pl.id===planId) || fPlans[0] || null;

  // ── URL sync (pushState เมื่อกรอง เพื่อให้กดย้อนกลับได้ · popstate → คืนสถานะ) ──
  const writeURL = (st, push)=>{ const q=new URLSearchParams(location.search); q.set("go","visit-plans");
    const set=(k,v,def)=>{ if(v&&v!==def) q.set(k,v); else q.delete(k); };
    set("from",st.from,""); set("to",st.to,""); set("dist",st.dist,"all"); set("status",st.status,"all"); set("plan",st.plan,"");
    const u=location.pathname+"?"+q.toString()+location.hash; push?history.pushState(null,"",u):history.replaceState(null,"",u); };
  useEffect(()=>{ const st={from,to,dist,status,plan:selected?selected.id:""};
    if(popping.current){ popping.current=false; return; }
    writeURL(st, !firstRun.current); firstRun.current=false;
  }, [from,to,dist,status, selected && selected.id]);
  useEffect(()=>{ const onPop=()=>{ const q=readParams(); popping.current=true;
      setFrom(q.from); setTo(q.to); setDist(q.dist); setStatus(q.status); setPlanId(q.plan||null); };
    window.addEventListener("popstate",onPop); return ()=>window.removeEventListener("popstate",onPop); }, []);

  // ── ปุ่มลัดช่วงเวลา ──
  const rangeKey = (()=>{ for(const k of ["week","month","90"]){ const r=presetRange(k); if(r.from===from && r.to===to) return k; } return (from||to)?"custom":"custom"; })();
  const applyPreset = k => { const r=presetRange(k); setFrom(r.from); setTo(r.to); };

  const clearFilters = ()=>{ setFrom(""); setTo(""); setDist("all"); setStatus("all"); };
  const anyFilter = from||to||dist!=="all"||status!=="all";

  // ── ช่วงเวลาเป็นข้อความ พ.ศ. ──
  const rangeText = (from||to) ? (from?beDateVP(from):"เริ่มต้น")+" – "+(to?beDateVP(to):"ล่าสุด") : "ทุกช่วงเวลา";

  // ── ส่งออก (ใช้หน้าต่างส่งออกเดียวกับรายงานอื่น · PDF + Excel) ──
  const exportScope = { areaName: province?provinceTH(province):"", areaLabel: province?("จังหวัด"+provinceTH(province)):"",
    segLabel:"ทุกหมวดธุรกิจ", dateLabel: rangeText, counts:{total: fPlans.length} };
  const buildVpRows = ()=>{ const rows=[];
    rows.push(["รายงานแผนการเข้าพบ · จังหวัด"+provinceTH(province)+" · ผู้จัดทำ "+((user&&user.name)||"")]);
    rows.push(["ช่วงเวลา: "+rangeText]);
    rows.push(["สรุป: พบ "+summary.n+" แผน · วางแผนไว้ "+summary.planned+" แห่ง · เข้าพบจริง "+summary.visited+" แห่ง · อัตราทำตามแผน "+summary.rate+"%"]);
    rows.push([]);
    rows.push(["ตารางสรุปแผน"]);
    rows.push(["วันที่","อำเภอที่ครอบคลุม","วางแผน","เข้าพบจริง","อัตรา (%)","สถานะ"]);
    fPlans.forEach(pl=>rows.push([beDateVP(pl.dateISO), pl.districts.map(districtTH).join(", "), pl.planned, pl.visited, pl.rate, VP_STATUS_TH[pl.status]]));
    rows.push([]);
    rows.push(["รายละเอียดผู้ถูกนัดในแต่ละแผน"]);
    fPlans.forEach(pl=>{ rows.push([]);
      rows.push(["แผนวันที่ "+beDateVP(pl.dateISO)+" · จุดเริ่มต้น "+pl.office.businessName+" · วางแผน "+pl.planned+" · เข้าพบ "+pl.visited]);
      rows.push(["ลำดับ","ธุรกิจ","เกรด/คะแนน (ณ วันนั้น)","หมวดธุรกิจ","อำเภอ","สถานะ","เวลา","ผลการเข้าพบ","บันทึก","ระยะจากจุดก่อน (เส้นตรง)"]);
      pl.targets.forEach((t,i)=>rows.push([i+1, t.businessName, t.grade_at+" · "+t.score_at, segTH(t.segment), districtTH(t.district),
        VP_TARGET_TH[t.status], t.time||"—", t.outcome||"—", t.note||"—", fmtKm(t.distFromPrev)]));
    });
    return rows; };
  const doExport = ({format, filename})=>{
    const name = (filename||"").trim().replace(/[\\/:*?"<>|]+/g,"_") || defaultReportName(exportScope);
    const rows = buildVpRows();
    setExportOpen(false);
    if(format==="excel"){ downloadXLS(name+".xls", rows); toast("ส่งออกไฟล์ Excel แล้ว","good"); }
    else { toast("กำลังเตรียมไฟล์ PDF…","info"); setTimeout(()=>window.print(),350); }
    pushAudit({user:(user&&user.name)||"", action:"ส่งออกรายงานแผนการเข้าพบ", category:"ส่งออก",
      detail:`${format==="excel"?"Excel":"PDF"} · ${name} · จังหวัด${provinceTH(province)} · ${rangeText} · ${fPlans.length} แผน`});
  };

  if(!isTC) return html`<div class="page"><div class="vp-denied"><${Icon} name="lock" size=${18} color="var(--accent)"/> หน้านี้สำหรับผู้ประสานงานการค้าเท่านั้น กำลังนำคุณออก…</div><style>${VP_CSS}</style></div>`;
  if(!db.prospects) return html`<div class="page"><div class="emptybox">กำลังโหลดข้อมูลแผนการเข้าพบ…</div><style>${VP_CSS}</style></div>`;
  if(denied) return html`<div class="page"><div class="vp-denied"><${Icon} name="lock" size=${18} color="var(--accent)"/> เซิร์ฟเวอร์ปฏิเสธการเข้าถึง (403) — คุณเรียกดูได้เฉพาะแผนของตนเองในพื้นที่ที่รับผิดชอบ</div><style>${VP_CSS}</style></div>`;

  const STATUS_OPTS = [["all","ทุกสถานะ"],["complete","เสร็จสมบูรณ์"],["partial","ทำได้บางส่วน"],["none","ไม่ได้ออกพื้นที่"]];
  const CHIPS = [["week","สัปดาห์นี้"],["month","เดือนนี้"],["90","90 วัน"],["custom","กำหนดเอง"]];

  return html`<div class="page fade-in vp-page">
    <!-- แถบย่อยของโมดูลรายงาน -->
    <div class="vp-subnav">
      <button class="vp-subtab" onClick=${()=>nav("reports")}>แดชบอร์ด TC</button>
      <button class="vp-subtab on">รายงานแผนการเข้าพบ</button>
    </div>

    <div class="page-head vp-head">
      <div>
        <div class="eyebrow">รายงาน · แผนการเข้าพบ</div>
        <h1>รายงานแผนการเข้าพบ · จังหวัด${provinceTH(province)}</h1>
        <div class="sub">แผนที่คุณสร้างเองในพื้นที่รับผิดชอบ · ${(user&&user.name)||""} · อ่านอย่างเดียว (วางแผนทำที่หน้าแผนที่)</div>
      </div>
      <div class="ph-right">
        <button class="vp-btn primary" onClick=${()=>setExportOpen(true)}><${Icon} name="download" size=${15} color="#fff"/> ส่งออกรายงาน</button>
      </div>
    </div>

    <!-- ═══ ส่วนที่ 1: แถบตัวกรอง + สรุป ═══ -->
    <div class="vp-filters">
      <div class="vp-frow">
        <div class="vp-f">
          <label>ช่วงเวลา (ตั้งแต่)</label>
          <input type="date" value=${from} max=${to||undefined} onChange=${e=>setFrom(e.target.value)}/>
        </div>
        <div class="vp-f">
          <label>ถึง</label>
          <input type="date" value=${to} min=${from||undefined} onChange=${e=>setTo(e.target.value)}/>
        </div>
        <div class="vp-chips">
          ${CHIPS.map(([k,l])=>html`<button key=${k} class=${"vp-chip"+(rangeKey===k?" on":"")} onClick=${()=>applyPreset(k)}>${l}</button>`)}
        </div>
      </div>
      <div class="vp-frow">
        <div class="vp-f vp-dd"><label>อำเภอ</label><${Dropdown} value=${dist} onChange=${setDist} options=${distOpts}/></div>
        <div class="vp-f vp-dd"><label>สถานะแผน</label><${Dropdown} value=${status} onChange=${setStatus} options=${STATUS_OPTS}/></div>
        <div class="vp-range-txt">ช่วงที่เลือก: <b>${rangeText}</b></div>
        ${anyFilter?html`<button class="vp-btn ghost" onClick=${clearFilters}><${Icon} name="close" size=${14}/> ล้างตัวกรอง</button>`:""}
      </div>
      <div class="vp-summary">
        พบ <b>${num(summary.n)}</b> แผน · วางแผนไว้ <b>${num(summary.planned)}</b> แห่ง · เข้าพบจริง <b>${num(summary.visited)}</b> แห่ง · อัตราทำตามแผน <b class=${summary.rate<50?"vp-warn-t":""}>${summary.rate}%</b>
      </div>
    </div>

    ${fPlans.length===0 ? html`<div class="vp-empty">
        <${Icon} name="info" size=${18} color="var(--accent)"/> ไม่พบแผนตามเงื่อนไขที่เลือก
        <button class="vp-btn ghost" onClick=${clearFilters}>ล้างตัวกรอง</button>
      </div>` : html`
    <div class="vp-cols">
      <!-- ═══ ส่วนที่ 2: ตารางแผน ═══ -->
      <div class="vp-card vp-tablecard">
        <div class="vp-card-h">ตารางแผนการเข้าพบ <span class="vp-dim">(${num(fPlans.length)} แผน · เรียงใหม่→เก่า)</span></div>
        <div class="vp-tablewrap">
          <table class="vp-table">
            <thead><tr>
              <th>วันที่</th><th>อำเภอที่ครอบคลุม</th><th class="rt">วางแผน</th><th class="rt">เข้าพบจริง</th><th class="rt">อัตรา</th><th>สถานะ</th>
            </tr></thead>
            <tbody>
              ${pageRows.map(pl=>html`<tr key=${pl.id} class=${"vp-trow"+(selected&&selected.id===pl.id?" sel":"")+(pl.rate<50?" low":"")} onClick=${()=>setPlanId(pl.id)}>
                <td><b>${beDateVP(pl.dateISO)}</b></td>
                <td class="vp-td-dist">${pl.districts.map(districtTH).join(", ")||"—"}</td>
                <td class="rt">${num(pl.planned)}</td>
                <td class="rt">${num(pl.visited)}</td>
                <td class="rt"><span class=${"vp-rate"+(pl.rate<50?" low":"")}>${pl.rate}%</span></td>
                <td><span class=${"vp-badge s-"+pl.status}>${VP_STATUS_TH[pl.status]}</span></td>
              </tr>`)}
            </tbody>
          </table>
        </div>
        ${totalPages>1?html`<div class="vp-pager">
          <button class="vp-pg" disabled=${pageSafe<=1} onClick=${()=>setPage(p=>Math.max(1,p-1))}>‹ ก่อนหน้า</button>
          <span>หน้า ${pageSafe}/${totalPages}</span>
          <button class="vp-pg" disabled=${pageSafe>=totalPages} onClick=${()=>setPage(p=>Math.min(totalPages,p+1))}>ถัดไป ›</button>
        </div>`:""}
      </div>

      <!-- ═══ ส่วนที่ 3: รายละเอียดแผนที่เลือก ═══ -->
      <div class="vp-card vp-detailcard">
        ${selected?html`
        <div class="vp-card-h">แผนวันที่ ${beDateVP(selected.dateISO)}</div>
        <div class="vp-detail-sub">จุดเริ่มต้น <b>${selected.office.businessName}</b> · วางแผน ${num(selected.planned)} แห่ง · เข้าพบ ${num(selected.visited)} แห่ง</div>
        <div class="vp-cards">
          ${selected.targets.map((t,i)=>html`<div key=${t.id} class=${"vp-tcard t-"+t.status} onClick=${()=>nav("customer",{id:t.id})} title="เปิดรายละเอียดธุรกิจ">
            <div class="vp-tc-top">
              <div class="vp-tc-seq">${i+1}</div>
              <div class="vp-tc-main">
                <div class="vp-tc-nm">${t.businessName} <span class=${"vp-grade g-"+t.grade_at}>${t.grade_at} · ${t.score_at}</span></div>
                <div class="vp-tc-meta">${segTH(t.segment)} · ${districtTH(t.district)}</div>
              </div>
              <span class=${"vp-tbadge tb-"+t.status}>${VP_TARGET_TH[t.status]}</span>
            </div>
            ${t.status==="visited" ? html`<div class="vp-tc-body">
                <div class="vp-tc-line"><span>เวลาที่บันทึก</span><b>${t.time} น.</b></div>
                <div class="vp-tc-line"><span>ผลการเข้าพบ</span><b>${t.outcome}</b></div>
                <div class="vp-tc-note">“${t.note}”</div>
              </div>`
             : t.status==="cancelled" ? html`<div class="vp-tc-flag">นัดถูกยกเลิก</div>`
             : html`<div class="vp-tc-flag">ไม่ได้เข้าพบ — หลุดออกจากแผนเมื่อสิ้นวัน</div>`}
            <div class="vp-tc-dist">ระยะจากจุดก่อนหน้า ${fmtKm(t.distFromPrev)} <span class="vp-dim">(เส้นตรง)</span></div>
          </div>`)}
        </div>` : html`<div class="emptybox">เลือกแผนจากตารางเพื่อดูรายละเอียด</div>`}
      </div>
    </div>`}

    ${exportOpen && html`<${ExportDialog} scope=${exportScope} role=${user.role} simple=${true} formats=${["pdf","excel"]}
      buildPreviewRows=${()=>buildVpRows()} onClose=${()=>setExportOpen(false)} onExport=${doExport}/>`}
    <style>${VP_CSS}</style>
  </div>`;
}

const VP_CSS = `
.vp-page{color:var(--txt)}
.vp-subnav{display:flex;gap:8px;margin-bottom:14px}
.vp-subtab{padding:8px 16px;border-radius:999px;border:1px solid var(--stroke2);background:var(--panel);color:var(--muted);
  font-family:var(--font);font-size:13px;font-weight:600;cursor:pointer}
.vp-subtab.on{background:var(--accent);border-color:var(--accent);color:#fff}
.vp-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;padding-right:52px}
.vp-btn{display:inline-flex;align-items:center;gap:7px;height:38px;padding:0 15px;border-radius:10px;border:1px solid var(--stroke2);
  background:var(--panel);color:var(--txt);font-family:var(--font);font-size:13px;font-weight:600;cursor:pointer}
.vp-btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.vp-btn.ghost{background:transparent}
.vp-btn:hover{filter:brightness(.98)}
.vp-filters{border:1px solid var(--stroke2);border-radius:14px;padding:14px 16px;background:var(--panel);margin-bottom:16px}
.vp-frow{display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap;margin-bottom:10px}
.vp-frow:last-of-type{margin-bottom:0}
.vp-f{display:flex;flex-direction:column;gap:5px}
.vp-f label{font-size:12px;font-weight:600;color:var(--muted)}
.vp-f input[type=date]{height:38px;border:1px solid var(--stroke2);border-radius:10px;padding:0 11px;font-family:var(--font);font-size:13px;color:var(--txt);background:var(--surface)}
.vp-dd{min-width:190px}
.vp-chips{display:flex;gap:7px;flex-wrap:wrap;margin-left:auto}
.vp-chip{padding:8px 13px;border-radius:9px;border:1px solid var(--stroke2);background:var(--surface);color:var(--muted);
  font-family:var(--font);font-size:12.5px;font-weight:600;cursor:pointer}
.vp-chip.on{background:var(--accent-soft);border-color:var(--accent);color:var(--accent-deep,#b30019)}
.vp-range-txt{font-size:12.5px;color:var(--muted);align-self:center}
.vp-range-txt b{color:var(--txt)}
.vp-summary{margin-top:12px;padding-top:11px;border-top:1px dashed var(--stroke);font-size:13.5px;color:var(--txt)}
.vp-summary b{color:var(--accent-deep,#b30019);font-weight:800}
.vp-summary b.vp-warn-t{color:#c2410c}
.vp-warn-t{color:#c2410c}
.vp-empty,.vp-denied{display:flex;align-items:center;gap:10px;justify-content:center;padding:40px 20px;border:1px dashed var(--stroke2);
  border-radius:14px;background:var(--panel);color:var(--txt);font-size:14px}
.vp-empty .vp-btn{margin-left:6px}
.vp-cols{display:grid;grid-template-columns:7fr 5fr;gap:16px;align-items:stretch}
.vp-card{border:1px solid var(--stroke2);border-radius:14px;background:var(--panel);display:flex;flex-direction:column;
  height:calc(100vh - 340px);min-height:420px;overflow:hidden}
.vp-card-h{flex:none;font-size:14px;font-weight:800;color:var(--txt);padding:14px 16px 10px}
.vp-dim{color:var(--muted);font-weight:500;font-size:12px}
.vp-tablewrap{flex:1;overflow:auto}
.vp-table{width:100%;border-collapse:collapse;font-size:13px}
.vp-table thead th{position:sticky;top:0;background:var(--surface2);color:var(--muted);font-weight:700;font-size:12px;
  text-align:left;padding:9px 12px;border-bottom:1px solid var(--stroke);white-space:nowrap;z-index:1}
.vp-table th.rt,.vp-table td.rt{text-align:right}
.vp-table tbody td{padding:10px 12px;border-bottom:1px solid var(--stroke);color:var(--txt)}
.vp-td-dist{max-width:220px;color:var(--muted);font-size:12.5px}
.vp-trow{cursor:pointer}
.vp-trow:hover{background:var(--surface)}
.vp-trow.sel{background:var(--accent-soft)}
.vp-trow.low td{background:rgba(255,176,46,.08)}
.vp-trow.low.sel td{background:var(--accent-soft)}
.vp-rate{font-weight:700;color:var(--txt)}
.vp-rate.low{color:#c2410c}
.vp-badge{font-size:11.5px;font-weight:800;padding:3px 10px;border-radius:999px;white-space:nowrap}
.vp-badge.s-complete{background:rgba(51,214,159,.16);color:#0f7a3d}
.vp-badge.s-partial{background:rgba(255,176,46,.16);color:#b45309}
.vp-badge.s-none{background:rgba(230, 0, 35,.1);color:#b30019}
.vp-pager{flex:none;display:flex;align-items:center;justify-content:center;gap:14px;padding:10px;border-top:1px solid var(--stroke);font-size:12.5px;color:var(--muted)}
.vp-pg{padding:6px 12px;border-radius:8px;border:1px solid var(--stroke2);background:var(--surface);color:var(--txt);cursor:pointer;font-family:var(--font);font-size:12.5px}
.vp-pg:disabled{opacity:.45;cursor:not-allowed}
.vp-detail-sub{flex:none;padding:0 16px 10px;font-size:12.5px;color:var(--muted);border-bottom:1px solid var(--stroke)}
.vp-detail-sub b{color:var(--txt)}
.vp-cards{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px}
.vp-tcard{border:1px solid var(--stroke2);border-radius:12px;padding:11px 13px;background:var(--surface);cursor:pointer;transition:.12s}
.vp-tcard:hover{border-color:var(--accent);box-shadow:0 4px 14px rgba(0,0,0,.06)}
.vp-tcard.t-missed{opacity:.9}
.vp-tc-top{display:flex;align-items:flex-start;gap:10px}
.vp-tc-seq{flex:none;width:24px;height:24px;border-radius:50%;background:var(--accent-soft);color:var(--accent-deep,#b30019);
  font-size:12px;font-weight:800;display:grid;place-items:center;margin-top:1px}
.vp-tc-main{flex:1;min-width:0}
.vp-tc-nm{font-size:13.5px;font-weight:700;color:var(--txt)}
.vp-grade{font-size:11.5px;font-weight:800;padding:1px 8px;border-radius:999px;margin-left:5px;background:var(--surface2);color:var(--muted)}
.vp-grade.g-A{background:rgba(51,214,159,.16);color:#0f7a3d}
.vp-grade.g-B{background:rgba(255,176,46,.16);color:#b45309}
.vp-tc-meta{font-size:12px;color:var(--muted);margin-top:2px}
.vp-tbadge{flex:none;font-size:11px;font-weight:800;padding:3px 9px;border-radius:999px;white-space:nowrap}
.vp-tbadge.tb-visited{background:rgba(51,214,159,.16);color:#0f7a3d}
.vp-tbadge.tb-missed{background:var(--surface2);color:var(--muted)}
.vp-tbadge.tb-cancelled{background:rgba(230, 0, 35,.1);color:#b30019}
.vp-tc-body{margin-top:9px;padding-top:9px;border-top:1px dashed var(--stroke)}
.vp-tc-line{display:flex;justify-content:space-between;font-size:12.5px;padding:2px 0;color:var(--txt)}
.vp-tc-line span{color:var(--muted)}
.vp-tc-note{font-size:12.5px;color:var(--txt);margin-top:5px;background:var(--surface2);border-radius:8px;padding:7px 9px}
.vp-tc-flag{margin-top:8px;font-size:12px;color:#b45309;background:rgba(255,176,46,.1);border-radius:8px;padding:6px 9px}
.vp-tcard.t-cancelled .vp-tc-flag{color:#b30019;background:rgba(230, 0, 35,.08)}
.vp-tc-dist{margin-top:8px;font-size:12px;color:var(--muted)}
@media(max-width:900px){.vp-cols{grid-template-columns:1fr}.vp-card{height:auto;max-height:70vh}}
@media print{.vp-subnav,.vp-chips,.vp-filters .vp-btn,.ph-right,.vp-pager{display:none!important}.vp-card{height:auto;overflow:visible}}
`;
