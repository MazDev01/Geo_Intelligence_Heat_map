// ─────────────────────────────────────────────────────────────────────────────
// i18n — สลับภาษา ไทย/อังกฤษ ทั้งแอป
//
// วิธีใช้: เขียนสองภาษาไว้ตรงจุดที่ใช้เลย ไม่มี dictionary แยกไฟล์
//     ${t("แดชบอร์ด","Dashboard")}          ← ข้อความใน html`...`
//     title=${t("ตัวกรอง","Filters")}        ← attribute / ค่าใน JS
//
// ภาษาปัจจุบันเก็บที่ระดับโมดูล (อ่านเร็ว เรียกได้จากทุกที่ รวมถึงโค้ดที่ไม่ใช่ React
// เช่น Leaflet popup / canvas / ตัวจัดรูปแบบวันที่) และ persist ลง localStorage
//
// การ re-render: App เรียก useLang() หนึ่งที่ → setLang() แจ้ง subscriber → App re-render
// ทั้งต้นไม้ (ไม่มี React.memo ในโปรเจกต์นี้) ทุก t() จึงอ่านค่าใหม่พร้อมกัน
//
// ⚠ ไฟล์นี้ต้องไม่ import อะไรเลย — โดยเฉพาะ react
//   mock/geoData.js เรียก t() และถูก import จาก gen.mjs ที่รันบน Node (ไม่มี react / ไม่มี importmap)
//   ตัว hook useLang() จึงไปอยู่ที่ lib.js ซึ่งเป็นฝั่งเบราว์เซอร์ล้วนแทน
//   ทุกการอ้าง localStorage / document / location ถูกครอบ try/catch ไว้ ใช้บน Node ได้เงียบ ๆ
// ─────────────────────────────────────────────────────────────────────────────

const KEY = "geointel_lang";
const LANGS = ["th", "en"];

function initial(){
  // ?lang=en ใน URL ชนะค่าที่จำไว้ — ใช้ส่งลิงก์ภาษาอังกฤษ และใช้ตรวจหน้าแบบ headless
  try{
    const q = new URLSearchParams(location.search).get("lang");
    if(LANGS.includes(q)) return q;
  }catch(e){}
  try{
    const v = localStorage.getItem(KEY);
    if(LANGS.includes(v)) return v;
  }catch(e){}   // localStorage ถูกปิด (private mode / iframe) — ใช้ค่าตั้งต้น
  return "th";
}

let cur = initial();
const subs = new Set();

/* ภาษาปัจจุบัน — "th" | "en" */
export const getLang = () => cur;
export const isEN = () => cur === "en";

/* แปลข้อความ: t("ไทย","English") — ถ้าไม่ส่ง en มาก็คืนไทย (ยังไม่ได้แปล) */
export const t = (th, en) => (cur === "en" && en != null) ? en : th;

/* เลือกค่าตามภาษา สำหรับค่าที่ไม่ใช่สตริง (array/object/ตัวเลข) */
export const pick = (th, en) => (cur === "en" && en !== undefined) ? en : th;

export function setLang(lang){
  if(!LANGS.includes(lang) || lang === cur) return;
  cur = lang;
  try{ localStorage.setItem(KEY, lang); }catch(e){}
  try{ document.documentElement.lang = lang; }catch(e){}
  subs.forEach(fn => fn(lang));
}

export const toggleLang = () => setLang(cur === "th" ? "en" : "th");

/* subscribe แบบดิบ — สำหรับโค้ดนอก React (แผนที่ Leaflet ที่ต้อง rebuild label layer) */
export function subscribeLang(fn){
  subs.add(fn);
  return () => subs.delete(fn);
}

/* hook useLang() อยู่ที่ src/lib.js — ที่นี่ import react ไม่ได้ (ดูหมายเหตุหัวไฟล์) */

// ตั้ง lang ของเอกสารให้ตรงกับค่าที่โหลดมาตั้งแต่เฟรมแรก (index.html ฝัง lang="en" ไว้)
try{ document.documentElement.lang = cur; }catch(e){}
