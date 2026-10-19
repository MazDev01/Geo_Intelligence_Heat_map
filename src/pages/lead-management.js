import {t} from "../i18n.js";   // สลับภาษา TH/EN — ดู src/i18n.js
import {rejectReasons} from "../master-api.js";
// ═══════════════════════════════════════════════════════════════════════════
// src/pages/lead-management.js — "จัดการ Lead" (route /admin/leads, tab=leads)
// รวมงานเดิม 2 แท็บ ("ข้อมูลที่ TC กรอกเข้ามา" + "คำขอเปลี่ยนเป็นลูกค้า") เป็นไปป์ไลน์เดียว
// เฉพาะผู้ดูแลระบบ · ตรวจ "ข้อมูลซ้ำ (duplicate)" ในประเทศเท่านั้น (ไม่ใช้บริการภายนอก)
// สถานะ: รอตรวจสอบ · ข้อมูลซ้ำ · รออนุมัติ · อนุมัติแล้ว · ปฏิเสธ · เปลี่ยนเป็นลูกค้าแล้ว
// วันที่ทุกจุดเป็นพุทธศักราช · ตัวอักษร slate-900/700/600 บนพื้นขาว · ทุกการตัดสินเขียน audit log
// ═══════════════════════════════════════════════════════════════════════════
import {html, useState, useEffect, useApp, Icon, num, provinceTH, thDate, segTH, gapTH, PROVINCE_TH} from "../lib.js";
import {Btn, Badge, Table, Modal, DateField, toast} from "../ui.js";
import {SEGMENTS} from "../mock/geoData.js";
import {leadRequestsApi} from "../data.js";
import {canExportSource, exportFromServer, downloadLeadFile, beStamp} from "../export-api.js";
import * as auth from "../auth.js";
import {Dropdown} from "../select.js";
import {createPortal} from "react-dom";


const beD = thDate;   // ใช้ตัวแปลงกลาง

const CUST_TYPES=["ลูกค้าองค์กร","ลูกค้ารายย่อย","คู่ค้า/พันธมิตร"];
// ค่าที่บันทึกลงเรกคอร์ดคือ "รหัส" (dup/evidence/…) ป้ายจึงแปลได้อย่างปลอดภัย
// ป้ายเป็นฟังก์ชัน ไม่ใช่สตริง — ค่าคงที่ระดับโมดูลจะถูกประเมินครั้งเดียวตอนโหลดไฟล์
const REJECT_REASONS=[["dup",()=>t("เป็นลูกค้าอยู่แล้ว / รายการซ้ำ","Already a customer / duplicate")],
  ["evidence",()=>t("ข้อมูลไม่เพียงพอ/ไม่ชัดเจน","Not enough or unclear information")],
  ["wrongdata",()=>t("พื้นที่/ข้อมูลธุรกิจไม่ถูกต้อง","Wrong area or business details")],
  ["notreal",()=>t("ไม่พบว่ามีกิจการจริง","No real business found")],
  ["other",()=>t("อื่น ๆ (ระบุ)","Other (specify)")]];
const _REJ=Object.fromEntries(REJECT_REASONS.map(([k,v])=>[k,v]));
const rejectList = () => { const rows = rejectReasons(); return rows ? rows.filter(r=>r.active).map(r=>[r.code, ()=>r.label]) : REJECT_REASONS; };
/* ป้ายเหตุผลการปฏิเสธตามภาษาปัจจุบัน — รับ "รหัส" คืนข้อความ */
export const REJ_TH_OF = code => { const row = (rejectReasons()||[]).find(r=>r.code===code); return row ? row.label : (_REJ[code] ? _REJ[code]() : code); };
// สถานะไปป์ไลน์: ป้าย + สี (badge)
// label เป็น getter — ค่าคงที่ระดับโมดูลถูกประเมินครั้งเดียวตอนโหลด ห่อ t() ตรง ๆ จะไม่เปลี่ยนตามภาษา
export const LEAD_STATUS={
  review:   {get label(){ return t("รอตรวจสอบ","Awaiting review"); },     bg:"rgba(255,176,46,.16)", fg:"#b45309"},
  dup:      {get label(){ return t("ข้อมูลซ้ำ","Duplicate"); },            bg:"rgba(230, 0, 35,.12)",  fg:"#b30019"},
  pending:  {get label(){ return t("รออนุมัติ","Awaiting approval"); },    bg:"rgba(240,160,34,.18)", fg:"#c2410c"},
  approved: {get label(){ return t("อนุมัติแล้ว","Approved"); },           bg:"rgba(51,214,159,.16)", fg:"#0f7a3d"},
  rejected: {get label(){ return t("ปฏิเสธ","Rejected"); },                bg:"rgba(100,116,139,.15)",fg:"#475569"},
  converted:{get label(){ return t("เป็นลูกค้าแล้ว","Converted"); },        bg:"rgba(47,127,224,.15)", fg:"#2f7fe0"},
};

