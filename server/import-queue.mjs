import {randomBytes} from 'node:crypto';
import {withTransaction} from './db/pool.mjs';
import {writeAudit} from './audit.mjs';
import {segmentList} from './master-data.mjs';
import {FIELDS, makeRowChecker, dupSettings, PROVINCE_SNAP_DEGREES} from './import-validate.mjs';

const fail = (status, message, extra) => Object.assign(new Error(message), {status, extra});

const KEYS = FIELDS.map(f => f.key);
const LABEL = {...Object.fromEntries(FIELDS.map(f => [f.key, f.label])), location: 'พิกัด'};
const COLUMN = {
  businessName: 'business_name', type: 'type', accountNo: 'account_no', segment: 'segment', category: 'category',
  province: 'province', district: 'district', address: 'address', latitude: 'latitude', longitude: 'longitude',
  phone: 'phone', email: 'email', website: 'website', facebook: 'facebook', dateJoin: 'date_join',
};
const MERGE_KEYS = KEYS.filter(k => k !== 'type' && k !== 'accountNo');
const STATUSES = ['pending', 'imported', 'merged', 'skipped'];
const KINDS = ['incomplete', 'dup', 'badcoord'];
const LIVE_FILE = ['completed', 'partial', 'failed'];
const MAX_IDS = 500;
const MAX_PAGE = 200;

const MATCH_JSON = `case when p.id is null then null else json_build_object(
  'id', p.id, 'businessName', p.business_name, 'type', p.type, 'accountNo', p.account_no, 'segment', p.segment,
  'province', p.province, 'district', p.district, 'address', p.address, 'phone', p.phone, 'email', p.email,
  'latitude', p.latitude::float8, 'longitude', p.longitude::float8, 'deleted', p.deleted_at is not null) end`;

const issueText = i => {
  const label = LABEL[i.field] || i.field;
  if (i.type === 'missing_required') return 'ต้องกรอก' + label + (i.detail ? ' (' + i.detail + ')' : '');
  return label + ': ' + (i.detail || 'ค่าไม่ถูกต้อง');
};

const idList = value => {
  const ids = Array.isArray(value) ? value : [value];
  if (!ids.length || ids.length > MAX_IDS) throw fail(400, 'ต้องระบุรายการ 1 ถึง ' + MAX_IDS + ' รายการ');
  const out = ids.map(Number);
  if (out.some(n => !Number.isSafeInteger(n) || n < 1)) throw fail(400, 'รหัสรายการไม่ถูกต้อง');
  return [...new Set(out)];
};

function readValues(values, allowed) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw fail(400, 'ข้อมูลที่แก้ไขไม่ถูกต้อง');
  const out = {};
  for (const [key, value] of Object.entries(values)) {
    if (!allowed.includes(key)) throw fail(400, 'แก้ช่องนี้ไม่ได้: ' + String(key).slice(0, 40));
    if (value === null || value === undefined) out[key] = '';
    else if (typeof value === 'string') out[key] = value.trim();
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = String(value);
    else throw fail(400, LABEL[key] + 'ต้องเป็นข้อความหรือตัวเลข');
  }
  return out;
}

async function makeContext(tx) {
  const provinces = (await tx.query('select key, name_th, name_en from provinces')).rows;
  const segments = await segmentList(tx);
  const check = makeRowChecker({cols: Object.fromEntries(KEYS.map((k, i) => [k, i])), defaults: {}}, provinces, segments);
  return {check, dup: await dupSettings(tx)};
}

async function checkOne(tx, ctx, values) {
  const r = ctx.check(KEYS.map(k => values[k] ?? ''));
  if (r.needProvince) {
    const found = (await tx.query(
      `select key from (
         select key, 0 as d from provinces where ST_Contains(boundary, ST_SetSRID(ST_MakePoint($1, $2), 4326))
         union all
         select key, ST_Distance(boundary, ST_SetSRID(ST_MakePoint($1, $2), 4326)) from provinces
           where ST_DWithin(boundary, ST_SetSRID(ST_MakePoint($1, $2), 4326), $3)) t
       order by d limit 1`, [r.lng, r.lat, PROVINCE_SNAP_DEGREES])).rows[0];
    if (found) r.vals.province = found.key;
    else {
      r.issues.push({type: 'missing_required', field: 'province', severity: 'error', detail: 'หาจังหวัดจากพิกัดไม่ได้'});
      if (r.kind === 'ok') r.kind = 'incomplete';
    }
  }
  return r;
}

