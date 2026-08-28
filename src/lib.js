import React, {useState, useEffect, useRef, useMemo, useCallback, createContext, useContext} from "react";
import {createRoot} from "react-dom/client";
import htm from "htm";
import {SEGMENTS, SEG_COLOR, SEG_ICON, SEG_SVG, SEG_TH, DISTRICT_TH as GEO_DISTRICT_TH} from "./mock/geoData.js";   // 12 เซกเมนต์ + ชื่ออำเภอ จากแหล่งข้อมูลเดียว
export {React, useState, useEffect, useRef, useMemo, useCallback, createContext, useContext, createRoot};
export const html = htm.bind(React.createElement);

/* ---------------- วันที่/เวลา — ที่เดียวของทั้งระบบ ----------------
   ก่อนหน้านี้มีตัวแปลงวันที่ 9 ตัวกระจายใน 7 ไฟล์ ครึ่งหนึ่งอ่านค่าแบบ UTC อีกครึ่งใช้เวลาเครื่อง
   ทำให้ข้อมูลชุดเดียวกันแสดงคนละวันได้ (ไทยเป็น UTC+7 · timestamp หลัง 17:00 UTC = ข้ามวันแล้ว)
   ที่นี่ล็อกฐานเวลาเป็น Asia/Bangkok เสมอ ไม่ว่าเครื่องผู้ใช้จะตั้งโซนอะไร และใช้ปี พ.ศ. ทุกที่

   รับได้ทั้ง 2 แบบ:
     • สตริงไม่มีโซนเวลา  "2026-07-11" / "2026-07-11 09:12"  → ถือว่าเป็นเวลาไทยอยู่แล้ว อ่านตรง ๆ
     • ISO ที่มีโซนเวลา   "2026-07-11T18:00:00.000Z"          → แปลงเป็นเวลาไทยก่อนค่อยอ่าน       */
export const TH_MONTHS = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const _NAIVE = /^(d{4})-(d{2})-(d{2})(?:[ T](d{2}):(d{2}))?$/;   // ไม่มี Z / ไม่มี offset
const BKK_OFFSET = 7*3600e3;
/* คืน Date ที่ "อ่านด้วย getUTC* แล้วได้เวลาไทย" — null ถ้าค่าใช้ไม่ได้ */
function bkk(v){
  if(v==null || v==="") return null;
  if(typeof v==="string"){
    const m = _NAIVE.exec(v.trim());
    if(m) return new Date(Date.UTC(+m[1], +m[2]-1, +m[3], +(m[4]||0), +(m[5]||0)));
  }
  const t = (v instanceof Date) ? v.getTime() : Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t + BKK_OFFSET);
}
const pad2 = n => String(n).padStart(2,"0");
/* "11 ก.ค. 2569" */
export const thDate = v => { const d=bkk(v); return d ? d.getUTCDate()+" "+TH_MONTHS[d.getUTCMonth()]+" "+(d.getUTCFullYear()+543) : "—"; };
/* "09:12" (24 ชม.) */
export const thTime = v => { const d=bkk(v); return d ? pad2(d.getUTCHours())+":"+pad2(d.getUTCMinutes()) : "—"; };
/* "11 ก.ค. 2569 09:12" */
export const thDateTime = v => { const d=bkk(v); return d ? thDate(v)+" "+thTime(v) : "—"; };
/* "ส.ค. 69" (short) หรือ "ส.ค. 2569" — รับ "2026-08" หรือค่าที่แปลงเป็นวันที่ได้ */
export const thMonth = (v, short=true) => {
  let y,mo;
  if(typeof v==="string" && /^d{4}-d{2}$/.test(v.trim())){ const [a,b]=v.trim().split("-"); y=+a; mo=+b-1; }
  else { const d=bkk(v); if(!d) return "—"; y=d.getUTCFullYear(); mo=d.getUTCMonth(); }
  const be = y+543;
  return TH_MONTHS[mo]+" "+(short ? String(be).slice(-2) : be);
};
/* วันนี้ตามเวลาไทย ในรูป "YYYY-MM-DD" — ใช้กับ <input type="date"> และค่าที่เก็บลงข้อมูล */
export const todayBKK = () => { const d=new Date(Date.now()+BKK_OFFSET);
  return d.getUTCFullYear()+"-"+pad2(d.getUTCMonth()+1)+"-"+pad2(d.getUTCDate()); };

