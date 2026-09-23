// ---------------------------------------------------------------------------
// zone-registry.js — ทะเบียนโซน "แหล่งความจริงเดียว" ของทั้งระบบ
//
// ปัญหาที่ไฟล์นี้มาแก้: ก่อนหน้านี้นิยามของโซนกระจายอยู่ 4 ที่
//   zone-layer.js ZONE_META (ชื่อ+สี) · geoData.js BKK_ZONES (ชื่อ+รายชื่อเขต)
//   zones.csv (เขต→โซน) · zones.geojson (รูป)
// เพิ่มโซนใหม่ต้องแก้ครบทั้ง 4 ลืมที่ใดที่หนึ่ง = โซนโผล่บนแมพแต่มอบหมายให้ TC ไม่ได้
//
// รูปแบบ: GeoJSON FeatureCollection ตัวเดิม แต่ย้าย metadata ไปอยู่ใน properties
//   zone_id       รหัสโซน (SL/LP/TL/…) — เป็นค่าข้อมูล ไม่แปล
//   zone_name     ชื่อไทย
//   zone_name_en  ชื่ออังกฤษ (ไม่มีก็ใช้ zone_name)
//   color         สีบนแมพ
//   province      จังหวัดที่โซนนี้อยู่ — รองรับการแบ่งโซนในจังหวัดอื่นในอนาคต
//   districts     รายชื่อเขต (อังกฤษ) ไว้เป็น fallback ตอนเรกคอร์ดไม่มีพิกัด
// ไฟล์เก่าที่ไม่มีฟิลด์ใหม่ยังอ่านได้ — เติมค่าตั้งต้นให้จาก FALLBACK_META
//
// ⚠ ไฟล์นี้ fetch จึงใช้ได้เฉพาะในเบราว์เซอร์ · ฝั่ง Node (gen.mjs) ยังใช้ BKK_ZONES
//   ใน mock/geoData.js เป็นค่าตั้งต้นเหมือนเดิม
// ---------------------------------------------------------------------------
import { t, getLang } from "./i18n.js";
import { BKK, BKK_ZONES } from "./mock/geoData.js";

const API    = "/api/zones";
const STATIC = "/data/zones.geojson";

/* สีและชื่อตั้งต้นของ 3 โซนแรก — ใช้เมื่อไฟล์ยังไม่มีฟิลด์ color/zone_name_en */
const FALLBACK_META = {
  SL: { color: "#ec4899", en: "Silom" },
  LP: { color: "#f97316", en: "Lat Phrao" },
  TL: { color: "#7c3aed", en: "Thonglor" },
};
/**
 * รหัสหน่วย "พื้นที่ที่เหลือของจังหวัด" — เขตที่ไม่ได้อยู่ในโซนไหนเลย
 * จังหวัดที่ถูกแบ่งโซนยังมีพื้นที่เหลืออยู่ (กรุงเทพฯ 50 เขต อยู่ในโซน 27 เหลือ 23)
 * ถ้าไม่มีหน่วยนี้ ลูกค้าในพื้นที่ที่เหลือจะมอบหมายให้ TC ไม่ได้เลย
 * ⚠ ไม่ใช่โซนในทะเบียน — ไม่มีรูปทรงของตัวเอง นิยามว่า "อยู่ในจังหวัด แต่ไม่อยู่ในโซนใด"
 */
export const ZONE_REST = "__rest";
export const restLabel = () => t("พื้นที่นอกโซน", "Outside any zone");

const PALETTE = ["#ec4899","#f97316","#7c3aed","#0ea5e9","#16a34a","#eab308","#dc2626","#0891b2"];
export const nextColor = used => PALETTE.find(c=>!used.includes(c)) || PALETTE[used.length % PALETTE.length];

let cache = null;          // FeatureCollection ที่ normalize แล้ว
let pending = null;
const subs = new Set();

