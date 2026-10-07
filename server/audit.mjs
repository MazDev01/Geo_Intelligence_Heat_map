import net from 'node:net';

const EVENT_RE = /^[a-z][a-z_]*$/;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function clientIp(req) {
  const peer = req.socket && req.socket.remoteAddress;
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = LOOPBACK.has(peer) && fwd ? fwd : peer;
  return ip && net.isIP(ip) ? ip : null;
}

export const auditCtx = (req, user) => ({actor: {id: user.id ?? null, email: user.email}, ip: clientIp(req)});

export async function writeAudit(db, ctx, event, target, detail) {
  if (!ctx || !ctx.actor || !ctx.actor.email) throw new Error('audit: missing actor');
  if (!EVENT_RE.test(event)) throw new Error('audit: bad event ' + event);
  await db.query(
    'insert into audit_log (actor_id, actor_email, event_type, target, detail, ip_address) values ($1, $2, $3, $4, $5, $6)',
    [Number.isInteger(ctx.actor.id) ? ctx.actor.id : null, ctx.actor.email, event,
      target === undefined || target === null ? null : String(target).slice(0, 200), JSON.stringify(detail || {}), ctx.ip || null]);
}

const ROLES = new Set(['Administrator', 'Management', 'Trade Coordinator']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const bad = message => Object.assign(new Error(message), {status: 400});
const like = v => '%' + v.replace(/[\\%_]/g, m => '\\' + m) + '%';

export async function listAudit(pool, query, {max} = {}) {
  const where = [];
  const args = [];
  const add = (sql, v) => { args.push(v); where.push(sql.replace('?', '$' + args.length)); };
  const actor = (query.get('actor') || '').trim().slice(0, 200);
  if (actor) add('a.actor_email ilike ?', like(actor));
  const target = (query.get('target') || '').trim().slice(0, 200);
  if (target) add('a.target ilike ?', like(target));
  const text = (query.get('q') || '').trim().slice(0, 200);
  if (text) {
    args.push(like(text));
    where.push('(a.actor_email ilike $' + args.length + ' or a.target ilike $' + args.length + ')');
  }
  const role = query.get('role');
  if (role) {
    if (!ROLES.has(role)) throw bad('บทบาทไม่ถูกต้อง');
    add('a.actor_id in (select id from users where role = ?)', role);
  }
  const events = (query.get('event') || '').split(',').map(x => x.trim()).filter(Boolean);
  if (events.length) {
    if (events.length > 30 || events.some(e => !EVENT_RE.test(e))) throw bad('รหัสเหตุการณ์ไม่ถูกต้อง');
    add('a.event_type = any(?::text[])', events);
  }
  for (const [key, op] of [['from', ">= (?::date)::timestamp at time zone 'Asia/Bangkok'"], ['to', "< ((?::date) + 1)::timestamp at time zone 'Asia/Bangkok'"]]) {
    const v = query.get(key);
    if (!v) continue;
    const d = DATE_RE.test(v) ? new Date(v + 'T00:00:00Z') : null;
    if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw bad('วันที่ไม่ถูกต้อง');
    add('a.occurred_at ' + op, v);
  }
  const limit = max ? max + 1 : Math.min(Math.max(parseInt(query.get('limit') || '50', 10) || 50, 1), 100);
  const page = max ? 1 : Math.max(parseInt(query.get('page') || '1', 10) || 1, 1);
  const cond = where.length ? 'where ' + where.join(' and ') : '';
  const total = max ? null : (await pool.query('select count(*)::int as n from audit_log a ' + cond, args)).rows[0].n;
  const r = await pool.query(
    `select a.log_id, a.actor_id, a.actor_email, a.event_type, a.target, a.detail, host(a.ip_address) as ip, u.role as actor_role,
       to_char(a.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at
     from audit_log a left join users u on u.id = a.actor_id ${cond} order by a.occurred_at desc, a.log_id desc limit $${args.length + 1} offset $${args.length + 2}`,
    [...args, limit, (page - 1) * limit]);
  return {
    ok: true, total, page, limit,
    rows: r.rows.map(x => ({id: Number(x.log_id), at: x.at, actor: x.actor_email, actorId: x.actor_id, role: x.actor_role, event: x.event_type, target: x.target, detail: x.detail, ip: x.ip})),
  };
}
