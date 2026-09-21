// ---------------------------------------------------------------------------
// api/zones.js — รูปขอบเขตโซนที่แอดมินลากเอง (SL/LP/TL) บน Vercel
//
// คู่กับ api/territory.js: production เป็น static ล้วน (server.mjs ถูกกันออกด้วย .vercelignore)
// จึงต้องมี serverless function แยก และเก็บของลง Vercel Blob เพราะ FS ของฟังก์ชันเขียนถาวรไม่ได้
//
// GET  → คืน GeoJSON ที่เคยเซฟไว้ · ยังไม่เคยเซฟ = 204 (ฝั่งหน้าเว็บจะไปใช้ data/zones.geojson ที่มากับ repo)
// POST → ตรวจความถูกต้องก่อนเขียนทับ
//
// ⚠ การตรวจสำคัญมาก: ไฟล์นี้ถูกใช้ทั้งวาดรูปและ "ตัดสินว่าลูกค้าอยู่โซนไหน"
//   ถ้าปล่อยรูปพัง ๆ ขึ้นไป แมพของทุกคนพังพร้อมกัน และ TC จะเห็นพื้นที่ผิด
//   เพดานเดียวกับ zone-editor.js ฝั่งเบราว์เซอร์ (20,000 จุด / 600 KB)
//
// ⚠ ไม่มีการตรวจสิทธิ์ เหมือน endpoint อื่นในโปรเจกต์สาธิตนี้
// ---------------------------------------------------------------------------

const BLOB_PATH = 'zones/zones.geojson';
const TOKEN = process.env.BLOB_READ_WRITE_TOKEN || '';
const MAX_VERTICES = 20000;
const MAX_BYTES = 600 * 1024;

const send = (res, code, obj) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');      // เซฟแล้วต้องเห็นของใหม่ทันที ห้ามแคช
  res.end(obj === undefined ? '' : JSON.stringify(obj));
};

/** ตรวจว่าเป็น GeoJSON ของโซนที่ใช้งานได้จริง — คืนข้อความ error หรือ null ถ้าผ่าน */
function validate(gj) {
  if (!gj || gj.type !== 'FeatureCollection' || !Array.isArray(gj.features))
    return 'ต้องเป็น FeatureCollection';
  if (!gj.features.length) return 'ไม่มี feature เลย';

  const seen = new Set();
  let vertices = 0;

  for (const f of gj.features) {
    const id = f && f.properties && f.properties.zone_id;
    if (!id || typeof id !== 'string') return 'ทุก feature ต้องมี properties.zone_id';
    if (seen.has(id)) return `zone_id ซ้ำ: ${id}`;
    seen.add(id);

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

async function readBlob() {
  if (!TOKEN) return null;
  try {
    const r = await fetch(`https://blob.vercel-storage.com/?prefix=${encodeURIComponent(BLOB_PATH)}&limit=1`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    if (!r.ok) return null;
    const list = await r.json();
    const hit = list && list.blobs && list.blobs[0];
    if (!hit || !hit.url) return null;
    const got = await fetch(hit.url, { cache: 'no-store' });
    if (!got.ok) return null;
    return await got.json();
  } catch (e) {
    console.warn('[zones] อ่าน Blob ไม่สำเร็จ', e && e.message);
    return null;
  }
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    const saved = await readBlob();
    if (!saved) return send(res, 204);            // ยังไม่เคยเซฟ → ให้หน้าเว็บใช้ไฟล์ที่มากับ repo
    return send(res, 200, saved);
  }

  if (req.method === 'POST') {
    if (!TOKEN) return send(res, 501, {
      error: 'ยังไม่ได้ตั้งค่าที่เก็บข้อมูล',
      message: 'ต้องเพิ่ม env var BLOB_READ_WRITE_TOKEN ในโปรเจกต์ Vercel แล้ว redeploy',
    });

    let raw = '';
    if (typeof req.body === 'string') raw = req.body;
    else if (req.body && typeof req.body === 'object') raw = JSON.stringify(req.body);
    else {
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > MAX_BYTES * 2) return send(res, 413, { error: 'ไฟล์ใหญ่เกิน' });
      }
    }
    const bytes = Buffer.byteLength(raw, 'utf8');
    if (bytes > MAX_BYTES)
      return send(res, 413, { error: `ไฟล์ ${Math.round(bytes / 1024)} KB เกินเพดาน ${MAX_BYTES / 1024} KB — ลดหมุดก่อนเซฟ` });

    let gj;
    try { gj = JSON.parse(raw || 'null'); }
    catch { return send(res, 400, { error: 'JSON ไม่ถูกต้อง' }); }

    const bad = validate(gj);
    if (bad) return send(res, 400, { error: 'รูปโซนใช้ไม่ได้', message: bad });

    try {
      const r = await fetch(`https://blob.vercel-storage.com/${BLOB_PATH}`, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'x-api-version': '7',
          'x-content-type': 'application/geo+json',
          'x-add-random-suffix': '0',
          'x-cache-control-max-age': '0',
        },
        body: raw,
      });
      if (!r.ok) throw new Error(`Blob PUT ${r.status}: ${(await r.text()).slice(0, 200)}`);
      console.log(`[zones] บันทึก ${gj.features.length} โซน · ${Math.round(bytes / 1024)} KB`);
      return send(res, 200, {
        ok: true, zones: gj.features.map(f => f.properties.zone_id),
        kb: Math.round(bytes / 1024), updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error('[zones] เขียน Blob ไม่สำเร็จ', e && e.message);
      return send(res, 502, { error: 'บันทึกไม่สำเร็จ', message: String(e && e.message) });
    }
  }

  return send(res, 405, { error: 'รองรับเฉพาะ GET กับ POST' });
};
