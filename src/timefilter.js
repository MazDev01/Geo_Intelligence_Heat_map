import {segTH, SEG_COLOR, SEGMENTS, provinceTH} from "./lib.js";

/* ---------------- ตัวกรองช่วงเวลาของแดชบอร์ดผู้บริหาร ----------------
   กรองจากฟิลด์ created_at (วันที่เพิ่มเข้าระบบ) ที่ gen.mjs ใส่ไว้ให้ทุกรายการ
   ค่าเริ่มต้นคือ "ทั้งหมด" เพื่อให้ตัวเลขตอนเปิดหน้าตรงกับตอนที่ยังไม่มีตัวกรองทุกประการ
   ตัวกรองทำงานอยู่ในสถานะของหน้านั้นเท่านั้น ไม่ได้แตะข้อมูลกลางที่หน้าอื่นใช้ร่วมกัน
   หน้ารายงานอื่นจึงยังเห็นข้อมูลครบเหมือนเดิม                                    */
const DAY = 864e5;

export const RANGES = [
  {id:"7d",  label:"7 วันล่าสุด",  cmp:"เทียบกับ 7 วันก่อนหน้า"},
  {id:"30d", label:"30 วันล่าสุด", cmp:"เทียบกับ 30 วันก่อนหน้า"},
  {id:"q",   label:"ไตรมาสนี้",    cmp:"เทียบกับช่วงยาวเท่ากันก่อนหน้า"},
  {id:"all", label:"ทั้งหมด",      cmp:"จากเดือนก่อน"},
];

const TH_MON = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
export const thDate = t => { const d=new Date(t); return d.getUTCDate()+" "+TH_MON[d.getUTCMonth()]+" "+(d.getUTCFullYear()+543); };  // ปีพุทธศักราช

// ขอบเขตของช่วงที่เลือก นับรวมทั้งวันหัวและวันท้าย — "ทั้งหมด" คืน null แปลว่าไม่กรองอะไรเลย
function windowOf(id, ref){
  if(id==="all") return null;
  if(id==="q"){                       // ไตรมาสนี้ = ตั้งแต่วันแรกของไตรมาสถึงวันข้อมูลล่าสุด
    const d=new Date(ref);
    return {from: Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth()/3)*3, 1), to: ref};
  }
  const days = id==="7d" ? 7 : 30;
  return {from: ref-(days-1)*DAY, to: ref};
}
// ช่วงก่อนหน้าที่ยาวเท่ากันและอยู่ติดกัน ใช้เป็นฐานเทียบของตัวเลขแนวโน้ม
const prevOf = w => { const len=w.to-w.from+DAY; return {from:w.from-len, to:w.from-DAY}; };

// อัตราเติบโตคำนวณจากจำนวนรายการจริงในสองช่วงที่ติดกัน ไม่ได้ใส่ค่าตายตัวไว้
function growth(arr, w){
  const p=prevOf(w); let cur=0, prv=0;
  for(const o of arr){ const t=Date.parse(o.created_at);
    if(t>=w.from&&t<=w.to) cur++; else if(t>=p.from&&t<=p.to) prv++; }
  if(!prv) return {up:cur>0, txt: cur>0 ? "ไม่มีข้อมูลช่วงก่อนหน้าให้เทียบ" : "ยังไม่มีข้อมูลในช่วงนี้", plain:true};
  const g=(cur-prv)/prv*100;
  return {up:g>=0, txt:(g>=0?"+":"")+g.toFixed(1)+"%", plain:false};
}
// เส้นแนวโน้มจิ๋ว — ซอยช่วงที่เลือกเป็น 7 ท่อนแล้วนับรายการจริงในแต่ละท่อน
function sparkOf(arr, w){
  const n=7, len=(w.to-w.from+DAY)/n, b=new Array(n).fill(0);
  for(const o of arr){ const t=Date.parse(o.created_at); if(t<w.from||t>w.to) continue;
    b[Math.min(n-1, Math.max(0, Math.floor((t-w.from)/len)))]++; }
  return b;
}

/* คำนวณทุกตัวเลขของแดชบอร์ดใหม่จากรายการที่ผ่านตัวกรองแล้ว
   ต้องคำนวณยอดรายจังหวัดขึ้นใหม่เอง เพราะ areas ที่โหลดมาเป็นยอดสรุปของข้อมูลทั้งก้อน
   ไม่ได้แยกตามช่วงเวลา ถ้าเอามาใช้ตรงๆ ตารางอันดับกับ Heat Ranking จะไม่ขยับตามตัวกรอง */