/** เติมฟิลด์ที่ขาดให้ครบ เพื่อให้ผู้เรียกไม่ต้องเช็ค null ทุกที่ */
function normalize(fc){
  const feats = (fc && fc.features || []).filter(f=>f && f.properties && f.properties.zone_id);
  const seedDistricts = Object.fromEntries(BKK_ZONES.map(z=>[z.key, z.districts]));
  const seedNames     = Object.fromEntries(BKK_ZONES.map(z=>[z.key, z.th]));
  return {
    type: "FeatureCollection",
    features: feats.map(f=>{
      const p = f.properties, id = p.zone_id;
      const fb = FALLBACK_META[id] || {};
      return { ...f, properties: {
        ...p,
        zone_name:    p.zone_name || seedNames[id] || id,
        zone_name_en: p.zone_name_en || fb.en || p.zone_name || id,
        color:        p.color || fb.color || nextColor(feats.map(x=>x.properties.color).filter(Boolean)),
        province:     p.province || BKK,        // ไฟล์รุ่นแรกมีแต่โซนกรุงเทพฯ
        districts:    Array.isArray(p.districts) ? p.districts : (seedDistricts[id] || []),
      }};
    }),
  };
}

/** โหลดทะเบียน: ของที่เซฟไว้บนเซิร์ฟเวอร์ก่อน (204 = ยังไม่เคยเซฟ) ไม่มีค่อยใช้ไฟล์ใน repo */
export function loadZoneRegistry({force=false}={}){
  if(cache && !force) return Promise.resolve(cache);
  if(pending && !force) return pending;
  pending = fetch(API, {cache:"no-store"})
    .then(r => (r.ok && r.status!==204) ? r.json() : null)
    .catch(()=>null)
    .then(gj => gj || fetch(STATIC, {cache:"no-store"}).then(r=>r.json()))
    .then(gj => { cache = normalize(gj); pending = null;
      subs.forEach(fn=>{ try{ fn(cache); }catch(e){ console.warn("[zone-registry] subscriber error", e); } });
      return cache; })
    .catch(e => { pending = null; console.warn("[zone-registry] โหลดทะเบียนโซนไม่สำเร็จ", e);
      cache = {type:"FeatureCollection", features:[]}; return cache; });
  return pending;
}

/** ค่าที่โหลดไว้แล้ว (ไม่ยิงเน็ต) — null ถ้ายังไม่เคยโหลด */
export const zoneRegistry = () => cache;
export function subscribeZones(fn){ subs.add(fn); return ()=>subs.delete(fn); }

/* ── รหัสผู้ดูแล ────────────────────────────────────────────────────────────
   เก็บใน sessionStorage (ปิดแท็บก็หาย) แล้วส่งเป็น Authorization header
   ⚠ หน้าเว็บเป็น static ไม่มีระบบตัวตนจริง — รหัสนี้กัน "คนนอกที่รู้แค่ URL"
     ยิงเขียนทับได้ แต่ไม่ได้กันคนที่นั่งอยู่หน้าเครื่องเดียวกัน อย่าเข้าใจผิดว่าเป็น auth */
const TOK_KEY = "geointel_zones_token";
export const adminToken = () => { try{ return sessionStorage.getItem(TOK_KEY) || ""; }catch(e){ return ""; } };
export const setAdminToken = v => { try{ v ? sessionStorage.setItem(TOK_KEY, v) : sessionStorage.removeItem(TOK_KEY); }catch(e){} };
// ส่งเป็น base64 ของ UTF-8 เพราะ HTTP header เป็น latin-1 — รหัสภาษาไทยส่งดิบ ๆ จะเพี้ยน
// (เจอมาแล้ว: รหัสถูกแต่เซิร์ฟเวอร์ปฏิเสธ) ฝั่งเซิร์ฟเวอร์รับทั้ง base64 และข้อความดิบ
const b64 = s => { try{ return btoa(String.fromCharCode(...new TextEncoder().encode(s))); }catch(e){ return s; } };
const authHeaders = () => { const t = adminToken(); return t ? {Authorization:"Bearer "+b64(t)} : {}; };

