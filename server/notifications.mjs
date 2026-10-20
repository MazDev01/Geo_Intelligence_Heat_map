import {NOTIF_KEYS} from './settings.mjs';
import {withTransaction} from './db/pool.mjs';

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

export async function markDealRead(db, requestIds) {
  const ids = [...new Set(requestIds)].map(String);
  if (!ids.length) return 0;
  const r = await db.query(
    `update notifications set read_at = now()
     where event_key = 'deal_new' and read_at is null and payload ->> 'requestId' = any($1::text[])`, [ids]);
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

const WEEKLY_SCOPE = `select province from users where id = $1 and province is not null
  union select split_part(key, '/', 1) from territory_assign where user_id = $1`;
const WEEKLY_PLACES = `with scope as (${WEEKLY_SCOPE}),
  p as (select type, segment, created_at, date_join from places
        where deleted_at is null and ($2::boolean = false or province in (select province from scope)))`;
const weeklyExists = async (db, userId, week) =>
  !!(await db.query("select 1 from notifications where user_id = $1 and event_key = 'weekly' and payload ->> 'week' = $2 limit 1", [userId, week])).rowCount;

export async function ensureWeekly(pool, user, opts) {
  if (!Number.isInteger(user.id)) return false;
  const w = (await pool.query(
    `select to_char(ws, 'YYYY-MM-DD') as week, to_char(ws - interval '7 days', 'YYYY-MM-DD') as from_day,
            to_char(ws - interval '1 day', 'YYYY-MM-DD') as to_day
     from (select date_trunc('week', coalesce($1::timestamptz, now()) at time zone 'Asia/Bangkok') as ws) x`,
    [(opts && opts.now) || null])).rows[0];
  if ((await hiddenKeys(pool, user)).includes('weekly')) return false;
  if (await weeklyExists(pool, user.id, w.week)) return false;
  return withTransaction(pool, async tx => {
    await tx.query('select pg_advisory_xact_lock(7301, $1)', [user.id]);
    if (await weeklyExists(tx, user.id, w.week)) return false;
    const own = user.role === 'Trade Coordinator';
    const n = (await tx.query(
      `${WEEKLY_PLACES}
       select
         (select count(*)::int from p where type = 'Prospect' and (created_at at time zone 'Asia/Bangkok')::date between $3::date and $4::date) as leads,
         (select count(*)::int from p where type = 'Existing' and date_join between $3::date and $4::date) as customers,
         (select count(*)::int from place_visits v where v.status = 'เสร็จสิ้น' and v.done_date between $3::date and $4::date
            and ($2::boolean = false or v.tc_id = $1)) as visits`,
      [user.id, own, w.from_day, w.to_day])).rows[0];
    const gap = (await tx.query(
      `${WEEKLY_PLACES}
       select segment, sum(case when type = 'Prospect' then 1 else -1 end)::int as gap
       from p where segment is not null group by 1 order by 2 desc, 1 limit 1`,
      [user.id, own])).rows[0];
    const payload = {week: w.week, from: w.from_day, to: w.to_day, leads: n.leads, customers: n.customers, visits: n.visits,
      gapSeg: gap && gap.gap > 0 ? gap.segment : null, gapN: gap && gap.gap > 0 ? gap.gap : 0};
    await notify(tx, user.id, 'weekly',
      'สรุปสัปดาห์ ' + w.from_day + ' ถึง ' + w.to_day + ': Lead ใหม่ ' + n.leads + ' · ลูกค้าใหม่ ' + n.customers + ' · เข้าพบ ' + n.visits, payload);
    return true;
  });
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
