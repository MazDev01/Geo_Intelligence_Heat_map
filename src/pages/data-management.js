// ═══════════════════════════════════════════════════════════════════════════
// หน้า "จัดการข้อมูล" (Data Management) — เฉพาะผู้ดูแลระบบ (Administrator)
// แท็บ: นำเข้าไฟล์ Excel (wizard) · จัดการไฟล์นำเข้า (รวม "จัดการรายการค้าง" = ขั้นตอนที่ 3 ต่อไฟล์) · ข้อมูลที่ TC กรอก · ดีลรออนุมัติ
// หมายเหตุ: แท็บ "ตรวจสอบและแก้ไขข้อมูล" เดิมถูกยุบ — ความสามารถ (TriageReview) ย้ายไปเปิดในโหมด resume ของ wizard ต่อไฟล์
// สแตกจริงของโปรเจกต์ = buildless htm/React (ไม่ใช่ Next.js/Tailwind/Supabase ตามหัว prompt) ใช้ token/คอมโพเนนต์เดิม
// ทุกข้อความเป็นภาษาไทย · ทุก action ที่เปลี่ยนข้อมูลบันทึกลง Audit Log (src/audit.js)
// ═══════════════════════════════════════════════════════════════════════════
import {html, useState, useEffect, useMemo, useRef, useApp, Icon, num, provinceTH, districtTH, PROVINCE_TH, thDate, thDateTime} from "../lib.js";
import {basemap} from "../basemap.js";
import {Card, Kpi, Btn, Badge, Toggle, Table, Tabs, Modal, Meter, toast} from "../ui.js";
import {SEGMENTS, SEG_TH, PROVINCE_KEYS, GAP_TH} from "../mock/geoData.js";
import {pushAudit} from "../audit.js";
import {AddRecordsForm} from "../add-records.js";
import {createPortal} from "react-dom";
import {LeadManagement, genLeads} from "./lead-management.js";
import {Dropdown} from "../select.js";
import {loadProvincesGeo} from "../data.js";        // ขอบเขตจังหวัด (GeoJSON 77 จังหวัด) — ใช้วาดแผนที่ขอบเขตพื้นที่การขาย
import {SEED_USERS} from "./admin.js";              // ผู้ใช้จำลอง — TC มาจากบทบาท "ผู้ประสานงานการค้า"
import {TC_COLORS, tcMasterColor} from "./master-data.js";   // จานสี + สี TC ที่ตั้งไว้ในข้อมูลหลัก

/* ---------- ตัวช่วยวันที่ พ.ศ. ---------- */
const beDate=(iso,withTime)=> withTime ? thDateTime(iso) : thDate(iso);   // ใช้ตัวแปลงกลาง
const fmtBytes=b=> b>=1048576 ? (b/1048576).toFixed(1)+" MB" : Math.round(b/1024)+" KB";

/* ---------- RNG คงที่ (mock data เดิมทุกครั้ง) ---------- */
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const PROV_TH = PROVINCE_KEYS;   // 4 จังหวัด
const TC_NAMES = ["ธนพล ศรีวัฒน์","ณัฐริกา พงษ์ไพบูลย์","กิตติศักดิ์ อารยะกุล","ศุภมาส เจริญสุข","วีรภัทร ตันติพงศ์","ปิยะนุช วงศ์สกุล"];
const BIZ = ["ครัวคุณย่า","เดอะโค้ชโฮเทล","บิวตี้เฮาส์","สปาเรือนไทย","มอเตอร์พลัส","โฮมสตูดิโอ","ติวเตอร์เฮาส์","ที่ปรึกษาธุรกิจสยาม","มาร์ทเฟรช","เทคโฟกัส","คลีนโปร","อีเวนต์เอเจนซี","คาเฟ่ริมคลอง","รีสอร์ทภูวิว","ร้านอะไหล่ยนต์","เฟอร์นิเจอร์ดีไซน์"];

/* ---------- 35 รายการที่ TC/Admin กรอกเอง ---------- */
const genTC = ()=>{ const R=mulberry32(778899); const rp=a=>a[Math.floor(R()*a.length)]; const ri=(a,b)=>Math.floor(a+R()*(b-a+1));
  const CHECK=["รอตรวจสอบ","ตรวจสอบแล้ว","ตีกลับ"]; const out=[];
  for(let i=0;i<35;i++){
    const admin = R()<0.18;                    // ส่วนน้อยเป็น Admin กรอก (อาจเป็นลูกค้า)
    const type = admin && R()<0.5 ? "Existing" : "Prospect";   // กติกา: TC กรอกได้เฉพาะLead
    const prov = rp(PROV_TH); const bad = R()<0.12; const incomplete = R()<0.14;
    const nm = rp(BIZ)+" "+rp(["สาขา 1","สาขา 2","สำนักงานใหญ่","ริมถนน","ในเมือง"]);
    out.push({ id:"REC"+String(1001+i), name:nm,
      type, segment:rp(SEGMENTS), province:prov, district:"",
      lat: bad ? 45.2 : +(13+R()*6).toFixed(4), lng: bad ? 250 : +(98+R()*3).toFixed(4),
      email: incomplete ? "" : "contact"+(1001+i)+"@"+rp(["gmail.com","hotmail.com","outlook.co.th"]),
      tc: admin ? "System Administrator" : rp(TC_NAMES), date: `2026-0${ri(4,7)}-${String(ri(1,28)).padStart(2,"0")}`,
      check: rp(CHECK), source: admin?"manual_admin":"manual_tc", incomplete, badCoord:bad });
  }
  return out; };

/* ---------- 8 ไฟล์นำเข้า ---------- */
const IMPORTS = (()=>{ const R=mulberry32(20260714); const ri=(a,b)=>Math.floor(a+R()*(b-a+1)); const rp=a=>a[Math.floor(R()*a.length)];
  const files=["ลูกค้า_กรุงเทพ_Q2.xlsx","prospects_chiangmai.csv","ภูเก็ต_โรงแรม.xlsx","พัทยา_ร้านอาหาร.xlsx","batch_2026_06.xlsx","สำรวจใหม่_มิย.csv","retail_bkk.xlsx","import_error_test.xlsx"];
  const st=["สำเร็จ","สำเร็จ","สำเร็จ","สำเร็จบางส่วน","สำเร็จ","สำเร็จบางส่วน","สำเร็จ","ล้มเหลว"];
  return files.map((f,i)=>{ const total=ri(80,320); const done= st[i]==="ล้มเหลว"?0: st[i]==="สำเร็จบางส่วน"? Math.round(total*0.9): total;
    return { id:"IMP"+(101+i), file:f, dt:`2026-0${ri(4,7)}-${String(ri(1,28)).padStart(2,"0")}T${String(ri(8,18)).padStart(2,"0")}:${String(ri(0,59)).padStart(2,"0")}`,
      by:"System Administrator", done, total, status:st[i], template: rp(["ผังมาตรฐาน Barter","ผังกรอกเอง","—"]),
      // จำนวนที่ถูกแก้ไขหลังนำเข้า / ที่มีการเข้าพบแล้ว — ใช้ในสรุปผลกระทบตอนยกเลิกทั้งชุด (รายการที่เข้าพบแล้วจะไม่ถูกถอน)
      editedAfter: done? ri(0, Math.max(1,Math.round(done*0.03))):0,
      visited: done? ri(0, Math.max(1,Math.round(done*0.012))):0, withdrawn:false }; })
    .sort((a,b)=> a.dt<b.dt?1:-1); })();
// วันอ้างอิง "ปัจจุบัน" = วันนำเข้าล่าสุดที่มีในระบบ (ไม่อิงนาฬิกาเครื่อง) — ใช้กับกติกายกเลิกได้ภายใน 7 วัน
const IMPORT_NOW = IMPORTS.reduce((m,b)=> b.dt>m?b.dt:m, "");
const daysSince = dt => (Date.parse(IMPORT_NOW.slice(0,10)) - Date.parse(dt.slice(0,10)))/864e5;

/* ---------- แถว "รอแก้ไข" (staging) สำหรับหน้าตรวจสอบและแก้ไขข้อมูล ----------
   แถวที่นำเข้าแล้วมีปัญหา (ไม่ครบ / อาจซ้ำ / พิกัดผิด) จะถูกพักไว้ที่นี่ ไม่เข้าระบบทันทีและไม่ถูกลบทิ้ง
   ข้อมูลดิบต้นฉบับเก็บไว้ที่ raw เสมอ ไม่แก้ · การแก้ไขไปเก็บที่ corrected · สถานะ: pending|imported|merged|skipped */
const ADDR0=["123 ถ.นิมมานเหมินท์","45 ถ.สุขุมวิท","88 ถ.ช้างคลาน","12 ซ.รัชดา 7","99 ถ.เจริญเมือง","5 ถ.ท่าแพ","210 ถ.บางนา","7 ซ.ทองหล่อ 10"];
// ขอบเขตพิกัดประเทศไทยแบบหยาบ — ใช้ตรวจว่าพิกัด "อยู่นอกประเทศ" หรือไม่
const validCoord=(la,ln)=> typeof la==="number"&&typeof ln==="number"&&la>=5.5&&la<=20.6&&ln>=97&&ln<=106;
function genStaging(){
  const R=mulberry32(424242); const rp=a=>a[Math.floor(R()*a.length)]; const ri=(a,b)=>Math.floor(a+R()*(b-a+1));
  const suf=["สาขา 1","สาขา 2","สำนักงานใหญ่","ริมถนน","ในเมือง"]; const out=[]; let n=0;
  const mk=(kind,raw,extra)=>{ n++; return {id:"STG"+(1000+n), row:ri(2,320), batch:"batch_2026_07", kind, raw, corrected:null, status:"pending", ...extra}; };
  // 18 รายการข้อมูลไม่ครบ (บางรายการขาดฟิลด์บังคับ = error, บางรายการขาดฟิลด์เสริม = warning)
  for(let i=0;i<18;i++){
    const hasName=R()<0.62; const name=hasName? rp(BIZ)+" "+rp(suf) : "";
    const missProv=hasName&&R()<0.32; const missPhone=R()<0.7; const unknownSeg=R()<0.28;
    const issues=[];
    if(!hasName) issues.push({type:"missing_required",field:"name",severity:"error"});
    if(missProv)  issues.push({type:"missing_required",field:"province",severity:"error"});
    if(missPhone) issues.push({type:"missing_optional",field:"phone",severity:"warning"});
    if(unknownSeg)issues.push({type:"unknown_value",field:"segment",severity:"warning",detail:"ไม่ตรงหมวดธุรกิจที่ระบบรู้จัก"});
    if(!issues.length) issues.push({type:"missing_optional",field:"email",severity:"warning"});
    out.push(mk("incomplete",{ name, address:rp(ADDR0), province: missProv?"":rp(PROV_TH), district:"",
      lat:+(13+R()*6).toFixed(4), lng:+(98+R()*3).toFixed(4), segment: unknownSeg?"ค้าส่ง (ไม่ทราบ)":rp(SEGMENTS),
      type: rp(["Existing","Prospect"]), phone: missPhone?"":"0"+ri(600000000,899999999), email:"" }, {issues}));
  }
  // 21 รายการสงสัยว่าซ้ำกับข้อมูลเดิม (คู่เทียบ + คะแนนความคล้าย)
  for(let i=0;i<21;i++){
    const base=rp(BIZ); const nm=base+" "+rp(suf); const prov=rp(PROV_TH); const seg=rp(SEGMENTS);
    const la=+(13+R()*6).toFixed(4), ln=+(98+R()*3).toFixed(4); const sim=+(0.6+R()*0.39).toFixed(2);
    out.push(mk("dup",{ name:nm, address:rp(ADDR0), province:prov, district:"", lat:la, lng:ln, segment:seg,
        type:"Prospect", phone:"0"+ri(600000000,899999999), email:"" },
      { similarity:sim,
        match:{ id:"CUS"+ri(10000,99999), name:base+" สาขาเดิม", address:rp(ADDR0), province:prov, segment:seg,
          lat:+(la+0.0003).toFixed(4), lng:+(ln+0.0002).toFixed(4), phone:"0"+ri(600000000,899999999) },
        issues:[{type:"duplicate",severity:"warning",matched_id:"CUS",similarity:sim}] }));
  }
  // 8 รายการพิกัดไม่ถูกต้อง (อยู่นอกขอบเขตประเทศไทย)
  for(let i=0;i<8;i++){
    out.push(mk("badcoord",{ name:rp(BIZ)+" "+rp(suf), address:rp(ADDR0), province:rp(PROV_TH), district:"",
      lat: rp([88.21,-12.5,199.9,45.2,0]), lng: rp([250.1,700.4,-5.2,0]), segment:rp(SEGMENTS),
      type:"Prospect", phone:"0"+ri(600000000,899999999), email:"" },
      { issues:[{type:"invalid_coordinate",field:"location",severity:"error",detail:"พิกัดอยู่นอกขอบเขตประเทศไทย"}] }));
  }
  // ผูกแต่ละแถว "ค้าง" กับไฟล์นำเข้าที่มีปัญหา (สำเร็จบางส่วน/ล้มเหลว) → จัดการต่อจากบริบทไฟล์เดิมได้
  const PF = IMPORTS.filter(f=>f.status==="สำเร็จบางส่วน"||f.status==="ล้มเหลว").map(f=>f.id);
  out.forEach((r,i)=>{ r.fileId = PF.length ? PF[i % PF.length] : (IMPORTS[0]&&IMPORTS[0].id); });
  return out;
}
// สรุปผลการนำเข้าต่อไฟล์ (นับจาก staging ที่ผูกกับไฟล์) — เข้าระบบ/ค้าง/ข้าม + จำนวนวันที่ค้าง
function fileStats(f, staging){
  const mine=(staging||[]).filter(s=>s.fileId===f.id);
  const pending=mine.filter(s=>s.status==="pending").length;
  const skipped=mine.filter(s=>s.status==="skipped").length;
  const resolved=mine.filter(s=>s.status==="imported"||s.status==="merged").length;
  return { imported:(f.done||0)+resolved, pending, skipped, resolved, count:mine.length,
    hasPending:pending>0, days: pending>0 ? Math.max(0,Math.round(daysSince(f.dt))) : 0 };
}
// ความรุนแรงของทั้งแถว = มี error ข้อใดข้อหนึ่ง → error มิฉะนั้น → warning
const rowSeverity = r => r.issues.some(i=>i.severity==="error") ? "error" : "warning";

/* ---------- แถวตรวจสอบใน wizard (mock 24 แถว) ---------- */
const _slug = s => (s||"").replace(/[^ก-๙a-z0-9]/gi,"").slice(0,6).toLowerCase()||"biz";
const VAL_ROWS = (()=>{ const R=mulberry32(3131); const rp=a=>a[Math.floor(R()*a.length)]; const ri=(a,b)=>Math.floor(a+R()*(b-a+1));
  const issues=["ok","ok","ok","ok","ok","ok","incomplete","badcoord","dup","ok","ok","dup","ok","incomplete","ok","ok","badcoord","ok","dup","ok","ok","ok","incomplete","ok"];
  const ROADS=["สุขุมวิท","นิมมานเหมินท์","ช้างคลาน","เจริญเมือง","ท่าแพ"];
  const rows = issues.map((iss,i)=>{ const row=i+2; const nm=rp(BIZ); const prov=rp(PROV_TH);
    return { row, name:nm, address:ri(1,999)+" ถ."+rp(ROADS), province:prov, district:"",
      lat:+(13+R()*6).toFixed(4), lng:+(98+R()*3).toFixed(4), segment:rp(SEGMENTS), type:rp(["Existing","Prospect"]),
      phone:"0"+ri(600000000,899999999), email:_slug(nm)+ri(1,99)+"@mail.com", issue:iss, edited:false, match:null }; });
  // แถวทดสอบเฉพาะเจาะจง
  const R8=rows[6];  R8.name="เฟอร์นิเจอร์ดีไซน์"; R8.province=""; R8.phone="";       // ข้อมูลไม่ครบ: ขาดจังหวัด + เบอร์
  const R9=rows[7];  R9.name="บิวตี้เฮาส์"; R9.lat=98.9853; R9.lng=18.7883;             // พิกัดสลับ lat/lng
  const R17=rows[15]; R17.lat="ไม่ระบุ"; R17.lng=250.4;                                 // ไม่ใช่ตัวเลข + นอกขอบเขต
  // แถวซ้ำ: แนบข้อมูลเดิมในระบบ (match) ให้เทียบทีละช่อง
  rows.filter(r=>r.issue==="dup").forEach(r=>{ r.match={ id:"CUS"+ri(10000,99999), name:r.name,
    address:ri(1,999)+" ถ."+rp(ROADS), province:r.province, segment:r.segment, type:"Existing",
    phone:"0"+ri(600000000,899999999), email:_slug(r.name)+"@old.com", lat:+(Number(r.lat)+0.0004).toFixed(4), lng:+(Number(r.lng)+0.0003).toFixed(4) }; });
  return rows; })();
// ตรวจปัญหารายฟิลด์แบบสด (ใช้ทั้งไฮไลต์และตัดสินสถานะหลังแก้)
function fieldProblem(k, v, all){
  const meta=SYS_FIELDS.find(f=>f.k===k); const req=meta&&meta.req;
  const empty = v==null || String(v).trim()==="";
  if(k==="lat"||k==="lng"){
    if(empty) return req?"ไม่พบข้อมูลในไฟล์":"";
    if(isNaN(Number(v))) return "ค่าที่พบไม่ใช่ตัวเลข";
    const laN=Number(all.lat), lnN=Number(all.lng);
    if(!isNaN(laN)&&!isNaN(lnN) && laN>=97&&laN<=106 && lnN>=5.5&&lnN<=20.6) return "ค่าละติจูดและลองจิจูดอาจสลับกัน";
    if(k==="lat" && (Number(v)<5.5||Number(v)>20.6)) return "พิกัดอยู่นอกขอบเขตประเทศไทย";
    if(k==="lng" && (Number(v)<97||Number(v)>106)) return "พิกัดอยู่นอกขอบเขตประเทศไทย";
    return "";
  }
  if(empty && req) return "ไม่พบข้อมูลในไฟล์";
  return "";
}
const EDIT_FIELDS=["name","address","province","district","lat","lng","segment","type","phone","email"];

const SYS_FIELDS = [
  {k:"name",label:"ชื่อธุรกิจ",req:true},{k:"address",label:"ที่อยู่",req:true},{k:"province",label:"จังหวัด",req:true},
  {k:"lat",label:"Latitude",req:true},{k:"lng",label:"Longitude",req:true},{k:"segment",label:"หมวดหมู่ธุรกิจ (Segment)",req:true},
  {k:"type",label:"ประเภท (ลูกค้า/Lead)",req:true},{k:"district",label:"อำเภอ/เขต"},{k:"phone",label:"เบอร์โทร"},
  {k:"email",label:"อีเมล"},{k:"note",label:"หมายเหตุ"},{k:"__skip",label:"— ไม่นำเข้าคอลัมน์นี้ —"} ];
// คอลัมน์ในไฟล์ mock + การจับคู่อัตโนมัติที่ระบบเดา · sample = ค่าจริง 3 แถวแรกในไฟล์ (ใช้แสดงตัวอย่าง + ตรวจความสมเหตุสมผล)
const FILE_COLS = [
  {col:"ชื่อร้าน", sample:["ครัวคุณย่า","เดอะโค้ชโฮเทล","บิวตี้เฮาส์"], auto:"name"},
  {col:"ที่ตั้ง", sample:["123 ถ.สุขุมวิท","45 ถ.นิมมาน","88 ถ.ช้างคลาน"], auto:"address"},
  {col:"จังหวัด", sample:["กรุงเทพมหานคร","เชียงใหม่","ภูเก็ต"], auto:"province"},
  {col:"lat", sample:["13.7460","18.7883","7.8804"], auto:"lat"},
  {col:"lng", sample:["100.5340","98.9853","98.3923"], auto:"lng"},
  {col:"ประเภทกิจการ", sample:["ร้านอาหาร","โรงแรม","ค้าปลีก"], auto:"segment"},
  {col:"สถานะ", sample:["Lead","ลูกค้า","Lead"], auto:"type"},
  {col:"เบอร์", sample:["021234567","0812345678","053224100"], auto:"phone"},
  {col:"อีเมลติดต่อ", sample:["a@x.com","b@y.com","c@z.com"], auto:"email"},
  {col:"คอลัมน์พิเศษ", sample:["-","-","-"], auto:"__skip"} ];
// ตรวจความสมเหตุสมผลของค่าตัวอย่างเทียบกับฟิลด์ที่จับคู่ (ไม่บล็อกการกดต่อ — เป็นคำเตือนให้เห็นก่อนตัดสินใจ)
function mapWarn(field, samples){
  const nums = samples.map(v=>parseFloat(String(v).replace(/[^\d.\-]/g,""))).filter(v=>!isNaN(v));
  if(field==="lat"){
    if(nums.length<samples.length) return "บางค่าไม่ใช่ตัวเลข — คอลัมน์นี้อาจไม่ใช่ละติจูด";
    if(nums.some(v=>v<5||v>21)) return "ค่าที่พบอยู่นอกช่วงละติจูดของไทย (5–21) — ตรวจว่าสลับคอลัมน์กับลองจิจูดหรือไม่";
  }
  if(field==="lng"){
    if(nums.length<samples.length) return "บางค่าไม่ใช่ตัวเลข — คอลัมน์นี้อาจไม่ใช่ลองจิจูด";
    if(nums.some(v=>v<97||v>106)) return "ค่าที่พบอยู่นอกช่วงลองจิจูดของไทย (97–106) — ตรวจว่าสลับคอลัมน์หรือไม่";
  }
  return "";
}

const ISSUE_META = {
  ok:{tone:"good",label:"ผ่าน"}, incomplete:{tone:"warn",label:"ข้อมูลไม่ครบ"},
  badcoord:{tone:"bad",label:"พิกัดผิดพลาด"}, dup:{tone:"neutral",label:"ซ้ำกับข้อมูลเดิม"},
  edited:{tone:"good",label:"แก้ไขแล้ว"}, skipped:{tone:"neutral",label:"ข้าม"} };
