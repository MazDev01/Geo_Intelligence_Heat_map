// ═══════════════════════════════════════════════════════════════════════════
// src/pages/lead-management.js — "จัดการ Lead" (route /admin/leads, tab=leads)
// รวมงานเดิม 2 แท็บ ("ข้อมูลที่ TC กรอกเข้ามา" + "คำขอเปลี่ยนเป็นลูกค้า") เป็นไปป์ไลน์เดียว
// เฉพาะผู้ดูแลระบบ · ตรวจ "ข้อมูลซ้ำ (duplicate)" ในประเทศเท่านั้น (ไม่ใช้บริการภายนอก)
// สถานะ: รอตรวจสอบ · ข้อมูลซ้ำ · รออนุมัติ · อนุมัติแล้ว · ปฏิเสธ · เปลี่ยนเป็นลูกค้าแล้ว
// วันที่ทุกจุดเป็นพุทธศักราช · ตัวอักษร slate-900/700/600 บนพื้นขาว · ทุกการตัดสินเขียน audit log
// ═══════════════════════════════════════════════════════════════════════════
import {html, useState, useEffect, useMemo, useRef, useApp, Icon, num, provinceTH} from "../lib.js";
import {Btn, Badge, Table, Modal, toast} from "../ui.js";
import {SEGMENTS, SEG_TH, PROVINCE_KEYS, gradeOf} from "../mock/geoData.js";
import {pushAudit} from "../audit.js";
import {Dropdown} from "../select.js";
import {createPortal} from "react-dom";

const TH_MON=["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const LD_TODAY=Date.parse("2026-08-03T00:00:00Z");
const beD=iso=>{ const d=new Date(iso); if(isNaN(d)) return "—"; return d.getUTCDate()+" "+TH_MON[d.getUTCMonth()]+" "+(d.getUTCFullYear()+543); };
const daysAgo=iso=>Math.max(0, Math.floor((LD_TODAY-Date.parse(iso))/864e5));
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

const PROV_TH = PROVINCE_KEYS;
const BIZ = ["ครัวคุณย่า","เดอะโค้ชโฮเทล","บิวตี้เฮาส์","สปาเรือนไทย","มอเตอร์พลัส","โฮมสตูดิโอ","ติวเตอร์เฮาส์","ที่ปรึกษาธุรกิจสยาม","มาร์ทเฟรช","เทคโฟกัส","คลีนโปร","อีเวนต์เอเจนซี","คาเฟ่ริมคลอง","รีสอร์ทภูวิว","ร้านอะไหล่ยนต์","เฟอร์นิเจอร์ดีไซน์"];
const CONTACTS=["สมชาย ใจดี","มาลี ทองคำ","วิภา สุขสันต์","ธนา รุ่งเรือง","อนงค์ พิพัฒน์","เกียรติ ชัยชนะ","พิมพ์ ศรีสุข","รัตน์ วัฒนา"];
const SUBMITTERS=[{name:"ธนพล ศรีวัฒน์",role:"TC"},{name:"ปิยะนุช วงศ์สกุล",role:"TC"},{name:"ศุภมาส เจริญสุข",role:"TC"},{name:"ณัฐริกา พงษ์ไพบูลย์",role:"Manager"},{name:"กิตติศักดิ์ อารยะกุล",role:"Manager"}];
const OWNERS=["ธนพล ศรีวัฒน์","ปิยะนุช วงศ์สกุล","ศุภมาส เจริญสุข","ผู้ดูแลระบบ"];
const CUST_TYPES=["ลูกค้าองค์กร","ลูกค้ารายย่อย","คู่ค้า/พันธมิตร"];
const REJECT_REASONS=[["dup","เป็นลูกค้าอยู่แล้ว / รายการซ้ำ"],["evidence","ข้อมูลไม่เพียงพอ/ไม่ชัดเจน"],
  ["wrongdata","พื้นที่/ข้อมูลธุรกิจไม่ถูกต้อง"],["notreal","ไม่พบว่ามีกิจการจริง"],["other","อื่น ๆ (ระบุ)"]];
const REJ_TH=Object.fromEntries(REJECT_REASONS.map(([k,v])=>[k,v]));

// สถานะไปป์ไลน์: ป้าย + สี (badge)
export const LEAD_STATUS={
  review:   {label:"รอตรวจสอบ",         bg:"rgba(255,176,46,.16)", fg:"#b45309"},
  dup:      {label:"ข้อมูลซ้ำ",          bg:"rgba(230, 0, 35,.12)",  fg:"#b30019"},
  pending:  {label:"รออนุมัติ",          bg:"rgba(240,160,34,.18)", fg:"#c2410c"},
  approved: {label:"อนุมัติแล้ว",         bg:"rgba(51,214,159,.16)", fg:"#0f7a3d"},
  rejected: {label:"ปฏิเสธ",             bg:"rgba(100,116,139,.15)",fg:"#475569"},
  converted:{label:"เป็นลูกค้าแล้ว",      bg:"rgba(47,127,224,.15)", fg:"#2f7fe0"},
};
const ACTIONABLE=["review","dup","pending"];   // สถานะที่ต้องจัดการ

// ── ตรวจข้อมูลซ้ำ (dedup) — คำนวณในประเทศเท่านั้น ตามเกณฑ์ในสเปก ──
const stripName=s=>(s||"").replace(/บริษัท|ห้างหุ้นส่วนจำกัด|หจก\.?|ร้าน|จำกัด|\(.*?\)/g,"").replace(/\s+/g,"");
const stripPhone=s=>(s||"").replace(/[-\s]/g,"");
function haversineM(a,b){ const R=6371000, dLat=(b.lat-a.lat)*Math.PI/180, dLng=(b.lng-a.lng)*Math.PI/180;
  const s=Math.sin(dLat/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(s))); }
