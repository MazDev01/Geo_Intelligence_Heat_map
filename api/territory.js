// ---------------------------------------------------------------------------
// api/territory.js — การมอบหมายขอบเขตพื้นที่การขาย (TC ↔ จังหวัด/โซน) บน Vercel
//
// ทำไมต้องมีไฟล์นี้ ทั้งที่ server.mjs มี /api/territory อยู่แล้ว:
//   server.mjs ถูกกันออกจากการ deploy ด้วย .vercelignore (เป็น dev server ของเครื่องตัวเอง)
//   production จึงเป็น static ล้วน — ต้องมี serverless function แยกต่างหาก
//   ผลคือ: รันในเครื่อง = server.mjs ตอบ · บน Vercel = ไฟล์นี้ตอบ · หน้าเว็บเรียก path เดียวกัน
//
// ที่เก็บข้อมูล: Vercel Blob (โปรเจกต์นี้ใช้เก็บไฟล์ basemap .pmtiles อยู่แล้ว)
//   ระบบไฟล์ของ serverless function เขียนถาวรไม่ได้ (อ่านอย่างเดียว + หายทุกครั้งที่ตื่นใหม่)
//   เรียก REST API ตรง ๆ ด้วย fetch เพราะโปรเจกต์นี้ไม่มี npm/package.json จึงลง @vercel/blob ไม่ได้
//
// ต้องตั้ง env var: BLOB_READ_WRITE_TOKEN  (Vercel ใส่ให้เองเมื่อผูก Blob store กับโปรเจกต์)
//   ไม่มีโทเคน → GET ยังตอบก้อนว่างได้ (หน้าเว็บ fallback ไป localStorage) · POST ตอบ 501 พร้อมบอกวิธีแก้
//
// ⚠ ไม่มีการตรวจสิทธิ์ เหมือน /api/visit-plans ฝั่ง dev — ?demo=admin เป็นสวิตช์ฝั่ง client ไม่ใช่ auth
//   ถ้าจะใช้กับข้อมูลลูกค้าจริง ต้องกั้นด้วยโทเคนฝั่งเซิร์ฟเวอร์ก่อน
// ---------------------------------------------------------------------------

const BLOB_PATH = 'territory/assign.json';
const TOKEN = process.env.BLOB_READ_WRITE_TOKEN || '';

const send = (res, code, obj) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
};

/** อ่านก้อนล่าสุดจาก Blob — คืน null ถ้ายังไม่เคยบันทึก/อ่านไม่ได้ */
async function readBlob() {
  if (!TOKEN) return null;
  try {
    // list เพื่อหา URL สาธารณะของไฟล์ (URL มี suffix สุ่มต่อท้าย เดาเองไม่ได้)
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
    console.warn('[territory] อ่าน Blob ไม่สำเร็จ', e && e.message);
    return null;
  }
}

async function writeBlob(payload) {
  const r = await fetch(`https://blob.vercel-storage.com/${BLOB_PATH}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'x-api-version': '7',
      'x-content-type': 'application/json',
      'x-add-random-suffix': '0',          // คงชื่อไฟล์เดิม เขียนทับก้อนเก่าเสมอ
      'x-cache-control-max-age': '0',
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`Blob PUT ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return await r.json();
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    const saved = await readBlob();
    return send(res, 200, saved || { assign: {}, updatedAt: null, source: TOKEN ? 'blob-empty' : 'no-token' });
  }

  if (req.method === 'POST') {
    if (!TOKEN) return send(res, 501, {
      error: 'ยังไม่ได้ตั้งค่าที่เก็บข้อมูล',
      message: 'ต้องเพิ่ม env var BLOB_READ_WRITE_TOKEN ในโปรเจกต์ Vercel (Storage → Blob → Connect) แล้ว redeploy',
    });

    // body อาจมาเป็น object แล้ว (Vercel parse ให้) หรือยังเป็น stream ดิบ — รองรับทั้งสองแบบ
    let body = req.body;
    if (body === undefined || typeof body === 'string') {
      let raw = typeof body === 'string' ? body : '';
      if (!raw) {
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 1e6) return send(res, 413, { error: 'payload ใหญ่เกิน' });
        }
      }
      try { body = JSON.parse(raw || '{}'); }
      catch { return send(res, 400, { error: 'JSON ไม่ถูกต้อง' }); }
    }

    const a = body && body.assign;
    if (!a || typeof a !== 'object' || Array.isArray(a))
      return send(res, 400, { error: 'ต้องมีฟิลด์ assign เป็น object' });

    // กันค่าขยะ: คีย์ = ชื่อหน่วย (จังหวัด หรือ จังหวัด/โซน) · ค่า = id ของ TC เป็นจำนวนเต็ม
    const clean = {};
    for (const [k, v] of Object.entries(a)) {
      if (typeof k !== 'string' || !k || k.length > 120)
        return send(res, 400, { error: 'คีย์หน่วยไม่ถูกต้อง: ' + k });
      const n = Number(v);
      if (!Number.isInteger(n))
        return send(res, 400, { error: 'id ของ TC ต้องเป็นจำนวนเต็ม: ' + k + '=' + v });
      clean[k] = n;
    }

    const out = { assign: clean, updatedAt: new Date().toISOString() };
    try {
      await writeBlob(out);
      return send(res, 200, { ok: true, saved: Object.keys(clean).length, updatedAt: out.updatedAt });
    } catch (e) {
      console.error('[territory] เขียน Blob ไม่สำเร็จ', e && e.message);
      return send(res, 502, { error: 'บันทึกไม่สำเร็จ', message: String(e && e.message) });
    }
  }

  return send(res, 405, { error: 'รองรับเฉพาะ GET กับ POST' });
};
