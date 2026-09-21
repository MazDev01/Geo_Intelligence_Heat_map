import {html, useState, useApp, Icon, roleTH} from "../lib.js";
import {Card, Btn, Toggle, Field, Badge} from "../ui.js";
import {toast} from "../ui.js";
import {userSettableEvents, roleEvents, getUserOff, setUserOff} from "../notifications.js";
import {t} from "../i18n.js";   // สลับภาษา TH/EN — ดู src/i18n.js

export function Profile(){
  const {user, logout, profileTab} = useApp();
  const [tab, setTab] = useState(profileTab || "info");
  // รายการเหตุการณ์มาจาก notifications.js — แสดงเฉพาะที่ผู้ดูแลระบบเปิดไว้
  // ผู้ใช้ "ปิด" ของตัวเองได้ แต่เปิดเกินที่ระบบอนุญาตไม่ได้ (ไม่มีรายการนั้นให้เห็นตั้งแต่แรก)
  const [off, setOff] = useState(getUserOff);
  // เฉพาะเหตุการณ์ที่ "บทบาทนี้มีสิทธิ์ได้รับ" และ "ระบบเปิดไว้" — ผู้บริหารจึงไม่เห็นสวิตช์ของงานแอดมิน
  const roleAll  = roleEvents(user.role);
  const myEvents = userSettableEvents(user.role);
  const N = k => setOff(m=>{ const next={...m, [k]: !m[k]}; setUserOff(next); return next; });

  return html`<div class="page fade-in">
    <div class="page-head"><div><div class="eyebrow">${t("บัญชี", "Account")}</div><h1>${t("โปรไฟล์และการตั้งค่า", "Profile and settings")}</h1>
      <div class="sub">${t("จัดการข้อมูลส่วนตัว ความปลอดภัย และการแจ้งเตือน", "Manage your details, security and notifications")}</div></div></div>

    <div class="grid" style=${{gridTemplateColumns:"280px 1fr",alignItems:"start"}}>
      <${Card}>
        <div style=${{textAlign:"center",padding:"8px 0 4px"}}>
          <div class="avatar" style=${{width:"84px",height:"84px",fontSize:"30px",margin:"0 auto 14px"}}>${user.initials}</div>
          <h2 style=${{margin:"0 0 4px",fontSize:"18px"}}>${user.name}</h2>
          <div class="muted" style=${{fontSize:"12.5px",marginBottom:"10px"}}>${user.email}</div>
          <${Badge} tone=${user.role==="Administrator"?"bad":"info"}>${roleTH(user.role)}</${Badge}>
        </div>
        <div class="hr"></div>
        ${[["info",t("ข้อมูลส่วนตัว", "Personal details"),"user"],["password",t("เปลี่ยนรหัสผ่าน", "Change password"),"key"],["notif",t("ตั้งค่าการแจ้งเตือน", "Notification settings"),"bell"]].map(([id,label,icon])=>
          html`<div key=${id} class="row" onClick=${()=>setTab(id)} style=${{gap:"11px",padding:"11px 10px",borderRadius:"9px",cursor:"pointer",
            background:tab===id?"rgba(230, 0, 35,.10)":"transparent",
            color:tab===id?"var(--accent-deep)":"var(--muted)",fontWeight:tab===id?700:500}}>
            <${Icon} name=${icon} size=${17}/><span style=${{fontSize:"13px",fontWeight:600}}>${label}</span></div>`)}
        <div class="hr"></div>
        <${Btn} variant="danger" icon="logout" onClick=${logout}>${t("ออกจากระบบ", "Sign out")}</${Btn}>
      </${Card}>

      <div>
        ${tab==="info" && html`<${Card} title=${t("ข้อมูลส่วนตัว", "Personal details")}>
          <div class="grid g2">
            <${Field} label=${t("ชื่อ-นามสกุล", "Full name")}><input class="input" defaultValue=${user.name}/></${Field}>
            <${Field} label=${t("อีเมล", "Email")}><input class="input" defaultValue=${user.email}/></${Field}>
            <${Field} label=${t("แผนก", "Department")}><input class="input" defaultValue=${t("ข่าวกรองเชิงพาณิชย์", "Commercial Intelligence")}/></${Field}>
            <${Field} label=${t("ตำแหน่ง", "Job title")}><input class="input" defaultValue=${user.role==="Administrator"?t("ผู้ดูแลระบบอาวุโส", "Senior System Administrator"):roleTH(user.role)}/></${Field}>
            <${Field} label=${t("เบอร์โทรศัพท์", "Phone")}><input class="input" defaultValue="+66 2 000 0000"/></${Field}>
          </div>
          <div class="row" style=${{gap:"10px",marginTop:"8px"}}>
            <${Btn} variant="primary" icon="edit" onClick=${()=>toast(t("บันทึกโปรไฟล์แล้ว", "Profile saved"),"good")}>${t("แก้ไขโปรไฟล์", "Save profile")}</${Btn}>
            <${Btn} variant="ghost" icon="key" onClick=${()=>setTab("password")}>${t("เปลี่ยนรหัสผ่าน", "Change password")}</${Btn}></div>
        </${Card}>`}

        ${tab==="password" && html`<${Card} title=${t("เปลี่ยนรหัสผ่าน", "Change password")}>
          <div style=${{maxWidth:"420px"}}>
            <${Field} label=${t("รหัสผ่านปัจจุบัน", "Current password")}><input class="input" type="password" placeholder="••••••••"/></${Field}>
            <${Field} label=${t("รหัสผ่านใหม่", "New password")}><input class="input" type="password" placeholder="••••••••"/></${Field}>
            <${Field} label=${t("ยืนยันรหัสผ่านใหม่", "Confirm new password")}><input class="input" type="password" placeholder="••••••••"/></${Field}>
            <div class="muted" style=${{fontSize:"12px",lineHeight:1.7,marginBottom:"14px"}}>
              ${t("รหัสผ่านต้องมีอย่างน้อย 10 ตัวอักษร ประกอบด้วยตัวพิมพ์ใหญ่ ตัวเลข และอักขระพิเศษ", "Passwords must be at least 10 characters and include an uppercase letter, a number and a special character")}</div>
            <${Btn} variant="primary" icon="key" onClick=${()=>toast(t("เปลี่ยนรหัสผ่านแล้ว", "Password changed"),"good")}>${t("อัปเดตรหัสผ่าน", "Update password")}</${Btn}>
          </div>
        </${Card}>`}

        ${tab==="notif" && html`<${Card} title=${t("ตั้งค่าการแจ้งเตือน", "Notification settings")}
          sub=${t("เลือกได้เฉพาะเหตุการณ์ที่ผู้ดูแลระบบเปิดไว้ · ปิดของตัวเองได้ แต่เปิดเกินที่ระบบอนุญาตไม่ได้", "You can only pick events the administrator has enabled · you may turn yours off, but not on beyond what the system allows")}>
          ${myEvents.length ? myEvents.map(e=>
            html`<div key=${e.key} class="row between" style=${{padding:"13px 0",borderBottom:"1px solid var(--stroke)"}}>
              <span style=${{fontSize:"13px"}}>${e.label}</span>
              <${Toggle} on=${!off[e.key]} onChange=${()=>N(e.key)}/></div>`)
            : html`<div class="emptybox">${t("ผู้ดูแลระบบปิดการแจ้งเตือนไว้ทั้งหมด", "The administrator has disabled all notifications")}</div>`}
          ${myEvents.length < roleAll.length ? html`<div class="dim" style=${{fontSize:"11.5px",marginTop:"10px"}}>
            ${t("อีก", "Another")} ${roleAll.length-myEvents.length} ${t("เหตุการณ์ถูกปิดไว้ที่ระดับระบบ จึงไม่แสดงที่นี่", "events are disabled system-wide, so they are not shown here")}</div>` : ""}
          <div style=${{marginTop:"16px"}}><${Btn} variant="primary" icon="check" onClick=${()=>toast(t("บันทึกการตั้งค่าแล้ว", "Settings saved"),"good")}>${t("บันทึกการตั้งค่า", "Save settings")}</${Btn}></div>
        </${Card}>`}
      </div>
    </div>
  </div>`;
}
