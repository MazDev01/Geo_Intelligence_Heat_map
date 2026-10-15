import {createRequire} from 'node:module';
import {gzipSync, gunzip} from 'node:zlib';
import {promisify} from 'node:util';
import {withTransaction} from './db/pool.mjs';
import {auditCtx, clientIp, writeAudit, listAudit} from './audit.mjs';
import {listPlaces, placesScope, createPlaces, updatePlace, deletePlace} from './places.mjs';
import {importUpload, mapUpload, confirmUpload, listFiles, withdrawFile} from './imports.mjs';
import {listQueue, actOnQueue} from './import-queue.mjs';
import {listPlans, listTeam, listTeamPlans, createPlan, updatePlan, deletePlan} from './visit-plans.mjs';
import {addPlaceVisit} from './place-visits.mjs';
import {listRequests, submitRequest, approveRequest, rejectRequests, undoRequest, readRequestFile, MAX_DEAL_FILE_BYTES} from './lead-requests.mjs';
import {cleanFilename, fileKind, MAX_FILE_BYTES} from './import-parse.mjs';
import {readSettings, writeSettings, readPrefs, writePrefs, SETTING_PERMS} from './settings.mjs';
import {readStats, STAT_FILES} from './stats.mjs';
import {readMaster, writeMaster} from './master-data.mjs';
import {notify, listNotifications, markRead, ensureWeekly} from './notifications.mjs';
import {MAX_BODY, MAX_ROWS, readRequest, checkSource, cleanName, dataRows, buildFile, disposition, sourceRows, sourceFilters} from './exports.mjs';

const require = createRequire(import.meta.url);
const {MAX_BYTES} = require('../zone-validate.cjs');

const gunzipAsync = promisify(gunzip);

const DOOR_ROLE = {admin: 'Administrator', management: 'Management', tc: 'Trade Coordinator'};
const KEEPS_PLACES = new Set(['/api/auth', '/api/notifications', '/api/me/prefs', '/api/exports']);
const DEAL_BODY_BYTES = Math.ceil(MAX_DEAL_FILE_BYTES / 3) * 4 + 1e5;

const GZIP_MIN = 1024;
const acceptsGzip = res => /\bgzip\b/i.test((res.req && res.req.headers['accept-encoding']) || '');

const jsonHeaders = (code, extra) => ({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  Vary: 'Accept-Encoding',
  ...(code === 413 ? {Connection: 'close'} : {}),
  ...extra,
});

const sendText = (res, code, text) => {
  if (text.length >= GZIP_MIN && acceptsGzip(res)) {
    res.writeHead(code, jsonHeaders(code, {'Content-Encoding': 'gzip'}));
    return res.end(gzipSync(text));
  }
  res.writeHead(code, jsonHeaders(code));
  res.end(text);
};

const send = (res, code, obj) => sendText(res, code, obj === undefined ? '' : JSON.stringify(obj));

const sendCached = async (res, entry) => {
  if (entry.json !== undefined) return sendText(res, 200, entry.json);
  if (acceptsGzip(res)) {
    res.writeHead(200, jsonHeaders(200, {'Content-Encoding': 'gzip'}));
    return res.end(entry.gz);
  }
  const plain = await gunzipAsync(entry.gz);
  res.writeHead(200, jsonHeaders(200));
  res.end(plain);
};

async function readBytes(req, limit, discardUpTo = limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      chunks.length = 0;
      if (size > discardUpTo) break;
    } else chunks.push(chunk);
  }
  if (size > limit) {
    const e = new Error('payload too large');
    e.status = 413;
    throw e;
  }
  return Buffer.concat(chunks);
}

const readBody = async (req, limit) => (await readBytes(req, limit)).toString('utf8');