const toLead = r => ({
  id:r.placeId, reqId:r.id, businessName:r.businessName||"—", address:r.address, province:r.province, segment:r.segment,
  phone:r.phone, email:r.email, submitter:{name:r.requestedBy||"—", role:"TC"}, submitterEmail:r.requestedByEmail,
  submittedAt:r.requestedAt, status:r.status==="approved"?"converted":r.status, docs:r.files||[], tcNote:r.note,
  customerId:r.accountNo, rejectReason:r.rejectReason, rejectNote:r.rejectNote, convertedAt:r.convertedAt,
  owner:r.ownerName, custType:r.custType, gap:r.gapSnapshot, gapLevel:r.gapLevelSnapshot, visitDate:r.visitDate,
  segmentFrom:r.segmentFrom, reviewedBy:r.reviewedBy });

const StatusBadge=({s})=>{ const m=LEAD_STATUS[s]||{}; return html`<span class="ld-badge" style=${{background:m.bg,color:m.fg}}>${m.label}</span>`; };
const RoleBadge=({role})=>html`<span class=${"ld-role "+(role==="Manager"?"mgr":"tc")}>${role}</span>`;

// ปุ่มมีเฉพาะรายการที่ยังต้องตัดสิน (รออนุมัติ) — สถานะอื่นจบแล้ว แสดงเป็นข้อความอย่างเดียว
function actionOf(status){
  if(status==="pending") return {label:t("ตรวจสอบ", "Review"), act:"review", variant:"outline"};
  return null;   // rejected / converted → ไม่มีปุ่ม
}

