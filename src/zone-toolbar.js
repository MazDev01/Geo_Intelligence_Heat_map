// ---------------------------------------------------------------------------
// zone-toolbar.js — แถบเครื่องมือแก้รูปโซน (โหมดแก้ไข) วางแทนแถบค้นหาด้านบน
//
// แนวคิดเดียวกับเครื่องมือ GIS (iD editor ของ OSM / Overture): เข้าโหมดแก้ไข
// แล้วแถบด้านบนเปลี่ยนเป็นเครื่องมือ ไม่ใช่กล่องลอยบังมุมแมพ
//
// ไฟล์นี้เป็นแค่ "หน้าตา" — ตรรกะทั้งหมดอยู่ใน zone-editor.js (ตัว ed ที่ส่งเข้ามา)
// เข้าโหมดนี้จาก: หน้าจัดการขอบเขตพื้นที่การขาย → ปุ่ม "แก้รูปโซนบนแผนที่"
// ---------------------------------------------------------------------------
import {html, useState, useEffect, useRef, Icon} from "./lib.js";
import {t, getLang} from "./i18n.js";
import {zonesSaveBlocked, zonesBlockedText, listZoneVersions, restoreZoneVersion} from "./zone-registry.js";
import {confirmBox} from "./confirm.js";

if(typeof document!=="undefined" && !document.getElementById("ztb-css")){
  const st=document.createElement("style"); st.id="ztb-css";
  st.textContent=`
/* ⚠ ห้ามใส่ flex-wrap:wrap ที่แถวเครื่องมือ — ตอนกด "เลือกโซน" มีปุ่ม รวม/ลบ โผล่เพิ่ม
   ถ้าห่อบรรทัด ปุ่มท้ายแถว (ใช้จริง) จะตกไปบรรทัดล่าง แถบสูงขึ้น ปุ่มขยับหนีมือ
   จึงบังคับบรรทัดเดียว ถ้าจอแคบให้เลื่อนแนวนอนแทนการห่อ */
.ztb{container-type:inline-size;position:relative;flex:1;min-width:0;
  display:flex;flex-direction:column;align-items:flex-start;gap:5px}
/* 1.12cqw ≈ 12.5px ที่กล่องกว้าง ~1,120px · แคบกว่านั้นย่อลงได้ถึง 9.5px · กว้างกว่าไม่โตเกิน 13px */
.ztb-row{font-size:clamp(9.5px, 1.12cqw, 13px);max-width:100%;
  background:var(--panel);border:1px solid var(--stroke2);border-radius:.92em;
  padding:.54em .77em;backdrop-filter:blur(14px);box-shadow:var(--shadow);
  display:inline-flex;align-items:center;gap:.5em;flex-wrap:nowrap;overflow-x:auto;overflow-y:hidden;
  scrollbar-width:thin;scrollbar-color:var(--stroke2) transparent}
.ztb-row>*{flex:none}
.ztb-row::-webkit-scrollbar{height:5px}
.ztb-row::-webkit-scrollbar-thumb{background:var(--stroke2);border-radius:3px}
.ztb-sep{width:1px;height:1.75em;background:var(--stroke2);flex:none}
/* ไอคอนก็ต้องย่อตาม — CSS ชนะ attribute width/height ที่คอมโพเนนต์ Icon ใส่มาเป็น px */
.ztb-row svg{width:1.2em;height:1.2em}
.ztb button{display:inline-flex;align-items:center;gap:.4em;height:2.56em;padding:0 .72em;border-radius:.64em;
  border:1px solid var(--stroke2);background:var(--surface);color:var(--txt);cursor:pointer;
  font-family:var(--font);font-size:1em;font-weight:600;white-space:nowrap}
.ztb button:hover:not(:disabled){background:var(--surface2);border-color:var(--muted)}
.ztb button:disabled{opacity:.45;cursor:default}
.ztb button.on{background:var(--accent);border-color:var(--accent);color:#fff}
.ztb .ztb-ico{width:2.56em;padding:0;justify-content:center;gap:.24em}
.ztb .ztb-ico:has(.ztb-n){width:auto;min-width:2.56em;padding:0 .6em}
.ztb .ztb-n{font-size:.88em;font-weight:700;line-height:1}
.ztb .ztb-exit{background:none;border-color:transparent;color:var(--muted)}
.ztb .ztb-exit:hover{color:var(--txt);background:var(--surface)}
.ztb .ztb-del{color:#b91c1c;border-color:#fca5a5}
.ztb .ztb-del:hover:not(:disabled){background:#b91c1c;border-color:#b91c1c;color:#fff}
/* โทนพาสเทล: พื้นอ่อน ตัวอักษรเข้ม — วัดค่าความต่างสีแล้ว เซฟร่าง 7.8:1 · ใช้จริง 6.8:1 (เกณฑ์อ่านออก 4.5:1) */
.ztb .ztb-save{background:#dbe9fb;border-color:#b9d3f4;color:#14418f}
.ztb .ztb-pub{background:#d9f0e3;border-color:#aedcc4;color:#0a5c2e}
/* ⚠ ปุ่มสีต้องมีกฎ hover ของตัวเอง — ไม่งั้นกฎ hover กลางด้านบนเปลี่ยนพื้นหลังเป็นสีอ่อน
   แต่ตัวอักษรยังเป็น #fff ที่ตั้งไว้ตรงนี้ กลายเป็นขาวบนอ่อน อ่านไม่ออกตอนชี้เมาส์ */
.ztb button.on:hover:not(:disabled){background:var(--accent);border-color:var(--accent);color:#fff;filter:brightness(1.08)}
.ztb .ztb-save:hover:not(:disabled){background:#c7dcf8;border-color:#8fb9ec;color:#14418f}
.ztb .ztb-pub:hover:not(:disabled){background:#c6e8d6;border-color:#8ccdae;color:#0a5c2e}
.ztb input,.ztb select{height:2.56em;border:1px solid var(--stroke2);border-radius:.64em;background:var(--surface);
  color:var(--txt);font-family:var(--font);font-size:1em;padding:0 .55em;min-width:0}
/* ⚠ <select> ของเบราว์เซอร์วาดพื้นเทาของตัวเองตอนชี้เมาส์/กดค้าง ทำให้ดูไม่เข้าชุดกับที่อื่นในระบบ
   ปิด appearance แล้ววาดลูกศรเอง ใช้โทนเดียวกับดรอปดาวน์ตัวอื่น (dropdown token) และ hover เหมือนปุ่ม */
.ztb select{appearance:none;-webkit-appearance:none;cursor:pointer;color-scheme:light;
  padding-right:1.9em;transition:.15s;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' fill='%239CA3AF'><path d='M0 2l5 6 5-6z'/></svg>");
  background-repeat:no-repeat;background-position:right .7em center}
.ztb select:hover:not(:disabled){background-color:var(--surface2);border-color:var(--muted)}
.ztb select option{background-color:var(--dropdown-bg);color:var(--dropdown-text)}
.ztb .ztb-id{width:5.9em}
.ztb .ztb-nm{width:8em}
/* ช่องเลือกสี: ให้เห็นเป็นแผ่นสีล้วน ไม่ใช่กล่อง input ของเบราว์เซอร์ */
.ztb input[type=color]{width:2.4em;padding:2px;cursor:pointer;background:var(--surface)}
.ztb input[type=color]::-webkit-color-swatch-wrapper{padding:0}
.ztb input[type=color]::-webkit-color-swatch{border:none;border-radius:4px}
/* แผงรายชื่อโซน — ห้อยใต้แถบเครื่องมือ (แถบต้องเป็นแถวเดียวเสมอ รายการยาวจึงต้องแยกแผง) */
.ztb-pop{position:absolute;top:calc(100% + 6px);z-index:20;min-width:270px;max-height:260px;overflow-y:auto;
  background:var(--panel);border:1px solid var(--stroke2);border-radius:12px;box-shadow:var(--shadow);padding:8px}
.ztb-pop h4{margin:2px 4px 7px;font-size:11.5px;font-weight:700;color:var(--muted);line-height:1.35}
.ztb-zrow{display:flex;align-items:center;gap:7px;padding:3px 2px}
.ztb-zrow input[type=text]{flex:1;min-width:0;height:28px;border:1px solid var(--stroke2);border-radius:7px;
  background:var(--surface);color:var(--txt);font-family:var(--font);font-size:12.5px;padding:0 7px}
.ztb-zrow .ztb-zid{font-size:11px;color:var(--dim);white-space:nowrap}
.ztb .ztb-join{min-width:4.6em;justify-content:center}
.ztb-gpop{min-width:150px;padding:5px}
.ztb-gopt{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 10px;border-radius:8px;
  cursor:pointer;font-size:12.5px;color:var(--txt);white-space:nowrap}
.ztb-gopt:hover,.ztb-gopt.hl{background:var(--surface2)}
.ztb-gopt.on{font-weight:600}
.ztb-gopt svg{color:var(--accent);flex:none}
.ztb-hpop{min-width:300px;max-width:min(420px,92vw)}
.ztb-hrow{display:flex;align-items:center;gap:9px;padding:6px 4px;border-top:1px solid var(--stroke)}
.ztb-htx{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.ztb-htx b{font-size:12.5px;font-weight:600}
.ztb-htx span{font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ztb-hrow button{height:28px;font-size:12px}
.ztb-hnone{padding:8px 4px;font-size:12px;color:var(--muted)}
/* ⚠ ต้องปิด outline ของเบราว์เซอร์เอง — ตอนเตือนเราโฟกัสช่องให้ Chrome จะวาดวงดำทับกรอบแดง
   จนเห็นแค่ตัวหนังสือแดง เลยทำวงโฟกัสเองทั้งสองสถานะ */
.ztb input:focus,.ztb select:focus{outline:none;border-color:var(--accent);
  box-shadow:0 0 0 2px color-mix(in oklab,var(--accent) 22%,transparent)}
.ztb .ztb-nm.bad,.ztb .ztb-nm.bad:focus{border:1.5px solid #dc2626;outline:none;
  box-shadow:0 0 0 3px rgba(220,38,38,.25)}
.ztb .ztb-nm.bad::placeholder{color:#dc2626}
.ztb .ztb-gap{max-width:9em}
.ztb-stat{font-size:.92em;color:var(--muted);white-space:nowrap}
.ztb-stat b{color:var(--txt)}
.ztb-dirty{color:var(--warn);font-weight:700}
.ztb-msg{font-size:11.5px;color:var(--muted);line-height:1.35;max-width:100%;
  background:var(--panel);border:1px solid var(--stroke2);border-radius:10px;padding:5px 10px;box-shadow:var(--shadow)}
.ztb-msg.bad{color:var(--bad)}
.ztb-msg.good{color:var(--good)}`;
  document.head.appendChild(st);
}

