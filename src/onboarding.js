import {html, brandMark} from "./lib.js";

// ── First-login onboarding status (persisted per user) ───────────────────────
const KEY = "geointel.onboarded";
export function isOnboarded(email){
  try { return localStorage.getItem(KEY+"."+(email||"guest"))==="1"; } catch { return false; }
}
export function markOnboarded(email){
  try { localStorage.setItem(KEY+"."+(email||"guest"),"1"); } catch {}
}

// ── Welcome Dialog ───────────────────────────────────────────────────────────
// Centered modal shown once, the first time a user logs in. Blur backdrop,
// rounded enterprise card, soft shadow. "เริ่มแนะนำ" → product tour · "ข้าม" → dismiss.
export function WelcomeDialog({onStart, onSkip}){
  return html`<div class="ob-backdrop" onMouseDown=${e=>{ if(e.target.classList.contains("ob-backdrop")) onSkip(); }}>
    <div class="ob-card" role="dialog" aria-modal="true" aria-label="ยินดีต้อนรับ">
      <div class="ob-glow"></div>
      <div class="ob-mark">${brandMark()}</div>
      <div class="ob-emoji">👋</div>
      <h2 class="ob-title">ยินดีต้อนรับสู่ Geo Intelligence Platform</h2>
      <p class="ob-desc">
        ระบบนี้ช่วยวิเคราะห์ข้อมูลลูกค้า<br/>
        ค้นหาพื้นที่ที่มีศักยภาพ<br/>
        และวางแผนการเข้าพบลูกค้าบนแผนที่แบบโต้ตอบ
      </p>
      <p class="ob-q">คุณต้องการชมการแนะนำการใช้งานหรือไม่</p>
      <div class="ob-actions">
        <button class="ob-btn ob-ghost" onClick=${onSkip}>ข้าม</button>
        <button class="ob-btn ob-primary" onClick=${onStart}>
          <span>เริ่มแนะนำ</span><span class="ob-arrow">→</span>
        </button>
      </div>
    </div>
    <style>${CSS}</style>
  </div>`;
}

const CSS = `
.ob-backdrop{position:fixed;inset:0;z-index:2000;display:grid;place-items:center;padding:20px;
  background:rgba(4,7,14,.62);backdrop-filter:blur(9px);-webkit-backdrop-filter:blur(9px);
  animation:ob-fade .3s ease;font-family:var(--font)}
.ob-card{position:relative;width:452px;max-width:100%;overflow:hidden;text-align:center;
  padding:38px 34px 28px;border-radius:24px;border:1px solid var(--stroke2);
  background:linear-gradient(180deg,var(--panel),var(--bg));
  box-shadow:0 34px 90px rgba(0,0,0,.6),0 0 0 1px rgba(120,160,220,.06) inset;
  animation:ob-pop .38s cubic-bezier(.2,.9,.25,1)}
.ob-glow{position:absolute;top:-120px;left:50%;transform:translateX(-50%);width:340px;height:240px;
  background:radial-gradient(circle,rgba(255, 59, 92,.28),transparent 68%);pointer-events:none;filter:blur(6px)}
.ob-mark{position:relative;width:52px;height:52px;margin:0 auto 4px;display:grid;place-items:center}
.ob-mark svg{width:52px;height:52px}
.ob-emoji{position:relative;font-size:40px;line-height:1;margin:6px 0 14px;animation:ob-wave 2.4s ease-in-out infinite;transform-origin:70% 80%}
.ob-title{position:relative;font-size:20px;font-weight:700;line-height:1.4;margin:0 0 16px;color:var(--txt);letter-spacing:.1px}
.ob-desc{position:relative;font-size:14px;line-height:1.85;color:var(--muted);margin:0 0 18px}
.ob-q{position:relative;font-size:14.5px;font-weight:600;color:var(--txt);margin:0 0 26px}
.ob-actions{position:relative;display:flex;gap:12px;justify-content:center}
.ob-btn{font-family:var(--font);font-size:14px;font-weight:600;cursor:pointer;border-radius:12px;
  padding:12px 22px;transition:transform .15s ease,box-shadow .2s ease,background .2s ease,border-color .2s ease;
  display:inline-flex;align-items:center;gap:8px}
.ob-btn:active{transform:translateY(1px)}
.ob-ghost{background:transparent;border:1px solid var(--stroke2);color:var(--muted)}
.ob-ghost:hover{color:var(--txt);border-color:rgba(120,160,220,.45);background:rgba(255,255,255,.03)}
.ob-primary{border:none;color:#fff;background:linear-gradient(135deg,#e60023,#e60023);
  box-shadow:0 8px 22px rgba(230, 0, 35,.4)}
.ob-primary:hover{box-shadow:0 12px 30px rgba(230, 0, 35,.55);transform:translateY(-1px)}
.ob-arrow{transition:transform .18s ease}
.ob-primary:hover .ob-arrow{transform:translateX(3px)}
@keyframes ob-fade{from{opacity:0}to{opacity:1}}
@keyframes ob-pop{from{opacity:0;transform:translateY(14px) scale(.965)}to{opacity:1;transform:none}}
@keyframes ob-wave{0%,60%,100%{transform:rotate(0)}15%{transform:rotate(16deg)}30%{transform:rotate(-8deg)}45%{transform:rotate(12deg)}}
@media (max-width:480px){.ob-card{padding:30px 20px 22px}.ob-title{font-size:17.5px}.ob-actions{flex-direction:column-reverse}.ob-btn{width:100%;justify-content:center}}
`;
