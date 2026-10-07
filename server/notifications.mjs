import {NOTIF_KEYS} from './settings.mjs';

const fail = (status, message) => Object.assign(new Error(message), {status});
const LIST_MAX = 30;
const MARK_MAX = 100;

export async function notify(db, userIds, key, title, payload) {
  if (!NOTIF_KEYS.includes(key)) throw new Error('notify: bad event ' + key);
  const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Number.isInteger))];
  if (!ids.length) return 0;
  const r = await db.query(
    `insert into notifications (user_id, event_key, title, payload)
     select u.id, $2, $3, $4::jsonb from users u where u.id = any($1::int[])`,
    [ids, key, String(title).slice(0, 300), JSON.stringify(payload || {})]);
  return r.rowCount;
}

export const adminIds = async (db, except) =>
  (await db.query("select id from users where role = 'Administrator' and status <> 'Suspended'")).rows.map(r => r.id).filter(id => id !== except);

export const placeName = async (db, placeId) =>
  placeId ? ((await db.query('select business_name from places where id = $1', [placeId])).rows[0] || {}).business_name || '' : '';

async function hiddenKeys(db, user) {
  const sys = ((await db.query("select value from settings where key = 'notifications'")).rows[0] || {}).value || {};
  const prefs = ((await db.query('select prefs from users where id = $1', [user.id])).rows[0] || {}).prefs || {};
  const off = prefs.notifOff || {};
  return NOTIF_KEYS.filter(k => (sys[k] && sys[k].on === false) || off[k] === true);
}

export async function listNotifications(pool, user) {
  if (!Number.isInteger(user.id)) return {ok: true, unread: 0, items: []};
  const hidden = await hiddenKeys(pool, user);
  const rows = (await pool.query(
    `select id, event_key, title, payload, read_at is not null as read,
       to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at
     from notifications where user_id = $1 and event_key <> all($2::text[]) order by id desc limit $3`,
    [user.id, hidden, LIST_MAX])).rows;
  const unread = (await pool.query(
    'select count(*)::int as n from notifications where user_id = $1 and read_at is null and event_key <> all($2::text[])',
    [user.id, hidden])).rows[0].n;
  return {ok: true, unread, items: rows.map(r => ({id: Number(r.id), key: r.event_key, title: r.title, payload: r.payload || {}, read: r.read, at: r.at}))};
}

export async function markRead(pool, user, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'อ่านคำขอไม่ได้');
  if (!Number.isInteger(user.id)) throw fail(400, 'บัญชีนี้ไม่มีการแจ้งเตือน');
  let ids = null;
  if (body.all !== true) {
    if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > MARK_MAX) throw fail(400, 'ต้องระบุรายการ 1 ถึง ' + MARK_MAX + ' รายการ');
    ids = [...new Set(body.ids.map(Number))];
    if (ids.some(x => !Number.isSafeInteger(x) || x < 1)) throw fail(400, 'รหัสการแจ้งเตือนไม่ถูกต้อง');
  }
  const r = await pool.query(
    'update notifications set read_at = now() where user_id = $1 and read_at is null and ($2::bigint[] is null or id = any($2::bigint[]))',
    [user.id, ids]);
  return {...(await listNotifications(pool, user)), marked: r.rowCount};
}
