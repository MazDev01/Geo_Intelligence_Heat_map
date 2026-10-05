import {Worker} from 'node:worker_threads';
import {withTransaction} from './db/pool.mjs';
import {headerSignature} from './import-parse.mjs';
import {readMapping, classifyFile, previewFile, applyFile} from './import-validate.mjs';

const WORKER_URL = new URL('./import-worker.mjs', import.meta.url);
const PARSE_TIMEOUT_MS = 60000;
const WORKER_HEAP_MB = 1024;
const STAGING_CHUNK = 5000;
const SAMPLE_ROWS = 5;
const STALE_UPLOAD = '24 hours';

const fail = (status, message) => Object.assign(new Error(message), {status});

let parsing = false;

function parseInWorker(bytes, filename) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_URL, {workerData: {bytes, filename}, resourceLimits: {maxOldGenerationSizeMb: WORKER_HEAP_MB}});
    let settled = false;
    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      worker.terminate();
      done(reject, fail(400, 'อ่านไฟล์นี้นานเกินไป กรุณาแบ่งไฟล์ให้เล็กลง'));
    }, PARSE_TIMEOUT_MS);
    worker.once('message', m => done(m.ok ? resolve : reject, m.ok ? m.table : fail(m.status, m.message)));
    worker.once('error', e => done(reject, e && e.code === 'ERR_WORKER_OUT_OF_MEMORY'
      ? fail(400, 'ไฟล์นี้ใช้หน่วยความจำมากเกินไป กรุณาแบ่งไฟล์ให้เล็กลง') : e));
    worker.once('exit', code => done(reject, new Error('import worker stopped with code ' + code)));
  });
}

export async function importUpload(pool, {bytes, filename, userId}) {
  if (parsing) throw fail(429, 'มีไฟล์อื่นกำลังถูกอ่านอยู่ รอสักครู่แล้วลองใหม่');
  parsing = true;
  let table;
  try { table = await parseInWorker(bytes, filename); }
  finally { parsing = false; }

  const {headers, rows} = table;
  return withTransaction(pool, async tx => {
    await tx.query(`delete from import_files where status = 'pending' and uploaded_at < now() - interval '${STALE_UPLOAD}'`);
    const file = (await tx.query(
      `insert into import_files (filename, size_bytes, rows_total, headers, uploaded_by)
       values ($1, $2, $3, $4, $5) returning file_id, uploaded_at`,
      [filename, bytes.length, rows.length, JSON.stringify(headers), userId])).rows[0];
    for (let i = 0; i < rows.length; i += STAGING_CHUNK) {
      const chunk = rows.slice(i, i + STAGING_CHUNK);
      await tx.query(
        `insert into import_staging (file_id, row_no, raw)
         select $1, t.no, t.raw::jsonb from unnest($2::int[], $3::text[]) as t(no, raw)`,
        [file.file_id, chunk.map(r => r.no), chunk.map(r => JSON.stringify(r.cells))]);
    }
    const templates = (await tx.query(
      'select id, name, mapping from mapping_templates where header_signature = $1 order by created_at desc, id desc',
      [headerSignature(headers)])).rows;
    return {
      ok: true,
      file: {
        id: Number(file.file_id), filename, sizeBytes: bytes.length, rowsTotal: rows.length, kind: table.kind,
        sheet: table.sheet, sheetCount: table.sheetCount, encoding: table.encoding, headerRow: table.headerRow,
        uploadedAt: file.uploaded_at.toISOString(),
      },
      headers,
      sample: rows.slice(0, SAMPLE_ROWS).map(r => ({rowNo: r.no, cells: r.cells})),
      templates: templates.map(t => ({id: Number(t.id), name: t.name, mapping: t.mapping})),
    };
  });
}

