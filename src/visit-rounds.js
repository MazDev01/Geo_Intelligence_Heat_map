// ═══════════════════════════════════════════════════════════════════════════
// src/visit-rounds.js — โมเดล "รอบการเข้าพบ" (visit rounds) + การ derive สถานะLead
// หลักการ: Lead 1 ราย มีได้หลายรอบ · "สถานะ" ไม่เก็บตรง ๆ แต่ derive จากรอบล่าสุดเสมอ
// (สแตกจริงเป็น client — ไม่มี cache column/DB job แบบ Supabase; คำนวณสดจาก rounds ทุกครั้ง)
// ทุกข้อความไทย · สีสถานะเลือกให้อ่านง่ายและไม่ชนกับสีหมวดธุรกิจ
// ═══════════════════════════════════════════════════════════════════════════

// ── ค่าตัวเลือกในรอบ (ใช้ทั้งฟอร์มและ mock) ──
import {thDate, thDateTime} from "./lib.js";   // ตัวแปลงวันที่กลางของระบบ
import {t, isEN} from "./i18n.js";

export const INTEREST = ["สนใจมาก","สนใจ","ขอคิดดู","ไม่สนใจ"];          // ระดับความสนใจ
export const OUTCOME  = ["ต้องติดตามต่อ","พร้อมปิดดีล","ปิดการขาย"];      // ผลลัพธ์รอบ (เมื่อเข้าพบเสร็จ)
export const ROUND_STATUS = ["นัดแล้ว","เสร็จสิ้น","ยกเลิก"];             // สถานะของรอบ
export const CANCEL_REASONS = ["ไม่สะดวกช่วงนี้","ราคาไม่ตรง","ติดคู่แข่ง","ปิดกิจการ","ติดต่อไม่ได้","อื่น ๆ"];

// ── ค่าดิบ (INTEREST/OUTCOME/ROUND_STATUS/CANCEL_REASONS) เป็น "ข้อมูล" ไม่ใช่ข้อความบนหน้าจอ ──
// ค่าพวกนี้ถูกเก็บลงเรกคอร์ดและถูกเทียบตรง ๆ ทั้งด้วย === และ regex (เช่น /ปิดการขาย|พร้อมปิดดีล/)
// จึงต้องคงเป็นไทยเสมอ · โหมด EN แปลเฉพาะ "ตอนแสดงผล" ผ่านตารางด้านล่าง
const ROUND_EN = {
  "สนใจมาก":"Very interested", "สนใจ":"Interested", "ขอคิดดู":"Considering", "ไม่สนใจ":"Not interested",
  "ต้องติดตามต่อ":"Needs follow-up", "พร้อมปิดดีล":"Ready to close", "ปิดการขาย":"Deal closed",
  "นัดแล้ว":"Scheduled", "เสร็จสิ้น":"Completed", "ยกเลิก":"Cancelled",
  "ไม่สะดวกช่วงนี้":"Not available now", "ราคาไม่ตรง":"Price mismatch", "ติดคู่แข่ง":"With a competitor",
  "ปิดกิจการ":"Business closed", "ติดต่อไม่ได้":"Unreachable", "อื่น ๆ":"Other",
};
/* ป้ายที่แสดงผลของค่าดิบข้างต้น — ใช้ทุกที่ที่เอาค่าไปโชว์ (ตัวค่าที่บันทึกยังเป็นไทย) */
export const roundLabel = v => isEN() ? (ROUND_EN[v] || v) : v;

// ── ความเร่งด่วนของวันนัด (เทียบวันอ้างอิงของระบบ) ──
export function urgencyOf(dateStr, now=Date.parse(planTodayKey())){
  if(!dateStr) return null;
  const d = Math.round((Date.parse(dateStr) - now)/864e5);
  if(isNaN(d)) return null;
  if(d < 0)  return { label:t(`เลยกำหนด ${Math.abs(d)} วัน`, `${Math.abs(d)} days overdue`), tone:"bad" };
  if(d === 0) return { label:t("วันนี้","Today"), tone:"warn" };
  if(d <= 3)  return { label:t(`อีก ${d} วัน`, `in ${d} days`), tone:"warn" };
  return { label:t(`อีก ${d} วัน`, `in ${d} days`), tone:"info" };
}

// ═══════════════════════════════════════════════════════════════════════════
// แผนการเข้าพบ "รายวัน" (daily plan) — derive จากข้อมูลล้วน ไม่ใช้ cron ตัดยอดตอนเที่ยงคืน
// หลักการ: "รอเข้าพบ" = อยู่ในแผนของวันนี้และยังไม่ได้เข้าพบ · เมื่อขึ้นวันใหม่ รายการที่ไม่ได้เข้าพบ
//          จะหลุดจากแผน (ไม่มีสถานะ) แต่ "นัดแล้ว" ไม่หลุด — ถ้าเลยวันนัดจะขึ้นป้าย "เลยกำหนดนัด"
// ใช้วันที่ตามโซนไทย (UTC+7) ตัดสินว่า "วันนั้นจบแล้ว"
// ═══════════════════════════════════════════════════════════════════════════

// วันที่ "วันนี้" ตามโซนไทย UTC+7 (ระบบจริง) — เดโมส่ง PLAN_TODAY เข้ามาแทนเพื่อให้ตรงกับ mock ที่ผูกวันไว้
export function planTodayKey(){ const d=new Date(Date.now()+7*3600e3); return d.toISOString().slice(0,10); }

const msOf = s => { const n=Date.parse(s||""); return Number.isNaN(n) ? null : n; };
export function roundsInPlan(rounds, plan, until){
  const from=msOf(plan&&plan.savedAt), to=msOf(until), day=(plan&&plan.visitDate)||"";
  return (rounds||[]).filter(r=>{ const a=msOf(r.at);
    if(a===null || from===null) return !!day && String(r.doneDate||"")>=day;
    return a>=from && (to===null || a<to); });
}
export function planResultOf(rounds, plan, until){
  const added=msOf(plan&&plan.addedAt);
  const voided=r=>{ const a=msOf(r.at); return added!==null && a!==null && a<added; };
  const rs=roundsInPlan(rounds, plan, until).filter(r=>r.status==="เสร็จสิ้น" || (r.status==="ยกเลิก" && !voided(r)));
  return rs.length ? rs[rs.length-1] : null;
}

// นัดที่เลยกำหนด: รอบสถานะ "นัดแล้ว" ที่วันนัดผ่านไปแล้วแต่ยังไม่บันทึกผล → คงสถานะไว้ ไม่หลุด
export function overdueAppt(rounds, today=planTodayKey()){
  const a=(rounds||[]).filter(r=>r.status==="นัดแล้ว" && r.apptDate && String(r.apptDate)<today).map(r=>r.apptDate).sort();
  return a.length ? a[0] : null;
}
// สรุปประวัติ "เคยวางแผนไว้แต่ยังไม่ได้เข้า" จาก planHistory ของ record (เก็บร่องรอยไว้ ไม่ให้รายการหายเงียบ)
export function plannedMissed(planHistory, today=planTodayKey()){
  const m=(planHistory||[]).filter(e=>!e.visited && String(e.date)<today).map(e=>e.date).sort();
  return { count:m.length, lastDate:m.length?m[m.length-1]:null };
}
export const inTodayPlan  = (planHistory, today=planTodayKey())=> (planHistory||[]).some(e=>e.date===today && !e.visited);

// ── วันที่ พ.ศ. ──
export const beDate = (iso, withTime) => withTime ? thDateTime(iso) : thDate(iso);   // ใช้ตัวแปลงกลาง

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