// คืนคะแนนความซ้ำ 0..1 เทียบ lead กับ record เดิม 1 ราย
export function dupScoreOf(lead, cand){
  let name=0;
  if(lead.businessName && cand.name && lead.businessName===cand.name) name=1.0;
  else { const a=stripName(lead.businessName), b=stripName(cand.name);
    if(a && b){ if(a===b) name=0.9; else if(a.includes(b)||b.includes(a)) name=0.75; else name=0; } }
  let s=name;
  if(stripPhone(lead.phone) && stripPhone(lead.phone)===stripPhone(cand.phone)) s+=0.4;
  if(lead.email && cand.email && lead.email===cand.email) s+=0.3;
  if(lead.lat&&cand.lat && haversineM({lat:lead.lat,lng:lead.lng},{lat:cand.lat,lng:cand.lng})<=50) s+=0.3;
  return Math.min(1, s);
}

// ── mock: 40 รายการกระจายทุกสถานะ ──
export function genLeads(){
  const R=mulberry32(20260808); const rp=a=>a[Math.floor(R()*a.length)]; const ri=(a,b)=>Math.floor(a+R()*(b-a+1));
  const suf=["","สาขา 1","สาขา 2","สำนักงานใหญ่","ในเมือง"];
  // แผนสถานะ 40 ช่อง: dup5 · review12 · pending8 · approved6 · rejected4 · converted5
  const plan=[].concat(Array(5).fill("dup"),Array(12).fill("review"),Array(8).fill("pending"),
    Array(6).fill("approved"),Array(4).fill("rejected"),Array(5).fill("converted"));
  const out=[];
  for(let i=0;i<40;i++){
    const status=plan[i];
    const base=rp(BIZ); const nm=(base+" "+rp(suf)).trim();
    const prov=rp(PROV_TH); const lat=+(13+R()*6).toFixed(4), lng=+(98+R()*3).toFixed(4);
    const phone="0"+ri(600000000,899999999); const email=stripName(base).slice(0,6).toLowerCase()+ri(1,99)+"@mail.com";
    const sub=rp(SUBMITTERS);
    const days = status==="pending"||status==="review"||status==="dup" ? ri(1,60) : ri(20,120);
    const submittedAt=new Date(LD_TODAY-days*864e5).toISOString();
    const lead={ id:"LD-"+String(125+i).padStart(5,"0"), businessName:nm,
      address:ri(1,999)+" ถ."+rp(["สุขุมวิท","นิมมานเหมินท์","ช้างคลาน","เจริญเมือง","ท่าแพ"]), province:prov, district:"",
      lat, lng, contact:rp(CONTACTS), phone, email, type:rp(["Prospect","Lead"]),
      segment:rp(SEGMENTS), submitter:sub, submittedAt, status,
      customerId:null, rejectReason:null, rejectNote:null, convertedAt:null, owner:null, custType:null,
      score:ri(52,99) };
    // เพื่อนบ้าน (record เดิมในระบบ) สำหรับตรวจซ้ำ — 5 รายซ้ำสูง(≥90) · 8 รายใกล้เคียง(60–89) · ที่เหลือไม่ซ้ำ
    let matches=[];
    if(status==="dup"){   // ซ้ำสูง: ชื่อเกือบเหมือน + เบอร์/พิกัดตรง
      matches=[{id:"CU-"+String(35+i).padStart(5,"0"), name:base+" สาขาเดิม", address:"เลขที่เดิม ถ."+prov, province:prov,
        phone, email, lat:+(lat+0.0002).toFixed(4), lng:+(lng+0.0001).toFixed(4)}];
    } else if(i%5===1 && (status==="review"||status==="pending")){   // ใกล้เคียง
      matches=[{id:"CU-"+String(70+i).padStart(5,"0"), name:base, address:"ถ."+prov, province:prov,
        phone:"0"+ri(600000000,899999999), email:"", lat:+(lat+0.02).toFixed(4), lng:+(lng+0.02).toFixed(4)}];
    }
    lead.dupMatches = matches.map(m=>({...m, score:Math.round(dupScoreOf(lead,m)*100)})).sort((a,b)=>b.score-a.score);
    lead.dupScore = lead.dupMatches.length ? lead.dupMatches[0].score : 0;
    lead.checkResult = lead.dupScore>=90 ? "พบข้อมูลซ้ำ" : lead.dupScore>=60 ? "ข้อมูลใกล้เคียง"
      : (status==="approved"||status==="converted") ? "ผ่าน" : "ไม่มีข้อมูลซ้ำ";
    if(status==="converted"){ lead.customerId="CU-"+String(125+i).padStart(5,"0"); lead.convertedAt=new Date(LD_TODAY-ri(1,15)*864e5).toISOString();
      lead.owner=rp(OWNERS); lead.custType=rp(CUST_TYPES); lead.score=0; }
    if(status==="rejected"){ const rr=rp(REJECT_REASONS); lead.rejectReason=rr[0]; }
    out.push(lead);
  }
  return out;
}

