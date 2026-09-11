// ═══════════════════════════════════════════════════════════════════════════
// src/i18n.js — สลับภาษา UI ทั้งระบบ (ไทย ↔ อังกฤษ) "ที่เดียว"
//
// วิธีทำงาน: แทนที่จะไล่แก้ข้อความไทยกว่า 1,800 จุดใน 32 ไฟล์ให้กลายเป็นคีย์
// ระบบนี้ดักที่ชั้น createElement (ดู html ใน lib.js) แล้วแปล "ข้อความที่กำลังจะเรนเดอร์"
// ข้อดี:
//   • ไฟล์หน้าจอทุกไฟล์เขียนข้อความไทยตรง ๆ ต่อไปได้ ไม่ต้องแก้ ไม่มีคีย์ให้หลุด
//   • ค่าที่ผ่าน useMemo มาแล้วก็ยังถูกแปล เพราะแปลตอนเรนเดอร์ ไม่ใช่ตอนคำนวณ
//   • สตริงที่ "ไม่มีในพจนานุกรม" จะถูกส่งผ่านเหมือนเดิม → ชื่อลูกค้า/ชื่อธุรกิจภาษาไทย
//     (ซึ่งเป็นข้อมูล ไม่ใช่ UI) ไม่มีทางถูกแปลผิด เพราะเทียบแบบตรงทั้งสตริงเท่านั้น
//
// ข้อจำกัดที่ต้องรู้: ข้อความที่ถูกประกอบเป็น HTML string แล้วยัดเข้า DOM เอง
// (เช่น popup ของ Leaflet) ไม่ผ่าน createElement — ที่นั่นต้องเรียก t() เองตรง ๆ
// ═══════════════════════════════════════════════════════════════════════════
import {EN} from "./i18n-en.js";

export const LANGS = [
  {code:"th", label:"ไทย",     english:"Thai"},
  {code:"en", label:"English", english:"English"},
];
const DICTS = {en:EN};
const KEY = "geoIntelLang";

let LANG = (()=>{ try{ const v = localStorage.getItem(KEY); return (v==="en"||v==="th") ? v : "th"; }
                  catch(e){ return "th"; } })();

export const getLang = () => LANG;
export const isTH    = () => LANG==="th";

// ผู้ติดตามการเปลี่ยนภาษา — App เรียก useLang() ไว้ที่ราก พอภาษาเปลี่ยนจึงเรนเดอร์ใหม่ทั้งต้นไม้
const subs = new Set();
export function onLangChange(fn){ subs.add(fn); return ()=>subs.delete(fn); }
export function setLang(code){
  if(code!=="th" && code!=="en") return;
  if(code===LANG) return;
  LANG = code;
  try{ localStorage.setItem(KEY, code); }catch(e){}
  try{ document.documentElement.lang = code; }catch(e){}
  _cache.clear();
  subs.forEach(fn=>{ try{ fn(code); }catch(e){} });
}
try{ document.documentElement.lang = LANG; }catch(e){}

// ── ตัวแปลสตริง ──────────────────────────────────────────────────────────────
// 1) เทียบตรงทั้งสตริง
// 2) เทียบโดยตัดช่องว่างหัวท้าย (คงช่องว่างเดิมไว้ในผลลัพธ์)
// 3) เทียบแพตเทิร์น สำหรับข้อความที่ประกอบจาก template literal:
//      {#} = ตัวเลข (เช่น "พบ {#} ราย")
//      {*} = ข้อความอะไรก็ได้ เช่น ชื่อจังหวัด/ชื่อหมวด ที่ถูกแทรกกลางประโยค
//    คีย์ที่ยาวกว่าถูกลองก่อน เพื่อไม่ให้แพตเทิร์นกว้าง ๆ คว้าประโยคของแพตเทิร์นที่เจาะจงกว่าไป
const PH = /\{[#*]\}/g;        // ใช้ตอนแทนค่ากลับเข้าข้อความผลลัพธ์ (ต้องเป็น global)
const HAS_PH = /\{[#*]\}/;     // ใช้ตอนคัดคีย์ — แยกตัวเพราะ regex แบบ global จำ lastIndex ข้ามการเรียก
const ESC = /[.*+?^${}()|[\]\\]/g;
const _cache = new Map();
const _patterns = new Map();   // lang -> [{re, out}]

function patternsFor(lang){
  if(_patterns.has(lang)) return _patterns.get(lang);
  const d = DICTS[lang] || {};
  const list = Object.keys(d)
    .filter(k=>HAS_PH.test(k))
    .sort((a,b)=>b.length-a.length)
    .map(k=>({
      re: new RegExp("^" + k.replace(ESC, "\\$&")
            .split("\\{#\\}").join("(\\d[\\d,]*(?:\\.\\d+)?)")
            .split("\\{\\*\\}").join("(.+?)") + "$"),
      out: d[k],
    }));
  _patterns.set(lang, list);
  return list;
}

function raw(s){
  const d = DICTS[LANG]; if(!d) return null;
  let hit = d[s];
  if(hit!=null) return hit;
  const trimmed = s.trim();
  if(trimmed!==s && trimmed){
    hit = d[trimmed];
    if(hit!=null){ const at = s.indexOf(trimmed[0]); return s.slice(0, at) + hit + s.slice(at+trimmed.length); }
  }
  for(const p of patternsFor(LANG)){
    const m = p.re.exec(trimmed);
    if(m){ let i=1; return p.out.replace(PH, ()=> m[i++] ?? ""); }
  }
  return null;
}

/** แปลข้อความหนึ่งชิ้น — คืนค่าเดิมเมื่อไม่พบในพจนานุกรม */
export function t(s){
  if(LANG==="th" || typeof s!=="string" || !s) return s;
  if(_cache.has(s)) return _cache.get(s);
  const out = raw(s) ?? s;
  _cache.set(s, out);
  return out;
}

// prop ที่เป็น "ข้อความให้คนอ่าน" เท่านั้น — ห้ามใส่ value/key/id/name/class ลงในชุดนี้
// เพราะค่าพวกนั้นถูกใช้เป็นสถานะของฟอร์มและคีย์ค้นหา แปลแล้วตรรกะพัง
export const TEXT_PROPS = new Set(["placeholder","title","alt","label","aria-label","aria-description",
  "aria-placeholder","aria-valuetext","data-label"]);

/** แปลลูก (children) ของ element — เดินลงอาร์เรย์ซ้อนได้ */
export function tNode(v){
  if(typeof v==="string") return t(v);
  if(Array.isArray(v)){ let changed=false; const out=v.map(x=>{ const y=tNode(x); if(y!==x) changed=true; return y; });
    return changed ? out : v; }
  return v;
}
