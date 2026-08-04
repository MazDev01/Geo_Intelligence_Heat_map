// ═══════════════════════════════════════════════════════════════════════════
// src/pages/tc-dashboard.js — ส่วน "งานของฉันวันนี้" ของ TC (ฝังในหน้ารายงานเมื่อ TC เปิด)
// ไม่ใช่หน้าแยก — เป็นบล็อกที่วางไว้บนสุดของแดชบอร์ดสรุปภาพรวมเชิงพื้นที่ (reports.js) เฉพาะบทบาท TC
// derive สดจากรอบการเข้าพบ (visit-rounds) ขอบเขตเฉพาะจังหวัดที่รับผิดชอบ · 0 = ข้อความเชิงบวก ไม่ใช่เลขลอย
// ═══════════════════════════════════════════════════════════════════════════
import {html, Icon, num} from "../lib.js";
import {PLAN_TODAY, deriveStatus, overdueAppt, plannedMissed} from "../visit-rounds.js";

// นับงานวันนี้จากLeadในจังหวัดที่รับผิดชอบ (derive ล้วน ไม่มี cron)
function myWork(db, province){
  const ps = ((db&&db.prospects)||[]).filter(p=>p.province===province);
  let visited=0, apptToday=0, overdue=0, followup=0, replan=0;
  ps.forEach(p=>{ const r=p.visitRounds||[];
    if(r.some(x=>x.status==="เสร็จสิ้น" && String(x.doneDate||"").slice(0,10)===PLAN_TODAY)) visited++;
    if(r.some(x=>x.status==="นัดแล้ว" && String(x.apptDate||"").slice(0,10)===PLAN_TODAY)) apptToday++;
    if(overdueAppt(r)) overdue++;
    if(deriveStatus(r)==="followup") followup++;
    if(plannedMissed(p.planHistory).count>0) replan++;
  });
  return { visited, apptToday, overdue, followup, replan };
}

// บล็อก "งานของฉันวันนี้" — วางบนสุดของหน้ารายงานเมื่อผู้ใช้เป็น TC
export function MyWorkToday({db, province, onGoMap}){
  if(!province) return "";
  const w = myWork(db, province);
  const todo = w.apptToday + w.overdue + w.followup;
  const cards = [
    { key:"visited",  label:"เข้าพบแล้ววันนี้", value:w.visited,  icon:"check",    tone:"good", zero:"ยังไม่ได้เข้าพบวันนี้ — เริ่มจากรายการที่นัดไว้" },
    { key:"appt",     label:"นัดหมายวันนี้",     value:w.apptToday, icon:"calendar", tone:"info", zero:"วันนี้ยังไม่มีนัด — วางแผนเข้าพบเพิ่มได้เลย" },
    { key:"overdue",  label:"เลยกำหนดนัด",       value:w.overdue,   icon:"gap",      tone:"bad",  zero:"ไม่มีนัดค้าง เยี่ยมมาก 👍" },
    { key:"followup", label:"ถึงกำหนดติดตาม",     value:w.followup,  icon:"refresh",  tone:"warn", zero:"ยังไม่มีรายการถึงกำหนดติดตาม" },
    { key:"replan",   label:"รอวางแผนใหม่",       value:w.replan,    icon:"route",    tone:"neutral", zero:"ไม่มีรายการที่ต้องวางแผนใหม่" },
  ];
  return html`<div class="tcd-block">
    <div class="tcd-section-t">
      <b>งานของฉันวันนี้</b>
      ${todo>0 ? html`<span class="tcd-todo">ต้องลงมือ ${todo} รายการ</span>`
               : html`<span class="tcd-todo ok">ไม่มีงานค้าง — วางแผนเข้าพบเพิ่มได้เลย</span>`}
    </div>
    <div class="tcd-grid">
      ${cards.map(c=>html`<button key=${c.key} class=${"tcd-card "+c.tone+(c.value>0?"":" is-zero")}
          onClick=${()=>onGoMap&&onGoMap(c.key)} aria-label=${c.label}>
        <div class="tcd-card-top">
          <span class="tcd-ic"><${Icon} name=${c.icon} size=${16}/></span>
          <span class="tcd-lb">${c.label}</span>
        </div>
        ${c.value>0
          ? html`<div class="tcd-val">${num(c.value)}<span class="tcd-unit">รายการ</span></div>`
          : html`<div class="tcd-zero">${c.zero}</div>`}
      </button>`)}
    </div>
    <style>${CSS}</style>
  </div>`;
}

const CSS = `
.tcd-block{margin:4px 0 20px}
.tcd-section-t{display:flex;align-items:center;gap:12px;margin:0 0 12px}
.tcd-section-t b{font-size:15px}
.tcd-todo{font-size:12.5px;font-weight:700;color:#e60023;background:rgba(230, 0, 35,.1);padding:4px 11px;border-radius:999px}
.tcd-todo.ok{color:var(--good);background:rgba(51,214,159,.12)}
.tcd-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}
.tcd-card{display:flex;flex-direction:column;gap:10px;align-items:stretch;text-align:left;padding:15px;border-radius:14px;
  border:1px solid var(--stroke2);background:var(--panel);cursor:pointer;font-family:var(--font);transition:border-color .15s,transform .1s}
.tcd-card:hover{border-color:var(--accent);transform:translateY(-2px)}
.tcd-card.is-zero{opacity:.82}
.tcd-card-top{display:flex;align-items:center;gap:9px}
.tcd-ic{width:30px;height:30px;flex:none;border-radius:9px;display:grid;place-items:center;background:var(--surface);color:var(--muted)}
.tcd-card.good .tcd-ic{color:var(--good)}.tcd-card.info .tcd-ic{color:var(--accent2)}
.tcd-card.bad .tcd-ic{color:#e60023}.tcd-card.warn .tcd-ic{color:var(--warn)}
.tcd-lb{font-size:12.5px;font-weight:600;color:var(--txt)}
.tcd-val{font-size:30px;font-weight:800;color:var(--txt);line-height:1;display:flex;align-items:baseline;gap:6px}
.tcd-card.bad .tcd-val{color:#e60023}.tcd-card.warn .tcd-val{color:var(--warn)}
.tcd-unit{font-size:12px;font-weight:600;color:var(--muted)}
.tcd-zero{font-size:12px;line-height:1.5;color:var(--muted)}
@media(max-width:1279px){.tcd-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:640px){.tcd-grid{grid-template-columns:1fr}.tcd-card{min-height:44px}}
`;