const StatusBadge=({s})=>{ const m=LEAD_STATUS[s]||{}; return html`<span class="ld-badge" style=${{background:m.bg,color:m.fg}}>${m.label}</span>`; };
const RoleBadge=({role})=>html`<span class=${"ld-role "+(role==="Manager"?"mgr":"tc")}>${role}</span>`;

// ปุ่มเดียวตามสถานะ (ข้อ 3.3)
function actionOf(status){
  if(status==="review"||status==="dup"||status==="pending") return {label:"ตรวจสอบ", act:"review", variant:"outline"};
  if(status==="approved") return {label:"เปลี่ยนเป็นลูกค้า", act:"convert", variant:"primary"};
  return {label:"ดูข้อมูล", act:"view", variant:"ghost"};   // rejected / converted
}

export function LeadManagement({leads, setLeads}){
  const {db, nav} = useApp();
  const readP=()=>{ const q=new URLSearchParams(location.search);
    return {st:q.get("lst")||"all", type:q.get("ltype")||"all", sub:q.get("lsub")||"all", prov:q.get("lprov")||"all",
      from:q.get("lfrom")||"", to:q.get("lto")||"", q:q.get("lq")||""}; };
  const p0=readP();
  const [fSt,setFSt]=useState(p0.st);
  const [fType,setFType]=useState(p0.type);
  const [fSub,setFSub]=useState(p0.sub);
  const [fProv,setFProv]=useState(p0.prov);
  const [fFrom,setFFrom]=useState(p0.from);
  const [fTo,setFTo]=useState(p0.to);
  const [q,setQ]=useState(p0.q);
  const [page,setPage]=useState(1);
  const [drawer,setDrawer]=useState(null);   // lead ที่กำลังตรวจสอบ
  const [convert,setConvert]=useState(null);  // lead ที่กำลังแปลงเป็นลูกค้า
  const first=useRef(true);

  // URL sync (แชร์ลิงก์/บุ๊กมาร์กได้)
  useEffect(()=>{ const u=new URL(location.href);
    const set=(k,v,def)=>{ if(v&&v!==def) u.searchParams.set(k,v); else u.searchParams.delete(k); };
    set("lst",fSt,"all"); set("ltype",fType,"all"); set("lsub",fSub,"all"); set("lprov",fProv,"all");
    set("lfrom",fFrom,""); set("lto",fTo,""); set("lq",q,"");
    history.replaceState(null,"",u.pathname+u.search);
  },[fSt,fType,fSub,fProv,fFrom,fTo,q]);
  useEffect(()=>{ setPage(1); },[fSt,fType,fSub,fProv,fFrom,fTo,q]);

  const subNames=[...new Set(leads.map(l=>l.submitter.name))];
  const statusCounts=useMemo(()=>{ const c={all:leads.length}; leads.forEach(l=>c[l.status]=(c[l.status]||0)+1); return c; },[leads]);

  // กรอง
  const dateOk=l=>{ const d=l.submittedAt.slice(0,10);
    return (!fFrom||d>=fFrom) && (!fTo||d<=fTo); };
  const filtered=useMemo(()=> leads.filter(l=>
    (fSt==="all"||l.status===fSt) &&
    (fType==="all"||l.type===fType) &&
    (fSub==="all"|| (fSub==="TC"||fSub==="Manager" ? l.submitter.role===fSub : l.submitter.name===fSub)) &&
    (fProv==="all"||l.province===fProv) && dateOk(l) &&
    (!q || [l.businessName,l.contact,l.phone,l.email].some(v=>(v||"").toLowerCase().includes(q.toLowerCase())))
  ).sort((a,b)=>{ // รายการที่ต้องจัดการอยู่บน · ในกลุ่มเรียงตามวันที่ส่งเก่า→ใหม่
    const aa=ACTIONABLE.includes(a.status)?0:1, bb=ACTIONABLE.includes(b.status)?0:1;
    if(aa!==bb) return aa-bb;
    return a.submittedAt<b.submittedAt?-1:1;
  }), [leads,fSt,fType,fSub,fProv,fFrom,fTo,q]);

  const PAGE=20; const totalPages=Math.max(1,Math.ceil(filtered.length/PAGE)); const pageSafe=Math.min(page,totalPages);
  const pageRows=filtered.slice((pageSafe-1)*PAGE,pageSafe*PAGE);

  // สรุปบรรทัดเดียว
  const nReview=statusCounts.review||0, nDup=statusCounts.dup||0;
  const oldest=leads.filter(l=>ACTIONABLE.includes(l.status)).reduce((m,l)=>Math.max(m,daysAgo(l.submittedAt)),0);

  const anyFilter=fSt!=="all"||fType!=="all"||fSub!=="all"||fProv!=="all"||fFrom||fTo||q;
  const clear=()=>{ setFSt("all");setFType("all");setFSub("all");setFProv("all");setFFrom("");setFTo("");setQ(""); };
  const doExport=()=>{ pushAudit({action:"ส่งออกรายงาน Lead", category:"ส่งออก", detail:`ตามตัวกรองปัจจุบัน · ${filtered.length} รายการ`});
    toast(`ส่งออก ${filtered.length} รายการแล้ว`,"good"); };

  const patch=(id,p)=>setLeads(ls=>ls.map(l=>l.id===id?{...l,...p}:l));
  const CHIPS=[["all","ทั้งหมด"],["review","รอตรวจสอบ"],["dup","ข้อมูลซ้ำ"],["pending","รออนุมัติ"],
    ["approved","อนุมัติแล้ว"],["rejected","ปฏิเสธ"],["converted","เปลี่ยนเป็นลูกค้าแล้ว"]];
  const provOpts=[["all","ทุกจังหวัด"],...PROV_TH.map(p=>[p,provinceTH(p)])];
  const typeOpts=[["all","ทุกประเภท"],["Prospect","Prospect"],["Lead","Lead"]];
  const subOpts=[["all","ผู้ส่งทั้งหมด"],["TC","เฉพาะ TC"],["Manager","เฉพาะ Manager"],...subNames.map(n=>[n,n])];

  const onAction=l=>{ const a=actionOf(l.status);
    if(a.act==="convert") setConvert(l); else setDrawer(l); };

  return html`<div class="ld-page">
    <!-- ═══ ส่วนบน: ตัวกรอง ═══ -->
    <div class="ld-filters">
      <div class="ld-chips">
        ${CHIPS.map(([v,l])=>html`<button key=${v} class=${"ld-chip"+(fSt===v?" on":"")} onClick=${()=>setFSt(v)}>
          ${l} <b>${num(statusCounts[v==="all"?"all":v]||0)}</b></button>`)}
      </div>
      <div class="ld-frow">
        <div class="ld-dd"><${Dropdown} value=${fType} onChange=${setFType} options=${typeOpts}/></div>
        <div class="ld-dd"><${Dropdown} value=${fSub} onChange=${setFSub} options=${subOpts}/></div>
        <div class="ld-dd"><${Dropdown} value=${fProv} onChange=${setFProv} options=${provOpts}/></div>
        <input class="ld-date" type="date" value=${fFrom} max=${fTo||undefined} onChange=${e=>setFFrom(e.target.value)} title="วันที่ส่ง (ตั้งแต่)"/>
        <span class="ld-dash">–</span>
        <input class="ld-date" type="date" value=${fTo} min=${fFrom||undefined} onChange=${e=>setFTo(e.target.value)} title="ถึง"/>
        <input class="ld-search" placeholder="ค้นหา ชื่อลูกค้า · บริษัท · เบอร์โทร · อีเมล" value=${q} onInput=${e=>setQ(e.target.value)}/>
        <div class="ld-fr-right">
          ${anyFilter?html`<${Btn} size="sm" variant="ghost" onClick=${clear}>ล้างตัวกรอง</${Btn}>`:""}
        </div>
      </div>
      <div class="ld-summary">
        พบ <b>${num(filtered.length)}</b> รายการ · รอตรวจสอบ <b>${num(nReview)}</b> · ข้อมูลซ้ำ <b class=${nDup?"ld-warn":""}>${num(nDup)}</b> · ค้างนานที่สุด <b>${oldest}</b> วัน
      </div>
    </div>

    <!-- ═══ ตาราง ═══ -->
    ${filtered.length===0 ? html`<div class="ld-empty">
        <${Icon} name="info" size=${18} color="var(--accent)"/> ไม่พบรายการตามเงื่อนไขที่เลือก
        ${anyFilter?html`<${Btn} size="sm" variant="ghost" onClick=${clear}>ล้างตัวกรอง</${Btn}>`:""}
      </div>` : html`
    <div class="ld-tablewrap">
      <table class="ld-table">
        <thead><tr>
          <th>สถานะ</th><th>Lead ID</th><th>ชื่อลูกค้า/บริษัท</th><th>ผู้ส่ง</th><th>วันที่ส่ง</th>
          <th class="rt">คะแนนซ้ำ</th><th>ผลตรวจสอบ</th><th class="rt">การจัดการ</th>
        </tr></thead>
        <tbody>
          ${pageRows.map(l=>{ const a=actionOf(l.status);
            return html`<tr key=${l.id} class=${l.dupScore>=90?"ld-hi":""}>
            <td><${StatusBadge} s=${l.status}/></td>
            <td><b>${l.id}</b>${l.customerId?html`<div class="ld-cid">${l.customerId}</div>`:""}</td>
            <td>${l.businessName}<div class="ld-dim">${l.type}</div></td>
            <td>${l.submitter.name} <${RoleBadge} role=${l.submitter.role}/></td>
            <td>${beD(l.submittedAt)}</td>
            <td class="rt">${l.dupScore?html`<span class=${l.dupScore>=90?"ld-score hi":l.dupScore>=60?"ld-score mid":"ld-score"}>${l.dupScore}%</span>`:html`<span class="ld-dim">—</span>`}</td>
            <td class="ld-dim">${l.checkResult}</td>
            <td class="rt"><${Btn} size="sm" variant=${a.variant} onClick=${()=>onAction(l)}>${a.label}</${Btn}></td>
          </tr>`; })}
        </tbody>
      </table>
    </div>
    ${totalPages>1?html`<div class="ld-pager">
      <span class="ld-dim">แสดง ${(pageSafe-1)*PAGE+1}–${Math.min(pageSafe*PAGE,filtered.length)} จาก ${num(filtered.length)} รายการ</span>
      <div class="row" style=${{gap:"5px"}}>
        <button class="ld-pg" disabled=${pageSafe<=1} onClick=${()=>setPage(p=>Math.max(1,p-1))}>‹</button>
        <span class="ld-dim">${pageSafe}/${totalPages}</span>
        <button class="ld-pg" disabled=${pageSafe>=totalPages} onClick=${()=>setPage(p=>Math.min(totalPages,p+1))}>›</button>
      </div></div>`:""}`}

    ${drawer?html`<${ReviewDrawer} lead=${drawer} onClose=${()=>setDrawer(null)}
      onReject=${(reason,note)=>{ patch(drawer.id,{status:"rejected",rejectReason:reason,rejectNote:note});
        pushAudit({action:"ปฏิเสธ Lead", category:"แก้ไข", detail:`${drawer.businessName} (${drawer.id}) · เหตุผล: ${REJ_TH[reason]}${reason==="other"&&note?" — "+note:""}`});
        toast("ปฏิเสธรายการแล้ว","warn"); setDrawer(null); }}
      onMerge=${(matchId)=>{ patch(drawer.id,{status:"rejected",rejectReason:"dup",rejectNote:"รวมกับ "+matchId});
        pushAudit({action:"รวมกับข้อมูลเดิม", category:"แก้ไข", detail:`${drawer.businessName} (${drawer.id}) → คงรหัส ${matchId}`});
        toast("รวมกับข้อมูลเดิมแล้ว — คงรหัส "+matchId,"good"); setDrawer(null); }}
      onApprove=${()=>{ patch(drawer.id,{status:"approved"});
        pushAudit({action:"อนุมัติ Lead", category:"แก้ไข", detail:`${drawer.businessName} (${drawer.id}) · พร้อมเปลี่ยนเป็นลูกค้า`});
        toast("อนุมัติแล้ว — เปลี่ยนเป็นลูกค้าได้","good"); setDrawer(null); }}/>`:""}

    ${convert?html`<${ConvertForm} lead=${convert} onClose=${()=>setConvert(null)}
      onDone=${(owner,seg,ctype)=>{ const cid="CU-"+convert.id.replace("LD-","");
        patch(convert.id,{status:"converted",customerId:cid,convertedAt:new Date(LD_TODAY).toISOString(),owner,segment:seg,custType:ctype});
        pushAudit({action:"อนุมัติเปลี่ยนเป็นลูกค้า", category:"แก้ไข", detail:`${convert.businessName} (${convert.id}) · คงรหัส Lead เดิม เชื่อมกับ ${cid}`});
        pushAudit({action:"เปลี่ยนประเภทเป็นลูกค้า (เรคคอร์ด)", category:"แก้ไข", detail:`${cid} · ผู้ดูแล ${owner} · หมวด ${SEG_TH[seg]||seg} · ประเภท ${ctype} · แจ้งเตือน ${convert.submitter.name}`});
        toast(`เปลี่ยนเป็นลูกค้าแล้ว (${cid}) — คง Lead ID เดิม`,"good"); setConvert(null); }}/>`:""}
    <style>${LD_CSS}</style>
  </div>`;
}