/* ---------------- formatting ---------------- */
export const num = n => (n==null?"—":Number(n).toLocaleString("en-US"));
export const compact = n => {
  n = Number(n)||0;
  if(Math.abs(n)>=1e9) return (n/1e9).toFixed(1).replace(/\.0$/,"")+"B";
  if(Math.abs(n)>=1e6) return (n/1e6).toFixed(1).replace(/\.0$/,"")+"M";
  if(Math.abs(n)>=1e3) return (n/1e3).toFixed(1).replace(/\.0$/,"")+"k";
  return ""+n;
};
// (เดิมมี money() / moneyC() จัดรูปแบบเงินบาท — ถอดออกแล้ว: ไม่มีตัวชี้วัดเชิงเงินในระบบอีก
//  ข้อมูลลูกค้าจริงจาก Barter ไม่มียอดขาย ทุกตัวชี้วัดจึงเป็น "จำนวนราย" ทั้งหมด)
export const pct = n => (n==null?"—":Math.round(n)+"%");
export const cx = (...a)=>a.filter(Boolean).join(" ");

// 12 เซกเมนต์ + สี/ไอคอน/ชื่อไทย — re-export จาก geoData (นำเข้าไว้บนสุดแล้ว)
export {SEGMENTS, SEG_COLOR, SEG_ICON, SEG_SVG, SEG_TH};
// customer status colours (the ONLY thing colour encodes)
export const STATUS_COLOR = {Existing:"#1565C0", Prospect:"#64B5F6"};

/* ---------------- Thai localization for data values ---------------- */
// (เดิมมี TYPE_TH / TRADING_TH — ถอดออกแล้ว: ข้อมูลลูกค้าจริงจาก Barter ไม่มีคอลัมน์
//  "ประเภทธุรกิจ" และ "สถานะการค้า" จึงไม่มีอะไรให้แปลอีก · หมวดธุรกิจใช้ SEG_TH แทน)
export const GAP_TH = {High:"สูง", Medium:"ปานกลาง", Low:"ต่ำ"};
// ── บทบาทในระบบ (canonical) — มี 3 บทบาทเท่านั้น: ผู้ดูแลระบบ / ผู้บริหาร / ผู้ประสานงานการค้า (TC) ──
// เดิมมีบทบาท "ผู้ใช้ธุรกิจ (Business User)" ถูกยกเลิก — ความสามารถภาคสนามย้ายไปเป็น TC (ผูกจังหวัดที่รับผิดชอบ)
export const ROLES = { ADMIN:"Administrator", MANAGEMENT:"Management", TC:"Trade Coordinator" };
export const ROLE_TH = {Administrator:"ผู้ดูแลระบบ", Management:"ผู้บริหาร", "Trade Coordinator":"ผู้ประสานงานการค้า (TC)"};
export const COUNTRY_TH = {Thailand:"ไทย", Vietnam:"เวียดนาม", Malaysia:"มาเลเซีย", Singapore:"สิงคโปร์",
  Indonesia:"อินโดนีเซีย", Philippines:"ฟิลิปปินส์", Myanmar:"เมียนมา", Cambodia:"กัมพูชา",
  India:"อินเดีย", Japan:"ญี่ปุ่น", Australia:"ออสเตรเลีย"};
