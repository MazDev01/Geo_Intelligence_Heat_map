import {withTransaction} from './db/pool.mjs';
import {writeAudit} from './audit.mjs';
import {SCORING_DEFAULT} from '../src/mock/geoData.js';

const fail = (status, message) => Object.assign(new Error(message), {status});

export const NOTIF_KEYS = ['lead_new', 'lead_gap', 'import_done', 'export_done', 'weekly', 'deal_new', 'deal_result'];
const PRIORITIES = new Set(['low', 'medium', 'high']);

const plainObject = v => v && typeof v === 'object' && !Array.isArray(v);

function checkNotifications(v) {
  if (!plainObject(v)) throw fail(400, 'รูปแบบการตั้งค่าการแจ้งเตือนไม่ถูกต้อง');
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (!NOTIF_KEYS.includes(k)) throw fail(400, 'ไม่รู้จักเหตุการณ์แจ้งเตือน: ' + String(k).slice(0, 40));
    if (!plainObject(x) || typeof x.on !== 'boolean' || !PRIORITIES.has(x.priority)) throw fail(400, 'ค่าของ ' + k + ' ไม่ถูกต้อง');
    out[k] = {on: x.on, priority: x.priority};
  }
  return out;
}

const SCORING_SHAPE = {
  weights: [['depth', 'breadth', 'volume'], 0, 100, 'น้ำหนัก'],
  ref: [['country', 'province', 'cluster', 'district'], 1, 1000000, 'ค่าอ้างอิง'],
  cut: [['medium', 'high'], 1, 100, 'จุดตัดระดับ'],
};

function checkScoring(v) {
  if (!plainObject(v)) throw fail(400, 'รูปแบบเกณฑ์ช่องว่างไม่ถูกต้อง');
  const out = {};
  for (const k of Object.keys(v)) if (!Object.hasOwn(SCORING_SHAPE, k)) throw fail(400, 'ไม่รู้จักเกณฑ์: ' + String(k).slice(0, 40));
  for (const [group, [keys, min, max, label]] of Object.entries(SCORING_SHAPE)) {
    const g = v[group];
    if (!plainObject(g)) throw fail(400, 'ต้องส่ง' + label + 'ให้ครบ');
    for (const k of Object.keys(g)) if (!keys.includes(k)) throw fail(400, 'ไม่รู้จัก' + label + ': ' + String(k).slice(0, 40));
    out[group] = {};
    for (const k of keys) {
      if (!Number.isInteger(g[k]) || g[k] < min || g[k] > max) throw fail(400, label + ' ' + k + ' ต้องเป็นจำนวนเต็ม ' + min + ' ถึง ' + max);
      out[group][k] = g[k];
    }
  }
  const sum = out.weights.depth + out.weights.breadth + out.weights.volume;
  if (sum !== 100) throw fail(400, 'น้ำหนักสามองค์ประกอบต้องรวมกันได้ 100 (ตอนนี้ ' + sum + ')');
  if (out.cut.medium >= out.cut.high) throw fail(400, 'จุดตัดระดับปานกลางต้องต่ำกว่าจุดตัดระดับสูง');
  return out;
}

const SYSTEM = {notifications: checkNotifications, scoring: checkScoring};
const WITH_VALUES = new Set(['scoring']);
export const SETTING_PERMS = {notifications: 'settings.manage', scoring: 'settings.manage_scoring'};

export async function readScoring(db) {
  const r = await db.query("select value from settings where key = 'scoring'");
  const v = (r.rows[0] && r.rows[0].value) || {};
  return {
    weights: {...SCORING_DEFAULT.weights, ...(v.weights || {})},
    ref: {...SCORING_DEFAULT.ref, ...(v.ref || {})},
    cut: {...SCORING_DEFAULT.cut, ...(v.cut || {})},
  };
}

export async function readSettings(pool) {
  const r = await pool.query('select key, value from settings where key = any($1::text[])', [Object.keys(SYSTEM)]);
  const out = {};
  for (const row of r.rows) out[row.key] = row.value;
  return out;
}

export async function writeSettings(pool, body, user, ctx) {
  if (!plainObject(body) || !Object.keys(body).length) throw fail(400, 'อ่านคำขอไม่ได้');
  const clean = {};
  for (const [k, v] of Object.entries(body)) {
    if (!Object.hasOwn(SYSTEM, k)) throw fail(400, 'ไม่รู้จักการตั้งค่า: ' + String(k).slice(0, 40));
    clean[k] = SYSTEM[k](v);
  }
  return withTransaction(pool, async tx => {
    const before = await readSettings(tx);
    for (const [k, v] of Object.entries(clean)) {
      await tx.query(
        `insert into settings (key, value, updated_by, updated_at) values ($1, $2, $3, now())
         on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
        [k, JSON.stringify(v), Number.isInteger(user.id) ? user.id : null]);
      if (k === 'scoring') await tx.query('insert into stats_dirty default values');
      const prev = before[k] || {};
      const changed = [...new Set([...Object.keys(prev), ...Object.keys(v)])].filter(x => JSON.stringify(prev[x]) !== JSON.stringify(v[x]));
      await writeAudit(tx, ctx, 'settings_update', k, WITH_VALUES.has(k) ? {changed, before: before[k] || null, after: v} : {changed});
    }
    return {ok: true, settings: await readSettings(tx)};
  });
}

function checkPrefs(body) {
  if (!plainObject(body)) throw fail(400, 'อ่านคำขอไม่ได้');
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (k !== 'notifOff') throw fail(400, 'ไม่รู้จักการตั้งค่า: ' + String(k).slice(0, 40));
    if (!plainObject(v)) throw fail(400, 'รูปแบบการตั้งค่าการแจ้งเตือนไม่ถูกต้อง');
    const off = {};
    for (const [e, x] of Object.entries(v)) {
      if (!NOTIF_KEYS.includes(e) || typeof x !== 'boolean') throw fail(400, 'ค่าการแจ้งเตือนไม่ถูกต้อง');
      if (x) off[e] = true;
    }
    out.notifOff = off;
  }
  return out;
}

export async function readPrefs(pool, user) {
  if (!Number.isInteger(user.id)) return {};
  const r = await pool.query('select prefs from users where id = $1', [user.id]);
  return r.rows[0] ? r.rows[0].prefs || {} : {};
}

export async function writePrefs(pool, user, body) {
  if (!Number.isInteger(user.id)) throw fail(400, 'บัญชีนี้บันทึกการตั้งค่าไม่ได้');
  const clean = checkPrefs(body);
  const r = await pool.query('update users set prefs = prefs || $2::jsonb where id = $1 returning prefs', [user.id, JSON.stringify(clean)]);
  if (!r.rowCount) throw fail(404, 'ไม่พบบัญชี');
  return {ok: true, prefs: r.rows[0].prefs};
}
