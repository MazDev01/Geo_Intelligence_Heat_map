import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';

const require = createRequire(import.meta.url);
let xlsxLib;
const xlsx = () => xlsxLib || (xlsxLib = require('xlsx'));

export const MAX_FILE_BYTES = 26214400;
export const MAX_ROWS = 50000;
export const MAX_COLS = 60;
export const MAX_UNZIPPED_BYTES = 200 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 2000;

const bad = message => Object.assign(new Error(message), {status: 400});
const tooManyRows = () => bad('ไฟล์มีข้อมูลเกิน ' + MAX_ROWS.toLocaleString('en-US') + ' แถว กรุณาแบ่งไฟล์');
const tooManyCols = () => bad('ไฟล์มีคอลัมน์เกิน ' + MAX_COLS + ' คอลัมน์');
const SHEET_ROWS = MAX_ROWS + 2;
const sheetTooLong = () => bad('ชีตนี้ยาวเกิน ' + MAX_ROWS.toLocaleString('en-US') + ' แถว (นับรวมแถวว่าง) กรุณาแบ่งไฟล์ หรือลบแถวว่างท้ายชีตออก');

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const startsWith = (buf, magic) => buf.length >= magic.length && buf.subarray(0, magic.length).equals(magic);

export function cleanFilename(name) {
  const base = String(name || '').replace(/[\u0000-\u001f\u007f]/g, '').split(/[\\/]/).pop().trim();
  return base.slice(0, 200);
}

export function fileKind(filename) {
  const m = /\.([A-Za-z0-9]+)$/.exec(filename);
  const ext = m ? m[1].toLowerCase() : '';
  return ['csv', 'xlsx', 'xls'].includes(ext) ? ext : null;
}

export function headerSignature(headers) {
  const norm = headers.map(h => String(h).trim().toLowerCase()).sort();
  return createHash('sha256').update(norm.join('\u001f')).digest('hex');
}

function checkZip(buf) {
  const notExcel = () => bad('ไฟล์นี้ไม่ใช่ไฟล์ .xlsx ที่ถูกต้อง');
  let eocd = -1;
  for (let i = buf.length - 22, stop = Math.max(0, buf.length - 65557); i >= stop; i--)
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw notExcel();
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  let p = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || p === 0xffffffff) throw notExcel();
  if (count > MAX_ZIP_ENTRIES) throw notExcel();

  let budget = MAX_UNZIPPED_BYTES;
  let hasContentTypes = false;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw notExcel();
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (flags & 1) throw bad('ไฟล์นี้ตั้งรหัสผ่านไว้ กรุณาเอารหัสผ่านออกก่อน');
    if (/vbaProject/i.test(name)) throw bad('ไม่รับไฟล์ที่มีมาโคร กรุณาบันทึกเป็น .xlsx แบบไม่มีมาโคร');
    if (name === '[Content_Types].xml') hasContentTypes = true;
    if (csize === 0xffffffff || local === 0xffffffff) throw notExcel();
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw notExcel();
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (start + csize > buf.length) throw notExcel();

    if (method === 0) budget -= csize;
    else if (method === 8) {
      if (csize) {
        let out;
        try { out = inflateRawSync(buf.subarray(start, start + csize), {maxOutputLength: Math.max(budget, 1)}); }
        catch (e) {
          if (e && e.code === 'ERR_BUFFER_TOO_LARGE') throw bad('ไฟล์นี้ใหญ่เกินไปเมื่อคลายออก กรุณาแบ่งไฟล์');
          throw notExcel();
        }
        budget -= out.length;
      }
    } else throw notExcel();
    if (budget < 0) throw bad('ไฟล์นี้ใหญ่เกินไปเมื่อคลายออก กรุณาแบ่งไฟล์');
  }
  if (!hasContentTypes) throw notExcel();
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

function dateText(v, date1904) {
  const d = xlsx().SSF.parse_date_code(v, {date1904});
  if (!d) return String(v);
  const time = (d.H || d.M || d.S) ? `${pad(d.H)}:${pad(d.M)}:${pad(d.S)}` : '';
  if (v >= 0 && v < 1) return time || '00:00:00';
  const date = `${pad(d.y, 4)}-${pad(d.m)}-${pad(d.d)}`;
  return time ? date + ' ' + time : date;
}