export const PROVINCE_TH = {
  "Amnat Charoen":"อำนาจเจริญ","Ang Thong":"อ่างทอง","Bangkok Metropolis":"กรุงเทพมหานคร","Bueng Kan":"บึงกาฬ",
  "Buri Ram":"บุรีรัมย์","Chachoengsao":"ฉะเชิงเทรา","Chai Nat":"ชัยนาท","Chaiyaphum":"ชัยภูมิ","Chanthaburi":"จันทบุรี",
  "Chiang Mai":"เชียงใหม่","Chiang Rai":"เชียงราย","Pattaya":"ชลบุรี","Chumphon":"ชุมพร","Kalasin":"กาฬสินธุ์",
  "Kamphaeng Phet":"กำแพงเพชร","Kanchanaburi":"กาญจนบุรี","Khon Kaen":"ขอนแก่น","Krabi":"กระบี่","Lampang":"ลำปาง",
  "Lamphun":"ลำพูน","Loei":"เลย","Lop Buri":"ลพบุรี","Mae Hong Son":"แม่ฮ่องสอน","Maha Sarakham":"มหาสารคาม",
  "Mukdahan":"มุกดาหาร","Nakhon Nayok":"นครนายก","Nakhon Pathom":"นครปฐม","Nakhon Phanom":"นครพนม",
  "Nakhon Ratchasima":"นครราชสีมา","Nakhon Sawan":"นครสวรรค์","Nakhon Si Thammarat":"นครศรีธรรมราช","Nan":"น่าน",
  "Narathiwat":"นราธิวาส","Nong Bua Lam Phu":"หนองบัวลำภู","Nong Khai":"หนองคาย","Nonthaburi":"นนทบุรี",
  "Pathum Thani":"ปทุมธานี","Pattani":"ปัตตานี","Phangnga":"พังงา","Phatthalung":"พัทลุง","Phayao":"พะเยา",
  "Phetchabun":"เพชรบูรณ์","Phetchaburi":"เพชรบุรี","Phichit":"พิจิตร","Phitsanulok":"พิษณุโลก",
  "Phra Nakhon Si Ayutthaya":"พระนครศรีอยุธยา","Phrae":"แพร่","Phuket":"ภูเก็ต","Prachin Buri":"ปราจีนบุรี",
  "Prachuap Khiri Khan":"ประจวบคีรีขันธ์","Ranong":"ระนอง","Ratchaburi":"ราชบุรี","Rayong":"ระยอง","Roi Et":"ร้อยเอ็ด",
  "Sa Kaeo":"สระแก้ว","Sakon Nakhon":"สกลนคร","Samut Prakan":"สมุทรปราการ","Samut Sakhon":"สมุทรสาคร",
  "Samut Songkhram":"สมุทรสงคราม","Saraburi":"สระบุรี","Satun":"สตูล","Si Sa Ket":"ศรีสะเกษ","Sing Buri":"สิงห์บุรี","Songkhla":"สงขลา",
  "Sukhothai":"สุโขทัย","Suphan Buri":"สุพรรณบุรี","Surat Thani":"สุราษฎร์ธานี","Surin":"สุรินทร์","Tak":"ตาก",
  "Trang":"ตรัง","Trat":"ตราด","Ubon Ratchathani":"อุบลราชธานี","Udon Thani":"อุดรธานี","Uthai Thani":"อุทัยธานี",
  "Uttaradit":"อุตรดิตถ์","Yala":"ยะลา","Yasothon":"ยโสธร"
};
export const provinceTH = p => PROVINCE_TH[p]||p;
// ชื่ออำเภอ/เขต ภาษาไทย — ใช้จากแหล่งข้อมูลเดียว (src/mock/geoData.js) ครอบคลุม 4 จังหวัด
export const DISTRICT_TH = GEO_DISTRICT_TH;
export const districtTH = d => DISTRICT_TH[d]||d;
export const segTH = s => SEG_TH[s]||s;
export const gapTH = g => GAP_TH[g]||g;
export const roleTH = r => ROLE_TH[r]||r;
export const countryTH = c => COUNTRY_TH[c]||c;

