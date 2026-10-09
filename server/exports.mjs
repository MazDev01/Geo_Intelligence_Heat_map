import {createRequire} from 'node:module';
import {eventLabel, targetLabel, detailLabel, roleLabel} from './audit-labels.mjs';

const require = createRequire(import.meta.url);
let xlsxLib;
const xlsx = () => xlsxLib || (xlsxLib = require('xlsx'));

const fail = (status, message) => Object.assign(new Error(message), {status});

export const MAX_BODY = 4e6;
export const MAX_ROWS = 50000;
const MAX_COLS = 60;
const MAX_CELL = 32000;

const SUMMARY = 'report.export_summary';
const PII = 'report.export_raw_pii';
const KIND_PERM = {report: SUMMARY, visit_plans: SUMMARY, dashboard: PII, places: PII, tc_records: PII};
export const SOURCE_PERM = {audit: 'audit.export', lead_requests: PII};
const FORMATS = new Set(['pdf', 'excel', 'csv']);
const FILE_FORMATS = new Set(['excel', 'csv']);

export function checkKind(kind, format) {
  if (!Object.hasOwn(KIND_PERM, kind)) throw fail(400, 'ไม่รู้จักชนิดรายงาน');
  if (!FORMATS.has(format)) throw fail(400, 'รูปแบบไฟล์ไม่ถูกต้อง');
  return format === 'pdf' ? SUMMARY : KIND_PERM[kind];
}

export function checkSource(source, format) {
  if (!Object.hasOwn(SOURCE_PERM, source)) throw fail(400, 'ไม่รู้จักแหล่งข้อมูล');
  if (!FILE_FORMATS.has(format)) throw fail(400, 'รูปแบบไฟล์ไม่ถูกต้อง');
  return SOURCE_PERM[source];
}

export function cleanName(v, fallback = 'export') {
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f\\/:*?"<>|]+/g, '_').replace(/^[\s.]+|[\s.]+$/g, '').slice(0, 120) : '';
  return s || fallback;
}

const short = v => (typeof v === 'string' ? v.slice(0, 200) : null);

export function readRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'อ่านคำขอไม่ได้');
  const kind = String(body.kind || ''), format = String(body.format || '');
  const perm = checkKind(kind, format);
  const records = Number.isSafeInteger(body.records) && body.records >= 0 ? body.records : null;
  const sc = body.scope && typeof body.scope === 'object' && !Array.isArray(body.scope) ? body.scope : {};
  const scope = {area: short(sc.area), segment: short(sc.segment), period: short(sc.period)};
  const filename = cleanName(body.filename);
  if (format === 'pdf') return {kind, format, perm, records, scope, filename, rows: null};
  return {kind, format, perm, records, scope, filename, rows: checkRows(body.rows)};
}

export function checkRows(rows) {
  if (!Array.isArray(rows) || !rows.length) throw fail(400, 'ไม่มีข้อมูลให้ส่งออก');
  if (rows.length > MAX_ROWS) throw fail(400, 'ข้อมูลเกิน ' + MAX_ROWS.toLocaleString('en-US') + ' แถว กรุณากรองให้แคบลง');
  return rows.map(r => {
    if (!Array.isArray(r) || r.length > MAX_COLS) throw fail(400, 'รูปแบบแถวไม่ถูกต้อง');
    return r.map(c => {
      if (c === null || c === undefined) return '';
      if (typeof c === 'number') return Number.isFinite(c) ? c : '';
      if (typeof c === 'boolean') return String(c);
      if (typeof c !== 'string') throw fail(400, 'รูปแบบข้อมูลในช่องไม่ถูกต้อง');
      if (c.length > MAX_CELL) throw fail(400, 'ข้อความในช่องยาวเกินไป');
      return c;
    });
  });
}

export const dataRows = rows => rows.filter(r => r.some(c => c !== '')).length;

const FORMULA_RE = /^[=+\-@\t\r]/;
const csvCell = c => {
  const s = typeof c === 'number' ? String(c) : FORMULA_RE.test(c) ? "'" + c : c;
  return '"' + s.replace(/"/g, '""') + '"';
};

export function buildFile(format, rows) {
  if (format === 'csv') {
    const text = '\ufeff' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
    return {body: Buffer.from(text, 'utf8'), type: 'text/csv; charset=utf-8', ext: 'csv'};
  }
  const X = xlsx();
  const ws = X.utils.aoa_to_sheet(rows.map(r => r.map(c => (typeof c === 'string' ? {t: 's', v: c} : c))));
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, 'Export');
  return {
    body: X.write(wb, {type: 'buffer', bookType: 'xlsx', compression: true}),
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: 'xlsx',
  };
}

export function disposition(name, ext) {
  const full = name + '.' + ext;
  const ascii = full.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(full)}`;
}

const bkk = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'});
const when = v => (v ? bkk.format(new Date(v)) : '');

const HEAD = {
  audit: {
    th: ['เวลา (กรุงเทพฯ)', 'ผู้ทำรายการ', 'บทบาท', 'เหตุการณ์', 'เป้าหมาย', 'รายละเอียด', 'IP'],
    en: ['Time (Bangkok)', 'Actor', 'Role', 'Event', 'Target', 'Detail', 'IP'],
  },
  lead_requests: {
    th: ['รหัสคำขอ', 'สถานะ', 'ชื่อธุรกิจ', 'หมวดธุรกิจ', 'จังหวัด', 'อำเภอ/เขต', 'ที่อยู่', 'เบอร์โทร', 'อีเมล',
      'ผู้ส่ง', 'วันที่ส่ง', 'ผู้ตรวจ', 'วันที่ตรวจ', 'เหตุผลที่ปฏิเสธ', 'หมายเหตุ', 'ผู้ดูแล', 'รหัสลูกค้า'],
    en: ['Request ID', 'Status', 'Business name', 'Business category', 'Province', 'District', 'Address', 'Phone', 'Email',
      'Submitted by', 'Submitted at', 'Reviewed by', 'Reviewed at', 'Reject reason', 'Note', 'Owner', 'Account no.'],
  },
};

const STATUS = {
  th: {pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', rejected: 'ปฏิเสธ'},
  en: {pending: 'Pending', approved: 'Approved', rejected: 'Rejected'},
};

export function sourceRows(source, list, lang) {
  const L = lang === 'en' ? 'en' : 'th';
  if (source === 'audit')
    return [HEAD.audit[L], ...list.map(r => [when(r.at), r.actor || '', roleLabel(r.role, L), eventLabel(r.event, L), targetLabel(r, L),
      r.detailText ? r.detailText[L] : detailLabel(r, L), r.ip || ''])];
  return [HEAD.lead_requests[L], ...list.map(r => [r.id, STATUS[L][r.status] || r.status || '', r.businessName || '', r.segment || '',
    r.province || '', r.district || '', r.address || '', r.phone || '', r.email || '', r.requestedBy || '', when(r.requestedAt),
    r.reviewedBy || '', when(r.reviewedAt), [r.rejectReason, r.rejectNote].filter(Boolean).join(' · '), r.note || '',
    r.ownerName || '', r.accountNo || ''])];
}

export function sourceFilters(query) {
  const out = {};
  for (const [k, v] of query) if (!['source', 'format', 'filename', 'lang', 'page', 'limit'].includes(k) && v) out[k] = String(v).slice(0, 200);
  return out;
}
