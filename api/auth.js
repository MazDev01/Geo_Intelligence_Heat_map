// ---------------------------------------------------------------------------
// api/auth.js — เข้าสู่ระบบ / เปลี่ยนรหัส / จัดการบัญชี บน Vercel
//
// คู่กับ api/zones.js: production เป็น static ล้วน จึงต้องมี serverless function
// และเก็บของลง Vercel Blob เพราะ FS ของฟังก์ชันเขียนถาวรไม่ได้
// ตรรกะทั้งหมดอยู่ใน auth-store.cjs ตัวเดียวกับที่ dev server ใช้ ไฟล์นี้เป็นแค่ adapter
//
// POST /api/auth  { action, ... }
//   login          { email, password }            → { token, user, mustChange }
//   change         { oldPassword, newPassword }   (ต้องมีโทเคน) → { token, user }
//   me             —                              (ต้องมีโทเคน) → { user }
//   users.list     —                              (แอดมิน) → { users }
//   users.create   { name, email, role, province, password? } (แอดมิน) → { user, password }
//   users.update   { email, patch }               (แอดมิน) → { user }
//   users.remove   { email }                      (แอดมิน) → { ok }
//   users.password { email, password? }           (แอดมิน) → { user, password }  ← รีเซ็ตให้คนที่ลืมรหัส
//
// ต้องตั้ง env: BLOB_READ_WRITE_TOKEN (ที่เก็บ) · AUTH_SECRET (คีย์เซ็นโทเคน — ห้ามปล่อยว่างบนโปรดักชัน)
// ---------------------------------------------------------------------------

const { makeAuthStore } = require('../auth-store.cjs');

const PREFIX = 'auth/';
const TOKEN  = process.env.BLOB_READ_WRITE_TOKEN || '';
const SECRET = process.env.AUTH_SECRET || '';

// รายชื่อตั้งต้นครั้งแรก — ยังไม่มีรหัสผ่านสักคน แอดมินต้องตั้งให้ก่อนถึงจะเข้าได้
const SEED = [
  { id: 1, name: 'System Administrator', email: 'admin@geointel.io', role: 'Administrator' },
  { id: 2, name: 'ผู้บริหารภูมิภาค',      email: 'management@geointel.io', role: 'Management' },
  { id: 3, name: 'ณัฐริกา พงษ์ไพบูลย์',    email: 'tc.bkk@geointel.io', role: 'Trade Coordinator', province: 'Bangkok Metropolis' },
  { id: 4, name: 'ศุภมาส เจริญสุข',       email: 'tc.pty@geointel.io', role: 'Trade Coordinator', province: 'Pattaya' },
  { id: 6, name: 'ธนพล ศรีวัฒน์',         email: 'tc.cm@geointel.io',  role: 'Trade Coordinator', province: 'Chiang Mai' },
  { id: 7, name: 'ปิยะนุช วงศ์สกุล',       email: 'tc.hkt@geointel.io', role: 'Trade Coordinator', province: 'Phuket' },
];

const send = (res, code, obj) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(obj === undefined ? '' : JSON.stringify(obj));
};

/* ── adapter: Vercel Blob ผ่าน REST (โปรเจกต์นี้ไม่มี package.json ให้ลง SDK) ── */
const blobFind = async name => {
  const r = await fetch(`https://blob.vercel-storage.com/?prefix=${encodeURIComponent(PREFIX + name)}&limit=1`,
    { headers: { authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) return null;
  const body = await r.json();
  return (body.blobs || [])[0] || null;
};

const adapter = {
  async readJSON(name) {
    try {
      const hit = await blobFind(name);
      if (!hit || !hit.url) return null;
      const got = await fetch(hit.url, { cache: 'no-store' });
      return got.ok ? await got.json() : null;
    } catch (e) { console.warn('[auth] อ่าน Blob ไม่สำเร็จ', name, e && e.message); return null; }
  },
  async writeText(name, text) {
    const r = await fetch(`https://blob.vercel-storage.com/${PREFIX}${name}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${TOKEN}`, 'x-api-version': '7',
                 'x-content-type': 'application/json', 'x-add-random-suffix': '0',
                 'x-cache-control-max-age': '0' },
      body: text,
    });
    if (!r.ok) throw new Error(`Blob PUT ${r.status}: ${(await r.text()).slice(0, 200)}`);
  },
};

