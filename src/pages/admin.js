import {html, useState, useEffect, useMemo, useApp, Icon, num, pct, roleTH, provinceTH, segTH, STATUS_COLOR, thDate, thDateTime, thMonth} from "../lib.js";
import {SEGMENTS, SEG_COLOR, OTHER_COLOR, DISTRICT_TH, GAP_REF, GAP_TH, demandGap, gapBySegment} from "../mock/geoData.js";
import {LeafletMap} from "../lmap.js";   // แผนที่ความร้อนระดับประเทศ (ใช้ตัวเดียวกับหน้าอื่น)
import {getAudit, subscribeAudit, pushAudit} from "../audit.js";
import {Card, Kpi, Btn, Badge, Toggle, Field, Table, Tabs, Modal, Meter, DateField, toast} from "../ui.js";
import {Dropdown} from "../select.js";
import {genLeads} from "./lead-management.js";   // ไปป์ไลน์ "จัดการ Lead" — โชว์จำนวนคงค้างในงานที่รอดำเนินการ
import {LineChart, BarChart, Donut, Sparkline} from "../charts.js";
import {calcView, RANGES} from "../timefilter.js";   // thDate มาจาก lib.js โดยตรงแล้ว
import {ExportDialog, defaultReportName, downloadXLS} from "./reports.js";   // ป็อปอัพส่งออก (ใช้ร่วมกับหน้ารายงาน)
import {downloadCSV, areaCoverage} from "../data.js";
import {canExport, EXPORT_ROLES, EXPORT_FORMATS, getExportPerms, setExportPerms} from "../export-perms.js";
import {NOTIF_EVENTS, PRIORITY_TH, getSysNotif, setSysNotif} from "../notifications.js";
import {ROLES, SCOPES, DEFAULT_SCOPE, PERM_MODULES, PERM_INDEX, PERM_COUNT, GUARD_KEY,
  permByRole, roleGrants, roleForbids, effectivePerms, realOverrides} from "../permissions.js";

/* ================= จัดการผู้ใช้ ================= */
// ชื่อ TC ใช้ชุดเดียวกับทีมภาคสนามใน src/mock/geoData.js (TC_TEAM) — ตัวตนของ TC ไม่ผูกกับชื่อจังหวัด
// เพราะ "ขอบเขตพื้นที่บริการ" ย้ายได้ (ดูส่วน "จัดการขอบเขตพื้นที่การขาย" ท้ายหน้าจัดการข้อมูล)
// province = จังหวัดหลักในโปรไฟล์ · null = ยังไม่มีพื้นที่ในความดูแล
export const SEED_USERS = [
  {id:1,name:"System Administrator",email:"admin@geointel.io",role:"Administrator",status:"Active",last:"2026-07-11 09:12"},
  {id:2,name:"ผู้บริหารภูมิภาค",email:"management@geointel.io",role:"Management",status:"Active",last:"2026-07-11 08:40"},
  {id:3,name:"ณัฐริกา พงษ์ไพบูลย์",email:"tc.bkk@geointel.io",role:"Trade Coordinator",province:"Bangkok Metropolis",status:"Active",last:"2026-07-10 17:22"},
  {id:4,name:"ศุภมาส เจริญสุข",email:"tc.pty@geointel.io",role:"Trade Coordinator",province:"Pattaya",status:"Active",last:"2026-07-02 11:05"},
  {id:5,name:"David Chen",email:"david@geointel.io",role:"Administrator",status:"Active",last:"2026-07-11 07:58"},
  {id:6,name:"ธนพล ศรีวัฒน์",email:"tc.cm@geointel.io",role:"Trade Coordinator",province:"Chiang Mai",status:"Active",last:"2026-07-11 08:10"},
  {id:7,name:"ปิยะนุช วงศ์สกุล",email:"tc.hkt@geointel.io",role:"Trade Coordinator",province:"Phuket",status:"Active",last:"2026-07-10 16:00"},
  {id:8,name:"วีรภัทร ตันติพงศ์",email:"tc.new@geointel.io",role:"Trade Coordinator",province:null,status:"Active",last:"—"},
  {id:9,name:"กิตติศักดิ์ อารยะกุล",email:"tc.kit@geointel.io",role:"Trade Coordinator",province:null,status:"Active",last:"2026-07-09 13:40"},
];
export function Users(){
  const {user:me}=useApp();
  const [users,setUsers]=useState(SEED_USERS);
  const [edit,setEdit]=useState(null);
  const [perm,setPerm]=useState(null);
  const [delUser,setDelUser]=useState(null);   // บัญชีที่รอยืนยันลบ
  const [roleF,setRoleF]=useState("All");   // ตัวกรองตามบทบาท
  const [search,setSearch]=useState("");    // ค้นหาชื่อ/อีเมล
  const save=u=>{ setUsers(list=> u.id? list.map(x=>x.id===u.id?u:x) : [...list,{...u,id:Date.now(),status:"Active",last:"—"}]);
    setEdit(null); toast(u.id?"อัปเดตผู้ใช้แล้ว":"สร้างผู้ใช้แล้ว","good"); };
  const del=u=>{ setUsers(list=>list.filter(x=>x.id!==u.id)); toast("ลบผู้ใช้แล้ว","bad"); };
  // บันทึกสิทธิ์: เขียน log ทีละรายการตามกติกา G5 (เปลี่ยนของใคร จากอะไรเป็นอะไร)
  const savePerm=(target, next, changes)=>{
    setUsers(list=>list.map(x=> x.id===target.id ? {...x, role:next.role, scope:next.scope, permOverrides:next.overrides} : x));
    for(const c of changes) pushAudit({action:"แก้ไขสิทธิ์ผู้ใช้", category:"แก้ไข",
      detail:`${target.name} · ${c.key} : ${c.from} → ${c.to}`});
    setPerm(null);
    toast(changes.length? `บันทึกสิทธิ์แล้ว ${changes.length} รายการ` : "ไม่มีการเปลี่ยนแปลง", changes.length?"good":"info");
  };
  const q = search.trim().toLowerCase();
  const shown = users.filter(u=> (roleF==="All" || u.role===roleF)
    && (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)));
  const initials = s => (s||"").trim().split(/\s+/).map(w=>w[0]||"").slice(0,2).join("");
  const roleCls = r => r==="Administrator" ? "adm" : r==="Management" ? "mgr" : "tc";

  return html`<div class="page fade-in um-page">
    <div class="page-head">
      <div><h1>จัดการผู้ใช้</h1>
        <div class="sub">จัดการบัญชีและสิทธิ์การเข้าถึงระบบ</div></div>
      <div class="ph-right">
        <${Btn} variant="primary" icon="plus"
          onClick=${()=>setEdit({name:"",email:"",role:"Trade Coordinator"})}>เพิ่มผู้ใช้</${Btn}></div>
    </div>

    <!-- สรุปจำนวนตามบทบาท — การ์ดเตี้ยกว่าปกติ ไม่ให้แย่งพื้นที่ไปจากตาราง -->
    <div class="grid g4 um-kpis">
      <${Kpi} label="ผู้ใช้ทั้งหมด" value=${users.length} icon="users"/>
      <${Kpi} label="ผู้ดูแลระบบ" value=${users.filter(u=>u.role==="Administrator").length} icon="shield"/>
      <${Kpi} label="ผู้ประสานงานการค้า (TC)" value=${users.filter(u=>u.role==="Trade Coordinator").length} icon="user"/>
      <${Kpi} label="ผู้บริหาร" value=${users.filter(u=>u.role==="Management").length} icon="check"/>
    </div>

    <!-- แถบเครื่องมือ: ค้นหา + กรองบทบาท อยู่แถวเดียวกัน · ห่อบรรทัดเองเมื่อจอแคบ -->
    <div class="um-bar">
      <div class="searchbox um-search"><${Icon} name="search" size=${15}/>
        <input placeholder="ค้นหาชื่อหรืออีเมล…" value=${search} onInput=${e=>setSearch(e.target.value)}/></div>
      <div class="um-dd"><${Dropdown} value=${roleF} onChange=${setRoleF}
        options=${[["All","ทุกบทบาท"],["Administrator","ผู้ดูแลระบบ"],["Management","ผู้บริหาร"],["Trade Coordinator","ผู้ประสานงานการค้า (TC)"]]}/></div>
      ${(roleF!=="All"||q) && html`<button class="um-clear" onClick=${()=>{setRoleF("All");setSearch("");}}>ล้าง</button>`}
    </div>

    <!-- ตารางเป็นตัวเอกของหน้า — Table วาดกรอบการ์ดให้อยู่แล้ว จึงไม่ต้องมี Card ซ้อนอีกชั้น -->
    <div class="um-table">
      <${Table} empty="ไม่พบบัญชีตามเงื่อนไขนี้" cols=${[
        {h:"ผู้ใช้", render:u=>html`<div class="um-user">
          <span class=${"um-av "+roleCls(u.role)}>${initials(u.name)}</span>
          <div style=${{minWidth:0}}>
            <div class="um-nm">${u.name}</div>
            <div class="um-em">${u.email}</div></div></div>`},
        {h:"บทบาท", w:"210px", render:u=>html`<span class=${"um-role "+roleCls(u.role)}>${roleTH(u.role)}</span>`},
        {h:"เข้าสู่ระบบล่าสุด", w:"170px", render:u=>html`<span class="um-last">${u.last==="—"?"—":thDateTime(u.last)}</span>`},
        {h:"การจัดการ", w:"230px", render:u=>html`<div class="um-act">
          <button class="um-btn" onClick=${()=>setEdit(u)}><${Icon} name="edit" size=${14}/>แก้ไข</button>
          <button class="um-btn" onClick=${()=>setPerm(u)}><${Icon} name="key" size=${14}/>สิทธิ์</button>
          <button class="um-del" onClick=${()=>setDelUser(u)} title="ลบบัญชี"
            aria-label=${"ลบบัญชี "+u.name}><${Icon} name="trash" size=${15}/></button>
        </div>`},
      ]} rows=${shown}/>
    </div>
    <style>${UM_CSS}</style>


    ${edit && html`<${Modal} title=${edit.id?"แก้ไขผู้ใช้":"เพิ่มผู้ใช้"} onClose=${()=>setEdit(null)}
      footer=${html`<${Btn} variant="ghost" onClick=${()=>setEdit(null)}>ยกเลิก</${Btn}>
        <${Btn} variant="outline" icon="check" onClick=${()=>{const f=window.__uf; save({...edit,name:f.name.value,email:f.email.value,role:f.role.value});}}>บันทึก</${Btn}>`}>
      <form ref=${el=>window.__uf=el}>
        <${Field} label="ชื่อ-นามสกุล"><input class="input" name="name" defaultValue=${edit.name}/></${Field}>
        <${Field} label="อีเมล"><input class="input" name="email" defaultValue=${edit.email}/></${Field}>
        <${Field} label="บทบาท"><select class="input" name="role" defaultValue=${edit.role}>
          <option value="Administrator">ผู้ดูแลระบบ</option><option value="Management">ผู้บริหาร</option>
          <option value="Trade Coordinator">ผู้ประสานงานการค้า (TC)</option></select></${Field}>
      </form>
    </${Modal}>`}

    ${delUser && html`<${Modal} title="ยืนยันการลบบัญชี" small=${true} onClose=${()=>setDelUser(null)}
      footer=${html`<${Btn} variant="ghost" onClick=${()=>setDelUser(null)}>ยกเลิก</${Btn}>
        <${Btn} variant="danger" icon="trash" onClick=${()=>{ del(delUser); setDelUser(null); }}>ยืนยันลบ</${Btn}>`}>
      <div style=${{fontSize:"13px",lineHeight:1.8}}>ลบ <b>${delUser.name}</b> (${delUser.email}) ออกจากระบบ?</div>
    </${Modal}>`}

    ${perm && html`<${PermissionDialog} key=${perm.id} target=${perm} users=${users} me=${me}
      onClose=${()=>setPerm(null)} onSave=${savePerm}/>`}
    <style>${PERM_CSS}</style>
  </div>`;
}


/* ═══════════════════════════════════════════════════════════════════════════
   ป็อปอัพจัดการสิทธิ์รายบุคคล — 3 ชั้นตามเอกสารแบบจำลองสิทธิ์
     บทบาท (ชุดสำเร็จรูป) → สิทธิ์รายเมนู (เปิด/ปิดรายบุคคล) → ขอบเขตข้อมูล
   กติกาที่บังคับในหน้านี้: G1 (เหลือผู้ให้สิทธิ์ ≥1 คน) · G2 (แก้ของตัวเองไม่ได้)
   · G5 (ทุกการเปลี่ยนแปลงลง audit ทีละรายการ)
   หมายเหตุ: UI ชั้นนี้ทำหน้าที่ "ซ่อน/แสดง" เท่านั้น การบังคับสิทธิ์จริงต้องทำที่เซิร์ฟเวอร์
   ═══════════════════════════════════════════════════════════════════════════ */
const thRole  = r => (ROLES.find(x=>x.key===r)||{}).th || r;
const thScope = s => (SCOPES.find(x=>x.key===s)||{}).th || s;

