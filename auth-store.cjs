// ---------------------------------------------------------------------------
// auth-store.cjs — บัญชีผู้ใช้ + รหัสผ่าน + โทเคนเข้าสู่ระบบ
//
// ใช้ร่วมกันทั้ง dev server (server.mjs) และ Vercel (api/auth.js) แบบเดียวกับ
// zone-store.cjs — ที่เก็บต่างกัน (ไฟล์ vs Vercel Blob) จึงรับเข้ามาเป็น adapter
//
// รูปแบบที่เลือก: แอดมินตั้งรหัสผ่านให้ → ผู้ใช้ถูกบังคับเปลี่ยนตอนเข้าครั้งแรก
// แอดมินรีเซ็ตให้ใหม่ได้เมื่อลืม (ตั้งรหัสชั่วคราว + บังคับเปลี่ยนอีกครั้ง)
//
// ⚠ สิ่งที่ระบบนี้ "ไม่ได้" ทำ และต้องรู้ก่อนใช้จริง:
//   - ไม่มีระบบอีเมล รหัสชั่วคราวจึงต้องส่งมือต่อมือ (แอดมินเห็นรหัสตอนตั้ง/รีเซ็ตครั้งเดียว)
//   - ไม่มี 2FA · ไม่มี rate limit ระดับ IP (มีแค่ล็อกบัญชีเมื่อกรอกผิดติดกัน)
//   - โทเคนเซ็นด้วย AUTH_SECRET ถ้าไม่ตั้ง env จะ fallback เป็นค่าเดโมซึ่งไม่ปลอดภัย
//     บนโปรดักชันต้องตั้ง AUTH_SECRET เสมอ ไม่งั้นใครก็ปลอมโทเคนได้
// ---------------------------------------------------------------------------

const crypto = require('crypto');

const USERS_FILE = 'users.json';
const ITERATIONS = 210000;            // PBKDF2-SHA256 · อิงคำแนะนำ OWASP สำหรับ SHA-256
const KEYLEN     = 32;
const MIN_PW     = 8;
const MAX_FAILS  = 5;                 // กรอกผิดติดกันเกินนี้ = ล็อกชั่วคราว
const LOCK_MS    = 15 * 60 * 1000;
const TOKEN_TTL  = 12 * 60 * 60 * 1000;   // อายุโทเคน 12 ชม.

const ROLES = ['Administrator', 'Management', 'Trade Coordinator'];
const STATUSES = ['Active', 'Suspended'];

/* ── รหัสผ่าน ────────────────────────────────────────────────────────── */
function hashPassword(pw, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const h = crypto.pbkdf2Sync(String(pw), s, ITERATIONS, KEYLEN, 'sha256').toString('hex');
  return { salt: s, hash: h, iter: ITERATIONS };
}
function verifyPassword(pw, rec) {
  if (!rec || !rec.hash || !rec.salt) return false;
  const h = crypto.pbkdf2Sync(String(pw), rec.salt, rec.iter || ITERATIONS, KEYLEN, 'sha256');
  const want = Buffer.from(rec.hash, 'hex');
  // ความยาวต่างกัน timingSafeEqual จะโยน — เทียบความยาวก่อน (ความยาวไม่ใช่ความลับ)
  return want.length === h.length && crypto.timingSafeEqual(want, h);
}
function checkStrength(pw) {
  const s = String(pw || '');
  if (s.length < MIN_PW) return { ok: false, error: 'รหัสผ่านต้องยาวอย่างน้อย ' + MIN_PW + ' ตัวอักษร' };
  if (!/[A-Za-z]/.test(s) || !/[0-9]/.test(s)) return { ok: false, error: 'รหัสผ่านต้องมีทั้งตัวอักษรและตัวเลข' };
  return { ok: true };
}
/** รหัสชั่วคราวให้แอดมินส่งต่อ — อ่านออกเสียงได้ ไม่มีตัวที่สับสน (0/O, 1/l/I) */
function tempPassword() {
  const A = 'abcdefghjkmnpqrstuvwxyz', N = '23456789';
  const pick = set => set[crypto.randomInt(set.length)];
  return Array.from({ length: 6 }, () => pick(A)).join('') + Array.from({ length: 3 }, () => pick(N)).join('');
}