async function findDuplicate(tx, ctx, vals, exceptId) {
  const r = await tx.query(
    `select id, reason, sim from (
       select p.id, 'account' as reason, 1 as rank, similarity(place_name_key(p.business_name), place_name_key($1)) as sim
       from places p where p.deleted_at is null and p.account_no = $2 and p.id <> coalesce($7, '')
       union all
       select p.id, 'name', 2, similarity(place_name_key(p.business_name), place_name_key($1))
       from places p where p.deleted_at is null and p.id <> coalesce($7, '') and place_name_key($1) <> ''
         and ST_DWithin(p.geom, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5::float8 / 100000)
         and ST_DWithin(p.geom::geography, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, $5)
         and similarity(place_name_key(p.business_name), place_name_key($1)) >= $6) t
     order by rank, sim desc, id limit 1`,
    [vals.businessName, vals.accountNo, vals.longitude, vals.latitude, ctx.dup.distance, ctx.dup.similarity, exceptId || null]);
  return r.rows[0] ? {id: r.rows[0].id, reason: r.rows[0].reason, similarity: Math.round(Number(r.rows[0].sim) * 1000) / 1000} : null;
}

const mustBeValid = r => {
  if (r.kind === 'ok') return;
  throw fail(400, r.issues.map(issueText).join(' · ') || 'ข้อมูลยังไม่ครบ', {issues: r.issues});
};

async function lockRows(tx, ids, status) {
  const rows = (await tx.query(
    `select r.id, r.file_id, r.row_no, r.kind, r.raw, r.status, r.match_place_id, f.status as file_status
     from import_rows r join import_files f on f.file_id = r.file_id
     where r.id = any($1) order by r.id for update of r`, [ids])).rows;
  const byId = new Map(rows.map(r => [Number(r.id), r]));
  const problem = id => {
    const row = byId.get(id);
    if (!row) return 'ไม่พบรายการนี้';
    if (!LIVE_FILE.includes(row.file_status)) return 'ไฟล์ของรายการนี้ถูกยกเลิกไปแล้ว';
    if (row.status !== status) return status === 'pending' ? 'รายการนี้ถูกตัดสินไปแล้ว' : 'รายการนี้ไม่ได้อยู่ในสถานะข้าม';
    return null;
  };
  return {byId, problem};
}

async function importOne(tx, ctx, row, values, keepBoth, userId) {
  const r = await checkOne(tx, ctx, values);
  mustBeValid(r);
  if (!keepBoth) {
    const dup = await findDuplicate(tx, ctx, r.vals);
    if (dup) throw fail(409, 'รายการนี้อาจซ้ำกับรายการที่มีอยู่แล้ว', {duplicate: dup});
  }
  const v = r.vals;
  const id = (v.type === 'Existing' ? 'CUSU' : 'PROU') + randomBytes(6).toString('hex').toUpperCase();
  await tx.query(
    `insert into places (id, type, account_no, business_name, category, segment, province, district, address,
       latitude, longitude, phone, email, website, facebook, date_join, visit_status, source, import_file_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'import_file', $18)`,
    [id, v.type, v.accountNo, v.businessName, v.category, v.segment, v.province, v.district, v.address, v.latitude, v.longitude,
      v.phone, v.email, v.website, v.facebook, v.dateJoin, v.type === 'Prospect' ? 'ยังไม่เข้าพบ' : null, row.file_id]);
  await tx.query(
    "update import_rows set status = 'imported', corrected = $2, place_id = $3, decided_by = $4, decided_at = now() where id = $1",
    [row.id, JSON.stringify(v), id, userId]);
  return id;
}