function PermissionDialog({target, users, me, onClose, onSave}){
  const prevScope = target.scope || DEFAULT_SCOPE[target.role] || "own_area";
  const [role,setRole]   = useState(target.role);
  const [scope,setScope] = useState(prevScope);
  const [ov,setOv]       = useState(()=>({...(target.permOverrides||{})}));
  const [open,setOpen]   = useState("");

  const isSelf = !!(me && me.email && me.email===target.email);          // G2
  const otherGuards = users.filter(u=> u.id!==target.id
    && effectivePerms(u.role, u.permOverrides||{}).has(GUARD_KEY)).length;
  const lastGuard = otherGuards===0;                                     // G1

  const has = k => Object.prototype.hasOwnProperty.call(ov,k) ? !!ov[k] : roleGrants(k, role);
  const lockReason = k => {
    if(isSelf) return "แก้สิทธิ์ของตัวเองไม่ได้";
    if(roleForbids(k, role)) return "บทบาทนี้ถือสิทธิ์นี้ไม่ได้ — ต้องเปลี่ยนบทบาทก่อน";
    if(k===GUARD_KEY && lastGuard && has(k)) return "ต้องเหลือผู้ให้สิทธิ์อย่างน้อย 1 คน";
    return null;
  };
  const toggle = k => { const r=lockReason(k); if(r){ toast(r,"warn"); return; } setOv(m=>({...m,[k]:!has(k)})); };
  // เปลี่ยนบทบาท = รีเซ็ตสิทธิ์กลับเป็นค่าตั้งต้นของบทบาทใหม่ทั้งหมด (UX2 ในเอกสาร)
  const changeRole = r => { if(isSelf) { toast("แก้บทบาทของตัวเองไม่ได้","warn"); return; }
    setRole(r); setOv({}); setScope(DEFAULT_SCOPE[r]||"own_area"); };

  const diff = realOverrides(role, ov);
  const prevDiff = realOverrides(target.role, target.permOverrides||{});
  const roleChanged = role!==target.role, scopeChanged = scope!==prevScope;
  const changes = (()=>{
    const out=[];
    if(roleChanged)  out.push({key:"บทบาท",        from:thRole(target.role), to:thRole(role)});
    if(scopeChanged) out.push({key:"ขอบเขตข้อมูล", from:thScope(prevScope),  to:thScope(scope)});
    const lbl = (m,k)=> Object.prototype.hasOwnProperty.call(m,k) ? (m[k]?"เปิด":"ปิด") : "ตามบทบาท";
    for(const k of new Set([...Object.keys(prevDiff), ...Object.keys(diff)])){
      const a=lbl(prevDiff,k), b=lbl(diff,k);
      if(a!==b) out.push({key:k, from:a, to:b});
    }
    return out;
  })();

  const eff = effectivePerms(role, ov);

  return html`<${Modal} title=${"สิทธิ์ · "+target.name} onClose=${onClose}
    footer=${html`<span class="pm-diff">${changes.length
        ? html`ต่างจากเดิม <b>${changes.length} รายการ</b>`
        : html`<span class="dim">ยังไม่มีการเปลี่ยนแปลง</span>`}</span>
      <${Btn} variant="ghost" onClick=${onClose}>ยกเลิก</${Btn}>
      <${Btn} variant="primary" icon="check" disabled=${isSelf||!changes.length}
        onClick=${()=>onSave(target,{role,scope,overrides:diff},changes)}>บันทึกและบันทึก log</${Btn}>`}>

    <!-- ชั้นที่ 1 · บทบาท -->
    <div class="pm-field">
      <label>บทบาท</label>
      <${Dropdown} value=${role} onChange=${changeRole} disabled=${isSelf}
        options=${ROLES.map(r=>[r.key, r.code])}/>
    </div>

    <!-- ชั้นที่ 3 · ขอบเขตข้อมูล -->
    <div class="pm-field">
      <label>ขอบเขตข้อมูล</label>
      <div class="pm-segbar">
        ${SCOPES.map(sc=>html`<button key=${sc.key} class=${"pm-seg"+(scope===sc.key?" on":"")}
          disabled=${isSelf} onClick=${()=>!isSelf&&setScope(sc.key)}>${sc.th}</button>`)}
      </div>
    </div>

    <!-- ชั้นที่ 2 · สิทธิ์รายเมนู -->
    <div class="pm-field">
      <label>สิทธิ์รายเมนู <span class="dim">(${eff.size}/${PERM_COUNT} รายการ)</span></label>
      <div class="pm-acc">
        ${PERM_MODULES.map(m=>{
          const total=m.perms.length;
          const on=m.perms.filter(([k])=>eff.has(k)).length;
          const custom=m.perms.filter(([k])=>Object.prototype.hasOwnProperty.call(diff,k)).length;
          const isOpen=open===m.key;
          return html`<div key=${m.key}>
            <button class=${"pm-row"+(isOpen?" open":"")} onClick=${()=>setOpen(isOpen?"":m.key)}>
              <span class="pm-car">${isOpen?"⌄":"›"}</span>
              <span class="pm-nm">${m.name}</span>
              <span class="pm-cnt">${on}/${total}</span>
              <span class=${"pm-pill"+(custom?"":" inh")}>${custom?("กำหนดเอง "+custom):"ตามบทบาท"}</span>
            </button>
            ${isOpen ? html`<div class="pm-open">
              ${m.perms.map(([k,label])=>{ const reason=lockReason(k), forbid=roleForbids(k,role);
                return html`<div key=${k} class=${"pm-perm"+(forbid?" off":"")}>
                  <span class="pm-key" title=${k}>${k}</span>
                  <span class="pm-lb">${label}</span>
                  ${permByRole(k,role)==="o" && !Object.prototype.hasOwnProperty.call(diff,k)
                    ? html`<span class="pm-tag">ต้องเปิดเอง</span>` : ""}
                  <button class=${"pm-sw"+(has(k)&&!forbid?" on":"")+(reason?" lock":"")}
                    title=${reason||""} aria-label=${label}
                    onClick=${()=>toggle(k)}></button>
                </div>`; })}
            </div>` : ""}
          </div>`;
        })}
      </div>
    </div>
  </${Modal}>`;
}

const PERM_CSS = `
.pm-sub{font-size:12.5px;color:var(--muted);margin:-4px 0 14px}
.pm-field{display:flex;flex-direction:column;gap:6px;margin-bottom:16px}
.pm-field > label{font-size:12.5px;font-weight:600;color:var(--txt)}
.pm-hint{font-size:11.5px;color:var(--dim);line-height:1.5}
.pm-segbar{display:flex;gap:6px;flex-wrap:wrap}
.pm-seg{border:1px solid var(--stroke2);border-radius:999px;padding:6px 13px;cursor:pointer;
  font-family:var(--font);font-size:12.5px;font-weight:400;color:var(--muted);background:var(--surface)}
.pm-seg:hover:not(:disabled){border-color:var(--accent);color:var(--txt)}
.pm-seg.on{background:var(--accent);border-color:var(--accent);color:#fff}
.pm-seg:disabled{opacity:.55;cursor:not-allowed}
.pm-acc{border:1px solid var(--stroke2);border-radius:10px;overflow:hidden}
.pm-row{width:100%;display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer;
  border:none;border-bottom:1px solid var(--stroke);background:var(--surface);
  font-family:var(--font);font-size:13.5px;color:var(--txt);text-align:left}
.pm-row:last-child{border-bottom:none}
.pm-row:hover{background:var(--surface2)}
.pm-row.open{background:var(--surface2)}
.pm-car{color:var(--dim);width:12px;flex:none;font-size:12px}
.pm-nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pm-cnt{font-size:11.5px;color:var(--dim);font-variant-numeric:tabular-nums;flex:none}
.pm-pill{font-size:10.5px;padding:2px 8px;border-radius:999px;flex:none;
  background:rgba(245,158,11,.14);color:#b45309;border:1px solid rgba(245,158,11,.35)}
.pm-pill.inh{background:var(--surface2);color:var(--dim);border-color:var(--stroke2)}
.pm-open{background:var(--surface2);padding:4px 12px 10px;border-bottom:1px solid var(--stroke)}
.pm-perm{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px dashed var(--stroke)}
.pm-perm:last-child{border-bottom:none}
.pm-perm.off{opacity:.5}
.pm-key{font-size:11px;color:var(--dim);flex:none;width:158px;font-variant-numeric:tabular-nums;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pm-lb{flex:1;min-width:0;font-size:12.5px;color:var(--txt)}
.pm-tag{font-size:10.5px;color:var(--dim);border:1px dashed var(--stroke2);border-radius:6px;padding:1px 6px;flex:none}
.pm-sw{width:36px;height:20px;border-radius:999px;position:relative;flex:none;cursor:pointer;padding:0;
  background:var(--surface3,rgba(30,45,80,.10));border:1px solid var(--stroke2)}
.pm-sw::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;
  background:var(--surface);box-shadow:0 1px 2px rgba(0,0,0,.25);transition:left .15s}
.pm-sw.on{background:var(--accent);border-color:var(--accent)}
.pm-sw.on::after{left:18px;background:#fff}
.pm-sw.lock{opacity:.45;cursor:not-allowed}
.pm-note{display:flex;gap:9px;padding:11px 13px;border-radius:10px;font-size:12.5px;line-height:1.55;margin-bottom:14px}
.pm-note.stop{background:rgba(220,38,38,.08);border:1px solid rgba(220,38,38,.3);color:#b30019}
.pm-note b{display:block;font-weight:600}
.pm-diff{font-size:12.5px;color:var(--muted);margin-right:auto}
.pm-diff b{color:var(--txt)}
`;


/* ═══ หน้า "จัดการผู้ใช้" — ปรับเฉพาะการจัดวาง/สไตล์ ไม่แตะตรรกะ ═══
   ใช้คอมโพเนนต์เดิมทั้งหมด (Kpi · Table · Dropdown · Btn · Modal) แค่ปรับสัดส่วนให้กระชับ
   และให้ตารางเป็นตัวเอกของหน้า ตามแนวทาง Enterprise admin dashboard */
const UM_CSS = `
/* การ์ดสรุป: เตี้ยลงจากค่ามาตรฐาน ไม่ให้สูงเกินตาราง */
.um-kpis{margin-bottom:14px}
.um-kpis .kpi{padding:12px 14px}
.um-kpis .kpi .kk{font-size:11.5px;letter-spacing:.5px}
.um-kpis .kpi .kv{font-size:22px;margin-top:1px}
.um-kpis .kpi .kpi-ic{width:30px;height:30px;border-radius:9px;top:11px;right:11px}
.um-kpis .kpi .kpi-ic svg{width:16px;height:16px}

/* แถบเครื่องมือ */
.um-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.um-search{margin-left:0;flex:0 1 320px;min-width:220px}
.um-dd{width:210px;flex:none}
.um-clear{border:none;background:none;cursor:pointer;font-family:var(--font);font-size:12.5px;
  color:var(--muted);padding:8px 6px;text-decoration:underline;text-underline-offset:3px}
.um-clear:hover{color:var(--accent-deep)}

/* ตาราง: แถวสูงพอดี เส้นคั่นบางลง */
.um-table .table td{padding:12px 14px}
.um-table .table th{font-size:11.5px;letter-spacing:.5px}
.um-table .table tbody tr:last-child td{border-bottom:none}

.um-user{display:flex;align-items:center;gap:11px;min-width:0}
.um-av{flex:none;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;
  font-size:12px;font-weight:700;letter-spacing:.3px}
.um-av.adm{background:rgba(230,0,35,.10);color:var(--accent-deep)}
.um-av.mgr{background:rgba(47,127,224,.12);color:#1e4fa8}
.um-av.tc{background:rgba(100,116,139,.14);color:#475569}
.um-nm{font-size:13.5px;font-weight:600;color:var(--txt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.um-em{font-size:12px;color:var(--dim);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.um-role{display:inline-block;font-size:12px;padding:4px 11px;border-radius:999px;white-space:nowrap}
.um-role.adm{background:rgba(230,0,35,.08);color:var(--accent-deep);border:1px solid rgba(230,0,35,.22)}
.um-role.mgr{background:rgba(47,127,224,.09);color:#1e4fa8;border:1px solid rgba(47,127,224,.24)}
.um-role.tc{background:rgba(100,116,139,.10);color:#475569;border:1px solid rgba(100,116,139,.24)}
.um-last{font-size:12.5px;color:var(--muted);font-variant-numeric:tabular-nums}

/* ปุ่มจัดการ: ชิดขวา ระยะเท่ากัน ขนาดเล็กกว่าเนื้อหาในแถว */
.um-act{display:flex;align-items:center;gap:7px;justify-content:flex-end}
.um-btn{display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-family:var(--font);
  font-size:12.5px;color:var(--muted);padding:6px 11px;border-radius:8px;
  border:1px solid var(--stroke2);background:var(--surface)}
.um-btn:hover{color:var(--txt);border-color:var(--accent);background:var(--surface2)}
.um-del{width:30px;height:30px;display:grid;place-items:center;cursor:pointer;padding:0;
  border:1px solid transparent;border-radius:8px;background:none;color:#c2410c}
.um-del:hover{background:rgba(220,38,38,.08);border-color:rgba(220,38,38,.28);color:#b30019}

@media(max-width:900px){
  .um-dd{width:100%}
  .um-search{flex:1 1 100%}
}
`;

/* ================= เชื่อมต่อข้อมูล ================= */
export function Integration(){
  // ปุ่ม "อัปโหลดไฟล์ใหม่" ถูกย้าย/รวมไว้ที่หน้า "จัดการข้อมูล" แล้ว จึงตัดออกจากหน้านี้ (กันซ้ำซ้อน)
  // แหล่งไฟล์นำเข้า 2 แหล่ง (แทนการเชื่อมต่อระบบภายนอกเดิม)
  const sources=[
    {name:"ไฟล์จากลูกค้า",type:"db",status:"นำเข้าแล้ว",detail:"อัปโหลดล่าสุด: 11 ก.ค. 2026 · 2,301 รายการ",tone:"good"},
    {name:"ข้อมูลสาธารณะ (MAZ)",type:"api",status:"นำเข้าแล้ว",detail:"กลุ่มธุรกิจ Hospitality · อัปเดตล่าสุด: 09 ก.ค. 2026",tone:"good"},
  ];
  const mapping=[
    ["customer_id","id","string","✓"],["company_name","businessName","string","✓"],
    ["gps_lat","latitude","float","✓"],["gps_lng","longitude","float","✓"],
    ["industry_code","segment","enum","✓"],["phone","phone","string","✓"],["date_join","dateJoin","date","✓"]];
  // ประวัติการนำเข้าไฟล์ (ชื่อไฟล์, แหล่งที่มา, วันที่อัปโหลด, จำนวนแถวที่นำเข้าสำเร็จ, สถานะ)
  const imports=[
    ["customers_2026-07-11.xlsx","ลูกค้า","11 ก.ค. 2026","2,301","สำเร็จ"],
    ["maz_hospitality_2026-07-09.csv","MAZ","09 ก.ค. 2026","6,862","สำเร็จ"],
    ["customers_2026-07-05.xlsx","ลูกค้า","05 ก.ค. 2026","2,254","มีข้อผิดพลาด"]];

  return html`<div class="page fade-in">
    <div class="page-head"><div><h1>เชื่อมต่อข้อมูล</h1></div></div>

    <div class="grid g2" style=${{marginBottom:"16px"}}>
      ${sources.map(c=>html`<${Card} key=${c.name} className="hoverable">
        <div class="row between">
          <div class="row" style=${{gap:"12px"}}>
            <div style=${{width:"42px",height:"42px",borderRadius:"11px",display:"grid",placeItems:"center",background:"rgba(230, 0, 35,.14)"}}>
              <${Icon} name=${c.type==="db"?"db":"api"} size=${20} color="#e60023"/></div>
            <div><div style=${{fontWeight:700,fontSize:"14px"}}>${c.name}</div>
              <div class="dim" style=${{fontSize:"13px",marginTop:"2px"}}>${c.detail}</div></div></div>
          <${Badge} tone=${c.tone}>${c.status}</${Badge}></div>
      </${Card}>`)}
    </div>

    <div class="grid g2" style=${{marginBottom:"16px"}}>
      <${Card} title="การจับคู่ข้อมูล" sub="คอลัมน์ในไฟล์ Excel → โครงสร้างแพลตฟอร์ม" pad0=${true}>
        <${Table} cols=${[
          {h:"ฟิลด์ต้นทาง", render:r=>html`<span class="mono" style=${{fontSize:"12px"}}>${r[0]}</span>`},
          {h:"เป้าหมาย", render:r=>html`<span class="mono" style=${{fontSize:"12px",color:"#e60023"}}>${r[1]}</span>`},
          {h:"ชนิด", render:r=>r[2]},
          {h:"ถูกต้อง", render:r=>html`<${Badge} tone="good">${r[3]}</${Badge}>`},
        ]} rows=${mapping}/>
      </${Card}>
      <${Card} title="การตรวจสอบข้อมูล">
        ${[["ความถูกต้องของพิกัด",98],["การจับคู่กลุ่มธุรกิจ",100],["การตรวจจับข้อมูลซ้ำ",96],["ความครบถ้วนของที่อยู่",89]].map(([l,v])=>
          html`<div key=${l} style=${{marginBottom:"12px"}}><div class="row between" style=${{fontSize:"12.5px",marginBottom:"5px"}}>
            <span>${l}</span><b>${v}%</b></div><${Meter} value=${v} color=${v>=95?"linear-gradient(90deg,#33d69f,#34e0d0)":"linear-gradient(90deg,#ffb02e,#ff5a3c)"}/></div>`)}
      </${Card}>
    </div>

    <${Card} title="ประวัติการนำเข้า" sub="ไฟล์ที่นำเข้าล่าสุดโดยผู้ดูแลระบบ" pad0=${true}>
      <${Table} cols=${[
        {h:"ชื่อไฟล์", render:r=>html`<span class="mono" style=${{fontSize:"12.5px"}}>${r[0]}</span>`},
        {h:"แหล่งที่มา", render:r=>r[1]},
        {h:"วันที่อัปโหลด", render:r=>r[2]},
        {h:"นำเข้าสำเร็จ", render:r=>r[3]+" แถว"},
        {h:"สถานะ", render:r=>html`<${Badge} tone=${r[4]==="สำเร็จ"?"good":"warn"}>${r[4]}</${Badge}>`},
      ]} rows=${imports}/>
    </${Card}>
  </div>`;
}