/* ── โทเคน: <payload base64url>.<ลายเซ็น HMAC> ───────────────────────── */
const b64u  = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
const sign  = (data, secret) => b64u(crypto.createHmac('sha256', secret).update(data).digest());

function makeToken(user, secret, ttl) {
  const body = b64u(JSON.stringify({ email: user.email, role: user.role, exp: Date.now() + (ttl || TOKEN_TTL) }));
  return body + '.' + sign(body, secret);
}
function readToken(token, secret) {
  const parts = String(token || '').split('.');
  const body = parts[0], sig = parts[1];
  if (!body || !sig) return null;
  const want = sign(body, secret);
  // เทียบลายเซ็นแบบคงเวลา กัน timing attack
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try {
    const p = JSON.parse(unb64(body));
    return (p && p.exp > Date.now()) ? p : null;
  } catch (e) { return null; }
}

/* ── ร้านค้าข้อมูลผู้ใช้ ─────────────────────────────────────────────── */
const publicUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, province: u.province || null,
                           status: u.status || 'Active', mustChange: !!u.mustChange,
                           hasPassword: !!(u.pw && u.pw.hash), last: u.last || '—' });

const findBy = (users, email) => users.find(u => String(u.email || '').toLowerCase() === String(email || '').toLowerCase());

function fileAdapter(files) {
  let makeSeed = () => [];
  const writeAll = users => files.writeText(USERS_FILE, JSON.stringify({ users }, null, 2));

  async function readAll() {
    const got = await files.readJSON(USERS_FILE);
    if (got && Array.isArray(got.users)) return got.users;
    // ครั้งแรก: สร้างจากรายชื่อตั้งต้น · ยังไม่มีรหัสผ่านสักคน (แอดมินต้องตั้งให้)
    const users = makeSeed();
    if (users.length) await writeAll(users);
    return users;
  }

  return {
    async ensureSeed(fn) { makeSeed = fn; },
    list: readAll,
    async findByEmail(email) { return findBy(await readAll(), email) || null; },
    async insert(rec) {
      const users = await readAll();
      const u = { id: Math.max(0, ...users.map(x => x.id || 0)) + 1, ...rec };
      users.push(u);
      await writeAll(users);
      return u;
    },
    async update(id, patch) {
      const users = await readAll();
      const u = users.find(x => x.id === id);
      if (!u) return;
      Object.assign(u, patch);
      await writeAll(users);
    },
    async remove(id) {
      const users = await readAll();
      await writeAll(users.filter(x => x.id !== id));
    },
  };
}

