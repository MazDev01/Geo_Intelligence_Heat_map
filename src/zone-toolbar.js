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
import {t} from "./i18n.js";

if(typeof document!=="undefined" && !document.getElementById("ztb-css")){
  const st=document.createElement("style"); st.id="ztb-css";
  st.textContent=`
/* ⚠ ห้ามใส่ flex-wrap:wrap ที่แถวเครื่องมือ — ตอนกด "เลือกโซน" มีปุ่ม รวม/ลบ โผล่เพิ่ม
   ถ้าห่อบรรทัด ปุ่มท้ายแถว (ใช้จริง) จะตกไปบรรทัดล่าง แถบสูงขึ้น ปุ่มขยับหนีมือ
   จึงบังคับบรรทัดเดียว ถ้าจอแคบให้เลื่อนแนวนอนแทนการห่อ */
.ztb{position:relative;flex:1;min-width:0;display:flex;flex-direction:column;gap:5px;
  background:var(--panel);border:1px solid var(--stroke2);border-radius:12px;
  padding:7px 10px;backdrop-filter:blur(14px);box-shadow:var(--shadow)}
.ztb-row{display:flex;align-items:center;gap:6px;flex-wrap:nowrap;overflow-x:auto;overflow-y:hidden;
  scrollbar-width:thin;scrollbar-color:var(--stroke2) transparent}
.ztb-row>*{flex:none}
.ztb-row::-webkit-scrollbar{height:5px}
.ztb-row::-webkit-scrollbar-thumb{background:var(--stroke2);border-radius:3px}
.ztb-sep{width:1px;height:22px;background:var(--stroke2);flex:none}
.ztb button{display:inline-flex;align-items:center;gap:5px;height:32px;padding:0 9px;border-radius:8px;
  border:1px solid var(--stroke2);background:var(--surface);color:var(--txt);cursor:pointer;
  font-family:var(--font);font-size:12.5px;font-weight:600;white-space:nowrap}
.ztb button:hover:not(:disabled){background:var(--surface2);border-color:var(--muted)}
.ztb button:disabled{opacity:.45;cursor:default}
.ztb button.on{background:var(--accent);border-color:var(--accent);color:#fff}
.ztb .ztb-ico{width:32px;padding:0;justify-content:center;gap:3px}
.ztb .ztb-ico:has(.ztb-n){width:auto;min-width:32px;padding:0 8px}
.ztb .ztb-n{font-size:11px;font-weight:700;line-height:1}
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
.ztb input,.ztb select{height:32px;border:1px solid var(--stroke2);border-radius:8px;background:var(--surface);
  color:var(--txt);font-family:var(--font);font-size:12.5px;padding:0 7px;min-width:0}
.ztb .ztb-id{width:74px}
.ztb .ztb-nm{width:100px}
/* ช่องเลือกสี: ให้เห็นเป็นแผ่นสีล้วน ไม่ใช่กล่อง input ของเบราว์เซอร์ */
.ztb input[type=color]{width:30px;padding:2px;cursor:pointer;background:var(--surface)}
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
/* ⚠ ต้องปิด outline ของเบราว์เซอร์เอง — ตอนเตือนเราโฟกัสช่องให้ Chrome จะวาดวงดำทับกรอบแดง
   จนเห็นแค่ตัวหนังสือแดง เลยทำวงโฟกัสเองทั้งสองสถานะ */
.ztb input:focus,.ztb select:focus{outline:none;border-color:var(--accent);
  box-shadow:0 0 0 2px color-mix(in oklab,var(--accent) 22%,transparent)}
.ztb .ztb-nm.bad,.ztb .ztb-nm.bad:focus{border:1.5px solid #dc2626;outline:none;
  box-shadow:0 0 0 3px rgba(220,38,38,.25)}
.ztb .ztb-nm.bad::placeholder{color:#dc2626}
.ztb .ztb-gap{max-width:112px}
.ztb-stat{font-size:11.5px;color:var(--muted);white-space:nowrap}
.ztb-stat b{color:var(--txt)}
.ztb-dirty{color:var(--warn);font-weight:700}
.ztb-msg{font-size:11.5px;color:var(--muted);line-height:1.35}
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
    setListOpen(v=>!v);
  };
  const [newColor, setNewColor] = useState("#0ea5e9");   // สีของโซนที่กำลังจะวาด — เลือกเองได้ก่อนกดวาด     // ยังไม่ได้ใส่ชื่อ → กรอบแดงที่ช่อง ไม่ใช่ข้อความบรรทัดใหม่
  const [gap, setGap] = useState(0);        // 0 = ยังไม่ได้เลือกระยะ (กันลดหมุดโดยไม่ได้ตั้งใจ)
  const redraw = ()=>bump(n=>n+1);

  // คลิกเลือกโซนบนแมพไม่ผ่าน React จึงต้องให้ตัว editor เรียกกลับมาให้เรนเดอร์ใหม่
  useEffect(()=>{ if(!ed) return; ed.setPickHandler(()=>redraw()); return ()=>ed.setPickHandler(null); },[ed]);
  // เข้าโหมดวาดเกิดหลังโหลด Geoman เสร็จ (ไม่ใช่ตอนกดปุ่ม) ต้องให้ตัว editor เรียกกลับมาเรนเดอร์ใหม่
  useEffect(()=>{ if(!ed || !ed.setDrawHandler) return;
    ed.setDrawHandler(()=>redraw()); return ()=>ed.setDrawHandler(null); },[ed]);

  // ⚠ ต้องมีปุ่มออกด้วย — ถ้าแมพยังไม่พร้อม แล้วแถบมีแต่ข้อความ แอดมินจะออกจากโหมดนี้ไม่ได้เลย
  if(!ed) return html`<div class="ztb"><div class="ztb-row">
    <button class="ztb-exit" onClick=${onExit}>
      <${Icon} name="chevron" size=${14} style=${{transform:"rotate(90deg)"}}/> ${t("ออก","Exit")}</button>
    <span class="ztb-stat">${t("กำลังเตรียมเครื่องมือ…","Preparing tools…")}</span>
  </div></div>`;

  const s = ed.summary();
  const run = async (fn, okMsg)=>{
    setBusy(true); setMsg(null);
    try{
      const r = await fn();
      if(r && r.ok === false) setMsg({text:r.error, tone:"bad"});
      else if(okMsg) setMsg({text: typeof okMsg==="function" ? okMsg(r) : okMsg, tone:"good"});
    }catch(e){ setMsg({text:String(e && e.message || e), tone:"bad"}); }
    setBusy(false); redraw();
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
      onClick=${()=>{ if(s.drawing) ed.cancelDraw();
        if(ed.isDirty() && !confirm(t("ยังไม่ได้เซฟการแก้ ออกเลยไหม?","You have unsaved changes. Leave anyway?"))) return; onExit(); }}>
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
    ${s.picking && html`<button disabled=${busy || s.drawing || s.picked.length<2}
      aria-label=${t("รวมโซนที่เลือก","Merge the selected zones")}
      title=${t("รวมโซนที่เลือกเป็นโซนเดียว (ต้องเลือกอย่างน้อย 2 โซน)","Merge the selected zones into one (pick at least 2)")}
      onClick=${()=>run(()=>ed.merge(s.picked), r=>r.note)}>
      ${t("รวม","Merge")}${s.picked.length>0?` (${s.picked.length})`:""}</button>`}

    ${s.picking && html`<button class="ztb-del ztb-ico" disabled=${busy || s.drawing || !s.picked.length}
      aria-label=${t("ลบโซนที่เลือก","Delete the selected zones")}
      title=${t("ลบโซนที่เลือก","Delete the selected zones")}
      onClick=${()=>{
        const names = s.picked.map(id=>{ const z=ed.zones().find(x=>x.zone_id===id); return z?z.name:id; });
        if(!confirm(t("ลบโซน ","Delete zone ")+names.join(" · ")+t("?\nลูกค้าในโซนนี้จะกลายเป็นพื้นที่นอกโซน",
          "?\nCustomers there fall back to the outside-zone area"))) return;
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
    <select class="ztb-gap" disabled=${busy || s.drawing} value=${String(gap)} title=${t("เลือกแล้วลดหมุดทันที","Applies as soon as you pick")}
      onChange=${e=>{ const m=+e.target.value; setGap(m);
        run(()=>ed.thin(m), r=>`${t("หมุดห่างอย่างน้อย","Minimum spacing")} ${m} ${t("ม. · เหลือ","m · now")} ${r.after} ${t("จุด (จาก","points (from")} ${r.before})`); }}>
      ${[0,100,200,300,500].map(m=>html`<option key=${m} value=${String(m)} disabled=${m===0}>
        ${m===0 ? t("หมุดห่าง…","Spacing…") : t("ห่าง","gap")+" "+m+" "+t("ม.","m")}</option>`)}
    </select>
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
      onClick=${()=>{ if(confirm(t("ทิ้งการแก้ทั้งหมดกลับเป็นรูปตอนเปิดหน้า?","Discard all edits and go back to the shape at page load?"))) run(()=>ed.revert()); }}>
      <${Icon} name="refresh" size=${15}/></button>

    <span class="ztb-sep"></span>
    <button class="ztb-save" disabled=${busy || s.drawing} onClick=${()=>run(()=>ed.saveDraft(),
      r=>`${t("เซฟร่างแล้ว","Draft saved")} · ${t("ยังไม่มีผลกับ TC จนมีคนอนุมัติ","no effect for TCs until approved")}`)}>
      ${t("เซฟร่าง","Save draft")}</button>
    <button class="ztb-pub" disabled=${busy || s.drawing} onClick=${()=>{
      if(confirm(t("ใช้จริงทันทีโดยไม่ผ่านการตรวจ?\nTC และผู้บริหารจะเห็นเส้นใหม่ทันทีที่รีเฟรช",
                   "Publish now without review?\nTCs and Management will see the new boundary on refresh")))
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
    ${msg && msg.tone==="bad" && html`<div class="ztb-msg bad">${msg.text}</div>`}
  </div>`;
}