// DEMO_PASSWORD ตั้งไว้ = บัญชีตั้งต้นทุกคนใช้รหัสนั้นเข้าได้ทันที (สำหรับเดโมให้ลูกค้าดู)
// ระบบจริงห้ามตั้ง — ปล่อยว่าง บัญชีจะยังไม่มีรหัสจนกว่าแอดมินจะตั้งให้
const DEMO_PW = process.env.DEMO_PASSWORD || '';
const store = makeAuthStore(adapter, { secret: SECRET || 'geointel-dev-secret', seed: SEED, seedPassword: DEMO_PW });

const readBody = req => new Promise((resolve, reject) => {
  if (req.body) return resolve(typeof req.body === 'string' ? JSON.parse(req.body) : req.body);
  let s = '';
  req.on('data', c => { s += c; if (s.length > 1e6) { req.destroy(); reject(new Error('ข้อมูลใหญ่เกินไป')); } });
  req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
  req.on('error', reject);
});

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'ใช้ POST เท่านั้น' });
  if (!TOKEN) return send(res, 500, { error: 'เซิร์ฟเวอร์ยังไม่ได้ตั้ง BLOB_READ_WRITE_TOKEN' });

  let body;
  try { body = await readBody(req); }
  catch (e) { return send(res, 400, { error: 'อ่านคำขอไม่ได้: ' + e.message }); }

  const action = String(body.action || '');
  // ⚠ ไม่มี AUTH_SECRET = ใครก็ปลอมโทเคนได้ · ยอมให้รันได้เฉพาะตอน dev เท่านั้น
  if (!SECRET && process.env.VERCEL_ENV === 'production')
    return send(res, 500, { error: 'เซิร์ฟเวอร์ยังไม่ได้ตั้ง AUTH_SECRET' });

  try {
    if (action === 'login') {
      const r = await store.login(body.email, body.password);
      return send(res, r.ok ? 200 : (r.code || 401), r);
    }

    if (action === 'change') {
      const who = await store.auth(req.headers);
      if (!who.ok) return send(res, who.code, who);
      const r = await store.changePassword(who.user.email, body.oldPassword, body.newPassword);
      return send(res, r.ok ? 200 : (r.code || 400), r);
    }

    // ตั้งรหัสแอดมินคนแรก — ใช้ได้เฉพาะตอนที่ยังไม่มีใครในระบบมีรหัสผ่าน
    if (action === 'bootstrap') {
      if (!(await store.bootstrapNeeded())) return send(res, 403, { ok: false, error: 'ระบบตั้งค่าครั้งแรกไปแล้ว' });
      const target = await store.get(body.email);
      if (!target || target.role !== 'Administrator')
        return send(res, 400, { ok: false, error: 'ตั้งได้เฉพาะบัญชีผู้ดูแลระบบ' });
      const r = await store.setPassword(body.email, body.password);
      return send(res, r.ok ? 200 : r.code, r);
    }

    if (action === 'info') return send(res, 200, { ok: true, demo: !!DEMO_PW, demoPassword: DEMO_PW });

    if (action === 'me') {
      const who = await store.auth(req.headers);
      return send(res, who.ok ? 200 : who.code, who);
    }

    // ── ตั้งแต่ตรงนี้ลงไป แอดมินเท่านั้น ──
    const admin = await store.auth(req.headers, 'Administrator');
    if (!admin.ok) return send(res, admin.code, admin);

    if (action === 'users.list')     return send(res, 200, { ok: true, users: await store.list() });
    if (action === 'users.create')   { const r = await store.create(body); return send(res, r.ok ? 200 : r.code, r); }
    if (action === 'users.update')   { const r = await store.update(body.email, body.patch); return send(res, r.ok ? 200 : r.code, r); }
    if (action === 'users.remove')   { const r = await store.remove(body.email, admin.user.email); return send(res, r.ok ? 200 : r.code, r); }
    if (action === 'users.password') { const r = await store.setPassword(body.email, body.password); return send(res, r.ok ? 200 : r.code, r); }

    return send(res, 400, { error: 'ไม่รู้จักคำสั่ง: ' + action });
  } catch (e) {
    console.error('[auth]', e);
    return send(res, 500, { error: 'เซิร์ฟเวอร์ผิดพลาด: ' + (e && e.message) });
  }
};
