import {withTransaction} from './db/pool.mjs';
import {writeAudit} from './audit.mjs';
import {SEG_SVG} from '../src/mock/geoData.js';

const fail = (status, message) => Object.assign(new Error(message), {status});

const KINDS = {
  segments: {create: true, toggle: true, color: true, icon: true, prefix: 'Segment'},
  'reject-reasons': {create: true, toggle: true, prefix: 'reason'},
  areas: {},
};
const USAGE_SQL = {
  segments: 'select segment as code, count(*)::int as n from places where deleted_at is null and segment is not null group by 1',
  areas: 'select province as code, count(*)::int as n from places where deleted_at is null group by 1',
  'reject-reasons': 'select reject_reason as code, count(*)::int as n from lead_requests where reject_reason is not null group by 1',
};
const ICONS = new Set(Object.keys(SEG_SVG));
const CODE_RE = /^[A-Za-z][A-Za-z0-9_]{1,39}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_COLOR = '#8aa0be';

const plainObject = v => v && typeof v === 'object' && !Array.isArray(v);
const out = r => ({code: r.code, label_th: r.label_th, label_en: r.label_en, color_hex: r.color_hex, icon: r.icon,
  sort_order: r.sort_order, is_active: r.is_active, is_system: r.is_system});

export async function readMaster(db) {
  const rows = (await db.query('select * from master_data order by type, sort_order, code')).rows;
  const data = Object.fromEntries(Object.keys(KINDS).map(k => [k, []]));
  const usage = {};
  for (const [type, sql] of Object.entries(USAGE_SQL)) usage[type] = new Map((await db.query(sql)).rows.map(r => [r.code, r.n]));
  for (const r of rows) if (data[r.type]) data[r.type].push({...out(r), usage: usage[r.type].get(r.code) || 0});
  const listed = new Set(data.segments.map(r => r.code));
  let order = data.segments.length;
  for (const [code, n] of [...usage.segments].sort((a, b) => a[0].localeCompare(b[0])))
    if (code.trim() && !listed.has(code)) data.segments.push({code, label_th: code, label_en: code, color_hex: DEFAULT_COLOR, icon: 'Other',
      sort_order: order++, is_active: true, is_system: false, usage: n, unlisted: true});
  return data;
}

export async function segmentList(db) {
  return (await db.query(
    `select code, label_th, label_en, is_active, sort_order from master_data where type = 'segments'
     union all
     select s.segment, s.segment, s.segment, true, 1000000
     from (select distinct segment from places where deleted_at is null and segment is not null and btrim(segment) <> '') s
     where not exists (select 1 from master_data m where m.type = 'segments' and m.code = s.segment)
     order by sort_order, code`)).rows;
}

export async function isActive(db, type, code) {
  return !!(await db.query('select 1 from master_data where type = $1 and code = $2 and is_active', [type, code])).rowCount;
}

function label(body, key, text, required) {
  const v = body[key];
  if (v === undefined || v === null || v === '') { if (required) throw fail(400, 'ต้องกรอก' + text); return null; }
  if (typeof v !== 'string') throw fail(400, text + 'ไม่ถูกต้อง');
  const s = v.trim();
  if (!s) { if (required) throw fail(400, 'ต้องกรอก' + text); return null; }
  if (s.length > 80) throw fail(400, text + 'ยาวเกิน 80 ตัวอักษร');
  return s;
}

function looks(kind, body, f) {
  if (Object.hasOwn(body, 'color_hex')) {
    if (!kind.color) throw fail(400, 'หมวดนี้ไม่มีสี');
    if (typeof body.color_hex !== 'string' || !COLOR_RE.test(body.color_hex)) throw fail(400, 'สีต้องอยู่ในรูป #RRGGBB');
    f.color_hex = body.color_hex.toLowerCase();
  }
  if (Object.hasOwn(body, 'icon')) {
    if (!kind.icon) throw fail(400, 'หมวดนี้ไม่มีไอคอน');
    if (typeof body.icon !== 'string' || !ICONS.has(body.icon)) throw fail(400, 'ไม่รู้จักไอคอนนี้');
    f.icon = body.icon;
  }
}

const usageOf = async (tx, type, code) =>
  (await tx.query(`select coalesce((select n from (${USAGE_SQL[type]}) u where u.code = $1), 0)::int as n`, [code])).rows[0].n;