export function LeadManagement({onCounts}){
  const {applyDealApproved, applyDealRejected, user} = useApp();
  const readP=()=>{ const q=new URLSearchParams(location.search);
    return {st:q.get("lst")||"all", sub:q.get("lsub")||"all", prov:q.get("lprov")||"all",
      from:q.get("lfrom")||"", to:q.get("lto")||"", q:q.get("lq")||""}; };
  const p0=readP();
  const [fSt,setFSt]=useState(p0.st);
  const [fSub,setFSub]=useState(p0.sub);
  const [fProv,setFProv]=useState(p0.prov);
  const [fFrom,setFFrom]=useState(p0.from);
  const [fTo,setFTo]=useState(p0.to);
  const [q,setQ]=useState(p0.q);
  const [qd,setQd]=useState(p0.q.trim());
  const [page,setPage]=useState(1);
  const [tick,setTick]=useState(0);
  const [res,setRes]=useState({loading:true});
  const [drawer,setDrawer]=useState(null);   // lead ที่กำลังตรวจสอบ
  const [convert,setConvert]=useState(null);  // lead ที่กำลังแปลงเป็นลูกค้า
  const PAGE=10;

  // URL sync (แชร์ลิงก์/บุ๊กมาร์กได้)
  useEffect(()=>{ const u=new URL(location.href);
    const set=(k,v,def)=>{ if(v&&v!==def) u.searchParams.set(k,v); else u.searchParams.delete(k); };
    set("lst",fSt,"all"); set("lsub",fSub,"all"); set("lprov",fProv,"all");
    set("lfrom",fFrom,""); set("lto",fTo,""); set("lq",q,"");
    history.replaceState(null,"",u.pathname+u.search);
  },[fSt,fSub,fProv,fFrom,fTo,q]);
  useEffect(()=>{ const id=setTimeout(()=>setQd(q.trim()),300); return ()=>clearTimeout(id); },[q]);
  useEffect(()=>{ setPage(1); },[fSt,fSub,fProv,fFrom,fTo,qd]);
  useEffect(()=>{
    let dead=false;
    setRes(r=>({...r,loading:true}));
    leadRequestsApi("GET", {query:{status:fSt==="converted"?"approved":fSt, submitter:fSub==="all"?"":fSub, province:fProv==="all"?"":fProv,
      from:fFrom, to:fTo, q:qd, page, limit:PAGE}}).then(r=>{
      if(dead) return;
      setRes(r.ok ? r : {error:r.error});
      if(r.ok && !r.local && onCounts) onCounts(r.counts);
    });
    return ()=>{ dead=true; };
  },[fSt,fSub,fProv,fFrom,fTo,qd,page,tick]);

  const rows=(res.rows||[]).map(toLead);
  const total=res.total||0;
  const counts=res.counts||{};
  const statusCounts={all:counts.all, pending:counts.pending, rejected:counts.rejected, converted:counts.approved};
  const totalPages=Math.max(1,Math.ceil(total/PAGE)); const pageSafe=Math.min(page,totalPages);

  const canXlsx = canExportSource((user&&user.role)||"", "lead_requests");
  const [exporting,setExporting]=useState(false);
  const doExport=async ()=>{
    if(exporting) return;
    setExporting(true);
    const r = await exportFromServer("lead_requests", "excel", {status:fSt==="converted"?"approved":fSt, submitter:fSub==="all"?"":fSub,
      province:fProv==="all"?"":fProv, from:fFrom, to:fTo, q:qd}, t("คำขอดีล_", "deal_requests_")+beStamp());
    setExporting(false);
    toast(r.ok ? t("ส่งออกไฟล์ Excel แล้ว", "Excel file exported") : r.error, r.ok ? "good" : "bad");
  };

  const CHIPS=[["all",t("ทั้งหมด", "All")],["pending",t("รออนุมัติ", "Awaiting approval")],["rejected",t("ปฏิเสธ", "Rejected")],["converted",t("เปลี่ยนเป็นลูกค้าแล้ว", "Converted to customer")]];
  const provOpts=[["all",t("ทุกจังหวัด", "All provinces")],...Object.keys(PROVINCE_TH).map(k=>[k,provinceTH(k)]).sort((a,b)=>String(a[1]).localeCompare(String(b[1]),"th"))];
  const subOpts=[["all",t("ผู้ส่งทั้งหมด", "All submitters")],...(res.submitters||[]).map(x=>[String(x.id),x.name])];

  const onAction=l=>setDrawer(l);
  const doReject=async (lead, reason, note)=>{
    const r=await leadRequestsApi("POST", {action:"reject", body:{id:lead.reqId, reason, ...(note?{note}:{})}});
    if(!r.ok){ toast(r.error,"bad"); return false; }
    if(r.failed && r.failed.length){ toast(r.failed[0].error,"bad"); setTick(x=>x+1); return false; }
    if(applyDealRejected) applyDealRejected(lead.id, reason, note);
    toast(t("ปฏิเสธรายการแล้ว", "Record rejected"),"warn"); setDrawer(null); setTick(x=>x+1);
    return true;
  };
  const doApprove=async (lead, ownerId, seg, ctype)=>{
    const r=await leadRequestsApi("POST", {action:"approve", body:{id:lead.reqId, ...(ownerId?{ownerId:Number(ownerId)}:{}), segment:seg, custType:ctype}});
    if(!r.ok){ toast(r.error,"bad"); return false; }
    if(applyDealApproved && r.request) applyDealApproved(r.request);
    toast(`${t("เปลี่ยนเป็นลูกค้าแล้ว (", "Converted to a customer (")}${(r.request&&r.request.accountNo)||lead.id}${t(") — คง Lead ID เดิม", ") — the original Lead ID is kept")}`,"good");
    setConvert(null); setTick(x=>x+1);
    return true;
  };

  return html`<div class="ld-page">
    <!-- ═══ การ์ดเดียว: แถบตัวกรองเป็นส่วนหัวของตาราง (เดิมแยกเป็นอีกกล่องลอยอยู่ด้านบน) ═══ -->
    <div class="ld-card">
    <div class="ld-filters">
      <div class="ld-chips">
        ${CHIPS.map(([v,l])=>html`<button key=${v} class=${"ld-chip"+(fSt===v?" on":"")} onClick=${()=>setFSt(v)}>
          ${l} <b>${statusCounts[v]==null?"—":num(statusCounts[v])}</b></button>`)}
      </div>
      <div class="ld-frow">
        <input class="ld-search" placeholder=${t("ค้นหา ชื่อร้าน · รหัส · เบอร์โทร · อีเมล", "Search by business, ID, phone or email")} value=${q} onInput=${e=>setQ(e.target.value)}/>
        <div class="ld-dd"><${Dropdown} value=${fSub} onChange=${setFSub} options=${subOpts}/></div>
        <div class="ld-dd"><${Dropdown} value=${fProv} onChange=${setFProv} options=${provOpts}/></div>
        <${DateField} className="ld-date" value=${fFrom} max=${fTo||undefined} onChange=${setFFrom} title=${t("วันที่ส่ง (ตั้งแต่)", "Submitted from")}/>
        <span class="ld-dash">–</span>
        <${DateField} className="ld-date" value=${fTo} min=${fFrom||undefined} onChange=${setFTo} title=${t("ถึง", "to")}/>
        ${canXlsx && !res.local && html`<${Btn} size="sm" variant="ghost" icon="download" disabled=${exporting || !total} onClick=${doExport}>${t("ส่งออก Excel", "Export to Excel")}</${Btn}>`}
      </div>
    </div>

    <!-- ═══ ตาราง (อยู่ในการ์ดเดียวกับตัวกรอง) ═══ -->
    ${res.error ? html`<div class="ld-empty"><${Icon} name="info" size=${18} color="var(--accent)"/> ${res.error}</div>`
    : res.local ? html`<div class="ld-empty"><${Icon} name="info" size=${18} color="var(--accent)"/> ${t("เซิร์ฟเวอร์นี้ยังไม่รองรับคิวอนุมัติดีล", "This server does not support the deal approval queue yet")}</div>`
    : rows.length===0 ? html`<div class="ld-empty">
        <${Icon} name="info" size=${18} color="var(--accent)"/> ${res.loading ? t("กำลังโหลด…", "Loading…") : t("ไม่พบรายการตามเงื่อนไขที่เลือก", "No records match the current filters")}
      </div>` : html`
    <div class="ld-tablewrap">
      <table class="ld-table">
        <thead><tr>
          <th>${t("สถานะ", "Status")}</th><th>Lead ID</th><th>${t("ชื่อลูกค้า/บริษัท", "Customer / company")}</th><th>${t("ผู้ส่ง", "Submitted by")}</th><th>${t("วันที่ส่ง", "Submitted")}</th>
          <th class="rt">${t("การจัดการ", "Actions")}</th>
        </tr></thead>
        <tbody>
          ${rows.map(l=>{ const a=actionOf(l.status);
            return html`<tr key=${l.reqId}>
            <td data-label=${t("สถานะ", "Status")}><${StatusBadge} s=${l.status}/></td>
            <td data-label="Lead ID"><div><b>${l.id}</b>${l.customerId?html`<div class="ld-cid">${l.customerId}</div>`:""}</div></td>
            <td data-label=${t("ชื่อลูกค้า/บริษัท", "Customer / company")}>${l.businessName}</td>
            <td data-label=${t("ผู้ส่ง", "Submitted by")}><span>${l.submitter.name} <${RoleBadge} role=${l.submitter.role}/></span></td>
            <td data-label=${t("วันที่ส่ง", "Submitted")}>${beD(l.submittedAt)}</td>
            <td class="rt">${a ? html`<button class="ld-eye" title=${a.label} aria-label=${a.label+" "+l.businessName}
                onClick=${()=>onAction(l)}><${Icon} name="eye" size=${16}/></button>`
              : html`<button class="ld-eye" title=${t("ดูรายละเอียด", "View details")} aria-label=${t("ดูรายละเอียด", "View details")+" "+l.businessName}
                onClick=${()=>onAction(l)}><${Icon} name="eye" size=${16}/></button>`}</td>
          </tr>`; })}
        </tbody>
      </table>
    </div>
    ${totalPages>1?html`<div class="ld-pager">
      <span class="ld-dim">${t("แสดง", "Showing")} ${(pageSafe-1)*PAGE+1}–${Math.min(pageSafe*PAGE,total)} ${t("จาก", "of")} ${num(total)} ${t("รายการ", "records")}</span>
      <div class="row" style=${{gap:"5px"}}>
        <button class="ld-pg" disabled=${pageSafe<=1} onClick=${()=>setPage(p=>Math.max(1,p-1))}>‹</button>
        <span class="ld-dim">${pageSafe}/${totalPages}</span>
        <button class="ld-pg" disabled=${pageSafe>=totalPages} onClick=${()=>setPage(p=>Math.min(totalPages,p+1))}>›</button>
      </div></div>`:""}`}
    </div>

    ${drawer?html`<${ReviewDrawer} lead=${drawer} onClose=${()=>setDrawer(null)}
      onReject=${(reason,note)=>doReject(drawer, reason, note)}
      onApprove=${()=>{ const l=drawer; setDrawer(null); setConvert(l); }}/>`:""}

    ${convert?html`<${ConvertForm} lead=${convert} onClose=${()=>setConvert(null)}
      onDone=${(ownerId,seg,ctype)=>doApprove(convert, ownerId, seg, ctype)}/>`:""}
    <style>${LD_CSS}</style>
  </div>`;
}