function makeAuthStore(adapter, opts) {
  const o = opts || {};
  const secret = o.secret || 'geointel-dev-secret';
  const seed   = o.seed || [];
  // โหมดเดโม: ตั้ง seedPassword แล้วบัญชีตั้งต้นทุกคนใช้รหัสนี้เข้าได้ทันที ไม่ต้องบังคับเปลี่ยน
  // ระบบจริงห้ามตั้งค่านี้ — ปล่อยว่างไว้ บัญชีจะยังไม่มีรหัสจนกว่าแอดมินจะตั้งให้ทีละคน
  const seedPw = o.seedPassword || '';

  const db = typeof adapter.findByEmail === 'function' ? adapter : fileAdapter(adapter);
  const makeSeed = () => seed.map((u, i) => ({ ...u, id: u.id || i + 1, status: u.status || 'Active',
    pw: seedPw ? hashPassword(seedPw) : null, mustChange: !seedPw }));

  const readAll = async () => { await db.ensureSeed(makeSeed); return db.list(); };
  const find    = async email => { await db.ensureSeed(makeSeed); return db.findByEmail(email); };
  const save    = async (u, patch) => { await db.update(u.id, patch); return Object.assign(u, patch); };

  return {
    async list() { return (await readAll()).map(publicUser); },

    /** โหมดเดโมเปิดอยู่ไหม — หน้าเข้าสู่ระบบเอาไปบอกผู้ใช้ว่ารหัสเดโมคืออะไร */
    demoMode() { return !!seedPw; },

    /** ยังไม่มีใครในระบบมีรหัสผ่านเลย = ยังไม่ได้ตั้งค่าครั้งแรก
     *  ใช้เปิดทาง "ตั้งรหัสแอดมินคนแรก" โดยไม่ต้องมีโทเคน (ไม่งั้นไม่มีใครเข้าได้เลย)
     *  พอมีคนแรกมีรหัสแล้ว ประตูนี้ปิดถาวร */
    async bootstrapNeeded() { return (await readAll()).every(u => !(u.pw && u.pw.hash)); },

    async get(email) { const u = await find(email); return u ? publicUser(u) : null; },

    /** เข้าสู่ระบบ — คืนโทเคน และบอกว่าต้องเปลี่ยนรหัสก่อนใช้งานไหม */
    async login(email, password) {
      const u = await find(email);
      // ข้อความเดียวกันทุกกรณี ไม่บอกว่าอีเมลมีจริงไหม (กันไล่เดาบัญชี)
      const deny = { ok: false, code: 401, error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' };
      if (!u || u.status === 'Suspended') return deny;
      if (u.lockUntil && u.lockUntil > Date.now())
        return { ok: false, code: 423, error: 'กรอกผิดหลายครั้ง บัญชีถูกล็อกชั่วคราว ลองใหม่ภายหลัง' };
      if (!u.pw) return { ok: false, code: 403, error: 'บัญชีนี้ยังไม่ได้ตั้งรหัสผ่าน ติดต่อผู้ดูแลระบบ' };
      if (!verifyPassword(password, u.pw)) {
        const fails = (u.fails || 0) + 1;
        await save(u, fails >= MAX_FAILS ? { fails: 0, lockUntil: Date.now() + LOCK_MS } : { fails });
        return deny;
      }
      await save(u, { fails: 0, lockUntil: 0, last: new Date().toISOString().slice(0, 16).replace('T', ' ') });
      return { ok: true, token: makeToken(u, secret), user: publicUser(u), mustChange: !!u.mustChange };
    },

    /** ผู้ใช้เปลี่ยนรหัสของตัวเอง — ต้องรู้รหัสเดิม · เปลี่ยนแล้วล้างธง "ต้องเปลี่ยน" */
    async changePassword(email, oldPw, newPw) {
      const u = await find(email);
      if (!u || !u.pw) return { ok: false, code: 404, error: 'ไม่พบบัญชี' };
      if (!verifyPassword(oldPw, u.pw)) return { ok: false, code: 401, error: 'รหัสผ่านเดิมไม่ถูกต้อง' };
      const st = checkStrength(newPw); if (!st.ok) return { ok: false, code: 400, error: st.error };
      if (verifyPassword(newPw, u.pw)) return { ok: false, code: 400, error: 'รหัสใหม่ต้องไม่ซ้ำกับรหัสเดิม' };
      await save(u, { pw: hashPassword(newPw), mustChange: false, fails: 0, lockUntil: 0 });
      return { ok: true, token: makeToken(u, secret), user: publicUser(u) };
    },

    /** แอดมินตั้ง/รีเซ็ตรหัสให้ — ไม่ต้องรู้รหัสเดิม · ผู้ใช้ต้องเปลี่ยนตอนเข้าครั้งถัดไป */
    async setPassword(email, newPw) {
      const u = await find(email);
      if (!u) return { ok: false, code: 404, error: 'ไม่พบบัญชี' };
      const pw = newPw || tempPassword();
      const st = checkStrength(pw); if (!st.ok) return { ok: false, code: 400, error: st.error };
      await save(u, { pw: hashPassword(pw), mustChange: true, fails: 0, lockUntil: 0 });
      return { ok: true, password: pw, user: publicUser(u) };   // คืนรหัสให้แอดมินส่งต่อ (เห็นครั้งเดียว)
    },

    async create(rec) {
      const name = rec && rec.name, email = rec && rec.email, role = rec && rec.role;
      const taken = { ok: false, code: 409, error: 'อีเมลนี้มีบัญชีอยู่แล้ว' };
      if (!name || !String(name).trim()) return { ok: false, code: 400, error: 'ต้องใส่ชื่อ' };
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email || ''))) return { ok: false, code: 400, error: 'อีเมลไม่ถูกต้อง' };
      if (await find(email)) return taken;
      if (ROLES.indexOf(role) < 0) return { ok: false, code: 400, error: 'บทบาทไม่ถูกต้อง' };
      const pw = (rec && rec.password) || tempPassword();
      const st = checkStrength(pw); if (!st.ok) return { ok: false, code: 400, error: st.error };
      let u;
      try {
        u = await db.insert({ name: String(name).trim(),
                  email: String(email).trim().toLowerCase(), role, province: (rec && rec.province) || null,
                  status: 'Active', pw: hashPassword(pw), mustChange: true, last: '—' });
      } catch (e) {
        if (e && e.duplicate) return taken;
        throw e;
      }
      return { ok: true, password: pw, user: publicUser(u) };
    },

    async update(email, patch, actorEmail) {
      const u = await find(email);
      const p = patch || {};
      if (!u) return { ok: false, code: 404, error: 'ไม่พบบัญชี' };
      if (p.role && ROLES.indexOf(p.role) < 0) return { ok: false, code: 400, error: 'บทบาทไม่ถูกต้อง' };
      if (p.status && STATUSES.indexOf(p.status) < 0) return { ok: false, code: 400, error: 'สถานะไม่ถูกต้อง' };
      const next = {};
      if (p.name !== undefined) next.name = String(p.name).trim() || u.name;
      if (p.role) next.role = p.role;
      if (p.province !== undefined) next.province = p.province || null;
      if (p.status) next.status = p.status;
      const role = next.role || u.role, status = next.status || u.status || 'Active';
      if (role !== u.role || status !== (u.status || 'Active')) {
        if (actorEmail && String(u.email).toLowerCase() === String(actorEmail).toLowerCase())
          return { ok: false, code: 400, error: 'แก้บทบาทหรือสถานะของตัวเองไม่ได้' };
        const wasAdmin = u.role === 'Administrator' && u.status !== 'Suspended';
        const staysAdmin = role === 'Administrator' && status !== 'Suspended';
        if (wasAdmin && !staysAdmin) {
          const admins = (await readAll()).filter(x => x.role === 'Administrator' && x.status !== 'Suspended');
          if (admins.length <= 1) return { ok: false, code: 400, error: 'ต้องเหลือผู้ดูแลระบบอย่างน้อย 1 คน' };
        }
      }
      if (Object.keys(next).length) await save(u, next);
      return { ok: true, user: publicUser(u) };
    },

    async remove(email, actorEmail) {
      const users = await readAll();
      const u = findBy(users, email);
      if (!u) return { ok: false, code: 404, error: 'ไม่พบบัญชี' };
      if (String(email).toLowerCase() === String(actorEmail || '').toLowerCase())
        return { ok: false, code: 400, error: 'ลบบัญชีตัวเองไม่ได้' };
      const admins = users.filter(x => x.role === 'Administrator' && x.status !== 'Suspended');
      if (u.role === 'Administrator' && admins.length <= 1)
        return { ok: false, code: 400, error: 'ต้องเหลือผู้ดูแลระบบอย่างน้อย 1 คน' };
      await db.remove(u.id);
      return { ok: true };
    },

    /** ตรวจโทเคนจาก header — ด่านหน้าของทุก endpoint ที่ต้องมีตัวตน */
    async auth(headers, needRole) {
      const raw = (headers && (headers.authorization || headers.Authorization)) || '';
      const m = /^Bearer\s+(.+)$/.exec(raw);
      const p = m ? readToken(m[1].trim(), secret) : null;
      if (!p) return { ok: false, code: 401, error: 'ต้องเข้าสู่ระบบก่อน' };
      const u = await find(p.email);
      if (!u || u.status === 'Suspended') return { ok: false, code: 401, error: 'บัญชีใช้งานไม่ได้แล้ว' };
      // บทบาทอ่านจากฐานข้อมูล ไม่ใช่จากโทเคน — แอดมินถอดสิทธิ์แล้วต้องมีผลทันที
      if (needRole && u.role !== needRole) return { ok: false, code: 403, error: 'ไม่มีสิทธิ์ใช้คำสั่งนี้' };
      return { ok: true, user: publicUser(u) };
    },
  };
}

module.exports = { makeAuthStore, fileAdapter, hashPassword, verifyPassword, checkStrength, tempPassword,
                   makeToken, readToken, ROLES, USERS_FILE, MIN_PW, MAX_FAILS, LOCK_MS, TOKEN_TTL };
