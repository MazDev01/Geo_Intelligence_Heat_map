import {html, useState, Icon, brandMark, roleTH} from "../lib.js";
import {Globe} from "../globe.js";

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
        <h2>มองเห็นทั้งตลาดของคุณ<br/>บนแผนที่อัจฉริยะเพียงหน้าเดียว</h2>
        <p>ระบบข่าวกรองเชิงพื้นที่ระดับองค์กร สำหรับวิเคราะห์การกระจายตัวของลูกค้า ค้นหาโอกาส
           และวางแผนความครอบคลุม — ขับเคลื่อนด้วยการทำเหมืองข้อมูลเชิงสถิติทั่ว ${db.countries.length} ตลาด</p>
        <div class="lg-tags">
          <span class="t">วิเคราะห์แผนที่ความร้อน</span><span class="t">วิเคราะห์ช่องว่าง</span>
          <span class="t">วางแผนความครอบคลุม</span><span class="t">เพิ่มประสิทธิภาพเส้นทาง</span>
        </div>
      </div>
    </div>

    <div class="lg-form">
      <form class="lg-card" onSubmit=${submit}>
        <div class="mk">${brandMark(24)}</div>
        <h1>ยินดีต้อนรับกลับ</h1>
        <p class="lgp">เข้าสู่ระบบแพลตฟอร์ม GeoIntel</p>

        <div class="field"><label>ชื่อผู้ใช้ / อีเมล</label>
          <input class="input" placeholder=${defaults[role]} value=${user}
            onInput=${e=>setUser(e.target.value)}/>
          <div class="lg-hint">บัญชีตัวอย่าง: ${defaults[role]}</div></div>
        <div class="field"><label>รหัสผ่าน</label>
          <input class="input" type="password" placeholder="••••••••••" value=${pass}
            onInput=${e=>setPass(e.target.value)}/></div>

        <div class="lg-remember">
          <label onClick=${()=>setRemember(!remember)}>
            <span class=${"checkbox"+(remember?" on":"")}>${remember&&html`<${Icon} name="check" size=${12} color="#fff"/>`}</span>
            จดจำฉัน</label>
          <span class="link">ลืมรหัสผ่าน?</span>
        </div>

        <button class="btn primary" style=${{width:"100%"}} type="submit" disabled=${busy}>
          ${busy?"กำลังเข้าสู่ระบบ…":"เข้าสู่ระบบ"} ${!busy&&html`<${Icon} name="chevronR" size=${16}/>`}</button>

        <div class="lg-roles">
          <div class="rl">เข้าสู่ระบบตัวอย่าง — เลือกบทบาท</div>
          <div class="rr">
            ${["Administrator","Management","Trade Coordinator"].map(r=>html`<button key=${r} type="button"
              class=${role===r?"on":""} onClick=${()=>setRole(r)}>${roleTH(r)}</button>`)}
          </div>
        </div>
      </form>
    </div>
  </div>`;
}
