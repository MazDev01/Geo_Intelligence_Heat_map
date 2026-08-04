// ═══════════════════════════════════════════════════════════════════════════
// src/visit-rounds.js — โมเดล "รอบการเข้าพบ" (visit rounds) + การ derive สถานะLead
// หลักการ: Lead 1 ราย มีได้หลายรอบ · "สถานะ" ไม่เก็บตรง ๆ แต่ derive จากรอบล่าสุดเสมอ
// (สแตกจริงเป็น client — ไม่มี cache column/DB job แบบ Supabase; คำนวณสดจาก rounds ทุกครั้ง)
// ทุกข้อความไทย · สีสถานะเลือกให้ไม่ซ้ำกับสีเกรด A/B/C
// ═══════════════════════════════════════════════════════════════════════════

// ── ค่าตัวเลือกในรอบ (ใช้ทั้งฟอร์มและ mock) ──
export const INTEREST = ["สนใจมาก","สนใจ","ขอคิดดู","ไม่สนใจ"];          // ระดับความสนใจ
export const OUTCOME  = ["ต้องติดตามต่อ","พร้อมปิดดีล","ปิดการขาย"];      // ผลลัพธ์รอบ (เมื่อเข้าพบเสร็จ)
export const ROUND_STATUS = ["นัดแล้ว","เสร็จสิ้น","ยกเลิก"];             // สถานะของรอบ
export const CANCEL_REASONS = ["ไม่สะดวกช่วงนี้","ราคาไม่ตรง","ติดคู่แข่ง","ปิดกิจการ","ติดต่อไม่ได้","อื่น ๆ"];

// ── สถานะLeadที่ derive ได้ (สีต่างจากเกรด A/B/C โดยเจตนา) ──
export const VSTATUS = {
  waiting:     { key:"waiting",     label:"รอเข้าพบ",           color:"#64748b", tone:"neutral", icon:"target" },
  appointment: { key:"appointment", label:"นัดหมายแล้ว",        color:"#2563eb", tone:"info",    icon:"calendar" },
  followup:    { key:"followup",    label:"รอเข้าพบรอบถัดไป",   color:"#7c3aed", tone:"info",    icon:"refresh" },
  hot:         { key:"hot",         label:"ใกล้ปิดการขาย",       color:"#e60023", tone:"bad",     icon:"target" },
  closed:      { key:"closed",      label:"ปิดการขายแล้ว",       color:"#0d9488", tone:"good",    icon:"check" },
  lost:        { key:"lost",        label:"ปิดโอกาส (ไม่สนใจ)",   color:"#78716c", tone:"neutral", icon:"close" },
};

// ── derive สถานะจากรอบล่าสุด ──
export function deriveStatus(rounds){
  if(!rounds || !rounds.length) return "waiting";
  const last = rounds[rounds.length-1];
  if(last.status==="ยกเลิก" || last.interest==="ไม่สนใจ") return "lost";
  if(last.outcome==="ปิดการขาย") return "closed";
  if(last.outcome==="พร้อมปิดดีล") return "hot";
  if(last.status==="นัดแล้ว") return "appointment";
  if(last.status==="เสร็จสิ้น" && last.outcome==="ต้องติดตามต่อ") return "followup";
  return "waiting";
}
export const statusMeta = rounds => VSTATUS[deriveStatus(rounds)];

// ผู้รับผิดชอบล่าสุด (รอบล่าสุดที่มี tc) · fallback = tc_owner ของ record
export function responsibleOf(prospect, rounds){
  for(let i=(rounds||[]).length-1;i>=0;i--){ if(rounds[i].tc) return rounds[i].tc; }
  return prospect && prospect.tc_owner && prospect.tc_owner!=="ยังไม่มอบหมาย" ? prospect.tc_owner : null;
}

// วันนัดครั้งถัดไป (จากรอบที่สถานะ 'นัดแล้ว')
export function nextAppointment(rounds){
  const a=(rounds||[]).filter(r=>r.status==="นัดแล้ว" && r.apptDate).map(r=>r.apptDate).sort();
  return a.length ? a[a.length-1] : null;
}

// ── ความเร่งด่วนของวันนัด (เทียบวันอ้างอิงของระบบ) ──
const ANCHOR = Date.parse("2026-07-13");
export function urgencyOf(dateStr, now=ANCHOR){
  if(!dateStr) return null;
  const d = Math.round((Date.parse(dateStr) - now)/864e5);
  if(isNaN(d)) return null;
  if(d < 0)  return { label:`เลยกำหนด ${Math.abs(d)} วัน`, tone:"bad" };
  if(d === 0) return { label:"วันนี้", tone:"warn" };
  if(d <= 3)  return { label:`อีก ${d} วัน`, tone:"warn" };
  return { label:`อีก ${d} วัน`, tone:"info" };
}

// ═══════════════════════════════════════════════════════════════════════════
// แผนการเข้าพบ "รายวัน" (daily plan) — derive จากข้อมูลล้วน ไม่ใช้ cron ตัดยอดตอนเที่ยงคืน
// หลักการ: "รอเข้าพบ" = อยู่ในแผนของวันนี้และยังไม่ได้เข้าพบ · เมื่อขึ้นวันใหม่ รายการที่ไม่ได้เข้าพบ
//          จะหลุดจากแผน (ไม่มีสถานะ) แต่ "นัดแล้ว" ไม่หลุด — ถ้าเลยวันนัดจะขึ้นป้าย "เลยกำหนดนัด"
// ใช้วันที่ตามโซนไทย (UTC+7) ตัดสินว่า "วันนั้นจบแล้ว"
// ═══════════════════════════════════════════════════════════════════════════
export const PLAN_TODAY = "2026-07-13";   // "วันนี้" ของเดโม (ผูกกับ ANCHOR เดียวกับ urgencyOf)
export const REPLAN_WARN_THRESHOLD = 3;   // เตือนเมื่อวางแผนซ้ำแล้วพลาด ≥ 3 ครั้ง
export const REPLAN_WARN_MSG = "วางแผนมาแล้ว 3 ครั้ง → พิจารณานัดหมายล่วงหน้าหรือติดต่อยืนยันก่อนเข้าพบ";