/* ── แผงตรวจสอบ (drawer ขวา · 3 ส่วน) ── */
export function ReviewDrawer({lead, onClose, onReject, onApprove}){
  const [mode,setMode]=useState(null);   // null | 'reject'
  const [rcode,setRcode]=useState("dup"); const [rnote,setRnote]=useState(""); const [busy,setBusy]=useState(false);
  const decided = lead.status!=="pending";   // อนุมัติแล้ว/ปฏิเสธ/เปลี่ยนเป็นลูกค้าแล้ว → อ่านอย่างเดียว
  const node=html`<div class="ld-back" onMouseDown=${e=>{ if(e.target.classList.contains("ld-back")) onClose(); }}>
    <div class="ld-drawer">
      <div class="ld-dr-head">
        <div><div class="ld-dr-nm">${lead.businessName}</div>
          <div class="ld-dim">${lead.id}${lead.customerId&&lead.customerId!==lead.id?" · "+lead.customerId:""} · ${segTH(lead.segment)} · ${provinceTH(lead.province)}</div></div>
        <button class="ld-x" aria-label=${t("ปิด", "Close")} onClick=${onClose}><${Icon} name="close" size=${16}/></button>
      </div>
      <div class="ld-dr-body">
        <!-- ส่วนที่ 1 · ข้อมูล Lead -->
        <div class="ld-sec-t">${t("ข้อมูล Lead", "Lead details")}</div>
        <div class="ld-kv"><span>${t("ชื่อบริษัท", "Company name")}</span><b>${lead.businessName}</b></div>
        <div class="ld-kv"><span>${t("ที่อยู่", "Address")}</span><b>${lead.address||"—"}</b></div>
        <div class="ld-kv"><span>${t("จังหวัด", "Province")}</span><b>${provinceTH(lead.province)}</b></div>
        <div class="ld-kv"><span>${t("หมวดธุรกิจ", "Business category")}</span><b>${segTH(lead.segment)}${lead.segmentFrom?html` <span class="ld-dim">(${t("เดิม", "was")} ${segTH(lead.segmentFrom)})</span>`:""}</b></div>
        <div class="ld-kv"><span>${t("เบอร์โทร", "Phone")}</span><b>${lead.phone||"—"}</b></div>
        <div class="ld-kv"><span>${t("อีเมล", "Email")}</span><b>${lead.email||"—"}</b></div>

        <!-- ส่วนที่ 2 · หลักฐานที่ TC ส่งมาให้ผู้ดูแลตรวจ -->
        <div class="ld-sec-t">${t("หลักฐานที่ผู้ประสานงานการค้าส่งมา", "Evidence submitted by the Trade Coordinator")}</div>
        <div class="ld-kv"><span>${t("ผู้ส่ง", "Submitted by")}</span><b>${lead.submitter.name}</b></div>
        <div class="ld-kv"><span>${t("วันที่ส่ง", "Submitted")}</span><b>${beD(lead.submittedAt)}</b></div>
        ${lead.visitDate?html`<div class="ld-kv"><span>${t("วันนัดเข้าพบ", "Visit date")}</span><b>${beD(lead.visitDate)}</b></div>`:""}
        ${lead.gap!=null?html`<div class="ld-kv"><span>${t("ช่องว่างตลาด ณ วันที่ส่ง", "Market gap when submitted")}</span><b>${num(lead.gap)}${lead.gapLevel?" · "+gapTH(lead.gapLevel):""}</b></div>`:""}
        ${lead.tcNote?html`<div class="ld-kv"><span>${t("บันทึกจากการเข้าพบ", "Visit notes")}</span>
          <b style=${{maxWidth:"60%",textAlign:"right",fontWeight:500,lineHeight:1.5}}>${lead.tcNote}</b></div>`:""}
        ${(lead.docs||[]).length ? html`<div class="ld-docs">
          ${lead.docs.map(d=>html`<button key=${d.id} type="button" class="ld-doc" title=${t("ดาวน์โหลด", "Download")}
            onClick=${async ()=>{ const r=await downloadLeadFile(d); if(!r.ok) toast(r.error,"bad"); }}><${Icon} name="reports" size=${13}/>${d.name}</button>`)}
        </div>` : html`<div class="ld-none warn"><${Icon} name="info" size=${15} color="#b45309"/> ${t("ไม่มีไฟล์แนบมากับรายการนี้", "No files attached to this record")}</div>`}

        <!-- ส่วนที่ 3 · การดำเนินการ (รายการที่ตัดสินไปแล้วจะเห็นผลลัพธ์อย่างเดียว) -->
        ${decided ? html`<div class="ld-sec-t">${t("ผลการดำเนินการ", "Outcome")}</div>
          <div class="ld-kv"><span>${t("สถานะ", "Status")}</span><b><${StatusBadge} s=${lead.status}/></b></div>
          ${lead.rejectReason?html`<div class="ld-kv"><span>${t("เหตุผลที่ปฏิเสธ", "Rejection reason")}</span><b>${REJ_TH_OF(lead.rejectReason)}${lead.rejectNote?" — "+lead.rejectNote:""}</b></div>`:""}
          ${lead.customerId?html`<div class="ld-kv"><span>${t("รหัสลูกค้าที่เชื่อมไว้", "Linked customer ID")}</span><b>${lead.customerId}</b></div>`:""}
          ${lead.convertedAt?html`<div class="ld-kv"><span>${t("วันที่เปลี่ยนเป็นลูกค้า", "Converted on")}</span><b>${beD(lead.convertedAt)}</b></div>`:""}
          ${lead.owner?html`<div class="ld-kv"><span>${t("ผู้ดูแลลูกค้า", "Customer owner")}</span><b>${lead.owner}</b></div>`:""}
          ${lead.custType?html`<div class="ld-kv"><span>${t("ประเภทลูกค้า", "Customer type")}</span><b>${lead.custType}</b></div>`:""}
          ${lead.reviewedBy?html`<div class="ld-kv"><span>${t("ตัดสินโดย", "Decided by")}</span><b>${lead.reviewedBy}</b></div>`:""}`
        : html`<div class="ld-sec-t">${t("การดำเนินการของผู้ดูแลระบบ", "Administrator actions")}</div>
        ${mode==="reject" ? html`<div class="ld-act-box">
          <div class="ld-dim" style=${{marginBottom:"8px"}}>${t("เลือกเหตุผลการปฏิเสธ:", "Pick a rejection reason:")}</div>
          <div class="ld-reasons">${rejectList().map(([k,v])=>html`<label key=${k} class=${"ld-reason"+(rcode===k?" on":"")}>
            <input type="radio" name="rj" checked=${rcode===k} onChange=${()=>setRcode(k)}/> ${v()}</label>`)}</div>
          ${rcode==="other"?html`<textarea class="ld-note" placeholder=${t("ระบุเหตุผล…", "Describe the reason…")} value=${rnote} onInput=${e=>setRnote(e.target.value)}></textarea>`:""}
        </div>`
        : html`<div class="ld-dim">${t("ตรวจหลักฐานด้านบนแล้วเลือกดำเนินการด้านล่าง — อนุมัติเพื่อไปขั้นเปลี่ยนเป็นลูกค้า หรือปฏิเสธพร้อมเหตุผล", "Check the evidence above, then act below — approve to move on to conversion, or reject with a reason")}</div>`}`}
      </div>
      <div class="ld-dr-foot">
        ${mode ? html`<${Btn} variant="ghost" onClick=${()=>setMode(null)}>${t("ย้อนกลับ", "Back")}</${Btn}>` : html`<span></span>`}
        ${decided ? html`<${Btn} variant="ghost" onClick=${onClose}>${t("ปิด", "Close")}</${Btn}>`
        : mode==="reject" ? html`<${Btn} variant="primary" disabled=${busy} onClick=${async ()=>{ if(busy) return; if(rcode==="other"&&!rnote.trim()){toast(t("กรุณาระบุเหตุผล", "Please give a reason"),"warn");return;}
            setBusy(true); await onReject(rcode,rnote.trim()); setBusy(false); }}>${t("ยืนยันปฏิเสธ", "Confirm rejection")}</${Btn}>`
        : html`<div class="row" style=${{gap:"8px"}}>
            <${Btn} variant="ghost" onClick=${()=>setMode("reject")}>${t("ปฏิเสธ", "Reject")}</${Btn}>
            <${Btn} variant="primary" icon="check" onClick=${onApprove}>${t("อนุมัติ", "Approve")}</${Btn}>
          </div>`}
      </div>
    </div>
  </div>`;
  return (typeof document!=="undefined") ? createPortal(node, document.body) : node;
}