async function post(query, body){
  try{
    const r = await fetch(API + (query||""), {
      method:"POST",
      headers:{...(body!==undefined ? {"Content-Type":"application/json"} : {}), ...authHeaders()},
      ...(body!==undefined ? {body} : {}),
    });
    const out = await r.json().catch(()=>({}));
    if(!r.ok) return {ok:false, code:r.status, error: out.message || out.error || ("HTTP "+r.status)};
    return {ok:true, ...out};
  }catch(e){ return {ok:false, error:e.message}; }
}

/** บันทึกเป็น "ฉบับร่าง" — ยังไม่มีผลกับ TC/ผู้บริหารจนกดอนุมัติ */
export const saveZoneDraft = fc => post("", JSON.stringify(normalize(fc)));

/** บันทึกแล้วมีผลทันที (ข้ามขั้นอนุมัติ) — อัปเดตแคชในหน้าให้ตรงกันด้วย */
export async function saveZoneRegistry(fc){
  const norm = normalize(fc);
  const r = await post("?publish=1", JSON.stringify(norm));
  if(r.ok){ cache = norm; subs.forEach(fn=>{ try{ fn(cache); }catch(e){} }); }
  return r;
}

/** อนุมัติฉบับร่างให้มีผลจริง แล้วรีโหลดแคชจากเซิร์ฟเวอร์ */
export async function approveZoneDraft(){
  const r = await post("?approve=1");
  if(r.ok) await loadZoneRegistry({force:true});
  return r;
}
export const discardZoneDraft = () => post("?discard=1");

/** ฉบับร่างที่ค้างอยู่ (null = ไม่มี) */
export async function loadZoneDraft(){
  try{ const r = await fetch(API+"?draft=1", {cache:"no-store"});
    return (r.ok && r.status!==204) ? normalize(await r.json()) : null;
  }catch(e){ return null; }
}

/** ประวัติฉบับที่เคยมีผลจริง (ใหม่สุดมาก่อน) */
export async function listZoneVersions(){
  try{ const r = await fetch(API+"?history=1", {cache:"no-store"});
    if(!r.ok) return [];
    const b = await r.json();
    return Array.isArray(b.versions) ? b.versions : [];
  }catch(e){ return []; }
}

/** ย้อนไปใช้ฉบับในประวัติ — ฉบับปัจจุบันถูกเก็บเข้าประวัติก่อน ไม่หายไปเฉย ๆ */
export async function restoreZoneVersion(version){
  const r = await post("?restore="+encodeURIComponent(version));
  if(r.ok) await loadZoneRegistry({force:true});
  return r;
}

/* ── ตัวช่วยอ่านทะเบียน ─────────────────────────────────────────────────── */

const feats = () => (cache && cache.features) || [];
export const zoneList     = () => feats().map(f=>f.properties);
export const zonesOf      = province => feats().filter(f=>f.properties.province===province).map(f=>f.properties);
export const zoneProps    = id => (feats().find(f=>f.properties.zone_id===id)||{}).properties || null;
export const zoneColor    = id => { const p=zoneProps(id); return p ? p.color : "#64748b"; };
/** ชื่อโซนตามภาษาปัจจุบัน · คืน id เดิมถ้าไม่รู้จัก (id เป็นค่าข้อมูล ไม่แปล) */
export const zoneLabel    = id => { if(id===ZONE_REST) return restLabel();
  const p=zoneProps(id); if(!p) return id;
  return getLang()==="en" ? (p.zone_name_en || p.zone_name) : p.zone_name; };
/** จังหวัดที่มีการแบ่งโซน — ใช้ตัดสินว่าจังหวัดนั้นเป็น "หลายหน่วย" หรือหน่วยเดียว */
export const zonedProvinces = () => [...new Set(feats().map(f=>f.properties.province))];
/** meta สำหรับส่งเข้า createZoneLayer (รูปแบบเดียวกับ ZONE_META เดิม) */
export const zoneMetaMap = () => Object.fromEntries(feats().map(f=>{
  const p=f.properties; return [p.zone_id, {label: zoneLabel(p.zone_id), color: p.color}]; }));
/** ป้ายกำกับไว้ใช้ตอนยังโหลดทะเบียนไม่เสร็จ */
export const loadingLabel = () => t("กำลังโหลดโซน…","Loading zones…");
