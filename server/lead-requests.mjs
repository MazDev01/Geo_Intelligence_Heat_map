import {withTransaction} from './db/pool.mjs';
import {writeAudit} from './audit.mjs';
import {isActive} from './master-data.mjs';
import {notify, adminIds, placeName} from './notifications.mjs';
import {SCOPE_SQL, gapSnapshot} from './visit-plans.mjs';
import {cleanFilename} from './import-parse.mjs';

const fail = (status, message) => Object.assign(new Error(message), {status});

export const MAX_DEAL_FILE_BYTES = 10485760;
const MAX_DEAL_FILE_BASE64 = Math.ceil(MAX_DEAL_FILE_BYTES / 3) * 4;
const FILE_TOO_BIG = 'ไฟล์แนบใหญ่เกิน 10 MB';
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const FILE_KINDS = [
  {ext: ['pdf'], mime: 'application/pdf', magic: Buffer.from('%PDF-')},
  {ext: ['jpg', 'jpeg'], mime: 'image/jpeg', magic: Buffer.from([0xff, 0xd8, 0xff])},
  {ext: ['png'], mime: 'image/png', magic: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])},
];

const fileOf = v => {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'object' || Array.isArray(v) || typeof v.name !== 'string' || typeof v.data !== 'string') throw fail(400, 'ไฟล์แนบไม่ถูกต้อง');
  const filename = cleanFilename(v.name);
  const m = /\.([A-Za-z0-9]+)$/.exec(filename);
  const ext = m ? m[1].toLowerCase() : '';
  const kind = FILE_KINDS.find(k => k.ext.includes(ext));
  if (!kind || filename.length <= ext.length + 1) throw fail(400, 'รองรับเฉพาะไฟล์ PDF JPG PNG');
  if (v.data.length > MAX_DEAL_FILE_BASE64) throw fail(413, FILE_TOO_BIG);
  if (v.data.length % 4 !== 0 || !BASE64_RE.test(v.data)) throw fail(400, 'ไฟล์แนบไม่ถูกต้อง');
  const bytes = Buffer.from(v.data, 'base64');
  if (!bytes.length) throw fail(400, 'ไฟล์แนบว่างเปล่า');
  if (bytes.length > MAX_DEAL_FILE_BYTES) throw fail(413, FILE_TOO_BIG);
  if (bytes.length < kind.magic.length || !bytes.subarray(0, kind.magic.length).equals(kind.magic)) throw fail(400, 'เนื้อไฟล์ไม่ใช่ ' + ext.toUpperCase() + ' จริง');
  return {filename, mime: kind.mime, bytes};
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UNDO_WINDOW_MS = 864e5;
const MAX_NOTE = 500;
const MAX_REASON_NOTE = 300;
const MAX_BULK = 50;
const OUT_STATUS = {pending: 'pending', converted: 'approved', rejected: 'rejected'};

const text = (v, label, max, required) => {
  if (v !== undefined && v !== null && typeof v !== 'string') throw fail(400, label + 'ต้องเป็นข้อความ');
  const out = (v || '').trim();
  if (!out) {
    if (required) throw fail(400, 'ต้องกรอก' + label);
    return null;
  }
  if (out.length > max) throw fail(400, label + 'ยาวเกิน ' + max + ' ตัวอักษร');
  return out;
};

const bodyOf = body => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'อ่านคำขอไม่ได้');
  return body;
};

const idOf = v => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 1) throw fail(400, 'รหัสคำขอไม่ถูกต้อง');
  return n;
};

