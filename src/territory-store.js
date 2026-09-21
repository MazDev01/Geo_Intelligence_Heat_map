// ---------------------------------------------------------------------------
// territory-store.js — เก็บการมอบหมาย "ขอบเขตพื้นที่การขาย" (TC ↔ จังหวัด/โซน) ไว้ที่เซิร์ฟเวอร์
//
// ทำไมต้องเก็บฝั่งเซิร์ฟเวอร์ ไม่ใช่ localStorage:
//   ค่านี้แอดมินเป็นคนตั้ง แต่ "TC" เป็นคนใช้ — คนละเครื่อง คนละเบราว์เซอร์
//   localStorage จะไม่มีวันข้ามไปถึงกัน
//
// รูปแบบข้อมูล: { "Chiang Mai": 3, "Bangkok Metropolis/LP": 7 }
//   คีย์ = คีย์หน่วย (จังหวัด หรือ จังหวัด/โซน) · ค่า = id ของ TC
// ---------------------------------------------------------------------------

const API = "/api/territory";

/** โหลดการมอบหมายจากเซิร์ฟเวอร์ · คืน null ถ้ายังไม่เคยบันทึก/ต่อไม่ได้ (ให้ผู้เรียก fallback เอง) */
export async function loadTerritory(){
  try{
    const r = await fetch(API, {headers:{"Accept":"application/json"}});
    if(!r.ok) throw new Error("HTTP "+r.status);
    const body = await r.json();
    const a = body && body.assign;
    if(!a || typeof a!=="object" || !Object.keys(a).length) return null;   // ก้อนว่าง = ยังไม่เคยตั้ง
    return {assign:a, updatedAt: body.updatedAt || null};
  }catch(e){
    console.warn("[territory] โหลดการมอบหมายไม่สำเร็จ ใช้ค่าตั้งต้นแทน", e);
    return null;
  }
}

/** บันทึกทับทั้งก้อน · คืน {ok:true,...} หรือ {ok:false, error} — ผู้เรียกเป็นคนแจ้งผู้ใช้เอง */
export async function saveTerritory(assign){
  try{
    const r = await fetch(API, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({assign}),
    });
    const body = await r.json().catch(()=>({}));
    if(!r.ok) return {ok:false, error: body.error || ("HTTP "+r.status)};
    return {ok:true, ...body};
  }catch(e){
    return {ok:false, error: e.message};
  }
}