/* ================= ตั้งค่าระบบ ================= */
export function Config(){
  const [open,setOpen]=useState({layers:true,notif:false,perms:false});
  const toggleSec=k=>setOpen(o=>({...o,[k]:!o[k]}));
  // "ข้อมูลหลัก" ไม่ได้เป็นแท็บในหน้านี้แล้ว — ย้ายไปเป็นเมนูย่อยใต้ "ตั้งค่าระบบ" ที่แถบซ้าย (id: master-data)

  // หมายเหตุ: การ์ด "แบบจำลอง Lead สูง" และ "การทำเหมืองข้อมูล" ถูกถอดออกจากหน้านี้แล้ว
  // เพราะเป็นการตั้งค่าที่ไม่มีผลจริงกับระบบ — น้ำหนัก 45/25/30, ค่าอ้างอิง GAP_REF และเกณฑ์ระดับ (สูง ≥67 / ปานกลาง ≥34)
  // ถูกกำหนดตายตัวใน src/mock/geoData.js (demandGap / gapLevelOf / GAP_REF) และ JSON ถูกสร้างล่วงหน้าโดย gen.mjs

  // 1) Map layers (reorderable, toggle, opacity)
  const DEF_LAYERS=[
    {id:"existing",name:"ลูกค้าปัจจุบัน",color:"#2563eb",on:true,opacity:90},
    {id:"prospect",name:"Lead",color:"#38bdf8",on:true,opacity:85},
    {id:"heat",name:"แผนที่ความร้อน (Lead)",color:"#ff5a3c",on:true,opacity:70},
    {id:"boundary",name:"ขอบเขตบริการ",color:"#34e0d0",on:false,opacity:50},
    {id:"route",name:"เส้นทางเดินทาง",color:"#8a7bff",on:false,opacity:80},
  ];
  const [layers,setLayers]=useState(DEF_LAYERS.map(l=>({...l})));
  const [drag,setDrag]=useState(null);
  const setLayer=(i,patch)=>setLayers(ls=>ls.map((l,j)=>j===i?{...l,...patch}:l));
  const dropAt=i=>{ setLayers(ls=>{ if(drag==null||drag===i)return ls; const a=[...ls]; const [m]=a.splice(drag,1); a.splice(i,0,m); return a; }); setDrag(null); };

  // 2) Notifications
  // ระบบนำเข้าข้อมูลด้วยไฟล์ Excel/CSV ผ่านผู้ดูแลเท่านั้น ไม่ได้เชื่อมต่อระบบภายนอกแบบอัตโนมัติ
  // จึงไม่มีการแจ้งเตือนเรื่องการซิงค์ข้อมูลกับระบบภายนอกอีกต่อไป
  // ช่องทางแจ้งเตือนกำหนดตายตัวเป็น "แจ้งเตือนระบบ" ทุกประเภท (ไม่ให้เลือกแล้ว)
  // รายการเหตุการณ์มาจาก notifications.js ที่เดียว — หน้าโปรไฟล์และกระดิ่งใช้ชุดเดียวกันนี้
  const DEF_NOTIF = NOTIF_EVENTS.map(e=>({...e, ...getSysNotif()[e.key]}));
  const [notif,setNotif]=useState(DEF_NOTIF);
  const setN=(i,patch)=>setNotif(ns=>{
    const next = ns.map((n,j)=>j===i?{...n,...patch}:n);
    setSysNotif(Object.fromEntries(next.map(x=>[x.key,{on:x.on, priority:x.priority}])));   // มีผลทันทีทั้งระบบ
    return next; });


  // 3) สิทธิ์การส่งออกตามบทบาท (§5.2) — บันทึกทันทีลง localStorage (แยกจากแถบบันทึกรวมของอีก 4 การ์ด)
  //    TODO(server): นี่เป็นเพียงการกำหนดค่านโยบายที่ฝั่ง client ใช้ "กรอง/ซ่อน" ตัวเลือกบนหน้าจอเท่านั้น
  //    การบังคับสิทธิ์จริงต้องทำที่เซิร์ฟเวอร์ (ตรวจ role จาก session ตอนเรียก API ส่งออกแล้วปฏิเสธถ้าไม่มีสิทธิ์)
  const [xperms,setXperms]=useState(()=>{ const p=getExportPerms(); return EXPORT_ROLES.reduce((a,r)=>{a[r.key]={...p[r.key]};return a;},{}); });
  const toggleXp=(role,fmt)=>setXperms(prev=>{ const next={...prev,[role]:{...prev[role],[fmt]:!prev[role][fmt]}};
    setExportPerms(next);
    pushAudit({action:"แก้ไขสิทธิ์การส่งออกตามบทบาท", category:"ตั้งค่า",
      detail:`${(EXPORT_ROLES.find(r=>r.key===role)||{}).label} · ${fmt.toUpperCase()} → ${!prev[role][fmt]?"อนุญาต":"ปิด"}`});
    toast("อัปเดตสิทธิ์การส่งออกแล้ว","good"); return next; });

  const [confirmReset,setConfirmReset]=useState(null);
  // ── ติดตามการแก้ไขรวมทุกการ์ด: เก็บ "ค่าที่บันทึกล่าสุด" ไว้เทียบ เพื่อรู้ว่ามีอะไรค้างยังไม่บันทึก ──
  //    แถบล่างจะโผล่ก็ต่อเมื่อมีค่าต่างจากที่บันทึกไว้ และกดครั้งเดียวมีผลกับทั้งเลเยอร์และการแจ้งเตือนพร้อมกัน
  const snapshot=(ll,nn)=>JSON.stringify({เลเยอร์:ll,แจ้งเตือน:nn});
  const [savedSnap,setSavedSnap]=useState(()=>snapshot(DEF_LAYERS,DEF_NOTIF));
  const currentSnap=snapshot(layers,notif);
  const dirty=currentSnap!==savedSnap;
  const saveAll=()=>{ setSavedSnap(currentSnap); toast("บันทึกการตั้งค่าทั้งหมดแล้ว","good"); };
  const cancelAll=()=>{ const s=JSON.parse(savedSnap);
    setLayers(s.เลเยอร์.map(l=>({...l}))); setNotif(s.แจ้งเตือน.map(n=>({...n})));
    setConfirmReset(null); toast("ยกเลิกการเปลี่ยนแปลงทั้งหมดแล้ว","info"); };


  const Section=(key,icon,title,sub,body,rightBadge)=>html`<div class="card" style=${{padding:0,marginBottom:"16px"}}>
    <div class="row between" style=${{padding:"15px 18px",cursor:"pointer"}} onClick=${()=>toggleSec(key)}>
      <div class="row" style=${{gap:"11px"}}><${Icon} name=${icon} size=${18} color="#e60023"/>
        <div><div style=${{fontSize:"14px",fontWeight:600}}>${title}</div><div class="dim" style=${{fontSize:"13px"}}>${sub}</div></div></div>
      <div class="row" style=${{gap:"12px"}}>${rightBadge}
        <${Icon} name="chevron" size=${16} color="var(--muted)" style=${{transform:open[key]?"rotate(180deg)":"none",transition:".2s"}}/></div>
    </div>
    ${open[key] && html`<div style=${{padding:"16px 18px 18px",borderTop:"1px solid var(--stroke)"}}>${body}</div>`}
  </div>`;


  return html`<div class="page fade-in">
    <div class="page-head"><div><h1>ตั้งค่าระบบ</h1></div></div>


    <!-- SECTION 1 -->
    ${Section("layers","layers","การจัดการเลเยอร์","Map Layer Management — เปิด/ปิด, ความทึบ, ลำดับความสำคัญ (ลากเพื่อจัดลำดับ)",
      // แต่ละเลเยอร์ยุบเหลือบรรทัดเดียว: [ลากจัดลำดับ][สี] ชื่อ [แถบเลื่อน][%][ตัวอย่าง][เปิด/ปิด]
      html`${layers.map((l,i)=>html`<div key=${l.id} draggable=${true}
        onDragStart=${()=>setDrag(i)} onDragOver=${e=>e.preventDefault()} onDrop=${()=>dropAt(i)}
        class="row cfg-layer" style=${{border:"1px solid "+(drag===i?"var(--accent)":"var(--stroke)"),
          background:drag===i?"rgba(230, 0, 35,.1)":"rgba(30,45,80,.05)"}}>
        <${Icon} name="grid" size=${15} color="var(--dim)" style=${{flex:"none",cursor:"grab"}}/>
        <span style=${{width:"14px",height:"14px",borderRadius:"50%",flex:"none",background:l.color,opacity:l.on?1:.35}}></span>
        <span class="cfg-layer-nm">${i+1}. ${l.name}</span>
        <input type="range" min="10" max="100" value=${l.opacity} aria-label=${"ความทึบของ"+l.name}
          onInput=${e=>setLayer(i,{opacity:+e.target.value})} class="cfg-layer-rng"/>
        <span class="mono cfg-layer-pct">${l.opacity}%</span>
        <span class="cfg-layer-prev" style=${{background:`linear-gradient(90deg,transparent,${l.color})`,opacity:l.on?l.opacity/100:.15}}></span>
        <${Toggle} on=${l.on} onChange=${v=>setLayer(i,{on:v})}/>
      </div>`)}`,
      html`<${Badge} tone="info">${layers.filter(l=>l.on).length}/${layers.length}</${Badge}>`)}

    <!-- SECTION 2 -->
    ${Section("notif","bell","การแจ้งเตือน","เหตุการณ์ที่ระบบจะแจ้ง — ผู้ใช้ปิดของตัวเองได้ที่หน้าโปรไฟล์ แต่เปิดเกินที่ตั้งไว้ตรงนี้ไม่ได้",
      html`<div class="row" style=${{padding:"0 0 8px",fontSize:"12px",letterSpacing:".5px",color:"var(--dim)",textTransform:"uppercase"}}>
        <span style=${{flex:1}}>ประเภทการแจ้งเตือน</span><span style=${{width:"130px"}}>ช่องทาง</span><span style=${{width:"110px"}}>ระดับ</span></div>
      ${notif.map((n,i)=>html`<div key=${n.key} class="row between" style=${{padding:"10px 0",borderTop:"1px solid var(--stroke)",gap:"12px"}}>
        <div class="row" style=${{gap:"11px",flex:1,minWidth:0}}>
          <${Toggle} on=${n.on} onChange=${v=>setN(i,{on:v})}/>
          <span style=${{fontSize:"13px",opacity:n.on?1:.45}}>${n.label}</span></div>
        <!-- ช่องทางกำหนดตายตัวเป็น "แจ้งเตือนระบบ" จึงแสดงเป็นข้อความ ไม่ใช่ตัวเลือกให้กดเปลี่ยน -->
        <span style=${{width:"130px",flex:"none",fontSize:"13px",color:"var(--muted)",opacity:n.on?1:.45}}>แจ้งเตือนระบบ</span>
        <select class="input" style=${{width:"110px",padding:"7px 10px",flex:"none"}} value=${n.priority} onChange=${e=>setN(i,{priority:e.target.value})}>
          <option value="low">ต่ำ</option><option value="medium">กลาง</option><option value="high">สูง</option></select>
      </div>`)}
      `,
      html`<${Badge} tone="info">${notif.filter(n=>n.on).length} เปิด</${Badge}>`)}


    <!-- SECTION 3 · สิทธิ์การส่งออกตามบทบาท -->
    ${Section("perms","download","สิทธิ์การส่งออกตามบทบาท","กำหนดว่าบทบาทใดส่งออกไฟล์ประเภทใดได้ (บันทึกทันที)",
      html`<div>
        <div class="muted" style=${{fontSize:"12px",lineHeight:1.7,marginBottom:"12px"}}>
          CSV ใช้ดึงข้อมูลทั้งชุดไปทำเหมืองต่อ — ค่าเริ่มต้นจึงเปิดเฉพาะผู้ดูแลระบบ ·
          การกำหนดนี้ช่วย "กรอง/ซ่อน" ตัวเลือกบนหน้าจอ ส่วนการบังคับสิทธิ์จริงต้องทำที่เซิร์ฟเวอร์</div>
        <div class="cfg-perm">
          <div class="cfg-perm-row cfg-perm-head"><span>บทบาท</span>
            ${EXPORT_FORMATS.map(f=>html`<span key=${f.key}>${f.label}</span>`)}</div>
          ${EXPORT_ROLES.map(r=>html`<div key=${r.key} class="cfg-perm-row">
            <span>${r.label}</span>
            ${EXPORT_FORMATS.map(f=>html`<label key=${f.key} class="cfg-perm-cell" title=${r.label+" · "+f.label}>
              <span class=${"cfg-pchk"+(xperms[r.key]&&xperms[r.key][f.key]?" on":"")}>
                ${xperms[r.key]&&xperms[r.key][f.key]&&html`<${Icon} name="check" size=${12} color="#fff"/>`}</span>
              <input type="checkbox" checked=${!!(xperms[r.key]&&xperms[r.key][f.key])} onChange=${()=>toggleXp(r.key,f.key)} style=${{display:"none"}}/>
            </label>`)}
          </div>`)}
        </div>
        <style>${`
          .cfg-perm{border:1px solid var(--stroke2);border-radius:11px;overflow:hidden}
          .cfg-perm-row{display:grid;grid-template-columns:1.6fr 1fr 1fr 1fr;align-items:center;padding:10px 14px;border-bottom:1px solid var(--stroke);font-size:13px}
          .cfg-perm-row:last-child{border-bottom:none}
          .cfg-perm-row>span:not(:first-child){text-align:center}
          .cfg-perm-head{background:var(--surface2);font-weight:700;color:var(--muted);font-size:12px}
          .cfg-perm-cell{display:flex;justify-content:center;cursor:pointer}
          .cfg-pchk{width:20px;height:20px;border-radius:6px;border:1.5px solid var(--stroke2);display:grid;place-items:center;transition:.15s}
          .cfg-pchk.on{background:var(--accent);border-color:var(--accent)}
        `}</style>
      </div>`,
      html`<${Badge} tone="neutral">CSV เฉพาะผู้ดูแล</${Badge}>`)}

    <!-- แถบบันทึกลอยด้านล่าง — โผล่เฉพาะตอนมีการแก้ไขที่ยังไม่บันทึก และมีผลกับการ์ดเลเยอร์/แจ้งเตือนพร้อมกัน
         เว้นที่ว่างด้านล่างหน้าไว้เท่าความสูงแถบ (cfg-bar-space) เพื่อไม่ให้แถบบังเนื้อหาส่วนท้าย -->
    ${dirty && html`<div class="cfg-bar-space"></div>`}
    ${dirty && html`<div class="cfg-bar">
      <span class="cfg-bar-note">มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก</span>
      <${Btn} variant="ghost" icon="close" onClick=${()=>setConfirmReset("all")}>ยกเลิกการเปลี่ยนแปลง</${Btn}>
      <${Btn} variant="outline" icon="check" onClick=${saveAll}>บันทึกการตั้งค่าทั้งหมด</${Btn}>
    </div>`}

    ${confirmReset && html`<${Modal} title="ยืนยันการยกเลิก" onClose=${()=>setConfirmReset(null)}
      footer=${html`<${Btn} variant="ghost" onClick=${()=>setConfirmReset(null)}>ปิด</${Btn}>
        <${Btn} variant="danger" icon="refresh" onClick=${cancelAll}>ยืนยันยกเลิก</${Btn}>`}>
      <div style=${{fontSize:"13px",lineHeight:1.8}}>ต้องการยกเลิกการเปลี่ยนแปลงทั้งหมดของทุกการ์ด และกลับไปใช้ค่าที่บันทึกไว้ล่าสุดหรือไม่? การเปลี่ยนแปลงที่ยังไม่บันทึกจะหายไป</div>
    </${Modal}>`}
  </div>`;
}

/* ================= บันทึกการตรวจสอบ ================= */
const ACT_TH = {Login:"เข้าสู่ระบบ", Logout:"ออกจากระบบ", Export:"ส่งออก", Sync:"ซิงค์ข้อมูล", "User Activity":"กิจกรรมผู้ใช้"};
const AUDIT = (()=>{ const acts=[["Login","shield","info"],["Logout","logout","neutral"],["Export","download","warn"],["Sync","refresh","good"],["User Activity","user","info"]];
  // อีเมลต้องตรงกับบัญชีจริงใน SEED_USERS ไม่งั้นเทียบบทบาทไม่ได้ · คละให้ครบทั้ง 3 บทบาท
  const who=["admin@geointel.io","david@geointel.io","management@geointel.io","tc.bkk@geointel.io","tc.cm@geointel.io"];
  const det={Login:"เข้าสู่ระบบจาก 10.4.2.x",Logout:"สิ้นสุดเซสชัน",Export:"ส่งออกรายงานโอกาส (PDF)",Sync:"ซิงค์ชุดข้อมูล ERP","User Activity":"เปิดดูแดชบอร์ดพื้นที่กรุงเทพ"};
  const rows=[]; for(let i=0;i<40;i++){ const a=acts[i%acts.length]; const h=String(9-(i%9)).padStart(2,"0");
    rows.push({time:`2026-07-11 ${h}:${String((i*7)%60).padStart(2,"0")}`,type:a[0],icon:a[1],tone:a[2],user:who[i%who.length],detail:det[a[0]]}); }
  return rows; })();
