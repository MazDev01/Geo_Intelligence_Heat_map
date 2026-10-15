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
const pbkdf2 = require('util').promisify(crypto.pbkdf2);
async function hashPasswordAsync(pw) {
  const s = crypto.randomBytes(16).toString('hex');
  const h = await pbkdf2(String(pw), s, ITERATIONS, KEYLEN, 'sha256');
  return { salt: s, hash: h.toString('hex'), iter: ITERATIONS };
}
async function verifyPasswordAsync(pw, rec) {
  if (!rec || !rec.hash || !rec.salt) return false;
  const h = await pbkdf2(String(pw), rec.salt, rec.iter || ITERATIONS, KEYLEN, 'sha256');
  const want = Buffer.from(rec.hash, 'hex');
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
  const now = Date.now();
  const body = b64u(JSON.stringify({ email: user.email, role: user.role, iat: now, exp: now + (ttl || TOKEN_TTL) }));
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
const EMAIL_RE = /^[a-z0-9_%+-]+(?:\.[a-z0-9_%+-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;
const publicUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, province: u.province || null,
                           status: u.status || 'Active', mustChange: !!u.mustChange,
                           scope: u.scope || (u.role === 'Trade Coordinator' ? 'own_area' : 'national'),
                           permOverrides: u.overrides || {},
                           color: u.color || null,
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
  const P = o.perms || null;

  const db = typeof adapter.findByEmail === 'function' ? adapter : fileAdapter(adapter);
  const makeSeed = () => seed.map((u, i) => ({ ...u, id: u.id || i + 1, status: u.status || 'Active',
    pw: seedPw ? hashPassword(seedPw) : null, mustChange: !seedPw }));

  const readAll = async () => { await db.ensureSeed(makeSeed); return db.list(); };
  const find    = async email => { await db.ensureSeed(makeSeed); return db.findByEmail(email); };
  const save    = async (u, patch) => { await db.update(u.id, patch); return Object.assign(u, patch); };
  const LOCKED = { ok: false, code: 423, error: 'กรอกผิดหลายครั้ง บัญชีถูกล็อกชั่วคราว ลองใหม่ภายหลัง' };
  const isLocked = u => !!(u.lockUntil && u.lockUntil > Date.now());
  const lockNow = u => save(u, { fails: 0, lockUntil: Date.now() + LOCK_MS });
  const reserve = async u => {
    if (typeof db.reserveAttempt === 'function') return db.reserveAttempt(u.id);
    if (isLocked(u)) return 0;
    const n = (u.fails || 0) + 1;
    await save(u, { fails: n });
    return n;
  };
  const holdsGuard = x => (x.status || 'Active') !== 'Suspended' && P.effectivePerms(x.role, x.overrides || {}).has(P.GUARD_KEY);
  const adminGuard = async (actorEmail, role, overrides) => {
    if (!P || !actorEmail || role !== 'Administrator') return null;
    const actor = await find(actorEmail);
    if (!actor) return null;
    const ap = P.effectivePerms(actor.role, actor.overrides || {});
    if (!ap.has(P.GUARD_KEY)) return { ok: false, code: 403, error: 'ไม่มีสิทธิ์ทำรายการนี้ (' + P.GUARD_KEY + ')' };
    const over = [...P.effectivePerms(role, overrides || {})].find(k => !ap.has(k));
    return over ? { ok: false, code: 400, error: 'ให้สิทธิ์เกินสิทธิ์ของตัวเองไม่ได้: ' + over } : null;
  };
  const checkPw = async (u, pw) => {
    if (isLocked(u)) return 'locked';
    const n = await reserve(u);
    if (!n || n > MAX_FAILS) { if (n) await lockNow(u); return 'locked'; }
    if (await verifyPasswordAsync(pw, u.pw)) return 'ok';
    if (n >= MAX_FAILS) await lockNow(u);
    return 'wrong';
  };

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
      if (!u) return deny;
      const suspended = u.status === 'Suspended';
      if (isLocked(u)) return suspended ? deny : LOCKED;
      if (!u.pw) return suspended ? deny : { ok: false, code: 403, error: 'บัญชีนี้ยังไม่ได้ตั้งรหัสผ่าน ติดต่อผู้ดูแลระบบ' };
      const got = await checkPw(u, password);
      if (got === 'locked') return suspended ? deny : LOCKED;
      if (got !== 'ok') return deny;
      if (suspended) {
        await save(u, { fails: 0, lockUntil: 0 });
        return { ok: false, code: 403, reason: 'suspended', error: 'บัญชีนี้ถูกระงับ กรุณาติดต่อผู้ดูแลระบบ' };
      }
      await save(u, { fails: 0, lockUntil: 0, last: new Date().toISOString().slice(0, 16).replace('T', ' ') });
      return { ok: true, token: makeToken(u, secret), user: publicUser(u), mustChange: !!u.mustChange };
    },

    /** ผู้ใช้เปลี่ยนรหัสของตัวเอง — ต้องรู้รหัสเดิม · เปลี่ยนแล้วล้างธง "ต้องเปลี่ยน" */
    async changePassword(email, oldPw, newPw) {
      const u = await find(email);
      if (!u || !u.pw) return { ok: false, code: 404, error: 'ไม่พบบัญชี' };
      const got = await checkPw(u, oldPw);
      if (got === 'locked') return LOCKED;
      if (got !== 'ok') return { ok: false, code: 401, error: 'รหัสผ่านเดิมไม่ถูกต้อง' };
      await save(u, { fails: 0 });
      const st = checkStrength(newPw); if (!st.ok) return { ok: false, code: 400, error: st.error };
      if (await verifyPasswordAsync(newPw, u.pw)) return { ok: false, code: 400, error: 'รหัสใหม่ต้องไม่ซ้ำกับรหัสเดิม' };
      await save(u, { pw: await hashPasswordAsync(newPw), mustChange: false, fails: 0, lockUntil: 0, tokensValidAfter: Date.now() });
      return { ok: true, token: makeToken(u, secret), user: publicUser(u) };
    },

    /** แอดมินตั้ง/รีเซ็ตรหัสให้ — ไม่ต้องรู้รหัสเดิม · ผู้ใช้ต้องเปลี่ยนตอนเข้าครั้งถัดไป */
    async setPassword(email, newPw, actorEmail) {
      const u = await find(email);
      if (!u) return { ok: false, code: 404, error: 'ไม่พบบัญชี' };
      if (actorEmail && String(actorEmail).toLowerCase() !== String(u.email).toLowerCase()) {
        const g = await adminGuard(actorEmail, u.role, u.overrides);
        if (g) return g;
      }
      const pw = newPw || tempPassword();
      const st = checkStrength(pw); if (!st.ok) return { ok: false, code: 400, error: st.error };
      await save(u, { pw: await hashPasswordAsync(pw), mustChange: true, fails: 0, lockUntil: 0, tokensValidAfter: Date.now() });
      return { ok: true, password: pw, user: publicUser(u) };   // คืนรหัสให้แอดมินส่งต่อ (เห็นครั้งเดียว)
    },

    /** ยกเลิกโทเคนทุกใบที่ออกก่อนตอนนี้ — ใช้ตอนออกจากระบบ (มีผลกับทุกอุปกรณ์ของบัญชีนี้) */
    async revokeTokens(email) {
      const u = await find(email);
      if (!u) return { ok: false, code: 404, error: 'ไม่พบบัญชี' };
      await save(u, { tokensValidAfter: Date.now() });
      return { ok: true };
    },

    async create(rec, actorEmail) {
      const name = rec && rec.name, email = rec && rec.email, role = rec && rec.role;
      const taken = { ok: false, code: 409, error: 'อีเมลนี้มีบัญชีอยู่แล้ว' };
      if (!name || !String(name).trim()) return { ok: false, code: 400, error: 'ต้องใส่ชื่อ' };
      if (!EMAIL_RE.test(String(email || ''))) return { ok: false, code: 400, error: 'อีเมลไม่ถูกต้อง' };
      if (await find(email)) return taken;
      if (ROLES.indexOf(role) < 0) return { ok: false, code: 400, error: 'บทบาทไม่ถูกต้อง' };
      const g = await adminGuard(actorEmail, role);
      if (g) return g;
      const pw = (rec && rec.password) || tempPassword();
      const st = checkStrength(pw); if (!st.ok) return { ok: false, code: 400, error: st.error };
      let u;
      try {
        u = await db.insert({ name: String(name).trim(),
                  email: String(email).trim().toLowerCase(), role, province: (rec && rec.province) || null,
                  status: 'Active', pw: await hashPasswordAsync(pw), mustChange: true, last: '—' });
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
      if (p.name !== undefined) {
        const nm = String(p.name).trim();
        if (!nm) return { ok: false, code: 400, error: 'ต้องใส่ชื่อ' };
        next.name = nm;
      }
      if (p.role) next.role = p.role;
      if (p.province !== undefined) next.province = p.province || null;
      if (p.color !== undefined) {
        const c = p.color === null || p.color === '' ? null : String(p.color).trim().toLowerCase();
        if (c !== null && !/^#[0-9a-f]{6}$/.test(c)) return { ok: false, code: 400, error: 'สีไม่ถูกต้อง ต้องเป็นแบบ #rrggbb' };
        if (c !== (u.color || null)) next.color = c;
      }
      if (p.status) next.status = p.status;
      const role = next.role || u.role, status = next.status || u.status || 'Active';
      const isSelf = !!actorEmail && String(u.email).toLowerCase() === String(actorEmail).toLowerCase();
      const wantsPerm = p.scope !== undefined || p.overrides !== undefined;
      if (wantsPerm && !P) return { ok: false, code: 400, error: 'เซิร์ฟเวอร์นี้ไม่รองรับการตั้งสิทธิ์รายบุคคล' };
      if (wantsPerm && isSelf) return { ok: false, code: 400, error: 'แก้สิทธิ์ของตัวเองไม่ได้' };
      if (p.email !== undefined) {
        const ne = String(p.email).trim().toLowerCase();
        if (ne !== String(u.email).toLowerCase()) {
          if (isSelf) return { ok: false, code: 400, error: 'เปลี่ยนอีเมลของตัวเองไม่ได้' };
          if (!EMAIL_RE.test(ne)) return { ok: false, code: 400, error: 'อีเมลไม่ถูกต้อง' };
          const clash = await find(ne);
          if (clash && clash.id !== u.id) return { ok: false, code: 409, error: 'อีเมลนี้มีบัญชีอยู่แล้ว' };
          next.email = ne;
        }
      }
      if (role !== u.role || status !== (u.status || 'Active')) {
        if (isSelf) return { ok: false, code: 400, error: 'แก้บทบาทหรือสถานะของตัวเองไม่ได้' };
        const wasAdmin = u.role === 'Administrator' && u.status !== 'Suspended';
        const staysAdmin = role === 'Administrator' && status !== 'Suspended';
        if (wasAdmin && !staysAdmin) {
          const admins = (await readAll()).filter(x => x.role === 'Administrator' && x.status !== 'Suspended');
          if (admins.length <= 1) return { ok: false, code: 400, error: 'ต้องเหลือผู้ดูแลระบบอย่างน้อย 1 คน' };
        }
      }
      if (P) {
        const bad = error => ({ ok: false, code: 400, error });
        const curOv = u.overrides || {};
        const curScope = u.scope || P.DEFAULT_SCOPE[u.role];
        let nextScope = curScope, nextOv = curOv;
        if (p.scope !== undefined) {
          if (!P.SCOPES.some(s => s.key === p.scope)) return bad('ขอบเขตข้อมูลไม่ถูกต้อง');
          nextScope = p.scope;
        } else if (role !== u.role) nextScope = P.DEFAULT_SCOPE[role];
        if (p.overrides !== undefined) {
          if (!p.overrides || typeof p.overrides !== 'object' || Array.isArray(p.overrides)) return bad('สิทธิ์รายบุคคลต้องเป็นอ็อบเจ็กต์');
          for (const [k, v] of Object.entries(p.overrides)) {
            if (!Object.hasOwn(P.PERM_INDEX, k)) return bad('ไม่รู้จักสิทธิ์: ' + k.slice(0, 60));
            if (typeof v !== 'boolean') return bad('ค่าสิทธิ์ต้องเป็นจริงหรือเท็จ: ' + k);
            if (v && P.roleForbids(k, role)) return bad('บทบาทนี้ถือสิทธิ์นี้ไม่ได้: ' + k);
          }
          nextOv = P.realOverrides(role, p.overrides);
        } else if (role !== u.role) nextOv = P.realOverrides(role, curOv);

        const sameOv = (a, b) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => a[k] === b[k]);
        const roleChanged = role !== u.role, ovChanged = !sameOv(nextOv, curOv), scopeChanged = nextScope !== curScope;
        const statusChanged = status !== (u.status || 'Active');
        const infoChanged = (next.name !== undefined && next.name !== u.name) || (next.province !== undefined && next.province !== (u.province || null))
          || next.email !== undefined || next.color !== undefined;

        const actor = actorEmail ? await find(actorEmail) : null;
        if (actor) {
          const ap = P.effectivePerms(actor.role, actor.overrides || {});
          const need = [];
          if (roleChanged || ovChanged) need.push(P.GUARD_KEY);
          if (scopeChanged) need.push('user.assign_scope');
          if (statusChanged) need.push('user.set_active');
          if (infoChanged) need.push('user.manage');
          const lacking = need.find(k => !ap.has(k));
          if (lacking) return { ok: false, code: 403, error: 'ไม่มีสิทธิ์ทำรายการนี้ (' + lacking + ')' };
          const over = Object.keys(nextOv).find(k => nextOv[k] === true && curOv[k] !== true && !ap.has(k));
          if (over) return bad('ให้สิทธิ์เกินสิทธิ์ของตัวเองไม่ได้: ' + over);
        }

        if (roleChanged || ovChanged || statusChanged) {
          const holds = (r, ov, s) => s !== 'Suspended' && P.effectivePerms(r, ov).has(P.GUARD_KEY);
          if (holds(u.role, curOv, u.status || 'Active')) {
            const all = await readAll();
            const left = all.filter(x => x.id === u.id ? holds(role, nextOv, status) : holds(x.role, x.overrides || {}, x.status || 'Active'));
            if (!left.length) return bad('ต้องเหลือผู้ให้สิทธิ์อย่างน้อย 1 คน');
          }
        }
        if (scopeChanged) next.scope = nextScope;
        if (ovChanged) next.overrides = nextOv;
      }
      if (next.email !== undefined || (next.status === 'Suspended' && (u.status || 'Active') !== 'Suspended')) next.tokensValidAfter = Date.now();
      if (Object.keys(next).length) {
        try { await save(u, next); }
        catch (e) { if (e && e.code === '23505') return { ok: false, code: 409, error: 'อีเมลนี้มีบัญชีอยู่แล้ว' }; throw e; }
      }
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
      if (P && holdsGuard(u) && !users.some(x => x.id !== u.id && holdsGuard(x)))
        return { ok: false, code: 400, error: 'ต้องเหลือผู้ให้สิทธิ์อย่างน้อย 1 คน' };
      await db.remove(u.id);
      return { ok: true };
    },

    /** ตรวจโทเคนจาก header — ด่านหน้าของทุก endpoint ที่ต้องมีตัวตน */
    async auth(headers, needRole, opts) {
      const raw = (headers && (headers.authorization || headers.Authorization)) || '';
      const m = /^Bearer\s+(.+)$/.exec(raw);
      const p = m ? readToken(m[1].trim(), secret) : null;
      if (!p) return { ok: false, code: 401, error: 'ต้องเข้าสู่ระบบก่อน' };
      const u = await find(p.email);
      if (!u || u.status === 'Suspended') return { ok: false, code: 401, error: 'บัญชีใช้งานไม่ได้แล้ว' };
      if (u.tokensValidAfter && !(p.iat >= u.tokensValidAfter))
        return { ok: false, code: 401, error: 'เซสชันนี้ถูกยกเลิกแล้ว กรุณาเข้าสู่ระบบใหม่' };
      if (u.mustChange && !(opts && opts.allowMustChange))
        return { ok: false, code: 403, reason: 'must_change', error: 'กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน' };
      // บทบาทอ่านจากฐานข้อมูล ไม่ใช่จากโทเคน — แอดมินถอดสิทธิ์แล้วต้องมีผลทันที
      if (needRole && u.role !== needRole) return { ok: false, code: 403, error: 'ไม่มีสิทธิ์ใช้คำสั่งนี้' };
      return { ok: true, user: publicUser(u) };
    },
  };
}

module.exports = { makeAuthStore, fileAdapter, hashPassword, verifyPassword, checkStrength, tempPassword,
                   makeToken, readToken, ROLES, USERS_FILE, MIN_PW, MAX_FAILS, LOCK_MS, TOKEN_TTL };