const SEG_TH_OF = s => SEG_TH[s]||s;
const IMP_STATUS = { "สำเร็จ":"good", "สำเร็จบางส่วน":"warn", "ล้มเหลว":"bad", "กำลังประมวลผล":"info" };
const CHECK_TONE = { "รอตรวจสอบ":"warn", "ตรวจสอบแล้ว":"good", "ตีกลับ":"bad" };
const SRC_TH = { manual_tc:"TC กรอกเอง", manual_admin:"Admin กรอกเอง", import_file:"นำเข้าจากไฟล์" };
const SRC_TONE = { manual_tc:"info", manual_admin:"neutral", import_file:"warn" };

// ── Drawer แก้ไขแถว (ขั้นตอนที่ 3) — ฟอร์มแก้ได้จริง + ไฮไลต์ฟิลด์ที่ผิด · แถวซ้ำ = ตารางเทียบ ──
function EditRowDrawer({row, onClose, onSave, onSkip, onMerge, onNew}){
  const isDup = row.issue==="dup" && row.match;
  const [vals,setVals]=useState(()=>Object.fromEntries(EDIT_FIELDS.map(k=>[k,row[k]!=null?row[k]:""])));
  const [pick,setPick]=useState({});
  const set=(k,v)=>setVals(o=>({...o,[k]:v}));
  const swapLatLng=()=>setVals(o=>({...o,lat:o.lng,lng:o.lat}));
  const FM=Object.fromEntries(SYS_FIELDS.map(f=>[f.k,f]));
  const node = html`<div class="dm-erd-back" onMouseDown=${e=>{ if(e.target.classList.contains("dm-erd-back")) onClose(); }}>
    <div class="dm-erd">
      <div class="dm-erd-head">
        <div><div class="dm-erd-nm">แถวที่ ${row.row}${row.name?" · "+row.name:""}</div>
          <div class="dim" style=${{fontSize:"12px"}}>${isDup?"ซ้ำกับข้อมูลเดิม — เปรียบเทียบและตัดสินใจ":"แก้ไขค่าที่อ่านจากไฟล์ก่อนนำเข้า"}</div></div>
        <button class="dm-erd-x" onClick=${onClose}><${Icon} name="close" size=${16}/></button>
      </div>
      <div class="dm-erd-body">
        ${isDup ? html`
          <div class="dm-cmp2 dm-cmp2-h"><span>ฟิลด์</span><span>ข้อมูลเดิมในระบบ</span><span>ข้อมูลใหม่จากไฟล์</span></div>
          ${["name","address","province","segment","phone","email","lat","lng"].map(k=>{
            const ov=k==="segment"?SEG_TH_OF(row.match[k]):(row.match[k]!=null&&row.match[k]!==""?String(row.match[k]):"—");
            const nv=k==="segment"?SEG_TH_OF(row[k]):(row[k]!=null&&row[k]!==""?String(row[k]):"—");
            const diff=String(row.match[k])!==String(row[k]); const sel=pick[k]||"new";
            return html`<div key=${k} class=${"dm-cmp2"+(diff?" diff":"")}>
              <span class="dm-cmp2-l">${FM[k]?FM[k].label:k}</span>
              <label class=${"dm-cmp2-c"+(sel==="old"?" on":"")}><input type="radio" name=${"c"+k} checked=${sel==="old"} onChange=${()=>setPick(p=>({...p,[k]:"old"}))}/> ${ov}</label>
              <label class=${"dm-cmp2-c"+(sel==="new"?" on":"")}><input type="radio" name=${"c"+k} checked=${sel==="new"} onChange=${()=>setPick(p=>({...p,[k]:"new"}))}/> ${nv}</label>
            </div>`; })}
          <div class="dm-alert" style=${{marginTop:"12px"}}><${Icon} name="gap" size=${14}/> การรวมจะคงรหัสรายการเดิม <b>${row.match.id}</b> ไว้เสมอ · เลือกค่าที่จะเก็บได้รายช่อง (ไฮไลต์ = ค่าต่างกัน)</div>
        ` : html`
          <div class="dm-erd-grid">
          ${EDIT_FIELDS.map(k=>{ const err=fieldProblem(k, vals[k], vals); const meta=FM[k];
            const swap = err==="ค่าละติจูดและลองจิจูดอาจสลับกัน";
            return html`<div key=${k} class="dm-erd-f">
              <label>${meta?meta.label:k}${meta&&meta.req?" *":""}</label>
              ${k==="segment"?html`<select class=${"dm-input"+(err?" err":"")} value=${vals[k]} onChange=${e=>set(k,e.target.value)}>
                  <option value="">— เลือก —</option>${SEGMENTS.map(s=>html`<option key=${s} value=${s}>${SEG_TH_OF(s)}</option>`)}</select>`
              :k==="type"?html`<select class=${"dm-input"+(err?" err":"")} value=${vals[k]} onChange=${e=>set(k,e.target.value)}>
                  <option value="">— เลือก —</option><option value="Existing">ลูกค้า</option><option value="Prospect">Lead</option></select>`
              :k==="province"?html`<select class=${"dm-input"+(err?" err":"")} value=${vals[k]} onChange=${e=>set(k,e.target.value)}>
                  <option value="">— เลือก —</option>${PROV_TH.map(p=>html`<option key=${p} value=${p}>${provinceTH(p)}</option>`)}</select>`
              :html`<input class=${"dm-input"+(err?" err":"")} value=${vals[k]} onInput=${e=>set(k,e.target.value)}/>`}
              ${err?html`<div class="dm-erd-err"><${Icon} name="gap" size=${12}/> ${err}${swap?html` <button class="dm-swap" onClick=${swapLatLng}>สลับค่า lat/lng</button>`:""}</div>`:""}
            </div>`; })}
          </div>`}
      </div>
      <div class="dm-erd-foot">
        ${isDup
          ? html`<${Btn} variant="ghost" onClick=${onSkip}>ข้ามแถวนี้</${Btn}>
              <${Btn} variant="outline" onClick=${onNew}>ถือเป็นรายการใหม่</${Btn}>
              <${Btn} variant="primary" icon="check" onClick=${()=>onMerge(pick)}>รวมกับข้อมูลเดิม</${Btn}>`
          : html`<${Btn} variant="ghost" onClick=${onClose}>ยกเลิก</${Btn}>
              <${Btn} variant="ghost" onClick=${onSkip}>ข้ามแถวนี้</${Btn}>
              <${Btn} variant="primary" icon="check" onClick=${()=>onSave(vals)}>บันทึกและนำเข้าแถวนี้</${Btn}>`}
      </div>
    </div>
  </div>`;
  return (typeof document!=="undefined")?createPortal(node,document.body):node;
}

/* ═══════════════════ แท็บ 1: นำเข้าไฟล์ Excel (Wizard 4 ขั้น) ═══════════════════ */
// resumeFile: เมื่อกด "จัดการรายการค้าง" จากแท็บจัดการไฟล์ → เปิด wizard ที่ขั้นตอนที่ 3 ของไฟล์นั้น
function ImportWizard({resumeFile, staging, setStaging, onExitResume}={}){
  const [step,setStep]=useState(1);
  const [file,setFile]=useState(null);
  const [fileErr,setFileErr]=useState("");
  const [mapping,setMapping]=useState(()=>Object.fromEntries(FILE_COLS.map(c=>[c.col,c.auto])));
  const [saveTpl,setSaveTpl]=useState(true);
  const [tplBanner,setTplBanner]=useState(true);   // แบนเนอร์ "พบผังการจับคู่เดิม"
  const [valFilter,setValFilter]=useState("all");
  const [valPage,setValPage]=useState(1);
  const [valRows,setValRows]=useState(VAL_ROWS);   // สถานะแถวตรวจสอบ (แก้ได้ → อัปเดตสรุป)
  const [editRow,setEditRow]=useState(null);       // แถวที่กำลังแก้ไข (เปิด drawer)
  const [importing,setImporting]=useState(false);
  const [pct,setPct]=useState(0);
  const [done,setDone]=useState(false);
  const patchVal=(row,p)=>setValRows(rs=>rs.map(x=>x.row===row?{...x,...p}:x));

  const OK_EXT=[".xlsx",".xls",".csv"];
  const pickFile=()=>{ // จำลองการเลือกไฟล์ (ไม่มี backend) — สุ่มไฟล์ตัวอย่างที่ถูกชนิด
    setFileErr(""); setFile({ name:"ลูกค้าใหม่_กรกฎาคม.xlsx", size:1863000, rows:300, cols:FILE_COLS.length }); };
  const pickBad=()=>{ setFile(null); setFileErr("ไฟล์ .pdf ไม่รองรับ — ใช้ได้เฉพาะ .xlsx, .xls, .csv"); };

  const reqUnmapped = SYS_FIELDS.filter(f=>f.req).filter(f=> !Object.values(mapping).includes(f.k));
  const dupMap = Object.values(mapping).filter(v=>v!=="__skip").filter((v,i,a)=>a.indexOf(v)!==i);

  const counts = valRows.reduce((a,r)=>{ a[r.issue]=(a[r.issue]||0)+1; return a; },{});
  const valList = valRows.filter(r=> valFilter==="all"||r.issue===valFilter);
  const PAGE=10; const totalPages=Math.max(1,Math.ceil(valList.length/PAGE));
  const pageRows=valList.slice((valPage-1)*PAGE, valPage*PAGE);

  const runImport=()=>{ setImporting(true); setPct(0);
    const t=setInterval(()=>{ setPct(p=>{ if(p>=100){ clearInterval(t); setImporting(false); setDone(true);
      const okN=counts.ok||0; pushAudit({action:"นำเข้าไฟล์ Excel", category:"นำเข้า", detail:`${file?file.name:"ไฟล์"} · สำเร็จ ${okN} รายการ`});
      toast(`นำเข้าข้อมูลสำเร็จ ${okN} รายการ`,"good"); return 100; } return p+8; }); },90); };

  const STEPS=[[1,"เลือกไฟล์"],[2,"จับคู่คอลัมน์"],[3,"ตรวจสอบข้อมูล"],[4,"ยืนยันและนำเข้า"]];

  // ── โหมด "จัดการรายการค้าง" — ทำงานต่อจากขั้นตอนที่ 3 ของไฟล์ที่เลือก (กรองเฉพาะแถวที่ยังไม่ตัดสินใจ) ──
  if(resumeFile){
    const s=fileStats(resumeFile, staging);
    return html`<div>
      <div class="dm-resume-bar">
        <div><b>จัดการรายการค้าง · ${resumeFile.file}</b>
          <div class="dim" style=${{fontSize:"12px",marginTop:"2px"}}>ทำงานต่อจากขั้นตอนที่ 3 ของการนำเข้า · แสดงเฉพาะแถวที่ยังไม่ได้ตัดสินใจ (เหลือ ${num(s.pending)} รายการ)</div></div>
        <${Btn} size="sm" variant="ghost" onClick=${onExitResume}>← กลับไปจัดการไฟล์นำเข้า</${Btn}>
      </div>
      <div class="dm-stepper">
        ${STEPS.map(([n,l])=>html`<div key=${n} class=${"dm-step"+(n===3?" on":n<3?" done":"")}>
          <span class="dm-step-no">${n<3?"✓":n}</span><span>${l}</span></div>`)}
      </div>
      <${TriageReview} fileId=${resumeFile.id} staging=${staging} setStaging=${setStaging}/>
    </div>`;
  }

  return html`<div>
    <!-- stepper -->
    <div class="dm-stepper">
      ${STEPS.map(([n,l])=>html`<div key=${n} class=${"dm-step"+(step===n?" on":step>n?" done":"")}>
        <span class="dm-step-no">${step>n?"✓":n}</span><span>${l}</span></div>`)}
    </div>

    ${step===1 ? html`<div>
      <div class=${"dm-drop"+(fileErr?" err":"")} onClick=${pickFile}>
        <${Icon} name="upload" size=${30} color="var(--muted)"/>
        <div style=${{fontWeight:700,marginTop:"8px"}}>ลากไฟล์มาวาง หรือคลิกเพื่อเลือกไฟล์</div>
        <div class="dim" style=${{fontSize:"12.5px",marginTop:"4px"}}>รองรับ .xlsx, .xls, .csv · ไม่เกิน 25 MB ต่อไฟล์</div>
        ${fileErr?html`<div class="dm-fileerr">${fileErr}</div>`:""}
      </div>
      <div class="row" style=${{gap:"10px",marginTop:"10px",flexWrap:"wrap"}}>
        <${Btn} variant="outline" size="sm" icon="download" onClick=${()=>toast("กำลังดาวน์โหลดไฟล์ตัวอย่าง (Template)","info")}>ดาวน์โหลดไฟล์ตัวอย่าง (Template)</${Btn}>
        <${Btn} variant="ghost" size="sm" onClick=${pickBad}>ทดสอบไฟล์ผิดชนิด</${Btn}>
      </div>
      ${file?html`<div class="dm-filecard">
        <${Icon} name="reports" size=${22} color="var(--accent)"/>
        <div style=${{flex:1,minWidth:0}}><b>${file.name}</b>
          <div class="dim" style=${{fontSize:"12px"}}>${fmtBytes(file.size)} · ${num(file.rows)} แถว · ${file.cols} คอลัมน์</div></div>
        <button class="icon-btn" onClick=${()=>setFile(null)} aria-label="ลบไฟล์"><${Icon} name="trash" size=${15}/></button>
      </div>`:""}
    </div>` : ""}

    ${step===2 ? html`<div>
      ${tplBanner?html`<div class="dm-alert" style=${{marginBottom:"12px",justifyContent:"space-between",flexWrap:"wrap",gap:"10px"}}>
        <span class="row" style=${{gap:"8px"}}><${Icon} name="check" size=${15} color="var(--good)"/> พบผังการจับคู่เดิมที่ตรงกับรูปแบบไฟล์นี้: <b>ผังมาตรฐาน Barter</b></span>
        <span class="row" style=${{gap:"8px"}}>
          <${Btn} size="sm" variant="outline" onClick=${()=>{setMapping(Object.fromEntries(FILE_COLS.map(c=>[c.col,c.auto])));setTplBanner(false);toast("ใช้ผังการจับคู่เดิมแล้ว","good");}}>ใช้เลย</${Btn}>
          <${Btn} size="sm" variant="ghost" onClick=${()=>{setMapping(Object.fromEntries(FILE_COLS.map(c=>[c.col,"__skip"])));setTplBanner(false);}}>จับคู่ใหม่</${Btn}></span></div>`:""}
      <div class="dim" style=${{fontSize:"12.5px",marginBottom:"12px"}}>ระบบจับคู่คอลัมน์อัตโนมัติแล้ว — ตรวจและแก้ไขได้ · ช่องที่มี <span class="dm-auto">จับคู่อัตโนมัติ</span> คือระบบเดาให้ · ดูตัวอย่างค่าจริงก่อนยืนยันได้</div>
      <${Table} cols=${[
        {h:"คอลัมน์ในไฟล์", render:r=>html`<div><b>${r.col}</b>
          <div class="dim" style=${{fontSize:"11px",marginTop:"2px"}}>ตัวอย่าง: ${r.sample.slice(0,3).join(" · ")}</div></div>`},
        {h:"จับคู่กับฟิลด์ในระบบ", render:r=>{ const w=mapWarn(mapping[r.col], r.sample);
          return html`<div style=${{display:"flex",flexDirection:"column",gap:"6px"}}>
            <div class="row" style=${{gap:"8px"}}>
              <select class="dm-sel" value=${mapping[r.col]} onChange=${e=>setMapping(m=>({...m,[r.col]:e.target.value}))}>
                ${SYS_FIELDS.map(f=>html`<option key=${f.k} value=${f.k}>${f.label}${f.req?" *":""}</option>`)}</select>
              ${mapping[r.col]===r.auto&&r.auto!=="__skip"?html`<span class="dm-auto">จับคู่อัตโนมัติ</span>`:""}</div>
            ${w?html`<div class="dm-alert warn" style=${{marginTop:0,padding:"7px 10px"}}><${Icon} name="gap" size=${14}/> ${w}</div>`:""}</div>`; }},
      ]} rows=${FILE_COLS}/>
      ${reqUnmapped.length?html`<div class="dm-alert bad"><${Icon} name="gap" size=${15}/> ยังไม่ได้จับคู่ฟิลด์ที่จำเป็น: <b>${reqUnmapped.map(f=>f.label).join(", ")}</b></div>`:""}
      ${dupMap.length?html`<div class="dm-alert warn"><${Icon} name="gap" size=${15}/> มีฟิลด์ถูกจับคู่ซ้ำ — แต่ละฟิลด์ควรจับคู่คอลัมน์เดียว</div>`:""}

      <!-- ตัวอย่างข้อมูลรวม: เห็นภาพว่าข้อมูลจะหน้าตาเป็นอย่างไรหลังนำเข้า -->
      ${(()=>{ const mc=FILE_COLS.filter(c=>mapping[c.col]&&mapping[c.col]!=="__skip");
        if(!mc.length) return "";
        return html`<div class="dm-preview">
          <div class="dm-preview-h">ตัวอย่างข้อมูลที่จะเข้าระบบ (3 แถวแรก)</div>
          <div class="dm-preview-scroll"><table class="dm-preview-tbl">
            <thead><tr>${mc.map(c=>html`<th key=${c.col}>${(SYS_FIELDS.find(f=>f.k===mapping[c.col])||{}).label||mapping[c.col]}</th>`)}</tr></thead>
            <tbody>${[0,1,2].map(i=>html`<tr key=${i}>${mc.map(c=>html`<td key=${c.col}>${c.sample[i]||"—"}</td>`)}</tr>`)}</tbody>
          </table></div></div>`; })()}

      <label class="dm-check"><input type="checkbox" checked=${saveTpl} onChange=${e=>setSaveTpl(e.target.checked)}/> จำรูปแบบการจับคู่นี้ไว้เป็นผังสำหรับครั้งถัดไป</label>
    </div>` : ""}

    ${step===3 ? html`<div>
      <div class="grid g4" style=${{marginBottom:"14px"}}>
        <${Kpi} label="ผ่าน" value=${counts.ok||0} icon="check"/>
        <${Kpi} label="ข้อมูลไม่ครบ" value=${counts.incomplete||0} icon="gap"/>
        <${Kpi} label="พิกัดผิดพลาด" value=${counts.badcoord||0} icon="pin"/>
        <${Kpi} label="ซ้ำกับข้อมูลเดิม" value=${counts.dup||0} icon="users"/>
      </div>
      <div class="row" style=${{gap:"8px",marginBottom:"10px",flexWrap:"wrap"}}>
        ${[["all","ทั้งหมด"],["ok","ผ่าน"],["incomplete","ไม่ครบ"],["badcoord","พิกัดผิด"],["dup","ซ้ำ"]].map(([v,l])=>
          html`<button key=${v} class=${"dm-chip"+(valFilter===v?" on":"")} onClick=${()=>{setValFilter(v);setValPage(1);}}>${l}</button>`)}
      </div>
      <${Table} cols=${[
        {h:"แถวที่", render:r=>r.row},
        {h:"ชื่อธุรกิจ", render:r=>r.name||html`<span class="dim">(ไม่มีชื่อ)</span>`},
        {h:"จังหวัดที่พบ", render:r=>r.province?provinceTH(r.province):html`<span class="dim">—</span>`},
        {h:"สถานะ", render:r=>{ const m=r.edited?ISSUE_META.edited:ISSUE_META[r.issue]; return html`<${Badge} tone=${m.tone}>${m.label}</${Badge}>`; }},
        {h:"การจัดการ", render:r=> (r.issue==="ok"||r.issue==="skipped") ? html`<span class="dim">—</span>` :
          html`<div class="row" style=${{gap:"6px"}}>
            <${Btn} size="sm" variant="outline" onClick=${()=>setEditRow(r)}>แก้ไข</${Btn}>
            <${Btn} size="sm" variant="ghost" onClick=${()=>{ patchVal(r.row,{issue:"skipped",edited:false}); toast("ข้ามแถวนี้แล้ว","warn"); }}>ข้ามแถวนี้</${Btn}></div>`},
      ]} rows=${pageRows}/>
      ${totalPages>1?html`<div class="dm-pager"><span class="dim">แสดง ${(valPage-1)*PAGE+1}–${Math.min(valPage*PAGE,valList.length)} จาก ${valList.length} แถว</span>
        <div class="row" style=${{gap:"5px"}}>${Array.from({length:totalPages},(_,i)=>i+1).map(p=>html`<button key=${p} class=${"dm-pg"+(p===valPage?" on":"")} onClick=${()=>setValPage(p)}>${p}</button>`)}</div></div>`:""}

      ${editRow?html`<${EditRowDrawer} row=${editRow} onClose=${()=>setEditRow(null)}
        onSave=${vals=>{ patchVal(editRow.row,{...vals,issue:"ok",edited:true}); setEditRow(null);
          pushAudit({action:"แก้ไขและนำเข้าแถว (ตรวจสอบข้อมูล)", category:"แก้ไข", detail:`${vals.name||editRow.name} (แถว ${editRow.row})`});
          toast("บันทึกและนำเข้าแถวนี้แล้ว","good"); }}
        onSkip=${()=>{ patchVal(editRow.row,{issue:"skipped",edited:false}); setEditRow(null); toast("ข้ามแถวนี้แล้ว","warn"); }}
        onMerge=${()=>{ patchVal(editRow.row,{issue:"ok",edited:true}); setEditRow(null);
          pushAudit({action:"รวมกับข้อมูลเดิม (ตรวจสอบข้อมูล)", category:"แก้ไข", detail:`${editRow.name} → คงรหัส ${editRow.match?editRow.match.id:"-"}`});
          toast("รวมกับข้อมูลเดิมแล้ว — คงรหัสเดิม","good"); }}
        onNew=${()=>{ patchVal(editRow.row,{issue:"ok",edited:true}); setEditRow(null); toast("ถือเป็นรายการใหม่แล้ว","good"); }}/>`:""}
    </div>` : ""}

    ${step===4 ? html`<div>
      ${!done?html`<div>
        <div class="dm-summary">
          <div><span class="dim">ไฟล์</span><b>${file?file.name:"—"}</b></div>
          <div><span class="dim">จะนำเข้า</span><b style=${{color:"var(--good)"}}>${counts.ok||0} รายการ</b></div>
          <div><span class="dim">ข้าม (ไม่ครบ/พิกัดผิด)</span><b>${(counts.incomplete||0)+(counts.badcoord||0)} รายการ</b></div>
          <div><span class="dim">รอตรวจ (ซ้ำ)</span><b style=${{color:"var(--warn)"}}>${counts.dup||0} รายการ</b></div>
        </div>
        ${((counts.dup||0)+(counts.incomplete||0)+(counts.badcoord||0))>0?html`<div class="dm-alert warn"><${Icon} name="gap" size=${15}/> มี ${(counts.dup||0)+(counts.incomplete||0)+(counts.badcoord||0)} รายการที่มีปัญหา — จะถูกพักไว้เป็น "รายการค้าง" ในแท็บ "จัดการไฟล์นำเข้า" โดยยังไม่เข้าระบบและไม่ถูกลบทิ้ง (จัดการต่อได้จากปุ่ม "จัดการรายการค้าง")</div>`:""}
        ${importing?html`<div style=${{marginTop:"16px"}}><div class="row between" style=${{fontSize:"12.5px",marginBottom:"6px"}}><span>กำลังนำเข้า…</span><b>${pct}%</b></div><${Meter} value=${pct} height=${10}/></div>`
          :html`<div style=${{marginTop:"16px"}}><${Btn} variant="outline" icon="check" onClick=${runImport}>ยืนยันนำเข้า ${counts.ok||0} รายการ</${Btn}></div>`}
      </div>`:html`<div class="dm-result">
        <div class="dm-result-ic"><${Icon} name="check" size=${34} color="var(--good)"/></div>
        <h3 style=${{margin:"10px 0 4px"}}>นำเข้าข้อมูลเรียบร้อย</h3>
        <div class="dim">สำเร็จ ${counts.ok||0} · รอตรวจสอบ (ซ้ำ) ${counts.dup||0} · ข้าม ${(counts.incomplete||0)+(counts.badcoord||0)}</div>
        <div class="row" style=${{gap:"10px",marginTop:"16px",justifyContent:"center"}}>
          <${Btn} variant="outline" onClick=${()=>toast("ไปที่รายการข้อมูลที่นำเข้า","info")}>ดูข้อมูลที่นำเข้า</${Btn}>
          <${Btn} variant="ghost" onClick=${()=>{setStep(1);setFile(null);setDone(false);setPct(0);}}>นำเข้าไฟล์ใหม่</${Btn}></div>
      </div>`}
    </div>` : ""}

    <!-- ปุ่มนำทาง wizard -->
    ${!done?html`<div class="dm-wiznav">
      <${Btn} variant="ghost" disabled=${step===1} onClick=${()=>setStep(s=>Math.max(1,s-1))}>ย้อนกลับ</${Btn}>
      ${step<4?html`<${Btn} variant="outline" disabled=${(step===1&&!file)||(step===2&&(reqUnmapped.length>0||dupMap.length>0))}
        onClick=${()=>setStep(s=>s+1)}>ถัดไป</${Btn}>`:""}
    </div>`:""}
  </div>`;
}