/* ── แผงตรวจสอบ (drawer ขวา · 3 ส่วน) ── */
function ReviewDrawer({lead, onClose, onReject, onMerge, onApprove}){
  const [mode,setMode]=useState(null);   // null | 'reject' | 'merge'
  const [rcode,setRcode]=useState("dup"); const [rnote,setRnote]=useState("");
  const [pick,setPick]=useState({});      // ฟิลด์→'old'|'new' สำหรับ merge
  const m0=lead.dupMatches[0];
  const FIELDS=[["businessName","ชื่อธุรกิจ"],["address","ที่อยู่"],["phone","เบอร์โทร"],["segment","หมวดธุรกิจ"]];
  const node=html`<div class="ld-back" onMouseDown=${e=>{ if(e.target.classList.contains("ld-back")) onClose(); }}>
    <div class="ld-drawer">
      <div class="ld-dr-head">
        <div><div class="ld-dr-nm">${lead.businessName}</div>
          <div class="ld-dim">${lead.id}${lead.customerId?" · "+lead.customerId:""} · ${lead.type} · ${provinceTH(lead.province)}</div></div>
        <button class="ld-x" onClick=${onClose}><${Icon} name="close" size=${16}/></button>
      </div>
      <div class="ld-dr-body">
        <!-- ส่วนที่ 1 · ข้อมูล Lead -->
        <div class="ld-sec-t">ข้อมูล Lead</div>
        <div class="ld-kv"><span>ชื่อบริษัท</span><b>${lead.businessName}</b></div>
        <div class="ld-kv"><span>ที่อยู่</span><b>${lead.address}</b></div>
        <div class="ld-kv"><span>จังหวัด</span><b>${provinceTH(lead.province)}</b></div>
        <div class="ld-kv"><span>ผู้ติดต่อ</span><b>${lead.contact}</b></div>
        <div class="ld-kv"><span>เบอร์โทร</span><b>${lead.phone}</b></div>
        <div class="ld-kv"><span>อีเมล</span><b>${lead.email}</b></div>

        <!-- ส่วนที่ 2 · ผลตรวจข้อมูลซ้ำ -->
        <div class="ld-sec-t">ผลตรวจข้อมูลซ้ำ <span class="ld-dim" style=${{fontWeight:400}}>(เทียบในประเทศเท่านั้น)</span></div>
        ${lead.dupMatches.length ? html`<div class="ld-dups">
          ${lead.dupMatches.map(mt=>html`<div key=${mt.id} class=${"ld-dup"+(mt.score>=90?" hi":"")}>
            <div class="ld-dup-h"><b>${mt.name}</b><span class=${"ld-score"+(mt.score>=90?" hi":mt.score>=60?" mid":"")}>${mt.score}%</span></div>
            <div class="ld-dim">รหัสเดิม ${mt.id} · ${mt.address} · ${provinceTH(mt.province)}${mt.phone?" · "+mt.phone:""}</div>
          </div>`)}
        </div>` : html`<div class="ld-none"><${Icon} name="check" size=${15} color="#0f7a3d"/> ไม่พบข้อมูลซ้ำในระบบ</div>`}

        <!-- ส่วนที่ 3 · การดำเนินการ -->
        <div class="ld-sec-t">การดำเนินการของผู้ดูแลระบบ</div>
        ${mode==="reject" ? html`<div class="ld-act-box">
          <div class="ld-dim" style=${{marginBottom:"8px"}}>เลือกเหตุผลการปฏิเสธ:</div>
          <div class="ld-reasons">${REJECT_REASONS.map(([k,v])=>html`<label key=${k} class=${"ld-reason"+(rcode===k?" on":"")}>
            <input type="radio" name="rj" checked=${rcode===k} onChange=${()=>setRcode(k)}/> ${v}</label>`)}</div>
          ${rcode==="other"?html`<textarea class="ld-note" placeholder="ระบุเหตุผล…" value=${rnote} onInput=${e=>setRnote(e.target.value)}></textarea>`:""}
        </div>`
        : mode==="merge" ? html`<div class="ld-act-box">
          ${m0?html`<div class="ld-dim" style=${{marginBottom:"8px"}}>เลือกค่าที่จะใช้ต่อรายฟิลด์ · <b>คงรหัสเดิม ${m0.id}</b> เสมอ</div>
          <div class="ld-cmp ld-cmp-h"><span></span><span>ข้อมูลเดิม (${m0.id})</span><span>ข้อมูลใหม่ (${lead.id})</span></div>
          ${FIELDS.map(([k,lb])=>{ const ov=k==="segment"?(SEG_TH[m0.segment]||m0[k]||"—"):(m0[k]||"—"); const nv=k==="segment"?(SEG_TH[lead.segment]||lead[k]):(lead[k]||"—");
            const sel=pick[k]||"old";
            return html`<div key=${k} class="ld-cmp"><span class="ld-cmp-l">${lb}</span>
              <label class=${"ld-cmp-c"+(sel==="old"?" on":"")}><input type="radio" name=${"m"+k} checked=${sel==="old"} onChange=${()=>setPick(p=>({...p,[k]:"old"}))}/> ${ov}</label>
              <label class=${"ld-cmp-c"+(sel==="new"?" on":"")}><input type="radio" name=${"m"+k} checked=${sel==="new"} onChange=${()=>setPick(p=>({...p,[k]:"new"}))}/> ${nv}</label>
            </div>`; })}` : html`<div class="ld-dim">ไม่มีรายการเดิมให้รวม</div>`}
        </div>`
        : html`<div class="ld-dim">เลือกดำเนินการด้านล่าง — อนุมัติเพื่อไปขั้นเปลี่ยนเป็นลูกค้า · ปฏิเสธ · หรือรวมกับข้อมูลเดิม</div>`}
      </div>
      <div class="ld-dr-foot">
        ${mode ? html`<${Btn} variant="ghost" onClick=${()=>setMode(null)}>ย้อนกลับ</${Btn}>` : html`<span></span>`}
        ${mode==="reject" ? html`<${Btn} variant="primary" onClick=${()=>{ if(rcode==="other"&&!rnote.trim()){toast("กรุณาระบุเหตุผล","warn");return;} onReject(rcode,rnote.trim()); }}>ยืนยันปฏิเสธ</${Btn}>`
        : mode==="merge" ? html`<${Btn} variant="primary" disabled=${!m0} onClick=${()=>onMerge(m0.id)}>ยืนยันรวม (คงรหัส ${m0?m0.id:""})</${Btn}>`
        : html`<div class="row" style=${{gap:"8px"}}>
            <${Btn} variant="ghost" onClick=${()=>setMode("reject")}>ปฏิเสธ</${Btn}>
            ${m0?html`<${Btn} variant="outline" onClick=${()=>setMode("merge")}>รวมกับข้อมูลเดิม</${Btn}>`:""}
            <${Btn} variant="primary" icon="check" onClick=${onApprove}>อนุมัติ</${Btn}>
          </div>`}
      </div>
    </div>
  </div>`;
  return (typeof document!=="undefined") ? createPortal(node, document.body) : node;
}