async function actImport(tx, body, userId) {
  const ids = idList(body.ids !== undefined ? body.ids : body.id);
  if (body.values !== undefined && ids.length !== 1) throw fail(400, 'แก้ไขค่าได้ครั้งละ 1 รายการ');
  const keepBoth = body.keepBoth === true;
  const {byId, problem} = await lockRows(tx, ids, 'pending');
  const ctx = await makeContext(tx);
  const imported = [], failed = [];
  for (const id of ids) {
    const why = problem(id);
    if (why) {
      if (ids.length === 1) throw fail(byId.has(id) ? 409 : 404, why);
      failed.push({id, error: why});
      continue;
    }
    const row = byId.get(id);
    if (ids.length === 1) {
      const values = readValues(body.values !== undefined ? body.values : row.raw, KEYS);
      imported.push({id, placeId: await importOne(tx, ctx, row, values, keepBoth, userId)});
      continue;
    }
    await tx.query('savepoint one_row');
    try {
      imported.push({id, placeId: await importOne(tx, ctx, row, readValues(row.raw, KEYS), keepBoth, userId)});
      await tx.query('release savepoint one_row');
    } catch (e) {
      await tx.query('rollback to savepoint one_row');
      if (!e || ![400, 409].includes(e.status)) throw e;
      failed.push({id, error: e.message});
    }
  }
  return {ok: true, imported, failed};
}

async function actMerge(tx, body, userId) {
  const [id] = idList(body.id);
  const {byId, problem} = await lockRows(tx, [id], 'pending');
  const why = problem(id);
  if (why) throw fail(byId.has(id) ? 409 : 404, why);
  const row = byId.get(id);
  if (!row.match_place_id) throw fail(400, 'รายการนี้ไม่มีรายการเดิมให้รวม');
  const place = (await tx.query(
    `select id, type, account_no, business_name, category, segment, province, district, address, latitude::float8 as latitude,
       longitude::float8 as longitude, phone, email, website, facebook, to_char(date_join, 'YYYY-MM-DD') as date_join
     from places where id = $1 and deleted_at is null for update`, [row.match_place_id])).rows[0];
  if (!place) throw fail(409, 'รายการเดิมถูกลบไปแล้ว รวมไม่ได้');

  const chosen = readValues(body.values, MERGE_KEYS);
  const full = {};
  for (const key of KEYS) full[key] = place[COLUMN[key]] === null ? '' : String(place[COLUMN[key]]);
  Object.assign(full, chosen);
  const ctx = await makeContext(tx);
  const r = await checkOne(tx, ctx, full);
  mustBeValid(r);

  const keys = Object.keys(chosen);
  if (keys.length) {
    await tx.query(
      'update places set ' + keys.map((k, n) => COLUMN[k] + ' = $' + (n + 2)).join(', ') + ' where id = $1',
      [place.id, ...keys.map(k => r.vals[k])]);
  }
  const corrected = Object.fromEntries(keys.map(k => [k, r.vals[k]]));
  await tx.query(
    "update import_rows set status = 'merged', corrected = $2, place_id = $3, decided_by = $4, decided_at = now() where id = $1",
    [row.id, JSON.stringify(corrected), place.id, userId]);
  return {ok: true, merged: {id, placeId: place.id, changed: keys}};
}

async function actSkip(tx, body, userId, from, to) {
  const ids = idList(body.ids !== undefined ? body.ids : body.id);
  const {byId, problem} = await lockRows(tx, ids, from);
  const done = [], failed = [];
  for (const id of ids) {
    const why = problem(id);
    if (why) {
      if (ids.length === 1) throw fail(byId.has(id) ? 409 : 404, why);
      failed.push({id, error: why});
    } else done.push(id);
  }
  if (done.length && to === 'skipped')
    await tx.query("update import_rows set status = 'skipped', decided_by = $2, decided_at = now() where id = any($1)", [done, userId]);
  if (done.length && to === 'pending')
    await tx.query("update import_rows set status = 'pending', decided_by = null, decided_at = null where id = any($1)", [done]);
  return {ok: true, [to === 'skipped' ? 'skipped' : 'restored']: done, failed};
}