/* ═══════════════════ แท็บ 2: จัดการไฟล์นำเข้า ═══════════════════ */
function ImportFiles({staging, onManagePending}){
  const [rows,setRows]=useState(IMPORTS);
  const [q,setQ]=useState(""); const [f,setF]=useState("all"); const [page,setPage]=useState(1);
  const [drawer,setDrawer]=useState(null); const [rollback,setRollback]=useState(null);
  const [confirmTxt,setConfirmTxt]=useState("");
  // แนบสถิติผลการนำเข้าต่อไฟล์ (เข้าระบบ/ค้าง/ข้าม/วันค้าง) — ไม่ลบชุดที่ถอนแล้ว แค่ซ่อนด้วย withdrawn
  const withStats=rows.filter(r=>!r.withdrawn).map(r=>({...r, s:fileStats(r,staging)}));
  const matchF=r=> f==="all" ? true : f==="pending" ? r.s.hasPending : !r.s.hasPending;
  const filtered=withStats.filter(r=>matchF(r)&&(!q||r.file.includes(q)))
    // ไฟล์ที่มีของค้างขึ้นก่อน · ค้างนานที่สุดอยู่บนสุด · ที่เหลือเรียงวันที่ใหม่→เก่า
    .sort((a,b)=> (b.s.hasPending?1:0)-(a.s.hasPending?1:0) || (b.s.days-a.s.days) || (a.dt<b.dt?1:-1));
  const PAGE=10; const totalPages=Math.max(1,Math.ceil(filtered.length/PAGE)); const pageRows=filtered.slice((page-1)*PAGE,page*PAGE);
  // สรุปบรรทัดเดียว
  const pendFiles=withStats.filter(r=>r.s.hasPending);
  const canRollback=b=> b.done>0 && daysSince(b.dt)<=7;   // ยกเลิกได้เฉพาะชุดที่นำเข้าไม่เกิน 7 วัน
  const openRollback=b=>{ setConfirmTxt(""); setRollback(b); };
  const doRollback=b=>{ const withdrawn=Math.max(0,b.done-b.visited);   // รายการที่เข้าพบแล้วไม่ถูกถอน
    setRows(rs=>rs.map(x=>x.id===b.id?{...x,withdrawn:true,status:"ถอนออกแล้ว"}:x)); setRollback(null); setDrawer(null);
    pushAudit({action:"ยกเลิกการนำเข้าทั้งชุด (Rollback)", category:"ลบ",
      detail:`${b.file} · ถอน ${withdrawn} รายการ · คงไว้ ${b.visited} รายการที่เข้าพบแล้ว (ทำเครื่องหมายให้ตรวจสอบ)`});
    toast(`ถอนการนำเข้า ${b.file} แล้ว — คงรายการที่เข้าพบแล้วไว้ ${b.visited} รายการ`,"warn"); };
  const impCell=s=>html`<span class="dm-imp"><span class="dm-imp-ok">เข้าระบบ ${num(s.imported)}</span> · <span class=${"dm-imp-pend"+(s.pending?"":" zero")}>ค้าง ${num(s.pending)}</span> · <span class="dm-imp-skip">ข้าม ${num(s.skipped)}</span></span>`;
  const statCell=s=> s.hasPending
    ? html`<div class="dm-fstat"><${Badge} tone="warn">มีรายการค้าง</${Badge}><span class=${"dm-fdays"+(s.days>7?" warn":"")}>ค้างมา ${s.days} วัน</span></div>`
    : html`<${Badge} tone="good">เสร็จสมบูรณ์</${Badge}>`;
  return html`<div>
    <div class="dm-toolbar">
      <input class="dm-input" placeholder="ค้นหาชื่อไฟล์…" value=${q} onInput=${e=>{setQ(e.target.value);setPage(1);}}/>
      <div class="row" style=${{gap:"6px"}}>
        ${[["all","ทั้งหมด"],["pending","มีรายการค้าง"],["done","เสร็จสมบูรณ์"]].map(([v,l])=>
          html`<button key=${v} class=${"dm-chip"+(f===v?" on":"")} onClick=${()=>{setF(v);setPage(1);}}>${l}</button>`)}
      </div>
    </div>
    <${Table} empty="ไม่พบไฟล์นำเข้า" cols=${[
      {h:"ชื่อไฟล์", render:r=>html`<button class="dm-link" onClick=${()=>setDrawer(r)}>${r.file}</button>`},
      {h:"วันที่/เวลา", render:r=>beDate(r.dt,true)},
      {h:"ผู้อัปโหลด", render:r=>r.by},
      {h:"ผลการนำเข้า", render:r=>impCell(r.s)},
      {h:"สถานะ", render:r=>statCell(r.s)},
      {h:"การจัดการ", render:r=>html`<div class="row" style=${{gap:"6px"}}>
        <${Btn} size="sm" variant="ghost" onClick=${()=>setDrawer(r)}>รายละเอียด</${Btn}>
        ${r.s.hasPending?html`<${Btn} size="sm" variant="outline" onClick=${()=>onManagePending&&onManagePending(r.id)}>จัดการรายการค้าง</${Btn}>`:""}
        ${r.done>0?html`<${Btn} size="sm" variant="ghost" disabled=${!canRollback(r)}
          title=${canRollback(r)?"":"ยกเลิกได้เฉพาะชุดที่นำเข้าไม่เกิน 7 วัน"}
          onClick=${()=>openRollback(r)}>ยกเลิกการนำเข้าชุดนี้</${Btn}>`:""}</div>`},
    ]} rows=${pageRows}/>
    ${totalPages>1?html`<div class="dm-pager"><span class="dim">แสดง ${(page-1)*PAGE+1}–${Math.min(page*PAGE,filtered.length)} จาก ${filtered.length} ไฟล์</span>
      <div class="row" style=${{gap:"5px"}}>${Array.from({length:totalPages},(_,i)=>i+1).map(p=>html`<button key=${p} class=${"dm-pg"+(p===page?" on":"")} onClick=${()=>setPage(p)}>${p}</button>`)}</div></div>`:""}

    ${drawer?html`<${Modal} title=${drawer.file} onClose=${()=>setDrawer(null)}>
        <div class="dm-kv"><span>สถานะ</span>${statCell(drawer.s)}</div>
        <div class="dm-kv"><span>วันที่/เวลา</span><b>${beDate(drawer.dt,true)}</b></div>
        <div class="dm-kv"><span>ผู้อัปโหลด</span><b>${drawer.by}</b></div>
        <div class="dm-kv"><span>ผังการจับคู่</span><b>${drawer.template}</b></div>
        <div class="dm-kv"><span>เข้าระบบแล้ว</span><b style=${{color:"var(--good)"}}>${num(drawer.s.imported)} รายการ</b></div>
        <div class="dm-kv"><span>ค้างรอจัดการ</span><b style=${{color:drawer.s.pending?"#b45309":"var(--muted)"}}>${num(drawer.s.pending)} รายการ</b></div>
        <div class="dm-kv"><span>ข้าม (เก็บอ้างอิง)</span><b>${num(drawer.s.skipped)} รายการ</b></div>
        ${drawer.s.hasPending?html`<${Btn} variant="primary" style=${{marginTop:"14px"}} onClick=${()=>{setDrawer(null);onManagePending&&onManagePending(drawer.id);}}>จัดการรายการค้าง ${num(drawer.s.pending)} รายการ</${Btn}>`:""}
        ${drawer.done>0?html`<${Btn} variant="outline" icon="trash" disabled=${!canRollback(drawer)} style=${{marginTop:"10px"}}
          onClick=${()=>openRollback(drawer)}>ยกเลิกการนำเข้าชุดนี้</${Btn}>
          ${!canRollback(drawer)?html`<div class="dm-caption" style=${{marginTop:"8px"}}>ยกเลิกได้เฉพาะชุดที่นำเข้าไม่เกิน 7 วัน (ชุดนี้ผ่านมา ${Math.round(daysSince(drawer.dt))} วัน)</div>`:""}`:""}
      </${Modal}>`:""}

    ${rollback?html`<${Modal} title="ยกเลิกการนำเข้าทั้งชุด" onClose=${()=>setRollback(null)}
      footer=${html`<div class="row" style=${{gap:"10px",justifyContent:"flex-end"}}>
        <${Btn} variant="ghost" onClick=${()=>setRollback(null)}>ยกเลิก</${Btn}>
        <${Btn} variant="danger" disabled=${confirmTxt.trim()!=="ยืนยัน"} onClick=${()=>doRollback(rollback)}>ถอนการนำเข้า</${Btn}></div>`}>
      <p>ยกเลิกการนำเข้าจากไฟล์ <b>${rollback.file}</b></p>
      <ul class="dm-impact">
        <li>จะถอนรายการที่นำเข้าจากไฟล์นี้ <b>${num(Math.max(0,rollback.done-rollback.visited))} รายการ</b></li>
        <li>ในจำนวนนี้มี <b>${num(rollback.editedAfter)} รายการ</b>ที่ถูกแก้ไขหลังนำเข้า และ <b>${num(rollback.visited)} รายการ</b>ที่มีการเข้าพบแล้ว</li>
        <li>รายการที่มีการเข้าพบแล้ว <b>จะไม่ถูกถอน</b> แต่จะถูกทำเครื่องหมายให้ตรวจสอบ</li>
      </ul>
      <div class="dm-alert warn"><${Icon} name="gap" size=${15}/> ข้อมูลไม่ถูกลบถาวร — ชุดนี้จะเปลี่ยนสถานะเป็น "ถอนออกแล้ว" และซ่อนจากทุกหน้าจอ · บันทึกลงบันทึกการตรวจสอบ</div>
      <label class="dm-frm-f" style=${{marginTop:"12px"}}>
        <span class="dm-frm-lb">พิมพ์คำว่า "ยืนยัน" เพื่อดำเนินการต่อ</span>
        <input class="dm-input" value=${confirmTxt} onInput=${e=>setConfirmTxt(e.target.value)} placeholder="ยืนยัน"/></label>
    </${Modal}>`:""}
  </div>`;
}

/* ═══════════════════ จัดการรายการค้าง (Data Quality Triage) — ใช้ในโหมด resume ของ wizard ต่อไฟล์ ═══════════════════
   คิว "รอแก้ไข" — แถวที่มีปัญหาจะพักไว้ที่นี่ ไม่เข้าระบบอัตโนมัติและไม่ถูกลบทิ้ง
   ผู้ดูแลตรวจทีละรายการ (ไม่ครบ / อาจซ้ำ / พิกัดผิด) แล้วเลือก แก้ไขนำเข้า · รวมกับรายการเดิม · หรือข้าม
   กติกา: "ข้าม" = เก็บไว้เป็นประวัติ (สถานะ skipped) ไม่ลบข้อมูลดิบ · ทุกการตัดสินใจบันทึกลง Audit Log */
const FLD_TH={ name:"ชื่อธุรกิจ", address:"ที่อยู่", province:"จังหวัด", segment:"หมวดหมู่ธุรกิจ",
  lat:"ละติจูด", lng:"ลองจิจูด", location:"พิกัด", phone:"เบอร์โทร", email:"อีเมล", type:"ประเภท" };
const KIND_META={ incomplete:{label:"ข้อมูลไม่ครบ",tone:"warn"}, dup:{label:"อาจซ้ำ",tone:"neutral"}, badcoord:{label:"พิกัดผิด",tone:"bad"} };
const issueSummary = r => r.issues.map(i=>{
  if(i.type==="missing_required") return "ขาด"+(FLD_TH[i.field]||i.field);
  if(i.type==="missing_optional") return "ไม่มี"+(FLD_TH[i.field]||i.field);
  if(i.type==="invalid_coordinate") return i.detail||"พิกัดไม่ถูกต้อง";
  if(i.type==="duplicate") return "อาจซ้ำกับรายการเดิม ("+Math.round(i.similarity*100)+"%)";
  if(i.type==="unknown_value") return (FLD_TH[i.field]||i.field)+"ไม่รู้จัก";
  return i.type; }).join(" · ");
// ป้ายความรุนแรงเป็นภาษาไทย (ไม่ใช้คำอังกฤษ error/warning ใน UI)
const SEV_TH={ error:"ต้องแก้ก่อน", warning:"ควรตรวจสอบ" };
// จัดกลุ่มแถวรอแก้ไขตาม "ชนิดปัญหา + ค่าเจาะจง" — กลุ่มที่จัดการทั้งกลุ่มได้ (kind bulk/seg) แยกจากกลุ่มที่ต้องดูทีละรายการ (view)
//  bulk = ขาดฟิลด์เสริม (นำเข้าทั้งกลุ่มได้) · seg = หมวดธุรกิจไม่รู้จัก (เลือกหมวดแล้วใช้ทั้งกลุ่ม) · view = error/ซ้ำ (ต้องดูทีละรายการ)
// จุดกึ่งกลางจังหวัดโดยประมาณ — ใช้ตอนเติมพิกัดใหม่ให้แถวที่พิกัดเสีย (ไม่ได้ดึงจากภายนอก แค่เดาจากจังหวัด)
const PROV_CENTER={ "Bangkok Metropolis":[13.7563,100.5018], "Chiang Mai":[18.7883,98.9853],
  "Phuket":[7.8804,98.3923], "Chon Buri":[13.3611,100.9847] };

/* ---- ป็อปอัพรวมรายการซ้ำ: เลือกค่าทีละช่องระหว่าง "นำเข้าใหม่" กับ "รายการเดิม" ---- */
function DupMergeModal({row, onClose, onSave}){
  const F=[["name","ชื่อธุรกิจ"],["address","ที่อยู่"],["phone","เบอร์โทร"],["segment","หมวดหมู่"],["province","จังหวัด"],["lat","ละติจูด"],["lng","ลองจิจูด"]];
  const [pick,setPick]=useState(()=>Object.fromEntries(F.map(([k])=> [k, String(row.raw[k])!==String(row.match[k]) ? "match" : "raw"])));
  const save=()=>{ const merged={...row.match}; F.forEach(([k])=>{ merged[k]= pick[k]==="raw" ? row.raw[k] : row.match[k]; }); onSave(merged); };
  return html`<${Modal} wide=${true} title="รวมเป็นรายการเดียว — เลือกค่าทีละช่อง" onClose=${onClose}
    footer=${html`<div class="row" style=${{gap:"10px",justifyContent:"flex-end"}}>
      <${Btn} variant="ghost" onClick=${onClose}>ยกเลิก</${Btn}>
      <${Btn} variant="outline" onClick=${save}>บันทึกรายการที่รวมแล้ว</${Btn}></div>`}>
    <div class="dm-cf-cols" style=${{marginBottom:"8px"}}>
      <div class="dm-cf-lb"></div><span class="dm-src file">นำเข้าใหม่</span><span class="dm-src tc">รายการเดิมในระบบ (${row.match.id})</span></div>
    ${F.map(([k,l])=>{ const diff=String(row.raw[k])!==String(row.match[k]);
      return html`<div key=${k} class=${"dm-merge-row"+(diff?" diff":"")}>
      <div class="dm-cf-lb">${l}</div>
      <label class="dm-radio"><input type="radio" name=${"mg"+k} checked=${pick[k]==="raw"} onChange=${()=>setPick(p=>({...p,[k]:"raw"}))}/> ${row.raw[k]||"—"} <span class="dim">(ใหม่)</span></label>
      <label class="dm-radio"><input type="radio" name=${"mg"+k} checked=${pick[k]==="match"} onChange=${()=>setPick(p=>({...p,[k]:"match"}))}/> ${row.match[k]||"—"} <span class="dim">(เดิม)</span></label>
    </div>`;})}
  </${Modal}>`;
}

/* ---- Drawer ตรวจสอบรายแถว — แยก 3 กรณีตามชนิดปัญหา ---- */
function ReviewDrawer({row, onImport, onSkip, onMerge, onClose}){
  const r=row;
  const [form,setForm]=useState(()=>({...r.raw}));
  const [mergeOpen,setMergeOpen]=useState(false);
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const segKnown = SEGMENTS.includes(form.segment);
  const REQ=["name","province","segment","type","lat","lng"];
  const isMiss = k => k==="segment" ? !segKnown : (form[k]===""||form[k]==null);
  const missReq = REQ.filter(isMiss);
  const coordOK = validCoord(Number(form.lat),Number(form.lng));
  const canImport = missReq.length===0 && coordOK;
  const fillFromProvince=()=>{ const c=PROV_CENTER[form.province]||[13.7563,100.5018];
    // เพิ่ม jitter เล็กน้อยไม่ให้ทับกันเป๊ะ (ยังอยู่ในเขตจังหวัด)
    set("lat",+(c[0]+(row.row%9-4)*0.002).toFixed(4)); set("lng",+(c[1]+(row.row%7-3)*0.002).toFixed(4)); };
  const inp = (k,label,type)=>html`<label class="dm-frm-f">
    <span class="dm-frm-lb">${label}${REQ.includes(k)?html` <b style=${{color:"var(--bad)"}}>*</b>`:""}</span>
    <input class=${"dm-input"+(REQ.includes(k)&&isMiss(k)?" miss":"")} type=${type||"text"} value=${form[k]==null?"":form[k]}
      onInput=${e=>set(k, type==="number"? (e.target.value===""?"":+e.target.value) : e.target.value)}/></label>`;

  return html`<${Modal} wide=${r.kind==="dup"} title=${"ตรวจสอบแถวที่ "+r.row} onClose=${onClose}>
    <div>
      <div class="row" style=${{gap:"6px",marginBottom:"12px",flexWrap:"wrap"}}>
        <${Badge} tone=${KIND_META[r.kind].tone}>${KIND_META[r.kind].label}</${Badge}>
        <${Badge} tone=${rowSeverity(r)==="error"?"bad":"warn"}>${rowSeverity(r)==="error"?"ต้องแก้ก่อนนำเข้า":"ควรตรวจสอบก่อนนำเข้า"}</${Badge}></div>
      <div class="dm-issue-box">${r.issues.map((i,idx)=>html`<div key=${idx}>• ${issueSummary({issues:[i]})}</div>`)}</div>

      ${r.kind==="dup" ? html`<div>
        <div class="dim" style=${{fontSize:"12px",margin:"12px 0 8px"}}>เทียบข้อมูลนำเข้าใหม่กับรายการที่มีอยู่แล้ว · ความคล้าย <b>${Math.round(r.similarity*100)}%</b></div>
        <div class="dm-cf-cols" style=${{marginBottom:"4px"}}><div class="dm-cf-lb"></div>
          <span class="dm-src file">นำเข้าใหม่</span><span class="dm-src tc">เดิม (${r.match.id})</span></div>
        ${[["name","ชื่อธุรกิจ"],["address","ที่อยู่"],["phone","เบอร์โทร"],["segment","หมวดหมู่"],["lat","ละติจูด"],["lng","ลองจิจูด"]].map(([k,l])=>{
          const diff=String(r.raw[k])!==String(r.match[k]);
          return html`<div key=${k} class=${"dm-cf-row"+(diff?" diff":"")}><div class="dm-cf-lb">${l}</div>
            <div>${r.raw[k]||"—"}</div><div>${r.match[k]||"—"}</div></div>`;})}
        <div class="dm-drawer-act">
          <${Btn} size="sm" variant="outline" onClick=${()=>setMergeOpen(true)}>รวมเป็นรายการเดียว</${Btn}>
          <${Btn} size="sm" variant="ghost" onClick=${()=>onImport(r,r.raw)}>เก็บทั้งสองรายการ (ไม่ซ้ำ)</${Btn}>
          <${Btn} size="sm" variant="ghost" onClick=${()=>onSkip(r)}>ข้ามรายการใหม่</${Btn}></div>
        ${mergeOpen?html`<${DupMergeModal} row=${r} onClose=${()=>setMergeOpen(false)} onSave=${m=>{setMergeOpen(false);onMerge(r,m);}}/>`:""}
      </div>`
      : html`<div>
        ${r.kind==="badcoord"?html`<div class="dm-coordbox">
          <div class="row between"><span class="dim">พิกัดที่อ่านได้จากไฟล์</span>
            <b style=${{color:coordOK?"var(--good)":"var(--bad)"}}>${r.raw.lat}, ${r.raw.lng}</b></div>
          <div class="dm-coord-note"><${Icon} name="pin" size=${14} color="var(--bad)"/> ตำแหน่งนี้อยู่นอกขอบเขตประเทศไทย — แก้พิกัดให้ถูกต้องก่อนนำเข้า</div>
          <${Btn} size="sm" variant="ghost" icon="pin" onClick=${fillFromProvince}>เติมพิกัดโดยประมาณจากจังหวัด</${Btn}>
        </div>`:""}
        <div class="dm-frm">
          ${inp("name","ชื่อธุรกิจ")}
          <label class="dm-frm-f"><span class="dm-frm-lb">ประเภท <b style=${{color:"var(--bad)"}}>*</b></span>
            <select class=${"dm-sel"+(isMiss("type")?" miss":"")} value=${form.type} onChange=${e=>set("type",e.target.value)}>
              <option value="">— เลือก —</option><option value="Existing">ลูกค้า</option><option value="Prospect">Lead</option></select></label>
          <label class="dm-frm-f"><span class="dm-frm-lb">จังหวัด <b style=${{color:"var(--bad)"}}>*</b></span>
            <select class=${"dm-sel"+(isMiss("province")?" miss":"")} value=${form.province} onChange=${e=>set("province",e.target.value)}>
              <option value="">— เลือก —</option>${PROV_TH.map(p=>html`<option key=${p} value=${p}>${provinceTH(p)}</option>`)}</select></label>
          <label class="dm-frm-f"><span class="dm-frm-lb">หมวดหมู่ธุรกิจ <b style=${{color:"var(--bad)"}}>*</b></span>
            <select class=${"dm-sel"+(!segKnown?" miss":"")} value=${segKnown?form.segment:""} onChange=${e=>set("segment",e.target.value)}>
              <option value="">— เลือกหมวดหมู่ —</option>${SEGMENTS.map(s=>html`<option key=${s} value=${s}>${SEG_TH[s]||s}</option>`)}</select>
            ${!segKnown&&r.raw.segment?html`<span class="dm-frm-hint">ค่าเดิมในไฟล์: "${r.raw.segment}" ไม่พบในระบบ — เลือกหมวดที่ถูกต้อง (เพิ่มหมวดใหม่ได้ที่ ตั้งค่าระบบ › ข้อมูลหลัก)</span>`:""}</label>
          ${inp("lat","ละติจูด","number")}
          ${inp("lng","ลองจิจูด","number")}
          ${inp("phone","เบอร์โทร")}
          ${inp("address","ที่อยู่")}
        </div>
        ${!coordOK?html`<div class="dm-frm-hint" style=${{color:"var(--bad)"}}>พิกัดยังอยู่นอกขอบเขตประเทศไทย</div>`:""}
        <div class="dm-drawer-act">
          <${Btn} size="sm" variant="outline" disabled=${!canImport} onClick=${()=>onImport(r,{...form})}>บันทึกและนำเข้า</${Btn}>
          <${Btn} size="sm" variant="ghost" onClick=${()=>onSkip(r)}>ข้ามรายการนี้</${Btn}></div>
        ${!canImport?html`<div class="dm-frm-hint">ยังกรอกไม่ครบ: ${missReq.map(k=>FLD_TH[k]).join(", ")||"พิกัด"} — ระบบไม่เดาค่าให้เอง</div>`:""}
      </div>`}
    </div>
  </${Modal}>`;
}