export async function writeMaster(pool, body, user, ctx) {
  if (!plainObject(body)) throw fail(400, 'อ่านคำขอไม่ได้');
  const kind = Object.hasOwn(KINDS, body.type) ? KINDS[body.type] : null;
  if (!kind) throw fail(400, 'ไม่รู้จักประเภทข้อมูลหลัก');
  const type = body.type;
  const uid = Number.isInteger(user.id) ? user.id : null;

  return withTransaction(pool, async tx => {
    await tx.query('select pg_advisory_xact_lock(hashtext($1))', ['master_data:' + type]);
    const touch = async () => { if (type === 'segments') await tx.query('insert into stats_dirty default values'); };

    if (body.action === 'create') {
      if (!kind.create) throw fail(400, 'ประเภทนี้เพิ่มรายการใหม่ไม่ได้');
      const f = {label_th: label(body, 'label_th', 'ชื่อที่แสดงผล', true), label_en: label(body, 'label_en', 'ชื่อภาษาอังกฤษ', false),
        color_hex: kind.color ? DEFAULT_COLOR : null, icon: kind.icon ? 'Other' : null};
      looks(kind, body, f);
      const codes = new Set((await tx.query('select code from master_data where type = $1', [type])).rows.map(r => r.code.toLowerCase()));
      let code = typeof body.code === 'string' ? body.code.trim() : '';
      if (code) {
        if (!CODE_RE.test(code)) throw fail(400, 'รหัสอ้างอิงใช้ได้เฉพาะ a–z 0–9 _ ขึ้นต้นด้วยตัวอักษร ยาว 2 ถึง 40 ตัว');
        if (type === 'segments' && code.toLowerCase() === 'other') throw fail(400, 'รหัส Other สงวนไว้ให้ระบบ กรุณาใช้รหัสอื่น');
        if (codes.has(code.toLowerCase())) throw fail(409, 'รหัสอ้างอิงนี้มีอยู่แล้ว');
      } else {
        let i = codes.size + 1;
        while (codes.has((kind.prefix + '_' + i).toLowerCase())) i++;
        code = kind.prefix + '_' + i;
      }
      const row = (await tx.query(
        `insert into master_data (type, code, label_th, label_en, color_hex, icon, sort_order, is_active, updated_by)
         values ($1, $2, $3, $4, $5, $6, (select coalesce(max(sort_order), -1) + 1 from master_data where type = $1), $7, $8) returning *`,
        [type, code, f.label_th, f.label_en, f.color_hex, f.icon, body.is_active !== false, uid])).rows[0];
      await writeAudit(tx, ctx, 'master_create', type + ':' + code, {type, after: out(row)});
      await touch();
      return {ok: true, item: out(row)};
    }

    const code = String(body.code || '');
    const find = async () => (await tx.query('select * from master_data where type = $1 and code = $2 for update', [type, code])).rows[0];
    let cur = await find();
    if (!cur && type === 'segments' && code.trim() && (await usageOf(tx, type, code)) > 0) {
      await tx.query(
        `insert into master_data (type, code, label_th, label_en, color_hex, icon, sort_order, updated_by)
         values ('segments', $1, $1, $1, $2, 'Other', (select coalesce(max(sort_order), -1) + 1 from master_data where type = 'segments'), $3)`,
        [code, DEFAULT_COLOR, uid]);
      cur = await find();
      await writeAudit(tx, ctx, 'master_create', type + ':' + code, {type, after: out(cur)});
      await touch();
    }
    if (!cur) throw fail(404, 'ไม่พบรายการนี้');

    if (body.action === 'move') {
      if (body.dir !== -1 && body.dir !== 1) throw fail(400, 'ทิศทางไม่ถูกต้อง');
      const list = (await tx.query('select code from master_data where type = $1 order by sort_order, code', [type])).rows.map(r => r.code);
      const i = list.indexOf(cur.code), j = i + body.dir;
      if (j < 0 || j >= list.length) return {ok: true, moved: false};
      [list[i], list[j]] = [list[j], list[i]];
      await tx.query(
        `update master_data m set sort_order = x.ord - 1, updated_by = $3, updated_at = now()
         from unnest($2::text[]) with ordinality as x(code, ord) where m.type = $1 and m.code = x.code and m.sort_order <> x.ord - 1`, [type, list, uid]);
      await writeAudit(tx, ctx, 'master_update', type + ':' + cur.code, {type, changed: ['sort_order'], before: {sort_order: i}, after: {sort_order: j}});
      await touch();
      return {ok: true, moved: true};
    }

    if (body.action !== 'update') throw fail(400, 'ไม่รู้จักคำสั่ง');
    const f = {};
    if (Object.hasOwn(body, 'label_th')) f.label_th = label(body, 'label_th', 'ชื่อที่แสดงผล', true);
    if (Object.hasOwn(body, 'label_en')) f.label_en = label(body, 'label_en', 'ชื่อภาษาอังกฤษ', false);
    looks(kind, body, f);
    if (Object.hasOwn(body, 'is_active')) {
      if (typeof body.is_active !== 'boolean') throw fail(400, 'สถานะใช้งานไม่ถูกต้อง');
      if (body.is_active !== cur.is_active) {
        if (!kind.toggle || cur.is_system) throw fail(400, 'รายการนี้ปิดหรือเปิดใช้งานไม่ได้');
        if (!body.is_active) {
          const n = await usageOf(tx, type, cur.code);
          if (n > 0) throw fail(409, 'ยังมีข้อมูล ' + n + ' รายการใช้ค่านี้อยู่ จึงปิดใช้งานไม่ได้');
        }
        f.is_active = body.is_active;
      }
    }
    const changed = Object.keys(f).filter(k => f[k] !== cur[k]);
    if (!changed.length) return {ok: true, item: out(cur)};
    const next = {...cur, ...f};
    const row = (await tx.query(
      `update master_data set label_th = $3, label_en = $4, color_hex = $5, icon = $6, is_active = $7, updated_by = $8, updated_at = now()
       where type = $1 and code = $2 returning *`,
      [type, cur.code, next.label_th, next.label_en, next.color_hex, next.icon, next.is_active, uid])).rows[0];
    await writeAudit(tx, ctx, 'master_update', type + ':' + cur.code, {type, changed,
      before: Object.fromEntries(changed.map(k => [k, cur[k]])), after: Object.fromEntries(changed.map(k => [k, row[k]]))});
    await touch();
    return {ok: true, item: out(row)};
  });
}