export async function actOnQueue(pool, body, userId, ctx) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'อ่านคำขอไม่ได้');
  return withTransaction(pool, async tx => {
    let out;
    if (body.action === 'import') out = await actImport(tx, body, userId);
    else if (body.action === 'merge') out = await actMerge(tx, body, userId);
    else if (body.action === 'skip') out = await actSkip(tx, body, userId, 'pending', 'skipped');
    else if (body.action === 'unskip') out = await actSkip(tx, body, userId, 'skipped', 'pending');
    else throw fail(400, 'ไม่รู้จักคำสั่งนี้');
    const ids = body.ids !== undefined ? body.ids : body.id;
    await writeAudit(tx, ctx, 'import_queue_' + body.action, null, {rows: Array.isArray(ids) ? ids.length : 1, ids: Array.isArray(ids) ? ids.slice(0, 50) : [ids]});
    return out;
  });
}

export async function listQueue(pool, query) {
  const fileText = query.get('fileId');
  const fileId = fileText === null || fileText === '' ? null : Number(fileText);
  if (fileId !== null && (!Number.isSafeInteger(fileId) || fileId < 1)) throw fail(400, 'รหัสไฟล์ไม่ถูกต้อง');
  const status = query.get('status') || 'pending';
  if (status !== 'all' && !STATUSES.includes(status)) throw fail(400, 'สถานะไม่ถูกต้อง');
  const kind = query.get('kind') || null;
  if (kind !== null && !KINDS.includes(kind)) throw fail(400, 'ชนิดปัญหาไม่ถูกต้อง');
  const limit = Math.min(Math.max(Number(query.get('limit')) || 50, 1), MAX_PAGE);
  const offset = Math.max(Number(query.get('offset')) || 0, 0);
  if (!Number.isSafeInteger(offset)) throw fail(400, 'ตำแหน่งเริ่มไม่ถูกต้อง');

  const live = "f.status = any('{" + LIVE_FILE.join(',') + "}')";
  const tally = (await pool.query(
    `select r.status, r.kind, count(*)::int as n from import_rows r join import_files f on f.file_id = r.file_id
     where ${live} and ($1::bigint is null or r.file_id = $1) group by r.status, r.kind`, [fileId])).rows;
  const counts = {pending: 0, incomplete: 0, dup: 0, badcoord: 0, imported: 0, merged: 0, skipped: 0};
  for (const t of tally) {
    counts[t.status] += t.n;
    if (t.status === 'pending') counts[t.kind] += t.n;
  }
  const where = `${live} and ($1::bigint is null or r.file_id = $1) and ($2::text is null or r.status = $2) and ($3::text is null or r.kind = $3)`;
  const args = [fileId, status === 'all' ? null : status, kind];
  const total = (await pool.query(`select count(*)::int as n from import_rows r join import_files f on f.file_id = r.file_id where ${where}`, args)).rows[0].n;
  const rows = (await pool.query(
    `select r.id, r.file_id, f.filename, r.row_no, r.kind, r.status, r.raw, r.corrected, r.issues, r.similarity::float8 as similarity,
       r.place_id, r.decided_at, u.name as decided_by, ${MATCH_JSON} as match
     from import_rows r join import_files f on f.file_id = r.file_id
     left join places p on p.id = r.match_place_id
     left join users u on u.id = r.decided_by
     where ${where} order by r.file_id desc, r.row_no limit $4 offset $5`, [...args, limit, offset])).rows;
  return {
    ok: true, total, limit, offset, counts,
    rows: rows.map(r => ({
      id: Number(r.id), fileId: Number(r.file_id), filename: r.filename, rowNo: r.row_no, kind: r.kind, status: r.status,
      raw: r.raw, corrected: r.corrected, issues: r.issues, similarity: r.similarity, match: r.match, placeId: r.place_id,
      decidedAt: r.decided_at ? r.decided_at.toISOString() : null, decidedBy: r.decided_by,
    })),
  };
}
