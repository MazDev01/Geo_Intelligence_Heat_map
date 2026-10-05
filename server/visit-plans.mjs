import {randomBytes} from 'node:crypto';
import {withTransaction} from './db/pool.mjs';

const fail = (status, message) => Object.assign(new Error(message), {status});

const MAX_ITEMS = 100;
const MAX_PLANS = 200;
const MAX_ROUTE_BYTES = 200000;
const ID_RE = /^VP[0-9A-F]{16}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const SCOPE_SQL = `select province from users where id = $1 and province is not null
  union select split_part(key, '/', 1) from territory_assign where user_id = $1`;

const gapLevelOf = s => s >= 67 ? 'High' : s >= 34 ? 'Medium' : 'Low';

export const checkPlanId = id => {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw fail(400, 'รหัสแผนไม่ถูกต้อง');
  return id;
};

function readPlan(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'อ่านคำขอไม่ได้');
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 80) throw fail(400, 'ชื่อแผนต้องยาว 1 ถึง 80 ตัวอักษร');

  let visitDate = null;
  if (body.visitDate !== undefined && body.visitDate !== null && body.visitDate !== '') {
    const d = String(body.visitDate);
    const t = Date.parse(d + 'T00:00:00Z');
    if (!DATE_RE.test(d) || Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== d) throw fail(400, 'วันเข้าพบไม่ถูกต้อง ใช้รูปแบบ ปปปป-ดด-วว');
    visitDate = d;
  }

  const items = body.items === undefined ? [] : body.items;
  if (!Array.isArray(items)) throw fail(400, 'รายการร้านต้องเป็นรายการ');
  if (items.length > MAX_ITEMS) throw fail(400, 'แผนหนึ่งมีได้ไม่เกิน ' + MAX_ITEMS + ' ร้าน');
  const placeIds = [];
  for (const it of items) {
    const id = typeof it === 'string' ? it : it && typeof it === 'object' ? it.placeId : null;
    if (typeof id !== 'string' || !id || id.length > 40) throw fail(400, 'รหัสร้านในแผนไม่ถูกต้อง');
    if (placeIds.includes(id)) throw fail(400, 'มีร้านซ้ำในแผน: ' + id);
    placeIds.push(id);
  }

  let route = null;
  if (body.route !== undefined && body.route !== null) {
    if (typeof body.route !== 'object') throw fail(400, 'เส้นทางไม่ถูกต้อง');
    route = JSON.stringify(body.route);
    if (Buffer.byteLength(route) > MAX_ROUTE_BYTES) throw fail(400, 'เส้นทางใหญ่เกินไป');
  }

  if (body.saved !== undefined && typeof body.saved !== 'boolean') throw fail(400, 'สถานะยืนยันแผนต้องเป็นจริงหรือเท็จ');
  return {name, visitDate, placeIds, route, saved: body.saved === true};
}

async function checkPlaces(tx, userId, placeIds) {
  if (!placeIds.length) return new Map();
  const rows = (await tx.query(
    `select p.id, p.segment, p.province, p.province in (${SCOPE_SQL}) as mine
     from places p where p.id = any($2) and p.deleted_at is null`, [userId, placeIds])).rows;
  const byId = new Map(rows.map(r => [r.id, r]));
  const missing = placeIds.filter(id => !byId.has(id));
  if (missing.length) throw fail(400, 'ไม่พบร้านในระบบ ' + missing.length + ' รายการ: ' + missing.slice(0, 5).join(', '));
  const outside = placeIds.filter(id => !byId.get(id).mine);
  if (outside.length) throw fail(403, 'มีร้านที่อยู่นอกพื้นที่รับผิดชอบ ' + outside.length + ' รายการ');
  return byId;
}

async function gapSnapshot(tx, province) {
  const rows = (await tx.query(
    `select segment, greatest(0, count(*) filter (where type = 'Prospect') - count(*) filter (where type = 'Existing'))::int as gap
     from places where province = $1 and deleted_at is null and segment is not null group by segment`, [province])).rows;
  const gap = Object.fromEntries(rows.map(r => [r.segment, r.gap]));
  const max = Math.max(1, ...rows.map(r => r.gap));
  return segment => {
    const g = gap[segment] || 0;
    return {gap: g, level: gapLevelOf(Math.round(g / max * 100))};
  };
}