/* อีเมล → บทบาท (จากบัญชีผู้ใช้ในระบบ) — ใช้ทั้งตัวกรองบทบาทและป้ายใต้ชื่อผู้ใช้ */
const ROLE_OF_EMAIL = Object.fromEntries(SEED_USERS.map(u=>[u.email, u.role]));

export function Audit(){
  const [q,setQ]=useState(""); const [type,setType]=useState("All"); const [roleF,setRoleF]=useState("All");
  const [page,setPage]=useState(1);
  const AU_PAGE=15;                           // แถวต่อหน้า — เกินกว่านี้ขึ้นหน้าใหม่ ไม่ต้องเลื่อนยาว
  const [live,setLive]=useState(getAudit());   // รายการที่บันทึกสดจากหน้าจัดการข้อมูล ฯลฯ
  useEffect(()=>subscribeAudit(l=>setLive([...l])),[]);
  const CAT_TONE={"นำเข้า":"good","ลบ":"bad","แก้ไข":"info","conflict":"warn","ส่งออก":"warn","เพิ่ม":"good"};
  // เก็บเวลาดิบไว้ · ให้คอลัมน์ "เวลา" เป็นคนแปลงที่เดียว (ถ้าแปลงสองรอบจะได้ "—")
  const liveRows=live.map(e=>({time:e.ts,type:e.category,label:e.action,icon:"edit",tone:CAT_TONE[e.category]||"info",user:e.user,detail:e.detail}));
  const all=[...liveRows, ...AUDIT];
  const rows=all.filter(r=>(type==="All"||r.type===type)
    && (roleF==="All" || ROLE_OF_EMAIL[r.user]===roleF)
    && (!q||(r.user||"").toLowerCase().includes(q.toLowerCase())||(r.detail||"").toLowerCase().includes(q.toLowerCase())));
  const pages=Math.max(1,Math.ceil(rows.length/AU_PAGE));
  const pg=Math.min(page,pages);
  const pageRows=rows.slice((pg-1)*AU_PAGE, pg*AU_PAGE);
  const reset = fn => v => { setPage(1); fn(v); };   // เปลี่ยนตัวกรองแล้วกลับไปหน้าแรกเสมอ
  return html`<div class="page fade-in">
    <div class="page-head"><div><h1>บันทึกการตรวจสอบ</h1></div></div>
    <div class="row wrap" style=${{gap:"10px",marginBottom:"16px"}}>
      <div class="searchbox"><${Icon} name="search" size=${15}/><input placeholder="ค้นหาผู้ใช้หรือการกระทำ…" value=${q} onInput=${e=>{setPage(1);setQ(e.target.value);}}/></div>
      <div style=${{width:"190px",flex:"none"}}>
        <${Dropdown} value=${type} onChange=${reset(setType)}
          options=${[["All","ทุกการกระทำ"], ...["Login","Logout","Export","Sync","User Activity"].map(t=>[t,ACT_TH[t]])]}/></div>
      <div style=${{width:"210px",flex:"none"}}>
        <${Dropdown} value=${roleF} onChange=${reset(setRoleF)}
          options=${[["All","ทุกบทบาท"],["Administrator","ผู้ดูแลระบบ"],["Management","ผู้บริหาร"],["Trade Coordinator","ผู้ประสานงานการค้า (TC)"]]}/></div>
      <${Badge} tone="neutral">${rows.length} รายการ</${Badge}>
    </div>
    <${Card} pad0=${true}>
      <${Table} cols=${[
        {h:"เวลา", w:"190px", render:r=>html`<span style=${{fontSize:"12.5px",color:"var(--muted)"}}>${thDateTime(r.time)}</span>`},
        {h:"การกระทำ", render:r=>html`<span class="row" style=${{gap:"8px"}}><${Icon} name=${r.icon} size=${15} color="var(--muted)"/>
          <${Badge} tone=${r.tone}>${r.label||ACT_TH[r.type]||r.type}</${Badge}></span>`},
        {h:"ผู้ใช้", w:"250px", render:r=>html`<div><div>${r.user}</div>
          <div class="dim" style=${{fontSize:"11.5px",marginTop:"1px"}}>${roleTH(ROLE_OF_EMAIL[r.user])||"ระบบ"}</div></div>`},
        {h:"รายละเอียด", render:r=>html`<span class="muted">${r.detail}</span>`},
      ]} rows=${pageRows}/>
    </${Card}>

    ${pages>1 ? html`<div class="pager">
      <span class="dim">แสดง ${(pg-1)*AU_PAGE+1}–${Math.min(pg*AU_PAGE, rows.length)} จาก ${num(rows.length)} รายการ</span>
      <div class="row" style=${{gap:"6px"}}>
        <button class="pager-b" disabled=${pg<=1} onClick=${()=>setPage(pg-1)}>‹</button>
        ${Array.from({length:pages},(_,i)=>i+1).map(k=>html`<button key=${k}
          class=${"pager-b"+(k===pg?" on":"")} onClick=${()=>setPage(k)}>${k}</button>`)}
        <button class="pager-b" disabled=${pg>=pages} onClick=${()=>setPage(pg+1)}>›</button>
      </div>
    </div>` : ""}
  </div>`;
}

