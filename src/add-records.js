// ── ฟอร์มเพิ่มลูกค้า/Lead ──
// ลูกค้า: ฟิลด์ตรงกับไฟล์ข้อมูลจริงจาก Barter — รหัสลูกค้า · ชื่อธุรกิจ · หมวดธุรกิจ · ที่อยู่ · จังหวัด/อำเภอ (จากพิกัด)
//        · พิกัด · โทรศัพท์ · เว็บไซต์ · เฟซบุ๊ก · วันที่เริ่มเป็นลูกค้า  (ไม่มีคอลัมน์ "สถานะ" และไม่มียอดขาย)
// Lead : ยังเป็นข้อมูลจำลอง จึงเก็บอีเมลไว้เหมือนเดิม
// ผู้ใช้กรอกพิกัดเอง (ใช้วางหมุด/หาอำเภอ) · ทุกรายการติดแท็ก แหล่งที่มา = "ผู้ใช้เพิ่มเอง"
// ไม่มีการให้คะแนนศักยภาพ/เกรด A-B-C และไม่เก็บข้อมูลรีวิวอีกต่อไป — ระบบใช้ "Lead สูง" ระดับพื้นที่แทน
import {html, useState, useEffect, useRef, Icon, SegmentIcon, SEGMENTS, segTH, provinceTH} from "./lib.js";
import {basemap} from "./basemap.js";
import {createPortal} from "react-dom";
import {Dropdown} from "./select.js";
import {assignTC, provinceOf, zoneOf, TC_TEAM, GAP_TH as GAP_LV_TH} from "./mock/geoData.js";
import {DateField} from "./ui.js";   // ช่องเลือกวันที่แบบไทย

export const USER_SOURCE = "ผู้ใช้เพิ่มเอง";
const MAX_ROWS = 10;
const GAP_TH = GAP_LV_TH;

const num = v => Number(v||0).toLocaleString("th-TH");
const isEmail = v => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v.trim());

const todayISO = () => new Date().toISOString().slice(0,10);
const emptyRow = () => ({type:"Prospect", name:"", address:"", email:"", lat:"", lng:"", segment:SEGMENTS[0],
  tc:"auto", clientId:"", phone:"", website:"", facebook:"", dateJoin:todayISO()});
const rowFromRecord = r => ({type:r.status==="Existing"?"Existing":"Prospect", name:r.businessName||"", address:r.address||"",
  email:r.email||"",
  lat:r.latitude==null?"":String(r.latitude), lng:r.longitude==null?"":String(r.longitude),
  segment:r.segment||SEGMENTS[0],
  tc: r.tc_owner&&r.tc_owner!=="ยังไม่มอบหมาย"?r.tc_owner:"auto",
  clientId:r.accountNo||r.clientId||"", phone:r.phone||"", website:r.website||"", facebook:r.facebook||"",
  dateJoin:r.dateJoin||todayISO()});

// ── คำนวณบริบทจากพิกัด (จังหวัด/อำเภอ/ระดับ Lead ของโซน/ผู้ดูแล TC) ──
// ไม่มีการให้คะแนนรายบริษัทแล้ว — แสดงแค่ว่าพิกัดนี้ตกอยู่ในย่านที่มี Lead ระดับใด
function deriveRow(r, db){
  const la=+r.lat, ln=+r.lng, hasCoord = r.lat!=="" && r.lng!=="" && !isNaN(la) && !isNaN(ln);
  const province = hasCoord ? provinceOf(la,ln) : null;
  const zone = hasCoord ? zoneOf(la,ln, db.districts) : null;
  const outOfService = hasCoord && !province;
  const tc = r.tc==="auto" ? (hasCoord ? assignTC(la,ln) : "ยังไม่มอบหมาย") : r.tc;
  const zoneGap = zone && !zone.out ? zone.gap : null;
  return { hasCoord, province, zone, outOfService, tc, zoneGap };
}

