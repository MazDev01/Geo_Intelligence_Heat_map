import {withTransaction} from './pool.mjs';

const COLS = `id, name, email, role, province, scope, overrides, status, color, pw_hash, pw_salt, pw_iter, must_change, fails,
  (extract(epoch from lock_until) * 1000)::bigint as lock_until_ms,
  (extract(epoch from tokens_valid_after) * 1000)::bigint as tokens_valid_after_ms,
  to_char(last_login_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI') as last`;

const LAST_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

const toUser = r => ({
  id: r.id, name: r.name, email: r.email, role: r.role, province: r.province, status: r.status,
  scope: r.scope, overrides: r.overrides || {}, color: r.color || null,
  pw: r.pw_hash ? {salt: r.pw_salt, hash: r.pw_hash, iter: r.pw_iter} : null,
  mustChange: r.must_change, fails: r.fails,
  lockUntil: r.lock_until_ms ? Number(r.lock_until_ms) : 0,
  tokensValidAfter: r.tokens_valid_after_ms ? Number(r.tokens_valid_after_ms) : 0,
  last: r.last || null,
});

const scopeOf = role => role === 'Trade Coordinator' ? 'own_area' : 'national';
const lockValue = ms => ms ? new Date(Number(ms)) : null;
const lastValue = s => LAST_RE.test(String(s || '')) ? new Date(String(s).replace(' ', 'T') + ':00Z') : null;

const SETTERS = {
  name:       v => [['name', v]],
  email:      v => [['email', v]],
  role:      v => [['role', v]],
  province:   v => [['province', v || null]],
  scope:      v => [['scope', v]],
  overrides:  v => [['overrides', JSON.stringify(v || {})]],
  status:     v => [['status', v]],
  color:      v => [['color', v || null]],
  mustChange: v => [['must_change', !!v]],
  fails:      v => [['fails', Number(v) || 0]],
  lockUntil:  v => [['lock_until', lockValue(v)]],
  tokensValidAfter: v => [['tokens_valid_after', lockValue(v)]],
  last:       v => [['last_login_at', lastValue(v)]],
  pw:         v => [['pw_hash', v ? v.hash : null], ['pw_salt', v ? v.salt : null], ['pw_iter', v ? v.iter : null]],
};

async function insertUser(db, rec) {
  const pw = rec.pw || null;
  const cols = ['name', 'email', 'role', 'province', 'scope', 'overrides', 'status', 'pw_hash', 'pw_salt', 'pw_iter', 'must_change'];
  const vals = [rec.name, rec.email, rec.role, rec.province || null, rec.scope || scopeOf(rec.role), JSON.stringify(rec.overrides || {}),
    rec.status || 'Active', pw && pw.hash, pw && pw.salt, pw && pw.iter, rec.mustChange !== false];
  if (rec.id) { cols.unshift('id'); vals.unshift(rec.id); }
  const marks = vals.map((_, i) => '$' + (i + 1)).join(',');
  const r = await db.query(`insert into users (${cols.join(',')}) values (${marks}) returning ${COLS}`, vals);
  return toUser(r.rows[0]);
}

export function makeAuthAdapter(pool) {
  let seeded = null;

  async function seedOnce(makeSeed) {
    const any = await pool.query('select 1 from users limit 1');
    if (any.rowCount) return;
    const users = makeSeed();
    if (!users.length) return;
    await withTransaction(pool, async tx => {
      await tx.query('lock table users in share row exclusive mode');
      const again = await tx.query('select 1 from users limit 1');
      if (again.rowCount) return;
      for (const u of users) await insertUser(tx, u);
      await tx.query("select setval(pg_get_serial_sequence('users','id'), (select max(id) from users))");
    });
  }

  return {
    ensureSeed(makeSeed) {
      if (!seeded) seeded = seedOnce(makeSeed).catch(e => { seeded = null; throw e; });
      return seeded;
    },

    async list() {
      const r = await pool.query(`select ${COLS} from users order by id`);
      return r.rows.map(toUser);
    },

    async findByEmail(email) {
      const r = await pool.query(`select ${COLS} from users where lower(email) = lower($1)`, [String(email || '')]);
      return r.rowCount ? toUser(r.rows[0]) : null;
    },

    async insert(rec) {
      try {
        return await insertUser(pool, rec);
      } catch (e) {
        if (e && e.code === '23505') e.duplicate = true;
        throw e;
      }
    },

    async update(id, patch) {
      const pairs = [];
      for (const [key, value] of Object.entries(patch || {})) {
        const set = SETTERS[key];
        if (!set) throw new Error('auth adapter: unknown field ' + key);
        pairs.push(...set(value));
      }
      if (!pairs.length) return;
      const sets = pairs.map(([col], i) => col + ' = $' + (i + 2)).join(', ');
      await pool.query(`update users set ${sets} where id = $1`, [id, ...pairs.map(p => p[1])]);
    },

    async remove(id) {
      await pool.query('delete from users where id = $1', [id]);
    },
  };
}
