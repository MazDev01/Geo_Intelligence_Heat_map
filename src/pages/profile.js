import {html, useState, useEffect, useApp, Icon, roleTH} from "../lib.js";
import {Card, Btn, Toggle, Field, Badge, PwInput} from "../ui.js";
import {toast} from "../ui.js";
import {userSettableEvents, roleEvents, getUserOff, setUserOff} from "../notifications.js";
import {saveMyNotifOff, loadMyPrefs, saveMyProfile} from "../settings-api.js";
import {phoneOk} from "../contact-rules.js";
import {t} from "../i18n.js";   // สลับภาษา TH/EN — ดู src/i18n.js
import * as auth from "../auth.js";

export function Profile(){
  const {user, logout, profileTab, profileSeq, updateMe} = useApp();
  const [tab, setTab] = useState(profileTab || "info");
  useEffect(()=>{ setTab(profileTab || "info"); }, [profileSeq]);
  const [info, setInfo] = useState({name:user.name||"", phone:"", department:"", title:""});
  const [saved, setSaved] = useState(null);
  const [infoBusy, setInfoBusy] = useState(false);
  const [infoErr, setInfoErr] = useState("");
  useEffect(()=>{ let alive = true;
    loadMyPrefs().then(r=>{ if(!alive) return;
      const p = (r && r.ok && r.prefs && r.prefs.profile) || {};
      const next = {name:user.name||"", phone:p.phone||"", department:p.department||"", title:p.title||""};
      setInfo(next); setSaved(next);
      if(r && !r.ok) setInfoErr(r.error||"");
    });
    return ()=>{ alive = false; };
  },[user.email]);
  const setF = k => e => { setInfo(v=>({...v, [k]:e.target.value})); setInfoErr(""); };
  const infoDirty = !!saved && ["name","phone","department","title"].some(k=>String(info[k]).trim()!==String(saved[k]));
  const submitInfo = async ()=>{
    if(infoBusy || !saved) return;
    const body = {name:info.name.trim(), phone:info.phone.trim(), department:info.department.trim(), title:info.title.trim()};
    if(!body.name){ setInfoErr(t("ต้องใส่ชื่อ-นามสกุล", "Enter your full name")); return; }
    if(body.phone && !phoneOk(body.phone)){ setInfoErr(t("เบอร์โทรศัพท์ไม่ถูกต้อง เช่น 081 234 5678 หรือ 02 123 4567", "That phone number is not valid — for example 081 234 5678 or 02 123 4567")); return; }
    setInfoBusy(true);
    const r = await saveMyProfile(body);
    setInfoBusy(false);
    if(!r.ok){ setInfoErr(r.error || t("บันทึกไม่สำเร็จ", "Could not save")); return; }
    setInfo(body); setSaved(body);
    if(updateMe) updateMe({name:body.name});
    toast(r.local ? t("บันทึกในเครื่องนี้แล้ว (ไม่มีเซิร์ฟเวอร์)", "Saved on this device only (no server)") : t("บันทึกข้อมูลส่วนตัวแล้ว", "Profile saved"),"good");
  };
  const [pw0, setPw0] = useState("");
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwErr, setPwErr] = useState("");
  const submitPw = async ()=>{
    if(pwBusy) return;
    setPwErr("");
    if(!pw0 || !pw1){ setPwErr(t("กรอกรหัสผ่านปัจจุบันและรหัสผ่านใหม่", "Enter your current and new password")); return; }
    if(pw1 !== pw2){ setPwErr(t("รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน", "The two new passwords do not match")); return; }
    setPwBusy(true);
    const r = await auth.changePassword(pw0, pw1);
    setPwBusy(false);
    if(!r.ok){ setPwErr(r.error || t("เปลี่ยนรหัสผ่านไม่สำเร็จ", "Could not change the password")); return; }
    auth.replaceAuth({token:r.token, user:r.user});
    setPw0(""); setPw1(""); setPw2("");
    toast(t("เปลี่ยนรหัสผ่านแล้ว", "Password changed"),"good");
  };
  // รายการเหตุการณ์มาจาก notifications.js — แสดงเฉพาะที่ผู้ดูแลระบบเปิดไว้
  // ผู้ใช้ "ปิด" ของตัวเองได้ แต่เปิดเกินที่ระบบอนุญาตไม่ได้ (ไม่มีรายการนั้นให้เห็นตั้งแต่แรก)
  const [off, setOff] = useState(getUserOff);
  const {settingsVer} = useApp();
  useEffect(()=>{ setOff(getUserOff()); },[settingsVer]);
  // เฉพาะเหตุการณ์ที่ "บทบาทนี้มีสิทธิ์ได้รับ" และ "ระบบเปิดไว้" — ผู้บริหารจึงไม่เห็นสวิตช์ของงานแอดมิน
  const roleAll  = roleEvents(user.role);
  const myEvents = userSettableEvents(user.role);
  const N = async k => {
    const prev = off, next = {...off, [k]: !off[k]};
    setOff(next); setUserOff(next);
    const r = await saveMyNotifOff(next);
    if(!r.ok){ setOff(prev); setUserOff(prev); toast(r.error,"bad"); }
  };

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
          <form onSubmit=${e=>{ e.preventDefault(); submitInfo(); }}>
          <div class="grid g2">
            <${Field} label=${t("ชื่อ-นามสกุล", "Full name")}><input class="input" name="name" maxlength="80" value=${info.name} disabled=${!saved} onInput=${setF("name")}/></${Field}>
            <${Field} label=${t("อีเมล", "Email")}><input class="input" name="email" value=${user.email} readOnly=${true} style=${{opacity:.7,cursor:"not-allowed"}}/>
              <div class="dim" style=${{fontSize:"11.5px",marginTop:"5px"}}>${t("เปลี่ยนได้โดยผู้ดูแลระบบ", "Only an administrator can change this")}</div></${Field}>
            <${Field} label=${t("แผนก", "Department")}><input class="input" name="department" maxlength="80" value=${info.department} disabled=${!saved} onInput=${setF("department")}/></${Field}>
            <${Field} label=${t("ตำแหน่ง", "Job title")}><input class="input" name="title" maxlength="80" value=${info.title} disabled=${!saved} onInput=${setF("title")}/></${Field}>
            <${Field} label=${t("เบอร์โทรศัพท์", "Phone")}><input class="input" name="phone" type="tel" maxlength="30" placeholder="081 234 5678" value=${info.phone} disabled=${!saved} onInput=${setF("phone")}/></${Field}>
          </div>
          ${infoErr && html`<div role="alert" style=${{color:"#c81e1e",fontSize:"12.5px",margin:"4px 0 10px"}}>${infoErr}</div>`}
          <div class="row" style=${{gap:"10px",marginTop:"8px"}}>
            <${Btn} type="submit" variant="primary" icon="check" disabled=${infoBusy || !infoDirty}>${infoBusy ? t("กำลังบันทึก…", "Saving…") : t("บันทึก", "Save")}</${Btn}>
            <${Btn} variant="ghost" icon="key" onClick=${()=>setTab("password")}>${t("เปลี่ยนรหัสผ่าน", "Change password")}</${Btn}></div>
          </form>
        </${Card}>`}

        ${tab==="password" && html`<${Card} title=${t("เปลี่ยนรหัสผ่าน", "Change password")}>
          <form style=${{maxWidth:"420px"}} onSubmit=${e=>{ e.preventDefault(); submitPw(); }}>
            <${Field} label=${t("รหัสผ่านปัจจุบัน", "Current password")}><${PwInput} autocomplete="current-password" placeholder="••••••••" value=${pw0} onInput=${e=>{ setPw0(e.target.value); setPwErr(""); }}/></${Field}>
            <${Field} label=${t("รหัสผ่านใหม่", "New password")}><${PwInput} autocomplete="new-password" placeholder="••••••••" value=${pw1} onInput=${e=>{ setPw1(e.target.value); setPwErr(""); }}/></${Field}>
            <${Field} label=${t("ยืนยันรหัสผ่านใหม่", "Confirm new password")}><${PwInput} autocomplete="new-password" placeholder="••••••••" value=${pw2} onInput=${e=>{ setPw2(e.target.value); setPwErr(""); }}/></${Field}>
            <div class="muted" style=${{fontSize:"12px",lineHeight:1.7,marginBottom:"14px"}}>
              ${t("อย่างน้อย 8 ตัวอักษร และต้องมีทั้งตัวอักษรและตัวเลข", "At least 8 characters, with both letters and digits")}</div>
            ${pwErr && html`<div role="alert" style=${{color:"#c81e1e",fontSize:"12.5px",marginBottom:"12px"}}>${pwErr}</div>`}
            <${Btn} type="submit" variant="primary" icon="key" disabled=${pwBusy}>${pwBusy ? t("กำลังบันทึก…", "Saving…") : t("อัปเดตรหัสผ่าน", "Update password")}</${Btn}>
          </form>
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
          ${myEvents.length ? html`<div class="dim" style=${{fontSize:"11.5px",marginTop:"14px"}}>${t("บันทึกอัตโนมัติเมื่อกดสวิตช์", "Saved automatically when you flip a switch")}</div>` : ""}
        </${Card}>`}
      </div>
    </div>
  </div>`;
}