const SELECT_SQL = `
select r.id, r.place_id, r.status, r.note, r.submitted_at, r.reviewed_at, r.reject_reason, r.reject_note, r.cust_type, r.payload,
  sb.name as submitted_by_name, sb.email as submitted_by_email, rb.name as reviewed_by_name,
  ow.id as owner_id, ow.name as owner_name,
  p.business_name, p.segment, p.province, p.district, p.address, p.phone, p.email, p.account_no, p.converted_at,
  p.latitude::float8 as latitude, p.longitude::float8 as longitude,
  coalesce((select json_agg(json_build_object('round', v.round, 'status', v.status,
      'doneDate', to_char(v.done_date, 'YYYY-MM-DD'), 'interest', v.interest, 'outcome', v.outcome) order by v.round)
    from place_visits v where v.place_id = r.place_id), '[]') as visits,
  coalesce((select json_agg(json_build_object('id', f.id, 'name', f.filename, 'size', f.size_bytes, 'mime', f.mime) order by f.id)
    from lead_request_files f where f.request_id = r.id), '[]') as files,
  count(*) over ()::int as total
from lead_requests r
left join places p on p.id = r.place_id
left join users sb on sb.id = r.submitted_by
left join users rb on rb.id = r.reviewed_by
left join users ow on ow.id = r.owner_id`;
const ORDER_SQL = `order by case when r.status = 'pending' then r.submitted_at end asc nulls last, r.reviewed_at desc nulls last, r.id desc`;

const toRequest = r => {
  const pl = r.payload || {};
  const converted = r.status === 'converted';
  return {
    id: Number(r.id), placeId: r.place_id, status: OUT_STATUS[r.status], businessName: r.business_name, segment: r.segment,
    province: r.province, district: r.district, address: r.address, phone: r.phone, email: r.email,
    latitude: r.latitude, longitude: r.longitude,
    accountNo: converted ? r.account_no : null, convertedAt: converted && r.converted_at ? r.converted_at.toISOString() : null,
    note: r.note, requestedBy: r.submitted_by_name, requestedByEmail: r.submitted_by_email, requestedAt: r.submitted_at.toISOString(),
    reviewedBy: r.reviewed_by_name, reviewedAt: r.reviewed_at ? r.reviewed_at.toISOString() : null,
    rejectReason: r.reject_reason, rejectNote: r.reject_note,
    ownerId: r.owner_id, ownerName: r.owner_name, custType: r.cust_type,
    segmentFrom: pl.segmentFrom ?? null, gapSnapshot: pl.gap ?? null, gapLevelSnapshot: pl.level ?? null, visitDate: pl.visitDate ?? null,
    visits: r.visits, files: r.files,
  };
};

const readOne = async (db, id) => {
  const r = await db.query(SELECT_SQL + ' where r.id = $1', [id]);
  return r.rows[0] ? toRequest(r.rows[0]) : null;
};