function buildRecord(r, i, db, keepId){
  const isCust = r.type==="Existing";
  const d = deriveRow(r, db);
  const id = keepId || (isCust?"CUS":"PRO")+"U"+Date.now().toString(36)+"-"+i;
  const rec = { id, businessName:r.name.trim(), segment:r.segment, category:r.segment,
    status:isCust?"Existing":"Prospect", country:"Thailand", province:d.province||"", district:(d.zone&&d.zone.district)||"",
    address:r.address.trim(), email:r.email.trim(), latitude:+(+r.lat).toFixed(4), longitude:+(+r.lng).toFixed(4), source:USER_SOURCE,
    created_at: new Date().toISOString().slice(0,10), tc_owner: d.tc };
  if(isCust){ rec.accountNo=r.clientId.trim(); rec.clientId=r.clientId.trim();
    rec.phone=r.phone.trim()||null; rec.website=r.website.trim()||null; rec.facebook=r.facebook.trim()||null;
    rec.dateJoin=r.dateJoin||todayISO(); rec.created_at=rec.dateJoin; delete rec.email; }
  else { rec.visit_status="ยังไม่เข้าพบ"; }
  return rec;
}

// ── นำเข้าเป็นชุดจากไฟล์ Excel/CSV (อัปโหลดครั้งเดียวได้หลายรายการ) ──
// หัวคอลัมน์ (ตัวพิมพ์เล็ก) → คีย์ field · รองรับทั้งไทยและอังกฤษ
const IMPORT_HEADERS = {
  "ประเภท":"type","สถานะ":"type","type":"type",
  "ชื่อธุรกิจ":"name","ชื่อ":"name","name":"name","businessname":"name",
  "หมวดหมู่":"segment","หมวดหมู่ธุรกิจ":"segment","หมวด":"segment","segment":"segment",
  "ที่อยู่":"address","address":"address",
  "ละติจูด":"lat","lat":"lat","latitude":"lat",
  "ลองจิจูด":"lng","lng":"lng","lon":"lng","longitude":"lng",
  "อีเมล":"email","email":"email","e-mail":"email",
  "รหัสลูกค้า":"clientId","clientid":"clientId",
  "เบอร์โทรศัพท์":"phone","โทรศัพท์":"phone","phone":"phone",
  "เว็บไซต์":"website","website":"website",
  "เฟซบุ๊ค":"facebook","เฟซบุ๊ก":"facebook","facebook":"facebook",
  "วันที่เริ่มเป็นลูกค้า":"dateJoin","datejoin":"dateJoin" };
// parser CSV ที่รองรับเครื่องหมายคำพูด/คอมมาในค่า/ขึ้นบรรทัดใหม่ในค่า
function parseCSV(text){
  const rows=[]; let row=[], f="", q=false; text=text.replace(/\r\n?/g,"\n");
  for(let i=0;i<text.length;i++){ const c=text[i];
    if(q){ if(c==='"'){ if(text[i+1]==='"'){f+='"';i++;} else q=false; } else f+=c; }
    else if(c==='"') q=true;
    else if(c===",") { row.push(f); f=""; }
    else if(c==="\n"){ row.push(f); rows.push(row); row=[]; f=""; }
    else f+=c; }
  if(f!==""||row.length){ row.push(f); rows.push(row); }
  return rows.filter(r=>r.some(x=>String(x).trim()!==""));
}
// .xls ที่แอปนี้ส่งออก (HTML table) — อ่านผ่าน DOMParser
function parseHtmlTable(htmlText){
  try{ const doc=new DOMParser().parseFromString(htmlText,"text/html");
    return [...doc.querySelectorAll("table tr")].map(tr=>[...tr.querySelectorAll("td,th")].map(td=>td.textContent));
  }catch(e){ return []; }
}
// แปลงตาราง (matrix) → แถวฟอร์ม โดยจับคู่หัวคอลัมน์อัตโนมัติ · prospectOnly (TC) บังคับเป็น Lead ทุกแถว
function tableToRows(matrix, prospectOnly){
  if(!matrix.length) return {rows:[], total:0};
  const head=matrix[0].map(h=>String(h).trim().toLowerCase());
  const idx={}; head.forEach((h,i)=>{ const k=IMPORT_HEADERS[h]; if(k && idx[k]==null) idx[k]=i; });
  const segByTH={}; SEGMENTS.forEach(s=>{ segByTH[segTH(s).toLowerCase()]=s; });
  const get=(r,k)=> idx[k]!=null ? String(r[idx[k]]??"").trim() : "";
  const out=[];
  for(let i=1;i<matrix.length;i++){ const r=matrix[i]; const name=get(r,"name"); if(!name) continue;
    const typeRaw=get(r,"type").toLowerCase();
    const isCust = !prospectOnly && /existing|ลูกค้า|customer/.test(typeRaw);
    const segRaw=get(r,"segment"); const seg = SEGMENTS.includes(segRaw) ? segRaw : (segByTH[segRaw.toLowerCase()]||SEGMENTS[0]);
    out.push({...emptyRow(), type:isCust?"Existing":"Prospect", name, address:get(r,"address"),
      lat:get(r,"lat"), lng:get(r,"lng"), segment:seg,
      email:get(r,"email"),
      clientId:get(r,"clientId"), phone:get(r,"phone"), website:get(r,"website"),
      facebook:get(r,"facebook"), dateJoin:get(r,"dateJoin")||todayISO()}); }
  return {rows:out, total:out.length};
}
const TEMPLATE_CSV = "ประเภท,ชื่อธุรกิจ,หมวดหมู่,ที่อยู่,อีเมล,ละติจูด,ลองจิจูด\n"
  + "Lead,ตัวอย่าง โรงแรมสวนสน,โรงแรมและที่พัก,123 ถ.สุขุมวิท กรุงเทพฯ,contact@suansonhotel.co.th,13.7563,100.5018\n";