export async function mapUpload(pool, body, userId) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'อ่านคำขอไม่ได้');
  const fileId = Number(body.fileId);
  if (!Number.isSafeInteger(fileId) || fileId < 1) throw fail(400, 'ต้องระบุไฟล์');
  let templateName = null;
  if (body.saveTemplate !== undefined && body.saveTemplate !== null && body.saveTemplate !== '') {
    if (typeof body.saveTemplate !== 'string') throw fail(400, 'ชื่อผังการจับคู่ไม่ถูกต้อง');
    templateName = body.saveTemplate.trim();
    if (!templateName || templateName.length > 80) throw fail(400, 'ชื่อผังการจับคู่ต้องยาว 1 ถึง 80 ตัวอักษร');
  }
  return withTransaction(pool, async tx => {
    const file = (await tx.query("select file_id, headers from import_files where file_id = $1 and status = 'pending' for update", [fileId])).rows[0];
    if (!file) throw fail(404, 'ไม่พบไฟล์นี้ หรือไฟล์นี้ถูกยืนยันไปแล้ว');
    const plan = readMapping(file.headers, body);
    const known = await classifyFile(tx, fileId, plan);
    const preview = await previewFile(tx, known);
    let templateId = null;
    if (templateName) {
      templateId = Number((await tx.query(
        `insert into mapping_templates (name, header_signature, mapping, created_by) values ($1, $2, $3, $4)
         on conflict (name) do update set header_signature = excluded.header_signature, mapping = excluded.mapping,
           created_by = excluded.created_by, created_at = now()
         returning id`,
        [templateName, headerSignature(file.headers), JSON.stringify(plan.stored), userId])).rows[0].id);
    }
    await tx.query('update import_files set mapping = $2, template_id = coalesce($3, template_id) where file_id = $1',
      [fileId, JSON.stringify(plan.stored), templateId]);
    return {ok: true, fileId, mapping: plan.stored, templateId, ...preview};
  });
}

export async function confirmUpload(pool, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'อ่านคำขอไม่ได้');
  const fileId = Number(body.fileId);
  if (!Number.isSafeInteger(fileId) || fileId < 1) throw fail(400, 'ต้องระบุไฟล์');
  return withTransaction(pool, async tx => {
    const file = (await tx.query(
      "select file_id, filename, headers, mapping from import_files where file_id = $1 and status = 'pending' for update", [fileId])).rows[0];
    if (!file) throw fail(404, 'ไม่พบไฟล์นี้ หรือไฟล์นี้ถูกยืนยันไปแล้ว');
    const stored = file.mapping || {};
    if (!stored.fields || !Object.keys(stored.fields).length) throw fail(400, 'ยังไม่ได้จับคู่คอลัมน์ของไฟล์นี้');
    const plan = readMapping(file.headers, {mapping: stored.fields, defaults: stored.defaults});
    await classifyFile(tx, fileId, plan);
    const counts = await applyFile(tx, fileId);
    await tx.query('delete from import_staging where file_id = $1', [fileId]);
    const problems = counts.total - counts.ok;
    const status = !problems ? 'completed' : counts.ok ? 'partial' : 'failed';
    await tx.query(
      'update import_files set status = $2, rows_total = $3, rows_ok = $4, rows_error = $5, rows_dup = $6 where file_id = $1',
      [fileId, status, counts.total, counts.ok, counts.incomplete + counts.badcoord, counts.dup]);
    return {ok: true, file: {id: fileId, filename: file.filename, status}, counts, queued: problems};
  });
}

const WITHDRAW_DAYS = 7;
const KEPT = `(p.converted_at is not null or exists (select 1 from place_visits v where v.place_id = p.id and v.status <> 'ยกเลิก'))`;

const FILES_SQL = `
select f.file_id, f.filename, f.size_bytes, f.status, f.rows_total, f.rows_ok, f.rows_error, f.rows_dup, f.uploaded_at,
  f.withdrawn_at, u.name as uploaded_by, w.name as withdrawn_by, t.name as template,
  coalesce(q.pending, 0) as pending, coalesce(q.imported, 0) as imported, coalesce(q.merged, 0) as merged, coalesce(q.skipped, 0) as skipped,
  coalesce(pl.live, 0) as live, coalesce(pl.kept, 0) as kept, coalesce(pl.edited, 0) as edited,
  floor(extract(epoch from now() - f.uploaded_at) / 86400)::int as age_days,
  (f.status <> 'withdrawn' and f.uploaded_at > now() - make_interval(days => $5)) as can_withdraw,
  count(*) over ()::int as total
from import_files f
left join users u on u.id = f.uploaded_by
left join users w on w.id = f.withdrawn_by
left join mapping_templates t on t.id = f.template_id
left join lateral (
  select count(*) filter (where r.status = 'pending')::int as pending, count(*) filter (where r.status = 'imported')::int as imported,
    count(*) filter (where r.status = 'merged')::int as merged, count(*) filter (where r.status = 'skipped')::int as skipped
  from import_rows r where r.file_id = f.file_id) q on true
left join lateral (
  select count(*)::int as live, count(*) filter (where ${KEPT})::int as kept,
    count(*) filter (where p.updated_at > p.created_at)::int as edited
  from places p where p.import_file_id = f.file_id and p.deleted_at is null) pl on true
where f.status <> 'pending'
  and ($1::boolean or f.status <> 'withdrawn')
  and ($2::text is null or position(lower($2) in lower(f.filename)) > 0)
  and ($3::text = 'all' or (($3 = 'pending') = (f.status <> 'withdrawn' and coalesce(q.pending, 0) > 0)))
order by (f.status <> 'withdrawn' and coalesce(q.pending, 0) > 0) desc, f.uploaded_at desc, f.file_id desc
limit $4 offset $6`;

