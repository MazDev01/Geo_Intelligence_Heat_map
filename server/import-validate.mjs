import {segmentList} from './master-data.mjs';

const bad = message => Object.assign(new Error(message), {status: 400});

export const FIELDS = [
  {key: 'businessName', label: 'ชื่อธุรกิจ', max: 200, required: true},
  {key: 'latitude', label: 'ละติจูด', required: true},
  {key: 'longitude', label: 'ลองจิจูด', required: true},
  {key: 'segment', label: 'หมวดธุรกิจ', max: 60, required: true, canDefault: true},
  {key: 'type', label: 'ประเภท (ลูกค้า/Lead)', required: true, canDefault: true},
  {key: 'accountNo', label: 'รหัสลูกค้า', max: 40},
  {key: 'province', label: 'จังหวัด'},
  {key: 'district', label: 'อำเภอ/เขต', max: 80},
  {key: 'address', label: 'ที่อยู่', max: 500},
  {key: 'category', label: 'หมวดย่อย', max: 60},
  {key: 'phone', label: 'เบอร์โทร', max: 60},
  {key: 'email', label: 'อีเมล', max: 200},
  {key: 'website', label: 'เว็บไซต์', max: 300},
  {key: 'facebook', label: 'เฟซบุ๊ก', max: 300},
  {key: 'dateJoin', label: 'วันที่เริ่มเป็นลูกค้า'},
];
const FIELD = Object.fromEntries(FIELDS.map(f => [f.key, f]));
const TEXT_FIELDS = ['accountNo', 'district', 'address', 'category', 'phone', 'website', 'facebook'];

const TYPE_WORDS = {
  existing: 'Existing', customer: 'Existing', 'ลูกค้า': 'Existing', 'ลูกค้าเดิม': 'Existing', 'ลูกค้าปัจจุบัน': 'Existing',
  prospect: 'Prospect', lead: 'Prospect', 'ลีด': 'Prospect', 'ผู้มุ่งหวัง': 'Prospect', 'ลูกค้าเป้าหมาย': 'Prospect',
};
const PROVINCE_ALIASES = {
  bangkok: 'Bangkok Metropolis', 'กรุงเทพ': 'Bangkok Metropolis', 'กรุงเทพฯ': 'Bangkok Metropolis', 'กทม': 'Bangkok Metropolis',
  'กรุงเทพมหานครฯ': 'Bangkok Metropolis', chonburi: 'Pattaya', 'พัทยา': 'Pattaya',
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const NO_ACCOUNT_RE = /^(?:[-–—.]+|0+|x|n\/?a|null|none|ไม่มี|ไม่ระบุ)$/i;
const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)$/;
export const PROVINCE_SNAP_DEGREES = 0.045;
const PREVIEW_ROWS = 50;
const CHUNK = 5000;

const squash = s => String(s).toLowerCase().replace(/^(จังหวัด|จ\.)/, '').replace(/[\s.]+/g, '');

export function readMapping(headers, body) {
  const fields = body && body.mapping;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw bad('ต้องส่งผังการจับคู่คอลัมน์');
  const rawDefaults = body.defaults === undefined || body.defaults === null ? {} : body.defaults;
  if (typeof rawDefaults !== 'object' || Array.isArray(rawDefaults)) throw bad('ค่าเริ่มต้นไม่ถูกต้อง');

  const index = new Map(headers.map((h, i) => [h, i]));
  const cols = {};
  const used = new Map();
  for (const [key, header] of Object.entries(fields)) {
    if (header === null || header === undefined || header === '') continue;
    if (!Object.hasOwn(FIELD, key)) throw bad('ไม่รู้จักช่องนี้: ' + String(key).slice(0, 40));
    if (typeof header !== 'string' || !index.has(header)) throw bad('ไฟล์นี้ไม่มีคอลัมน์ชื่อ: ' + String(header).slice(0, 80));
    if (used.has(header)) throw bad(`คอลัมน์ "${header.slice(0, 80)}" ถูกจับคู่กับสองช่อง (${FIELD[used.get(header)].label} และ ${FIELD[key].label})`);
    used.set(header, key);
    cols[key] = index.get(header);
  }

  const defaults = {};
  for (const [key, value] of Object.entries(rawDefaults)) {
    if (value === null || value === undefined || value === '') continue;
    if (!Object.hasOwn(FIELD, key) || !FIELD[key].canDefault) throw bad('ตั้งค่าเริ่มต้นให้ช่องนี้ไม่ได้: ' + String(key).slice(0, 40));
    if (typeof value !== 'string') throw bad('ค่าเริ่มต้นต้องเป็นข้อความ');
    defaults[key] = value.trim();
  }
  if (defaults.type !== undefined) {
    const type = TYPE_WORDS[defaults.type.toLowerCase()];
    if (!type) throw bad('ประเภทเริ่มต้นต้องเป็นลูกค้าหรือ Lead');
    defaults.type = type;
  }
  if (defaults.segment !== undefined && defaults.segment.length > FIELD.segment.max) throw bad('หมวดธุรกิจเริ่มต้นยาวเกินไป');

  const missing = FIELDS.filter(f => f.required && cols[f.key] === undefined && !defaults[f.key]);
  if (missing.length) throw bad('ยังไม่ได้จับคู่ช่องที่จำเป็น: ' + missing.map(f => f.label).join(', '));

  const mapping = {};
  for (const key of Object.keys(cols)) mapping[key] = headers[cols[key]];
  return {cols, defaults, stored: {fields: mapping, defaults}};
}