/* ---------------- icons (24x24 stroke) ---------------- */
const P = {
  dashboard:"M3 13h8V3H3v10Zm10 8h8V3h-8v18ZM3 21h8v-6H3v6Z",
  globe:"M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c-3 3-3 15 0 18m0-18c3 3 3 15 0 18M3 12h18",
  map:"M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14",
  area:"M4 4h16v16H4zM4 10h16M10 4v16",
  user:"M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0",
  reports:"M6 2h9l5 5v15H6zM14 2v6h6M9 13h6M9 17h6M9 9h2",
  profile:"M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0",
  users:"M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 8a6 6 0 0 1 12 0m2-8a3.5 3.5 0 1 0-1-.15M21 19a6 6 0 0 0-5-5.9",
  integration:"M4 7h6v6H4zM14 11h6v6h-6zM10 10h4M12 13v-3",
  config:"M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.5-3-.9-.5.4-1.7-1.6-1.6-1.7.4-.5-.9h-2.4l-.5.9-1.7-.4-1.6 1.6.4 1.7-.9.5v2.4l.9.5-.4 1.7 1.6 1.6 1.7-.4.5.9h2.4l.5-.9 1.7.4 1.6-1.6-.4-1.7.9-.5Z",
  audit:"M9 4h6l1 3H8l1-3ZM6 7h12v13H6zM9 12h6M9 16h4",
  monitor:"M3 5h18v11H3zM8 21h8m-4-5v5M7 11l2.5-3 2 2L15 6",
  search:"M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm10 3-5-5",
  bell:"M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6ZM10 21a2 2 0 0 0 4 0",
  chevron:"M6 9l6 6 6-6",
  chevronR:"M9 6l6 6-6 6",
  layers:"M12 3 2 8l10 5 10-5-10-5ZM2 13l10 5 10-5M2 18l10 5 10-5",
  filter:"M3 5h18l-7 8v6l-4-2v-4L3 5Z",
  route:"M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm12-10a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM8 17h6a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h5",
  target:"M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-3a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  trend:"M3 17l6-6 4 4 8-8M15 7h6v6",
  download:"M12 3v12m0 0 4-4m-4 4-4-4M4 21h16",
  upload:"M12 17V5m0 0 4 4m-4-4-4 4M4 21h16",
  pdf:"M6 2h9l5 5v15H6zM14 2v6h6M9 13h6M9 17h4",
  excel:"M6 2h9l5 5v15H6zM14 2v6h6M9 12l5 6m0-6-5 6",
  print:"M7 8V3h10v5M7 18H4v-8h16v8h-3M7 14h10v6H7z",
  close:"M6 6l12 12M18 6 6 18",
  plus:"M12 5v14M5 12h14",
  edit:"M4 20h4l10-10-4-4L4 16v4ZM14 6l4 4",
  trash:"M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13",
  key:"M14 7a4 4 0 1 1-5 5l-6 6v3h3l1-1v-2h2v-2h2l1-1a4 4 0 0 0 2-8Z",
  check:"M4 12l5 5L20 6",
  logout:"M15 4h4v16h-4M14 12H3m0 0 4-4m-4 4 4 4",
  bolt:"M13 2 4 14h6l-1 8 9-12h-6l1-6Z",
  pin:"M12 22s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12Zm0-9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  star:"M12 3l2.9 6 6.1.9-4.5 4.3 1.1 6.1L12 17.8 6.4 20.3l1.1-6.1L3 9.9 9.1 9 12 3Z",
  db:"M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3Zm8 3v12c0 1.7-3.6 3-8 3s-8-1.3-8-3V6m16 6c0 1.7-3.6 3-8 3s-8-1.3-8-3",
  server:"M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01",
  api:"M8 3v4M16 3v4M4 9h16M6 9v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9M10 14l2 2 4-4",
  grid:"M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  clock:"M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-14v5l3 2",
  shield:"M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z",
  building:"M4 21V5l8-3 8 3v16M4 21h16M9 9h.01M15 9h.01M9 13h.01M15 13h.01M9 17h.01M15 17h.01",
  money:"M12 3v18M7 7h7a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h8",
  coverage:"M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18",
  gap:"M8 3v18M16 3v18M3 8h4m10 0h4M3 16h4m10 0h4",
  refresh:"M20 11a8 8 0 1 0-1 4m1 5v-5h-5",
  eye:"M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  info:"M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 8h.01M11 11h1v5h1",
  arrowLeft:"M19 12H5m0 0 7 7m-7-7 7-7",
  copy:"M9 9h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1ZM5 15H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1",
  sun:"M12 3v2m0 14v2M5.6 5.6l1.4 1.4m10 10 1.4 1.4M3 12h2m14 0h2M5.6 18.4l1.4-1.4m10-10 1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
  moon:"M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z",
};
export function Icon({name, size=18, color, stroke=2, style}){
  return html`<svg width=${size} height=${size} viewBox="0 0 24 24" fill="none"
    stroke=${color||"currentColor"} stroke-width=${stroke} stroke-linecap="round" stroke-linejoin="round" style=${style}>
    <path d=${P[name]||P.grid}/></svg>`;
}
// ── ระบบไอคอนหมวดธุรกิจ (outline lucide) — สืบสีจาก currentColor, fallback = "Other" เสมอ (ไม่ปล่อยว่าง/error) ──
export const segKey = seg => (seg && SEG_SVG[seg]) ? seg : "Other";
export function SegmentIcon({seg, size=18, color, stroke=2, title, style}){
  const k=segKey(seg);
  return html`<svg width=${size} height=${size} viewBox="0 0 24 24" fill="none"
    stroke=${color||"currentColor"} stroke-width=${stroke} stroke-linecap="round" stroke-linejoin="round"
    role=${title?"img":undefined} aria-hidden=${title?undefined:"true"} aria-label=${title||undefined}
    style=${style} dangerouslySetInnerHTML=${{__html:SEG_SVG[k]}}/>`;
}
// สตริง <svg> สำเร็จรูปสำหรับบริบท HTML ล้วน (Leaflet divIcon / popup / cluster ที่ไม่ใช่ React)
export function segIconSVG(seg, {size=18, color="currentColor", stroke=2}={}){
  const k=segKey(seg);
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" `
    + `stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SEG_SVG[k]}</svg>`;
}
// ป้ายหมวดธุรกิจสำหรับตาราง/การ์ด: ไอคอน + ชื่อไทย (token design-system: bg สำรอง / เส้นขอบ / มุมโค้งเล็ก)
export function SegmentBadge({seg, size=15, style}){
  const k=segKey(seg);
  return html`<span style=${{display:"inline-flex",alignItems:"center",gap:"6px",padding:"3px 9px 3px 7px",
    borderRadius:"var(--radius-sm)",background:"var(--surface2)",border:"1px solid var(--stroke)",
    fontSize:"12.5px",color:"var(--txt)",fontWeight:600,lineHeight:1.2,whiteSpace:"nowrap",...(style||{})}}>
    <${SegmentIcon} seg=${k} size=${size} color="var(--muted)"/><span>${segTH(k)}</span></span>`;
}
export const brandMark = (s=19)=>html`<svg width=${s} height=${s} viewBox="0 0 24 24" fill="none">
  <path d="M12 2C7 8 7 14 12 22 17 14 17 8 12 2Z" fill="#04121a"/>
  <circle cx="12" cy="9" r="2.6" fill="#eafff9"/></svg>`;

