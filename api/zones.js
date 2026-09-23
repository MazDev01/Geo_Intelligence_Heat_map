// ---------------------------------------------------------------------------
// api/zones.js — ทะเบียนโซนบน Vercel (ร่าง / อนุมัติ / ประวัติ / สิทธิ์)
//
// production เป็น static ล้วน (server.mjs ถูกกันออกด้วย .vercelignore) จึงต้องมี
// serverless function และเก็บของลง Vercel Blob เพราะ FS ของฟังก์ชันเขียนถาวรไม่ได้
// ตรรกะทั้งหมดอยู่ใน zone-store.cjs ตัวเดียวกับที่ dev server ใช้ ไฟล์นี้เป็นแค่ adapter
//
// GET  /api/zones                 → ฉบับที่มีผลจริง (204 ถ้ายังไม่เคยเซฟ)
// GET  /api/zones?draft=1         → ฉบับร่าง (204 ถ้าไม่มี)
// GET  /api/zones?history=1       → รายการประวัติ
// GET  /api/zones?version=<v>     → ฉบับในประวัติ
// POST /api/zones                 → เซฟเป็นฉบับร่าง (ค่าเริ่มต้น — ไม่มีผลกับใคร)
// POST /api/zones?publish=1       → เซฟแล้วมีผลทันที
// POST /api/zones?approve=1       → อนุมัติฉบับร่างให้มีผลจริง
// POST /api/zones?restore=<v>     → ย้อนไปใช้ฉบับในประวัติ
// POST /api/zones?discard=1       → ทิ้งฉบับร่าง
//
// ต้องตั้ง env: BLOB_READ_WRITE_TOKEN (ที่เก็บ) · ZONES_TOKEN (รหัสผู้ดูแล — ไม่ตั้ง = เปิดเขียน)
// ---------------------------------------------------------------------------

const { makeZoneStore, checkWriteAuth } = require('../zone-store.cjs');
const { MAX_BYTES } = require('../zone-validate.cjs');

const PREFIX = 'zones/';
const TOKEN = process.env.BLOB_READ_WRITE_TOKEN || '';

const send = (res, code, obj) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(obj === undefined ? '' : JSON.stringify(obj));
};

/* ── adapter: Vercel Blob ผ่าน REST (โปรเจกต์นี้ไม่มี package.json ให้ลง SDK) ── */
const blobList = async prefix => {
  const r = await fetch(`https://blob.vercel-storage.com/?prefix=${encodeURIComponent(PREFIX + prefix)}&limit=1000`,
    { headers: { authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) return [];
  const body = await r.json();
  return (body.blobs || []).map(b => b.pathname.slice(PREFIX.length));
};

const adapter = {
  async readJSON(name) {
    try {
      const hits = await blobList(name);
      if (!hits.includes(name)) return null;
      // ต้อง list เพื่อเอา URL สาธารณะ (ชื่อไฟล์เดียวกันแต่ URL มี suffix ของ store)
      const r = await fetch(`https://blob.vercel-storage.com/?prefix=${encodeURIComponent(PREFIX + name)}&limit=1`,
        { headers: { authorization: `Bearer ${TOKEN}` } });
      const body = await r.json();
      const hit = (body.blobs || [])[0];
      if (!hit || !hit.url) return null;
      const got = await fetch(hit.url, { cache: 'no-store' });
      return got.ok ? await got.json() : null;
    } catch (e) { console.warn('[zones] อ่าน Blob ไม่สำเร็จ', name, e && e.message); return null; }
  },
  async writeText(name, text) {
    const r = await fetch(`https://blob.vercel-storage.com/${PREFIX}${name}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${TOKEN}`, 'x-api-version': '7',
                 'x-content-type': 'application/geo+json', 'x-add-random-suffix': '0',
                 'x-cache-control-max-age': '0' },
      body: text,
    });
    if (!r.ok) throw new Error(`Blob PUT ${r.status}: ${(await r.text()).slice(0, 200)}`);
  },
  list: prefix => blobList(prefix),
  async remove(name) {
    await fetch('https://blob.vercel-storage.com/delete', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', 'x-api-version': '7' },
      body: JSON.stringify({ urls: [`${PREFIX}${name}`] }),
    }).catch(()=>{});
  },
};

const store = makeZoneStore(adapter);

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const q = url.searchParams;

  if (req.method === 'GET') {
    if (!TOKEN) return send(res, 204);                       // ไม่มีที่เก็บ → หน้าเว็บใช้ไฟล์ใน repo
    if (q.get('history')) return send(res, 200, { versions: await store.listHistory() });
    if (q.get('version')) {
      const v = await store.getVersion(q.get('version'));
      return v ? send(res, 200, v) : send(res, 404, { error: 'ไม่พบฉบับนี้' });
    }
    if (q.get('draft')) {
      const d = await store.readDraft();
      return d ? send(res, 200, d) : send(res, 204);
    }
    const cur = await store.readPublished();
    return cur ? send(res, 200, cur) : send(res, 204);
  }

  if (req.method === 'POST') {
    if (!TOKEN) return send(res, 501, { error: 'ยังไม่ได้ตั้งค่าที่เก็บข้อมูล',
      message: 'ต้องเพิ่ม env var BLOB_READ_WRITE_TOKEN ในโปรเจกต์ Vercel แล้ว redeploy' });

    const auth = checkWriteAuth(req.headers, process.env);
    if (!auth.ok) return send(res, auth.code, { error: auth.error });

    if (q.get('approve'))  return reply(res, await store.approve());
    if (q.get('discard'))  return reply(res, await store.discardDraft());
    if (q.get('restore'))  return reply(res, await store.restore(q.get('restore')));

    let raw = '';
    if (typeof req.body === 'string') raw = req.body;
    else if (req.body && typeof req.body === 'object') raw = JSON.stringify(req.body);
    else {
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > MAX_BYTES * 2) return send(res, 413, { error: 'ไฟล์ใหญ่เกิน' });
      }
    }
    return reply(res, q.get('publish') ? await store.publish(raw) : await store.saveDraft(raw));
  }

  return send(res, 405, { error: 'รองรับเฉพาะ GET กับ POST' });
};

function reply(res, r) {
  if (r && r.ok) { console.log('[zones]', JSON.stringify(r)); return send(res, 200, r); }
  return send(res, (r && r.code) || 500, r || { error: 'ไม่สำเร็จ' });
}