const STATUS_FILTER = {pending: ['pending'], approved: ['converted'], rejected: ['rejected'], history: ['converted', 'rejected'], all: null};
const like = v => '%' + v.replace(/[\\%_]/g, m => '\\' + m) + '%';
const dateOk = v => {
  const d = DATE_RE.test(v) ? new Date(v + 'T00:00:00Z') : null;
  return !!d && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

export async function listRequests(pool, user, query, {max, contact = true} = {}) {
  const filter = query.get('status') || 'all';
  if (!Object.hasOwn(STATUS_FILTER, filter)) throw fail(400, 'ตัวกรองสถานะไม่ถูกต้อง');
  const limit = max ? max + 1 : Math.min(Math.max(parseInt(query.get('limit') || '50', 10) || 50, 1), 100);
  const page = max ? 1 : Math.max(parseInt(query.get('page') || '1', 10) || 1, 1);
  const where = [], args = [];
  const add = (sql, v) => { args.push(v); where.push(sql.replace('?', '$' + args.length)); };
  if (user.role !== 'Administrator') add('r.submitted_by = ?', user.id);
  const province = (query.get('province') || '').slice(0, 80);
  if (province) add('p.province = ?', province);
  const scopeWhere = [...where], scopeArgs = [...args];
  const submitter = query.get('submitter');
  if (submitter) {
    const n = Number(submitter);
    if (!Number.isSafeInteger(n) || n < 1) throw fail(400, 'ผู้ส่งไม่ถูกต้อง');
    add('r.submitted_by = ?', n);
  }
  for (const [key, op] of [['from', ">= (?::date)::timestamp at time zone 'Asia/Bangkok'"], ['to', "< ((?::date) + 1)::timestamp at time zone 'Asia/Bangkok'"]]) {
    const v = query.get(key);
    if (!v) continue;
    if (!dateOk(v)) throw fail(400, 'วันที่ไม่ถูกต้อง');
    add('r.submitted_at ' + op, v);
  }
  const text = (query.get('q') || '').trim().slice(0, 200);
  if (text) {
    args.push(like(text));
    const n = '$' + args.length;
    where.push(contact ? `(p.business_name ilike ${n} or p.phone ilike ${n} or p.email ilike ${n} or p.id ilike ${n})`
      : `(p.business_name ilike ${n} or p.id ilike ${n})`);
  }
  const statuses = STATUS_FILTER[filter];
  if (statuses) add('r.status = any(?::text[])', statuses);
  const cond = list => (list.length ? ' where ' + list.join(' and ') : '');
  const rows = (await pool.query(SELECT_SQL + cond(where) + ' ' + ORDER_SQL + ` limit $${args.length + 1} offset $${args.length + 2}`,
    [...args, limit, (page - 1) * limit])).rows;
  const out = rows.map(toRequest);
  if (!contact) for (const o of out) { o.phone = null; o.email = null; }
  if (max) return {ok: true, rows: out};
  const base = ' from lead_requests r left join places p on p.id = r.place_id left join users sb on sb.id = r.submitted_by' + cond(scopeWhere);
  const counts = (await pool.query(
    `select count(*)::int as all, count(*) filter (where r.status = 'pending')::int as pending,
       count(*) filter (where r.status = 'converted')::int as approved, count(*) filter (where r.status = 'rejected')::int as rejected` + base, scopeArgs)).rows[0];
  counts.history = counts.approved + counts.rejected;
  const submitters = (await pool.query(
    'select distinct sb.id, sb.name' + base + (scopeWhere.length ? ' and' : ' where') + ' sb.id is not null order by sb.name', scopeArgs)).rows;
  return {ok: true, total: rows.length ? rows[0].total : 0, page, limit, counts, submitters, rows: out};
}

export async function submitRequest(pool, user, body, ctx) {
  const b = bodyOf(body);
  const placeId = typeof b.placeId === 'string' ? b.placeId : '';
  if (!placeId || placeId.length > 40) throw fail(400, 'ต้องระบุรหัส Lead');
  const note = text(b.note, 'หมายเหตุ', MAX_NOTE, false);
  let visitDate = null;
  if (b.visitDate !== undefined && b.visitDate !== null && b.visitDate !== '') {
    const d = String(b.visitDate);
    const t = Date.parse(d + 'T00:00:00Z');
    if (!DATE_RE.test(d) || Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== d) throw fail(400, 'วันเข้าพบไม่ถูกต้อง ใช้รูปแบบ ปปปป-ดด-วว');
    visitDate = d;
  }
  const file = fileOf(b.file);
  return withTransaction(pool, async tx => {
    const p = (await tx.query(
      `select id, type, province, segment, province in (${SCOPE_SQL}) as mine from places where id = $2 and deleted_at is null for update`,
      [user.id, placeId])).rows[0];
    if (!p) throw fail(404, 'ไม่พบ Lead นี้');
    if (!p.mine) throw fail(403, 'Lead นี้อยู่นอกพื้นที่รับผิดชอบ');
    if (p.type !== 'Prospect') throw fail(400, 'ส่งดีลได้เฉพาะ Lead');
    const dup = await tx.query("select 1 from lead_requests where place_id = $1 and status = 'pending'", [placeId]);
    if (dup.rowCount) throw fail(409, 'Lead นี้มีคำขอรออนุมัติอยู่แล้ว');
    const snap = (await gapSnapshot(tx, p.province))(p.segment);
    const id = (await tx.query(
      `insert into lead_requests (place_id, payload, note, submitted_by) values ($1, $2::jsonb, $3, $4) returning id`,
      [placeId, JSON.stringify({gap: snap.gap, level: snap.level, visitDate}), note, user.id])).rows[0].id;
    if (file) {
      await tx.query('insert into lead_request_files (request_id, filename, mime, size_bytes, content) values ($1, $2, $3, $4, $5)',
        [id, file.filename, file.mime, file.bytes.length, file.bytes]);
    }
    await writeAudit(tx, ctx, 'lead_request_submit', placeId, {requestId: Number(id), gap: snap.gap, ...(file ? {file: file.filename} : {})});
    const name = await placeName(tx, placeId);
    await notify(tx, await adminIds(tx, user.id), 'deal_new', 'ดีลใหม่รออนุมัติ: ' + name,
      {requestId: Number(id), placeId, name, province: p.province, by: user.name || user.email || ''});
    return {ok: true, request: await readOne(tx, Number(id))};
  });
}

export async function readRequestFile(pool, user, query) {
  const id = Number(query.get('id'));
  if (!Number.isSafeInteger(id) || id < 1) throw fail(400, 'รหัสไฟล์ไม่ถูกต้อง');
  const f = (await pool.query(
    `select f.filename, f.mime, f.content, r.submitted_by from lead_request_files f
       join lead_requests r on r.id = f.request_id where f.id = $1`, [id])).rows[0];
  const mine = user.role === 'Administrator' || (f && f.submitted_by !== null && Number(f.submitted_by) === Number(user.id));
  if (!f || !f.content || !mine) throw fail(404, 'ไม่พบไฟล์นี้');
  return {name: f.filename, type: f.mime || 'application/octet-stream', body: f.content};
}

async function lockPending(tx, id) {
  const r = (await tx.query('select id, place_id, status, reviewed_at, submitted_by from lead_requests where id = $1 for update', [id])).rows[0];
  if (!r) throw fail(404, 'ไม่พบคำขอนี้');
  return r;
}

export async function approveRequest(pool, user, body, ctx) {
  const b = bodyOf(body);
  const id = idOf(b.id);
  const custType = text(b.custType, 'ประเภทลูกค้า', 40, false);
  const segment = text(b.segment, 'หมวดธุรกิจ', 60, false);
  let ownerId = null;
  if (b.ownerId !== undefined && b.ownerId !== null && b.ownerId !== '') {
    ownerId = Number(b.ownerId);
    if (!Number.isSafeInteger(ownerId) || ownerId < 1) throw fail(400, 'ผู้ดูแลไม่ถูกต้อง');
  }
  return withTransaction(pool, async tx => {
    const req = await lockPending(tx, id);
    if (req.status !== 'pending') throw fail(409, 'คำขอนี้ถูกตัดสินไปแล้ว');
    if (ownerId !== null) {
      const o = await tx.query("select 1 from users where id = $1 and role = 'Trade Coordinator' and status <> 'Suspended'", [ownerId]);
      if (!o.rowCount) throw fail(400, 'ไม่พบ TC ที่เลือกเป็นผู้ดูแล');
    }
    const p = req.place_id ? (await tx.query('select id, type, account_no, segment, date_join, deleted_at from places where id = $1 for update', [req.place_id])).rows[0] : null;
    if (!p || p.deleted_at) throw fail(409, 'Lead นี้ถูกลบไปแล้ว');
    if (p.type !== 'Prospect') throw fail(409, 'รายการนี้เป็นลูกค้าอยู่แล้ว');
    const newSegment = segment && segment !== p.segment ? segment : null;
    if (newSegment) {
      if (!(await isActive(tx, 'segments', newSegment))) throw fail(400, 'ไม่รู้จักหมวดธุรกิจนี้: ' + newSegment);
    }
    await tx.query(
      `update places set type = 'Existing', account_no = coalesce(account_no, id), converted_at = now(),
         tc_owner_id = coalesce($2, tc_owner_id), segment = coalesce($3, segment),
         date_join = coalesce(date_join, (now() at time zone 'Asia/Bangkok')::date) where id = $1`, [p.id, ownerId, newSegment]);
    await tx.query(
      `update lead_requests set status = 'converted', reviewed_by = $2, reviewed_at = now(), owner_id = $3, cust_type = $4,
         payload = payload || $5::jsonb where id = $1`,
      [id, user.id, ownerId, custType, JSON.stringify({prevAccountNo: p.account_no, hadDateJoin: !!p.date_join, ...(newSegment ? {segmentFrom: p.segment} : {})})]);
    await writeAudit(tx, ctx, 'lead_request_approve', p.id, {requestId: id, ownerId, custType, ...(newSegment ? {segmentFrom: p.segment, segmentTo: newSegment} : {})});
    const name = await placeName(tx, p.id);
    await notify(tx, req.submitted_by, 'deal_result', 'ดีล ' + name + ' ได้รับอนุมัติ', {requestId: id, placeId: p.id, name, result: 'approved'});
    return {ok: true, request: await readOne(tx, id)};
  });
}

export async function rejectRequests(pool, user, body, ctx) {
  const b = bodyOf(body);
  const raw = b.ids !== undefined ? b.ids : [b.id];
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_BULK) throw fail(400, 'เลือกคำขอได้ครั้งละ 1 ถึง ' + MAX_BULK + ' รายการ');
  const ids = [...new Set(raw.map(idOf))];
  if (typeof b.reason !== 'string' || !(await isActive(pool, 'reject-reasons', b.reason))) throw fail(400, 'เหตุผลไม่ถูกต้อง');
  const note = text(b.note, 'หมายเหตุ', MAX_REASON_NOTE, b.reason === 'other');
  return withTransaction(pool, async tx => {
    const done = [], failed = [];
    for (const id of ids) {
      const req = (await tx.query('select id, place_id, status, submitted_by from lead_requests where id = $1 for update', [id])).rows[0];
      if (!req) { if (ids.length === 1) throw fail(404, 'ไม่พบคำขอนี้'); failed.push({id, error: 'ไม่พบคำขอนี้'}); continue; }
      if (req.status !== 'pending') {
        if (ids.length === 1) throw fail(409, 'คำขอนี้ถูกตัดสินไปแล้ว');
        failed.push({id, error: 'คำขอนี้ถูกตัดสินไปแล้ว'});
        continue;
      }
      await tx.query(
        `update lead_requests set status = 'rejected', reviewed_by = $2, reviewed_at = now(), reject_reason = $3, reject_note = $4 where id = $1`,
        [id, user.id, b.reason, b.reason === 'other' ? note : null]);
      await writeAudit(tx, ctx, 'lead_request_reject', req.place_id, {requestId: id, reason: b.reason});
      const name = await placeName(tx, req.place_id);
      await notify(tx, req.submitted_by, 'deal_result', 'ดีล ' + name + ' ถูกตีกลับ', {requestId: id, placeId: req.place_id, name, result: 'rejected', reason: b.reason});
      done.push(id);
    }
    return {ok: true, rejected: done, failed};
  });
}

