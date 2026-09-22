// ---------------------------------------------------------------------------
// zone-validate.cjs — ตัวตรวจทะเบียนโซน "ตัวเดียว" ที่ใช้ทั้ง dev server และ Vercel
//
// ทำไมต้องแยกเป็นไฟล์กลาง: เคยเขียนตัวตรวจไว้สองที่ (server.mjs กับ api/zones.js)
// แล้วมันไม่เท่ากัน — สีผิดรูปแบบผ่านตอนรันในเครื่อง แต่ถูกปฏิเสธบน production
// ของแบบนั้นคือกับดักที่แย่ที่สุด: ทดสอบในเครื่องผ่าน แล้วไปพังตอนขึ้นจริง
//
// เป็น .cjs เพราะ api/*.js ของ Vercel เป็น CommonJS ส่วน server.mjs (ESM)
// เรียกผ่าน createRequire ได้ — จึงใช้ร่วมกันได้ทั้งสองฝั่งโดยไม่ต้องมี build step
// ---------------------------------------------------------------------------

const MAX_VERTICES = 20000;
const MAX_BYTES = 600 * 1024;

/**
 * ตรวจ FeatureCollection ของโซน
 * @returns {string|null} ข้อความบอกสาเหตุ หรือ null ถ้าผ่าน
 */
function validateZones(gj) {
  if (!gj || gj.type !== 'FeatureCollection' || !Array.isArray(gj.features))
    return 'ต้องเป็น FeatureCollection';
  if (!gj.features.length) return 'ไม่มี feature เลย';

  const seen = new Set();
  let vertices = 0;

  for (const f of gj.features) {
    const p = (f && f.properties) || {};
    const id = p.zone_id;
    if (!id || typeof id !== 'string') return 'ทุก feature ต้องมี properties.zone_id';
    if (seen.has(id)) return `zone_id ซ้ำ: ${id}`;
    seen.add(id);

    // metadata ของโซน — optional ทุกฟิลด์ แต่ถ้าส่งมาต้องถูกชนิด
    // ไม่งั้นค่าขยะจะไปโผล่เป็นชื่อ/สีบนแมพของทุกคน
    if (p.zone_name != null && typeof p.zone_name !== 'string') return `${id}: zone_name ต้องเป็นข้อความ`;
    if (p.zone_name_en != null && typeof p.zone_name_en !== 'string') return `${id}: zone_name_en ต้องเป็นข้อความ`;
    if (p.province != null && typeof p.province !== 'string') return `${id}: province ต้องเป็นข้อความ`;
    if (p.color != null && !/^#[0-9a-fA-F]{6}$/.test(p.color)) return `${id}: color ต้องเป็น #rrggbb`;
    if (p.districts != null && (!Array.isArray(p.districts) || p.districts.some(d => typeof d !== 'string')))
      return `${id}: districts ต้องเป็นอาเรย์ของข้อความ`;

    const g = f.geometry;
    if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon'))
      return `${id}: geometry ต้องเป็น Polygon หรือ MultiPolygon`;

    const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
    if (!polys.length) return `${id}: geometry ว่าง`;

    for (const poly of polys) {
      if (!Array.isArray(poly) || !poly.length) return `${id}: polygon ว่าง`;
      for (const ring of poly) {
        if (!Array.isArray(ring) || ring.length < 4) return `${id}: วงแหวนต้องมีอย่างน้อย 4 จุด`;
        const a = ring[0], b = ring[ring.length - 1];
        if (!Array.isArray(a) || !Array.isArray(b) || a[0] !== b[0] || a[1] !== b[1])
          return `${id}: วงแหวนไม่ปิด (จุดแรกต้องเท่ากับจุดสุดท้าย)`;
        for (const c of ring) {
          if (!Array.isArray(c) || c.length < 2 || !Number.isFinite(c[0]) || !Number.isFinite(c[1]))
            return `${id}: มีพิกัดที่ไม่ใช่ตัวเลข`;
          if (c[0] < -180 || c[0] > 180 || c[1] < -90 || c[1] > 90)
            return `${id}: พิกัดหลุดขอบโลก (${c[0]},${c[1]})`;
          vertices++;
        }
      }
    }
  }
  if (vertices > MAX_VERTICES) return `จุดเยอะเกิน ${vertices} (เพดาน ${MAX_VERTICES}) — ลดหมุดก่อนเซฟ`;
  return null;
}

module.exports = { validateZones, MAX_VERTICES, MAX_BYTES };