/* ================= แดชบอร์ด (monitoring) — 2 แท็บ: สภาพระบบ + ภาพรวมธุรกิจ ================= */
// ผู้ดูแลระบบ: เข้ามาเจอแท็บ "สภาพระบบ" ก่อน (ตรวจสุขภาพข้อมูล) · ผู้บริหาร: เห็นเฉพาะ "ภาพรวมธุรกิจ"
export function Monitoring({defaultTab}={}){
  const {db, nav, user} = useApp();
  const _isMgmt = (user&&user.role)==="Management";   // ผู้บริหารเห็นเฉพาะภาพรวมธุรกิจ ไม่เห็นแท็บสภาพระบบ
  const [range,setRange] = useState("all");
  const [exportOpen,setExportOpen] = useState(false);
  const [tab,setTab] = useState(()=> defaultTab || (_isMgmt?"business":"health"));
  // ตัวกรองผู้บริหาร: จังหวัด · อำเภอจริงของจังหวัดนั้น · หมวดธุรกิจ · ช่วงวันที่เลือกเอง (ปฏิทิน)
  const [fProv,setFProv] = useState("all");
  const [fDist,setFDist] = useState("all");
  const [fSeg,setFSeg]   = useState("all");
  const [fFrom,setFFrom] = useState("");
  const [fTo,setFTo]     = useState("");
  // ขยายกล่องรายหน่วยจาก 5 อันดับ → ทั้งหมด (มี scroll ในกล่อง)
  const [expConv,setExpConv] = useState(false);
  const [expTbl,setExpTbl]   = useState(false);
  // เรียก hook ให้ครบก่อนเสมอ แล้วค่อยตัดสินใจว่าจะแสดงหน้ารอโหลดไหม
  // ถ้า return ออกไปก่อนเรียก hook ลำดับ hook จะไม่คงที่ระหว่างรอบวาด
  const custs=db.customers||[], pros=db.prospects||[], areas=db.areas||[];
  const v = useMemo(()=>calcView(custs,pros,areas,range), [custs,pros,areas,range]);

  if(!db.customers) return html`<div class="page"><div class="emptybox">กำลังโหลดข้อมูลธุรกิจ…</div></div>`;
  const dtab = _isMgmt ? "business" : tab;   // ผู้บริหารบังคับเป็นภาพรวมธุรกิจเสมอ
  // แอดมิน: แดชบอร์ด = "สภาพระบบ" อย่างเดียว (ไม่มีแถบแท็บสลับ) · ผู้บริหาร: "ภาพรวมธุรกิจ" อย่างเดียว
  const DASH_TABS = _isMgmt ? [{value:"business",label:"ภาพรวมธุรกิจ"}]
    : [{value:"health",label:"สภาพระบบ"}];

  // ── ส่งออกรายงานภาพรวมธุรกิจ (ใช้ป็อปอัพเดียวกับหน้ารายงาน · สิทธิ์ตามบทบาท) ──
  const _role = (user&&user.role)||"Administrator", _uname=(user&&user.name)||"ผู้ดูแลระบบ";
  const _ROLE_TH={Administrator:"ผู้ดูแลระบบ",Management:"ผู้บริหาร","Trade Coordinator":"ผู้ประสานงานการค้า"};
  const exportScope = { areaName:"ทั้งประเทศ", areaLabel:"ทั้งประเทศ", segLabel:"ทั้งหมด",
    dateLabel:(range==="all"?"ทั้งหมด":v.rangeText), counts:{existing:v.fCusts.length, prospect:v.fPros.length} };
  const buildExportRows = o=>{ const ds=o.dataSel||"both";
    const rows=[["รายงานภาพรวมธุรกิจ (GeoIntel)"],["จัดทำเมื่อ", beD(v.ref)],[]];
    rows.push(["ขอบเขตข้อมูลที่ส่งออก"]); rows.push(["พื้นที่","ทั้งประเทศ"]); rows.push(["ช่วงเวลา", range==="all"?"ทั้งหมด":v.rangeText]);
    rows.push(["ข้อมูลที่ส่งออก", ds==="existing"?"ลูกค้าปัจจุบันอย่างเดียว":ds==="prospect"?"Lead อย่างเดียว":"ทั้งลูกค้าและ Lead"]); rows.push([]);
    rows.push(["ตัวชี้วัด","ค่า"]);
    if(ds!=="prospect") rows.push(["ลูกค้าปัจจุบัน", v.fCusts.length]);
    if(ds!=="existing") rows.push(["Lead", v.fPros.length]);
    rows.push(["จังหวัดที่มีลูกค้า", v.provincesWithCust], ["ดัชนี Lead เฉลี่ย", v.avgOpp]);
    rows.push([],["จังหวัดที่มีลูกค้าสูงสุด"]);
    (v.topByCust||[]).forEach(t=>rows.push([t.label, t.value]));
    return rows; };
  const doExport = ({format, filename, opts, dataSel, count, scope})=>{
    const name=(filename||"").trim().replace(/[\\/:*?"<>|]+/g,"_")||defaultReportName(scope);
    const fmtLabel={pdf:"PDF",excel:"Excel",csv:"CSV"}[format]||format;
    const scopeStr=`${scope.areaLabel} · ${scope.segLabel} · ${scope.dateLabel}`;
    if(!canExport(_role, format)){   // TODO(server): ต้องบังคับด่านนี้ที่เซิร์ฟเวอร์จริง — ฝั่ง client เป็นชั้นเสริม
      pushAudit({user:_uname, action:"ส่งออกรายงานถูกปฏิเสธ", category:"ส่งออก", detail:`บทบาท ${_ROLE_TH[_role]||_role} ไม่มีสิทธิ์ส่งออก ${fmtLabel} · ${scopeStr} · ${num(count||0)} รายการ`});
      toast(`บทบาทของคุณไม่มีสิทธิ์ส่งออกไฟล์ ${fmtLabel}`,"bad"); setExportOpen(false); return; }
    const rows=buildExportRows({...opts, dataSel}); setExportOpen(false);
    if(format==="csv"){ downloadCSV(name+".csv", rows); toast("ส่งออกไฟล์ CSV แล้ว","good"); }
    else if(format==="excel"){ downloadXLS(name+".xls", rows); toast("ส่งออกไฟล์ Excel แล้ว","good"); }
    else { toast("กำลังเตรียมไฟล์ PDF…","info"); setTimeout(()=>window.print(),350); }
    pushAudit({user:_uname, action:"ส่งออกรายงาน", category:"ส่งออก", detail:`${fmtLabel} · ${name} · ${scopeStr} · ${num(count||0)} รายการ`});
  };

  // ═══════════ แดชบอร์ดผู้บริหาร (ออกแบบใหม่) — เน้นเปรียบเทียบระหว่างจังหวัด + สิ่งที่พบจากข้อมูล ═══════════
  const REF = v.ref, DAY=864e5;
  const beD = thDate, monLabel = thMonth;   // ใช้ตัวแปลงกลาง

  // ── ตัวเลือก + ชุดข้อมูลที่ผ่านตัวกรอง (จังหวัด · อำเภอจริงของจังหวัดนั้น · หมวดธุรกิจ · ช่วงวันที่) ──
  const provOpts = [...new Set((areas||[]).map(a=>a.province))];
  // อำเภอในดรอปดาวน์ = อำเภอที่ "มีข้อมูลจริง" ในชุดเดียวกับที่ตัวกรองใช้ (custs/pros) — เลือกแล้วต้องเห็นข้อมูลเสมอ ไม่มีอำเภอว่าง
  const distOpts = fProv==="all" ? [] :
    [...new Set(custs.concat(pros).filter(r=>r.province===fProv && (fSeg==="all"||r.segment===fSeg) && r.district).map(r=>r.district))]
      .sort((a,b)=>String(DISTRICT_TH[a]||a).localeCompare(String(DISTRICT_TH[b]||b),"th"));
  // ช่วงวันที่: เลือกปฏิทินเอง (fFrom/fTo) มาก่อน · ไม่งั้นใช้ชิปช่วงเวลา (7/30/ไตรมาส/ทั้งหมด)
  const _winOf = id => { if(id==="7d"||id==="30d"){const days=id==="7d"?7:30; return {from:REF-(days-1)*DAY,to:REF};}
    if(id==="q"){const d=new Date(REF); return {from:Date.UTC(d.getUTCFullYear(),Math.floor(d.getUTCMonth()/3)*3,1),to:REF};} return null; };
  const customDate = !!(fFrom||fTo);
  const win = customDate
    ? {from: fFrom?Date.parse(fFrom+"T00:00:00Z"):-Infinity, to: fTo?Date.parse(fTo+"T00:00:00Z")+DAY-1:Infinity}
    : _winOf(range);
  const _cat = o => (fProv==="all"||o.province===fProv) && (fDist==="all"||o.district===fDist) && (fSeg==="all"||o.segment===fSeg);
  const _inWin = o => { if(!win) return true; const t=Date.parse(o.created_at); return t>=win.from && t<=win.to; };
  const catCusts = custs.filter(_cat), catPros = pros.filter(_cat);          // กรองพื้นที่/หมวด (ไม่รวมเวลา) → กราฟอนุกรมเวลา
  const fCusts = catCusts.filter(_inWin), fPros = catPros.filter(_inWin);    // กรองครบทุกมิติ → KPI/สัดส่วน/ตาราง
  const rangeText = customDate
    ? ((fFrom?beD(Date.parse(fFrom+"T00:00:00Z")):"เริ่มแรก")+" – "+(fTo?beD(Date.parse(fTo+"T00:00:00Z")):beD(REF)))
    : (win ? beD(win.from)+" – "+beD(win.to) : "ข้อมูลทั้งหมดในระบบ · ล่าสุด "+beD(REF));
  // ── ระดับการเจาะลึก (drill-down): ประเทศ → จังหวัด → อำเภอ ตามตัวกรอง fProv/fDist ──
  const level = fDist!=="all" ? "district" : fProv!=="all" ? "province" : "country";
  const unitKey  = level==="country" ? "province" : level==="province" ? "district" : "segment";
  const unitNoun = level==="country" ? "จังหวัด"   : level==="province" ? "อำเภอ"     : "หมวดธุรกิจ";
  const unitLabelOf = u => unitKey==="province" ? provinceTH(u) : unitKey==="district" ? (DISTRICT_TH[u]||u) : segTH(u);
  const scopeTH = level==="country" ? "" : level==="district" ? (DISTRICT_TH[fDist]||fDist) : provinceTH(fProv);   // ชื่อขอบเขตที่เจาะอยู่
  // จัดกลุ่มตาม "หน่วยเปรียบเทียบ" ของระดับปัจจุบัน (แทน ranked เดิมที่เป็นรายจังหวัดเสมอ)
  const _byKey = arr => { const m={}; arr.forEach(o=>{ const val=o[unitKey]; if(val==null||val==="") return; m[val]=(m[val]||0)+1; }); return m; };
  const _cCnt=_byKey(fCusts), _pCnt=_byKey(fPros);
  const ranked = [...new Set([...Object.keys(_cCnt),...Object.keys(_pCnt)])]
    .map(u=>({province:u, unit:u, label:unitLabelOf(u), customerCount:_cCnt[u]||0, prospectCount:_pCnt[u]||0}));
  const isEmpty = fCusts.length===0 && fPros.length===0;   // ไม่พบข้อมูลตามเงื่อนไขที่เลือก
  // ความครอบคลุมพื้นที่ — "มีลูกค้าแล้วกี่พื้นที่ จากพื้นที่ทั้งหมด" (null = ไม่มีพื้นที่ให้นับ)
  const cov = areaCoverage(fCusts, fPros, fProv);
  const animSig = [range,fProv,fDist,fSeg,fFrom,fTo].join("|");   // เปลี่ยนตัวกรองใด ๆ → กราฟรีเฟรชพร้อมอนิเมชัน

  // แถว 1 ซ้าย · สัดส่วนที่เป็นลูกค้าแล้ว รายจังหวัด (เทียบค่าเฉลี่ย) — ไม่ใช้คำว่า Coverage
  const provShare = ranked.map(a=>{ const tot=a.customerCount+a.prospectCount;
      return {province:a.province, unit:a.unit, label:a.label, cust:a.customerCount, lead:a.prospectCount, tot, share: tot?Math.round(a.customerCount/tot*100):0}; })
    .filter(x=>x.tot>0).sort((a,b)=>b.share-a.share);
  const avgShare = provShare.length?Math.round(provShare.reduce((s,p)=>s+p.share,0)/provShare.length):0;
  const lowProv = provShare.length?provShare[provShare.length-1]:null;
  const shareTakeaway = lowProv && lowProv.share<avgShare
    ? `${lowProv.label} สัดส่วนลูกค้า ${lowProv.share}% ต่ำกว่าค่าเฉลี่ย ${avgShare}% — เร่งเปลี่ยน Lead เป็นลูกค้าในพื้นที่นี้`
    : `ทุก${unitNoun}มีสัดส่วนลูกค้าใกล้เคียงค่าเฉลี่ย`;
  const avgCustPerUnit = ranked.length ? Math.round(ranked.reduce((s,a)=>s+a.customerCount,0)/ranked.length) : 0;

  // ── breadcrumb (drill-down) · อันดับหน่วยปัจจุบันเทียบพี่น้องในขอบเขตแม่ + ค่าเฉลี่ยแม่ ──
  const _rankAmong = (keyFn, target, scope) => {   // คำนวณ share ของทุกพี่น้อง (ไม่กรองหน่วยปัจจุบัน) แล้วจัดอันดับ
    const sc={}, sp={};
    for(const o of custs) if(scope(o)){ const k=keyFn(o); if(k) sc[k]=(sc[k]||0)+1; }
    for(const o of pros ) if(scope(o)){ const k=keyFn(o); if(k) sp[k]=(sp[k]||0)+1; }
    const rows=[...new Set([...Object.keys(sc),...Object.keys(sp)])]
      .map(k=>{const c=sc[k]||0,l=sp[k]||0,t=c+l; return {k,share:t?Math.round(c/t*100):0,t};})
      .filter(x=>x.t>0).sort((a,b)=>b.share-a.share);
    const idx=rows.findIndex(x=>x.k===target);
    const avg=rows.length?Math.round(rows.reduce((s,x)=>s+x.share,0)/rows.length):0;
    return { rank: idx>=0?idx+1:0, total: rows.length, share: idx>=0?rows[idx].share:0, avg };
  };
  let bc = null;
  if(level==="province"){
    const r=_rankAmong(o=>o.province, fProv, o=>(fSeg==="all"||o.segment===fSeg)&&_inWin(o));
    bc={ unitTH:provinceTH(fProv), parentTH:"ทั้งประเทศ", ...r, diff:r.share-r.avg };
  } else if(level==="district"){
    const r=_rankAmong(o=>o.district, fDist, o=>o.province===fProv&&(fSeg==="all"||o.segment===fSeg)&&_inWin(o));
    bc={ unitTH:DISTRICT_TH[fDist]||fDist, parentTH:"จังหวัด"+provinceTH(fProv), ...r, diff:r.share-r.avg };
  }

  // แถว 2 ซ้าย · แนวโน้มการเพิ่มลูกค้า/Lead 6 เดือน (จากวันที่ในระเบียนจริง)
  const custMon={}, prosMon={};
  catCusts.forEach(c=>{ if(c.created_at){const m=c.created_at.slice(0,7); custMon[m]=(custMon[m]||0)+1;} });
  catPros.forEach(p=>{ if(p.created_at){const m=p.created_at.slice(0,7); prosMon[m]=(prosMon[m]||0)+1;} });
  const allMon=[...new Set([...Object.keys(custMon),...Object.keys(prosMon)])].sort();
  const last6=allMon.slice(-6);
  const lineCust=last6.map(m=>custMon[m]||0), linePros=last6.map(m=>prosMon[m]||0);
  const lineTot=lineCust.reduce((a,b)=>a+b,0)+linePros.reduce((a,b)=>a+b,0);

  // แนวโน้มการเติบโตของ KPI — เทียบช่วงที่เลือกกับช่วงก่อนหน้าที่ยาวเท่ากัน (ตามหมวด/พื้นที่ที่กรอง จาก created_at จริง)
  const _kwin = win || {from: REF-29*DAY, to: REF};
  const _kprev = {from: _kwin.from-(_kwin.to-_kwin.from+DAY), to: _kwin.from-DAY};
  const _cnt=(arr,w)=>arr.filter(o=>{const t=Date.parse(o.created_at); return t>=w.from&&t<=w.to;}).length;
  const _grow=arr=>{ const cur=_cnt(arr,_kwin), prv=_cnt(arr,_kprev);
    if(!prv) return {plain:true, txt: cur>0?"ไม่มีช่วงก่อนให้เทียบ":"ไม่มีข้อมูลในช่วงนี้"};
    const g=(cur-prv)/prv*100; return {up:g>=0, txt:(g>=0?"+":"")+g.toFixed(1)+"%", plain:false}; };
  const custTrend=_grow(catCusts), leadTrend=_grow(catPros);
  // หมายเหตุ: ไม่แสดง "อัตราการเปลี่ยนเป็นลูกค้า" เป็นการเปลี่ยนแปลงเทียบช่วงก่อน เพราะค่าจะลดลงเมื่อนำเข้า Lead เพิ่ม
  // แม้จำนวนลูกค้าจะไม่ลดลง → การเติบโตให้ดูจาก "ลูกค้าใหม่" (custTrend / กราฟลูกค้าใหม่รายเดือน) แทน
  // การ์ดแสดงแนวโน้ม ▲/▼ ใต้ตัวเลข KPI
  const kpiTrend = d => d.plain
    ? html`<div class="mg-kpi-d flat">— ${d.txt}</div>`
    : html`<div class=${"mg-kpi-d "+(d.up?"up":"down")}>${d.up?"▲":"▼"} ${d.txt}<span>จากช่วงก่อน</span></div>`;
  // ── การ์ด KPI (อ่านจบใน 3 วิ): ตัวเลขหลัก + การเปลี่ยนแปลง(ลูกศร) + สี ──
  const _delta = arr => { const cur=_cnt(arr,_kwin), prv=_cnt(arr,_kprev); return (cur||prv) ? cur-prv : null; };  // การเปลี่ยนแปลงจำนวน · null=ไม่มีข้อมูลเทียบ
  const custDelta=_delta(catCusts), leadDelta=_delta(catPros);
  const _cAll=(db.customers||[]).length, _pAll=(db.prospects||[]).length;
  const natShare=(_cAll+_pAll)? Math.round(_cAll/(_cAll+_pAll)*100):0;      // อัตราเปลี่ยนเป็นลูกค้าเฉลี่ยทั้งประเทศ
  const curShare=(fCusts.length+fPros.length)? Math.round(fCusts.length/(fCusts.length+fPros.length)*100):0;   // ของขอบเขตปัจจุบัน
  const shareDiff=curShare-natShare;   // + สูงกว่า / − ต่ำกว่า ค่าเฉลี่ยประเทศ
  const heroTone = shareDiff<0 ? "bad" : shareDiff>0 ? "good" : "flat";
  const deltaLine=(d,suf)=> d==null
    ? html`<div class="mg-kpi-d flat">— ${suf}</div>`
    : html`<div class=${"mg-kpi-d "+(d>=0?"up":"down")}>${d>=0?"▲":"▼"} ${d>=0?"+":""}${num(d)} <span>${suf}</span></div>`;

  // แถว 2 กลาง · อัตราการเปลี่ยนเป็นลูกค้า รายจังหวัด (สัดส่วนลูกค้า/ทั้งหมด)
  const convBars = provShare.map(p=>({label:p.label, value:p.share, color: p.share>=avgShare?"#ff8a9c":"#dbe0e7"}));
  const convFull = convBars.slice().sort((a,b)=>a.value-b.value);   // สัดส่วนต่ำสุดก่อน (กลุ่มที่ต้องให้ความสนใจ)

  // แถว 2 ขวา · หมวดที่ยังไม่ถูกเจาะ (สัดส่วนลูกค้าต่ำสุด แต่มี Lead)
  const segStats = SEGMENTS.map(s=>{ const c=fCusts.filter(x=>x.segment===s).length, l=fPros.filter(x=>x.segment===s).length;
    return {s, c, l, tot:c+l, share:(c+l)?c/(c+l):0}; }).filter(x=>x.l>0);
  const unpen = segStats.slice().sort((a,b)=>a.share-b.share).slice(0,5).map(x=>({label:segTH(x.s), value:x.l, color:SEG_COLOR[x.s]||OTHER_COLOR}));

  // แถว 4 ขวา · หมวดธุรกิจที่เติบโต/ลดลง (ลูกค้าใหม่ 90 วันล่าสุด vs 90 วันก่อนหน้า)
  const inRange=(t,a,b)=>{ const x=Date.parse(t); return x>REF-a*DAY && x<=REF-b*DAY; };
  const segDelta = SEGMENTS.map(s=>{ const cs=catCusts.filter(c=>c.segment===s && c.created_at);
      const cur=cs.filter(c=>inRange(c.created_at,90,0)).length, prev=cs.filter(c=>inRange(c.created_at,180,90)).length;
      return {s, label:segTH(s), cur, prev, delta:cur-prev}; }).filter(x=>x.cur||x.prev);
  const gainers = segDelta.slice().sort((a,b)=>b.delta-a.delta).slice(0,4).filter(x=>x.delta>0);
  const losers  = segDelta.slice().sort((a,b)=>a.delta-b.delta).slice(0,4).filter(x=>x.delta<0);

  // แถว 4 ซ้าย · ตารางสรุปรายจังหวัด (ลูกค้าใหม่ 90 วัน)
  const provRows = ranked.map(a=>{ const tot=a.customerCount+a.prospectCount;
    const new90=catCusts.filter(c=>c[unitKey]===a.unit && c.created_at && Date.parse(c.created_at)>REF-90*DAY).length;
    return {province:a.province, unit:a.unit, label:a.label, cust:a.customerCount, lead:a.prospectCount, share: tot?Math.round(a.customerCount/tot*100):0, new90}; })
    // เจาะลึกแล้วเรียงสัดส่วนจากน้อย→มาก (หน่วยที่ตามหลังอยู่บน) · ระดับประเทศเรียงตามจำนวนลูกค้า
    .sort((a,b)=> level==="country" ? b.cust-a.cust : a.share-b.share);

  // ระดับอำเภอ · Lead ในหมวดที่พื้นที่นี้ยังขาด และยังไม่ได้เข้าพบ (เจาะถึงรายบริษัท เพราะขอบเขตแคบพอ)
  const gapSegMap = Object.fromEntries(gapBySegment(fCusts, fPros).map(x=>[x.seg, x.gap]));
  const leadAList = level==="district"
    ? fPros.filter(p=>(gapSegMap[p.segment]||0)>0)
        .map(p=>({...p, _gap:gapSegMap[p.segment]||0, _visited: (p.visit_status && p.visit_status!=="ยังไม่เข้าพบ") || (Array.isArray(p.visitRounds)&&p.visitRounds.length>0)}))
        .sort((a,b)=>b._gap-a._gap || a.businessName.localeCompare(b.businessName,"th")).slice(0,15)
    : [];

  // แถว 3 ขวา · สิ่งที่พบจากข้อมูล (rule-based · คำนวณจากข้อมูล ณ วันล่าสุด)
  const asOf = "คำนวณจากข้อมูล ณ "+beD(REF);
  const scopeGap = demandGap(fCusts, fPros, level==="district"?GAP_REF.district:level==="province"?GAP_REF.province:GAP_REF.country);
  const topGain = gainers[0], topLose = losers[0];
  // แต่ละประเด็นมีสีประจำ (ต่างชนิดงาน/ความสำคัญ): แดง=ปัญหาเร่งด่วน · อำพัน=โอกาสต้องรีบทำ · เขียว=เชิงบวก · ม่วง=ขาลงต้องตรวจสอบ · น้ำเงิน=โอกาสขยายฐาน
  const actions = [];
  if(lowProv && lowProv.share<avgShare) actions.push({icon:"gap",tone:"bad",color:"#e60023",
    title:`${lowProv.label} · สัดส่วนลูกค้าต่ำกว่าค่าเฉลี่ย`,
    body:`Lead ${num(lowProv.lead)} ราย เป็นลูกค้าแล้ว ${num(lowProv.cust)} ราย (${lowProv.share}%) — ต่ำกว่าค่าเฉลี่ย ${avgShare}%`});
  if(scopeGap.gapCount) actions.push({icon:"target",tone:"warn",color:"#f59e0b",
    title:`Lead${GAP_TH[scopeGap.gapLevel]} · ดัชนี ${scopeGap.gapScore}`,
    body:`ยังขาดสมาชิกเครือข่าย ${num(scopeGap.gapCount)} ราย ใน ${scopeGap.gapBreadth} หมวด — หมวดที่ขาดมากสุดคือ${scopeGap.topGapSegment?segTH(scopeGap.topGapSegment):"—"}`});
  if(topGain) actions.push({icon:"trend",tone:"good",color:"#16a34a", title:`หมวด${topGain.label} กำลังเติบโต`,
    body:`ลูกค้าใหม่ ${num(topGain.cur)} ราย ใน 90 วันล่าสุด (+${num(topGain.delta)} จากช่วงก่อน)`});
  if(topLose) actions.push({icon:"trend",tone:"bad",color:"#7c3aed", title:`หมวด${topLose.label} ชะลอตัว`,
    body:`ลูกค้าใหม่ลดลง ${num(Math.abs(topLose.delta))} ราย เทียบช่วง 90 วันก่อนหน้า — ตรวจสอบสาเหตุ`});
  if(unpen.length) actions.push({icon:"bolt",tone:"info",color:"#3b82f6", title:`หมวด${unpen[0].label} ยังไม่ถูกเจาะ`,
    body:`มี Lead ${num(unpen[0].value)} ราย แต่สัดส่วนที่เป็นลูกค้ายังต่ำ — โอกาสขยายฐาน`});
  const actionTone = t => t==="bad"?"var(--accent)":t==="warn"?"#f0a022":t==="good"?"#33d69f":"#2f7fe0";

  // ═══════════ แท็บ "สภาพระบบ" — สุขภาพข้อมูล/การใช้งาน (ทุกตัวเลขจากข้อมูลจริงในระบบ) ═══════════
  const RECS = custs.concat(pros); const totRec = RECS.length;
  const okCoord = r => typeof r.latitude==="number" && typeof r.longitude==="number" && r.latitude>=5.5 && r.latitude<=20.6 && r.longitude>=97 && r.longitude<=106;
  const isComplete = r => okCoord(r) && !!r.segment && !!r.businessName && !!r.address;
  const pctOf = f => totRec? Math.round(RECS.filter(f).length/totRec*100):0;
  // ความสมบูรณ์รายฟิลด์ — วัดเฉพาะ 4 ฟิลด์จริงที่ลูกค้ามี (ชื่อธุรกิจ · หมวดหมู่ · ที่อยู่ · อีเมล) + พิกัด (ต่ำกว่า 70% = แดง)
  const fieldBars = [
    {label:"พิกัด",        value:pctOf(okCoord),        color: pctOf(okCoord)<70?"#ff5a3c":"#33d69f"},
    {label:"หมวดธุรกิจ",   value:pctOf(r=>!!r.segment), color: pctOf(r=>!!r.segment)<70?"#ff5a3c":"#33d69f"},
    {label:"ชื่อธุรกิจ",   value:pctOf(r=>!!r.businessName), color:"#33d69f"},
    {label:"ที่อยู่",       value:pctOf(r=>!!r.address), color: pctOf(r=>!!r.address)<70?"#ff5a3c":"#33d69f"},
    {label:"อีเมล",        value:pctOf(r=>!!r.email), color: pctOf(r=>!!r.email)<70?"#ff5a3c":"#ffb02e"},
  ];
  // คุณภาพข้อมูล (donut): ครบถ้วน / ควรตรวจสอบ / ไม่ครบ
  const cComplete = RECS.filter(r=>isComplete(r) && !!r.email).length;
  const cReview   = RECS.filter(r=>isComplete(r) && !r.email).length;
  const cIncomp   = totRec - cComplete - cReview;
  const qualityDonut = [
    {label:"ครบถ้วน", value:cComplete, color:"#33d69f"},
    {label:"ควรตรวจสอบ", value:cReview+cIncomp, color:"#ffb02e"},
  ].filter(x=>x.value>0);
  const qualityPct = totRec? Math.round(cComplete/totRec*100):0;
  // สัดส่วนหมวดธุรกิจของทั้งชุดข้อมูล — โชว์ 5 หมวดใหญ่ ที่เหลือยุบเป็น "อื่น ๆ" ไม่ให้ legend ยาวเกิน
  const segCount = SEGMENTS.map(sg=>({sg, value:RECS.filter(r=>r.segment===sg).length}))
    .filter(x=>x.value>0).sort((a,b)=>b.value-a.value);
  const segTop = segCount.slice(0,5).map(x=>({label:segTH(x.sg), value:x.value}));
  const segRest = segCount.slice(5).reduce((a,x)=>a+x.value,0);
  const segDonut = segRest>0 ? [...segTop, {label:"อื่น ๆ", value:segRest}] : segTop;
  // งานที่รอดำเนินการ (ซ่อนแถวที่นับได้ 0)
  const nIncomplete = RECS.filter(r=>!isComplete(r)).length;
  const nBadCoord   = RECS.filter(r=>!okCoord(r)).length;
  const _leads      = useMemo(()=>genLeads(), []);   // ไปป์ไลน์ "จัดการ Lead"
  const nLeadReview = _leads.filter(l=>l.status==="review").length;
  const nLeadDup    = _leads.filter(l=>l.status==="dup").length;
  const healthTasks = [
    {icon:"target",label:"Lead · รอตรวจสอบ",              count:nLeadReview, tone:"warn", goLeads:true},
    {icon:"users", label:"ข้อมูลซ้ำ · รอจัดการ",           count:nLeadDup,    tone:"bad",  goLeads:true},
    {icon:"edit",  label:"ข้อมูลไม่สมบูรณ์ · รอแก้ไข",       count:nIncomplete, tone:"warn"},
    {icon:"pin",   label:"พิกัดไม่ถูกต้อง · รอตรวจสอบ",       count:nBadCoord,   tone:"bad"},
  ].filter(t=>t.count>0);
  // ปริมาณข้อมูลที่เพิ่มเข้าระบบรายเดือน (6 เดือน)
  const hAll = allMon.slice(-6);
  const hLine = hAll.map(m=>(custMon[m]||0)+(prosMon[m]||0));
  const hTotal = hLine.reduce((a,b)=>a+b,0);
  // กิจกรรมการเปลี่ยนแปลงล่าสุด (จาก audit log จริงของ session)
  const auditRecent = getAudit().slice(0,8);
  const catTone = c => /ลบ/.test(c)?"bad":/นำเข้า|เพิ่ม/.test(c)?"good":/ส่งออก/.test(c)?"info":"warn";

  return html`<div class="page fade-in">
    <div class="page-head">
      <div><h1>แดชบอร์ด</h1></div>
      <div class="ph-right" style=${{gap:"10px"}}>
        ${dtab==="business" ? html`<${Btn} variant="outline" icon="download" onClick=${()=>setExportOpen(true)}>ส่งออกรายงาน</${Btn}>`:""}
      </div>
    </div>
    ${exportOpen && html`<${ExportDialog} scope=${exportScope} role=${_role}
      buildPreviewRows=${buildExportRows} onClose=${()=>setExportOpen(false)} onExport=${doExport}/>`}

    ${DASH_TABS.length>1 ? html`<${Tabs} tabs=${DASH_TABS} active=${dtab} onChange=${setTab}/>` : ""}
    <div style=${{marginTop:"16px"}}></div>

    ${dtab==="business" ? html`
    <!-- แถบเลือกช่วงเวลา (เฉพาะภาพรวมธุรกิจ) -->
    <div class="tf-bar">
      <!-- ตัวกรอง: จังหวัด · อำเภอ · หมวดธุรกิจ · ช่วงเวลาด่วน (dropdown แถวเดียวแบบ TC) · ปฏิทินเลือกวันเอง -->
      <div class="mgf-row">
        <div class="mgf-f mgf-dd"><span>จังหวัด</span>
          <${Dropdown} value=${fProv} onChange=${v=>{ setFProv(v); setFDist("all"); }}
            options=${[["all","ทุกจังหวัด"], ...provOpts.map(p=>[p, provinceTH(p)])]}/></div>
        <div class="mgf-f mgf-dd"><span>อำเภอ</span>
          <${Dropdown} value=${fDist} disabled=${fProv==="all"}
            placeholder=${fProv==="all"?"เลือกจังหวัดก่อน":"ทุกอำเภอ"} onChange=${v=>setFDist(v)}
            options=${[["all", fProv==="all"?"เลือกจังหวัดก่อน":"ทุกอำเภอ"], ...distOpts.map(d=>[d, DISTRICT_TH[d]||d])]}/></div>
        <div class="mgf-f mgf-dd"><span>หมวดธุรกิจ</span>
          <${Dropdown} value=${fSeg} onChange=${v=>setFSeg(v)}
            options=${[["all","ทุกหมวด"], ...SEGMENTS.map(s=>[s, segTH(s)])]}/></div>
        <div class="mgf-f mgf-dd"><span>ช่วงเวลาด่วน</span>
          <${Dropdown} value=${customDate?"custom":range} onChange=${v=>{ if(v!=="custom"){ setRange(v); setFFrom(""); setFTo(""); } }}
            options=${[...RANGES.map(r=>[r.id, r.label]), ["custom","กำหนดเอง"]]}/></div>
        <label class="mgf-f"><span>ตั้งแต่วันที่</span>
          <${DateField} value=${fFrom} max=${fTo||undefined} onChange=${setFFrom}/></label>
        <label class="mgf-f"><span>ถึงวันที่</span>
          <${DateField} value=${fTo} min=${fFrom||undefined} onChange=${setFTo}/></label>
        ${(fProv!=="all"||fDist!=="all"||fSeg!=="all"||customDate) ? html`<button class="mgf-clear" onClick=${()=>{ setFProv("all"); setFDist("all"); setFSeg("all"); setFFrom(""); setFTo(""); setRange("all"); }}><${Icon} name="close" size=${13}/> ล้างตัวกรอง</button>`:""}
      </div>
    </div>

    <!-- (นำแถบ breadcrumb/แจ้งเตือนระดับพื้นที่ออกตามคำขอ — กลับไปทั้งประเทศได้ด้วยปุ่ม "ล้างตัวกรอง" ในแถบกรอง) -->
    ${isEmpty ? html`<div class="mg-empty"><${Icon} name="info" size=${16} color="var(--accent)"/> ไม่พบข้อมูลตามเงื่อนไขที่เลือก — ลองปรับตัวกรอง หรือกด "ล้างตัวกรอง"</div>`:""}

    <!-- KPI 4 ใบ · ตัวเลขหลัก + การเปลี่ยนแปลง(ลูกศร) + สี · การ์ดอัตราเปลี่ยนเป็นลูกค้าเด่นที่สุด -->
    <div class="mg-kpis">
      <div class="mg-kpi">
        <div class="mg-kpi-hd"><div class="mg-kpi-l">${level==="country"?"ลูกค้าทั้งหมด":"ลูกค้าใน"+scopeTH}</div><span class="mg-kpi-ic"><${Icon} name="users" size=${18}/></span></div>
        <div class="mg-kpi-v">${num(fCusts.length)}</div>
        ${deltaLine(custDelta,"จากเดือนก่อน")}</div>
      <div class="mg-kpi">
        <div class="mg-kpi-hd"><div class="mg-kpi-l">${level==="country"?"Lead ทั้งหมด":"Lead ใน"+scopeTH}</div><span class="mg-kpi-ic"><${Icon} name="target" size=${18}/></span></div>
        <div class="mg-kpi-v">${num(fPros.length)}</div>
        ${deltaLine(leadDelta,"จากเดือนก่อน")}</div>
      <div class=${"mg-kpi mg-kpi-hero "+heroTone}>
        <div class="mg-kpi-hd"><div class="mg-kpi-l">อัตราการเปลี่ยนเป็นลูกค้า</div><span class="mg-kpi-ic"><${Icon} name="trend" size=${18}/></span></div>
        <div class="mg-kpi-v">${curShare}%</div>
        ${shareDiff===0
          ? html`<div class="mg-kpi-d flat">— เทียบค่าเฉลี่ยประเทศ ${natShare}%</div>`
          : html`<div class=${"mg-kpi-d "+(shareDiff>0?"up":"down")}>${shareDiff>0?"▲ สูงกว่า":"▼ ต่ำกว่า"}ค่าเฉลี่ยประเทศ ${natShare}%</div>`}</div>
      <div class="mg-kpi">
        <div class="mg-kpi-hd"><div class="mg-kpi-l">ความครอบคลุมพื้นที่</div><span class="mg-kpi-ic"><${Icon} name="map" size=${18}/></span></div>
        <div class="mg-kpi-v">${cov ? cov.pct+"%" : "—"}</div>
        <div class="mg-kpi-d flat">${cov
          ? `ครอบคลุม ${num(cov.covered)} จาก ${num(cov.total)} ${cov.unitTH}`
          : "ไม่มีข้อมูลพื้นที่"}</div></div>
    </div>
    <div class="mg-rows">
      <!-- ═══ แถวบน · แนวโน้ม (5) | Performance & Value (7) ═══ -->
      <div class="mg-row r-top">
          <${Card} title="แนวโน้มการเพิ่มลูกค้าและ Lead" sub=${"ลูกค้าใหม่และ Lead ใหม่รายเดือน · นับจากวันที่เพิ่มเข้าระบบ · 6 เดือนล่าสุด"+(last6.length?" · "+monLabel(last6[0])+"–"+monLabel(last6[last6.length-1]):"")}>
            ${lineTot>0 && last6.length>=2 ? html`<div>
              <div class="mg-legend"><span><i style=${{background:"#e60023"}}></i>ลูกค้าใหม่ <b style=${{color:"var(--txt)"}}>${num(lineCust.reduce((a,b)=>a+b,0))}</b></span>
                <span><i style=${{background:"#ff9aa8"}}></i>Lead ใหม่ <b style=${{color:"var(--txt)"}}>${num(linePros.reduce((a,b)=>a+b,0))}</b></span></div>
              <${LineChart} key=${"mgln-"+animSig} labels=${last6.map(monLabel)} series=${[
                {label:"ลูกค้าใหม่", color:"#e60023", points:lineCust},
                {label:"Lead ใหม่",  color:"#ff9aa8", points:linePros}
              ]} height=${130} format=${num}/>
            </div>` : html`<div class="emptybox">ยังไม่มีข้อมูลเพียงพอสำหรับแสดงกราฟนี้</div>`}
          </${Card}>
        <!-- Lead มาก แต่สัดส่วนต่ำ (โดนัท + legend) — ย้ายขึ้นมาข้างกราฟเส้นแทนการ์ดอัตราการเปลี่ยนเป็นลูกค้าเดิม -->
        <${Card} title="Lead มาก แต่สัดส่วนต่ำ" sub="หมวดที่ยังไม่ถูกเจาะ · Lead สูง แต่สัดส่วนลูกค้าต่ำ">
          ${unpen.length ? html`<${Donut} key=${"mgdn-"+animSig} data=${unpen} center=${{value:num(unpen.reduce((a,x)=>a+x.value,0)), label:"Lead"}}/>`
            : html`<div class="emptybox">ยังไม่มีข้อมูลเพียงพอ</div>`}
        </${Card}>
      </div>

      <!-- ═══ แถวกลาง · สัดส่วน (แคบลง 15%) | สิ่งที่พบจากข้อมูล (กว้างขึ้น 15%) ═══ -->
      <div class="mg-row r-mid">
          <${Card} title=${"อัตราการเปลี่ยนเป็นลูกค้าราย"+unitNoun} sub=${"สัดส่วนลูกค้าต่อธุรกิจที่รู้จักในพื้นที่ ณ ปัจจุบัน · "+(convFull.length>5?unitNoun+"ที่สัดส่วนต่ำสุด (ต้องให้ความสนใจ)":"เทียบระหว่าง"+unitNoun)+" · แถบเทา = ต่ำกว่าค่าเฉลี่ย"}>
            ${convFull.length ? html`<div>
              <div class=${"mg-hbars"+(expConv?" mg-scroll":"")}>
              ${(expConv?convFull:convFull.slice(0,5)).map(d=>html`<div key=${d.label} class="mg-hbar">
                <div class="mg-hbar-l">${d.label}</div>
                <div class="mg-hbar-track"><div class="mg-hbar-fill" style=${{width:d.value+"%",background:d.color}}></div></div>
                <div class="mg-hbar-v">${d.value}%</div>
              </div>`)}
              </div>
              ${convFull.length>5?html`<div class="mg-more"><button class="mg-more-btn" onClick=${()=>setExpConv(e=>!e)}>${expConv?"ย่อกลับ (5 อันดับ)":`ดูทั้งหมด (${convFull.length} ${unitNoun})`}</button></div>`:""}
            </div>` : html`<div class="emptybox">ยังไม่มีข้อมูลเพียงพอ</div>`}
          </${Card}>
        <!-- สิ่งที่พบจากข้อมูล · การ์ด 5 ใบ -->
        <${Card} title="สิ่งที่พบจากข้อมูล" sub=${asOf}>
          ${actions.length ? html`<div class="mg-insights">
            ${actions.slice(0,5).map((a,i)=>{ const c=a.color||"#94a3b8"; return html`<div key=${i} class="mg-insight" style=${{background:c+"12",borderColor:c+"3a"}}>
              <div class="mg-insight-ic" style=${{background:c}}><${Icon} name=${a.icon} size=${15} color="#fff"/></div>
              <div class="mg-insight-t">${a.title}</div>
              <div class="mg-insight-b">${a.body}</div>
            </div>`; })}
          </div>` : html`<div class="emptybox">ยังไม่มีประเด็นจากข้อมูล</div>`}
        </${Card}>
      </div>

      <!-- ═══ แถวล่าง · [ตาราง | เติบโต] เต็มความกว้าง (โดนัทย้ายขึ้นแถวบนแล้ว) ═══ -->
      <div class="mg-row r-bot">
        <!-- 2 คอลัมน์ · สรุปรายจังหวัด (กินพื้นที่ที่โดนัทเคยอยู่) | หมวดธุรกิจที่เติบโตและลดลง -->
        <div class="mg-2col mg-bot2">
        <!-- สรุปรายหน่วยของระดับที่เจาะ -->
        <${Card} title=${"สรุปราย"+unitNoun} sub=${(level==="country"?"เรียงตามจำนวนลูกค้า":"เรียงสัดส่วนจากน้อย→มาก (ที่ตามหลังอยู่บน)")+" · คลิกแถวเพื่อเจาะลึก"} pad0=${true}>
          ${provRows.length ? html`<div class=${"mg-tblwrap"+(expTbl?" mg-scroll":"")}><table class="tc-table mg-tbl">
            <thead><tr><th>${unitNoun}</th><th class="rt">ลูกค้า</th><th class="rt">Lead</th><th class="rt">สัดส่วน</th><th class="rt">ลูกค้าใหม่</th></tr></thead>
            <tbody>${(expTbl?provRows:provRows.slice(0,5)).map(r=>{
              return html`<tr key=${r.unit} style=${{cursor:"pointer"}} onClick=${()=>{ if(level==="country"){setFProv(r.unit);setFDist("all");} else if(level==="province") setFDist(r.unit); else setFSeg(r.unit); }}>
              <td><b>${r.label}</b></td><td class="rt">${num(r.cust)}</td><td class="rt">${num(r.lead)}</td>
              <td class="rt"><b style=${{color:r.share>=avgShare?"var(--accent-deep)":"var(--muted)"}}>${r.share}%</b></td>
              <td class="rt">${r.new90>0?html`<span style=${{color:"#0f7a3d"}}>▲ +${num(r.new90)}</span>`:html`<span style=${{color:"var(--dim)"}}>0</span>`}</td>
            </tr>`;})}</tbody>
          </table>
          ${provRows.length>5?html`<div class="mg-more" style=${{padding:"0 14px 12px"}}><button class="mg-more-btn" onClick=${()=>setExpTbl(e=>!e)}>${expTbl?"ย่อกลับ (5 อันดับ)":`ดูทั้งหมด (${provRows.length} ${unitNoun})`}</button></div>`:""}</div>` : html`<div class="emptybox" style=${{margin:"18px"}}>ยังไม่มีข้อมูลรายจังหวัด</div>`}
        </${Card}>
        <!-- หมวดธุรกิจที่เติบโตและลดลง -->
        <${Card} title="หมวดธุรกิจที่เติบโตและลดลง" sub="ลูกค้าใหม่ 90 วันล่าสุด เทียบ 90 วันก่อนหน้า">
          <div class="mg-2col">
            <div>
              <div class="mg-seg-head up">เติบโต</div>
              ${gainers.length ? gainers.map(g=>html`<div key=${g.s} class="mg-seg-row">
                <span class="mg-seg-l">${g.label}</span><span class="mg-seg-n up">▲ +${num(g.delta)} ราย</span></div>`)
                : html`<div class="dim" style=${{fontSize:"12px",padding:"8px 0"}}>ยังไม่มีหมวดที่เติบโตชัดเจน</div>`}
            </div>
            <div>
              <div class="mg-seg-head down">ชะลอตัว</div>
              ${losers.length ? losers.map(g=>html`<div key=${g.s} class="mg-seg-row">
                <span class="mg-seg-l">${g.label}</span><span class="mg-seg-n down">▼ ${num(g.delta)} ราย</span></div>`)
                : html`<div class="dim" style=${{fontSize:"12px",padding:"8px 0"}}>ไม่มีหมวดที่ลดลง</div>`}
            </div>
          </div>
        </${Card}></div>
      </div>

      ${level==="district" ? html`
      <!-- ═══ ระดับอำเภอ · Lead ในหมวดที่ยังขาด (เต็มความกว้าง) ═══ -->
      <div class="mg-row r-full">
        <${Card} title=${"Lead ในหมวดที่"+scopeTH+"ยังขาด"} sub="เรียงตามขนาดช่องว่างของหมวดธุรกิจจากมากไปน้อย · แสดงสูงสุด 15 ราย · ข้อมูลสำหรับผู้ดูแลพื้นที่ (ผู้บริหารดูอย่างเดียว ไม่มีปุ่มเข้าพบ)" pad0=${true}>
          ${leadAList.length ? html`<div class="mg-tblwrap mg-leadA"><table class="tc-table mg-tbl">
            <thead><tr><th>ชื่อธุรกิจ</th><th>หมวดธุรกิจ</th><th class="rt">หมวดนี้ยังขาด</th><th>สถานะ</th></tr></thead>
            <tbody>${leadAList.map(p=>html`<tr key=${p.id}>
              <td><b>${p.businessName}</b></td><td>${segTH(p.segment)}</td>
              <td class="rt"><b>${num(p._gap||0)}</b> ราย</td>
              <td>${p._visited?html`<span style=${{color:"#0f7a3d"}}>เข้าพบแล้ว</span>`:html`<span style=${{color:"#c2410c"}}>ยังไม่เข้าพบ</span>`}</td>
            </tr>`)}</tbody>
          </table></div>` : html`<div class="emptybox" style=${{margin:"18px"}}>ไม่มีหมวดธุรกิจที่ยังขาดใน${scopeTH}</div>`}
        </${Card}>
      </div>`:""}
    </div>
    ` : html`
    <!-- แท็บสภาพระบบ · สุขภาพข้อมูลและการใช้งาน (grid 12 คอลัมน์ · จัดวางตามเทมเพลต) -->
    <div class="exd-grid">
      <!-- แถว 1 · งานที่รอดำเนินการ | ภาพรวมระบบข้อมูล -->
      <div class="hzc hzc-tasks" style=${{gridColumn:"span 5"}}><${Card} title="งานที่รอดำเนินการ" sub="สิ่งที่ผู้ดูแลระบบควรจัดการก่อน (ซ่อนรายการที่ไม่มีงานค้าง)">
        ${healthTasks.length ? html`<div class="hz-tasks">
          ${healthTasks.map((t,i)=>html`<div key=${i} class="hz-task">
            <div class="hz-task-n" style=${{background:actionTone(t.tone)}}>${num(t.count)}</div>
            <div class="hz-task-l">${t.label}</div>
            ${t.goLeads ? html`<button class="hz-task-btn" onClick=${()=>nav&&nav("data-management")}>ไปจัดการ</button>` : ""}
          </div>`)}
        </div>` : html`<div class="exd-empty"><${Icon} name="check" size=${24} color="#33d69f"/>
          <div><b>ไม่มีงานค้าง</b><div class="dim" style=${{fontSize:"12px"}}>ข้อมูลในระบบอยู่ในสภาพเรียบร้อย</div></div></div>`}
      </${Card}></div>

      <div class="hzc hzc-sys" style=${{gridColumn:"span 7"}}><${Card} title="ภาพรวมระบบข้อมูล" right=${html`<span class="hz-updated">อัปเดตล่าสุด ${beD(v.ref)}</span>`}>
        <div class="hz-sysov">
          <div class="hz-total"><span class="hz-total-l">Total</span><b class="hz-total-n">${num(totRec)}</b><span class="hz-total-u">รายการ</span></div>
          <div class="hz-stack">
            <div class="hz-stack-seg" style=${{width:(totRec?custs.length/totRec*100:0)+"%",background:"#33d69f"}}></div>
            <div class="hz-stack-seg" style=${{width:(totRec?pros.length/totRec*100:0)+"%",background:"#cbd5e1"}}></div>
          </div>
          <div class="hz-legend">
            <span><i style=${{background:"#33d69f"}}></i>ลูกค้าปัจจุบัน <b>${num(custs.length)}</b></span>
            <span><i style=${{background:"#cbd5e1"}}></i>Lead <b>${num(pros.length)}</b></span>
          </div>
        </div>
      </${Card}></div>

      <!-- แถว 2 · คุณภาพข้อมูล (3) | สัดส่วนหมวดธุรกิจ (3) | ความสมบูรณ์ของข้อมูล (6) -->
      <div class="hzc hzc-2" style=${{gridColumn:"span 3"}}><${Card} title="คุณภาพข้อมูล" sub="สัดส่วนความครบถ้วนของทั้งชุด">
        ${qualityDonut.length ? html`<${Donut} data=${qualityDonut} size=${120} center=${{value:qualityPct, label:"ครบถ้วน", format:x=>x+"%"}}/>`
          : html`<div class="emptybox">ยังไม่มีข้อมูลเพียงพอ</div>`}
      </${Card}></div>

      <div class="hzc hzc-2" style=${{gridColumn:"span 3"}}><${Card} title="สัดส่วนหมวดธุรกิจ" sub=${`${segCount.length} หมวดที่มีข้อมูล · 5 อันดับแรก`}>
        ${segDonut.length ? html`<${Donut} data=${segDonut} size=${120}
            center=${{value:segCount.length, label:"หมวด"}}/>`
          : html`<div class="emptybox">ยังไม่มีข้อมูลเพียงพอ</div>`}
      </${Card}></div>

      <div class="hzc hzc-2" style=${{gridColumn:"span 6"}}><${Card} title="ความสมบูรณ์ของข้อมูล" sub="สัดส่วนที่มีค่าในแต่ละฟิลด์ · ต่ำกว่า 70% = ควรตรวจสอบ">
        <div class="exd-bars">
          ${fieldBars.map(b=>html`<div key=${b.label} class="exd-vrow">
            <div class="exd-vrow-h"><span>${b.label}</span><b style=${{color:b.value<70?"#c2410c":"var(--txt)"}}>${b.value}%</b></div>
            <div class="exd-strack"><div class="exd-sfill" style=${{width:b.value+"%",background:b.color}}></div></div>
          </div>`)}
        </div>
      </${Card}></div>

      <!-- แถว 3 · ปริมาณข้อมูลที่เพิ่มเข้าระบบ | กิจกรรมการเปลี่ยนแปลงล่าสุด -->
      <div class="hzc hzc-line" style=${{gridColumn:"span 8"}}><${Card} title=${"ปริมาณข้อมูลที่เพิ่มเข้าระบบ"+(hAll.length>=2?" ("+monLabel(hAll[0])+" - "+monLabel(hAll[hAll.length-1])+")":"")} sub="นับจากวันที่ในระเบียนจริง · 6 เดือนล่าสุด">
        ${hTotal>0 && hAll.length>=2 ? html`<${LineChart} labels=${hAll.map(monLabel)} series=${[
            {label:"รายการใหม่", color:"#2f7fe0", points:hLine}
          ]} height=${210} format=${num}/>`
          : html`<div class="emptybox">ยังไม่มีข้อมูลเพียงพอสำหรับแสดงกราฟนี้</div>`}
      </${Card}></div>

      <div class="hzc hzc-act" style=${{gridColumn:"span 4"}}><${Card} title="กิจกรรมการเปลี่ยนแปลงล่าสุด" sub="การกระทำที่มีผลกับข้อมูลในระบบ" pad0=${true}>
        ${auditRecent.length ? html`<div class="hz-acts">
          ${auditRecent.slice(0,7).map(a=>html`<div key=${a.id} class="hz-act">
            <div class="hz-act-d" style=${{background:actionTone(catTone(a.category||""))}}></div>
            <div class="hz-act-m"><div class="hz-act-t">${a.action}</div>
              <div class="hz-act-s">${a.user} · ${thDate(a.ts)}</div></div>
          </div>`)}
        </div>` : html`<div class="hz-actempty">
          <div class="hz-actempty-ic"><${Icon} name="audit" size=${26} color="var(--muted)"/></div>
          <div class="hz-actempty-t">ยังไม่มีกิจกรรมในระบบช่วงนี้</div>
          <div class="hz-actempty-s">การกระทำที่เปลี่ยนข้อมูลจะปรากฏที่นี่</div>
        </div>`}
      </${Card}></div>
    </div>
    `}
    <style>${EXD_CSS}</style>
  </div>`;
}

const EXD_CSS = `
.exd-kv{display:flex;justify-content:space-between;gap:14px;padding:10px 0;border-bottom:1px solid var(--stroke);font-size:13px}
.exd-kv:last-of-type{border-bottom:none}
.exd-kv span{color:var(--muted)}
.exd-empty{display:flex;align-items:center;gap:13px;padding:16px;border-radius:12px;background:var(--surface2);border:1px solid var(--stroke2)}
.exd-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:24px;max-width:1440px;margin:0 auto}
/* ตามคำขอ: ตัวหนังสือ+ตัวเลขในทุกกล่องแดชบอร์ดแอดมิน (สภาพระบบ) เป็นน้ำหนักปกติทั้งหมด (ไม่หนา) */
.exd-grid,.exd-grid *{font-weight:400!important}
/* เงาจางๆ ให้การ์ดในแดชบอร์ดแอดมิน (สภาพระบบ) เหมือนหน้าผู้บริหาร */
.exd-grid .card{box-shadow:var(--shadow)}
/* กล่องในแถวเดียวกันสูงเท่ากันเป๊ะ (แถว 1–4) · เนื้อหายาวเกิน = scroll ในกล่อง · หัวข้อ (card-h) ตรึงบนตรงกัน */
.exd-grid .card{height:100%;display:flex;flex-direction:column;overflow:hidden}
.exd-grid .card:not(.pad0){padding:16px}
.exd-grid .card-h{flex:none}
.exd-grid .card > :not(.card-h){flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden}
.exd-grid .exd-tblwrap{max-height:none;height:100%}
@media(min-width:1280px){
  .exd-r1{height:340px}.exd-r2{height:320px}.exd-r3{height:400px}.exd-r4{height:380px}
}
.exd-sharewrap{position:relative}
.exd-avgline{position:absolute;top:2px;bottom:34px;width:0;border-left:2px dashed var(--muted);z-index:1}
.exd-avgline span{position:absolute;top:-4px;left:4px;font-size:10.5px;color:var(--muted);white-space:nowrap}
.exd-srow{display:grid;grid-template-columns:120px 1fr 42px 66px;align-items:center;gap:10px;padding:6px 0}
.exd-srow-l{font-size:12.5px;font-weight:600;color:var(--txt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.exd-strack{height:8px;border-radius:999px;background:var(--surface2);overflow:hidden}
.exd-sfill{height:100%;border-radius:999px;transition:width .5s}
.exd-srow-v{font-size:13px;font-weight:800;color:var(--txt);text-align:right}
.exd-srow-s{font-size:11px;color:var(--muted);text-align:right}
.exd-bars,.exd-actions{display:flex;flex-direction:column;gap:12px}
.exd-vrow-h{display:flex;justify-content:space-between;align-items:baseline;font-size:12.5px;margin-bottom:4px}
.exd-vrow-h b{font-size:13px;color:var(--txt)}
/* ── แท็บสภาพระบบ (จัดวางตามเทมเพลต) ── */
.hz-tasks{display:flex;flex-direction:column;gap:12px}
.hz-task{display:flex;align-items:center;gap:13px}
.hz-task-n{flex:none;width:48px;height:48px;border-radius:12px;color:#fff;font-size:19px;font-weight:800;display:grid;place-items:center}
.hz-task-l{flex:1;font-size:13.5px;color:var(--txt);font-weight:600;line-height:1.35}
.hz-task-btn{flex:none;padding:8px 16px;border-radius:9px;border:1px solid var(--stroke2);background:var(--surface);color:var(--txt);font-family:var(--font);font-size:13px;font-weight:600;cursor:pointer}
.hz-task-btn:hover{border-color:var(--accent);color:var(--accent-deep,#b30019)}
.hz-updated{font-size:12px;color:var(--muted);white-space:nowrap}
.hz-sysov{display:flex;flex-direction:column;justify-content:center}
.hz-total{display:flex;align-items:baseline;gap:9px;margin:2px 0 16px}
.hz-total-l{font-size:14px;color:var(--muted);font-weight:600}
.hz-total-n{font-size:32px;font-weight:800;color:var(--txt);line-height:1}
.hz-total-u{font-size:13px;color:var(--muted)}
.hz-stack{display:flex;gap:3px;height:8px;border-radius:999px;background:var(--surface2)}
.hz-stack-seg{height:100%;border-radius:999px;transition:width .5s}
.hz-legend{display:flex;gap:22px;margin-top:13px;font-size:13px;color:var(--txt)}
.hz-legend span{display:flex;align-items:center;gap:7px}
.hz-legend i{width:11px;height:11px;border-radius:3px;display:inline-block}
.hz-legend b{font-weight:800;margin-left:2px}
.hz-acts{display:flex;flex-direction:column}
.hz-act{display:flex;gap:10px;padding:11px 16px;border-bottom:1px solid var(--stroke)}
.hz-act:last-child{border-bottom:none}
.hz-act-d{flex:none;width:8px;height:8px;border-radius:50%;margin-top:5px}
.hz-act-m{min-width:0}
.hz-act-t{font-size:13px;font-weight:600;color:var(--txt)}
.hz-act-s{font-size:11.5px;color:var(--muted);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hz-actempty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;padding:34px 16px;text-align:center;height:100%}
.hz-actempty-ic{width:58px;height:58px;border-radius:16px;background:var(--surface2);display:grid;place-items:center;margin-bottom:5px}
.hz-actempty-t{font-size:13.5px;font-weight:600;color:var(--txt)}
.hz-actempty-s{font-size:12px;color:var(--muted)}
.exd-takeaway{display:flex;align-items:flex-start;gap:7px;margin-top:12px;padding:9px 11px;border-radius:9px;
  background:var(--surface2);border:1px solid var(--stroke2);font-size:12px;line-height:1.5;color:var(--txt)}
.exd-action{display:flex;gap:11px;align-items:flex-start}
.exd-action-ic{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;flex:none}
.exd-action-t{font-size:13px;font-weight:700;color:var(--txt)}
.exd-action-b{font-size:12px;color:var(--muted);line-height:1.5;margin-top:2px}
.exd-tblwrap{overflow-x:auto;max-height:320px;overflow-y:auto}
.exd-seg-h{font-size:12px;font-weight:700;margin-bottom:8px}
.exd-seg-row{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--stroke);font-size:12.5px}
.exd-seg-l{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--txt)}
.exd-seg-d{font-weight:800;font-size:12px}.exd-seg-d.up{color:#0f7a3d}.exd-seg-d.down{color:var(--accent)}
/* กันเนื้อห้ากว้าง (กราฟ/ตาราง) ดันคอลัมน์บวม → คอลัมน์ย่อได้ถึง 0 · การ์ดในแถวเดียวกันจึงเรียงข้างกันตามเทมเพลต */
.hzc{min-width:0}
/* ≥1120px: เทมเพลตเต็ม — แถว1 (5+7) · แถว2 สี่ใบเรียงเดียว · แถว3 (8+4) ตาม inline span */
/* 820–1119px: แถว 2 เป็น 2×2 (ใบละครึ่ง) · แถว 1 และ 3 ยังคู่ซ้าย-ขวา ตามเทมเพลต */
@media(max-width:1119px){
  .exd-grid{gap:18px}
  .exd-grid > .hzc-2{grid-column:span 6!important}
}
/* < 820px: จอแคบมาก — เรียงเดี่ยวทุกกล่อง (ไม่มี scroll แนวนอน) */
@media(max-width:819px){
  .exd-grid{grid-template-columns:1fr}
  .exd-grid > div{grid-column:1/-1!important}
}
/* ───────── แดชบอร์ดผู้บริหาร (management) · KPI แถวบน + 3 แถว (คู่ ซ้าย/ขวา ต่อแถว) ───────── */
.mg-rows{display:flex;flex-direction:column;gap:20px}
/* แต่ละแถวเป็นกริด 2 คอลัมน์ · ปกติ ซ้าย 5 / ขวา 7 */
.mg-row{display:grid;grid-template-columns:5fr 7fr;gap:20px;align-items:start}
/* แถวกลาง: ลดความกว้างกล่องสัดส่วนลง 15% (5→4.25) แล้วยกพื้นที่ไปให้กล่องสิ่งที่พบ (7→7.75) */
.mg-row.r-mid{grid-template-columns:4.25fr 7.75fr}
/* แถวบน: สลับเป็น กราฟเส้น 7 / โดนัท 5 — โดนัทได้ความกว้างเท่าที่เคยมีตอนอยู่แถวล่าง ไม่ถูกยืดจนวงเล็กลอยกลางกล่อง */
.mg-row.r-top{grid-template-columns:7fr 5fr}
/* แถวล่าง: โดนัทย้ายออกแล้ว เหลือกล่องเดียว (mg-bot2 แบ่งคอลัมน์ต่อเอง) */
.mg-row.r-bot{grid-template-columns:1fr}
@media(max-width:1023px){.mg-row,.mg-row.r-mid,.mg-row.r-top{grid-template-columns:1fr}}
/* ตัวกรองผู้บริหาร: จังหวัด · อำเภอ · หมวด · ปฏิทิน */
.mgf-row{display:flex;flex-wrap:wrap;gap:12px;margin-top:12px;align-items:flex-end}
.mgf-f{display:flex;flex-direction:column;gap:4px;font-size:11.5px;font-weight:700;color:var(--muted)}
.mgf-f select,.mgf-f input{padding:8px 10px;border-radius:9px;border:var(--dropdown-border);background:var(--dropdown-bg);
  color:var(--dropdown-text);font-family:var(--font);font-size:12.5px;font-weight:600;min-width:150px;color-scheme:light}
.mgf-f select:disabled{opacity:.55;cursor:not-allowed}
.mgf-dd{min-width:175px}
/* เมนูอำเภอ/ตัวกรอง: แถวกระชับ · โชว์ ~7 แถวแล้วเลื่อนดูตัวเลือกที่ 8–25 · ไม่ยาวจนติดขอบจอ · ไม่ให้ tf-bar ตัดเมนูทิ้ง */
.mgf-row .uidd-pop{max-height:232px;padding:4px}
.mgf-row .uidd-opt{padding:6px 11px}
.tf-bar{overflow:visible;box-shadow:var(--shadow)}
/* เงาจางๆ ให้การ์ดกราฟ/ตารางในแดชบอร์ดผู้บริหาร */
.mg-rows .card{box-shadow:var(--shadow)}
/* ตามคำขอ: ซ่อนคำอธิบายสีเทาใต้หัวข้อการ์ด (คงไว้เฉพาะ legend + ตัวเลขในการ์ด KPI) */
.mg-rows .card .ch-sub{display:none}
/* ตามคำขอ: ตัวหนังสือ+ตัวเลขในทุกกล่องแดชบอร์ดผู้บริหารเป็นน้ำหนักปกติทั้งหมด (ไม่หนา) */
.tf-bar,.tf-bar *,.mg-kpi,.mg-kpi *,.mg-rows .card,.mg-rows .card *{font-weight:400!important}
.mgf-clear{display:inline-flex;align-items:center;gap:5px;padding:0 12px;height:35px;border-radius:9px;cursor:pointer;
  border:1px solid var(--stroke2);background:transparent;color:var(--accent-deep);font-family:var(--font);font-size:12px;font-weight:700}
.mgf-clear:hover{background:var(--accent-soft)}
/* breadcrumb เจาะลึก + empty state + แถวเต็มความกว้าง (drill-down) */
.mg-bc{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;
  padding:12px 16px;border-radius:var(--r);background:var(--accent-soft);border:1px solid rgba(230, 0, 35,.22)}
.mg-bc-info{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:13px;color:var(--txt)}
.mg-bc-unit{font-size:16px;font-weight:800;color:var(--txt)}
.mg-bc-rank{font-size:12px;font-weight:700;color:var(--muted);background:var(--surface);padding:3px 10px;border-radius:999px}
.mg-bc-sh{font-size:12.5px;color:var(--muted)}
.mg-bc-sh b.up{color:#0f7a3d}.mg-bc-sh b.down{color:#b30019}
.mg-bc-nav{display:flex;gap:8px;flex-wrap:wrap}
.mg-bc-btn{display:inline-flex;align-items:center;gap:5px;padding:7px 13px;border-radius:9px;cursor:pointer;
  border:1px solid var(--accent);background:var(--surface);color:var(--accent-deep);font-family:var(--font);font-size:12.5px;font-weight:700}
.mg-bc-btn:hover{background:var(--accent);color:#fff}
.mg-empty{display:flex;align-items:center;gap:9px;margin-bottom:16px;padding:14px 18px;border-radius:var(--r);
  background:var(--surface2);border:1px solid var(--stroke2);color:var(--txt);font-size:13.5px;font-weight:600}
.mg-row.r-full{grid-template-columns:1fr}
.mg-leadA{max-height:320px;overflow-y:auto}
/* KPI 4 ใบ · แถวบนเต็มความกว้าง */
.mg-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;margin-bottom:20px}
.mg-kpi{background:var(--panel);border:1px solid var(--stroke);border-radius:var(--radius-lg);padding:16px 17px;min-height:112px;
  display:flex;flex-direction:column;justify-content:flex-start;box-shadow:var(--shadow)}
.mg-kpi-hd{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px}
.mg-kpi-l{font-size:12px;color:var(--muted);font-weight:600;margin-bottom:0}
/* ไอคอนป้ายมุมการ์ด (สไตล์ ERP) — พื้นแดงจาง + ไอคอนเส้นสีแบรนด์ */
.mg-kpi-ic{width:40px;height:40px;flex:none;border-radius:var(--radius-md);display:grid;place-items:center;background:var(--accent-soft);color:var(--accent)}
.mg-kpi-hero .mg-kpi-ic{background:#fff}
/* ตัวเลข = พระเอก: ใหญ่สุด เด่นสุด · tabular-nums ให้เลขเรียงตรง */
.mg-kpi-v{font-size:30px;font-weight:700;color:var(--txt);line-height:1.05;font-variant-numeric:tabular-nums;margin-top:2px}
/* แนวโน้มการเติบโต ▲/▼ ใต้ตัวเลข KPI — น้ำหนักเบา ไม่มีพื้น/กรอบ */
.mg-kpi-d{margin-top:6px;font-size:12px;font-weight:600;display:flex;align-items:center;gap:3px;line-height:1.2}
.mg-kpi-d.up{color:#0f7a3d}.mg-kpi-d.down{color:var(--accent-deep)}.mg-kpi-d.flat{color:var(--muted);font-weight:500}
.mg-kpi-d span{color:var(--muted);font-weight:500;margin-left:3px}
.mg-kpi-spark{margin-top:4px}
/* การ์ด KPI เด่น (อัตราการเปลี่ยนเป็นลูกค้า) — แบนราบโทนเดียว: พื้นขาว ขอบซ้ายหนา 4px บอกสถานะ (ไม่มีพื้นสีใหญ่) */
/* การ์ดอัตราการเปลี่ยนเป็นลูกค้า — ตัดเส้นขอบซ้ายหนาออก ให้เหมือนการ์ดอื่น (ขอบ 1px สม่ำเสมอ) */
.mg-kpi-hero,.mg-kpi-hero.bad,.mg-kpi-hero.good,.mg-kpi-hero.flat{border-left-width:1px;border-left-color:var(--stroke)}
.mg-kpi-blue{color:var(--txt)}
/* ปุ่ม "ดูทั้งหมด" + scroll ในกล่อง + ตัวกำกับประเมินค่าเฉลี่ย */
.mg-more{display:flex;justify-content:flex-end;margin-top:10px}
.mg-more-btn{padding:5px 12px;border-radius:8px;border:1px solid var(--stroke2);background:var(--surface);color:var(--accent-deep,#b30019);font-family:var(--font);font-size:12px;font-weight:700;cursor:pointer}
.mg-more-btn:hover{border-color:var(--accent);background:var(--accent-soft)}
.mg-scroll{max-height:290px;overflow-y:auto;padding-right:4px}
.mg-tblwrap.mg-scroll{max-height:290px;overflow-y:auto}
.mg-est{color:var(--muted);font-weight:700;margin-left:3px}
.mg-note{font-size:11px;color:var(--muted);margin-top:9px;font-style:italic}
.mg-2col{display:grid;grid-template-columns:1fr 1fr;gap:20px}
/* แถวล่างฝั่งขวา: ตารางกว้างกว่านิด · ยุบเป็นคอลัมน์เดียวเมื่อพื้นที่แคบ */
.mg-bot2{grid-template-columns:minmax(0,1.6fr) minmax(0,1fr)}
@media(max-width:1279px){.mg-bot2{grid-template-columns:1fr}}
@media(max-width:600px){.mg-kpis{grid-template-columns:repeat(2,1fr)}.mg-2col{grid-template-columns:1fr}}
/* แท่งแนวนอน · เปอร์เซ็นต์ชิดขวาตรงคอลัมน์เดียวกัน */
.mg-hbars{display:flex;flex-direction:column;gap:11px}
.mg-hbar{display:grid;grid-template-columns:96px 1fr 42px;align-items:center;gap:10px}
.mg-hbar-l{font-size:12.5px;font-weight:600;color:var(--txt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mg-hbar-track{height:10px;border-radius:999px;background:var(--surface2);overflow:hidden}
.mg-hbar-fill{height:100%;border-radius:999px;transition:width .5s}
.mg-hbar-v{font-size:13px;font-weight:800;color:var(--txt);text-align:right}
/* ตาราง: หัวเทาอ่อน เส้นแถวบาง ตัวเลขชิดขวา */
.mg-tblwrap{overflow-x:auto}
.mg-tbl{width:100%;border-collapse:collapse;font-size:12.5px}
.mg-tbl thead th{background:var(--surface2);color:var(--muted);font-weight:700;font-size:11.5px;padding:9px 12px;border-bottom:1px solid var(--stroke);white-space:nowrap}
.mg-tbl td{padding:9px 12px;border-bottom:1px solid var(--stroke);white-space:nowrap}
.mg-tbl tbody tr:last-child td{border-bottom:none}
.mg-tbl .rt{text-align:right}
/* คำอธิบายสีของกราฟเส้น */
.mg-legend{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px;font-size:12px;color:var(--muted)}
.mg-legend i{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:6px;vertical-align:-1px}
/* สิ่งที่พบจากข้อมูล · 5 ใบ พื้นหลังอ่อนตามประเภท */
.mg-insights{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}
.mg-insight{border-radius:12px;padding:13px 12px;border:1px solid var(--stroke2);display:flex;flex-direction:column;gap:7px}
.mg-insight.bad,.mg-insight.warn{background:rgba(230, 0, 35,.07)}
.mg-insight.good,.mg-insight.info{background:rgba(100,116,139,.09)}
.mg-insight-ic{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;flex:none;align-self:center}
.mg-insight-t{font-size:12.5px;font-weight:700;color:var(--txt);line-height:1.35}
.mg-insight-b{font-size:11.5px;color:var(--muted);line-height:1.45}
@media(max-width:1200px){.mg-insights{grid-template-columns:repeat(3,1fr)}}
@media(max-width:640px){.mg-insights{grid-template-columns:repeat(2,1fr)}}
/* เติบโต/ชะลอตัว · แถบหัวสีอ่อน ตัวเลขชิดขวา */
.mg-seg-head{font-size:12px;font-weight:700;padding:6px 11px;border-radius:8px;margin-bottom:8px}
.mg-seg-head.up{background:rgba(51,214,159,.14);color:#0f7a3d}
.mg-seg-head.down{background:rgba(230, 0, 35,.1);color:var(--accent-deep)}
.mg-seg-row{display:flex;align-items:center;gap:10px;padding:7px 4px;border-bottom:1px solid var(--stroke);font-size:12.5px}
.mg-seg-l{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--txt)}
.mg-seg-n{font-weight:800;font-size:12px;text-align:right;white-space:nowrap}
.mg-seg-n.up{color:#0f7a3d}.mg-seg-n.down{color:var(--accent)}
`;

function syncRow(k,v){ return html`<div class="row between" style=${{padding:"10px 0",borderBottom:"1px solid var(--stroke)",fontSize:"13px"}}>
  <span class="muted">${k}</span><span class="mono" style=${{fontWeight:600}}>${v}</span></div>`; }
