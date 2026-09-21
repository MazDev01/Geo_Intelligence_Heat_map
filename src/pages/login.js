// ถอด LANGS ออกจาก import — ค้างมาจากการ merge i18n สองเวอร์ชันเข้าด้วยกัน
// lib.js ไม่ได้ export ตัวนี้ และไฟล์นี้ไม่ได้เรียกใช้เลย (รายการภาษาอยู่ใน <LangToggle/> แล้ว)
import {html, useState, Icon, brandMark, roleTH, getLang, setLang} from "../lib.js";
import {Globe} from "../globe.js";
import {LangToggle} from "../ui.js";
import {t} from "../i18n.js";   // สลับภาษา TH/EN — ดู src/i18n.js

export function Login({db, onLogin}){
  const [role, setRole] = useState("Administrator");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);

  // 3 บทบาทในระบบ — ไม่มี "ผู้ใช้ธุรกิจ" อีกต่อไป
  const META = {
    Administrator:{email:"admin@geointel.io", initials:"SA"},
    Management:{email:"management@geointel.io", initials:"MG"},
    "Trade Coordinator":{email:"tc@geointel.io", initials:"TC"},
  };
  const defaults = Object.fromEntries(Object.entries(META).map(([r,m])=>[r,m.email]));
  const submit = e=>{ e && e.preventDefault(); setBusy(true);
    setTimeout(()=>onLogin({
      role, name: roleTH(role),
      email: user || defaults[role], initials: META[role].initials
    }), 650);
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
      <form class="lg-card" onSubmit=${submit}>
        <div class="mk">${brandMark(24)}</div>
        <h1>${t("ยินดีต้อนรับกลับ", "Welcome back")}</h1>
        <p class="lgp">${t("เข้าสู่ระบบแพลตฟอร์ม GeoIntel", "Sign in to the GeoIntel platform")}</p>

        <div class="field"><label>${t("ชื่อผู้ใช้ / อีเมล", "Username / email")}</label>
          <input class="input" placeholder=${defaults[role]} value=${user}
            onInput=${e=>setUser(e.target.value)}/>
          <div class="lg-hint">${t("บัญชีตัวอย่าง:", "Demo account:")} ${defaults[role]}</div></div>
        <div class="field"><label>${t("รหัสผ่าน", "Password")}</label>
          <input class="input" type="password" placeholder="••••••••••" value=${pass}
            onInput=${e=>setPass(e.target.value)}/></div>

        <div class="lg-remember">
          <label onClick=${()=>setRemember(!remember)}>
            <span class=${"checkbox"+(remember?" on":"")}>${remember&&html`<${Icon} name="check" size=${12} color="#fff"/>`}</span>
            ${t("จดจำฉัน", "Remember me")}</label>
          <span class="link">${t("ลืมรหัสผ่าน?", "Forgot password?")}</span>
        </div>

        <button class="btn primary" style=${{width:"100%"}} type="submit" disabled=${busy}>
          ${busy?t("กำลังเข้าสู่ระบบ…", "Signing in…"):t("เข้าสู่ระบบ", "Sign in")} ${!busy&&html`<${Icon} name="chevronR" size=${16}/>`}</button>

        <div class="lg-roles">
          <div class="rl">${t("เข้าสู่ระบบตัวอย่าง — เลือกบทบาท", "Demo sign-in — pick a role")}</div>
          <div class="rr">
            ${["Administrator","Management","Trade Coordinator"].map(r=>html`<button key=${r} type="button"
              class=${role===r?"on":""} onClick=${()=>setRole(r)}>${roleTH(r)}</button>`)}
          </div>
        </div>
      </form>
    </div>
  </div>`;
}