// นับ "รายการรอแก้ไข" จากแหล่งเดียว — ทั้ง badge บนแท็บ, chip และทุกที่อ้างถึงจำนวนนี้เสมอ
const pendingRows = staging => staging.filter(r=>r.status==="pending");
function TriageReview({staging, setStaging, fileId}){
  const [filter,setFilter]=useState("pending");   // pending | incomplete | dup | badcoord | skipped
  const [sel,setSel]=useState({});
  const [review,setReview]=useState(null);
  const [confirm,setConfirm]=useState(null);       // {how:'import'|'skip', ids:[...]}

  // เมื่อระบุ fileId → จำกัดเฉพาะแถวค้างของไฟล์นั้น (บริบทเดิมของไฟล์)
  const scoped = fileId ? staging.filter(r=>r.fileId===fileId) : staging;
  const pend=pendingRows(scoped);
  const counts={ all:pend.length, incomplete:pend.filter(r=>r.kind==="incomplete").length,
    dup:pend.filter(r=>r.kind==="dup").length, badcoord:pend.filter(r=>r.kind==="badcoord").length };

  const view=scoped.filter(r=>{
      if(filter==="skipped") return r.status==="skipped";
      if(r.status!=="pending") return false;
      return filter==="pending" ? true : r.kind===filter;
    }).sort((a,b)=> (rowSeverity(a)==="error"?0:1)-(rowSeverity(b)==="error"?0:1) || a.row-b.row);

  const patch=(id,p)=>setStaging(list=>list.map(x=>x.id===id?{...x,...p}:x));
  const importRow=(r,corrected)=>{ patch(r.id,{status:"imported",corrected:corrected||null});
    pushAudit({action:"นำเข้ารายการจากคิวรอแก้ไข", category:"นำเข้า", detail:`${(corrected&&corrected.name)||r.raw.name||r.id} (แถว ${r.row})`});
    toast("นำเข้ารายการเข้าสู่ระบบแล้ว","good"); setReview(null); };
  const mergeRow=(r,merged)=>{ patch(r.id,{status:"merged",corrected:merged});
    pushAudit({action:"รวมกับรายการเดิม", category:"แก้ไข", detail:`${r.raw.name} → ${r.match?r.match.id:"-"}`});
    toast("รวมกับรายการเดิมแล้ว","good"); setReview(null); };
  const skipRow=r=>{ patch(r.id,{status:"skipped"});
    pushAudit({action:"ข้ามรายการ (ไม่นำเข้า)", category:"แก้ไข", detail:`${r.raw.name||r.id} (แถว ${r.row}) · เก็บข้อมูลดิบไว้อ้างอิง`});
    toast("ทำเครื่องหมายข้ามแล้ว — ข้อมูลดิบยังถูกเก็บไว้","warn"); setReview(null); };
  const unskip=r=>{ patch(r.id,{status:"pending"});
    pushAudit({action:"นำรายการกลับเข้าคิวรอแก้ไข", category:"แก้ไข", detail:`${r.raw.name||r.id}`});
    toast("นำกลับเข้าคิวรอแก้ไขแล้ว","info"); };
  const doBulk=(ids,how)=>{ ids.forEach(id=>patch(id,{status: how==="import"?"imported":"skipped"}));
    pushAudit({action: how==="import"?"นำเข้าหลายรายการจากคิวรอแก้ไข":"ข้ามหลายรายการ",
      category: how==="import"?"นำเข้า":"แก้ไข", detail:`${ids.length} รายการ`});
    toast((how==="import"?"นำเข้า":"ข้าม")+` ${ids.length} รายการแล้ว`, how==="import"?"good":"warn");
    setSel({}); setConfirm(null); };
  // จัดการทั้งกลุ่ม — เขียน audit log แยกเป็น "รายแถว" เพื่อให้ตรวจย้อนหลังได้ว่าแถวไหนถูกจัดการอย่างไร

  const selRows=view.filter(r=>sel[r.id]);
  const selErr=selRows.filter(r=>rowSeverity(r)==="error").length;
  const allSel=view.length>0 && view.every(r=>sel[r.id]);
  const STAT_TH={ imported:"นำเข้าแล้ว", merged:"รวมแล้ว", skipped:"ข้าม (เก็บไว้อ้างอิง)", pending:"รอแก้ไข" };

  // 5 chip ตัวกรอง (คงจำนวนเดิม) — คำนวณจากแหล่งเดียวกับ badge บนแท็บ
  const CHIPS=[["pending","ทั้งหมดที่รอแก้ไข",counts.all,"gap"],["incomplete","ข้อมูลไม่ครบ",counts.incomplete,"edit"],
    ["dup","สงสัยว่าซ้ำ",counts.dup,"users"],["badcoord","พิกัดไม่ถูกต้อง",counts.badcoord,"pin"],
    ["skipped","ข้ามไว้ (ประวัติ)",scoped.filter(r=>r.status==="skipped").length,"reports"]];

  return html`<div>
    <div class="dim" style=${{fontSize:"12.5px",marginBottom:"12px"}}>แถวที่นำเข้าแล้วมีปัญหาถูกพักไว้ที่นี่โดยยังไม่เข้าระบบและไม่ถูกลบทิ้ง — จัดการทั้งกลุ่มได้ หรือตรวจทีละรายการ · การ "ข้าม" จะเก็บข้อมูลดิบไว้อ้างอิง ไม่ลบถาวร</div>

    <!-- ตัวกรองแบบ chip (คลิกเพื่อกรอง) -->
    <div class="dm-tri-chips">
      ${CHIPS.map(([key,label,val,ic])=>html`<button key=${key} class=${"dm-fchip"+(filter===key?" on":"")+(key==="skipped"?" ghost":"")}
        onClick=${()=>{setFilter(key);setGroupFocus(null);setSel({});}}>
        <${Icon} name=${ic} size=${14} color=${key==="badcoord"?"var(--bad)":key==="pending"?"var(--accent)":key==="skipped"?"var(--muted)":"var(--warn)"}/>
        <span>${label}</span><b>${num(val)}</b></button>`)}
    </div>

    ${selRows.length && filter!=="skipped" ? html`<div class="dm-bulk">
      <b>เลือก ${selRows.length} รายการ</b>
      <${Btn} size="sm" variant="outline" disabled=${selErr>0} onClick=${()=>setConfirm({how:"import",ids:selRows.map(r=>r.id)})}>นำเข้าทั้งหมด</${Btn}>
      <${Btn} size="sm" variant="ghost" onClick=${()=>setConfirm({how:"skip",ids:selRows.map(r=>r.id)})}>ข้ามทั้งหมด</${Btn}>
      ${selErr>0?html`<span class="dim" style=${{fontSize:"12px"}}>มี ${selErr} รายการที่ต้องแก้ก่อน ในกลุ่มที่เลือก — ต้องแก้ไขทีละรายการก่อน จึงนำเข้าเป็นกลุ่มไม่ได้</span>`:""}
    </div>`:""}

    ${view.length===0 ? html`<div class="dm-empty">
        <div class="dm-empty-ic"><${Icon} name="check" size=${34} color="var(--good)"/></div>
        <h3>${filter==="skipped"?"ยังไม่มีรายการที่ข้ามไว้":"ไม่มีรายการรอแก้ไข"}</h3>
        <div class="dim">${filter==="skipped"?"รายการที่คุณเลือกข้ามจะมาแสดงที่นี่ (ไม่ถูกลบ)":"ข้อมูลนำเข้าทุกแถวผ่านการตรวจสอบเรียบร้อยแล้ว"}</div></div>`
      : html`<${Table} cols=${[
        ...(filter==="skipped"?[]:[{h:html`<input type="checkbox" checked=${allSel} onChange=${e=>{const c=e.target.checked;setSel(s=>{const n={...s};view.forEach(r=>n[r.id]=c);return n;});}}/>`,
          render:r=>html`<input type="checkbox" checked=${!!sel[r.id]} onChange=${e=>setSel(s=>({...s,[r.id]:e.target.checked}))}/>`}]),
        {h:"แถวที่", render:r=>r.row},
        {h:"ชื่อธุรกิจ", render:r=> r.raw.name ? r.raw.name : html`<span class="dim">(ไม่มีชื่อ)</span>`},
        {h:"ชนิดปัญหา", render:r=>html`<${Badge} tone=${KIND_META[r.kind].tone}>${KIND_META[r.kind].label}</${Badge}>`},
        {h:"ปัญหาที่พบ", render:r=>html`<span class="dim" style=${{fontSize:"12px"}}>${issueSummary(r)}</span>`},
        {h:"ความรุนแรง", render:r=>html`<${Badge} tone=${rowSeverity(r)==="error"?"bad":"warn"}>${SEV_TH[rowSeverity(r)]}</${Badge}>`},
        {h:"การจัดการ", render:r=> filter==="skipped"
          ? html`<div class="row" style=${{gap:"6px"}}><span class="dim" style=${{fontSize:"12px"}}>${STAT_TH[r.status]}</span>
              <${Btn} size="sm" variant="ghost" onClick=${()=>unskip(r)}>นำกลับเข้าคิว</${Btn}></div>`
          : html`<${Btn} size="sm" variant="outline" onClick=${()=>setReview(r)}>ตรวจสอบ</${Btn}>`},
      ]} rows=${view}/>`}

    ${review?html`<${ReviewDrawer} row=${review} onClose=${()=>setReview(null)}
      onImport=${importRow} onSkip=${skipRow} onMerge=${mergeRow}/>`:""}

    ${confirm?html`<${Modal} title=${confirm.how==="import"?"ยืนยันนำเข้าหลายรายการ":"ยืนยันข้ามหลายรายการ"} onClose=${()=>setConfirm(null)}
      footer=${html`<div class="row" style=${{gap:"10px",justifyContent:"flex-end"}}>
        <${Btn} variant="ghost" onClick=${()=>setConfirm(null)}>ยกเลิก</${Btn}>
        <${Btn} variant="outline" onClick=${()=>doBulk(confirm.ids,confirm.how)}>ยืนยัน</${Btn}></div>`}>
      <p>${confirm.how==="import"
        ? html`นำเข้า <b>${confirm.ids.length} รายการ</b> ที่เลือกเข้าสู่ระบบ`
        : html`ทำเครื่องหมายข้าม <b>${confirm.ids.length} รายการ</b> — ข้อมูลดิบยังถูกเก็บไว้เป็นประวัติ ไม่ถูกลบ`}</p>
      <div class="dm-alert warn"><${Icon} name="gap" size=${15}/> การกระทำนี้บันทึกลงบันทึกการตรวจสอบเป็นรายแถว</div>
    </${Modal}>`:""}

  </div>`;
}

/* ═══════════════════ แท็บ 4: ข้อมูลที่ TC กรอกเข้ามา ═══════════════════ */
function TCData(){
  const {db}=useApp();
  const [rows,setRows]=useState(genTC);
  const [q,setQ]=useState(""); const [prov,setProv]=useState("All"); const [check,setCheck]=useState("All");
  const [sel,setSel]=useState({}); const [page,setPage]=useState(1);
  const [del,setDel]=useState(null); const [addOpen,setAddOpen]=useState(false); const [drawer,setDrawer]=useState(null); const [edit,setEdit]=useState(null);
  const filtered=rows.filter(r=>(prov==="All"||r.province===prov)&&(check==="All"||r.check===check)&&(!q||r.name.includes(q)));
  const PAGE=10; const totalPages=Math.max(1,Math.ceil(filtered.length/PAGE)); const pageRows=filtered.slice((page-1)*PAGE,page*PAGE);
  const selIds=Object.keys(sel).filter(k=>sel[k]);
  const bulk=how=>{ const lbl={verified:"ทำเครื่องหมายว่าตรวจสอบแล้ว",reject:"ตีกลับ",del:"ลบ"}[how];
    if(how==="del") setRows(rs=>rs.filter(r=>!sel[r.id])); else setRows(rs=>rs.map(r=>sel[r.id]?{...r,check:how==="verified"?"ตรวจสอบแล้ว":"ตีกลับ"}:r));
    pushAudit({action:"จัดการข้อมูล TC (หลายรายการ)", category: how==="del"?"ลบ":"แก้ไข", detail:`${lbl} · ${selIds.length} รายการ`});
    toast(`${lbl} ${selIds.length} รายการแล้ว`, how==="del"?"warn":"good"); setSel({}); };
  const doDelete=r=>{ setRows(rs=>rs.filter(x=>x.id!==r.id)); setDel(null); setDrawer(null);
    pushAudit({action:"ลบข้อมูลที่กรอกเอง", category:"ลบ", detail:`${r.name} (${r.id})`}); toast("ลบข้อมูลแล้ว","warn"); };
  const onAdd=recs=>{ const mapped=recs.map((r,i)=>({ id:"REC"+(9000+rows.length+i), name:r.businessName, type:r.status,
      segment:r.segment, province:r.province, district:r.district, lat:r.latitude, lng:r.longitude,
      email:r.email||"",
      tc:"System Administrator", date:new Date().toISOString().slice(0,10), check:"ตรวจสอบแล้ว", source:"manual_admin", incomplete:false, badCoord:false }));
    setRows(rs=>[...mapped,...rs]); setAddOpen(false);
    pushAudit({action:"เพิ่มข้อมูลด้วยตนเอง (Admin)", category:"เพิ่ม", detail:`${mapped.length} รายการ`}); toast(`เพิ่มข้อมูล ${mapped.length} รายการแล้ว`,"good"); };
  const exportXlsx=()=>{ pushAudit({action:"ส่งออกข้อมูล TC (Excel)", category:"ส่งออก", detail:`ตามตัวกรองปัจจุบัน · ${filtered.length} รายการ`}); toast(`ส่งออก ${filtered.length} รายการเป็น Excel แล้ว`,"good"); };
  // แก้ไข: ใช้ฟอร์มร่วมกับฟอร์มเพิ่มข้อมูล (AddRecordsForm โหมด editRecord) — Admin แก้ได้ทุก field
  const toRecord = r => ({ id:r.id, status:r.type, businessName:r.name, address:"", email:r.email||"", latitude:r.lat, longitude:r.lng,
    segment:r.segment, tc_owner:r.tc });
  const onEditSave = recs => { const rec=recs[0]; if(!rec){ setEdit(null); return; }
    setRows(rs=>rs.map(x=> x.id===edit.id ? {...x, name:rec.businessName, type:rec.status, segment:rec.segment,
      province:rec.province||x.province, district:rec.district||x.district, lat:rec.latitude, lng:rec.longitude,
      email:rec.email||x.email||"", incomplete:false, badCoord:false } : x));
    setEdit(null);
    pushAudit({action:"แก้ไขข้อมูลที่กรอกเอง", category:"แก้ไข", detail:`${rec.businessName} (${edit.id})`});
    toast("บันทึกการแก้ไขแล้ว","good"); };
  const hasFilter = q||prov!=="All"||check!=="All";
  const allSel = pageRows.length>0 && pageRows.every(r=>sel[r.id]);
  return html`<div>
    <div class="dm-toolbar">
      <input class="dm-input" placeholder="ค้นหาชื่อธุรกิจ…" value=${q} onInput=${e=>{setQ(e.target.value);setPage(1);}}/>
      <select class="dm-sel" value=${prov} onChange=${e=>{setProv(e.target.value);setPage(1);}}>
        <option value="All">ทุกจังหวัด</option>${PROV_TH.map(p=>html`<option key=${p} value=${p}>${provinceTH(p)}</option>`)}</select>
      <select class="dm-sel" value=${check} onChange=${e=>{setCheck(e.target.value);setPage(1);}}>
        ${["All","รอตรวจสอบ","ตรวจสอบแล้ว","ตีกลับ"].map(s=>html`<option key=${s} value=${s}>${s==="All"?"ทุกสถานะตรวจสอบ":s}</option>`)}</select>
      <div style=${{marginLeft:"auto"}} class="row"><${Btn} size="sm" variant="ghost" icon="download" onClick=${exportXlsx}>ส่งออก Excel</${Btn}>
        <${Btn} size="sm" variant="outline" icon="plus" onClick=${()=>setAddOpen(true)}>เพิ่มข้อมูลด้วยตนเอง</${Btn}></div>
    </div>
    ${selIds.length?html`<div class="dm-bulk"><b>เลือก ${selIds.length} รายการ</b>
      <${Btn} size="sm" variant="ghost" onClick=${()=>bulk("verified")}>ทำเครื่องหมายว่าตรวจสอบแล้ว</${Btn}>
      <${Btn} size="sm" variant="ghost" onClick=${()=>bulk("reject")}>ตีกลับ</${Btn}>
      <${Btn} size="sm" variant="ghost" onClick=${()=>bulk("del")}>ลบ</${Btn}></div>`:""}
    <${Table} empty="ไม่พบข้อมูลตามเงื่อนไขที่เลือก" cols=${[
      {h:html`<input type="checkbox" checked=${allSel} onChange=${e=>{const c=e.target.checked;setSel(s=>{const n={...s};pageRows.forEach(r=>n[r.id]=c);return n;});}}/>`,
        render:r=>html`<input type="checkbox" checked=${!!sel[r.id]} onChange=${e=>setSel(s=>({...s,[r.id]:e.target.checked}))}/>`},
      {h:"ชื่อธุรกิจ", render:r=>html`<button class="dm-link" onClick=${()=>setDrawer(r)}>${r.name}</button>
        ${r.incomplete?html` <${Badge} tone="warn">ไม่ครบ</${Badge}>`:""}${r.badCoord?html` <${Badge} tone="bad">พิกัดผิด</${Badge}>`:""}`},
      {h:"ประเภท", render:r=>html`<${Badge} tone=${r.type==="Existing"?"good":"info"}>${r.type==="Existing"?"ลูกค้า":"Lead"}</${Badge}>`},
      {h:"หมวดหมู่", render:r=>SEG_TH[r.segment]||r.segment},
      {h:"จังหวัด", render:r=>provinceTH(r.province)},
      {h:"อีเมล", render:r=> r.email?html`<span class="mono" style=${{fontSize:"11.5px"}}>${r.email}</span>`:html`<span class="dim">—</span>`},
      {h:"ผู้กรอก", render:r=>html`<div>${r.tc}<div class="dim" style=${{fontSize:"11px"}}>${SRC_TH[r.source]}</div></div>`},
      {h:"วันที่กรอก", render:r=>beDate(r.date)},
      {h:"สถานะตรวจสอบ", render:r=>html`<${Badge} tone=${CHECK_TONE[r.check]}>${r.check}</${Badge}>`},
      {h:"จัดการ", render:r=>html`<div class="row" style=${{gap:"6px"}}>
        <${Btn} size="sm" variant="ghost" onClick=${()=>setEdit(r)}>แก้ไข</${Btn}>
        <${Btn} size="sm" variant="ghost" onClick=${()=>setDel(r)}>ลบ</${Btn}></div>`},
    ]} rows=${pageRows}/>
    ${filtered.length===0 && hasFilter ? html`<div class="dm-empty" style=${{padding:"30px 20px"}}>
      <div class="dim">ไม่พบข้อมูลตามเงื่อนไขที่เลือก</div></div>`:""}
    ${totalPages>1?html`<div class="dm-pager"><span class="dim">แสดง ${(page-1)*PAGE+1}–${Math.min(page*PAGE,filtered.length)} จาก ${filtered.length} รายการ</span>
      <div class="row" style=${{gap:"5px"}}>${Array.from({length:totalPages},(_,i)=>i+1).map(p=>html`<button key=${p} class=${"dm-pg"+(p===page?" on":"")} onClick=${()=>setPage(p)}>${p}</button>`)}</div></div>`:""}

    ${addOpen?html`<${AddRecordsForm} db=${db} allowImport=${true} onClose=${()=>setAddOpen(false)} onSave=${onAdd}/>`:""}
    ${edit?html`<${AddRecordsForm} db=${db} editRecord=${toRecord(edit)} onClose=${()=>setEdit(null)} onSave=${onEditSave}/>`:""}
    ${del?html`<${Modal} title="ยืนยันการลบ" onClose=${()=>setDel(null)}
      footer=${html`<div class="row" style=${{gap:"10px",justifyContent:"flex-end"}}>
        <${Btn} variant="ghost" onClick=${()=>setDel(null)}>ยกเลิก</${Btn}>
        <${Btn} variant="outline" onClick=${()=>doDelete(del)}>ยืนยันลบ</${Btn}></div>`}>
      <p>ต้องการลบ <b>${del.name}</b> หรือไม่? ข้อมูลจะหายจากแผนที่และรายงานด้วย · การกระทำนี้บันทึกลงบันทึกการตรวจสอบ</p>
    </${Modal}>`:""}
    ${drawer?html`<${Modal} title=${drawer.name} onClose=${()=>setDrawer(null)}>
        <div class="dm-kv"><span>ประเภท</span><b>${drawer.type==="Existing"?"ลูกค้า":"Lead"}</b></div>
        <div class="dm-kv"><span>หมวดหมู่</span><b>${SEG_TH[drawer.segment]||drawer.segment}</b></div>
        <div class="dm-kv"><span>จังหวัด</span><b>${provinceTH(drawer.province)}</b></div>
        <div class="dm-kv"><span>พิกัด</span><b>${drawer.lat}, ${drawer.lng}</b></div>
        <div class="dm-kv"><span>อีเมล</span><b>${drawer.email||"—"}</b></div>
        <div class="dm-kv"><span>ผู้กรอก</span><b>${drawer.tc} · ${SRC_TH[drawer.source]}</b></div>
        <div class="dm-kv"><span>วันที่กรอก</span><b>${beDate(drawer.date)}</b></div>
        <div class="dm-kv"><span>สถานะตรวจสอบ</span><${Badge} tone=${CHECK_TONE[drawer.check]}>${drawer.check}</${Badge}></div>
        <div class="dm-alert" style=${{marginTop:"12px"}}><${Icon} name="pin" size=${14}/> พิกัดกรอกจากแหล่งข้อมูลของท่าน — ระบบไม่ได้ดึงจากแหล่งภายนอก</div>
      </${Modal}>`:""}
  </div>`;
}