async function writeItems(tx, planId, userId, plan, keep) {
  const places = await checkPlaces(tx, userId, plan.placeIds);
  await tx.query('delete from visit_plan_items where plan_id = $1', [planId]);
  if (!plan.placeIds.length) return;
  const snaps = new Map();
  const snapFor = async p => {
    if (!snaps.has(p.province)) snaps.set(p.province, await gapSnapshot(tx, p.province));
    return snaps.get(p.province)(p.segment);
  };
  const values = [], args = [planId];
  for (const [i, id] of plan.placeIds.entries()) {
    let snap = keep.get(id) || null;
    if (!snap && plan.saved) snap = await snapFor(places.get(id));
    args.push(id, i + 1, snap ? JSON.stringify(snap) : null);
    const n = args.length;
    values.push(`($1, $${n - 2}, $${n - 1}, $${n}::jsonb)`);
  }
  await tx.query('insert into visit_plan_items (plan_id, place_id, seq, snapshot) values ' + values.join(', '), args);
}

const PLAN_SQL = `
select v.plan_id, v.name, to_char(v.visit_date, 'YYYY-MM-DD') as visit_date, v.saved, v.saved_at, v.route, v.province,
  v.created_at, v.updated_at,
  coalesce((select json_agg(json_build_object('placeId', i.place_id, 'seq', i.seq, 'snapshot', i.snapshot,
      'deleted', p.deleted_at is not null) order by i.seq)
    from visit_plan_items i join places p on p.id = i.place_id where i.plan_id = v.plan_id), '[]') as items
from visit_plans v where v.owner_id = $1 and ($2::text is null or v.plan_id = $2)
order by v.created_at, v.plan_id`;

const toPlan = r => ({
  id: r.plan_id, name: r.name, visitDate: r.visit_date, saved: r.saved,
  savedAt: r.saved_at ? r.saved_at.toISOString() : null, route: r.route, province: r.province,
  createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(), items: r.items,
});

const readOne = async (db, userId, planId) => {
  const r = (await db.query(PLAN_SQL, [userId, planId])).rows[0];
  if (!r) throw fail(404, 'ไม่พบแผนนี้');
  return toPlan(r);
};

export async function listPlans(pool, user) {
  return {ok: true, owner: user.email, province: user.province, plans: (await pool.query(PLAN_SQL, [user.id, null])).rows.map(toPlan)};
}

export async function createPlan(pool, user, body) {
  const plan = readPlan(body);
  return withTransaction(pool, async tx => {
    await tx.query('select pg_advisory_xact_lock(hashtext($1), $2)', ['visit_plans', user.id]);
    const count = (await tx.query('select count(*)::int as n from visit_plans where owner_id = $1', [user.id])).rows[0].n;
    if (count >= MAX_PLANS) throw fail(409, 'มีแผนครบ ' + MAX_PLANS + ' แผนแล้ว กรุณาลบแผนเก่าก่อน');
    const id = 'VP' + randomBytes(8).toString('hex').toUpperCase();
    await tx.query(
      `insert into visit_plans (plan_id, name, owner_id, visit_date, saved, saved_at, route, province)
       values ($1, $2, $3, $4, $5, case when $5 then now() end, $6::jsonb, $7)`,
      [id, plan.name, user.id, plan.visitDate, plan.saved, plan.route, user.province || null]);
    await writeItems(tx, id, user.id, plan, new Map());
    return {ok: true, plan: await readOne(tx, user.id, id)};
  });
}

export async function updatePlan(pool, user, planId, body) {
  checkPlanId(planId);
  const plan = readPlan(body);
  return withTransaction(pool, async tx => {
    const cur = (await tx.query('select saved from visit_plans where plan_id = $1 and owner_id = $2 for update', [planId, user.id])).rows[0];
    if (!cur) throw fail(404, 'ไม่พบแผนนี้');
    const keep = new Map();
    if (plan.saved) {
      for (const r of (await tx.query('select place_id, snapshot from visit_plan_items where plan_id = $1 and snapshot is not null', [planId])).rows)
        keep.set(r.place_id, r.snapshot);
    }
    await tx.query(
      `update visit_plans set name = $3, visit_date = $4, saved = $5, route = $6::jsonb,
         saved_at = case when $5 and not saved then now() when not $5 then null else saved_at end
       where plan_id = $1 and owner_id = $2`,
      [planId, user.id, plan.name, plan.visitDate, plan.saved, plan.route]);
    await writeItems(tx, planId, user.id, plan, keep);
    return {ok: true, plan: await readOne(tx, user.id, planId)};
  });
}

export async function deletePlan(pool, user, planId) {
  checkPlanId(planId);
  const r = await pool.query('delete from visit_plans where plan_id = $1 and owner_id = $2', [planId, user.id]);
  if (!r.rowCount) throw fail(404, 'ไม่พบแผนนี้');
  return {ok: true};
}