export async function undoRequest(pool, user, body, ctx) {
  const b = bodyOf(body);
  const id = idOf(b.id);
  const reason = text(b.reason, 'เหตุผล', MAX_REASON_NOTE, true);
  return withTransaction(pool, async tx => {
    const req = await lockPending(tx, id);
    if (req.status !== 'converted') throw fail(409, 'ย้อนได้เฉพาะคำขอที่อนุมัติแล้ว');
    if (Date.now() - new Date(req.reviewed_at).getTime() > UNDO_WINDOW_MS) throw fail(409, 'ย้อนได้ภายใน 24 ชั่วโมงหลังอนุมัติเท่านั้น');
    const p = req.place_id ? (await tx.query('select id, type, deleted_at from places where id = $1 for update', [req.place_id])).rows[0] : null;
    if (!p || p.deleted_at) throw fail(409, 'รายการนี้ถูกลบไปแล้ว');
    if (p.type !== 'Existing') throw fail(409, 'รายการนี้ไม่ได้เป็นลูกค้าแล้ว');
    const prev = (await tx.query('select payload from lead_requests where id = $1', [id])).rows[0].payload || {};
    await tx.query(`update places set type = 'Prospect', account_no = $2, converted_at = null, segment = coalesce($3, segment),
         date_join = case when $4::boolean then date_join end where id = $1`,
      [p.id, prev.prevAccountNo ?? null, prev.segmentFrom ?? null, prev.hadDateJoin === true]);
    await tx.query(
      `update lead_requests set status = 'pending', reviewed_by = null, reviewed_at = null, owner_id = null, cust_type = null,
         payload = payload - 'prevAccountNo' - 'hadDateJoin' - 'segmentFrom' where id = $1`, [id]);
    await writeAudit(tx, ctx, 'lead_request_undo', p.id, {requestId: id, reason});
    const name = await placeName(tx, p.id);
    await notify(tx, req.submitted_by, 'deal_result', 'ดีล ' + name + ' ถูกย้อนกลับไปรออนุมัติ', {requestId: id, placeId: p.id, name, result: 'reopened'});
    return {ok: true, request: await readOne(tx, id)};
  });
}
