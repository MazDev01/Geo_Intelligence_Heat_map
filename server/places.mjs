import {randomBytes} from 'node:crypto';
import {withTransaction} from './db/pool.mjs';
import {writeAudit} from './audit.mjs';
import {isActive} from './master-data.mjs';
import {phonesOk} from '../src/contact-rules.js';

const FULL_ACCESS = new Set(['Administrator', 'Management']);

const SQL = `
select p.id, p.type, p.account_no, p.business_name, p.category, p.segment, p.country, p.province, p.district,
  p.address, p.latitude::float8 as latitude, p.longitude::float8 as longitude, p.phone, p.email, p.website,
  p.facebook, to_char(p.date_join, 'YYYY-MM-DD') as date_join,
  to_char(p.created_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD') as created_at,
  to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_iso,
  o.name as tc_owner, at.name as area_tc, p.visit_status, v.rounds,
  d.status as deal_status, d.payload->>'visitDate' as deal_visit_date, d.reject_reason as deal_reject_reason, d.reject_note as deal_reject_note,
  to_char(d.submitted_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD') as deal_submitted, ds.name as deal_visitor,
  (select f.filename from lead_request_files f where f.request_id = d.id order by f.id limit 1) as deal_doc
from places p
left join users o on o.id = p.tc_owner_id
left join lateral (
  select case when p.type = 'Existing' and p.tc_owner_id is null then p.province || '/' || coalesce((
    select z.zone_id from zones z
    where z.state = 'live' and z.province = p.province
      and st_covers(z.geom, st_setsrid(st_makepoint(p.longitude::float8, p.latitude::float8), 4326))
    order by z.position, z.zone_id limit 1), '__rest') end as key
) zk on true
left join lateral (
  select au.name
  from territory_assign a
  join users au on au.id = a.user_id
  where zk.key is not null and a.key in (p.province, zk.key)
  order by (a.key = p.province), a.key limit 1
) at on true
left join lateral (select id, status, payload, submitted_at, submitted_by, reject_reason, reject_note from lead_requests lr where lr.place_id = p.id order by lr.id desc limit 1) d on true
left join users ds on ds.id = d.submitted_by
left join (
  select pv.place_id, json_agg(json_build_object(
    'round', pv.round, 'status', pv.status,
    'apptDate', to_char(pv.appt_date, 'YYYY-MM-DD'), 'doneDate', to_char(pv.done_date, 'YYYY-MM-DD'),
    'tc', t.name, 'interest', pv.interest, 'outcome', pv.outcome,
    'cancelReason', pv.cancel_reason, 'note', pv.note,
    'at', to_char(pv.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by pv.round) as rounds
  from place_visits pv
  left join users t on t.id = pv.tc_id
  group by pv.place_id
) v on v.place_id = p.id
where p.type = $1
  and p.deleted_at is null
  and ($2::text is null or p.country = $2)
  and ($3::int is null or p.province in (
    select u.province from users u where u.id = $3 and u.province is not null
    union
    select split_part(a.key, '/', 1) from territory_assign a where a.user_id = $3))
  and ($4::text[] is null or p.id = any($4))
order by p.id`;

const putIf = (obj, key, value) => { if (value !== null && value !== undefined) obj[key] = value; };

const DEAL_OUT = {pending: 'pending', rejected: 'rejected', converted: 'approved'};

const putDeal = (out, r) => {
  if (!r.deal_status) return;
  out.dealStatus = DEAL_OUT[r.deal_status];
  putIf(out, 'dealVisitDate', r.deal_visit_date);
  putIf(out, 'dealSubmittedDate', r.deal_submitted);
  putIf(out, 'dealVisitor', r.deal_visitor);
  if (r.deal_status === 'pending') putIf(out, 'dealDoc', r.deal_doc);
  if (r.deal_status === 'rejected') {
    putIf(out, 'dealRejectReason', r.deal_reject_reason);
    putIf(out, 'dealRejectNote', r.deal_reject_note);
  }
};

const toRound = v => {
  const out = {round: v.round, status: v.status};
  for (const k of ['apptDate', 'doneDate', 'tc', 'interest', 'outcome', 'cancelReason', 'note', 'at']) putIf(out, k, v[k]);
  return out;
};

const toCustomer = r => {
  const out = {
    id: r.id, accountNo: r.account_no, businessName: r.business_name, segment: r.segment, status: r.type,
    country: r.country, province: r.province, district: r.district, address: r.address,
    latitude: r.latitude, longitude: r.longitude, phone: r.phone, website: r.website, facebook: r.facebook,
    dateJoin: r.date_join, created_at: r.created_at, tc_owner: r.tc_owner,
  };
  putIf(out, 'category', r.category);
  putIf(out, 'email', r.email);
  putIf(out, 'areaTc', r.area_tc);
  putIf(out, 'visit_status', r.visit_status);
  if (r.rounds) out.visitRounds = r.rounds.map(toRound);
  putDeal(out, r);
  return out;
};