function downloadTemplate(){
  const blob=new Blob(["﻿"+TEMPLATE_CSV],{type:"text/csv;charset=utf-8"});   // BOM ให้ Excel อ่านภาษาไทยถูก
  const url=URL.createObjectURL(blob); const a=document.createElement("a");
  a.href=url; a.download="เทมเพลตเพิ่มลูกค้า-Lead.csv"; a.click(); URL.revokeObjectURL(url);
}

// แผนที่ย่อแสดงหมุด (Leaflet) — โผล่เมื่อพิกัดถูกต้องและอยู่ในพื้นที่ให้บริการ
function MiniMap({lat,lng}){
  const ref=useRef(null), mapRef=useRef(null), mkRef=useRef(null);
  useEffect(()=>{ const L=window.L; if(!L||!ref.current) return;
    const m=L.map(ref.current,{zoomControl:false,attributionControl:false,scrollWheelZoom:false}).setView([lat,lng],13);
    basemap(m, "th");
    mkRef.current=L.marker([lat,lng]).addTo(m); mapRef.current=m;
    setTimeout(()=>m.invalidateSize(),60);
    return ()=>m.remove();
  },[]);
  useEffect(()=>{ if(mapRef.current&&mkRef.current){ mkRef.current.setLatLng([lat,lng]); mapRef.current.setView([lat,lng]); } },[lat,lng]);
  return html`<div class="ar-map" ref=${ref}></div>`;
}