/* ═══════════════════ หน้าหลัก ═══════════════════ */
const BASE_TABS=[{value:"import",label:"นำเข้าไฟล์ Excel"},
  {value:"files",label:"จัดการไฟล์นำเข้า"},{value:"leads",label:"จัดการ Lead"}];

/* ═══════════ คำขอเปลี่ยนเป็นลูกค้า (conversion_requests) — คิวที่ TC ส่งขออนุมัติ ═══════════
   หลักการ: คงรหัส Lead เดิมหลังเป็นลูกค้า · Lead ของหมวด ณ วันส่งคำขอถูกแช่แข็งไว้ · เฉพาะผู้ดูแลอนุมัติ/ปฏิเสธ
   (ชั้น client เป็นตัวช่วย — การบังคับสิทธิ์จริงต้องทำที่เซิร์ฟเวอร์) · ไม่ลบคำขอ ใช้เปลี่ยนสถานะเท่านั้น */

const CV_TODAY=Date.parse("2026-08-03T00:00:00Z");
const beDate2 = thDate;   // ใช้ตัวแปลงกลาง
const daysAgo=iso=>Math.max(0, Math.floor((CV_TODAY-Date.parse(iso))/864e5));
// เหตุผลปฏิเสธ (ข้อมูลหลัก) — เลือก "อื่น ๆ" ต้องกรอกหมายเหตุ
const REJECT_REASONS=[["evidence","หลักฐานไม่เพียงพอ/ไม่ชัดเจน"],["dup","เป็นลูกค้าอยู่แล้ว หรือรายการซ้ำ"],
  ["notclosed","ยังไม่ปิดการขายจริง"],["wrongdata","พื้นที่/ข้อมูลธุรกิจไม่ถูกต้อง"],["other","อื่น ๆ (ระบุ)"]];
const REJ_TH=Object.fromEntries(REJECT_REASONS.map(([k,v])=>[k,v]));
const GAP_C={High:"#c81e1e",Medium:"#b45309",Low:"#0f7a3d"};

// mock: คำขอรออนุมัติ 12 (5 ค้าง>3วัน เก่าสุด 8 · 2 ไม่มีหลักฐาน · 1 ไม่มีประวัติเข้าพบ) + ประวัติ 20 (deterministic)
export function genConvReqs(){
  let s=20260808>>>0; const R=()=>{s=(s+0x6D2B79F5)>>>0;let t=Math.imul(s^s>>>15,1|s);t=(t+Math.imul(t^t>>>7,61|t))^t;return((t^t>>>14)>>>0)/4294967296;};
  const pick=a=>a[Math.floor(R()*a.length)], rint=(a,b)=>a+Math.floor(R()*(b-a+1));
  const PROV=[["Bangkok Metropolis","กรุงเทพมหานคร",["บางรัก","วัฒนา","ห้วยขวาง","จตุจักร","สาทร"],13.74,100.53],
    ["Pattaya","ชลบุรี",["บางละมุง","ศรีราชา","เมืองพัทยา","หนองปรือ"],12.93,100.88],
    ["Phuket","ภูเก็ต",["เมืองภูเก็ต","กะทู้","ถลาง","ป่าตอง"],7.88,98.39],
    ["Chiang Mai","เชียงใหม่",["เมืองเชียงใหม่","สันทราย","หางดง","แม่ริม"],18.79,98.98]];
  const SEGS=[["Hospitality","ที่พักและสันทนาการ",["Hotel","Resort","Suites","Residence"]],["FoodBeverage","อาหารและเครื่องดื่ม",["Restaurant","Cafe","Bistro","Kitchen"]],
    ["HealthBeauty","สุขภาพ ความงาม และเวลเนส",["Clinic","Spa","Wellness","Beauty"]],["Retail","ค้าปลีกและสินค้าอุปโภคบริโภค",["Mart","Store","Retail","Shop"]],["Manufacturing","ผลิตและวัสดุอุตสาหกรรม",["Industry","Supplies","Works","Materials"]]];
  const PFX=["ABC","Grand","Royal","Riverside","Sunset","Emerald","Golden","Siam","Baan","Andaman","Lanna","Nimman","Ocean","Central","Lotus","Sapphire"];
  const TCN=["ศิริพร ตันติ","ณัฐพงษ์ วงศ์","กมลชนก ศรี","ธนวัฒน์ รัตน์","พิมพ์ชนก กิจ","อภิสิทธิ์ พรหม"];
  const EVN=["ใบสั่งซื้อ","สัญญาบริการ","ใบเสร็จรับเงิน","หลักฐานการโอน","ภาพหน้าร้าน","บันทึกการประชุม"];
  const NOTES=["ลูกค้าตกลงสั่งซื้อแล้ว แนบใบสั่งซื้อประกอบ","ปิดการขายรอบนี้ ยืนยันผ่านไลน์แล้ว","เริ่มใช้บริการภายในเดือนนี้","เซ็นสัญญา 1 ปีเรียบร้อย","ตกลงเงื่อนไขแล้ว รอเปิดบิลแรก"];
  let seq=0;
  const mk=(ageD,opt={})=>{ const i=++seq; const pr=pick(PROV), sg=pick(SEGS);
    const gapLevel=pick(["High","High","High","Medium","Medium","Low"]),
      gapCount= gapLevel==="High"?rint(9,24):gapLevel==="Medium"?rint(4,8):rint(0,3);
    const reqAt=CV_TODAY-ageD*864e5;
    const nVisit= opt.noVisit?0:rint(1,4), visits=[];
    for(let k=0;k<nVisit;k++) visits.push({date:new Date(reqAt-(k*rint(5,18)+rint(2,8))*864e5).toISOString(), kind:pick(["เข้าพบที่ร้าน","โทรติดตาม","นำเสนอสินค้า"]), note:pick(["สนใจมาก ขอใบเสนอราคา","นัดคุยรอบถัดไป","ตัดสินใจใช้บริการ","ต่อรองเงื่อนไข"])});
    const nEv= opt.noEvidence?0:rint(1,3), files=[];
    for(let k=0;k<nEv;k++){ const nm=pick(EVN); files.push({name:nm+"-"+(1000+i)+"."+(/ภาพ|หน้าร้าน/.test(nm)?"jpg":"pdf"), kind:/ภาพ|หน้าร้าน/.test(nm)?"image":"pdf"}); }
    return { id:"CVR"+String(1000+i), prospect_id:"PRO"+String(20000+i).slice(-5), businessName:pick(PFX)+" "+pick(sg[2]),
      segment:sg[0], segTH:sg[1], province:pr[0], provTH:pr[1], district:pick(pr[2]), lat:pr[3], lng:pr[4],
      requested_by:pick(TCN), requested_at:new Date(reqAt).toISOString(), note:pick(NOTES),
      evidence_files:files, gap_snapshot:gapCount, gapLevel_snapshot:gapLevel, visits, status:opt.status||"pending",
      reviewed_by:null, reviewed_at:null, reject_reason_code:null, reject_note:null }; };
  const pending=[ mk(8), mk(6), mk(5), mk(4,{noEvidence:true}), mk(4), mk(2,{noEvidence:true}), mk(2,{noVisit:true}), mk(1), mk(1), mk(0), mk(0), mk(3) ];
  const history=[];
  for(let i=0;i<20;i++){ const r=mk(rint(2,45)); const appr=R()<0.6;
    r.reviewed_by="ผู้ดูแลระบบ"; r.reviewed_at=new Date(Date.parse(r.requested_at)+rint(1,4)*864e5).toISOString();
    if(appr){ r.status="approved"; } else { r.status="rejected"; const rr=pick(REJECT_REASONS); r.reject_reason_code=rr[0]; if(rr[0]==="other") r.reject_note="ข้อมูลไม่ครบถ้วน ให้ตรวจสอบและส่งใหม่"; }
    history.push(r); }
  history.sort((a,b)=>Date.parse(b.reviewed_at)-Date.parse(a.reviewed_at));
  return [...pending, ...history];
}

function ConversionRequests({reqs, setReqs}){
  const {user}=useApp();
  const _admin=(user&&user.name)||"ผู้ดูแลระบบ", _email=(user&&user.email)||"admin@geointel.io";
  const [sub,setSub]=useState("pending");          // pending | history
  const [filter,setFilter]=useState("all");        // all | stale | noev | prov:<key>
  const [drawer,setDrawer]=useState(null);         // คำขอที่กำลังดู
  const [approveOf,setApproveOf]=useState(null);   // คำขอที่กำลังยืนยันอนุมัติ
  const [sel,setSel]=useState({});                 // เลือกหลายรายการเพื่อปฏิเสธ
  const [rejOf,setRejOf]=useState(null);           // {ids} กล่องปฏิเสธ
  const [rejCode,setRejCode]=useState("evidence"); const [rejNote,setRejNote]=useState("");
  const [preview,setPreview]=useState(null);       // ไฟล์หลักฐานที่เปิดดู
  const [undoOf,setUndoOf]=useState(null); const [undoNote,setUndoNote]=useState("");

  const pending=reqs.filter(r=>r.status==="pending");
  const history=reqs.filter(r=>r.status!=="pending").sort((a,b)=>Date.parse(b.reviewed_at)-Date.parse(a.reviewed_at));
  const staleN=pending.filter(r=>daysAgo(r.requested_at)>3).length;
  const maxStale=pending.reduce((m,r)=>Math.max(m,daysAgo(r.requested_at)),0);
  const provsInQ=[...new Set(pending.map(r=>r.province))];
  const noEv=r=>!r.evidence_files||r.evidence_files.length===0;
  const noVisit=r=>!r.visits||r.visits.length===0;

  const shown = pending.filter(r=> filter==="all" ? true : filter==="stale" ? daysAgo(r.requested_at)>3
    : filter==="noev" ? noEv(r) : filter.startsWith("prov:") ? r.province===filter.slice(5) : true)
    .sort((a,b)=>Date.parse(a.requested_at)-Date.parse(b.requested_at));   // ค้างนานสุดอยู่บน

  const _stamp=()=>new Date(CV_TODAY).toISOString();
  const approve = req => {
    setReqs(rs=>rs.map(x=>x.id===req.id?{...x,status:"approved",reviewed_by:_admin,reviewed_at:_stamp()}:x));
    // อนุมัติ: เปลี่ยนเป็นลูกค้าโดยคงรหัสเดิม + ใช้คะแนน snapshot (ไม่คำนวณใหม่) · เขียน audit 2 รายการ + แจ้งผู้ส่ง
    pushAudit({user:_email, action:"อนุมัติคำขอเปลี่ยนเป็นลูกค้า", category:"แก้ไข",
      detail:`${req.businessName} · ${req.provTH} · คงรหัสเดิม ${req.prospect_id} · ช่องว่างของหมวด ${req.gap_snapshot} ราย (${GAP_TH[req.gapLevel_snapshot]}) แช่แข็งไว้`});
    pushAudit({user:_email, action:"แจ้งเตือนผู้ส่งคำขอ", category:"แจ้งเตือน",
      detail:`แจ้ง ${req.requested_by}: คำขอ "${req.businessName}" ได้รับการอนุมัติเป็นลูกค้าแล้ว`});
    toast(`อนุมัติแล้ว — "${req.businessName}" เป็นลูกค้า (คงรหัส ${req.prospect_id})`,"good");
    setApproveOf(null); setDrawer(null);
  };
  const doReject = (ids, code, note) => {
    const nm=id=>(reqs.find(x=>x.id===id)||{}).businessName;
    setReqs(rs=>rs.map(x=> ids.includes(x.id) ? {...x,status:"rejected",reviewed_by:_admin,reviewed_at:_stamp(),reject_reason_code:code,reject_note:code==="other"?note:null} : x));
    ids.forEach(id=>pushAudit({user:_email, action:"ปฏิเสธคำขอเปลี่ยนเป็นลูกค้า", category:"แก้ไข", detail:`${nm(id)} · เหตุผล: ${REJ_TH[code]}${code==="other"&&note?" — "+note:""} · Lead กลับสถานะเดิม ส่งใหม่ได้`}));
    toast(`ปฏิเสธ ${ids.length} คำขอ — ส่งกลับให้ผู้ประสานงาน`,"warn");
    setRejOf(null); setRejNote(""); setSel({}); setDrawer(null);
  };
  const undo = (req, reason) => {
    setReqs(rs=>rs.map(x=>x.id===req.id?{...x,status:"pending",reviewed_by:null,reviewed_at:null}:x));
    pushAudit({user:_email, action:"ย้อนการอนุมัติคำขอ", category:"แก้ไข", detail:`${req.businessName} · เหตุผล: ${reason} · กลับเข้าคิวรออนุมัติ`});
    toast("ย้อนการอนุมัติแล้ว — กลับเข้าคิวรออนุมัติ","warn");
    setUndoOf(null); setUndoNote("");
  };

  const selIds=Object.keys(sel).filter(k=>sel[k]);
  const canUndo=r=> r.status==="approved" && (CV_TODAY-Date.parse(r.reviewed_at))<=864e5;   // ภายใน 24 ชม.

  return html`<div class="cv-wrap">
    <div class="cv-subtabs">
      <button class=${"cv-st"+(sub==="pending"?" on":"")} onClick=${()=>setSub("pending")}>รออนุมัติ ${pending.length?html`<span class="cv-badge">${pending.length}</span>`:""}</button>
      <button class=${"cv-st"+(sub==="history"?" on":"")} onClick=${()=>setSub("history")}>ประวัติ</button>
    </div>

    ${sub==="pending" ? html`<${Card} title="คำขอเปลี่ยนเป็นลูกค้า"
      sub="คำขอที่ผู้ประสานงานส่งมาให้อนุมัติเปลี่ยน Lead เป็นลูกค้า · อนุมัติแล้วจะคงรหัสเดิมและแช่แข็งคะแนน ณ วันส่งคำขอ">
      <!-- 1) แถบสรุปบรรทัดเดียว -->
      <div class="cv-summary">รออนุมัติ <b>${num(pending.length)}</b> รายการ · ค้างนานที่สุด <b>${maxStale}</b> วัน · จาก <b>${provsInQ.length}</b> จังหวัด</div>
      ${staleN>0 ? html`<div class="cv-warnbar"><${Icon} name="info" size=${15}/> มี <b>${staleN}</b> รายการค้างเกิน 3 วัน — ควรพิจารณาก่อน</div>`:""}
      <!-- 2) ชิปกรอง -->
      <div class="cv-chips">
        <button class=${"cv-chip"+(filter==="all"?" on":"")} onClick=${()=>setFilter("all")}>ทั้งหมด (${pending.length})</button>
        <button class=${"cv-chip"+(filter==="stale"?" on":"")} onClick=${()=>setFilter("stale")}>ค้างเกิน 3 วัน (${staleN})</button>
        <button class=${"cv-chip"+(filter==="noev"?" on":"")} onClick=${()=>setFilter("noev")}>ไม่มีหลักฐานแนบ (${pending.filter(noEv).length})</button>
        ${provsInQ.map(pv=>{ const n=pending.filter(r=>r.province===pv).length; const pt=(pending.find(r=>r.province===pv)||{}).provTH;
          return html`<button key=${pv} class=${"cv-chip"+(filter==="prov:"+pv?" on":"")} onClick=${()=>setFilter("prov:"+pv)}>${pt} (${n})</button>`; })}
      </div>
      ${selIds.length>0 ? html`<div class="cv-selbar"><span>เลือกไว้ <b>${selIds.length}</b> รายการ</span>
        <div style=${{display:"flex",gap:"8px"}}><${Btn} variant="ghost" size="sm" onClick=${()=>setSel({})}>ยกเลิกเลือก</${Btn}>
        <${Btn} variant="outline" size="sm" onClick=${()=>{ setRejCode("evidence"); setRejNote(""); setRejOf({ids:selIds}); }}>ปฏิเสธที่เลือก (${selIds.length})</${Btn}></div></div>`:""}
      <!-- 3) รายการแบบการ์ด -->
      ${shown.length===0 ? html`<div class="emptybox" style=${{padding:"26px",textAlign:"center"}}>ไม่มีคำขอตามเงื่อนไขที่เลือก</div>`
      : html`<div class="cv-cards">
        ${shown.map(r=>{ const d=daysAgo(r.requested_at), stale=d>3, warn=noEv(r)||noVisit(r);
          return html`<div key=${r.id} class=${"cv-card"+(stale?" stale":"")}>
          <label class="cv-ck"><input type="checkbox" checked=${!!sel[r.id]} onChange=${e=>setSel(s=>({...s,[r.id]:e.target.checked}))}/></label>
          <div class="cv-c-body">
            <div class="cv-c-head">
              <div class="cv-c-nm">${r.businessName} <span class="cv-gap" style=${{background:GAP_C[r.gapLevel_snapshot]}}>ขาด ${r.gap_snapshot} ราย</span></div>
              <div class="cv-c-days ${stale?"stale":""}">${stale?"":""}ค้าง ${d} วัน</div>
            </div>
            <div class="cv-c-meta">${r.segTH} · อำเภอ${r.district}</div>
            <div class="cv-c-meta">ส่งโดย <b>${r.requested_by}</b> เมื่อ ${beDate2(r.requested_at)}</div>
            <div class="cv-c-meta">เข้าพบ ${r.visits.length} ครั้ง${r.visits.length?" · ครั้งล่าสุด "+beDate2(r.visits[0].date):""} · หลักฐานแนบ ${r.evidence_files.length} ไฟล์</div>
            ${warn ? html`<div class="cv-c-warn">${[noEv(r)?"ไม่มีหลักฐานแนบ":null, noVisit(r)?"ไม่มีประวัติการเข้าพบ":null].filter(Boolean).join(" · ")}</div>`:""}
            <div class="cv-c-act">
              <${Btn} variant="ghost" size="sm" onClick=${()=>setDrawer(r)}>ดูรายละเอียด</${Btn}>
              <${Btn} variant="outline" size="sm" onClick=${()=>{ setRejCode("evidence"); setRejNote(""); setRejOf({ids:[r.id]}); }}>ปฏิเสธ</${Btn}>
              <${Btn} variant="primary" size="sm" icon="check" onClick=${()=>setApproveOf(r)}>อนุมัติ</${Btn}>
            </div>
          </div>
        </div>`; })}
      </div>`}
    </${Card}>`
    : html`<${Card} title="ประวัติคำขอที่จัดการแล้ว" sub="คำขอที่อนุมัติหรือปฏิเสธแล้ว · รายการที่อนุมัติภายใน 24 ชม. ย้อนได้">
      ${history.length===0 ? html`<div class="emptybox" style=${{padding:"26px",textAlign:"center"}}>ยังไม่มีประวัติ</div>`
      : html`<div class="cv-cards">
        ${history.map(r=>html`<div key=${r.id} class="cv-card hist">
          <div class="cv-c-body">
            <div class="cv-c-head">
              <div class="cv-c-nm">${r.businessName} <span class="cv-gap" style=${{background:GAP_C[r.gapLevel_snapshot]}}>ขาด ${r.gap_snapshot} ราย</span></div>
              <span class=${"cv-status "+r.status}>${r.status==="approved"?"อนุมัติแล้ว":"ปฏิเสธแล้ว"}</span>
            </div>
            <div class="cv-c-meta">${r.segTH} · อำเภอ${r.district} · ส่งโดย ${r.requested_by}</div>
            <div class="cv-c-meta">ตัดสินโดย <b>${r.reviewed_by}</b> เมื่อ ${beDate2(r.reviewed_at)}${r.status==="rejected"?" · เหตุผล: "+REJ_TH[r.reject_reason_code]+(r.reject_note?" ("+r.reject_note+")":""):""}</div>
            ${canUndo(r) ? html`<div class="cv-c-act"><${Btn} variant="outline" size="sm" onClick=${()=>{ setUndoNote(""); setUndoOf(r); }}>ย้อนการอนุมัติ</${Btn}></div>`:""}
          </div>
        </div>`)}
      </div>`}
    </${Card}>`}

    <!-- 4) แผงรายละเอียด (drawer จากขวา) -->
    ${drawer ? createPortal(html`<div class="cv-drawer-back" onMouseDown=${e=>{ if(e.target.classList.contains("cv-drawer-back")) setDrawer(null); }}>
      <div class="cv-drawer">
        <div class="cv-dr-head"><div><div class="cv-dr-nm">${drawer.businessName}</div><div class="cv-c-meta">รหัส ${drawer.prospect_id} · ${drawer.segTH} · ${drawer.provTH}</div></div>
          <button class="cv-x" onClick=${()=>setDrawer(null)}><${Icon} name="close" size=${16}/></button></div>
        <div class="cv-dr-body">
          <!-- ส่วนที่ 1 · ข้อมูลธุรกิจ + แผนที่ + คะแนน -->
          <div class="cv-sec-t">ข้อมูลธุรกิจ</div>
          <div class="cv-kv"><span>อำเภอ</span><b>${drawer.district}</b></div>
          <div class="cv-kv"><span>หมวดธุรกิจ</span><b>${drawer.segTH}</b></div>
          <div class="cv-score">Lead ของหมวดนี้ <b style=${{color:GAP_C[drawer.gapLevel_snapshot]}}>${GAP_TH[drawer.gapLevel_snapshot]}</b> · ยังขาด <b>${drawer.gap_snapshot}</b> ราย — <span class="cv-frozen">ค่านี้จะถูกบันทึกถาวรเมื่ออนุมัติ ไม่คำนวณใหม่</span></div>
          <${CvMiniMap} lat=${drawer.lat} lng=${drawer.lng}/>
          <!-- ส่วนที่ 2 · ประวัติการเข้าพบ -->
          <div class="cv-sec-t">ประวัติการเข้าพบ (${drawer.visits.length})</div>
          ${drawer.visits.length? drawer.visits.map((v,i)=>html`<div key=${i} class="cv-visit"><div class="cv-visit-h"><b>${v.kind}</b><span>${beDate2(v.date)}</span></div><div class="cv-c-meta">${v.note}</div></div>`)
            : html`<div class="cv-c-warn" style=${{margin:"4px 0"}}>ไม่มีประวัติการเข้าพบ</div>`}
          <!-- ส่วนที่ 3 · หลักฐานที่แนบ (ดูในหน้าเดียวกัน) -->
          <div class="cv-sec-t">หลักฐานที่แนบ (${drawer.evidence_files.length})</div>
          ${drawer.evidence_files.length? html`<div class="cv-files">${drawer.evidence_files.map((f,i)=>html`<button key=${i} class="cv-file" onClick=${()=>setPreview(f)}><${Icon} name=${f.kind==="image"?"image":"file"} size=${14}/> ${f.name}</button>`)}</div>`
            : html`<div class="cv-c-warn" style=${{margin:"4px 0"}}>ไม่มีหลักฐานแนบ</div>`}
          <!-- ส่วนที่ 4 · หมายเหตุจากผู้ส่ง -->
          <div class="cv-sec-t">หมายเหตุจากผู้ส่งคำขอ</div>
          <div class="cv-note">"${drawer.note}" — ${drawer.requested_by}, ${beDate2(drawer.requested_at)}</div>
        </div>
        <div class="cv-dr-foot">
          <${Btn} variant="outline" onClick=${()=>{ setRejCode("evidence"); setRejNote(""); setRejOf({ids:[drawer.id]}); }}>ปฏิเสธ</${Btn}>
          <${Btn} variant="primary" icon="check" onClick=${()=>setApproveOf(drawer)}>อนุมัติเปลี่ยนเป็นลูกค้า</${Btn}>
        </div>
      </div>
    </div>`, document.body):""}

    <!-- ดูไฟล์หลักฐานในหน้าเดียวกัน -->
    ${preview ? html`<${Modal} title=${preview.name} onClose=${()=>setPreview(null)}>
      <div class="cv-preview">${preview.kind==="image"
        ? html`<div class="cv-prev-img"><${Icon} name="image" size=${40} color="var(--muted)"/><div>ภาพตัวอย่างหลักฐาน (ระบบสาธิต)</div></div>`
        : html`<div class="cv-prev-pdf"><${Icon} name="file" size=${40} color="var(--accent)"/><div>เอกสาร PDF — ${preview.name}</div><div class="cv-c-meta">แสดงตัวอย่างในหน้าเดียวกันโดยไม่ต้องดาวน์โหลด (ระบบสาธิต)</div></div>`}</div>
    </${Modal}>`:""}

    <!-- 5) ยืนยันอนุมัติ (ทีละรายการ) -->
    ${approveOf ? html`<${Modal} title="ยืนยันอนุมัติเปลี่ยนเป็นลูกค้า" onClose=${()=>setApproveOf(null)}>
      <div class="cv-confirm">เมื่ออนุมัติ "<b>${approveOf.businessName}</b>" ระบบจะดำเนินการ:</div>
      <ul class="cv-clist">
        <li>เปลี่ยนประเภทเป็น <b>ลูกค้า</b> โดย<b>คงรหัสเดิม ${approveOf.prospect_id}</b> (ไม่สร้างรหัสใหม่)</li>
        <li>บันทึก Lead ของหมวด <b>${approveOf.gap_snapshot}</b> ราย (${GAP_TH[approveOf.gapLevel_snapshot]}) จาก snapshot ถาวร (ไม่คำนวณใหม่)</li>
        <li>อัปเดตแผนที่และตัวเลขสรุปทั้งระบบ</li>
        <li>เขียนบันทึกการตรวจสอบ 2 รายการ และแจ้งเตือนผู้ส่งคำขอ</li>
      </ul>
      <div class="cv-modal-foot"><${Btn} variant="ghost" onClick=${()=>setApproveOf(null)}>ยกเลิก</${Btn}><${Btn} variant="primary" icon="check" onClick=${()=>approve(approveOf)}>ยืนยันอนุมัติ</${Btn}></div>
    </${Modal}>`:""}

    <!-- 6) ปฏิเสธ (เลือกได้หลายรายการ · ต้องเลือกเหตุผล) -->
    ${rejOf ? html`<${Modal} title=${`ปฏิเสธคำขอ ${rejOf.ids.length} รายการ`} onClose=${()=>setRejOf(null)}>
      <div class="cv-confirm">เลือกเหตุผลการปฏิเสธ (Lead จะกลับสถานะเดิม ส่งคำขอใหม่ได้ · คำขอเดิมเก็บในประวัติ):</div>
      <div class="cv-reasons">${REJECT_REASONS.map(([k,v])=>html`<label key=${k} class=${"cv-reason"+(rejCode===k?" on":"")}>
        <input type="radio" name="rej" checked=${rejCode===k} onChange=${()=>setRejCode(k)}/> ${v}</label>`)}</div>
      ${rejCode==="other" ? html`<textarea class="cv-note-in" placeholder="ระบุเหตุผล…" value=${rejNote} onInput=${e=>setRejNote(e.target.value)}></textarea>`:""}
      <div class="cv-modal-foot"><${Btn} variant="ghost" onClick=${()=>setRejOf(null)}>ยกเลิก</${Btn}>
        <${Btn} variant="primary" onClick=${()=>{ if(rejCode==="other"&&!rejNote.trim()){ toast("กรุณากรอกหมายเหตุสำหรับ 'อื่น ๆ'","warn"); return; } doReject(rejOf.ids, rejCode, rejNote.trim()); }}>ยืนยันปฏิเสธ</${Btn}></div>
    </${Modal}>`:""}

    <!-- ย้อนการอนุมัติ (ต้องกรอกเหตุผล) -->
    ${undoOf ? html`<${Modal} title="ย้อนการอนุมัติ" onClose=${()=>setUndoOf(null)}>
      <div class="cv-confirm">ย้อนการอนุมัติ "<b>${undoOf.businessName}</b>" — รายการจะกลับเข้าคิวรออนุมัติ กรุณาระบุเหตุผล:</div>
      <textarea class="cv-note-in" placeholder="เหตุผลการย้อน…" value=${undoNote} onInput=${e=>setUndoNote(e.target.value)}></textarea>
      <div class="cv-modal-foot"><${Btn} variant="ghost" onClick=${()=>setUndoOf(null)}>ยกเลิก</${Btn}>
        <${Btn} variant="primary" onClick=${()=>{ if(!undoNote.trim()){ toast("กรุณากรอกเหตุผล","warn"); return; } undo(undoOf, undoNote.trim()); }}>ยืนยันย้อน</${Btn}></div>
    </${Modal}>`:""}
    <style>${CV_CSS}</style>
  </div>`;
}

