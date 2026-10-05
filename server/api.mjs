import {createRequire} from 'node:module';
import {withTransaction} from './db/pool.mjs';
import {listPlaces} from './places.mjs';

const require = createRequire(import.meta.url);
const {MAX_BYTES} = require('../zone-validate.cjs');

const DOOR_ROLE = {admin: 'Administrator', management: 'Management', tc: 'Trade Coordinator'};

const send = (res, code, obj) => {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(obj === undefined ? '' : JSON.stringify(obj));
};

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const e = new Error('payload too large');
      e.status = 413;
      throw e;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function makeApi({pool, authStore, zoneStore, demoPassword}) {
  async function auth(req, res) {
    if (req.method !== 'POST') return send(res, 405, {error: 'ใช้ POST เท่านั้น'});
    let body;
    try { body = JSON.parse((await readBody(req, 1e6)) || '{}'); }
    catch (e) { return send(res, e.status === 413 ? 413 : 400, {error: e.status === 413 ? 'ข้อมูลใหญ่เกินไป' : 'อ่านคำขอไม่ได้'}); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, {error: 'อ่านคำขอไม่ได้'});

    const action = String(body.action || '');
    const reply = r => send(res, r && r.ok ? 200 : ((r && r.code) || 400), r);

    if (action === 'login') {
      const door = body.door;
      if (door !== undefined && door !== null && !Object.hasOwn(DOOR_ROLE, door))
        return send(res, 400, {ok: false, error: 'ประตูเข้าสู่ระบบไม่ถูกต้อง'});
      const r = await authStore.login(body.email, body.password);
      if (r.ok && door && r.user.role !== DOOR_ROLE[door])
        return send(res, 401, {ok: false, code: 401, error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'});
      return reply(r);
    }
    if (action === 'change') {
      const who = await authStore.auth(req.headers);
      if (!who.ok) return send(res, who.code, who);
      return reply(await authStore.changePassword(who.user.email, body.oldPassword, body.newPassword));
    }
    if (action === 'bootstrap') {
      if (!(await authStore.bootstrapNeeded())) return send(res, 403, {ok: false, error: 'ระบบตั้งค่าครั้งแรกไปแล้ว'});
      const target = await authStore.get(body.email);
      if (!target || target.role !== 'Administrator') return send(res, 400, {ok: false, error: 'ตั้งได้เฉพาะบัญชีผู้ดูแลระบบ'});
      return reply(await authStore.setPassword(body.email, body.password));
    }
    if (action === 'info')
      return send(res, 200, {ok: true, demo: authStore.demoMode(), demoPassword: authStore.demoMode() ? demoPassword : ''});
    if (action === 'me') {
      const who = await authStore.auth(req.headers);
      return send(res, who.ok ? 200 : who.code, who);
    }

    const admin = await authStore.auth(req.headers, 'Administrator');
    if (!admin.ok) return send(res, admin.code, admin);
    if (action === 'users.list') return send(res, 200, {ok: true, users: await authStore.list()});
    if (action === 'users.create') return reply(await authStore.create(body));
    if (action === 'users.update') return reply(await authStore.update(body.email, body.patch, admin.user.email));
    if (action === 'users.remove') return reply(await authStore.remove(body.email, admin.user.email));
    if (action === 'users.password') return reply(await authStore.setPassword(body.email, body.password));
    return send(res, 400, {error: 'ไม่รู้จักคำสั่ง: ' + action.slice(0, 40)});
  }

  async function requireUser(req, res, role) {
    const who = await authStore.auth(req.headers, role);
    if (who.ok) return who.user;
    send(res, who.code, {error: who.error});
    return null;
  }

  async function zones(req, res, query) {
    const reply = r => (r && r.ok) ? send(res, 200, r) : send(res, (r && r.code) || 500, r || {error: 'ไม่สำเร็จ'});

    if (req.method === 'GET') {
      if (query.get('history') || query.get('version') || query.get('draft')) {
        if (!(await requireUser(req, res, 'Administrator'))) return;
        if (query.get('history')) return send(res, 200, {versions: await zoneStore.listHistory()});
        if (query.get('version')) {
          const v = await zoneStore.getVersion(query.get('version'));
          return v ? send(res, 200, v) : send(res, 404, {error: 'ไม่พบฉบับนี้'});
        }
        const draft = await zoneStore.readDraft();
        return draft ? send(res, 200, draft) : send(res, 204);
      }
      const gj = await zoneStore.readPublished();
      return gj ? send(res, 200, gj) : send(res, 204);
    }

    if (req.method === 'POST') {
      const admin = await requireUser(req, res, 'Administrator');
      if (!admin) return;
      if (query.get('approve')) return reply(await zoneStore.approve(admin.id));
      if (query.get('discard')) return reply(await zoneStore.discardDraft());
      if (query.get('restore')) return reply(await zoneStore.restore(query.get('restore'), admin.id));
      let raw;
      try { raw = await readBody(req, MAX_BYTES * 2); }
      catch (e) { if (e.status === 413) return send(res, 413, {error: 'ไฟล์ใหญ่เกิน'}); throw e; }
      return reply(query.get('publish') ? await zoneStore.publish(raw, admin.id) : await zoneStore.saveDraft(raw, admin.id));
    }

    return send(res, 405, {error: 'รองรับเฉพาะ GET กับ POST'});
  }

  async function zonesFile(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, {error: 'รองรับเฉพาะ GET'});
    const gj = await zoneStore.readPublished();
    return gj ? send(res, 200, gj) : send(res, 404, {error: 'ยังไม่มีโซน'});
  }

  async function territory(req, res) {
    if (req.method === 'GET') {
      if (!(await requireUser(req, res))) return;
      const r = await pool.query('select key, user_id, assigned_at from territory_assign order by key');
      const assign = {};
      let latest = null;
      for (const row of r.rows) {
        assign[row.key] = row.user_id;
        if (!latest || row.assigned_at > latest) latest = row.assigned_at;
      }
      return send(res, 200, {assign, updatedAt: latest ? latest.toISOString() : null});
    }

    if (req.method === 'POST') {
      const admin = await requireUser(req, res, 'Administrator');
      if (!admin) return;
      let body;
      try { body = JSON.parse(await readBody(req, 1e6)); }
      catch (e) { return send(res, e.status === 413 ? 413 : 400, {error: e.status === 413 ? 'payload ใหญ่เกิน' : 'JSON ไม่ถูกต้อง'}); }
      const a = body && body.assign;
      if (!a || typeof a !== 'object' || Array.isArray(a)) return send(res, 400, {error: 'ต้องมีฟิลด์ assign เป็น object'});
      const clean = [];
      for (const [k, v] of Object.entries(a)) {
        if (!k || k.length > 120) return send(res, 400, {error: 'คีย์หน่วยไม่ถูกต้อง: ' + k.slice(0, 120)});
        const n = Number(v);
        if (!Number.isInteger(n)) return send(res, 400, {error: 'id ของ TC ต้องเป็นจำนวนเต็ม: ' + k});
        clean.push([k, k.includes('/') ? 'zone' : 'province', n]);
      }
      try {
        await withTransaction(pool, async tx => {
          await tx.query('lock table territory_assign in share row exclusive mode');
          await tx.query('delete from territory_assign');
          for (const [key, kind, userId] of clean)
            await tx.query('insert into territory_assign (key, kind, user_id, assigned_by) values ($1, $2, $3, $4)',
              [key, kind, userId, admin.id]);
        });
      } catch (e) {
        if (e && e.code === '23503') return send(res, 400, {error: 'มี id ของ TC ที่ไม่มีบัญชีอยู่ในระบบ'});
        throw e;
      }
      return send(res, 200, {ok: true, saved: clean.length, updatedAt: new Date().toISOString()});
    }

    return send(res, 405, {error: 'รองรับเฉพาะ GET กับ POST'});
  }

  async function visitPlans(req, res, query) {
    if (req.method !== 'GET') return send(res, 405, {error: 'รองรับเฉพาะ GET'});
    const who = await authStore.auth(req.headers);
    if (!who.ok) return send(res, 401, {error: 'unauthenticated', message: 'ต้องเข้าสู่ระบบก่อน'});
    const user = who.user;
    if (user.role !== 'Trade Coordinator') return send(res, 403, {error: 'forbidden', message: 'เฉพาะผู้ประสานงานการค้าเท่านั้น'});
    const owner = query.get('owner');
    if (owner && owner.toLowerCase() !== user.email.toLowerCase())
      return send(res, 403, {error: 'forbidden', message: 'เรียกดูได้เฉพาะแผนของตนเอง'});
    const prov = query.get('province');
    if (prov && prov !== user.province) return send(res, 403, {error: 'forbidden', message: 'เรียกดูได้เฉพาะจังหวัดที่รับผิดชอบ'});
    return send(res, 200, {ok: true, owner: user.email, province: user.province});
  }

  const places = kind => async (req, res, query) => {
    if (req.method !== 'GET') return send(res, 405, {error: 'รองรับเฉพาะ GET'});
    const user = await requireUser(req, res);
    if (!user) return;
    return send(res, 200, await listPlaces(pool, kind, user, query.get('country')));
  };

  const ROUTES = {
    '/api/auth': (req, res) => auth(req, res),
    '/api/customers': places('customers'),
    '/api/leads': places('leads'),
    '/api/zones': zones,
    '/api/territory': (req, res) => territory(req, res),
    '/api/visit-plans': visitPlans,
    '/data/zones.geojson': (req, res) => zonesFile(req, res),
  };

  return {
    has: path => path.startsWith('/api/') || Object.hasOwn(ROUTES, path),
    async handle(req, res, path, query) {
      const route = Object.hasOwn(ROUTES, path) ? ROUTES[path] : null;
      if (!route) return send(res, 404, {error: 'ไม่พบ API นี้'});
      try {
        await route(req, res, query);
      } catch (e) {
        console.error('[api] ' + path + ':', e);
        if (res.headersSent) return res.destroy();
        send(res, 500, {error: 'เซิร์ฟเวอร์ผิดพลาด'});
      }
    },
  };
}