export function AddRecordsForm({onClose, onSave, editRecord, db={}, prospectOnly=false, allowImport=false}){
  // prospectOnly = true (บทบาท TC) → เพิ่มได้เฉพาะ "Lead" เท่านั้น เพิ่มลูกค้าไม่ได้ · ผู้บริหาร/แอดมินเพิ่มได้ทั้งสองแบบ
  // allowImport = แถบอัปโหลด Excel/CSV — ค่าตั้งต้นปิด เพราะการนำเข้าไฟล์ทำผ่านแอดมินคนเดียว
  //   (แอดมินใช้เมนู จัดการข้อมูล › นำเข้าข้อมูล) · TC/ผู้บริหารกรอกทีละรายการได้ตามเดิม
  const isEdit = !!editRecord;
  const [rows,setRows] = useState(isEdit ? [rowFromRecord(editRecord)] : [emptyRow()]);
  const [showErr,setShowErr] = useState(false);
  const [importMsg,setImportMsg] = useState(null);   // ผลการนำเข้าจากไฟล์ {ok?:n, bad?:true, text}

  // นำเข้าจากไฟล์ Excel/CSV → เติมลงในแถวฟอร์ม (ใช้ validation/คะแนน/บันทึกเดิม) ครั้งเดียวได้หลายรายการ
  const onImportFile = e => {
    const file = e.target.files && e.target.files[0]; e.target.value=""; if(!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = String(ev.target.result||"");
      if(text.slice(0,2)==="PK"){ setImportMsg({bad:true, text:"ไฟล์ .xlsx อ่านโดยตรงไม่ได้ — เปิดใน Excel แล้ว “บันทึกเป็น” ชนิด CSV UTF-8 จากนั้นอัปโหลดใหม่ (กดดาวน์โหลดเทมเพลตเพื่อดูรูปแบบ)"}); return; }
      const matrix = /<table/i.test(text) ? parseHtmlTable(text) : parseCSV(text);
      const {rows:parsed, total} = tableToRows(matrix, prospectOnly);
      if(!total){ setImportMsg({bad:true, text:"ไม่พบข้อมูลในไฟล์ — ต้องมีหัวคอลัมน์ (เช่น ชื่อธุรกิจ, ละติจูด, ลองจิจูด) · กดดาวน์โหลดเทมเพลตเพื่อดูรูปแบบ"}); return; }
      const take = parsed.slice(0, MAX_ROWS);
      setRows(take); setShowErr(false);
      setImportMsg({ ok:take.length, text: total>MAX_ROWS
        ? `นำเข้า ${take.length} แถวแรกจากไฟล์ (มีทั้งหมด ${total} แถว) — ตรวจสอบแล้วกดบันทึก · ส่วนที่เหลืออัปโหลดเป็นรอบถัดไป`
        : `นำเข้า ${take.length} รายการจากไฟล์แล้ว — ตรวจสอบข้อมูลแล้วกดบันทึกทั้งหมด` });
    };
    reader.readAsText(file, "utf-8");
  };

  const setField=(i,k,v)=>setRows(rs=>rs.map((r,j)=>j===i?{...r,[k]:v}:r));
  const addRow=()=>setRows(rs=>rs.length<MAX_ROWS?[...rs,emptyRow()]:rs);
  const removeRow=i=>setRows(rs=>rs.length>1?rs.filter((_,j)=>j!==i):rs);

  // รายชื่อธุรกิจที่มีอยู่แล้ว (ไว้เตือนชื่อซ้ำในจังหวัดเดียวกัน)
  const existing = (db.customers||[]).concat(db.prospects||[]);

  // ── validation ต่อแถว ──
  const rowErrors = r => {
    const e=[]; const la=+r.lat, ln=+r.lng;
    const numOk = r.lat!=="" && r.lng!=="" && !isNaN(la) && !isNaN(ln);
    if(!r.name.trim()) e.push("ชื่อธุรกิจ");
    if(!r.address.trim()) e.push("ที่อยู่");
    if(r.lat===""||isNaN(la)) e.push("ละติจูด");
    if(r.lng===""||isNaN(ln)) e.push("ลองจิจูด");
    if(numOk && !provinceOf(la,ln)) e.push("พิกัดอยู่นอกพื้นที่ให้บริการ");
    if(r.type==="Existing" && !r.clientId.trim()) e.push("รหัสลูกค้า");
    if(r.email.trim() && !isEmail(r.email)) e.push("รูปแบบอีเมลไม่ถูกต้อง");
    return e;
  };
  const errsByRow = rows.map(rowErrors);
  const badRows = errsByRow.filter(e=>e.length>0).length;
  const canSave = badRows===0;
  // เตือนชื่อซ้ำกับรายการที่มีอยู่ (ไม่บล็อก)
  const dupWarn = rows.map(r=>{ const n=r.name.trim().toLowerCase(); if(!n) return null;
    const prov = (r.lat!==""&&r.lng!=="") ? provinceOf(+r.lat,+r.lng) : null;
    const hit = existing.find(x=> (x.businessName||"").trim().toLowerCase()===n && (!prov||x.province===prov));
    return hit ? hit.businessName : null; });

  const save=()=>{
    if(!canSave){ setShowErr(true); return; }
    const recs = rows.map((r,i)=>buildRecord(r,i, db, isEdit?editRecord.id:null));
    onSave(recs);
  };

  return createPortal(html`<div class="ar-backdrop" onMouseDown=${e=>{ if(e.target.classList.contains("ar-backdrop")) onClose(); }}>
    <div class="ar-card" role="dialog" aria-modal="true">
      <div class="ar-head">
        <div style=${{minWidth:0}}>
          <h2 class="ar-title">${isEdit?"แก้ไขรายการ":(prospectOnly?"เพิ่มLead":"เพิ่มลูกค้า/Lead")}</h2>
          <div class="ar-desc">${isEdit?"แก้ไขข้อมูลรายการที่คุณเพิ่มไว้":"กรอกได้สูงสุด 10 รายการต่อครั้ง · ข้อมูลที่เก็บมี 4 ฟิลด์: ชื่อธุรกิจ · หมวดหมู่ · ที่อยู่ · อีเมล"}</div>
        </div>
        <button class="ar-x" onClick=${onClose} aria-label="ปิด"><${Icon} name="close" size=${16}/></button>
      </div>

      <div class="ar-hint"><${Icon} name="pin" size=${14} color="#ff3b5c"/> กรอกพิกัดจากแหล่งข้อมูลของท่าน (ละติจูด, ลองจิจูด) — ต้องอยู่ในพื้นที่ให้บริการ 4 จังหวัด</div>

      ${!isEdit && allowImport ? html`<div class="ar-import">
        <label class="ar-imp-btn"><input type="file" accept=".csv,.xls,.xlsx,text/csv" style=${{display:"none"}} onChange=${onImportFile}/>
          <${Icon} name="upload" size=${15}/> อัปโหลด Excel/CSV</label>
        <button class="ar-imp-tpl" onClick=${downloadTemplate}><${Icon} name="download" size=${14}/> ดาวน์โหลดเทมเพลต</button>
        <span class="ar-imp-hint">อัปโหลดครั้งเดียวได้หลายรายการ · รองรับ .csv (ใน Excel เลือก “บันทึกเป็น” CSV UTF-8)</span>
      </div>
      ${importMsg ? html`<div class=${"ar-impmsg "+(importMsg.bad?"bad":"ok")}><${Icon} name=${importMsg.bad?"info":"check"} size=${14}/> ${importMsg.text}</div>`:""}`:""}

      <div class="ar-body">
        ${rows.map((r,i)=>{
          const d=deriveRow(r,db); const errs=errsByRow[i]; const isP=r.type==="Prospect";
          const showRowErr = showErr && errs.length>0;
          return html`<div key=${i} class=${"ar-row"+(showRowErr?" ar-err":"")+(d.outOfService?" ar-warn":"")}>
          <div class="ar-rowhead">
            <span class="ar-rowno">รายการที่ ${i+1}</span>
            ${(rows.length>1 && !isEdit) ? html`<button class="ar-del" onClick=${()=>removeRow(i)} title="ลบแถวนี้" aria-label="ลบแถวนี้"><${Icon} name="trash" size=${14}/></button>`:""}
          </div>
          <div class="ar-grid">
            ${!prospectOnly ? html`<label class="ar-f">ประเภท
              <select value=${r.type} onChange=${e=>setField(i,"type",e.target.value)}>
                <option value="Existing">ลูกค้าปัจจุบัน</option>
                <option value="Prospect">Lead</option></select></label>`:""}
            <label class="ar-f ar-wide">ชื่อธุรกิจ *
              <input class=${showRowErr&&!r.name.trim()?"ar-bad":""} value=${r.name} onInput=${e=>setField(i,"name",e.target.value)} placeholder="เช่น โรงแรมสวนสน"/></label>
            <label class="ar-f ar-wide">หมวดหมู่ธุรกิจ
              <${Dropdown} value=${r.segment} onChange=${v=>setField(i,"segment",v)}
                options=${SEGMENTS.map(s=>[s, html`<span style=${{display:"inline-flex",alignItems:"center",gap:"8px"}}><${SegmentIcon} seg=${s} size=${18} color="var(--muted)"/>${segTH(s)}</span>`])}/></label>
            <label class="ar-f ar-wide">ที่อยู่ *
              <input class=${showRowErr&&!r.address.trim()?"ar-bad":""} value=${r.address} onInput=${e=>setField(i,"address",e.target.value)} placeholder="บ้านเลขที่ ถนน แขวง/ตำบล เขต/อำเภอ"/></label>
            <label class="ar-f ar-wide">อีเมล
              <input class=${showRowErr&&r.email.trim()&&!isEmail(r.email)?"ar-bad":""} value=${r.email} onInput=${e=>setField(i,"email",e.target.value)} inputmode="email" placeholder="contact@example.co.th"/></label>
            <label class="ar-f">ละติจูด *
              <input class=${showRowErr&&(r.lat===""||isNaN(+r.lat))?"ar-bad":""} value=${r.lat} onInput=${e=>setField(i,"lat",e.target.value)} inputmode="decimal" placeholder="13.7563"/></label>
            <label class="ar-f">ลองจิจูด *
              <input class=${showRowErr&&(r.lng===""||isNaN(+r.lng))?"ar-bad":""} value=${r.lng} onInput=${e=>setField(i,"lng",e.target.value)} inputmode="decimal" placeholder="100.5018"/></label>
          </div>

          ${d.outOfService ? html`<div class="ar-zone out"><${Icon} name="pin" size=${13}/> พิกัดอยู่นอกพื้นที่ให้บริการ (รองรับเฉพาะ กรุงเทพฯ · พัทยา · ภูเก็ต · เชียงใหม่)</div>`
            : d.hasCoord ? html`<div class="ar-zone"><span>${provinceTH(d.province)}${d.zone&&d.zone.district?" · "+d.zone.district:""}</span>
              ${d.zoneGap ? html`<span class=${"gaplv g-"+d.zoneGap}>Lead${GAP_TH[d.zoneGap]}</span>`:""}</div>`:""}

          ${d.hasCoord && !d.outOfService ? html`<${MiniMap} lat=${+r.lat} lng=${+r.lng}/>`:""}

          ${isP ? ""
          : html`
            <div class="ar-sub">ข้อมูลลูกค้าปัจจุบัน (ตามไฟล์ข้อมูลลูกค้าจริง)</div>
            <div class="ar-grid">
              <label class="ar-f">รหัสลูกค้า (AccountNo) *
                <input class=${showRowErr&&!r.clientId.trim()?"ar-bad":""} value=${r.clientId} onInput=${e=>setField(i,"clientId",e.target.value)} placeholder="เช่น 01180420"/></label>
              <label class="ar-f">เบอร์โทรศัพท์
                <input value=${r.phone} onInput=${e=>setField(i,"phone",e.target.value)} placeholder="081 234 5678"/></label>
              <label class="ar-f">วันที่เริ่มเป็นลูกค้า
                <${DateField} value=${r.dateJoin} onChange=${v=>setField(i,"dateJoin",v)}/></label>
              <label class="ar-f">เว็บไซต์
                <input value=${r.website} onInput=${e=>setField(i,"website",e.target.value)} placeholder="www.example.com"/></label>
              <label class="ar-f">เฟซบุ๊ก
                <input value=${r.facebook} onInput=${e=>setField(i,"facebook",e.target.value)} placeholder="https://facebook.com/…"/></label>
            </div>`}

          ${dupWarn[i] ? html`<div class="ar-dup">อาจซ้ำกับรายการที่มีอยู่: <b>${dupWarn[i]}</b></div>`:""}
        </div>`;})}

        ${!isEdit ? (rows.length<MAX_ROWS
          ? html`<button class="ar-addrow" onClick=${addRow}><${Icon} name="plus" size=${15}/> เพิ่มอีกรายการ</button>`
          : html`<div class="ar-max">กรอกได้สูงสุด 10 รายการต่อครั้ง</div>`) : ""}
      </div>

      <div class="ar-msgs">
        ${showErr && !canSave ? html`<div class="ar-m ar-m-err">มี ${badRows} รายการที่ยังกรอกไม่ครบ/ไม่ถูกต้อง — แก้ไขให้ครบก่อนบันทึก</div>`:""}
      </div>

      <div class="ar-foot">
        <button class="ar-btn ghost" onClick=${onClose}>ยกเลิก</button>
        <!-- ปุ่มบันทึกกดได้เสมอ · ถ้ากรอกไม่ครบ กดแล้วจะไฮไลต์ช่องที่ยังขาด (ไม่ปิดปุ่มจนกดไม่ได้) -->
        <button class="ar-btn primary" onClick=${save}>
          <${Icon} name="check" size=${15} color="#fff"/>${isEdit?"บันทึกการแก้ไข":`บันทึกทั้งหมด (${rows.length} รายการ)`}</button>
      </div>
      <style>${AR_CSS}</style>
    </div>
  </div>`, document.body);
}