export function makeApi({pool, authStore, zoneStore, demoPassword, perms, webBootstrap = true, runtime = {}, placesCache = null}) {
  const weeklyOn = process.env.WEEKLY_SUMMARY ? process.env.WEEKLY_SUMMARY !== 'off' : process.env.NODE_ENV === 'production';
  const can = (user, key) => !perms || perms.effectivePerms(user.role, user.permOverrides || {}).has(key);

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
      const attempt = {actor: {id: null, email: String(body.email || '').trim().toLowerCase().slice(0, 200) || '-'}, ip: clientIp(req)};
      if (r.ok && door && r.user.role !== DOOR_ROLE[door]) {
        await writeAudit(pool, attempt, 'login_fail', attempt.actor.email, {reason: 'door', door});
        return send(res, 401, {ok: false, code: 401, error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'});
      }
      if (r.ok) await writeAudit(pool, auditCtx(req, r.user), 'login', r.user.email, {door: door || null});
      else await writeAudit(pool, attempt, 'login_fail', attempt.actor.email, {reason: r.code === 423 ? 'locked' : r.reason === 'suspended' ? 'suspended' : 'credentials'});
      return reply(r);
    }
    if (action === 'change') {
      const who = await authStore.auth(req.headers, null, {allowMustChange: true});
      if (!who.ok) return send(res, who.code, who);
      const r = await authStore.changePassword(who.user.email, body.oldPassword, body.newPassword);
      if (r.ok) await writeAudit(pool, auditCtx(req, who.user), 'password_change', who.user.email, {});
      return reply(r);
    }
    if (action === 'bootstrap') {
      if (!webBootstrap) return send(res, 403, {ok: false, error: 'ตั้งรหัสผู้ดูแลระบบคนแรกได้จากคำสั่งบนเครื่องเซิร์ฟเวอร์เท่านั้น'});
      if (!(await authStore.bootstrapNeeded())) return send(res, 403, {ok: false, error: 'ระบบตั้งค่าครั้งแรกไปแล้ว'});
      const target = await authStore.get(body.email);
      if (!target || target.role !== 'Administrator') return send(res, 400, {ok: false, error: 'ตั้งได้เฉพาะบัญชีผู้ดูแลระบบ'});
      return reply(await authStore.setPassword(body.email, body.password));
    }
    if (action === 'logout') {
      const who = await authStore.auth(req.headers, null, {allowMustChange: true});
      if (!who.ok) return send(res, 200, {ok: true});
      const r = await authStore.revokeTokens(who.user.email);
      if (r.ok) await writeAudit(pool, auditCtx(req, who.user), 'logout', who.user.email, {});
      return reply(r);
    }
    if (action === 'info')
      return send(res, 200, {ok: true, demo: authStore.demoMode(), demoPassword: authStore.demoMode() ? demoPassword : ''});
    if (action === 'me') {
      const who = await authStore.auth(req.headers, null, {allowMustChange: true});
      return send(res, who.ok ? 200 : who.code, who);
    }

    const admin = await authStore.auth(req.headers, 'Administrator');
    if (!admin.ok) return send(res, admin.code, admin);
    const USER_PERM = {'users.list': 'user.view', 'users.create': 'user.manage', 'users.remove': 'user.manage', 'users.password': 'user.manage', 'users.impact': 'user.manage'};
    if (Object.hasOwn(USER_PERM, action) && !can(admin.user, USER_PERM[action]))
      return send(res, 403, {ok: false, error: 'ไม่มีสิทธิ์ทำรายการนี้ (' + USER_PERM[action] + ')'});
    if (action === 'users.list') return send(res, 200, {ok: true, users: await authStore.list()});
    if (action === 'users.impact') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!email) return send(res, 400, {ok: false, error: 'ต้องระบุอีเมล'});
      const r = await pool.query(`select (select count(*)::int from visit_plans where owner_id = u.id) as plans,
          (select count(*)::int from territory_assign where user_id = u.id) as areas,
          (select count(*)::int from places where tc_owner_id = u.id and deleted_at is null) as places
        from users u where lower(u.email) = $1`, [email]);
      if (!r.rowCount) return send(res, 404, {ok: false, error: 'ไม่พบบัญชี'});
      return send(res, 200, {ok: true, ...r.rows[0]});
    }
    const ctx = auditCtx(req, admin.user);
    const done = async (r, event, target, detail) => {
      if (r && r.ok) await writeAudit(pool, ctx, event, target, detail);
      return reply(r);
    };
    const target = String(body.email || '').trim().toLowerCase();
    if (action === 'users.create') return done(await authStore.create(body, admin.user.email), 'user_create', target, {role: body.role});
    if (action === 'users.update') {
      const patch = body.patch && typeof body.patch === 'object' ? body.patch : {};
      return done(await authStore.update(body.email, body.patch, admin.user.email), 'user_update', target, {fields: Object.keys(patch)});
    }
    if (action === 'users.remove') return done(await authStore.remove(body.email, admin.user.email), 'user_remove', target, {});
    if (action === 'users.password') return done(await authStore.setPassword(body.email, body.password, admin.user.email), 'user_password_reset', target, {});
    return send(res, 400, {error: 'ไม่รู้จักคำสั่ง: ' + action.slice(0, 40)});
  }

  const denied = (res, user, key) => {
    if (can(user, key)) return false;
    send(res, 403, {error: 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้'});
    return true;
  };

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
      const ctx = auditCtx(req, admin);
      const done = async (r, event, target) => {
        if (r && r.ok) {
          await writeAudit(pool, ctx, event, target, {});
          if (r.territory && r.territory.length) {
            const n = await pool.query('select count(*)::int n from territory_assign');
            await writeAudit(pool, ctx, 'territory_assign', null, {count: n.rows[0].n, changes: r.territory, via: event});
          }
        }
        return reply(r);
      };
      if (query.get('approve')) return done(await zoneStore.approve(admin.id), 'zone_approve');
      if (query.get('discard')) return done(await zoneStore.discardDraft(), 'zone_discard');
      if (query.get('restore')) return done(await zoneStore.restore(query.get('restore'), admin.id), 'zone_restore', query.get('restore'));
      let raw;
      try { raw = await readBody(req, MAX_BYTES * 2); }
      catch (e) { if (e.status === 413) return send(res, 413, {error: 'ไฟล์ใหญ่เกิน'}); throw e; }
      return query.get('publish')
        ? done(await zoneStore.publish(raw, admin.id), 'zone_publish')
        : done(await zoneStore.saveDraft(raw, admin.id), 'zone_draft_save');
    }

    return send(res, 405, {error: 'รองรับเฉพาะ GET กับ POST'});
  }

  async function zonesFile(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, {error: 'รองรับเฉพาะ GET'});
    const gj = await zoneStore.readPublished();
    return gj ? send(res, 200, gj) : send(res, 404, {error: 'ยังไม่มีโซน'});
  }

  function runtimeConfig(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, {error: 'รองรับเฉพาะ GET'});
    res.writeHead(200, {'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
    res.end(req.method === 'HEAD' ? '' : 'window.__GEO_CONFIG = ' + JSON.stringify(runtime).replace(/</g, '\\u003c') + ';\n');
  }

  async function statsFile(req, res, name) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, {error: 'รองรับเฉพาะ GET'});
    return send(res, 200, await readStats(pool, name));
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
          const prev = await tx.query('select key, user_id from territory_assign');
          const before = new Map(prev.rows.map(r => [r.key, r.user_id]));
          const after = new Map(clean.map(([key, , userId]) => [key, userId]));
          const ids = [...new Set([...before.values(), ...after.values()])];
          const who = new Map((await tx.query('select id, name, email from users where id = any($1::int[])', [ids]))
            .rows.map(u => [u.id, `${u.name} (${u.email})`]));
          const changes = [...new Set([...before.keys(), ...after.keys()])].sort()
            .filter(key => before.get(key) !== after.get(key))
            .map(key => ({area: key,
              from: before.has(key) ? who.get(before.get(key)) || '#' + before.get(key) : null,
              to: after.has(key) ? who.get(after.get(key)) || '#' + after.get(key) : null}));
          await tx.query('delete from territory_assign');
          for (const [key, kind, userId] of clean)
            await tx.query('insert into territory_assign (key, kind, user_id, assigned_by) values ($1, $2, $3, $4)',
              [key, kind, userId, admin.id]);
          await writeAudit(tx, auditCtx(req, admin), 'territory_assign', null, {count: clean.length, changes});
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
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) return send(res, 405, {error: 'รองรับเฉพาะ GET POST PUT DELETE'});
    const who = await authStore.auth(req.headers);
    if (!who.ok) return send(res, 401, {error: 'unauthenticated', message: 'ต้องเข้าสู่ระบบก่อน'});
    const user = who.user;
    if (user.role !== 'Trade Coordinator') {
      if (req.method !== 'GET') return send(res, 403, {error: 'forbidden', message: 'เฉพาะผู้ประสานงานการค้าเท่านั้น'});
      if (denied(res, user, 'visit.view_team')) return;
      try {
        const ownerId = query.get('ownerId');
        return send(res, 200, ownerId ? await listTeamPlans(pool, ownerId) : await listTeam(pool));
      } catch (e) {
        if (e && [400, 404].includes(e.status)) return send(res, e.status, {error: e.message});
        throw e;
      }
    }
    if (denied(res, user, 'visit.manage_own')) return;
    try {
      if (req.method === 'GET') {
        const owner = query.get('owner');
        if (owner && owner.toLowerCase() !== user.email.toLowerCase())
          return send(res, 403, {error: 'forbidden', message: 'เรียกดูได้เฉพาะแผนของตนเอง'});
        const prov = query.get('province');
        if (prov && prov !== user.province) return send(res, 403, {error: 'forbidden', message: 'เรียกดูได้เฉพาะจังหวัดที่รับผิดชอบ'});
        return send(res, 200, await listPlans(pool, user));
      }
      if (req.method === 'DELETE') return send(res, 200, await deletePlan(pool, user, query.get('id'), auditCtx(req, user)));
      let body;
      try { body = JSON.parse(await readBody(req, 1e6)); }
      catch (e) { return send(res, e.status === 413 ? 413 : 400, {error: e.status === 413 ? 'ข้อมูลใหญ่เกินไป' : 'อ่านคำขอไม่ได้'}); }
      if (req.method === 'POST') return send(res, 201, await createPlan(pool, user, body, auditCtx(req, user)));
      return send(res, 200, await updatePlan(pool, user, query.get('id'), body, auditCtx(req, user)));
    } catch (e) {
      if (e && [400, 403, 404, 409].includes(e.status)) return send(res, e.status, {error: e.message});
      throw e;
    }
  }

  async function placeVisits(req, res, query) {
    if (req.method !== 'POST') return send(res, 405, {error: 'รองรับเฉพาะ POST'});
    const who = await authStore.auth(req.headers);
    if (!who.ok) return send(res, 401, {error: 'ต้องเข้าสู่ระบบก่อน'});
    if (who.user.role !== 'Trade Coordinator') return send(res, 403, {error: 'เฉพาะผู้ประสานงานการค้าเท่านั้น'});
    if (denied(res, who.user, 'visit.manage_own')) return;
    let body;
    try { body = JSON.parse(await readBody(req, 1e4)); }
    catch (e) { return send(res, e.status === 413 ? 413 : 400, {error: e.status === 413 ? 'ข้อมูลใหญ่เกินไป' : 'อ่านคำขอไม่ได้'}); }
    try {
      return send(res, 201, await addPlaceVisit(pool, who.user, query.get('id'), body, auditCtx(req, who.user)));
    } catch (e) {
      if (e && [400, 403, 404].includes(e.status)) return send(res, e.status, {error: e.message});
      throw e;
    }
  }

  const places = kind => async (req, res, query) => {
    if (req.method !== 'GET') return send(res, 405, {error: 'รองรับเฉพาะ GET'});
    const user = await requireUser(req, res);
    if (!user) return;
    if (!can(user, 'customer.view')) return send(res, 200, []);
    const country = query.get('country');
    const contact = can(user, 'map.view_contact_pii');
    const build = async () => JSON.stringify(await listPlaces(pool, kind, user, country, {contact}));
    const scope = placesScope(user);
    if (!placesCache || scope === undefined) return sendText(res, 200, await build());
    const key = JSON.stringify([kind, country || null, scope, contact]);
    return sendCached(res, await placesCache.get(key, build));
  };

  async function placesWrite(req, res, query) {
    if (!['POST', 'PUT', 'DELETE'].includes(req.method)) return send(res, 405, {error: 'รองรับเฉพาะ POST PUT DELETE'});
    const admin = await requireUser(req, res, 'Administrator');
    if (!admin) return;
    if (denied(res, admin, {POST: 'customer.create', PUT: 'customer.edit_any', DELETE: 'customer.delete'}[req.method])) return;
    const id = query.get('id') || '';
    if (req.method !== 'POST' && (!id || id.length > 20)) return send(res, 400, {error: 'ต้องระบุ id ของรายการ'});
    try {
      if (req.method === 'DELETE')
        return (await deletePlace(pool, id, auditCtx(req, admin))) ? send(res, 200, {ok: true}) : send(res, 404, {error: 'ไม่พบรายการนี้'});
      let body;
      try { body = JSON.parse(await readBody(req, 1e6)); }
      catch (e) { return send(res, e.status === 413 ? 413 : 400, {error: e.status === 413 ? 'ข้อมูลใหญ่เกินไป' : 'อ่านคำขอไม่ได้'}); }
      if (req.method === 'POST')
        return send(res, 201, {ok: true, records: await createPlaces(pool, body && body.records, auditCtx(req, admin))});
      const record = await updatePlace(pool, id, body, auditCtx(req, admin));
      return record ? send(res, 200, {ok: true, record}) : send(res, 404, {error: 'ไม่พบรายการนี้'});
    } catch (e) {
      if (e && e.status === 400) return send(res, 400, {error: e.message});
      throw e;
    }
  }

  async function leadRequests(req, res, query) {
    if (!['GET', 'POST'].includes(req.method)) return send(res, 405, {error: 'รองรับเฉพาะ GET กับ POST'});
    const who = await authStore.auth(req.headers);
    if (!who.ok) return send(res, who.code, {error: who.error});
    const user = who.user;
    const isAdmin = user.role === 'Administrator', isTc = user.role === 'Trade Coordinator';
    if (!isAdmin && !isTc) return send(res, 403, {error: 'ไม่มีสิทธิ์ใช้คำสั่งนี้'});
    try {
      if (req.method === 'GET') return send(res, 200, await listRequests(pool, user, query, {contact: can(user, 'map.view_contact_pii')}));
      const act = query.get('action') || 'submit';
      const withFile = act === 'submit' && isTc;
      const limit = withFile ? DEAL_BODY_BYTES : 1e5;
      let body;
      try { body = JSON.parse((await readBytes(req, limit, withFile ? limit * 4 : limit)).toString('utf8')); }
      catch (e) { return send(res, e.status === 413 ? 413 : 400, {error: e.status === 413 ? (withFile ? 'ไฟล์แนบใหญ่เกิน 10 MB' : 'ข้อมูลใหญ่เกินไป') : 'อ่านคำขอไม่ได้'}); }
      const ctx = auditCtx(req, user);
      if (act === 'submit') {
        if (!isTc) return send(res, 403, {error: 'เฉพาะผู้ประสานงานการค้าเท่านั้น'});
        if (denied(res, user, 'visit.manage_own')) return;
        return send(res, 201, await submitRequest(pool, user, body, ctx));
      }
      if (!isAdmin) return send(res, 403, {error: 'เฉพาะผู้ดูแลระบบเท่านั้น'});
      if (denied(res, user, 'customer.convert')) return;
      if (act === 'approve') return send(res, 200, await approveRequest(pool, user, body, ctx));
      if (act === 'reject') return send(res, 200, await rejectRequests(pool, user, body, ctx));
      if (act === 'undo') return send(res, 200, await undoRequest(pool, user, body, ctx));
      return send(res, 400, {error: 'ไม่รู้จักคำสั่ง'});
    } catch (e) {
      if (e && [400, 403, 404, 409, 413].includes(e.status)) return send(res, e.status, {error: e.message});
      throw e;
    }
  }

  async function leadRequestFile(req, res, query) {
    if (req.method !== 'GET') return send(res, 405, {error: 'รองรับเฉพาะ GET'});
    const who = await authStore.auth(req.headers);
    if (!who.ok) return send(res, who.code, {error: who.error});
    const user = who.user;
    const isAdmin = user.role === 'Administrator';
    if (!isAdmin && user.role !== 'Trade Coordinator') return send(res, 403, {error: 'ไม่มีสิทธิ์ใช้คำสั่งนี้'});
    if (denied(res, user, isAdmin ? 'customer.convert' : 'visit.manage_own')) return;
    let file;
    try { file = await readRequestFile(pool, user, query); }
    catch (e) { if (e && [400, 404].includes(e.status)) return send(res, e.status, {error: e.message}); throw e; }
    const dot = file.name.lastIndexOf('.');
    res.writeHead(200, {
      'Content-Type': file.type,
      'Content-Disposition': disposition(file.name.slice(0, dot), file.name.slice(dot + 1)),
      'Content-Length': file.body.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(file.body);
  }

  async function auditList(req, res, query) {
    if (req.method !== 'GET') return send(res, 405, {error: 'รองรับเฉพาะ GET'});
    const admin = await requireUser(req, res, 'Administrator');
    if (!admin) return;
    if (denied(res, admin, 'audit.view')) return;
    try { return send(res, 200, await listAudit(pool, query)); }
    catch (e) { if (e && e.status === 400) return send(res, 400, {error: e.message}); throw e; }
  }

  const sendFile = (res, file, name) => {
    res.writeHead(200, {
      'Content-Type': file.type,
      'Content-Disposition': disposition(name, file.ext),
      'Content-Length': file.body.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(file.body);
  };

  async function exportsApi(req, res, query) {
    if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, {error: 'รองรับเฉพาะ GET กับ POST'});
    const user = await requireUser(req, res);
    if (!user) return;
    const ctx = auditCtx(req, user);
    const refuse = async (target, detail) => {
      await writeAudit(pool, ctx, 'export_denied', target, detail);
      return send(res, 403, {error: 'บัญชีนี้ไม่มีสิทธิ์ส่งออกข้อมูลนี้'});
    };
    const told = (kind, format, filename, rows) =>
      notify(pool, user.id, 'export_done', 'ส่งออก ' + (filename || kind) + ' เรียบร้อย', {kind, format, filename: filename || null, rows})
        .catch(e => console.error('[api] export notification:', e));
    try {
      if (req.method === 'GET') {
        const source = query.get('source') || '', format = query.get('format') || '';
        const perm = checkSource(source, format);
        const filters = sourceFilters(query);
        if (user.role !== 'Administrator' || !can(user, perm)) return refuse(source, {source, format, perm, filters});
        const list = source === 'audit'
          ? await listAudit(pool, query, {max: MAX_ROWS})
          : await listRequests(pool, user, query, {max: MAX_ROWS});
        if (list.rows.length > MAX_ROWS) return send(res, 400, {error: 'ข้อมูลเกิน ' + MAX_ROWS.toLocaleString('en-US') + ' แถว กรุณากรองให้แคบลง'});
        const file = buildFile(format, sourceRows(source, list.rows, query.get('lang')));
        const name = cleanName(query.get('filename'), source);
        await writeAudit(pool, ctx, 'export', source, {source, format, filename: name, rows: list.rows.length, filters});
        await told(source, format, name, list.rows.length);
        return sendFile(res, file, name);
      }
      let body;
      try { body = JSON.parse(await readBody(req, MAX_BODY)); }
      catch (e) { return send(res, e.status === 413 ? 413 : 400, {error: e.status === 413 ? 'ข้อมูลใหญ่เกินไป กรุณากรองให้แคบลง' : 'อ่านคำขอไม่ได้'}); }
      const r = readRequest(body);
      const base = {kind: r.kind, format: r.format, filename: r.filename, records: r.records, scope: r.scope};
      if (!can(user, r.perm)) return refuse(r.kind, {...base, perm: r.perm});
      if (r.format === 'pdf') {
        await writeAudit(pool, ctx, 'export', r.kind, base);
        await told(r.kind, r.format, r.filename, null);
        return send(res, 200, {ok: true});
      }
      const file = buildFile(r.format, r.rows);
      await writeAudit(pool, ctx, 'export', r.kind, {...base, rows: dataRows(r.rows)});
      await told(r.kind, r.format, r.filename, dataRows(r.rows));
      return sendFile(res, file, r.filename);
    } catch (e) {
      if (e && e.status === 400) return send(res, 400, {error: e.message});
      throw e;
    }
  }

  const readJson = async (req, res, limit) => {
    try { return {body: JSON.parse(await readBody(req, limit))}; }
    catch (e) { send(res, e.status === 413 ? 413 : 400, {error: e.status === 413 ? 'ข้อมูลใหญ่เกินไป' : 'อ่านคำขอไม่ได้'}); return null; }
  };

  async function settingsApi(req, res) {
    if (req.method !== 'GET' && req.method !== 'PUT') return send(res, 405, {error: 'รองรับเฉพาะ GET กับ PUT'});
    if (req.method === 'GET') {
      const user = await requireUser(req, res);
      if (!user) return;
      return send(res, 200, {ok: true, settings: await readSettings(pool)});
    }
    const admin = await requireUser(req, res, 'Administrator');
    if (!admin) return;
    const got = await readJson(req, res, 1e5);
    if (!got) return;
    const b = got.body;
    const keys = b && typeof b === 'object' && !Array.isArray(b) ? Object.keys(b).filter(k => Object.hasOwn(SETTING_PERMS, k)) : [];
    const need = keys.length ? [...new Set(keys.map(k => SETTING_PERMS[k]))] : ['settings.manage'];
    for (const p of need) if (denied(res, admin, p)) return;
    try { return send(res, 200, await writeSettings(pool, got.body, admin, auditCtx(req, admin))); }
    catch (e) { if (e && e.status === 400) return send(res, 400, {error: e.message}); throw e; }
  }

  async function masterApi(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, {error: 'รองรับเฉพาะ GET กับ POST'});
    if (req.method === 'GET') {
      const user = await requireUser(req, res);
      if (!user) return;
      return send(res, 200, {ok: true, data: await readMaster(pool)});
    }
    const admin = await requireUser(req, res, 'Administrator');
    if (!admin) return;
    if (denied(res, admin, 'settings.manage')) return;
    const got = await readJson(req, res, 1e4);
    if (!got) return;
    try { return send(res, 200, await writeMaster(pool, got.body, admin, auditCtx(req, admin))); }
    catch (e) { if (e && [400, 404, 409].includes(e.status)) return send(res, e.status, {error: e.message}); throw e; }
  }

  async function prefsApi(req, res) {
    if (req.method !== 'GET' && req.method !== 'PUT') return send(res, 405, {error: 'รองรับเฉพาะ GET กับ PUT'});
    const user = await requireUser(req, res);
    if (!user) return;
    if (req.method === 'GET') return send(res, 200, {ok: true, prefs: await readPrefs(pool, user)});
    const got = await readJson(req, res, 1e4);
    if (!got) return;
    try { return send(res, 200, await writePrefs(pool, user, got.body, auditCtx(req, user))); }
    catch (e) { if (e && [400, 404].includes(e.status)) return send(res, e.status, {error: e.message}); throw e; }
  }

  async function notificationsApi(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, {error: 'รองรับเฉพาะ GET กับ POST'});
    const user = await requireUser(req, res);
    if (!user) return;
    if (req.method === 'GET') {
      if (weeklyOn && can(user, 'report.view')) await ensureWeekly(pool, user).catch(e => console.error('[api] weekly summary:', e));
      return send(res, 200, await listNotifications(pool, user));
    }
    const got = await readJson(req, res, 1e4);
    if (!got) return;
    try { return send(res, 200, await markRead(pool, user, got.body)); }
    catch (e) { if (e && e.status === 400) return send(res, 400, {error: e.message}); throw e; }
  }

  async function imports(req, res, query) {
    if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, {error: 'รองรับเฉพาะ GET กับ POST'});
    const admin = await requireUser(req, res, 'Administrator');
    if (!admin) return;
    if (denied(res, admin, 'data.import')) return;
    if (req.method === 'GET') {
      try { return send(res, 200, await listFiles(pool, query)); }
      catch (e) { if (e && e.status === 400) return send(res, 400, {error: e.message}); throw e; }
    }
    const tooBig = {error: 'ไฟล์ใหญ่เกิน 25 MB กรุณาแบ่งไฟล์'};
    const filename = cleanFilename(query.get('filename'));
    if (!fileKind(filename)) return send(res, 400, {error: 'รองรับเฉพาะไฟล์ .xlsx .xls .csv'});
    const declared = Number(req.headers['content-length']);
    let bytes;
    try { bytes = await readBytes(req, declared > MAX_FILE_BYTES ? 0 : MAX_FILE_BYTES, MAX_FILE_BYTES * 4); }
    catch (e) { if (e.status === 413) return send(res, 413, tooBig); throw e; }
    if (!bytes.length) return send(res, 400, {error: 'ไฟล์ว่างเปล่า'});
    try {
      return send(res, 201, await importUpload(pool, {bytes, filename, userId: admin.id}, auditCtx(req, admin)));
    } catch (e) {
      if (e && [400, 413, 429].includes(e.status)) return send(res, e.status, {error: e.message});
      throw e;
    }
  }

  const importStep = run => async (req, res) => {
    if (req.method !== 'POST') return send(res, 405, {error: 'รองรับเฉพาะ POST'});
    const admin = await requireUser(req, res, 'Administrator');
    if (!admin) return;
    if (denied(res, admin, 'data.import')) return;
    let body;
    try { body = JSON.parse(await readBody(req, 1e6)); }
    catch (e) { return send(res, e.status === 413 ? 413 : 400, {error: e.status === 413 ? 'ข้อมูลใหญ่เกินไป' : 'อ่านคำขอไม่ได้'}); }
    try {
      return send(res, 200, await run(body, admin, auditCtx(req, admin)));
    } catch (e) {
      if (e && [400, 404, 409].includes(e.status)) return send(res, e.status, {error: e.message});
      throw e;
    }
  };

  async function importRows(req, res, query) {
    if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, {error: 'รองรับเฉพาะ GET กับ POST'});
    const admin = await requireUser(req, res, 'Administrator');
    if (!admin) return;
    if (denied(res, admin, 'data.import')) return;
    try {
      if (req.method === 'GET') return send(res, 200, await listQueue(pool, query));
      let body;
      try { body = JSON.parse(await readBody(req, 1e6)); }
      catch (e) { return send(res, e.status === 413 ? 413 : 400, {error: e.status === 413 ? 'ข้อมูลใหญ่เกินไป' : 'อ่านคำขอไม่ได้'}); }
      return send(res, 200, await actOnQueue(pool, body, admin.id, auditCtx(req, admin)));
    } catch (e) {
      if (e && [400, 404, 409].includes(e.status)) return send(res, e.status, {error: e.message, ...(e.extra || {})});
      throw e;
    }
  }

  async function health(req, res) {
    if (req.method !== 'GET') return send(res, 405, {error: 'รองรับเฉพาะ GET'});
    try { await pool.query('select 1'); }
    catch { return send(res, 503, {ok: false}); }
    return send(res, 200, {ok: true});
  }

  const ROUTES = {
    '/api/health': health,
    '/api/auth': (req, res) => auth(req, res),
    '/api/customers': places('customers'),
    '/api/leads': places('leads'),
    '/api/places': placesWrite,
    '/api/places/visits': placeVisits,
    '/api/audit': auditList,
    '/api/exports': exportsApi,
    '/api/settings': settingsApi,
    '/api/me/prefs': prefsApi,
    '/api/notifications': notificationsApi,
    '/api/master-data': masterApi,
    '/api/lead-requests': leadRequests,
    '/api/lead-requests/file': leadRequestFile,
    '/api/imports': imports,
    '/api/imports/mapping': importStep((body, admin, ctx) => mapUpload(pool, body, admin.id, ctx)),
    '/api/imports/rows': importRows,
    '/api/imports/withdraw': importStep((body, admin, ctx) => withdrawFile(pool, body, admin.id, ctx)),
    '/api/imports/confirm': importStep((body, admin, ctx) => confirmUpload(pool, body, ctx)),
    '/api/zones': zones,
    '/api/territory': (req, res) => territory(req, res),
    '/api/visit-plans': visitPlans,
    '/data/zones.geojson': (req, res) => zonesFile(req, res),
    '/config/runtime.js': runtimeConfig,
    ...Object.fromEntries(STAT_FILES.map(name => ['/data/' + name + '.json', (req, res) => statsFile(req, res, name)])),
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
      } finally {
        if (placesCache && req.method !== 'GET' && req.method !== 'HEAD' && !KEEPS_PLACES.has(path)) placesCache.reset();
      }
    },
  };
}