const SUMMARY_SQL = `
select (select coalesce(sum(rows_ok), 0) from import_files where status not in ('pending', 'withdrawn'))::int
    + count(*) filter (where r.status in ('imported', 'merged'))::int as imported,
  count(*) filter (where r.status = 'pending')::int as pending,
  (select max(uploaded_at) from import_files where status not in ('pending', 'withdrawn')) as last_uploaded_at
from import_rows r join import_files f on f.file_id = r.file_id and f.status not in ('pending', 'withdrawn')`;

export async function listFiles(pool, query) {
  const filter = query.get('filter') || 'all';
  if (!['all', 'pending', 'done'].includes(filter)) throw fail(400, 'ตัวกรองไม่ถูกต้อง');
  const search = (query.get('q') || '').trim().slice(0, 200) || null;
  const limit = Math.min(Math.max(Number(query.get('limit')) || 20, 1), 100);
  const offset = Math.max(Number(query.get('offset')) || 0, 0);
  if (!Number.isSafeInteger(offset)) throw fail(400, 'ตำแหน่งเริ่มไม่ถูกต้อง');
  const rows = (await pool.query(FILES_SQL, [query.get('withdrawn') === '1', search, filter, limit, WITHDRAW_DAYS, offset])).rows;
  const sum = (await pool.query(SUMMARY_SQL)).rows[0];
  return {
    ok: true, total: rows.length ? rows[0].total : 0, limit, offset, withdrawDays: WITHDRAW_DAYS,
    summary: {imported: sum.imported, pending: sum.pending, lastUploadedAt: sum.last_uploaded_at ? sum.last_uploaded_at.toISOString() : null},
    files: rows.map(r => ({
      id: Number(r.file_id), filename: r.filename, sizeBytes: Number(r.size_bytes), status: r.status,
      uploadedAt: r.uploaded_at.toISOString(), uploadedBy: r.uploaded_by, template: r.template, ageDays: r.age_days,
      rowsTotal: r.rows_total, rowsOk: r.rows_ok, rowsError: r.rows_error, rowsDup: r.rows_dup,
      queue: {pending: r.pending, imported: r.imported, merged: r.merged, skipped: r.skipped},
      imported: r.rows_ok + r.imported + r.merged, hasPending: r.status !== 'withdrawn' && r.pending > 0,
      canWithdraw: r.can_withdraw,
      impact: {live: r.live, toWithdraw: r.live - r.kept, kept: r.kept, editedAfter: r.edited},
      withdrawnAt: r.withdrawn_at ? r.withdrawn_at.toISOString() : null, withdrawnBy: r.withdrawn_by,
    })),
  };
}

export async function withdrawFile(pool, body, userId) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'อ่านคำขอไม่ได้');
  const fileId = Number(body.fileId);
  if (!Number.isSafeInteger(fileId) || fileId < 1) throw fail(400, 'ต้องระบุไฟล์');
  return withTransaction(pool, async tx => {
    const file = (await tx.query(
      `select file_id, filename, status, uploaded_at > now() - make_interval(days => $2) as in_time
       from import_files where file_id = $1 for update`, [fileId, WITHDRAW_DAYS])).rows[0];
    if (!file || file.status === 'pending') throw fail(404, 'ไม่พบไฟล์นี้');
    if (file.status === 'withdrawn') throw fail(409, 'ไฟล์นี้ถูกยกเลิกไปแล้ว');
    if (!file.in_time) throw fail(409, 'ยกเลิกได้เฉพาะชุดที่นำเข้าไม่เกิน ' + WITHDRAW_DAYS + ' วัน');
    const kept = await tx.query(
      `update places p set needs_review = true where p.import_file_id = $1 and p.deleted_at is null and ${KEPT}`, [fileId]);
    const gone = await tx.query(
      `update places p set deleted_at = now() where p.import_file_id = $1 and p.deleted_at is null and not ${KEPT}`, [fileId]);
    await tx.query("update import_files set status = 'withdrawn', withdrawn_by = $2, withdrawn_at = now() where file_id = $1", [fileId, userId]);
    return {ok: true, file: {id: fileId, filename: file.filename, status: 'withdrawn'}, withdrawn: gone.rowCount, kept: kept.rowCount};
  });
}