export function ZoneToolbar({ed, onExit}){
  const [, bump] = useState(0);
  const [msg, setMsg] = useState(null);          // {text, tone}
  const [busy, setBusy] = useState(false);
  const [znm, setZnm] = useState("");
  const [nmErr, setNmErr] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  // ⚠ แผงต้องเป็นลูกของ .ztb ไม่ใช่ของแถวเครื่องมือ เพราะแถวตั้ง overflow-x ไว้ (แผงจะโดนตัด)
  //    จึงวางไว้นอกแถวแล้วเลื่อนตำแหน่งเองให้ตรงใต้ปุ่ม "โซน"
  const zBtnRef = useRef(null);
  const [popLeft, setPopLeft] = useState(0);
  const toggleList = ()=>{
    const b=zBtnRef.current, row=b&&b.parentElement;
    if(b) setPopLeft(Math.max(0, b.offsetLeft - (row?row.scrollLeft:0)));
    setHistOpen(false); setGapOpen(false);
    setListOpen(v=>!v);
  };
  const hBtnRef = useRef(null);
  const [histOpen, setHistOpen] = useState(false);
  const [hist, setHist] = useState(null);
  const [histLeft, setHistLeft] = useState(0);
  const toggleHist = ()=>{
    const b=hBtnRef.current, row=b&&b.parentElement;
    if(b) setHistLeft(Math.max(0, b.offsetLeft - (row?row.scrollLeft:0)));
    setListOpen(false); setGapOpen(false);
    if(!histOpen){ setHist(null); listZoneVersions().then(v=>setHist(v.slice(0,20))); }
    setHistOpen(v=>!v);
  };
  const gBtnRef = useRef(null);
  const gPopRef = useRef(null);
  const [gapOpen, setGapOpen] = useState(false);
  const [gapLeft, setGapLeft] = useState(0);
  const [gapHl, setGapHl] = useState(-1);
  useEffect(()=>{ if(!gapOpen) return;
    const onDoc = e => { if(gBtnRef.current && gBtnRef.current.contains(e.target)) return;
      if(gPopRef.current && gPopRef.current.contains(e.target)) return; setGapOpen(false); };
    document.addEventListener("mousedown", onDoc); return ()=>document.removeEventListener("mousedown", onDoc); },[gapOpen]);
  const [newColor, setNewColor] = useState("#0ea5e9");   // สีของโซนที่กำลังจะวาด — เลือกเองได้ก่อนกดวาด     // ยังไม่ได้ใส่ชื่อ → กรอบแดงที่ช่อง ไม่ใช่ข้อความบรรทัดใหม่
  const [gap, setGap] = useState(0);        // 0 = ยังไม่ได้เลือกระยะ (กันลดหมุดโดยไม่ได้ตั้งใจ)
  const redraw = ()=>bump(n=>n+1);

  // คลิกเลือกโซนบนแมพไม่ผ่าน React จึงต้องให้ตัว editor เรียกกลับมาให้เรนเดอร์ใหม่
  useEffect(()=>{ if(!ed) return; ed.setPickHandler(()=>redraw()); return ()=>ed.setPickHandler(null); },[ed]);
  // เข้าโหมดวาดเกิดหลังโหลด Geoman เสร็จ (ไม่ใช่ตอนกดปุ่ม) ต้องให้ตัว editor เรียกกลับมาเรนเดอร์ใหม่
  useEffect(()=>{ if(!ed || !ed.setDrawHandler) return;
    ed.setDrawHandler(()=>redraw()); return ()=>ed.setDrawHandler(null); },[ed]);
  useEffect(()=>{ if(!ed || !ed.loadDraft) return;
    let live = true;
    ed.loadDraft().then(r=>{ if(live && r && r.loaded) redraw(); })
      .catch(e=>console.warn("[zone-toolbar] load draft", e));
    return ()=>{ live = false; }; },[ed]);

  // ⚠ ต้องมีปุ่มออกด้วย — ถ้าแมพยังไม่พร้อม แล้วแถบมีแต่ข้อความ แอดมินจะออกจากโหมดนี้ไม่ได้เลย
  if(!ed) return html`<div class="ztb"><div class="ztb-row">
    <button class="ztb-exit" onClick=${onExit}>
      <${Icon} name="chevron" size=${14} style=${{transform:"rotate(90deg)"}}/> ${t("ออก","Exit")}</button>
    <span class="ztb-stat">${t("กำลังเตรียมเครื่องมือ…","Preparing tools…")}</span>
  </div></div>`;

  const s = ed.summary();
  const noSave = zonesSaveBlocked();
  const splitParts = s.picking && s.picked.length===1 && ed.mergedParts ? ed.mergedParts(s.picked[0]) : [];
  const run = async (fn, okMsg)=>{
    setBusy(true); setMsg(null);
    try{
      const r = await fn();
      if(r && r.ok === false) setMsg({text:r.error, tone:"bad"});
      else if(okMsg) setMsg({text: typeof okMsg==="function" ? okMsg(r) : okMsg, tone:"good"});
    }catch(e){ setMsg({text:String(e && e.message || e), tone:"bad"}); }
    setBusy(false); redraw();
  };

  const GAPS = [100,200,300,500];
  const gapLabel = m => t("ห่าง","gap")+" "+m+" "+t("ม.","m");
  const openGap = ()=>{ const b=gBtnRef.current, row=b&&b.parentElement;
    if(b) setGapLeft(Math.max(0, b.offsetLeft - (row?row.scrollLeft:0)));
    setListOpen(false); setHistOpen(false);
    setGapHl(GAPS.findIndex(m=>String(m)===String(gap))); setGapOpen(true); };
  const toggleGap = ()=> gapOpen ? setGapOpen(false) : openGap();
  const pickGap = m => { setGapOpen(false); setGap(m);
    run(()=>ed.thin(m), r=>`${t("หมุดห่างอย่างน้อย","Minimum spacing")} ${m} ${t("ม. · เหลือ","m · now")} ${r.after} ${t("จุด (จาก","points (from")} ${r.before})`); };
  const onGapKey = e => {
    if(e.key==="Escape"){ if(gapOpen){ e.preventDefault(); setGapOpen(false); } return; }
    if(e.key==="ArrowDown" || e.key==="ArrowUp"){ e.preventDefault();
      if(!gapOpen){ openGap(); return; }
      setGapHl(h=>{ const n = h + (e.key==="ArrowDown" ? 1 : -1); return n<0 ? 0 : n>=GAPS.length ? GAPS.length-1 : n; }); return; }
    if(e.key==="Enter" || e.key===" "){ e.preventDefault();
      if(!gapOpen){ openGap(); return; }
      if(gapHl>=0 && gapHl<GAPS.length) pickGap(GAPS[gapHl]); }
  };
  const whenOf = v => { const m=/^(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z$/.exec(v||"");
    const d = m ? new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : null;
    return d && !isNaN(d) ? d.toLocaleString(getLang()==="en"?"en-GB":"th-TH", {dateStyle:"medium", timeStyle:"short"}) : String(v||""); };
  const zonesOfVer = v => { const z=Array.isArray(v.zones)?v.zones:[];
    return `${z.length} ${t("โซน","zones")}${z.length?": "+z.join(" · "):""}`; };
  const restore = async v => {
    const yes = await confirmBox({title:t("ย้อนไปใช้โซนชุดนี้?","Restore this set of zones?"), ok:t("ย้อนกลับ","Restore"),
      body:`${t("ใช้ถึง","In use until")} ${whenOf(v.version)} · ${zonesOfVer(v)}\n${t("โซนชุดปัจจุบันจะถูกเก็บเข้าประวัติ ไม่หาย","The current zones are kept in the history")}`
        +(ed.isDirty() ? "\n"+t("การแก้ที่ยังไม่เซฟจะหาย","Unsaved edits will be lost") : "")});
    if(!yes) return;
    setBusy(true); setMsg(null);
    const r = await restoreZoneVersion(v.version);
    if(!r.ok){ setBusy(false); setMsg({text:r.error, tone:"bad"}); return; }
    location.reload();
  };

  // รหัสโซนไม่ต้องกรอก — zone-editor สร้างให้เองจากชื่อ (หรือ Z1 Z2 … ถ้าชื่อเป็นภาษาไทย)
  const draw = async ()=>{
    const nm = znm.trim();
    // เตือนที่ตัวช่องเอง (กรอบแดง + โฟกัสให้พิมพ์ต่อได้ทันที) — ข้อความบรรทัดล่างทำให้แถบสูงขึ้น ปุ่มขยับ
    if(!nm){ setNmErr(true); document.querySelector(".ztb-nm")?.focus(); return; }
    setNmErr(false); setMsg(null);
    // ⚠ ห้ามตั้ง busy ระหว่างวาด — ต้องกดปุ่มย้อนจุดได้ระหว่างคลิกวางจุดทีละจุด
    //    ปุ่มอื่นปิดด้วย s.drawing แทน (ดูด้านล่าง)
    const p = ed.addByDraw({name:nm, color:newColor});          // เข้าโหมดวาดจริงตอน setDrawHandler ยิงกลับมา
    const r = await p;
    if(r && r.ok === false && r.error) setMsg({text:r.error, tone:"bad"});
    if(r && r.ok) setZnm("");
    redraw();
  };

  return html`<div class="ztb">
    <div class="ztb-row" role="toolbar" aria-label=${t("เครื่องมือแก้รูปโซน","Zone editing tools")}>
    <button class="ztb-exit" title=${t("ออกจากโหมดแก้ไข","Leave edit mode")}
      onClick=${async ()=>{ if(s.drawing) ed.cancelDraw();
        if(ed.isDirty() && !(await confirmBox({title:t("ยังไม่ได้เซฟการแก้","Unsaved changes"), ok:t("ออก","Leave"), danger:true,
          body:t("ออกตอนนี้การแก้ที่ยังไม่เซฟจะหาย","Leaving now discards your unsaved edits")}))) return; onExit(); }}>
      <${Icon} name="chevron" size=${14} style=${{transform:"rotate(90deg)"}}/> ${t("ออก","Exit")}</button>
    <span class="ztb-sep"></span>

    <button class=${s.editing?"on":""} disabled=${busy || s.drawing} onClick=${()=>run(()=> s.editing ? ed.disable() : ed.enable())}
      title=${t("ลากหมุดบนขอบโซนให้ทาบถนน","Drag boundary vertices onto the road")}>
      <${Icon} name="pin" size=${14}/> ${t("ลากขอบ","Drag edges")}</button>

    <button class=${s.picking?"on":""} disabled=${busy || s.drawing} onClick=${()=>run(()=>ed.setPickMode(!s.picking))}
      title=${t("คลิกเลือกโซนบนแมพเพื่อรวม","Click zones on the map to merge")}>
      <${Icon} name="layers" size=${14}/> ${t("เลือกโซน","Select zones")}</button>

    <!-- อยู่ในโหมดเลือกแล้วค่อยโผล่: รวม (ต้อง ≥2 โซน) · ลบ (≥1 โซน)
         ใช้การเลือกบนแมพชุดเดียวกัน ไม่ต้องมี dropdown แยกให้จำว่าโซนไหนชื่ออะไร -->
    ${s.picking && (splitParts.length ? html`<button class="ztb-join ztb-split" disabled=${busy || s.drawing}
      aria-label=${t("แยกโซนที่เคยรวมกลับเป็นโซนเดิม","Split a merged zone back into its original zones")}
      title=${t("แยกกลับเป็น: ","Split back into: ")+splitParts.map(p=>p.name).join(" · ")}
      onClick=${async ()=>{
        const id = s.picked[0], z = ed.zones().find(x=>x.zone_id===id);
        if(!(await confirmBox({title:t("แยกโซน ","Split zone ")+(z?z.name:id)+"?", ok:t("แยก","Split"),
          body:t("กลับเป็น ","Back into ")+splitParts.length+" "+t("โซนเดิม: ","original zones: ")+splitParts.map(p=>p.name).join(" · ")
            +"\n"+t("ขอบที่ลากหลังรวมจะกลับเป็นรูปก่อนรวม","Edges dragged after the merge go back to the shape before it")}))) return;
        run(()=>ed.split(id), r=>`${t("แยกแล้ว","Split")}: ${r.restored.join(" · ")}`);
      }}>
      ${t("แยก","Split")}</button>`
    : html`<button class="ztb-join" disabled=${busy || s.drawing || s.picked.length<2}
      aria-label=${t("รวมโซนที่เลือก","Merge the selected zones")}
      title=${t("เลือก 2 โซนขึ้นไปเพื่อรวม · เลือก 1 โซนที่เคยรวมเพื่อแยกกลับ","Pick 2 or more zones to merge · pick one merged zone to split it back")}
      onClick=${()=>run(()=>ed.merge(s.picked), r=>r.note)}>
      ${t("รวม","Merge")}${s.picked.length>0?` (${s.picked.length})`:""}</button>`)}

    ${s.picking && html`<button class="ztb-del ztb-ico" disabled=${busy || s.drawing || !s.picked.length}
      aria-label=${t("ลบโซนที่เลือก","Delete the selected zones")}
      title=${t("ลบโซนที่เลือก","Delete the selected zones")}
      onClick=${async ()=>{
        const names = s.picked.map(id=>{ const z=ed.zones().find(x=>x.zone_id===id); return z?z.name:id; });
        if(!(await confirmBox({title:t("ลบโซน ","Delete zone ")+names.join(" · ")+"?", ok:t("ลบ","Delete"), danger:true,
          body:t("ลูกค้าในโซนนี้จะกลายเป็นพื้นที่นอกโซน","Customers there fall back to the outside-zone area")}))) return;
        run(()=>{ for(const id of s.picked){ const r=ed.remove(id); if(r.ok===false) return r; } return {ok:true}; });
      }}>
      <${Icon} name="trash" size=${15}/>${s.picked.length>0?html`<b class="ztb-n">${s.picked.length}</b>`:null}</button>`}

    <span class="ztb-sep"></span>
    <input class=${"ztb-nm"+(nmErr?" bad":"")} value=${znm} placeholder=${t("ชื่อโซน","Zone name")}
      aria-invalid=${nmErr?"true":"false"}
      title=${nmErr ? t("ใส่ชื่อโซนก่อนจึงจะวาดได้","Enter a zone name before drawing") : t("ชื่อโซนใหม่","New zone name")}
      onInput=${e=>{ setZnm(e.target.value); if(nmErr) setNmErr(false); }}
      onKeyDown=${e=>{ if(e.key==="Enter") draw(); }}/>
    <input type="color" value=${newColor} disabled=${busy || s.drawing}
      title=${t("สีของโซนใหม่","Colour of the new zone")} aria-label=${t("สีของโซนใหม่","Colour of the new zone")}
      onInput=${e=>setNewColor(e.target.value)}/>
    <button disabled=${busy || s.drawing} onClick=${draw} title=${t("ตั้งชื่อแล้ววาดรูปโซนใหม่บนแมพ","Name it, then draw the new zone on the map")}>
      ${t("+ โซนใหม่","+ New zone")}</button>

    <button ref=${zBtnRef} class=${listOpen?"on":""} disabled=${busy || s.drawing} onClick=${toggleList}
      title=${t("รายชื่อโซน · เปลี่ยนสี/เปลี่ยนชื่อ","Zone list · change colour or name")}>
      <${Icon} name="grid" size=${14}/> ${t("โซน","Zones")}${s.zones?` (${s.zones})`:""}</button>

    <span class="ztb-sep"></span>
    <!-- เลือกระยะแล้วลดหมุดทันที — เดิมต้องเลือกแล้วกดปุ่มอีกที ทำให้เข้าใจผิดว่าเลือกแล้วไม่มีอะไรเกิดขึ้น
         ทุกตัวเลือกคิดจาก "รูปก่อนลดหมุด" เสมอ เลือกสลับไปมาได้ผลเท่าเดิมทุกครั้ง (ดู thin() ใน zone-editor) -->
    <button ref=${gBtnRef} class=${"ztb-gap"+(gapOpen?" on":"")} disabled=${busy || s.drawing} onClick=${toggleGap} onKeyDown=${onGapKey}
      aria-haspopup="listbox" aria-expanded=${gapOpen} title=${t("เลือกแล้วลดหมุดทันที","Applies as soon as you pick")}>
      <span>${String(gap)==="0" ? t("หมุดห่าง…","Spacing…") : gapLabel(gap)}</span>
      <${Icon} name="chevron" size=${13} style=${{transform:gapOpen?"rotate(180deg)":"none",transition:".15s"}}/></button>
    <!-- ลูกศรซ้าย/ขวา = ย้อน/ทำซ้ำ เหมือนเครื่องมือทั่วไป · จำนวนขั้นอยู่ใน tooltip ไม่รกบนปุ่ม -->
    <button class="ztb-ico" disabled=${busy || (!s.drawing && !s.undo)}
      onClick=${()=> s.drawing ? (ed.undoVertex(), redraw()) : run(()=>ed.undo())}
      aria-label=${s.drawing ? t("ย้อนจุดล่าสุด","Remove last point") : t("ย้อน","Undo")}
      title=${s.drawing ? t("ย้อนจุดล่าสุดที่วาง (Backspace)","Remove the last point (Backspace)")
                        : t("ย้อน 1 ขั้น","Undo")+(s.undo?` (${s.undo})`:"")}>
      <${Icon} name="undo" size=${15}/></button>
    <button class="ztb-ico" disabled=${busy || s.drawing || !s.redo} onClick=${()=>run(()=>ed.redo())}
      aria-label=${t("ทำซ้ำ","Redo")}
      title=${t("ทำซ้ำสิ่งที่เพิ่งย้อน","Redo")}${s.redo?` (${s.redo})`:""}>
      <${Icon} name="redo" size=${15}/></button>
    <button class="ztb-ico" disabled=${busy || s.drawing}
      aria-label=${t("ทิ้งการแก้ทั้งหมด","Discard all edits")} title=${t("ทิ้งการแก้ทั้งหมด กลับเป็นรูปตอนเปิดหน้า","Discard all edits and go back to the shape at page load")}
      onClick=${async ()=>{ if(await confirmBox({title:t("ทิ้งการแก้ทั้งหมด?","Discard all edits?"), ok:t("ทิ้ง","Discard"), danger:true,
        body:t("รูปโซนจะกลับเป็นตอนเปิดหน้า","Zones go back to the shape at page load")})) run(()=>ed.revert()); }}>
      <${Icon} name="refresh" size=${15}/></button>

    <button ref=${hBtnRef} class=${"ztb-hist"+(histOpen?" on":"")} disabled=${busy || s.drawing} onClick=${toggleHist}
      title=${t("โซนชุดก่อน ๆ ที่เคยใช้จริง · ย้อนกลับได้","Earlier published zones · restore one")}>
      ${t("ประวัติ","History")}</button>

    <span class="ztb-sep"></span>
    <button class="ztb-save" disabled=${busy || s.drawing || noSave} title=${noSave ? zonesBlockedText() : ""} onClick=${()=>run(()=>ed.saveDraft(),
      r=>`${t("เซฟร่างแล้ว","Draft saved")} · ${t("ยังไม่มีผลกับ TC จนมีคนอนุมัติ","no effect for TCs until approved")}`)}>
      ${t("เซฟร่าง","Save draft")}</button>
    <button class="ztb-pub" disabled=${busy || s.drawing || noSave} title=${noSave ? zonesBlockedText() : ""} onClick=${async ()=>{
      if(await confirmBox({title:t("ใช้โซนชุดนี้จริง?","Publish these zones?"), ok:t("ใช้จริง","Publish"),
        body:t("มีผลทันทีโดยไม่ผ่านการตรวจ\nTC และผู้บริหารจะเห็นเส้นใหม่เมื่อรีเฟรช",
               "Takes effect now without review\nTCs and Management see the new boundary on refresh")}))
        run(()=>ed.publish(), r=>`${t("ใช้จริงแล้ว","Published")}${r.archived?` · ${t("ฉบับเดิมเก็บเข้าประวัติ","previous version archived")}`:""}`); }}>
      ${t("ใช้จริง","Publish")}</button>
    </div>

    <!-- ตัวเลขสรุป (โซน/หมุด/KB) และข้อความผลลัพธ์ถูกถอดออกจากหน้าจอแล้ว — เป็นรายละเอียดภายใน
         ยังเขียนลง console ทุกครั้งจาก zone-editor.js สำหรับตรวจสอบ
         ⚠ เหลือไว้เฉพาะ "ข้อความผิดพลาด" — ถ้าเซฟไม่สำเร็จแล้วเงียบ แอดมินจะเข้าใจว่าเซฟแล้ว
            (สถานะยังไม่ได้เซฟย้ายไปเป็นคำถามยืนยันตอนกดออกแทน) -->
    ${listOpen && html`<div class="ztb-pop" style=${{left:popLeft+"px"}}>
      <h4>${t("โซนทั้งหมด — กดแผ่นสีเพื่อเปลี่ยนสี · พิมพ์ในช่องเพื่อเปลี่ยนชื่อ","All zones — click a swatch to recolour · type to rename")}</h4>
      ${ed.zones().map(z=>html`<div class="ztb-zrow" key=${z.zone_id}>
        <input type="color" value=${z.color||"#0ea5e9"} aria-label=${t("สีโซน","Zone colour")+" "+z.name}
          onInput=${e=>{ ed.recolor(z.zone_id, e.target.value); redraw(); }}/>
        <!-- ⚠ ใช้ defaultValue + บันทึกตอนออกจากช่อง ไม่ใช่ value+onChange
             React ยิง onChange ทุกตัวอักษร ระหว่างลบชื่อเก่าจะมีจังหวะที่ช่องว่าง = ขึ้น error "ต้องใส่ชื่อ" รัว ๆ -->
        <input type="text" defaultValue=${z.name} aria-label=${t("ชื่อโซน","Zone name")}
          onKeyDown=${e=>{ if(e.key==="Enter") e.target.blur(); }}
          onBlur=${e=>{ const v=e.target.value.trim();
            if(!v){ e.target.value=z.name; return; }                       // ลบจนว่างแล้วคลิกออก = คืนชื่อเดิม
            if(v===z.name) return;
            const r=ed.rename(z.zone_id, v);
            if(r && r.ok===false){ setMsg({text:r.error,tone:"bad"}); e.target.value=z.name; }
            redraw(); }}/>
        <span class="ztb-zid">${z.zone_id}</span>
      </div>`)}
      ${!ed.zones().length && html`<div class="ztb-stat" style=${{padding:"6px 4px"}}>${t("ยังไม่มีโซน","No zones yet")}</div>`}
    </div>`}
    ${gapOpen && html`<div ref=${gPopRef} class="ztb-pop ztb-gpop" role="listbox" style=${{left:gapLeft+"px"}}>
      ${GAPS.map((m,i)=>{ const cur = String(m)===String(gap); return html`<div key=${m} role="option" aria-selected=${cur}
        class=${"ztb-gopt"+(cur?" on":"")+(i===gapHl?" hl":"")} onMouseEnter=${()=>setGapHl(i)} onClick=${()=>pickGap(m)}>
        <span>${gapLabel(m)}</span>${cur ? html`<${Icon} name="check" size=${14}/>` : null}</div>`; })}
    </div>`}
    ${histOpen && html`<div class="ztb-pop ztb-hpop" style=${{left:histLeft+"px"}}>
      <h4>${t("โซนชุดก่อน ๆ ที่เคยใช้จริง","Earlier published zones")}</h4>
      ${hist===null ? html`<div class="ztb-hnone">${t("กำลังโหลด…","Loading…")}</div>`
        : !hist.length ? html`<div class="ztb-hnone">${t("ยังไม่มีประวัติ","No history yet")}</div>`
        : hist.map(v=>html`<div class="ztb-hrow" key=${v.version}>
            <div class="ztb-htx"><b>${t("ใช้ถึง","In use until")} ${whenOf(v.version)}</b><span title=${zonesOfVer(v)}>${zonesOfVer(v)}</span></div>
            <button disabled=${busy} onClick=${()=>restore(v)}>${t("ย้อนกลับ","Restore")}</button>
          </div>`)}
    </div>`}
    ${noSave && html`<div class="ztb-msg bad" data-zones-blocked="1">${zonesBlockedText()}</div>`}
    ${msg && msg.tone==="bad" && !(noSave && msg.text===zonesBlockedText()) && html`<div class="ztb-msg bad">${msg.text}</div>`}
  </div>`;
}
