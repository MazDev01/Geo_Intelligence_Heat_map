import {html, useState, useApp, Icon, roleTH} from "../lib.js";
import {Card, Btn, Toggle, Field, Badge} from "../ui.js";
import {toast} from "../ui.js";
import {userSettableEvents, roleEvents, getUserOff, setUserOff} from "../notifications.js";

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
    <div class="page-head"><div><div class="eyebrow">บัญชี</div><h1>โปรไฟล์และการตั้งค่า</h1>
      <div class="sub">จัดการข้อมูลส่วนตัว ความปลอดภัย และการแจ้งเตือน</div></div></div>

    <div class="grid" style=${{gridTemplateColumns:"280px 1fr",alignItems:"start"}}>
      <${Card}>
        <div style=${{textAlign:"center",padding:"8px 0 4px"}}>
          <div class="avatar" style=${{width:"84px",height:"84px",fontSize:"30px",margin:"0 auto 14px"}}>${user.initials}</div>
          <h2 style=${{margin:"0 0 4px",fontSize:"18px"}}>${user.name}</h2>
          <div class="muted" style=${{fontSize:"12.5px",marginBottom:"10px"}}>${user.email}</div>
          <${Badge} tone=${user.role==="Administrator"?"bad":"info"}>${roleTH(user.role)}</${Badge}>
        </div>
        <div class="hr"></div>
        ${[["info","ข้อมูลส่วนตัว","user"],["password","เปลี่ยนรหัสผ่าน","key"],["notif","ตั้งค่าการแจ้งเตือน","bell"]].map(([id,label,icon])=>
          html`<div key=${id} class="row" onClick=${()=>setTab(id)} style=${{gap:"11px",padding:"11px 10px",borderRadius:"9px",cursor:"pointer",
            background:tab===id?"rgba(230, 0, 35,.10)":"transparent",
            color:tab===id?"var(--accent-deep)":"var(--muted)",fontWeight:tab===id?700:500}}>
            <${Icon} name=${icon} size=${17}/><span style=${{fontSize:"13px",fontWeight:600}}>${label}</span></div>`)}
        <div class="hr"></div>
        <${Btn} variant="danger" icon="logout" onClick=${logout}>ออกจากระบบ</${Btn}>
      </${Card}>

      <div>
        ${tab==="info" && html`<${Card} title="ข้อมูลส่วนตัว">
          <div class="grid g2">
            <${Field} label="ชื่อ-นามสกุล"><input class="input" defaultValue=${user.name}/></${Field}>
            <${Field} label="อีเมล"><input class="input" defaultValue=${user.email}/></${Field}>
            <${Field} label="แผนก"><input class="input" defaultValue="ข่าวกรองเชิงพาณิชย์"/></${Field}>
            <${Field} label="ตำแหน่ง"><input class="input" defaultValue=${user.role==="Administrator"?"ผู้ดูแลระบบอาวุโส":roleTH(user.role)}/></${Field}>
            <${Field} label="เบอร์โทรศัพท์"><input class="input" defaultValue="+66 2 000 0000"/></${Field}>
          </div>
          <div class="row" style=${{gap:"10px",marginTop:"8px"}}>
            <${Btn} variant="primary" icon="edit" onClick=${()=>toast("บันทึกโปรไฟล์แล้ว","good")}>แก้ไขโปรไฟล์</${Btn}>
            <${Btn} variant="ghost" icon="key" onClick=${()=>setTab("password")}>เปลี่ยนรหัสผ่าน</${Btn}></div>
        </${Card}>`}

        ${tab==="password" && html`<${Card} title="เปลี่ยนรหัสผ่าน">
          <div style=${{maxWidth:"420px"}}>
            <${Field} label="รหัสผ่านปัจจุบัน"><input class="input" type="password" placeholder="••••••••"/></${Field}>
            <${Field} label="รหัสผ่านใหม่"><input class="input" type="password" placeholder="••••••••"/></${Field}>
            <${Field} label="ยืนยันรหัสผ่านใหม่"><input class="input" type="password" placeholder="••••••••"/></${Field}>
            <div class="muted" style=${{fontSize:"12px",lineHeight:1.7,marginBottom:"14px"}}>
              รหัสผ่านต้องมีอย่างน้อย 10 ตัวอักษร ประกอบด้วยตัวพิมพ์ใหญ่ ตัวเลข และอักขระพิเศษ</div>
            <${Btn} variant="primary" icon="key" onClick=${()=>toast("เปลี่ยนรหัสผ่านแล้ว","good")}>อัปเดตรหัสผ่าน</${Btn}>
          </div>
        </${Card}>`}

        ${tab==="notif" && html`<${Card} title="ตั้งค่าการแจ้งเตือน"
          sub="เลือกได้เฉพาะเหตุการณ์ที่ผู้ดูแลระบบเปิดไว้ · ปิดของตัวเองได้ แต่เปิดเกินที่ระบบอนุญาตไม่ได้">
          ${myEvents.length ? myEvents.map(e=>
            html`<div key=${e.key} class="row between" style=${{padding:"13px 0",borderBottom:"1px solid var(--stroke)"}}>
              <span style=${{fontSize:"13px"}}>${e.label}</span>
              <${Toggle} on=${!off[e.key]} onChange=${()=>N(e.key)}/></div>`)
            : html`<div class="emptybox">ผู้ดูแลระบบปิดการแจ้งเตือนไว้ทั้งหมด</div>`}
          ${myEvents.length < roleAll.length ? html`<div class="dim" style=${{fontSize:"11.5px",marginTop:"10px"}}>
            อีก ${roleAll.length-myEvents.length} เหตุการณ์ถูกปิดไว้ที่ระดับระบบ จึงไม่แสดงที่นี่</div>` : ""}
          <div style=${{marginTop:"16px"}}><${Btn} variant="primary" icon="check" onClick=${()=>toast("บันทึกการตั้งค่าแล้ว","good")}>บันทึกการตั้งค่า</${Btn}></div>
        </${Card}>`}
      </div>
    </div>
  </div>`;
}