// แผนที่ย่อในแผงรายละเอียด (Leaflet)
function CvMiniMap({lat,lng}){
  const ref=useRef(null);
  useEffect(()=>{ const L=window.L; if(!L||!ref.current) return;
    const m=L.map(ref.current,{zoomControl:false,attributionControl:false,scrollWheelZoom:false,dragging:false}).setView([lat,lng],12);
    basemap(m, "th");
    L.marker([lat,lng]).addTo(m); setTimeout(()=>m.invalidateSize(),60); return ()=>m.remove();
  },[lat,lng]);
  return html`<div class="cv-map" ref=${ref}></div>`;
}
const CV_CSS=`
.cv-subtabs{display:flex;gap:8px;margin-bottom:14px}
.cv-st{padding:9px 16px;border-radius:10px;border:1px solid var(--stroke2);background:var(--surface);cursor:pointer;font-family:var(--font);font-size:13px;font-weight:700;color:var(--muted);display:inline-flex;align-items:center;gap:7px}
.cv-st.on{background:var(--accent);color:#fff;border-color:var(--accent)}
.cv-badge{background:#fff;color:var(--accent-deep);border-radius:999px;font-size:11px;font-weight:800;padding:1px 8px}
.cv-st.on .cv-badge{background:rgba(30,45,80,.10)}
.cv-summary{font-size:13.5px;color:var(--txt);padding:11px 14px;border-radius:10px;background:var(--surface2);border:1px solid var(--stroke);margin-bottom:10px}
.cv-summary b{color:var(--accent-deep)}
.cv-warnbar{display:flex;align-items:center;gap:8px;font-size:12.5px;color:#b45309;background:rgba(255,176,46,.12);border:1px solid rgba(255,176,46,.3);border-radius:10px;padding:9px 13px;margin-bottom:12px}
.cv-chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
.cv-chip{padding:7px 13px;border-radius:999px;border:1px solid var(--stroke2);background:var(--surface);cursor:pointer;font-family:var(--font);font-size:12px;font-weight:600;color:var(--muted)}
.cv-chip.on{background:var(--accent-soft);border-color:var(--accent);color:var(--accent-deep);font-weight:700}
.cv-selbar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:9px 13px;border-radius:10px;background:var(--accent-soft);border:1px solid rgba(230, 0, 35,.25);margin-bottom:12px;font-size:12.5px}
.cv-cards{display:flex;flex-direction:column;gap:11px}
.cv-card{display:flex;gap:10px;padding:13px 15px;border-radius:12px;border:1px solid var(--stroke2);background:var(--surface)}
.cv-card.stale{border-left:4px solid #b45309}
.cv-card.hist{opacity:.96}
.cv-ck{flex:none;padding-top:2px}
.cv-c-body{flex:1;min-width:0}
.cv-c-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap}
.cv-c-nm{font-size:14px;font-weight:800;color:var(--txt)}
.cv-gap{margin-left:7px;color:#fff;font-size:11.5px;font-weight:800;padding:2px 9px;border-radius:999px;vertical-align:1px}
.cv-c-days{font-size:12px;font-weight:700;color:var(--muted);white-space:nowrap}
.cv-c-days.stale{color:#b45309}
.cv-c-meta{font-size:12.5px;color:var(--muted);margin-top:4px}
.cv-c-warn{margin-top:7px;font-size:12px;font-weight:700;color:#b45309;background:rgba(255,176,46,.12);border:1px solid rgba(255,176,46,.3);border-radius:8px;padding:6px 10px}
.cv-c-act{display:flex;gap:8px;flex-wrap:wrap;margin-top:11px}
.cv-status{font-size:11.5px;font-weight:800;padding:3px 11px;border-radius:999px;white-space:nowrap}
.cv-status.approved{background:rgba(51,214,159,.15);color:#0f7a3d}
.cv-status.rejected{background:rgba(230, 0, 35,.1);color:#b30019}
.cv-drawer-back{position:fixed;inset:0;z-index:1300;background:rgba(4,7,14,.5);backdrop-filter:blur(6px);display:grid;place-items:center;padding:24px}
.cv-drawer{width:560px;max-width:100%;max-height:88vh;background:var(--panel);border:1px solid var(--stroke2);border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.4);overflow:hidden;display:flex;flex-direction:column;animation:cv-pop .24s cubic-bezier(.2,.9,.25,1)}
@keyframes cv-pop{from{transform:scale(.96);opacity:0}to{transform:none;opacity:1}}
.cv-dr-head{flex:none;display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:18px 20px 12px;border-bottom:1px solid var(--stroke)}
.cv-dr-nm{font-size:16px;font-weight:800;color:var(--txt)}
.cv-x{flex:none;width:32px;height:32px;border:none;border-radius:9px;cursor:pointer;background:var(--surface);color:var(--muted)}
.cv-dr-body{flex:1;overflow-y:auto;padding:16px 20px}
.cv-sec-t{font-size:12.5px;font-weight:800;color:var(--txt);text-transform:none;margin:16px 0 8px;padding-top:12px;border-top:1px dashed var(--stroke)}
.cv-sec-t:first-child{margin-top:0;padding-top:0;border-top:none}
.cv-kv{display:flex;justify-content:space-between;gap:10px;font-size:13px;padding:5px 0}
.cv-kv span{color:var(--muted)}
.cv-score{font-size:13px;margin:8px 0;line-height:1.6}
.cv-frozen{color:#b45309;font-size:12px;font-weight:600}
.cv-map{height:150px;border-radius:11px;overflow:hidden;margin:8px 0 2px;border:1px solid var(--stroke2)}
.cv-visit{padding:9px 11px;border-radius:9px;background:var(--surface2);margin-bottom:7px}
.cv-visit-h{display:flex;justify-content:space-between;font-size:12.5px;color:var(--txt)}
.cv-files{display:flex;flex-direction:column;gap:7px}
.cv-file{display:flex;align-items:center;gap:8px;padding:9px 12px;border-radius:9px;border:1px solid var(--stroke2);background:var(--surface);cursor:pointer;font-family:var(--font);font-size:12.5px;color:var(--accent-deep);font-weight:600;text-align:left}
.cv-file:hover{background:var(--accent-soft)}
.cv-note{font-size:13px;color:var(--txt);line-height:1.6;background:var(--surface2);border-radius:10px;padding:11px 13px}
.cv-dr-foot{flex:none;display:flex;gap:10px;justify-content:flex-end;padding:14px 20px;border-top:1px solid var(--stroke);background:var(--surface)}
.cv-confirm{font-size:13.5px;color:var(--txt);line-height:1.6;margin-bottom:10px}
.cv-clist{margin:0 0 6px;padding-left:20px;font-size:13px;color:var(--txt);line-height:1.85}
.cv-reasons{display:flex;flex-direction:column;gap:7px;margin-bottom:10px}
.cv-reason{display:flex;align-items:center;gap:9px;padding:9px 12px;border-radius:9px;border:1px solid var(--stroke2);cursor:pointer;font-size:13px;color:var(--txt)}
.cv-reason.on{border-color:var(--accent);background:var(--accent-soft);color:var(--accent-deep);font-weight:700}
.cv-note-in{width:100%;min-height:70px;border-radius:9px;border:1px solid var(--stroke2);padding:9px 11px;font-family:var(--font);font-size:13px;resize:vertical}
.cv-modal-foot{display:flex;gap:9px;justify-content:flex-end;margin-top:14px}
.cv-preview{padding:8px}
.cv-prev-img,.cv-prev-pdf{display:flex;flex-direction:column;align-items:center;gap:10px;padding:34px;text-align:center;color:var(--txt);font-size:13px;background:var(--surface2);border-radius:12px}
@media(max-width:520px){.cv-drawer{width:100%;max-height:92vh}}
`;

/* ═══════════════════════════════════════════════════════════════════════════
   หน้า "จัดการข้อมูล" แยกเป็น 4 หน้าตามเมนูซ้าย (เดิมเป็นแท็บอยู่ในหน้าเดียว)
     จัดการข้อมูล      → ตารางข้อมูลลูกค้าและ Lead ที่มีอยู่ในระบบ  (DataRecords)
       ├ นำเข้าข้อมูล      → ตัวช่วยนำเข้าไฟล์ Excel 4 ขั้นตอน        (DataImport)
       ├ จัดการไฟล์นำเข้า  → ประวัติไฟล์ + จัดการรายการค้าง          (DataFiles)
       └ จัดการ Lead     → ไปป์ไลน์ตรวจ/อนุมัติ Lead               (DataLeads)
   staging/leads ถูกเก็บไว้ที่ระดับโมดูล เพราะการสลับเมนูทำให้คอมโพเนนต์ remount
   ถ้าเก็บใน useState เฉย ๆ สิ่งที่ผู้ใช้จัดการไปแล้วจะรีเซ็ตทุกครั้งที่เปลี่ยนหน้า
   ═══════════════════════════════════════════════════════════════════════════ */
const SHARED = { staging:null, leads:null };
function useShared(key, gen){
  const [v,setV] = useState(()=> SHARED[key] || (SHARED[key] = gen()));
  const set = up => setV(prev=>{ const next = typeof up==="function" ? up(prev) : up; SHARED[key]=next; return next; });
  return [v,set];
}
// หัวหน้าเพจร่วมของทั้ง 4 หน้า — มีแค่ชื่อหน้ากับตัวเลขสรุป
// (ไม่มีบรรทัดหมวด "การดูแลระบบ" และไม่มีคำบรรยายใต้หัวข้อ ตามที่ผู้ใช้กำหนด)
const DmHead = ({title, caption}) => html`
  <div class="page-head"><div><h1>${title}</h1>
    ${caption ? html`<div class="dm-caption">${caption}</div>` : ""}
  </div></div>`;

/* ───────── หน้าหลัก: ตารางข้อมูลลูกค้าและ Lead ที่มีอยู่ในระบบ ───────── */
/* ตัวช่วยของคอลัมน์ติดต่อในตาราง — เขียนไว้นอกเทมเพลตเพราะ regex ในเทมเพลตทำให้ตัวแยกพัง */
const telHref  = v => "tel:+66" + String(v).split(",")[0].replace(/[^0-9]/g, "").replace(/^0/, "");
const webHref  = v => String(v).toLowerCase().indexOf("http") === 0 ? String(v) : "https://" + v;
const webShort = v => String(v).replace("https://", "").replace("http://", "");