/* ── ฟอร์มเปลี่ยนเป็นลูกค้า ── */
function ConvertForm({lead, onClose, onDone}){
  const [owners,setOwners]=useState(null);
  const [owner,setOwner]=useState("");
  const [seg,setSeg]=useState(lead.segment||SEGMENTS[0]);
  const [ctype,setCtype]=useState(CUST_TYPES[0]);
  const [busy,setBusy]=useState(false);
  useEffect(()=>{ let dead=false;
    auth.call("users.list").then(r=>{ if(dead) return;
      const tcs=((r&&r.users)||[]).filter(u=>u.role==="Trade Coordinator" && u.status!=="Suspended");
      setOwners(tcs);
      const mine=tcs.find(u=>u.email===lead.submitterEmail);
      setOwner(mine?String(mine.id):(tcs[0]?String(tcs[0].id):""));
    }).catch(()=>{ if(!dead) setOwners([]); });
    return ()=>{ dead=true; }; },[]);
  const segOpts=[...new Set([lead.segment, ...SEGMENTS].filter(Boolean))].map(s=>[s,segTH(s)]);
  return html`<${Modal} title=${t("เปลี่ยนเป็นลูกค้า", "Convert to customer")} onClose=${onClose}>
    <div class="ld-conv">
      <div class="ld-kv"><span>${t("Lead เดิม", "Original Lead")}</span><b>${lead.id} · ${lead.businessName}</b></div>
      <div class="ld-conv-f"><label>${t("รหัสลูกค้า", "Customer ID")}</label>
        <input class="ld-in" value=${lead.id} readOnly=${true} title=${t("ใช้รหัสเดิม · แก้ไม่ได้", "Keeps the original ID · not editable")}/>
        <div class="ld-hint">${t("ใช้รหัส Lead เดิม (ถ้ายังไม่มีรหัสลูกค้า) · ตรวจย้อนกลับได้", "Keeps the original Lead ID (when no customer ID exists yet) · traceable")}</div></div>
      <div class="ld-conv-f"><label>${t("ผู้ดูแลลูกค้า", "Customer owner")}</label>
        ${owners===null ? html`<div class="ld-dim">${t("กำลังโหลดรายชื่อ…", "Loading names…")}</div>`
          : owners.length ? html`<${Dropdown} value=${owner} onChange=${setOwner} options=${owners.map(u=>[String(u.id),u.name])}/>`
          : html`<div class="ld-dim">${t("ไม่มีผู้ประสานงานการค้าในระบบ · คงผู้ดูแลเดิม", "No Trade Coordinators found · the current owner is kept")}</div>`}</div>
      <div class="ld-conv-f"><label>${t("หมวดธุรกิจ", "Business category")}</label>
        <${Dropdown} value=${seg} onChange=${setSeg} options=${segOpts}/></div>
      <div class="ld-conv-f"><label>${t("ประเภทลูกค้า", "Customer type")}</label>
        <${Dropdown} value=${ctype} onChange=${setCtype} options=${CUST_TYPES.map(c=>[c,c])}/></div>
      <div class="ld-alert"><${Icon} name="gap" size=${14}/> ${t("เมื่อยืนยัน: เปลี่ยนเป็นลูกค้าทันที · แผนที่และยอดรวมอัปเดต · บันทึกลงบันทึกการตรวจสอบ · ผู้ส่งเห็นผลในแผงร้าน", "On confirm: converted right away · the map and totals update · recorded in the audit log · the sender sees the result on the place panel")}</div>
      <div class="ld-conv-foot"><${Btn} variant="ghost" onClick=${onClose}>${t("ยกเลิก", "Cancel")}</${Btn}>
        <${Btn} variant="primary" icon="check" disabled=${busy || owners===null} onClick=${async ()=>{ if(busy) return; setBusy(true); await onDone(owner,seg,ctype); setBusy(false); }}>${t("ยืนยัน", "Confirm")}</${Btn}></div>
    </div>
  </${Modal}>`;
}