export function calcView(custs, pros, areas, rangeId){
  // วันอ้างอิง = วันที่ข้อมูลใหม่สุดที่มีอยู่จริง ไม่ได้อิงนาฬิกาของเครื่อง
  // เพื่อให้ผลการกรองคงที่ ไม่ว่าจะเปิดดูวันไหน
  let ref=0;
  for(const o of custs){ const t=Date.parse(o.created_at); if(t>ref) ref=t; }
  for(const o of pros ){ const t=Date.parse(o.created_at); if(t>ref) ref=t; }

  const win = windowOf(rangeId, ref);
  const inWin = o => { const t=Date.parse(o.created_at); return t>=win.from && t<=win.to; };
  const fCusts = win ? custs.filter(inWin) : custs;
  const fPros  = win ? pros .filter(inWin) : pros;

  // ยอดรายจังหวัดจากรายการที่กรองแล้ว — ไล่ตามลำดับเดิมของ areas เสมอ
  // เพื่อให้เวลาคะแนนเท่ากัน ลำดับที่เรียงออกมาเหมือนเดิมทุกประการ (Array.sort เป็นแบบเสถียร)
  const stat={};
  const slot=p=>(stat[p]=stat[p]||{c:0,p:0,pot:0});
  for(const c of fCusts) slot(c.province).c++;
  for(const p of fPros ){ const e=slot(p.province); e.p++; e.pot+=p.potentialScore||0; }
  const fAreas=[];
  for(const a of areas){
    const e=stat[a.province]; if(!e || e.c+e.p===0) continue;
    fAreas.push({province:a.province, center:a.center, customerCount:e.c, prospectCount:e.p,
      avgPotentialScore: e.p ? Math.round(e.pot/e.p) : 0,
      coverage: Math.min(100, Math.round(e.c/(e.c+e.p)*100))});
  }

  // สูตรคะแนนโอกาสเดิม ไม่ได้แก้ เปลี่ยนแค่ชุดข้อมูลที่ป้อนเข้าไป
  const ranked = fAreas.map(a=>{ const ratio=a.customerCount?a.prospectCount/a.customerCount:a.prospectCount;
    const opp=Math.min(100,Math.round(0.45*a.avgPotentialScore + 0.2*Math.min(100,ratio*7) + 0.35*Math.min(100,a.prospectCount/9)));
    return {...a,opp}; }).sort((x,y)=>y.opp-x.opp);
  const withC = ranked.filter(a=>a.customerCount>0);

  // ช่วงที่ใช้คำนวณแนวโน้ม — ตอนเลือก "ทั้งหมด" ไม่มีขอบเขตให้เทียบ จึงใช้ 30 วันล่าสุดเทียบ 30 วันก่อนหน้า
  // ซึ่งตรงกับความหมายของคำว่า "จากเดือนก่อน" ที่ป้ายนี้เขียนไว้แต่เดิม
  const tw = win || windowOf("30d", ref);

  return {
    ref, win, fCusts, fPros, ranked,
    // คะแนนเฉลี่ยคิดเฉพาะจังหวัดที่มีลูกค้า ตามสูตรเดิมของหน้านี้
    // ส่งจำนวนจังหวัดที่ใช้เฉลี่ยออกไปด้วย ป้ายกำกับจะได้บอกฐานที่ใช้คำนวณได้ตรงจริง
    avgOpp: Math.round(withC.reduce((s,a)=>s+a.opp,0)/Math.max(1,withC.length)),
    withCCount: withC.length,
    provincesWithCust: fAreas.filter(a=>a.customerCount>0).length,
    segCount: SEGMENTS.map(s=>({label:segTH(s), value:fCusts.filter(c=>c.segment===s).length, color:SEG_COLOR[s]})),
    topByCust: [...fAreas].sort((a,b)=>b.customerCount-a.customerCount).slice(0,6)
      .map(a=>({label:provinceTH(a.province), value:a.customerCount})),
    dCust: growth(custs,tw), dPros: growth(pros,tw),
    sCust: sparkOf(custs,tw), sPros: sparkOf(pros,tw),
    rangeText: win ? thDate(win.from)+" – "+thDate(win.to)
                   : "ข้อมูลทั้งหมดในระบบ · ล่าสุด "+thDate(ref),
  };
}