const dateFormats = new Map();
function isDateFormat(z) {
  let known = dateFormats.get(z);
  if (known === undefined) {
    known = !!xlsx().SSF.is_date(z);
    if (dateFormats.size < 1000) dateFormats.set(z, known);
  }
  return known;
}

function cellText(cell, date1904) {
  if (!cell || cell.v === undefined || cell.v === null) return '';
  if (cell.t === 's') return String(cell.v);
  if (cell.t === 'n') {
    if (typeof cell.z === 'string' && isDateFormat(cell.z)) return dateText(cell.v, date1904);
    if (typeof cell.z === 'string' && /^0+$/.test(cell.z) && typeof cell.w === 'string') return cell.w;
    return String(cell.v);
  }
  if (cell.t === 'b') return cell.v ? 'TRUE' : 'FALSE';
  if (cell.t === 'd' && cell.v instanceof Date) return cell.v.toISOString().slice(0, 10);
  return '';
}

function readWorkbook(buf) {
  let wb;
  try {
    wb = xlsx().read(buf, {type: 'buffer', dense: true, cellFormula: false, cellHTML: false, cellNF: true,
      cellDates: false, cellStyles: false, bookVBA: false, sheetRows: SHEET_ROWS});
  } catch {
    throw bad('อ่านไฟล์ Excel นี้ไม่ได้ ไฟล์อาจเสียหรือตั้งรหัสผ่านไว้');
  }
  const date1904 = !!(wb.Workbook && wb.Workbook.WBProps && wb.Workbook.WBProps.date1904);
  const names = wb.SheetNames || [];
  for (const name of names) {
    const data = wb.Sheets[name] && wb.Sheets[name]['!data'];
    if (!Array.isArray(data)) continue;
    const records = [];
    for (let r = 0; r < data.length; r++) {
      const row = data[r];
      if (!row) continue;
      if (row.length > MAX_COLS) {
        let last = row.length - 1;
        while (last >= MAX_COLS && cellText(row[last], date1904).trim() === '') last--;
        if (last >= MAX_COLS) throw tooManyCols();
      }
      const cells = [];
      for (let c = 0, n = Math.min(row.length, MAX_COLS); c < n; c++) cells.push(cellText(row[c], date1904));
      if (cells.some(x => x.trim() !== '')) records.push({no: r + 1, cells});
    }
    if (!records.length) continue;
    const full = wb.Sheets[name]['!fullref'];
    if (full && xlsx().utils.decode_range(full).e.r >= SHEET_ROWS) throw sheetTooLong();
    return {records, sheet: name, sheetCount: names.length};
  }
  throw bad('ไฟล์นี้ไม่มีข้อมูล');
}

function decodeText(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return {text: new TextDecoder('utf-16le').decode(buf.subarray(2)), encoding: 'utf-16le'};
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return {text: new TextDecoder('utf-16be').decode(buf.subarray(2)), encoding: 'utf-16be'};
  const body = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? buf.subarray(3) : buf;
  try { return {text: new TextDecoder('utf-8', {fatal: true}).decode(body), encoding: 'utf-8'}; }
  catch { return {text: new TextDecoder('windows-874').decode(body), encoding: 'windows-874'}; }
}

function guessDelimiter(text) {
  const counts = {',': 0, ';': 0, '\t': 0, '|': 0};
  let quoted = false, lines = 0;
  for (let i = 0; i < text.length && i < 20000 && lines < 5; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === '\n') lines++;
    else if (!quoted && Object.hasOwn(counts, ch)) counts[ch]++;
  }
  const [best, hits] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return hits ? best : ',';
}