const toLead = r => {
  const out = {
    id: r.id, businessName: r.business_name, category: r.category, segment: r.segment, status: r.type,
    country: r.country, province: r.province, district: r.district, address: r.address, email: r.email ?? '',
    latitude: r.latitude, longitude: r.longitude, created_at: r.created_at, tc_owner: r.tc_owner,
    visitRounds: (r.rounds || []).map(toRound), visit_status: r.visit_status, phone: r.phone,
  };
  putIf(out, 'createdAt', r.created_iso);
  putIf(out, 'accountNo', r.account_no);
  putIf(out, 'website', r.website);
  putIf(out, 'facebook', r.facebook);
  putIf(out, 'dateJoin', r.date_join);
  putDeal(out, r);
  return out;
};

const KINDS = {
  customers: {type: 'Existing', map: toCustomer},
  leads: {type: 'Prospect', map: toLead},
};

export function placesScope(user) {
  const full = (user.scope || (FULL_ACCESS.has(user.role) ? 'national' : 'own_area')) === 'national';
  if (full) return null;
  return Number.isInteger(user.id) ? user.id : undefined;
}

export async function listPlaces(pool, kind, user, country, {contact = true} = {}) {
  const k = KINDS[kind];
  const scopeUserId = placesScope(user);
  if (scopeUserId === undefined) return [];
  const r = await pool.query(SQL, [k.type, country || null, scopeUserId, null]);
  const list = r.rows.map(k.map);
  if (!contact) for (const o of list) { o.phone = null; if (kind === 'leads') o.email = ''; else delete o.email; }
  return list;
}

const TYPES = new Set(['Existing', 'Prospect']);
const MAX_BATCH = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UNASSIGNED = new Set(['', 'ยังไม่มอบหมาย', 'auto']);

const bad = message => Object.assign(new Error(message), {status: 400});
const has = (obj, key) => Object.hasOwn(obj, key);

function checkPhone(f, before) {
  if (!f.phone || f.phone === before) return;
  if (!phonesOk(f.phone)) throw bad('เบอร์โทรไม่ถูกต้อง เช่น 081 234 5678 หรือ 02 123 4567');
}

function text(body, key, label, max, required) {
  const v = body[key];
  if (v !== null && v !== undefined && typeof v !== 'string') throw bad(label + 'ต้องเป็นข้อความ');
  const out = (v || '').trim();
  if (!out) {
    if (required) throw bad('ต้องกรอก' + label);
    return null;
  }
  if (out.length > max) throw bad(label + 'ยาวเกิน ' + max + ' ตัวอักษร');
  return out;
}

function coord(body, key, label, min, max) {
  const v = body[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw bad(label + 'ต้องเป็นตัวเลข');
  if (v < min || v > max) throw bad(label + 'อยู่นอกประเทศไทย');
  return Math.round(v * 1e6) / 1e6;
}

function readFields(body, partial) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('รูปแบบข้อมูลไม่ถูกต้อง');
  const f = {};
  const want = key => !partial || has(body, key);
  if (want('status')) {
    if (!TYPES.has(body.status)) throw bad('ประเภทต้องเป็น Existing หรือ Prospect');
    f.type = body.status;
  }
  if (want('businessName')) f.business_name = text(body, 'businessName', 'ชื่อธุรกิจ', 200, true);
  if (want('segment')) f.segment = text(body, 'segment', 'หมวดธุรกิจ', 60, true);
  if (want('province')) f.province = text(body, 'province', 'จังหวัด', 80, true);
  if (want('latitude')) f.latitude = coord(body, 'latitude', 'ละติจูด', 5.5, 20.6);
  if (want('longitude')) f.longitude = coord(body, 'longitude', 'ลองจิจูด', 97, 106);
  if (has(body, 'category')) f.category = text(body, 'category', 'หมวดหมู่', 60, false);
  if (has(body, 'district')) f.district = text(body, 'district', 'อำเภอ', 80, false);
  if (has(body, 'address')) f.address = text(body, 'address', 'ที่อยู่', 500, false);
  if (has(body, 'phone')) f.phone = text(body, 'phone', 'โทรศัพท์', 60, false);
  if (has(body, 'website')) f.website = text(body, 'website', 'เว็บไซต์', 300, false);
  if (has(body, 'facebook')) f.facebook = text(body, 'facebook', 'เฟซบุ๊ก', 300, false);
  if (has(body, 'accountNo')) f.account_no = text(body, 'accountNo', 'รหัสลูกค้า', 40, false);
  if (has(body, 'email')) {
    f.email = text(body, 'email', 'อีเมล', 200, false);
    if (f.email && !EMAIL_RE.test(f.email)) throw bad('รูปแบบอีเมลไม่ถูกต้อง');
  }
  if (has(body, 'dateJoin')) {
    f.date_join = text(body, 'dateJoin', 'วันที่เริ่มเป็นลูกค้า', 10, false);
    if (f.date_join && (!DATE_RE.test(f.date_join) || Number.isNaN(Date.parse(f.date_join))))
      throw bad('วันที่เริ่มเป็นลูกค้าไม่ถูกต้อง');
  }
  return f;
}