const AR_CSS = `
.ar-backdrop{position:fixed;inset:0;z-index:1200;overflow-y:auto;padding:20px;
  background:rgba(4,7,14,.6);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
  animation:ar-fade .25s ease;font-family:var(--font)}
@keyframes ar-fade{from{opacity:0}to{opacity:1}}
.ar-card{width:820px;max-width:100%;margin:40px auto;border-radius:20px;display:flex;flex-direction:column;
  max-height:calc(100vh - 80px);background:var(--panel);border:1px solid var(--stroke2);
  box-shadow:0 34px 90px rgba(0,0,0,.6);animation:ar-pop .3s cubic-bezier(.2,.9,.25,1)}
@keyframes ar-pop{from{opacity:0;transform:translateY(14px) scale(.97)}to{opacity:1;transform:none}}
.ar-head{flex:none;display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:20px 22px 12px}
.ar-title{margin:0;font-size:18px;font-weight:800;color:var(--txt)}
.ar-desc{margin-top:5px;font-size:12.5px;color:var(--muted)}
.ar-x{flex:none;width:32px;height:32px;border:none;border-radius:9px;cursor:pointer;background:var(--surface);color:var(--muted)}
.ar-x:hover{color:var(--txt)}
.ar-hint{flex:none;display:flex;align-items:center;gap:7px;margin:0 22px 4px;padding:9px 12px;border-radius:10px;
  background:rgba(255,122,168,.08);border:1px solid rgba(255,122,168,.25);color:var(--txt);font-size:12.5px}
/* แถบนำเข้าเป็นชุดจากไฟล์ Excel/CSV */
.ar-import{flex:none;display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:8px 22px 2px}
.ar-imp-btn,.ar-imp-tpl{display:inline-flex;align-items:center;gap:7px;padding:8px 13px;border-radius:10px;
  font-family:var(--font);font-size:12.5px;font-weight:700;cursor:pointer;white-space:nowrap}
.ar-imp-btn{background:var(--accent);color:#fff;border:1px solid var(--accent)}
.ar-imp-btn:hover{background:var(--accent-deep)}
.ar-imp-tpl{background:transparent;color:var(--accent-deep);border:1.5px solid var(--accent)}
.ar-imp-tpl:hover{background:var(--accent-soft)}
.ar-imp-hint{font-size:11.5px;color:var(--muted);flex:1;min-width:180px}
.ar-impmsg{flex:none;display:flex;align-items:center;gap:7px;margin:6px 22px 0;padding:9px 12px;border-radius:10px;font-size:12.5px;font-weight:600;line-height:1.5}
.ar-impmsg.ok{background:rgba(51,214,159,.1);border:1px solid rgba(51,214,159,.3);color:#0f7a3d}
.ar-impmsg.bad{background:rgba(255,176,46,.1);border:1px solid rgba(255,176,46,.3);color:#b45309}
.ar-body{flex:1 1 auto;overflow-y:auto;min-height:0;padding:12px 22px}
.ar-row{border:1px solid var(--stroke2);border-radius:13px;padding:12px 13px;margin-bottom:11px;background:var(--surface);transition:border-color .15s,background .15s}
.ar-row.ar-warn{border-color:rgba(255,176,46,.55);background:rgba(255,176,46,.06)}
.ar-row.ar-err{border-color:rgba(255,90,90,.6);background:rgba(255,90,90,.05)}
.ar-rowhead{display:flex;justify-content:space-between;align-items:center;margin-bottom:9px}
.ar-rowno{font-size:12px;font-weight:700;color:var(--dim)}
.ar-del{width:28px;height:28px;display:grid;place-items:center;border:none;border-radius:8px;cursor:pointer;background:none;color:var(--dim)}
.ar-del:hover{background:rgba(255,90,90,.12);color:#ff5a5a}
.ar-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:9px}
.ar-f{display:flex;flex-direction:column;gap:4px;font-size:11.5px;font-weight:700;color:var(--dim);min-width:0}
.ar-f.ar-wide{grid-column:span 3}
.ar-f select,.ar-f input{padding:8px 10px;border-radius:9px;border:var(--dropdown-border);background:var(--dropdown-bg);
  color:var(--dropdown-text);font-family:var(--font);font-size:12.5px;font-weight:400;width:100%;box-sizing:border-box;box-shadow:var(--dropdown-shadow)}
.ar-f select{color-scheme:light}
.ar-f input.ar-bad{border-color:#ff5a5a;background:rgba(255,90,90,.07)}
.ar-hint2{font-size:10.5px;font-weight:500;color:var(--muted)}
.ar-sub{margin:13px 0 8px;font-size:12px;font-weight:800;color:var(--txt);padding-top:11px;border-top:1px dashed var(--stroke)}
.ar-zone{margin:8px 0 6px;font-size:12px;font-weight:700;color:var(--txt);display:flex;align-items:center;gap:6px}
.ar-zone.out{color:#b45309}
.ar-map{height:150px;border-radius:11px;overflow:hidden;margin:6px 0 4px;border:1px solid var(--stroke2);z-index:0}
.ar-badge{padding:8px 10px;border-radius:9px;font-size:12.5px;font-weight:800;text-align:center}
.ar-badge.zone-High{background:rgba(51,214,159,.16);color:#0f7a3d}
.ar-badge.zone-Medium{background:rgba(255,176,46,.16);color:#b45309}
.ar-badge.zone-Low{background:rgba(138,160,190,.16);color:#475569}
.ar-bd{margin-top:10px;padding-top:9px;border-top:1px solid var(--stroke);cursor:default}
.ar-bd-row{display:flex;justify-content:space-between;gap:12px;padding:3px 0;font-size:12px;color:var(--txt)}
.ar-bd-row.miss{color:var(--muted)}
.ar-bd-row.miss b{color:var(--muted)}
.ar-bd-row b{color:#0f7a3d;font-variant-numeric:tabular-nums}
.ar-bd-hint{font-size:10.5px;color:var(--muted)}
.ar-bd-row.total{border-top:1px dashed var(--stroke);margin-top:5px;padding-top:7px;font-weight:800}
.ar-bd-row.total b{color:var(--txt)}
.ar-toggle{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:9px;border:1px solid var(--stroke2);
  background:var(--dropdown-bg);color:var(--dropdown-text);font-family:var(--font);font-size:12.5px;font-weight:600;cursor:pointer}
.ar-toggle-dot{width:30px;height:17px;border-radius:20px;background:rgba(140,140,140,.4);position:relative;transition:.2s;flex:none}
.ar-toggle-dot::after{content:"";position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:50%;background:#fff;transition:.2s}
.ar-toggle.on .ar-toggle-dot{background:#33d69f}
.ar-toggle.on .ar-toggle-dot::after{left:15px}
.ar-dup{margin-top:9px;padding:8px 11px;border-radius:9px;font-size:12px;background:rgba(255,176,46,.1);border:1px solid rgba(255,176,46,.3);color:#b45309}
.ar-addrow{margin-top:2px;display:inline-flex;align-items:center;gap:6px;padding:9px 15px;border-radius:10px;
  border:1px dashed var(--stroke2);background:transparent;color:var(--accent2);cursor:pointer;font-family:var(--font);font-size:12.5px;font-weight:700}
.ar-addrow:hover{border-color:var(--accent2);background:rgba(255, 59, 92,.06)}
.ar-max{margin-top:2px;padding:9px 13px;border-radius:10px;background:rgba(120,160,220,.06);color:var(--muted);font-size:12px}
.ar-msgs{flex:none;padding:0 22px}
.ar-m{padding:9px 12px;border-radius:10px;font-size:12.5px;margin-bottom:8px}
.ar-m-err{background:rgba(255,90,90,.12);border:1px solid rgba(255,90,90,.4);color:#ff7a7a}
.ar-foot{flex:none;display:flex;justify-content:flex-end;gap:10px;padding:14px 22px 20px;border-top:1px solid var(--stroke)}
.ar-btn{display:inline-flex;align-items:center;gap:7px;font-family:var(--font);font-size:13.5px;font-weight:700;
  cursor:pointer;border-radius:11px;padding:11px 20px}
.ar-btn.ghost{background:transparent;border:1px solid var(--stroke2);color:var(--muted)}
.ar-btn.ghost:hover{color:var(--txt);border-color:rgba(120,160,220,.45)}
.ar-btn.primary{border:none;color:#fff;background:linear-gradient(135deg,#ff3b5c,#e60023)}
.ar-btn.primary:hover{filter:brightness(1.05)}
.ar-btn.primary.disabled{opacity:.5;cursor:not-allowed;filter:grayscale(.3)}
@media (max-width:640px){.ar-grid{grid-template-columns:repeat(2,1fr)}.ar-f.ar-wide{grid-column:span 2}}
`;