const REC_PAGE = 15;
export function DataManagement(){
  const {db, updateRecord, adminDeleteRecord}=useApp();
  const [editRec,setEditRec]=useState(null);   // ระเบียนที่กำลังแก้ไข (เปิด AddRecordsForm โหมดแก้ไข)
  const [delRec,setDelRec]=useState(null);     // ระเบียนที่รอยืนยันลบ
  const [kind,setKind]=useState("all");      // all | Existing | Prospect
  const [prov,setProv]=useState("All");
  const [seg,setSeg]=useState("All");
  const [q,setQ]=useState("");
  const [page,setPage]=useState(1);

  const custs=db.customers||[], pros=db.prospects||[];
  const loading = !custs.length && !pros.length;
  const rows = useMemo(()=>[
    ...custs.map(c=>({...c, _kind:"Existing"})),
    ...pros.map(p=>({...p, _kind:"Prospect"})),
  ],[custs,pros]);

  const provOpts = useMemo(()=>{
    const set=[...new Set(rows.map(r=>r.province).filter(Boolean))]
      .sort((a,b)=>provinceTH(a).localeCompare(provinceTH(b),"th"));
    return [["All","ทุกจังหวัด"], ...set.map(p=>[p, provinceTH(p)])];
  },[rows]);

  const kw=q.trim().toLowerCase();
  const shown = rows.filter(r=>
       (kind==="all" || r._kind===kind)
    && (prov==="All" || r.province===prov)
    && (seg==="All"  || r.segment===seg)
    && (!kw || String(r.businessName||"").toLowerCase().includes(kw)
            || String(r.accountNo||r.id||"").toLowerCase().includes(kw)));
  const pages=Math.max(1,Math.ceil(shown.length/REC_PAGE));
  const pg=Math.min(page,pages);
  const pageRows=shown.slice((pg-1)*REC_PAGE, pg*REC_PAGE);
  const reset = fn => (...a)=>{ setPage(1); fn(...a); };

  const COLS=[
    { h:"ประเภท", w:"104px", render:r=> r._kind==="Existing"
        ? html`<${Badge} tone="good">ลูกค้า</${Badge}>` : html`<${Badge} tone="neutral">Lead</${Badge}>` },
    { h:"รหัส", w:"116px", render:r=>html`<span class="mono" style=${{fontSize:"12px"}}>${r.accountNo||r.id}</span>` },
    { h:"ชื่อธุรกิจ", render:r=>html`<div style=${{fontWeight:600,fontSize:"13.5px"}}>${r.businessName}</div>` },
    { h:"หมวดธุรกิจ", w:"190px", render:r=>SEG_TH[r.segment]||r.segment },
    { h:"เบอร์โทรศัพท์", w:"160px", render:r=> r.phone
        ? html`<a class="rec-lk" href=${telHref(r.phone)}>${r.phone}</a>`
        : html`<span class="dim">—</span>` },
    { h:"เว็บไซต์", w:"200px", render:r=> r.website
        ? html`<a class="rec-lk" href=${webHref(r.website)} target="_blank" rel="noopener noreferrer"
            title=${r.website}>${webShort(r.website)}</a>`
        : html`<span class="dim">—</span>` },
    { h:"จัดการ", w:"96px", render:r=>html`<div class="rec-act">
      <button class="rec-ic" title="แก้ไข" aria-label=${"แก้ไข "+r.businessName}
        onClick=${()=>setEditRec(r)}><${Icon} name="edit" size=${15}/></button>
      <button class="rec-ic del" title="ลบ" aria-label=${"ลบ "+r.businessName}
        onClick=${()=>setDelRec(r)}><${Icon} name="trash" size=${15}/></button>
    </div>` },
  ];

  return html`<div class="page fade-in">
    <${DmHead} title="จัดการข้อมูล"
      caption=${`ลูกค้า ${num(custs.length)} ราย · Lead ${num(pros.length)} ราย · รวม ${num(rows.length)} รายการ`}/>

    <div class="grid g4" style=${{marginBottom:"14px"}}>
      <${Kpi} label="ลูกค้าในระบบ" value=${num(custs.length)} icon="users"/>
      <${Kpi} label="Lead ในระบบ" value=${num(pros.length)} icon="target"/>
      <${Kpi} label="จังหวัดที่มีข้อมูล" value=${num(new Set(rows.map(r=>r.province)).size)} icon="map"/>
      <${Kpi} label="แสดงตามตัวกรอง" value=${num(shown.length)} icon="filter"/>
    </div>

    <div class="op-slicers" style=${{marginBottom:"12px"}}>
      <label class="op-lab">ค้นหา
        <input class="dm-input" style=${{minWidth:"200px"}} placeholder="ชื่อธุรกิจ หรือ รหัส…" value=${q}
          onInput=${e=>{setPage(1);setQ(e.target.value);}}/></label>
      <label class="op-lab">ประเภท
        <${Dropdown} value=${kind} onChange=${reset(setKind)}
          options=${[["all","ทั้งหมด"],["Existing","ลูกค้า"],["Prospect","Lead"]]}/></label>
      <label class="op-lab">จังหวัด
        <${Dropdown} value=${prov} onChange=${reset(setProv)} options=${provOpts}/></label>
      <label class="op-lab">หมวดธุรกิจ
        <${Dropdown} value=${seg} onChange=${reset(setSeg)}
          options=${[["All","ทุกหมวด"], ...SEGMENTS.map(s=>[s, SEG_TH[s]])]}/></label>
    </div>

    <${Card} pad0=${true}>
      <${Table} cols=${COLS} rows=${pageRows}
        empty=${loading ? "กำลังโหลดข้อมูลธุรกิจ…" : "ไม่มีรายการตามเงื่อนไขนี้"}/>
    </${Card}>

    ${pages>1 ? html`<div class="dm-pager">
      <span class="dim">หน้า ${pg} จาก ${num(pages)} · ทั้งหมด ${num(shown.length)} รายการ</span>
      <div class="row" style=${{gap:"6px"}}>
        <button class="dm-pg" disabled=${pg<=1} onClick=${()=>setPage(pg-1)}>‹</button>
        ${pageWindow(pg,pages).map(n=> n==="…"
          ? html`<span key=${"g"+Math.random()} class="dim" style=${{padding:"0 4px"}}>…</span>`
          : html`<button key=${n} class=${"dm-pg"+(n===pg?" on":"")} onClick=${()=>setPage(n)}>${n}</button>`)}
        <button class="dm-pg" disabled=${pg>=pages} onClick=${()=>setPage(pg+1)}>›</button>
      </div>
    </div>` : ""}
    ${editRec ? html`<${AddRecordsForm} db=${db} editRecord=${{...editRec, status:editRec._kind}}
      onClose=${()=>setEditRec(null)}
      onSave=${recs=>{ updateRecord && updateRecord(recs); setEditRec(null); }}/>` : ""}

    ${delRec ? html`<${Modal} title="ยืนยันการลบ" onClose=${()=>setDelRec(null)}
      footer=${html`<${Btn} variant="ghost" onClick=${()=>setDelRec(null)}>ยกเลิก</${Btn}>
        <${Btn} variant="danger" icon="trash" onClick=${()=>{ adminDeleteRecord && adminDeleteRecord(delRec); setDelRec(null); }}>ยืนยันลบ</${Btn}>`}>
      <div style=${{fontSize:"13px",lineHeight:1.8}}>ลบ <b>${delRec.businessName}</b> (${delRec.accountNo||delRec.id}) ออกจากระบบ?
        <div class="dim" style=${{marginTop:"6px"}}>บันทึกลงบันทึกการตรวจสอบ · ย้อนกลับไม่ได้จากหน้านี้</div></div>
    </${Modal}>` : ""}
    <style>${DM_CSS}</style>
  </div>`;
}
// เลขหน้าแบบย่อ (1 … 12 13 14 … 205) — ตารางนี้มีหลายพันรายการ จะไล่ปุ่มทุกหน้าไม่ไหว
function pageWindow(cur, total){
  if(total<=7) return Array.from({length:total},(_,i)=>i+1);
  const out=[1];
  const from=Math.max(2,cur-1), to=Math.min(total-1,cur+1);
  if(from>2) out.push("…");
  for(let i=from;i<=to;i++) out.push(i);
  if(to<total-1) out.push("…");
  out.push(total);
  return out;
}

/* ───────── เมนูย่อย 1: นำเข้าข้อมูล ───────── */
export function DataImport(){
  const [staging,setStaging]=useShared("staging", genStaging);
  const importedTotal=IMPORTS.reduce((a,b)=>a+b.done,0);
  const latestImport=IMPORTS[0];
  return html`<div class="page fade-in">
    <${DmHead} title="นำเข้าข้อมูล" caption=${`นำเข้าจากไฟล์สะสม ${num(importedTotal)} รายการ${latestImport?` · นำเข้าล่าสุด ${beDate(latestImport.dt)}`:""}`}/>
    <${ImportWizard} resumeFile=${null} staging=${staging} setStaging=${setStaging} onExitResume=${()=>{}}/>
    <style>${DM_CSS}</style>
  </div>`;
}

/* ───────── เมนูย่อย 2: จัดการไฟล์นำเข้า (รวมโหมด "จัดการรายการค้าง" ไว้ในหน้าเดียวกัน) ───────── */
export function DataFiles(){
  const [staging,setStaging]=useShared("staging", genStaging);
  const [resumeFile,setResumeFile]=useState(null);
  const stagePending=staging.filter(r=>r.status==="pending").length;
  return html`<div class="page fade-in">
    <${DmHead} title="จัดการไฟล์นำเข้า" caption=${stagePending?`ยังมีรายการค้างจัดการ ${num(stagePending)} รายการ`:"ไม่มีรายการค้างจัดการ"}/>
    ${resumeFile
      ? html`<${ImportWizard} resumeFile=${resumeFile} staging=${staging} setStaging=${setStaging}
          onExitResume=${()=>setResumeFile(null)}/>`
      : html`<${ImportFiles} staging=${staging}
          onManagePending=${fileId=>setResumeFile(IMPORTS.find(f=>f.id===fileId)||null)}/>`}
    <style>${DM_CSS}</style>
  </div>`;
}

/* ───────── เมนูย่อย 3: จัดการ Lead ───────── */
export function DataLeads(){
  const [leads,setLeads]=useShared("leads", genLeads);
  const todo=leads.filter(l=>l.status==="pending").length;
  return html`<div class="page fade-in">
    <${DmHead} title="จัดการ Lead" caption=${todo?`มีรายการที่ต้องจัดการ ${num(todo)} รายการ`:"ไม่มีรายการค้างจัดการ"}/>
    <${LeadManagement} leads=${leads} setLeads=${setLeads}/>
    <style>${DM_CSS}</style>
  </div>`;
}

const DM_CSS=`
/* ปุ่มไอคอนในคอลัมน์ "จัดการ" ของตารางข้อมูล */
.rec-lk{color:var(--txt);text-decoration:none;display:inline-block;max-width:100%;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom}
.rec-lk:hover{color:var(--accent-deep);text-decoration:underline;text-underline-offset:3px}
.rec-act{display:flex;gap:6px;justify-content:flex-start}
.rec-ic{width:30px;height:30px;display:inline-grid;place-items:center;cursor:pointer;padding:0;
  border:1px solid var(--stroke2);border-radius:8px;background:var(--surface);color:var(--muted)}
.rec-ic:hover{border-color:var(--accent);color:var(--accent)}
.rec-ic.del:hover{border-color:#dc2626;color:#dc2626;background:rgba(220,38,38,.06)}
.dm-stepper{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}
.dm-step{display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:12px;border:1px solid var(--stroke2);background:var(--surface);font-size:13px;font-weight:600;color:var(--muted)}
.dm-step.on{border-color:var(--accent);color:var(--txt);background:var(--accent-soft)}
.dm-step.done{color:var(--good);border-color:rgba(51,214,159,.4)}
.dm-step-no{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--stroke);color:var(--txt);font-size:12px;font-weight:800}
.dm-step.on .dm-step-no{background:var(--accent);color:#fff}
.dm-step.done .dm-step-no{background:var(--good);color:#04121a}
.dm-drop{border:2px dashed var(--stroke2);border-radius:16px;padding:38px;text-align:center;cursor:pointer;transition:.15s;background:var(--surface)}
.dm-drop:hover{border-color:var(--accent);background:var(--accent-soft)}
.dm-drop.err{border-color:var(--bad)}
.dm-fileerr{margin-top:12px;color:var(--bad);font-size:12.5px;font-weight:600}
.dm-filecard{display:flex;align-items:center;gap:12px;margin-top:14px;padding:13px 15px;border-radius:12px;border:1px solid var(--stroke2);background:var(--surface)}
.dm-sel,.dm-input{padding:8px 11px;border-radius:9px;border:var(--dropdown-border);background:var(--dropdown-bg);color:var(--dropdown-text);font-family:var(--font);font-size:13px;box-shadow:var(--dropdown-shadow)}
.dm-input{min-width:220px}
/* ── Drawer แก้ไขแถว (ขั้นตอนที่ 3) ── */
.dm-input.err,select.dm-input.err{border-color:#e11d48!important;box-shadow:0 0 0 2px rgba(225,29,72,.12)}
.dm-erd-back{position:fixed;inset:0;z-index:1300;background:rgba(4,7,14,.5);backdrop-filter:blur(6px);display:grid;place-items:center;padding:24px}
.dm-erd{width:560px;max-width:100%;max-height:88vh;background:var(--panel);border:1px solid var(--stroke2);border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.4);overflow:hidden;display:flex;flex-direction:column;animation:dm-erd-pop .24s cubic-bezier(.2,.9,.25,1)}
@keyframes dm-erd-pop{from{transform:scale(.96);opacity:0}to{transform:none;opacity:1}}
.dm-erd-head{flex:none;display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:18px 20px 12px;border-bottom:1px solid var(--stroke)}
.dm-erd-nm{font-size:16px;font-weight:800;color:var(--txt)}
.dm-erd-x{flex:none;width:32px;height:32px;border:none;border-radius:9px;cursor:pointer;background:var(--surface);color:var(--muted)}
.dm-erd-body{flex:1;overflow-y:auto;padding:16px 20px}
.dm-erd-grid{display:flex;flex-direction:column;gap:13px}
.dm-erd-f{display:flex;flex-direction:column;gap:5px}
.dm-erd-f label{font-size:12.5px;font-weight:600;color:var(--muted)}
.dm-erd-f .dm-input,.dm-erd-f select.dm-input{width:100%;min-width:0;box-sizing:border-box}
.dm-erd-err{font-size:11.5px;color:#c81e1e;display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.dm-swap{padding:3px 9px;border-radius:7px;border:1px solid #e11d48;background:rgba(225,29,72,.08);color:#c81e1e;font-family:var(--font);font-size:11px;font-weight:700;cursor:pointer}
.dm-swap:hover{background:rgba(225,29,72,.16)}
.dm-erd-foot{flex:none;display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;padding:14px 20px;border-top:1px solid var(--stroke);background:var(--surface)}
.dm-cmp2{display:grid;grid-template-columns:88px 1fr 1fr;gap:8px;align-items:center;padding:6px 0;font-size:12.5px;border-bottom:1px solid var(--stroke)}
.dm-cmp2-h{color:var(--muted);font-weight:700}
.dm-cmp2.diff{background:rgba(255,176,46,.1);border-radius:6px;margin:0 -6px;padding:6px}
.dm-cmp2-l{color:var(--muted)}
.dm-cmp2-c{display:flex;align-items:center;gap:6px;padding:5px 7px;border-radius:7px;border:1px solid var(--stroke2);cursor:pointer;color:var(--txt);word-break:break-word}
.dm-cmp2-c.on{border-color:var(--accent);background:var(--accent-soft)}
@media(max-width:520px){.dm-erd{width:100%;max-height:92vh}}
.dm-auto{font-size:10.5px;font-weight:700;color:var(--accent2);background:var(--accent-soft);padding:2px 7px;border-radius:6px;white-space:nowrap}
.dm-alert{display:flex;align-items:center;gap:8px;margin-top:12px;padding:10px 13px;border-radius:10px;font-size:12.5px;background:rgba(120,160,220,.08);border:1px solid var(--stroke2);color:var(--txt)}
.dm-alert.bad{background:rgba(255,90,90,.1);border-color:rgba(255,90,90,.35);color:#c81e1e}
.dm-alert.warn{background:rgba(255,176,46,.1);border-color:rgba(255,176,46,.35);color:#b45309}
.dm-check{display:flex;align-items:center;gap:8px;margin-top:14px;font-size:12.5px;color:var(--txt);cursor:pointer}
.dm-chip{padding:6px 13px;border-radius:999px;border:1px solid var(--stroke2);background:var(--surface);color:var(--muted);font-family:var(--font);font-size:12.5px;font-weight:600;cursor:pointer}
.dm-chip.on{background:var(--accent);border-color:var(--accent);color:#fff}
/* ── จัดการไฟล์นำเข้า: สรุปค้าง · ผลการนำเข้า · สถานะ · แถบโหมดจัดการรายการค้าง ── */
.dm-imp{font-size:12.5px;color:var(--txt);white-space:nowrap}
.dm-imp-ok{color:#0f7a3d;font-weight:700}
.dm-imp-pend{color:#b45309;font-weight:700}
.dm-imp-pend.zero{color:var(--muted);font-weight:500}
.dm-imp-skip{color:var(--muted)}
.dm-fstat{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dm-fdays{font-size:11.5px;color:var(--muted);white-space:nowrap}
.dm-fdays.warn{color:#c2410c;font-weight:700}
.dm-resume-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:16px;padding:12px 15px;border-radius:12px;background:var(--accent-soft);border:1px solid var(--accent)}
.dm-resume-bar b{color:var(--txt);font-size:14px}
.dm-pager{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:12px;font-size:12.5px}
.dm-pg{min-width:30px;height:30px;border-radius:8px;border:1px solid var(--stroke2);background:var(--surface);color:var(--txt);font-family:var(--font);font-weight:600;cursor:pointer}
.dm-pg.on{background:var(--accent);border-color:var(--accent);color:#fff}
.dm-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.dm-summary>div{padding:13px 15px;border-radius:12px;border:1px solid var(--stroke2);background:var(--surface);display:flex;flex-direction:column;gap:5px}
.dm-summary .dim{font-size:12px}.dm-summary b{font-size:18px}
.dm-result{text-align:center;padding:30px 20px}
.dm-result-ic,.dm-empty-ic{width:64px;height:64px;border-radius:50%;background:rgba(51,214,159,.12);display:grid;place-items:center;margin:0 auto}
.dm-wiznav{display:flex;justify-content:space-between;gap:10px;margin-top:20px;padding-top:16px;border-top:1px solid var(--stroke)}
.dm-toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
.dm-link{background:none;border:none;color:var(--accent2);font-family:var(--font);font-size:13px;font-weight:600;cursor:pointer;padding:0;text-align:left}
.dm-link:hover{text-decoration:underline}
.dm-bulk{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;padding:9px 13px;border-radius:10px;background:var(--accent-soft);border:1px solid var(--accent)}
.dm-kv{display:flex;justify-content:space-between;gap:14px;padding:9px 0;border-bottom:1px solid var(--stroke);font-size:13px}
.dm-kv span{color:var(--muted)}
.dm-cf{border:1px solid var(--stroke2);border-radius:14px;padding:15px 16px;margin-bottom:14px;background:var(--surface)}
.dm-cf-head{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:var(--txt);margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--stroke)}
.dm-cf-cols,.dm-cf-row,.dm-merge-row{display:grid;grid-template-columns:150px 1fr 1fr;gap:12px;align-items:center}
.dm-cf-row{padding:6px 0;font-size:13px}
.dm-cf-row.diff{background:rgba(255,176,46,.09);border-radius:8px;padding:6px 8px;margin:0 -8px}
.dm-cf-lb{color:var(--muted);font-size:12px}
.dm-src{font-size:11px;font-weight:800;padding:3px 9px;border-radius:6px}
.dm-src.file{background:rgba(255,176,46,.16);color:#b45309}
.dm-src.tc{background:rgba(57,135,229,.16);color:#3987e5}
.dm-cf-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;padding-top:12px;border-top:1px solid var(--stroke)}
.dm-merge-row{padding:8px 0;border-bottom:1px solid var(--stroke);font-size:13px}
.dm-radio{display:flex;align-items:center;gap:7px;cursor:pointer}
.dm-empty{text-align:center;padding:50px 20px}
.dm-empty h3{margin:14px 0 4px}
/* ── ตรวจสอบและแก้ไขข้อมูล (Triage) ── */
.dm-caption{font-size:12.5px;color:var(--muted);margin-top:6px}
/* ตัวกรองแบบ chip แนวนอน (ไม่ใช่การ์ด KPI) — สูง ~40px กดได้ทั้งใบ */
.dm-tri-chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
.dm-fchip{display:inline-flex;align-items:center;gap:7px;height:40px;padding:0 13px;border-radius:999px;border:1px solid var(--stroke2);
  background:var(--surface);color:var(--txt);font-family:var(--font);font-size:12.5px;font-weight:600;cursor:pointer;transition:.15s}
.dm-fchip:hover{border-color:var(--accent);background:var(--accent-soft)}
.dm-fchip.on{border-color:var(--accent);background:var(--accent);color:#fff}
.dm-fchip.on :where(svg){color:#fff!important}
.dm-fchip b{font-weight:800}
.dm-fchip.ghost{border-style:dashed}
.dm-focus-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px;padding:8px 13px;
  border-radius:10px;background:var(--surface2);border:1px solid var(--stroke2);font-size:12.5px;color:var(--txt)}
/* ตัวอย่างข้อมูลรวมในขั้นจับคู่คอลัมน์ */
.dm-preview{margin-top:16px;border:1px solid var(--stroke2);border-radius:12px;overflow:hidden}
.dm-preview-h{padding:10px 14px;font-size:12.5px;font-weight:700;color:var(--txt);background:var(--surface2);border-bottom:1px solid var(--stroke)}
.dm-preview-scroll{overflow-x:auto}
.dm-preview-tbl{border-collapse:collapse;width:100%;font-size:12px;white-space:nowrap}
.dm-preview-tbl th{text-align:left;padding:8px 12px;color:var(--muted);font-weight:600;border-bottom:1px solid var(--stroke);background:var(--surface)}
.dm-preview-tbl td{padding:8px 12px;color:var(--txt);border-bottom:1px solid var(--stroke)}
.dm-preview-tbl tr:last-child td{border-bottom:none}
.dm-impact{margin:4px 0 10px;padding-left:18px;font-size:13px;color:var(--txt);display:flex;flex-direction:column;gap:6px}
.dm-impact li{line-height:1.5}
.dm-issue-box{background:var(--surface2);border:1px solid var(--stroke2);border-radius:10px;padding:10px 12px;font-size:12.5px;color:var(--txt);display:flex;flex-direction:column;gap:4px}
.dm-frm{display:grid;grid-template-columns:1fr 1fr;gap:11px 12px;margin-top:14px}
.dm-frm-f{display:flex;flex-direction:column;gap:5px}
.dm-frm-f:first-child,.dm-frm-f:nth-last-child(1){grid-column:1/-1}
.dm-frm-lb{font-size:12px;color:var(--muted);font-weight:600}
.dm-frm .dm-input,.dm-frm .dm-sel{width:100%;min-width:0}
.dm-input.miss,.dm-sel.miss{border-color:var(--bad)!important;background:rgba(255,90,90,.06)}
.dm-frm-hint{font-size:11.5px;color:var(--muted);margin-top:8px;grid-column:1/-1}
.dm-coordbox{background:rgba(255,90,90,.06);border:1px solid rgba(255,90,90,.3);border-radius:11px;padding:12px 13px;display:flex;flex-direction:column;gap:9px;margin-bottom:4px}
.dm-coord-note{display:flex;align-items:center;gap:7px;font-size:12px;color:#c81e1e}
.dm-drawer-act{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;padding-top:14px;border-top:1px solid var(--stroke)}
.dm-merge-row.diff{background:rgba(255,176,46,.09);border-radius:8px;padding:8px;margin:0 -4px}
@media(max-width:1100px){.dm-summary{grid-template-columns:repeat(2,1fr)}}
@media(max-width:820px){.dm-cf-cols,.dm-cf-row,.dm-merge-row{grid-template-columns:1fr}.dm-cf-lb{font-weight:700}.dm-frm{grid-template-columns:1fr}}
`;

/* ═══════════════════════════════════════════════════════════════════════════
   จัดการขอบเขตพื้นที่การขาย (Sales Territory) — ส่วนท้ายของหน้า "จัดการข้อมูล"
   เอกสารข้อ 2–4: TC หนึ่งคน = ขอบเขตพื้นที่บริการหนึ่งชุด · จังหวัดที่ไม่มี TC = "พื้นที่ไร้ผู้ดูแล (no man's land)"
   หน่วยพื้นที่ = จังหวัด (77 จังหวัด · ชื่อคีย์ตรงกับ properties.name ใน data/thailand-provinces.geojson
     ซึ่งเป็นชุดขอบเขตเดียวกับ mask/ชั้นจังหวัดของแมพ — มอบหมายที่นี่แล้วอ้างขอบเขตเดียวกันได้ทันที)
   TC = ผู้ใช้จำลองบทบาท "ผู้ประสานงานการค้า" (SEED_USERS หน้าจัดการผู้ใช้) — ตัวตนไม่ผูกกับชื่อจังหวัด
   ยังไม่รองรับโซนย่อยระดับย่าน (สีลม/ทองหล่อ/ลาดพร้าว) — รอไฟล์ขอบเขตจากลูกค้า จึงกำหนดได้ถึงระดับจังหวัด
   ไม่ใช้เกรด A/B/C หรือคะแนนศักยภาพ — คอลัมน์ "Lead" อ้าง high-demand gap ของจังหวัดที่มีข้อมูลจริง
   ═══════════════════════════════════════════════════════════════════════════ */