async function resolveOwner(db, body, f) {
  if (!has(body, 'tc_owner')) return;
  const v = body.tc_owner;
  if (v !== null && v !== undefined && typeof v !== 'string') throw bad('ชื่อ TC ไม่ถูกต้อง');
  const name = (v || '').trim();
  if (UNASSIGNED.has(name)) { f.tc_owner_id = null; return; }
  const r = await db.query("select id from users where name = $1 and role = 'Trade Coordinator' order by id limit 1", [name]);
  if (!r.rowCount) throw bad('ไม่พบ TC ชื่อนี้ในระบบ: ' + name.slice(0, 80));
  f.tc_owner_id = r.rows[0].id;
}

async function checkProvince(db, f) {
  if (f.province === undefined) return;
  const r = await db.query('select 1 from provinces where key = $1', [f.province]);
  if (!r.rowCount) throw bad('ไม่รู้จักจังหวัดนี้: ' + f.province);
}

async function checkSegment(db, f) {
  if (f.segment === undefined) return;
  if (!(await isActive(db, 'segments', f.segment))) throw bad('ไม่รู้จักหมวดธุรกิจนี้ หรือหมวดถูกปิดใช้งาน: ' + f.segment);
}

async function fetchByIds(db, ids) {
  const out = [];
  for (const k of Object.values(KINDS)) {
    const r = await db.query(SQL, [k.type, null, null, ids]);
    out.push(...r.rows.map(k.map));
  }
  const order = new Map(ids.map((id, i) => [id, i]));
  return out.sort((a, b) => order.get(a.id) - order.get(b.id));
}

export const readPlace = async (db, id) => (await fetchByIds(db, [id]))[0] || null;

const newId = type => (type === 'Existing' ? 'CUSU' : 'PROU') + randomBytes(6).toString('hex').toUpperCase();

export async function createPlaces(pool, records, ctx) {
  if (!Array.isArray(records) || !records.length) throw bad('ต้องมีรายการอย่างน้อย 1 รายการ');
  if (records.length > MAX_BATCH) throw bad('เพิ่มได้ครั้งละไม่เกิน ' + MAX_BATCH + ' รายการ');
  return withTransaction(pool, async tx => {
    const ids = [];
    for (const [i, body] of records.entries()) {
      let f;
      try {
        f = readFields(body, false);
        if (f.type === 'Existing' && !f.account_no) throw bad('ต้องกรอกรหัสลูกค้า');
        checkPhone(f, null);
        await resolveOwner(tx, body, f);
        await checkProvince(tx, f);
        await checkSegment(tx, f);
      } catch (e) {
        if (e.status === 400 && records.length > 1) e.message = 'รายการที่ ' + (i + 1) + ': ' + e.message;
        throw e;
      }
      f.id = newId(f.type);
      f.source = 'manual_admin';
      if (f.type === 'Prospect') f.visit_status = 'ยังไม่เข้าพบ';
      const cols = Object.keys(f);
      await tx.query('insert into places (' + cols.join(', ') + ') values (' + cols.map((_, n) => '$' + (n + 1)).join(', ') + ')',
        cols.map(c => f[c]));
      ids.push(f.id);
      await writeAudit(tx, ctx, 'place_create', f.id, {type: f.type, businessName: f.business_name, province: f.province});
    }
    return fetchByIds(tx, ids);
  });
}

export async function updatePlace(pool, id, body, ctx) {
  return withTransaction(pool, async tx => {
    const cur = await tx.query('select type, account_no, phone from places where id = $1 and deleted_at is null for update', [id]);
    if (!cur.rowCount) return null;
    const f = readFields(body, true);
    checkPhone(f, cur.rows[0].phone == null ? null : cur.rows[0].phone.trim());
    await resolveOwner(tx, body, f);
    await checkProvince(tx, f);
    await checkSegment(tx, f);
    const type = f.type || cur.rows[0].type;
    const account = has(f, 'account_no') ? f.account_no : cur.rows[0].account_no;
    if (type === 'Existing' && !account) throw bad('ต้องกรอกรหัสลูกค้า');
    const cols = Object.keys(f);
    if (cols.length) {
      const sets = cols.map((c, n) => c + ' = $' + (n + 2));
      if (type === 'Existing' && cur.rows[0].type === 'Prospect') sets.push('converted_at = now()');
      if (type === 'Prospect' && cur.rows[0].type === 'Existing') sets.push("visit_status = coalesce(visit_status, 'ยังไม่เข้าพบ')");
      await tx.query('update places set ' + sets.join(', ') + ' where id = $1', [id, ...cols.map(c => f[c])]);
      await writeAudit(tx, ctx, 'place_update', id, {fields: cols});
    }
    return (await fetchByIds(tx, [id]))[0];
  });
}

export async function deletePlace(pool, id, ctx) {
  return withTransaction(pool, async tx => {
    const r = await tx.query('update places set deleted_at = now() where id = $1 and deleted_at is null', [id]);
    if (r.rowCount > 0) await writeAudit(tx, ctx, 'place_delete', id, {});
    return r.rowCount > 0;
  });
}
