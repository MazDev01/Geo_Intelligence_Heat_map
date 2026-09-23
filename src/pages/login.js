// หน้าเข้าสู่ระบบ — ตรวจรหัสผ่านจริงกับ /api/auth (ดู auth-store.cjs)
//
// เดิมหน้านี้เป็นแค่ฉากหน้า: กดเข้าสู่ระบบแล้วเข้าได้เลยโดยไม่ดูรหัสผ่านที่พิมพ์
// ตอนนี้ตรวจจริง และถ้าบัญชีถูกแอดมินตั้ง/รีเซ็ตรหัสมาให้ จะบังคับตั้งรหัสใหม่ก่อนเข้าใช้งาน
import {html, useState, useEffect, Icon, brandMark, roleTH} from "../lib.js";
import {Globe} from "../globe.js";
import {LangToggle} from "../ui.js";
import {t} from "../i18n.js";   // สลับภาษา TH/EN — ดู src/i18n.js
import * as auth from "../auth.js";

export function Login({db, onLogin}){
  const [email, setEmail]   = useState("");
  const [pass, setPass]     = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy]     = useState(false);
  const [err, setErr]       = useState("");
  const [note, setNote]     = useState("");
  const [stage, setStage]   = useState("login");   // login → change (เมื่อถูกบังคับตั้งรหัสใหม่)
  const [pending, setPending] = useState(null);    // ผู้ใช้ที่ผ่านรหัสแล้วแต่ยังต้องตั้งรหัสใหม่
  const [pw1, setPw1]       = useState("");
  const [pw2, setPw2]       = useState("");
  // เดโม: เซิร์ฟเวอร์ตั้ง DEMO_PASSWORD ไว้ = บัญชีตัวอย่างใช้รหัสเดียวกันทุกคน กดปุ่มแล้วเข้าได้เลย
  // ระบบจริงไม่ตั้งค่านี้ ปุ่มตัวอย่างจะกรอกให้แค่อีเมล แล้วต้องรู้รหัสจริงเอง
  const [demo, setDemo] = useState(null);
  useEffect(()=>{ let alive=true;
    auth.call("info").then(r=>{ if(alive && r.ok && r.demo) setDemo(r.demoPassword||""); });
    return ()=>{ alive=false; };
  },[]);

  const submit = async e=>{
    e && e.preventDefault();
    if(busy) return;
    setErr(""); setNote(""); setBusy(true);
    const r = await auth.login(email.trim(), pass);
    setBusy(false);
    if(!r.ok){ setErr(r.error || t("เข้าสู่ระบบไม่สำเร็จ","Could not sign in")); return; }
    auth.saveAuth({token:r.token, user:r.user}, remember);
    if(r.mustChange){ setPending(r.user); setStage("change"); return; }   // รหัสที่แอดมินตั้งให้ ใช้ได้ครั้งเดียว
    onLogin(r.user);
  };

  const submitChange = async e=>{
    e && e.preventDefault();
    if(busy) return;
    setErr("");
    if(pw1 !== pw2){ setErr(t("รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน","The two new passwords do not match")); return; }
    setBusy(true);
    const r = await auth.changePassword(pass, pw1);
    setBusy(false);
    if(!r.ok){ setErr(r.error || t("เปลี่ยนรหัสผ่านไม่สำเร็จ","Could not change the password")); return; }
    auth.saveAuth({token:r.token, user:r.user}, remember);
    onLogin(r.user);
  };

  const DEMO_EMAIL = {Administrator:"admin@geointel.io", Management:"management@geointel.io",
                      "Trade Coordinator":"tc.bkk@geointel.io"};
  // โหมดเดโม = กดปุ่มบทบาทแล้วเข้าเลย (กรอกรหัสเดโมให้เองแล้วส่งฟอร์ม)
  const fillDemo = async r => {
    setErr(""); setEmail(DEMO_EMAIL[r]); setPass(demo || "");
    if(demo == null) return;                       // ยังไม่รู้ว่าเป็นเดโมไหม — กรอกให้เฉย ๆ
    setBusy(true);
    const res = await auth.login(DEMO_EMAIL[r], demo);
    setBusy(false);
    if(!res.ok){ setErr(res.error || t("เข้าสู่ระบบไม่สำเร็จ","Could not sign in")); return; }
    auth.saveAuth({token:res.token, user:res.user}, remember);
    if(res.mustChange){ setPending(res.user); setStage("change"); return; }
    onLogin(res.user);
  };

  return html`<div class="login">
    <div class="lg-side">
      <div id="lg-globe" style=${{position:"absolute",inset:0}}>
        <${Globe} countries=${db.countries} world=${db.world} small=${true}/>
      </div>
      <div class="lg-cap">
        <h2>${t("มองเห็นทั้งตลาดของคุณ", "See your entire market")}<br/>${t("บนแผนที่อัจฉริยะเพียงหน้าเดียว", "on a single intelligent map")}</h2>
        <p>${t("ระบบข่าวกรองเชิงพื้นที่ระดับองค์กร สำหรับวิเคราะห์การกระจายตัวของลูกค้า ค้นหาโอกาส", "Enterprise geo-intelligence for analysing customer distribution, spotting opportunities")}
           ${t("และวางแผนความครอบคลุม — ขับเคลื่อนด้วยการทำเหมืองข้อมูลเชิงสถิติทั่ว", "and planning coverage — powered by statistical data mining across the")} ${db.countries.length} ${t("ตลาด", "market")}</p>
        <div class="lg-tags">
          <span class="t">${t("วิเคราะห์แผนที่ความร้อน", "Heatmap analysis")}</span><span class="t">${t("วิเคราะห์ช่องว่าง", "Gap analysis")}</span>
          <span class="t">${t("วางแผนความครอบคลุม", "Coverage planning")}</span><span class="t">${t("เพิ่มประสิทธิภาพเส้นทาง", "Route optimisation")}</span>
        </div>
      </div>
    </div>

    <div class="lg-form">
      <!-- หน้าเข้าสู่ระบบไม่มี topbar — วางปุ่มสลับภาษาไว้มุมขวาบนของฟอร์ม ไม่งั้นสลับก่อนล็อกอินไม่ได้เลย -->
      <div style=${{position:"absolute",top:"18px",right:"20px",zIndex:2}}><${LangToggle}/></div>

      ${stage==="login" ? html`
      <form class="lg-card" onSubmit=${submit}>
        <div class="mk">${brandMark(24)}</div>
        <h1>${t("ยินดีต้อนรับกลับ", "Welcome back")}</h1>
        <p class="lgp">${t("เข้าสู่ระบบแพลตฟอร์ม GeoIntel", "Sign in to the GeoIntel platform")}</p>

        <div class="field"><label>${t("อีเมล", "Email")}</label>
          <input class="input" type="email" autocomplete="username" placeholder="you@company.com" value=${email}
            onInput=${e=>{setEmail(e.target.value); setErr("");}}/></div>
        <div class="field"><label>${t("รหัสผ่าน", "Password")}</label>
          <input class="input" type="password" autocomplete="current-password" placeholder="••••••••••" value=${pass}
            onInput=${e=>{setPass(e.target.value); setErr("");}}/></div>

        ${err && html`<div class="lg-err" role="alert">${err}</div>`}
        ${note && html`<div class="lg-note">${note}</div>`}

        <div class="lg-remember">
          <label onClick=${()=>setRemember(!remember)}>
            <span class=${"checkbox"+(remember?" on":"")}>${remember&&html`<${Icon} name="check" size=${12} color="#fff"/>`}</span>
            ${t("จดจำฉัน", "Remember me")}</label>
          <span class="link" onClick=${()=>setNote(t("ให้ผู้ดูแลระบบรีเซ็ตรหัสให้ที่หน้าจัดการผู้ใช้ แล้วนำรหัสชั่วคราวมาเข้าสู่ระบบ ระบบจะให้ตั้งรหัสใหม่เอง",
            "Ask an administrator to reset it in User management, then sign in with the temporary password and set a new one"))}>
            ${t("ลืมรหัสผ่าน?", "Forgot password?")}</span>
        </div>

        <button class="btn primary" style=${{width:"100%"}} type="submit" disabled=${busy}>
          ${busy?t("กำลังเข้าสู่ระบบ…", "Signing in…"):t("เข้าสู่ระบบ", "Sign in")} ${!busy&&html`<${Icon} name="chevronR" size=${16}/>`}</button>

        <div class="lg-roles">
          <div class="rl">${demo!=null ? t("เข้าดูเดโม — เลือกบทบาทแล้วเข้าได้เลย", "Try the demo — pick a role and you are in")
                                        : t("กรอกอีเมลตัวอย่าง (ยังต้องใส่รหัสผ่านจริง)", "Fill a sample email (a real password is still required)")}</div>
          <div class="rr">
            ${["Administrator","Management","Trade Coordinator"].map(r=>html`<button key=${r} type="button"
              onClick=${()=>fillDemo(r)}>${roleTH(r)}</button>`)}
          </div>
        </div>
      </form>` : html`

      <!-- ขั้นบังคับตั้งรหัสใหม่ — รหัสที่แอดมินตั้ง/รีเซ็ตให้ใช้เข้าได้ครั้งเดียว -->
      <form class="lg-card" onSubmit=${submitChange}>
        <div class="mk">${brandMark(24)}</div>
        <h1>${t("ตั้งรหัสผ่านใหม่", "Set a new password")}</h1>
        <p class="lgp">${t("บัญชีนี้ใช้รหัสที่ผู้ดูแลระบบตั้งให้ ตั้งรหัสของคุณเองก่อนเริ่มใช้งาน", "This account uses a password set by an administrator — choose your own before continuing")}
          ${pending ? html`<br/><b>${pending.email}</b>` : ""}</p>

        <div class="field"><label>${t("รหัสผ่านใหม่", "New password")}</label>
          <input class="input" type="password" autocomplete="new-password" value=${pw1}
            onInput=${e=>{setPw1(e.target.value); setErr("");}}/>
          <div class="lg-hint">${t("อย่างน้อย 8 ตัวอักษร และต้องมีทั้งตัวอักษรและตัวเลข", "At least 8 characters, with both letters and digits")}</div></div>
        <div class="field"><label>${t("ยืนยันรหัสผ่านใหม่", "Confirm new password")}</label>
          <input class="input" type="password" autocomplete="new-password" value=${pw2}
            onInput=${e=>{setPw2(e.target.value); setErr("");}}/></div>

        ${err && html`<div class="lg-err" role="alert">${err}</div>`}

        <button class="btn primary" style=${{width:"100%"}} type="submit" disabled=${busy}>
          ${busy?t("กำลังบันทึก…", "Saving…"):t("บันทึกรหัสผ่านและเข้าใช้งาน", "Save password and continue")}</button>
      </form>`}
    </div>
  </div>`;
}