function parseDate(text) {
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/.exec(text);
  let y, mo, d;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else {
    m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(text);
    if (!m) return null;
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  if (y > 2400) y -= 543;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (y < 1900 || y > 2100 || date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function makeRowChecker({cols, defaults}, provinces, segments) {
  const provinceByName = new Map();
  for (const p of provinces)
    for (const name of [p.key, p.name_th, p.name_en]) if (name) provinceByName.set(squash(name), p.key);
  for (const [alias, key] of Object.entries(PROVINCE_ALIASES)) provinceByName.set(squash(alias), key);
  const segmentByName = new Map();
  const closedSegments = new Set();
  for (const s of segments) {
    const code = typeof s === 'string' ? s : s.code;
    if (typeof s !== 'string' && s.is_active === false) closedSegments.add(code);
    for (const name of typeof s === 'string' ? [s] : [s.label_en, s.label_th, s.code]) if (name) segmentByName.set(name.trim().toLowerCase(), code);
  }
  const cell = (cells, key) => (cols[key] === undefined ? '' : (cells[cols[key]] || ''));

  return cells => {
    const vals = {};
    const issues = [];
    const error = (type, field, detail) => issues.push({type, field, severity: 'error', ...(detail ? {detail} : {})});
    const tooLong = (key, value) => {
      if (value.length <= FIELD[key].max) return false;
      error('too_long', key, 'ยาวเกิน ' + FIELD[key].max + ' ตัวอักษร');
      return true;
    };

    vals.businessName = cell(cells, 'businessName');
    if (!vals.businessName) error('missing_required', 'businessName');
    else tooLong('businessName', vals.businessName);

    const typeText = cell(cells, 'type');
    if (typeText) {
      vals.type = TYPE_WORDS[typeText.toLowerCase()] || typeText;
      if (!TYPE_WORDS[typeText.toLowerCase()]) error('unknown_value', 'type', 'ต้องเป็นลูกค้าหรือ Lead');
    } else if (defaults.type) vals.type = defaults.type;
    else { vals.type = ''; error('missing_required', 'type'); }

    const segmentText = cell(cells, 'segment') || defaults.segment || '';
    vals.segment = segmentByName.get(segmentText.trim().toLowerCase()) || segmentText;
    if (!segmentText) error('missing_required', 'segment');
    else if (!tooLong('segment', segmentText) && closedSegments.has(vals.segment)) error('unknown_value', 'segment', 'หมวดนี้ถูกปิดใช้งานแล้ว');

    for (const key of TEXT_FIELDS) {
      const value = cell(cells, key);
      vals[key] = value || null;
      if (value) tooLong(key, value);
    }
    if (vals.accountNo && NO_ACCOUNT_RE.test(vals.accountNo)) vals.accountNo = null;
    if (vals.type === 'Existing' && !vals.accountNo) error('missing_required', 'accountNo', 'ลูกค้าต้องมีรหัสลูกค้า');

    const email = cell(cells, 'email');
    vals.email = email || null;
    if (email && !tooLong('email', email) && !EMAIL_RE.test(email)) error('invalid_value', 'email', 'รูปแบบอีเมลไม่ถูกต้อง');

    const dateText = cell(cells, 'dateJoin');
    vals.dateJoin = null;
    if (dateText) {
      const date = parseDate(dateText);
      if (date) vals.dateJoin = date;
      else { vals.dateJoin = dateText; error('invalid_value', 'dateJoin', 'อ่านวันที่ไม่ได้ ใช้รูปแบบ ปปปป-ดด-วว หรือ วว/ดด/ปปปป'); }
    }

    const provinceText = cell(cells, 'province');
    let needProvince = false;
    vals.province = null;
    if (provinceText) {
      const key = provinceByName.get(squash(provinceText));
      if (key) vals.province = key;
      else { vals.province = provinceText; error('unknown_value', 'province', 'ไม่รู้จักจังหวัดนี้'); }
    } else needProvince = true;

    const latText = cell(cells, 'latitude'), lngText = cell(cells, 'longitude');
    let coordProblem = false, lat = null, lng = null;
    vals.latitude = latText || null;
    vals.longitude = lngText || null;
    if (!latText) error('missing_required', 'latitude');
    if (!lngText) error('missing_required', 'longitude');
    if (latText && lngText) {
      const a = NUMBER_RE.test(latText) ? Number(latText) : NaN;
      const b = NUMBER_RE.test(lngText) ? Number(lngText) : NaN;
      if (Number.isNaN(a) || Number.isNaN(b)) {
        coordProblem = true;
        if (Number.isNaN(a)) error('invalid_coordinate', 'latitude', 'ค่าที่พบไม่ใช่ตัวเลข');
        if (Number.isNaN(b)) error('invalid_coordinate', 'longitude', 'ค่าที่พบไม่ใช่ตัวเลข');
      } else {
        vals.latitude = a;
        vals.longitude = b;
        const inside = a >= 5.5 && a <= 20.6 && b >= 97 && b <= 106;
        if (inside) {
          lat = Math.round(a * 1e6) / 1e6;
          lng = Math.round(b * 1e6) / 1e6;
          vals.latitude = lat;
          vals.longitude = lng;
        } else {
          coordProblem = true;
          if (a >= 97 && a <= 106 && b >= 5.5 && b <= 20.6) error('swapped_coordinate', 'location', 'ค่าละติจูดและลองจิจูดอาจสลับกัน');
          else error('invalid_coordinate', 'location', 'พิกัดอยู่นอกขอบเขตประเทศไทย');
        }
      }
    }

    const kind = coordProblem ? 'badcoord' : issues.length ? 'incomplete' : 'ok';
    return {kind, vals, issues, lat, lng, needProvince: needProvince && lat !== null};
  };
}

export async function dupSettings(tx) {
  const r = await tx.query("select key, value from settings where key in ('import.dup_similarity', 'import.dup_distance_m')");
  const got = Object.fromEntries(r.rows.map(x => [x.key, Number(x.value)]));
  const similarity = got['import.dup_similarity'], distance = got['import.dup_distance_m'];
  return {
    similarity: similarity > 0 && similarity <= 1 ? similarity : 0.4,
    distance: distance > 0 && distance <= 5000 ? distance : 200,
  };
}

export async function classifyFile(tx, fileId, plan) {
  const provinces = (await tx.query('select key, name_th, name_en from provinces')).rows;
  const segmentRows = await segmentList(tx);
  const segments = segmentRows.map(s => s.code);
  const check = makeRowChecker(plan, provinces, segmentRows);
  const dup = await dupSettings(tx);

  await tx.query(`create temp table import_check (
    row_no integer primary key, kind text not null, vals jsonb not null, issues jsonb not null,
    lat numeric(9,6), lng numeric(9,6), geom geometry(Point,4326), name_key text not null default '',
    account_no text, need_province boolean not null default false,
    match_place_id text, match_row_no integer, similarity numeric(4,3)) on commit drop`);

  const staged = (await tx.query('select row_no, raw from import_staging where file_id = $1 order by row_no', [fileId])).rows;
  for (let i = 0; i < staged.length; i += CHUNK) {
    const part = staged.slice(i, i + CHUNK).map(r => ({no: r.row_no, ...check(r.raw)}));
    await tx.query(
      `insert into import_check (row_no, kind, vals, issues, lat, lng, geom, name_key, account_no, need_province)
       select t.no, t.kind, t.vals::jsonb, t.issues::jsonb, t.lat, t.lng,
         case when t.lat is null then null else ST_SetSRID(ST_MakePoint(t.lng::float8, t.lat::float8), 4326) end,
         place_name_key(t.vals::jsonb ->> 'businessName'), t.vals::jsonb ->> 'accountNo', t.need
       from unnest($1::int[], $2::text[], $3::text[], $4::text[], $5::numeric[], $6::numeric[], $7::boolean[])
         as t(no, kind, vals, issues, lat, lng, need)`,
      [part.map(r => r.no), part.map(r => r.kind), part.map(r => JSON.stringify(r.vals)), part.map(r => JSON.stringify(r.issues)),
        part.map(r => r.lat), part.map(r => r.lng), part.map(r => r.needProvince)]);
  }
  await tx.query('create index on import_check using gist (geom)');
  await tx.query('create index on import_check (account_no) where account_no is not null');
  await tx.query('analyze import_check');

  await tx.query(`update import_check c set vals = jsonb_set(c.vals, '{province}', to_jsonb(v.key)), need_province = false
    from provinces v where c.need_province and ST_Contains(v.boundary, c.geom)`);
  await tx.query(`update import_check c set vals = jsonb_set(c.vals, '{province}', to_jsonb(n.key)), need_province = false
    from (select c2.row_no, (select v.key from provinces v where ST_DWithin(v.boundary, c2.geom, $1)
            order by ST_Distance(v.boundary, c2.geom) limit 1) as key
          from import_check c2 where c2.need_province) n
    where n.row_no = c.row_no and n.key is not null`, [PROVINCE_SNAP_DEGREES]);
  await tx.query(`update import_check set
      issues = issues || '[{"type":"missing_required","field":"province","severity":"error","detail":"หาจังหวัดจากพิกัดไม่ได้"}]'::jsonb,
      kind = case when kind = 'ok' then 'incomplete' else kind end
    where need_province`);

  const degrees = dup.distance / 100000;
  const flag = `kind = 'dup', similarity = m.sim, issues = c.issues || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
    'type', 'duplicate', 'severity', 'warning', 'reason', m.reason, 'matched_id', m.place_id, 'matched_row', m.match_row, 'similarity', m.sim)))`;

  await tx.query(`update import_check c set match_place_id = m.place_id, ${flag}
    from (select distinct on (c1.row_no) c1.row_no, p.id as place_id, null::int as match_row, 'account' as reason,
            round(similarity(place_name_key(p.business_name), c1.name_key)::numeric, 3) as sim
          from import_check c1 join places p on p.account_no = c1.account_no and p.deleted_at is null
          where c1.kind = 'ok'
          order by c1.row_no, similarity(place_name_key(p.business_name), c1.name_key) desc, p.id) m
    where m.row_no = c.row_no`);

  await tx.query(`update import_check c set match_place_id = m.place_id, ${flag}
    from (select distinct on (c1.row_no) c1.row_no, p.id as place_id, null::int as match_row, 'name' as reason,
            round(similarity(place_name_key(p.business_name), c1.name_key)::numeric, 3) as sim
          from import_check c1 join places p on p.deleted_at is null
            and ST_DWithin(p.geom, c1.geom, $1) and ST_DWithin(p.geom::geography, c1.geom::geography, $2)
            and similarity(place_name_key(p.business_name), c1.name_key) >= $3
          where c1.kind = 'ok' and c1.name_key <> ''
          order by c1.row_no, similarity(place_name_key(p.business_name), c1.name_key) desc, p.id) m
    where m.row_no = c.row_no`, [degrees, dup.distance, dup.similarity]);

  await tx.query(`update import_check c set match_row_no = m.match_row, ${flag}
    from (select distinct on (c2.row_no) c2.row_no, null::text as place_id, c1.row_no as match_row, 'account' as reason,
            round(similarity(c1.name_key, c2.name_key)::numeric, 3) as sim
          from import_check c2 join import_check c1 on c1.account_no = c2.account_no and c1.row_no < c2.row_no and c1.kind = 'ok'
          where c2.kind = 'ok'
          order by c2.row_no, c1.row_no) m
    where m.row_no = c.row_no`);

  await tx.query(`update import_check c set match_row_no = m.match_row, ${flag}
    from (select distinct on (c2.row_no) c2.row_no, null::text as place_id, c1.row_no as match_row, 'name' as reason,
            round(similarity(c1.name_key, c2.name_key)::numeric, 3) as sim
          from import_check c2 join import_check c1 on c1.row_no < c2.row_no and c1.kind = 'ok' and c1.name_key <> ''
            and ST_DWithin(c1.geom, c2.geom, $1) and ST_DWithin(c1.geom::geography, c2.geom::geography, $2)
            and similarity(c1.name_key, c2.name_key) >= $3
          where c2.kind = 'ok' and c2.name_key <> ''
          order by c2.row_no, c1.row_no) m
    where m.row_no = c.row_no`, [degrees, dup.distance, dup.similarity]);

  return {segments, dup};
}

const PREVIEW_SQL = `
select c.row_no, c.kind, c.vals, c.issues, c.similarity, c.match_row_no,
  case when p.id is null then null else json_build_object(
    'id', p.id, 'businessName', p.business_name, 'type', p.type, 'accountNo', p.account_no, 'segment', p.segment,
    'province', p.province, 'district', p.district, 'address', p.address, 'phone', p.phone, 'email', p.email,
    'latitude', p.latitude::float8, 'longitude', p.longitude::float8) end as match
from (select *, row_number() over (partition by kind order by row_no) as n from import_check) c
left join places p on p.id = c.match_place_id
where c.n <= $1
order by c.row_no`;

export async function previewFile(tx, known) {
  const counts = {total: 0, ok: 0, incomplete: 0, badcoord: 0, dup: 0};
  for (const r of (await tx.query('select kind, count(*)::int as n from import_check group by kind')).rows) {
    counts[r.kind] = r.n;
    counts.total += r.n;
  }
  const rows = (await tx.query(PREVIEW_SQL, [PREVIEW_ROWS])).rows.map(r => ({
    rowNo: r.row_no, kind: r.kind, values: r.vals, issues: r.issues,
    ...(r.kind === 'dup' ? {similarity: r.similarity === null ? null : Number(r.similarity), match: r.match, matchRow: r.match_row_no} : {}),
  }));
  const knownSegments = new Set(known.segments);
  const newSegments = (await tx.query(
    `select vals ->> 'segment' as segment, count(*)::int as rows from import_check
     where coalesce(vals ->> 'segment', '') <> '' group by 1 order by 2 desc, 1`)).rows
    .filter(r => !knownSegments.has(r.segment)).slice(0, 30);
  return {counts, rows, previewLimit: PREVIEW_ROWS, newSegments, rule: {similarity: known.dup.similarity, distanceM: known.dup.distance}};
}

export async function applyFile(tx, fileId) {
  await tx.query('alter table import_check add column place_id text');
  await tx.query(`update import_check set place_id =
      (case vals ->> 'type' when 'Existing' then 'CUSU' else 'PROU' end) || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
    where kind = 'ok'`);
  const placed = await tx.query(
    `insert into places (id, type, account_no, business_name, category, segment, province, district, address,
       latitude, longitude, phone, email, website, facebook, date_join, visit_status, source, import_file_id)
     select place_id, vals ->> 'type', vals ->> 'accountNo', vals ->> 'businessName', vals ->> 'category', vals ->> 'segment',
       vals ->> 'province', vals ->> 'district', vals ->> 'address', lat, lng, vals ->> 'phone', vals ->> 'email',
       vals ->> 'website', vals ->> 'facebook', (vals ->> 'dateJoin')::date,
       case when vals ->> 'type' = 'Prospect' then 'ยังไม่เข้าพบ' end, 'import_file', $1
     from import_check where kind = 'ok' order by row_no`, [fileId]);
  const queued = await tx.query(
    `insert into import_rows (file_id, row_no, kind, raw, issues, match_place_id, similarity)
     select $1, c.row_no, c.kind, c.vals, c.issues, coalesce(c.match_place_id, m.place_id), c.similarity
     from import_check c left join import_check m on m.row_no = c.match_row_no
     where c.kind <> 'ok' order by c.row_no`, [fileId]);
  const counts = {total: 0, ok: 0, incomplete: 0, badcoord: 0, dup: 0};
  for (const r of (await tx.query('select kind, count(*)::int as n from import_check group by kind')).rows) {
    counts[r.kind] = r.n;
    counts.total += r.n;
  }
  if (placed.rowCount !== counts.ok || queued.rowCount !== counts.total - counts.ok) throw new Error('import row counts do not add up');
  return counts;
}