// เรียก OSRM public demo server เพื่อวาดเส้นทางตามถนนจริง (ไม่ต้องสมัคร API key) — ใช้เฉพาะสำหรับเดโม
// เพราะเซิร์ฟเวอร์นี้ไม่รับประกัน uptime/latency ตามนโยบายการใช้งานของโปรเจกต์ OSRM เอง
// คืน null เมื่อเรียกไม่สำเร็จ ให้ผู้เรียกใช้ fallback เป็นเส้นตรงเดิมเอง
export async function fetchDrivingRoute(points){
  if(!points || points.length<2) return null;
  try{
    const coords = points.map(([lat,lng])=>`${lng},${lat}`).join(";");
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
    const ctrl = new AbortController();
    const timeout = setTimeout(()=>ctrl.abort(), 5000);
    const res = await fetch(url, {signal:ctrl.signal});
    clearTimeout(timeout);
    if(!res.ok) return null;
    const data = await res.json();
    if(data.code!=="Ok" || !data.routes || !data.routes[0]) return null;
    return data.routes[0].geometry.coordinates.map(([lng,lat])=>[lat,lng]);
  }catch(e){ return null; }
}

/* ---------------- app context ---------------- */
export const AppCtx = createContext(null);
export const useApp = ()=>useContext(AppCtx);
