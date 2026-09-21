// ---------------------------------------------------------------------------
// territory-store.js — เก็บการมอบหมาย "ขอบเขตพื้นที่การขาย" (TC ↔ จังหวัด/โซน)
//
// ทำไมต้องเก็บฝั่งเซิร์ฟเวอร์ ไม่ใช่ localStorage อย่างเดียว:
//   ค่านี้แอดมินเป็นคนตั้ง แต่ "TC" เป็นคนใช้ — คนละเครื่อง คนละเบราว์เซอร์
//
// ลำดับการทำงาน:
//   1. เรียก /api/territory  (ในเครื่อง = server.mjs · บน Vercel = api/territory.js → Vercel Blob)
//   2. ถ้าเซิร์ฟเวอร์ยังไม่มีที่เก็บ (ยังไม่ได้ตั้ง BLOB_READ_WRITE_TOKEN → 501)
//      ตกมาใช้ localStorage ของเครื่องนั้น เพื่อให้ยังเดโมได้ แต่จะบอกผู้เรียกว่าเป็น local
//      ⚠ โหมด local: TC ที่เปิดจากเครื่องอื่นจะไม่เห็นการมอบหมายนี้
//
// รูปแบบข้อมูล: { "Chiang Mai": 3, "Bangkok Metropolis/LP": 7 }
//   คีย์ = คีย์หน่วย (จังหวัด หรือ จังหวัด/โซน) · ค่า = id ของ TC
// ---------------------------------------------------------------------------

const API = "/api/territory";
const LS_KEY = "geointel_territory";

const readLocal = () => {
  try{
    const raw = localStorage.getItem(LS_KEY);
    if(!raw) return null;
    const body = JSON.parse(raw);
    return (body && body.assign && Object.keys(body.assign).length) ? body : null;
  }catch(e){ return null; }
};

/** โหลดการมอบหมาย · คืน null ถ้ายังไม่เคยบันทึกที่ไหนเลย (ให้ผู้เรียก fallback เป็นค่าตั้งต้นเอง) */
export async function loadTerritory(){
  try{
    const r = await fetch(API, {headers:{"Accept":"application/json"}});
    if(r.ok){
      const body = await r.json();
      const a = body && body.assign;
      if(a && typeof a==="object" && Object.keys(a).length)
        return {assign:a, updatedAt: body.updatedAt || null, local:false};
    }
  }catch(e){
    console.warn("[territory] เรียก API ไม่ได้ ใช้ค่าที่เก็บในเครื่องแทน", e);
  }
  const local = readLocal();                       // เซิร์ฟเวอร์ว่าง/ล่ม → ลองของในเครื่อง
  return local ? {...local, local:true} : null;
}

/**
 * บันทึกทับทั้งก้อน
 * คืน {ok:true}            = ขึ้นเซิร์ฟเวอร์แล้ว ทุกเครื่องเห็นตรงกัน
 *     {ok:true, local:true} = เซิร์ฟเวอร์ยังไม่มีที่เก็บ บันทึกไว้ในเครื่องนี้เท่านั้น
 *     {ok:false, error}     = บันทึกไม่ได้เลย
 */
export async function saveTerritory(assign){
  const payload = {assign, updatedAt:new Date().toISOString()};
  let serverError = null;
  try{
    const r = await fetch(API, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({assign}),
    });
    const body = await r.json().catch(()=>({}));
    if(r.ok) return {ok:true, local:false, ...body};
    serverError = body.message || body.error || ("HTTP "+r.status);
  }catch(e){
    serverError = e.message;
  }
  // เซิร์ฟเวอร์เก็บให้ไม่ได้ — อย่างน้อยอย่าให้สิ่งที่แอดมินเพิ่งตั้งหายไปเฉย ๆ
  try{
    localStorage.setItem(LS_KEY, JSON.stringify(payload));
    return {ok:true, local:true, error:serverError};
  }catch(e){
    return {ok:false, error: serverError || e.message};
  }
}