/* ── ฟอร์มเปลี่ยนเป็นลูกค้า ── */
function ConvertForm({lead, onClose, onDone}){
  const cid="CU-"+lead.id.replace("LD-","");
  const [owner,setOwner]=useState(OWNERS[0]);
  const [seg,setSeg]=useState(lead.segment||SEGMENTS[0]);
  const [ctype,setCtype]=useState(CUST_TYPES[0]);
  return html`<${Modal} title="เปลี่ยนเป็นลูกค้า" onClose=${onClose}>
    <div class="ld-conv">
      <div class="ld-kv"><span>Lead เดิม</span><b>${lead.id} · ${lead.businessName}</b></div>
      <div class="ld-conv-f"><label>รหัสลูกค้า</label>
        <input class="ld-in" value=${cid} readOnly=${true} title="ระบบสร้างให้อัตโนมัติ · แก้ไม่ได้"/>
        <div class="ld-hint">ระบบสร้างให้อัตโนมัติ · แก้ไม่ได้ · เชื่อมกับ Lead ID เดิม (ตรวจย้อนกลับได้)</div></div>
      <div class="ld-conv-f"><label>ผู้ดูแลลูกค้า</label>
        <${Dropdown} value=${owner} onChange=${setOwner} options=${OWNERS.map(o=>[o,o])}/></div>
      <div class="ld-conv-f"><label>หมวดธุรกิจ</label>
        <${Dropdown} value=${seg} onChange=${setSeg} options=${SEGMENTS.map(s=>[s,SEG_TH[s]||s])}/></div>
      <div class="ld-conv-f"><label>ประเภทลูกค้า</label>
        <${Dropdown} value=${ctype} onChange=${setCtype} options=${CUST_TYPES.map(t=>[t,t])}/></div>
      <div class="ld-alert"><${Icon} name="gap" size=${14}/> เมื่อยืนยัน: คงรหัส Lead เดิมเชื่อมกับ ${cid} · อัปเดตแผนที่และยอดรวม · เขียนบันทึกการตรวจสอบ 2 รายการ · แจ้งเตือน ${lead.submitter.name}</div>
      <div class="ld-conv-foot"><${Btn} variant="ghost" onClick=${onClose}>ยกเลิก</${Btn}>
        <${Btn} variant="primary" icon="check" onClick=${()=>onDone(owner,seg,ctype)}>ยืนยัน</${Btn}></div>
    </div>
  </${Modal}>`;
}

