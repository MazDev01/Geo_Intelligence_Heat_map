import {Worker} from 'node:worker_threads';
import {withTransaction} from './db/pool.mjs';
import {headerSignature} from './import-parse.mjs';

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