const TC_USERS  = SEED_USERS.filter(u=>u.role==="Trade Coordinator");
const TC_BY_ID  = Object.fromEntries(TC_USERS.map(u=>[u.id,u]));
// สีประจำ TC มาจาก "ข้อมูลหลัก › ผู้ประสานงานการค้า (TC)" — แก้ที่นั่นแล้วแผนที่นี้เปลี่ยนตาม
// ถ้ายังไม่ได้ตั้งค่า จะถอยไปใช้จานสีตั้งต้นตามลำดับรายชื่อ
const tcColor   = id => tcMasterColor(id) || TC_COLORS[Math.max(0, TC_USERS.findIndex(u=>u.id===id)) % TC_COLORS.length];
// จังหวัดข้างเคียงที่ TC แต่ละคนดูแลเพิ่มจาก "จังหวัดหลัก" ในโปรไฟล์ผู้ใช้ (ค่าตั้งต้นจำลอง)
const TC_EXTRA_COVER = { 3:["Nonthaburi","Pathum Thani","Samut Prakan"], 4:["Rayong","Chachoengsao"],
  6:["Lamphun","Chiang Rai"], 7:["Phangnga","Krabi"] };
const seedTerritory = () => { const m={};
  for(const u of TC_USERS){ if(u.province) m[u.province]=u.id;
    for(const pv of (TC_EXTRA_COVER[u.id]||[])) m[pv]=u.id; }
  return m; };
/* ภูมิภาค 6 ภาค — ครบ 77 จังหวัด (เหนือ 9 · อีสาน 20 · กลาง 22 · ตะวันออก 7 · ตะวันตก 5 · ใต้ 14)
   ใช้คีย์ภาษาอังกฤษชุดเดียวกับ provincesGeo · "Pattaya" ในชุดข้อมูลนี้คือชลบุรี */
const REGIONS = [
  ["north","ภาคเหนือ",["Chiang Mai","Chiang Rai","Lampang","Lamphun","Mae Hong Son","Nan","Phayao","Phrae","Uttaradit"]],
  ["northeast","ภาคตะวันออกเฉียงเหนือ",["Amnat Charoen","Bueng Kan","Buri Ram","Chaiyaphum","Kalasin","Khon Kaen","Loei",
    "Maha Sarakham","Mukdahan","Nakhon Phanom","Nakhon Ratchasima","Nong Bua Lam Phu","Nong Khai","Roi Et","Sakon Nakhon",
    "Si Sa Ket","Surin","Ubon Ratchathani","Udon Thani","Yasothon"]],
  ["central","ภาคกลาง",["Ang Thong","Bangkok Metropolis","Chai Nat","Kamphaeng Phet","Lop Buri","Nakhon Nayok","Nakhon Pathom",
    "Nakhon Sawan","Nonthaburi","Pathum Thani","Phetchabun","Phichit","Phitsanulok","Phra Nakhon Si Ayutthaya","Samut Prakan",
    "Samut Sakhon","Samut Songkhram","Saraburi","Sing Buri","Sukhothai","Suphan Buri","Uthai Thani"]],
  ["east","ภาคตะวันออก",["Chachoengsao","Chanthaburi","Pattaya","Prachin Buri","Rayong","Sa Kaeo","Trat"]],
  ["west","ภาคตะวันตก",["Kanchanaburi","Phetchaburi","Prachuap Khiri Khan","Ratchaburi","Tak"]],
  ["south","ภาคใต้",["Chumphon","Krabi","Nakhon Si Thammarat","Narathiwat","Pattani","Phangnga","Phatthalung","Phuket",
    "Ranong","Satun","Songkhla","Surat Thani","Trang","Yala"]],
];
const REGION_OF = Object.fromEntries(REGIONS.flatMap(([k,,provs])=>provs.map(pv=>[pv,k])));
const REGION_TH = Object.fromEntries(REGIONS.map(([k,th])=>[k,th]));

// 77 จังหวัด เรียงตามชื่อไทย (ชุดคีย์เดียวกับ provincesGeo — ตรวจแล้วว่าตรงกันทุกชื่อ)
const ALL_PROVINCES = Object.keys(PROVINCE_TH).sort((a,b)=>provinceTH(a).localeCompare(provinceTH(b),"th"));
const TR_PAGE = 12;

/* GeoJSON → เส้นทาง SVG ต่อจังหวัด (equirectangular ปรับแกน x ตาม cos(ละติจูดกลาง) — ไทยแคบ พอเพียงและเบา)
   ลดจำนวนจุดต่อวงแหวนไม่เกิน ~260 จุด เพื่อให้ DOM เบา (รูปทรงจังหวัดยังอ่านออกในขนาดย่อ) */
function buildProvincePaths(geo){
  if(!geo || !geo.features) return null;
  const rings=[]; let laMin=90,laMax=-90,lnMin=180,lnMax=-180;
  for(const f of geo.features){
    const g=f.geometry, nm=f.properties && f.properties.name; if(!g||!nm) continue;
    const polys = g.type==="Polygon" ? [g.coordinates] : g.type==="MultiPolygon" ? g.coordinates : [];
    for(const poly of polys){
      const ring=poly[0]; if(!ring || ring.length<4) continue;
      const step=Math.max(1, Math.ceil(ring.length/260)); const pts=[];
      for(let i=0;i<ring.length;i+=step) pts.push(ring[i]);
      pts.push(ring[ring.length-1]);
      for(const c of pts){ const ln=c[0], la=c[1];
        if(la<laMin)laMin=la; if(la>laMax)laMax=la; if(ln<lnMin)lnMin=ln; if(ln>lnMax)lnMax=ln; }
      rings.push([nm,pts]);
    }
  }
  if(!rings.length) return null;
  const kx=Math.cos((laMin+laMax)/2*Math.PI/180);
  const W=420, H=Math.round(W*(laMax-laMin)/((lnMax-lnMin)*kx));
  const sx=W/((lnMax-lnMin)*kx), sy=H/(laMax-laMin);
  const byProv={};
  for(const [nm,pts] of rings){
    let d="M";
    for(let i=0;i<pts.length;i++){
      const x=((pts[i][0]-lnMin)*kx*sx).toFixed(1), y=((laMax-pts[i][1])*sy).toFixed(1);
      d += (i? "L":"")+x+" "+y;
    }
    byProv[nm]=(byProv[nm]||"")+d+"Z";
  }
  return {W,H,byProv};
}

/* แผนที่ขอบเขต — ระบายสีตาม TC ที่ดูแล · จังหวัดไร้ผู้ดูแลใช้ลายทแยงแดง (เห็นชัดแม้พิมพ์ขาวดำ) */
function TerritoryMap({paths, assign, focus, onFocus}){
  const [hover,setHover]=useState(null);
  if(!paths) return html`<div class="tr-map-load">กำลังโหลดขอบเขตจังหวัด…</div>`;
  const shown = hover || focus;
  const tcOf = pv => TC_BY_ID[assign[pv]];
  return html`<div class="tr-map">
    <svg viewBox=${"0 0 "+paths.W+" "+paths.H} class="tr-map-svg" preserveAspectRatio="xMidYMid meet"
      role="img" aria-label="แผนที่ขอบเขตพื้นที่การขายรายจังหวัด" onMouseLeave=${()=>setHover(null)}>
      <defs>
        <pattern id="trNoMan" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="7" height="7" fill="rgba(220,38,38,.10)"/>
          <line x1="0" y1="0" x2="0" y2="7" stroke="rgba(220,38,38,.55)" stroke-width="2.4"/>
        </pattern>
      </defs>
      ${ALL_PROVINCES.map(pv=>{ const d=paths.byProv[pv]; if(!d) return null;
        const tc=tcOf(pv), on=shown===pv;
        return html`<path key=${pv} d=${d} class=${"tr-path"+(on?" on":"")}
          fill=${tc? tcColor(tc.id)+"3d" : "url(#trNoMan)"}
          stroke=${on? "#161d2b" : (tc? tcColor(tc.id) : "#dc2626")}
          stroke-width=${on? 2.2 : 0.7}
          onMouseEnter=${()=>setHover(pv)}
          onClick=${()=>onFocus(focus===pv?null:pv)}><title>${provinceTH(pv)} · ${tc?tc.name:"ยังไม่มีคนดูแล"}</title></path>`;
      })}
    </svg>
    <div class=${"tr-map-cap"+(shown && !tcOf(shown) ? " none":"")}>
      ${shown ? html`<b>${provinceTH(shown)}</b> · ${tcOf(shown) ? tcOf(shown).name : "ยังไม่มีคนดูแล (no man’s land)"}`
              : "ชี้ที่จังหวัดเพื่อดูผู้ดูแล · คลิกเพื่อกรองตารางด้านล่าง"}
    </div>
  </div>`;
}

export function TerritoryManager(){
  const {db}=useApp();
  const [assign,setAssign] = useState(seedTerritory);   // { ชื่อจังหวัด(อังกฤษ): id ของ TC }
  const [geo,setGeo]       = useState(()=>db.provincesGeo||null);
  const [focus,setFocus]   = useState(null);            // จังหวัดที่คลิกจากแผนที่ (null = ยังไม่ได้เลือก)
  const [pick,setPick]     = useState("");              // TC ที่เลือกไว้ในกล่องมอบหมาย (ยังไม่กดบันทึก)

  // ขอบเขตจังหวัด: ใช้ของที่แอปโหลดไว้แล้วถ้ามี — ไม่มีก็ดึงเอง (ไฟล์ถูกแคชอยู่ในชั้น data.js)
  useEffect(()=>{ if(db.provincesGeo){ setGeo(db.provincesGeo); return; }
    let alive=true; loadProvincesGeo().then(g=>{ if(alive) setGeo(g); }).catch(()=>{});
    return ()=>{ alive=false; }; },[db.provincesGeo]);
  const paths = useMemo(()=>buildProvincePaths(geo),[geo]);

  const areaBy = db.areaByProvince||{};
  const rows = useMemo(()=> ALL_PROVINCES.map(key=>{
    const tc = TC_BY_ID[assign[key]]||null;
    return { key, th:provinceTH(key), tc, covered:!!tc,
      area: areaBy[key]||null };
  }),[assign, areaBy]);

  const coveredN = rows.filter(r=>r.covered).length;
  const noManN   = rows.length-coveredN;
  const idleTC   = TC_USERS.filter(u=>!Object.values(assign).includes(u.id));
  const provOf   = id => rows.filter(r=>r.tc&&r.tc.id===id).map(r=>r.th);

  // จังหวัดที่กำลังเลือกอยู่ + ผู้ดูแลปัจจุบันของจังหวัดนั้น
  const focusRow = focus ? rows.find(r=>r.key===focus) : null;
  const curTCId  = focus && assign[focus] ? String(assign[focus]) : "";
  // เปิดกล่องมอบหมายพร้อมตั้งค่าเริ่มต้นเป็นผู้ดูแลปัจจุบัน (คลิกซ้ำที่จังหวัดเดิม = ปิดกล่อง)
  const focusFromMap = pv => { setFocus(pv); setPick(pv && assign[pv] ? String(assign[pv]) : ""); };
  const provKeysOf = id => rows.filter(r=>r.tc&&r.tc.id===id).map(r=>r.key);

  /* มอบหมาย/ยกเลิกมอบหมาย — ทุกครั้งบันทึกลง Audit Log (เข้าถึงหน้านี้ได้เฉพาะผู้ดูแลระบบ) */
  const applyAssign=(provs, tcId)=>{
    if(!provs.length) return;
    const tc = tcId? TC_BY_ID[Number(tcId)] : null;
    setAssign(m=>{ const n={...m};
      for(const pv of provs){ if(tc) n[pv]=tc.id; else delete n[pv]; }
      return n; });
    const names = provs.map(provinceTH).join(", ");
    pushAudit({ action: tc? "มอบหมายขอบเขตพื้นที่การขาย" : "ยกเลิกมอบหมายขอบเขตพื้นที่การขาย", category:"แก้ไข",
      detail: `${provs.length>1?`${provs.length} จังหวัด · `:""}${names} → ${tc? `${tc.name} (${tc.email})` : "ไม่มีผู้ดูแล (no man’s land)"}` });
    toast(tc ? `มอบหมาย ${provs.length} จังหวัดให้ ${tc.name} แล้ว` : `ยกเลิกผู้ดูแล ${provs.length} จังหวัดแล้ว`, tc?"good":"warn");
  };
  // กดบันทึกในกล่องมอบหมาย → เขียนค่าใหม่ + ปิดกล่อง
  const saveAssign = ()=>{ if(!focus) return; applyAssign([focus], pick||null); setFocus(null); };

  const tcOptions = [["","— ยังไม่มีคนดูแล —"],
    ...TC_USERS.map(u=>[String(u.id), u.name])];


  return html`<div class="page fade-in tr-wrap">
    <div class="page-head"><div><h1>จัดการขอบเขตพื้นที่การขาย</h1></div></div>

    <div class="grid g4" style=${{margin:"16px 0 14px"}}>
      <${Kpi} label="จังหวัดทั้งหมด" value=${num(rows.length)} icon="map"/>
      <${Kpi} label="มีคนดูแล" value=${num(coveredN)} icon="check"/>
      <${Kpi} label="ยังไม่มีคนดูแล" value=${num(noManN)} icon="gap"/>
      <${Kpi} label="TC ที่ยังไม่มีพื้นที่" value=${num(idleTC.length)} icon="user"/>
    </div>

    <div class="tr-grid">
      <${Card} title="แผนที่ขอบเขต" sub="ระบายสีตาม TC ที่ดูแล · ลายทแยงแดง = ยังไม่มีคนดูแล">
        <!-- กล่องมอบหมาย TC — คลิกจังหวัดบนแผนที่แล้วกล่องนี้จะโผล่ขึ้นมา (ใช้แทนตารางเดิม) -->
        ${focusRow ? html`<div class=${"tr-assign"+(focusRow.covered?"":" none")}>
          <div class="tr-as-head">
            <div style=${{minWidth:0}}>
              <div class="tr-as-nm">${focusRow.th}</div>
              <div class="tr-as-sub">${REGION_TH[REGION_OF[focusRow.key]]||"—"} · ${focusRow.covered
                ? "ผู้ดูแลปัจจุบัน: "+focusRow.tc.name : "ยังไม่มีคนดูแล (no man’s land)"}</div>
            </div>
            <button class="tr-as-x" onClick=${()=>setFocus(null)} aria-label="ปิด"><${Icon} name="close" size=${15}/></button>
          </div>
          <div class="tr-as-row">
            <div style=${{flex:1,minWidth:0}}><${Dropdown} value=${pick} onChange=${setPick} options=${tcOptions}
              placeholder="เลือก TC ที่จะดูแล…"/></div>
            <${Btn} variant="primary" size="sm" icon="check" disabled=${pick===curTCId} onClick=${saveAssign}>บันทึก</${Btn}>
          </div>
        </div>`
        : html`<div class="tr-as-hint">คลิกจังหวัดบนแผนที่เพื่อกำหนดหรือเปลี่ยน TC ที่ดูแลพื้นที่นั้น</div>`}

        <${TerritoryMap} paths=${paths} assign=${assign} focus=${focus} onFocus=${focusFromMap}/>
        <div class="tr-legend">
          ${TC_USERS.filter(u=>provOf(u.id).length).map(u=>html`<span key=${u.id} class="tr-lg">
            <span class="tr-sw" style=${{background:tcColor(u.id)+"3d",borderColor:tcColor(u.id)}}></span>
            ${u.name} <b>${num(provOf(u.id).length)}</b></span>`)}
          <span class="tr-lg"><span class="tr-sw nm"></span>ยังไม่มีคนดูแล <b>${num(noManN)}</b></span>
        </div>
      </${Card}>

      <${Card} title="ความครอบคลุมรายบุคคล" sub=${"TC "+TC_USERS.length+" คน · จังหวัดหลักมาจากโปรไฟล์ผู้ใช้"}>
        <div class="tr-tcs">
          ${TC_USERS.map(u=>{ const list=provOf(u.id);
            return html`<div key=${u.id} class=${"tr-tc"+(list.length?"":" idle")}>
              <span class="tr-sw" style=${{background:tcColor(u.id)+"3d",borderColor:tcColor(u.id)}}></span>
              <div class="tr-tc-main">
                <div class="tr-tc-nm">${u.name}
                  </div>
                <div class="tr-tc-sub">${list.length
                  ? list.length+" จังหวัด · "+list.slice(0,4).join(", ")+(list.length>4?" +"+(list.length-4):"")
                  : "ยังไม่มีพื้นที่ในความดูแล"}</div>
              </div>
              ${list.length ? html`<button class="tr-tc-btn" onClick=${()=>focusFromMap(provKeysOf(u.id)[0])}>ดูพื้นที่</button>` : ""}
            </div>`; })}
        </div>
        <div class="dm-alert" style=${{marginBottom:0}}>
          <${Icon} name="info" size=${14}/> โซนย่อยระดับย่านในกรุงเทพฯ (สีลม · ทองหล่อ · ลาดพร้าว) ยังกำหนดไม่ได้ — รอไฟล์ขอบเขตจากลูกค้า ปัจจุบันกำหนดได้ถึงระดับจังหวัด
        </div>
      </${Card}>
    </div>

    <!-- หน้านี้ยืมคลาสร่วม dm-alert / dm-input / dm-focus-bar / dm-bulk / dm-pager จาก DM_CSS ด้วย -->
    <style>${DM_CSS+TR_CSS}</style>
  </div>`;
}

const TR_CSS=`
.tr-wrap .page-head .sub{max-width:820px}
.tr-grid{display:grid;grid-template-columns:minmax(280px,380px) 1fr;gap:14px;align-items:start}
.tr-leadn{font-size:13.5px;font-weight:700;color:var(--txt);font-variant-numeric:tabular-nums}
/* กล่องมอบหมาย TC ใต้แผนที่ (แทนตารางเดิม) */
.tr-assign{margin-bottom:11px;padding:12px 13px;border-radius:12px;border:1px solid var(--stroke2);background:var(--surface)}
.tr-assign.none{border-color:rgba(220,38,38,.35);background:rgba(220,38,38,.05)}
.tr-as-head{display:flex;align-items:flex-start;gap:10px;margin-bottom:10px}
.tr-as-nm{font-size:14px;font-weight:800;color:var(--txt)}
.tr-as-sub{font-size:12px;color:var(--muted);margin-top:2px;line-height:1.5}
.tr-as-x{margin-left:auto;flex:none;width:26px;height:26px;display:grid;place-items:center;cursor:pointer;
  border:none;background:none;color:var(--muted);border-radius:7px;padding:0}
.tr-as-x:hover{background:rgba(30,45,80,.07);color:var(--txt)}
.tr-as-row{display:flex;gap:9px;align-items:center}
.tr-as-hint{margin-bottom:11px;padding:11px 13px;border-radius:12px;border:1px dashed var(--stroke2);
  font-size:12.5px;color:var(--muted);text-align:center}
.tr-map{display:flex;flex-direction:column;gap:9px}
.tr-map-svg{width:100%;height:440px;display:block}
.tr-map-load{height:440px;display:grid;place-items:center;color:var(--dim);font-size:13px}
.tr-path{cursor:pointer}
.tr-path:hover{fill-opacity:.85}
.tr-map-cap{font-size:12.5px;color:var(--muted);text-align:center;padding:7px 10px;border-radius:9px;background:var(--surface2);min-height:32px}
.tr-map-cap b{color:var(--txt)}
.tr-map-cap.none{background:rgba(220,38,38,.09);color:#c81e1e}
.tr-map-cap.none b{color:#c81e1e}
.tr-legend{display:flex;flex-wrap:wrap;gap:7px 12px;margin-top:11px;font-size:12px;color:var(--muted)}
.tr-lg{display:inline-flex;align-items:center;gap:6px}
.tr-lg b{color:var(--txt)}
.tr-sw{width:13px;height:13px;border-radius:4px;border:1.5px solid transparent;flex:none}
.tr-sw.nm{border-color:#dc2626;background:repeating-linear-gradient(45deg,rgba(220,38,38,.12) 0 3px,rgba(220,38,38,.5) 3px 5px)}
.tr-tcs{display:flex;flex-direction:column;gap:8px;margin-bottom:12px}
.tr-tc{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:11px;border:1px solid var(--stroke2);background:var(--surface)}
.tr-tc.idle{border-style:dashed;background:var(--surface2)}
.tr-tc-main{flex:1;min-width:0}
.tr-tc-nm{display:flex;align-items:center;gap:7px;font-size:13.5px;font-weight:700;color:var(--txt)}
.tr-tc-sub{font-size:12px;color:var(--muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tr-tc.idle .tr-tc-sub{color:#b45309;font-weight:600}
.tr-tc-btn{flex:none;padding:6px 12px;border-radius:8px;border:1px solid var(--stroke2);background:var(--surface);
  font-family:var(--font);font-size:12px;font-weight:600;color:var(--muted);cursor:pointer}
.tr-tc-btn:hover{border-color:var(--accent);color:var(--accent-deep);background:var(--accent-soft)}
.tr-prov{display:flex;align-items:center;gap:10px}
.tr-dot{width:12px;height:12px;border-radius:50%;flex:none;box-sizing:border-box}
.tr-prov-th{font-size:13.5px;font-weight:600;color:var(--txt)}
.tr-prov-sub{font-size:11.5px;color:var(--muted);margin-top:1px}
.tr-pick{min-width:210px}
.tr-stat{display:flex;flex-direction:column;gap:3px;align-items:flex-start}
.tr-warn{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:#b45309}
.tr-nm{font-size:11px;color:var(--dim);letter-spacing:.2px}
.tr-cb{width:15px;height:15px;accent-color:var(--accent);cursor:pointer}
/* เน้นแถวจังหวัดที่ยังไม่มีคนดูแล — พื้นแดงจาง + ขีดซ้าย */
.table tr.tr-row-none>td{background:rgba(220,38,38,.055)}
.table tr.tr-row-none>td:first-child{box-shadow:inset 3px 0 0 #dc2626}
@media(max-width:980px){.tr-grid{grid-template-columns:1fr}.tr-map-svg{height:380px}}
`;