function parseCsv(text, delim) {
  const records = [];
  const n = text.length;
  let row = [], parts = [], quoted = false, wasQuoted = false, no = 1, i = 0, from = 0;
  const endCell = to => {
    if (to > from) parts.push(text.slice(from, to));
    row.push(parts.length === 1 ? parts[0] : parts.join(''));
    parts = [];
    wasQuoted = false;
    if (row.length > MAX_COLS + 1) throw tooManyCols();
  };
  const endRow = to => {
    endCell(to);
    if (row.some(c => c.trim() !== '')) {
      records.push({no, cells: row});
      if (records.length > MAX_ROWS + 1) throw tooManyRows();
    }
    row = [];
    no++;
  };
  while (i < n) {
    const ch = text.charCodeAt(i);
    if (quoted) {
      if (ch === 34) {
        if (i > from) parts.push(text.slice(from, i));
        if (text.charCodeAt(i + 1) === 34) { parts.push('"'); i += 2; from = i; continue; }
        quoted = false; i++; from = i; continue;
      }
      i++; continue;
    }
    if (ch === 34 && i === from && !wasQuoted && parts.length === 0) { quoted = true; wasQuoted = true; i++; from = i; continue; }
    if (text[i] === delim) { endCell(i); i++; from = i; continue; }
    if (ch === 13) { endRow(i); i += text.charCodeAt(i + 1) === 10 ? 2 : 1; from = i; continue; }
    if (ch === 10) { endRow(i); i++; from = i; continue; }
    i++;
  }
  if (quoted) throw bad('ไฟล์ CSV มีเครื่องหมายคำพูดที่เปิดแล้วไม่ปิด (ราวแถวที่ ' + no + ')');
  if (n > from || row.length || parts.length) endRow(n);
  return records;
}

function readCsv(buf) {
  if (startsWith(buf, ZIP_MAGIC) || startsWith(buf, OLE_MAGIC)) throw bad('ไฟล์นี้เป็นไฟล์ Excel แต่นามสกุลเป็น .csv กรุณาบันทึกเป็น CSV ใหม่');
  const {text, encoding} = decodeText(buf);
  if (text.includes('\u0000')) throw bad('ไฟล์นี้ไม่ใช่ไฟล์ CSV');
  const records = parseCsv(text, guessDelimiter(text));
  if (!records.length) throw bad('ไฟล์นี้ไม่มีข้อมูล');
  return {records, encoding};
}

function toTable(records) {
  for (const r of records) {
    for (let c = 0; c < r.cells.length; c++) {
      let v = r.cells[c];
      if (v.includes('\u0000')) v = v.replaceAll('\u0000', '');
      if (!v.isWellFormed()) v = v.toWellFormed();
      r.cells[c] = v.trim();
    }
    while (r.cells.length && r.cells[r.cells.length - 1] === '') r.cells.pop();
  }
  const [head, ...data] = records;
  if (!data.length) throw bad('ไฟล์นี้มีแต่หัวคอลัมน์ ไม่มีแถวข้อมูล');
  if (data.length > MAX_ROWS) throw tooManyRows();
  const width = records.reduce((w, r) => Math.max(w, r.cells.length), 0);
  if (width > MAX_COLS) throw tooManyCols();

  const seen = new Map();
  const headers = [];
  for (let c = 0; c < width; c++) {
    const base = head.cells[c] || 'คอลัมน์ ' + (c + 1);
    const key = base.toLowerCase();
    const times = (seen.get(key) || 0) + 1;
    seen.set(key, times);
    headers.push(times === 1 ? base : `${base} (${times})`);
  }
  const rows = data.map(r => {
    while (r.cells.length < width) r.cells.push('');
    return {no: r.no, cells: r.cells};
  });
  return {headers, rows, headerRow: head.no};
}

export function parseUpload(buf, filename) {
  const kind = fileKind(filename);
  if (!kind) throw bad('รองรับเฉพาะไฟล์ .xlsx .xls .csv');
  if (!buf.length) throw bad('ไฟล์ว่างเปล่า');
  if (buf.length > MAX_FILE_BYTES) throw Object.assign(new Error('file too large'), {status: 413});

  let read;
  if (kind === 'csv') read = readCsv(buf);
  else if (kind === 'xlsx') {
    if (startsWith(buf, OLE_MAGIC)) throw bad('ไฟล์นี้ตั้งรหัสผ่านไว้ หรือเป็นไฟล์ .xls ที่เปลี่ยนนามสกุล กรุณาบันทึกเป็น .xlsx ใหม่');
    if (!startsWith(buf, ZIP_MAGIC)) throw bad('ไฟล์นี้ไม่ใช่ไฟล์ .xlsx ที่ถูกต้อง');
    checkZip(buf);
    read = readWorkbook(buf);
  } else {
    if (!startsWith(buf, OLE_MAGIC)) throw bad('ไฟล์นี้ไม่ใช่ไฟล์ .xls ที่ถูกต้อง กรุณาเปิดด้วย Excel แล้วบันทึกเป็น .xlsx');
    read = readWorkbook(buf);
  }
  const table = toTable(read.records);
  return {kind, ...table, sheet: read.sheet || null, sheetCount: read.sheetCount || null, encoding: read.encoding || null};
}