const LD_CSS=`
.ld-page{color:var(--txt)}
/* การ์ดรวม: ตัวกรอง + ตาราง + แถบเลขหน้า อยู่ในกรอบเดียวกัน */
.ld-card{border:1px solid var(--stroke2);border-radius:14px;background:var(--panel);overflow:hidden}
/* ตัวกรองเป็น "ส่วนหัวของตาราง" — ไม่มีกรอบ/เงาของตัวเอง มีแค่เส้นคั่นก่อนหัวตาราง */
.ld-filters{padding:14px 16px 13px;border-bottom:1px solid var(--stroke2)}
/* แถบเมนูขีดเส้นใต้ (LINE TABS) แทนปุ่มพิล — active = ตัวแดง+เส้นใต้แดง, ไม่มีพื้น */
.ld-chips{display:flex;gap:2px;flex-wrap:nowrap;overflow-x:auto;margin:-14px -16px 13px;padding:0 16px;
  border-bottom:1px solid var(--stroke);scrollbar-width:none}
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
.ld-search{flex:0 1 300px;min-width:220px;height:38px;border:1px solid var(--stroke2);border-radius:10px;padding:0 12px;font-family:var(--font);font-size:13px;color:var(--txt);background:var(--surface)}
.ld-fr-right{display:flex;gap:8px;margin-left:auto}
.ld-empty{display:flex;align-items:center;gap:10px;justify-content:center;padding:44px 20px;font-size:14px}
/* ปุ่มเปิดดูรายละเอียด — ไอคอนรูปตาอย่างเดียว ชื่อเต็มอยู่ใน tooltip */
.ld-eye{width:34px;height:34px;display:inline-grid;place-items:center;cursor:pointer;
  border:1px solid var(--stroke2);border-radius:9px;background:var(--surface);color:var(--muted);padding:0}
.ld-eye:hover{border-color:var(--accent);color:var(--accent)}
.ld-tablewrap{overflow-x:auto}
.ld-table{width:100%;border-collapse:collapse;font-size:13px}
.ld-table thead th{background:var(--surface2);color:var(--muted);font-weight:700;font-size:12px;text-align:left;padding:10px 13px;border-bottom:1px solid var(--stroke);white-space:nowrap}
.ld-table th.rt,.ld-table td.rt{text-align:right}
.ld-table tbody td{padding:11px 13px;border-bottom:1px solid var(--stroke);color:var(--txt);vertical-align:top}
.ld-table tbody tr:hover{background:var(--surface)}
@media(max-width:640px){
  .ld-tablewrap{overflow:visible}
  .ld-table,.ld-table tbody{display:block}
  .ld-table thead{display:none}
  .ld-table tbody tr{display:block;margin:0 0 10px;padding:6px 0;border:1px solid var(--stroke);border-radius:12px;background:var(--surface)}
  .ld-table tbody td{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 14px;border-bottom:none;text-align:right;overflow-wrap:anywhere}
  .ld-table tbody td[data-label]::before{content:attr(data-label);flex:none;max-width:45%;text-align:left;font-size:11.5px;font-weight:600;color:var(--muted)}
  .ld-table tbody td.rt{justify-content:flex-end}
}
.ld-badge{font-size:11.5px;font-weight:800;padding:3px 10px;border-radius:999px;white-space:nowrap}
.ld-role{font-size:10.5px;font-weight:800;padding:1px 7px;border-radius:6px;margin-left:4px}
.ld-role.tc{background:rgba(57,135,229,.16);color:#2f7fe0}
.ld-role.mgr{background:rgba(168,85,247,.16);color:#7c3aed}
.ld-cid{font-size:11px;color:#2f7fe0;font-weight:700;margin-top:2px}
.ld-dim{font-size:11.5px;color:var(--muted)}
.ld-pager{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;
  padding:11px 16px;border-top:1px solid var(--stroke2);background:var(--surface2);font-size:12.5px}
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
.ld-none{display:flex;align-items:center;gap:8px;font-size:13px;color:#0f7a3d;background:rgba(51,214,159,.1);border-radius:9px;padding:9px 12px}
.ld-none.warn{color:#b45309;background:rgba(245,158,11,.12)}
.ld-docs{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.ld-doc{display:inline-flex;align-items:center;gap:7px;padding:8px 12px;border-radius:10px;font-size:12.5px;font-weight:600;
  color:var(--txt);border:1px solid var(--stroke2);background:var(--surface)}
button.ld-doc{cursor:pointer;font-family:inherit}
button.ld-doc:hover{border-color:var(--accent)}
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