// วันที่ "วันนี้" ตามโซนไทย UTC+7 (ระบบจริง) — เดโมส่ง PLAN_TODAY เข้ามาแทนเพื่อให้ตรงกับ mock ที่ผูกวันไว้
export function planTodayKey(){ const d=new Date(Date.now()+7*3600e3); return d.toISOString().slice(0,10); }

// นัดที่เลยกำหนด: รอบสถานะ "นัดแล้ว" ที่วันนัดผ่านไปแล้วแต่ยังไม่บันทึกผล → คงสถานะไว้ ไม่หลุด
export function overdueAppt(rounds, today=PLAN_TODAY){
  const a=(rounds||[]).filter(r=>r.status==="นัดแล้ว" && r.apptDate && String(r.apptDate)<today).map(r=>r.apptDate).sort();
  return a.length ? a[0] : null;
}
// สรุปประวัติ "เคยวางแผนไว้แต่ยังไม่ได้เข้า" จาก planHistory ของ record (เก็บร่องรอยไว้ ไม่ให้รายการหายเงียบ)
export function plannedMissed(planHistory, today=PLAN_TODAY){
  const m=(planHistory||[]).filter(e=>!e.visited && String(e.date)<today).map(e=>e.date).sort();
  return { count:m.length, lastDate:m.length?m[m.length-1]:null };
}
export const inTodayPlan  = (planHistory, today=PLAN_TODAY)=> (planHistory||[]).some(e=>e.date===today && !e.visited);
export const visitedToday = (planHistory, today=PLAN_TODAY)=> (planHistory||[]).filter(e=>e.date===today && e.visited).length;

// ── วันที่ พ.ศ. ──
const THMON=["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
export function beDate(iso, withTime){
  if(!iso) return "—"; const d=new Date(iso); if(isNaN(d)) return "—";
  const s=d.getDate()+" "+THMON[d.getMonth()]+" "+(d.getFullYear()+543);
  return withTime ? s+" "+String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0") : s;
}

// back-compat: สรุปเป็น visit_status เดิม (ครอบคลุมแล้ว = เคยเข้าพบเสร็จ ≥ 1 รอบ)
export function deriveVisitStatus(rounds){
  return (rounds||[]).some(r=>r.status==="เสร็จสิ้น") ? "ครอบคลุมแล้ว" : "ยังไม่เข้าพบ";
}

// ── ตัวสร้างรอบ mock ให้Lead 1 ราย (ใช้ใน gen.mjs) — rng, isoBack เป็น util ที่ส่งเข้ามา ──
// scenario: waiting|appointment|followup|hot|lost — คืน array ของรอบ (อาจ 0..3 รอบ)
export function makeRounds(scenario, tc, rng, isoBack){
  const pick=a=>a[Math.floor(rng()*a.length)];
  const R=[];
  const doneRound=(n, backDays, outcome, interest)=>({ round:n, status:"เสร็จสิ้น",
    doneDate:isoBack(backDays), tc, interest, outcome, note:pick(["เจ้าของสนใจแนวคิด","ขอข้อมูลแพ็กเกจเพิ่ม","นัดคุยรอบหน้า","ขอเวลาตัดสินใจ"]) });
  if(scenario==="waiting") return [];                                    // ยังไม่มีรอบ
  if(scenario==="appointment") return [{ round:1, status:"นัดแล้ว", apptDate:isoBack(-1*(1+Math.floor(rng()*9))), tc, note:"นัดเข้าพบครั้งแรก" }];
  if(scenario==="followup"){                                             // เข้าพบแล้ว 1-2 รอบ ยังต้องติดตาม
    R.push(doneRound(1, 30+Math.floor(rng()*40), "ต้องติดตามต่อ", pick(["สนใจ","ขอคิดดู"])));
    if(rng()<0.5) R.push(doneRound(2, 8+Math.floor(rng()*15), "ต้องติดตามต่อ", "สนใจ"));
    // รอบถัดไปนัดหมายไว้ (บางราย)
    if(rng()<0.55) R.push({ round:R.length+1, status:"นัดแล้ว", apptDate:isoBack(-1*(Math.floor(rng()*7)-2)), tc, note:"นัดติดตามรอบถัดไป" });
    return R;
  }
  if(scenario==="hot"){                                                  // ใกล้ปิด — พร้อมปิดดีล
    R.push(doneRound(1, 40+Math.floor(rng()*30), "ต้องติดตามต่อ", "สนใจ"));
    R.push(doneRound(2, 5+Math.floor(rng()*12), "พร้อมปิดดีล", "สนใจมาก"));
    return R;
  }
  if(scenario==="lost"){                                                 // ปิดโอกาส
    R.push(doneRound(1, 20+Math.floor(rng()*40), "ต้องติดตามต่อ", "ขอคิดดู"));
    R.push({ round:2, status:"ยกเลิก", apptDate:isoBack(15+Math.floor(rng()*20)), tc,
      interest:"ไม่สนใจ", cancelReason:pick(CANCEL_REASONS), note:"Leadแจ้งไม่สนใจ" });
    return R;
  }
  return [];
}