const LD_CSS=`
.ld-page{color:var(--txt)}
.ld-filters{border:1px solid var(--stroke2);border-radius:14px;padding:14px 16px;background:var(--panel);margin-bottom:16px}
/* แถบเมนูขีดเส้นใต้ (LINE TABS) แทนปุ่มพิล — active = ตัวแดง+เส้นใต้แดง, ไม่มีพื้น */
.ld-chips{display:flex;gap:2px;flex-wrap:nowrap;overflow-x:auto;margin-bottom:14px;border-bottom:1px solid var(--stroke);scrollbar-width:none}
.ld-chips::-webkit-scrollbar{height:0}
.ld-chip{padding:9px 14px;border:none;background:none;color:var(--muted);flex:none;white-space:nowrap;
  font-family:var(--font);font-size:13px;font-weight:500;cursor:pointer;
  border-bottom:2px solid transparent;margin-bottom:-1px;transition:color .15s,border-color .15s}
.ld-chip:hover{color:var(--txt)}
.ld-chip.on{color:var(--accent);border-bottom-color:var(--accent);font-weight:600}
.ld-chip b{margin-left:5px;font-weight:700}
.ld-frow{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.ld-dd{min-width:150px}
.ld-date{height:38px;border:1px solid var(--stroke2);border-radius:10px;padding:0 10px;font-family:var(--font);font-size:13px;color:var(--txt);background:var(--surface)}
.ld-dash{color:var(--muted)}
.ld-search{flex:1;min-width:220px;height:38px;border:1px solid var(--stroke2);border-radius:10px;padding:0 12px;font-family:var(--font);font-size:13px;color:var(--txt);background:var(--surface)}
.ld-fr-right{display:flex;gap:8px;margin-left:auto}
.ld-summary{margin-top:12px;padding-top:11px;border-top:1px dashed var(--stroke);font-size:13.5px;color:var(--txt)}
.ld-summary b{color:var(--accent-deep,#b30019);font-weight:800}
.ld-summary b.ld-warn{color:#b30019}
.ld-empty{display:flex;align-items:center;gap:10px;justify-content:center;padding:38px 20px;border:1px dashed var(--stroke2);border-radius:14px;background:var(--panel);font-size:14px}
.ld-tablewrap{border:1px solid var(--stroke2);border-radius:14px;background:var(--panel);overflow:auto;max-height:calc(100vh - 360px);min-height:300px}
.ld-table{width:100%;border-collapse:collapse;font-size:13px}
.ld-table thead th{position:sticky;top:0;z-index:1;background:var(--surface2);color:var(--muted);font-weight:700;font-size:12px;text-align:left;padding:10px 13px;border-bottom:1px solid var(--stroke);white-space:nowrap}
.ld-table th.rt,.ld-table td.rt{text-align:right}
.ld-table tbody td{padding:11px 13px;border-bottom:1px solid var(--stroke);color:var(--txt);vertical-align:top}
.ld-table tbody tr:hover{background:var(--surface)}
.ld-table tr.ld-hi td:first-child{box-shadow:inset 3px 0 0 #b30019}
.ld-table tr.ld-hi{background:rgba(230, 0, 35,.03)}
.ld-badge{font-size:11.5px;font-weight:800;padding:3px 10px;border-radius:999px;white-space:nowrap}
.ld-role{font-size:10.5px;font-weight:800;padding:1px 7px;border-radius:6px;margin-left:4px}
.ld-role.tc{background:rgba(57,135,229,.16);color:#2f7fe0}
.ld-role.mgr{background:rgba(168,85,247,.16);color:#7c3aed}
.ld-cid{font-size:11px;color:#2f7fe0;font-weight:700;margin-top:2px}
.ld-dim{font-size:11.5px;color:var(--muted)}
.ld-score{font-weight:700;color:var(--txt)}
.ld-score.mid{color:#b45309}
.ld-score.hi{color:#b30019;font-weight:800}
.ld-pager{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:12px;font-size:12.5px}
.ld-pg{min-width:32px;height:32px;border-radius:8px;border:1px solid var(--stroke2);background:var(--surface);color:var(--txt);cursor:pointer;font-size:15px}
.ld-pg:disabled{opacity:.45;cursor:not-allowed}
/* drawer */
.ld-back{position:fixed;inset:0;z-index:1300;background:rgba(4,7,14,.5);backdrop-filter:blur(6px);display:grid;place-items:center;padding:24px}
.ld-drawer{width:560px;max-width:100%;max-height:88vh;background:var(--panel);border:1px solid var(--stroke2);border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.4);overflow:hidden;display:flex;flex-direction:column;animation:ld-pop .24s cubic-bezier(.2,.9,.25,1)}
@keyframes ld-pop{from{transform:scale(.96);opacity:0}to{transform:none;opacity:1}}
.ld-dr-head{flex:none;display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:18px 20px 12px;border-bottom:1px solid var(--stroke)}
.ld-dr-nm{font-size:16px;font-weight:800;color:var(--txt)}
.ld-x{flex:none;width:32px;height:32px;border:none;border-radius:9px;cursor:pointer;background:var(--surface);color:var(--muted)}
.ld-dr-body{flex:1;overflow-y:auto;padding:16px 20px}
.ld-sec-t{font-size:12.5px;font-weight:800;color:var(--txt);margin:16px 0 8px;padding-top:12px;border-top:1px dashed var(--stroke)}
.ld-sec-t:first-child{margin-top:0;padding-top:0;border-top:none}
.ld-kv{display:flex;justify-content:space-between;gap:12px;font-size:13px;padding:5px 0}
.ld-kv span{color:var(--muted)}
.ld-kv b{color:var(--txt);text-align:right}
.ld-dups{display:flex;flex-direction:column;gap:8px}
.ld-dup{border:1px solid var(--stroke2);border-radius:10px;padding:9px 12px;background:var(--surface)}
.ld-dup.hi{border-color:rgba(230, 0, 35,.4);background:rgba(230, 0, 35,.05)}
.ld-dup-h{display:flex;justify-content:space-between;align-items:center;font-size:13px;color:var(--txt)}
.ld-none{display:flex;align-items:center;gap:8px;font-size:13px;color:#0f7a3d;background:rgba(51,214,159,.1);border-radius:9px;padding:9px 12px}
.ld-act-box{margin-top:4px}
.ld-reasons{display:flex;flex-direction:column;gap:7px}
.ld-reason{display:flex;align-items:center;gap:9px;padding:9px 12px;border-radius:9px;border:1px solid var(--stroke2);cursor:pointer;font-size:13px;color:var(--txt)}
.ld-reason.on{border-color:var(--accent);background:var(--accent-soft);color:var(--accent-deep,#b30019);font-weight:700}
.ld-note{width:100%;min-height:64px;margin-top:9px;border-radius:9px;border:1px solid var(--stroke2);padding:9px 11px;font-family:var(--font);font-size:13px;resize:vertical}
.ld-cmp{display:grid;grid-template-columns:90px 1fr 1fr;gap:8px;align-items:center;padding:5px 0;font-size:12.5px}
.ld-cmp-h{color:var(--muted);font-weight:700;border-bottom:1px solid var(--stroke);padding-bottom:6px}
.ld-cmp-l{color:var(--muted)}
.ld-cmp-c{display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:8px;border:1px solid var(--stroke2);cursor:pointer;color:var(--txt)}
.ld-cmp-c.on{border-color:var(--accent);background:var(--accent-soft)}
.ld-dr-foot{flex:none;display:flex;justify-content:space-between;align-items:center;gap:10px;padding:14px 20px;border-top:1px solid var(--stroke);background:var(--surface)}
/* convert form */
.ld-conv{display:flex;flex-direction:column;gap:4px}
.ld-conv-f{display:flex;flex-direction:column;gap:5px;margin-top:10px}
.ld-conv-f label{font-size:12.5px;font-weight:600;color:var(--muted)}
.ld-in{height:38px;border:1px solid var(--stroke2);border-radius:10px;padding:0 11px;font-family:var(--font);font-size:13px;color:var(--txt);background:var(--surface2)}
.ld-hint{font-size:11.5px;color:var(--muted)}
.ld-alert{display:flex;align-items:flex-start;gap:8px;margin-top:14px;padding:10px 12px;border-radius:10px;font-size:12px;line-height:1.5;background:rgba(255,176,46,.1);border:1px solid rgba(255,176,46,.3);color:#b45309}
.ld-conv-foot{display:flex;justify-content:flex-end;gap:9px;margin-top:16px}
@media(max-width:520px){.ld-drawer{width:100%;max-height:92vh}}
`;
