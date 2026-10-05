import {readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const readJSON = rel => JSON.parse(readFileSync(ROOT + rel, 'utf8'));
const rowsOf = x => Array.isArray(x) ? x : (x.users || Object.values(x));

const EXTRA_ACCOUNTS = [
  {id: 9, name: 'กิตติศักดิ์ อารยะกุล', email: 'tc.kit@geointel.io', role: 'Trade Coordinator'},
];

const q = v => (v === null || v === undefined || v === '') ? 'null' : "'" + String(v).replace(/'/g, "''") + "'";
const n = v => (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) ? 'null' : String(Number(v));
const b = v => v ? 'true' : 'false';
const j = v => q(JSON.stringify(v ?? null)) + '::jsonb';
const ts = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) ? q(v) + '::timestamptz' : 'null';
const geo = g => 'ST_SetSRID(ST_GeomFromGeoJSON(' + q(JSON.stringify(g)) + '),4326)';

const out = [];
const emit = s => out.push(s);
const insert = (table, cols, rows, size = 500) => {
  for (let i = 0; i < rows.length; i += size)
    emit('insert into ' + table + ' (' + cols.join(',') + ') values\n' +
      rows.slice(i, i + size).map(r => '(' + r.join(',') + ')').join(',\n') + ';');
};

const libText = readFileSync(ROOT + 'src/lib.js', 'utf8');
const thMatch = /export const PROVINCE_TH\s*=\s*(\{[\s\S]*?\});/.exec(libText);
if (!thMatch) throw new Error('PROVINCE_TH not found in src/lib.js');
const PROVINCE_TH = new Function('return ' + thMatch[1])();

const customers = readJSON('data/customers.json');
const prospects = readJSON('data/prospects.json');
const areas = rowsOf(readJSON('data/areas.json'));
const districts = rowsOf(readJSON('data/districts.json'));
const boundaries = readJSON('data/thailand-provinces.geojson').features;
const zones = readJSON('data/zones.geojson').features;
const accounts = existsSync(ROOT + 'data/auth/users.json') ? rowsOf(readJSON('data/auth/users.json')) : [];

const users = [...accounts];
for (const x of EXTRA_ACCOUNTS)
  if (!users.some(u => u.email.toLowerCase() === x.email.toLowerCase())) users.push(x);
const idByName = new Map(users.map(u => [u.name, u.id]));
const ownerNames = [...new Set([...customers, ...prospects].map(r => r.tc_owner).filter(Boolean))];
const unmatched = ownerNames.filter(x => !idByName.has(x));
if (unmatched.length) throw new Error('tc_owner without an account: ' + unmatched.join(', '));

const centerOf = new Map(areas.map(a => [a.province, a.center]));
const withDistricts = new Set(districts.map(d => d.province));
const boundaryNames = new Set(boundaries.map(f => f.properties.name));
const missingBoundary = areas.map(a => a.province).filter(p => !boundaryNames.has(p));
if (missingBoundary.length) throw new Error('province without a boundary: ' + missingBoundary.join(', '));

emit('begin;');
emit(`do $$ begin
  if exists (select 1 from users) or exists (select 1 from provinces) or exists (select 1 from places) then
    raise exception 'database is not empty, seed refused';
  end if;
end $$;`);

insert('users',
  ['id', 'name', 'email', 'role', 'province', 'scope', 'pw_hash', 'pw_salt', 'pw_iter', 'must_change', 'fails', 'lock_until', 'status', 'last_login_at'],
  users.map(u => [
    n(u.id), q(u.name), q(u.email), q(u.role), q(u.province),
    q(u.role === 'Trade Coordinator' ? 'own_area' : 'national'),
    q(u.pw && u.pw.hash), q(u.pw && u.pw.salt), n(u.pw && u.pw.iter),
    b(u.mustChange !== false), n(u.fails || 0),
    u.lockUntil ? 'to_timestamp(' + n(u.lockUntil) + '/1000.0)' : 'null',
    q(u.status || 'Active'), ts(u.last),
  ]));
emit("select setval(pg_get_serial_sequence('users','id'), (select max(id) from users));");

insert('provinces', ['key', 'name_th', 'name_en', 'center', 'boundary', 'has_district_data'],
  boundaries.map(f => {
    const key = f.properties.name;
    const c = centerOf.get(key);
    return [
      q(key), q(PROVINCE_TH[key] || key), q(key),
      c ? 'ST_SetSRID(ST_MakePoint(' + n(c[0]) + ',' + n(c[1]) + '),4326)' : 'null',
      'ST_Multi(ST_CollectionExtract(ST_MakeValid(' + geo(f.geometry) + '),3))',
      b(withDistricts.has(key)),
    ];
  }), 10);
emit('update provinces set center = ST_PointOnSurface(boundary) where center is null;');

const placeCols = ['id', 'type', 'account_no', 'business_name', 'category', 'segment', 'country', 'province', 'district',
  'address', 'latitude', 'longitude', 'phone', 'email', 'website', 'facebook', 'date_join', 'tc_owner_id',
  'visit_status', 'source', 'created_at'];
const placeRow = (r, type) => [
  q(r.id), q(type), q(r.accountNo), q(r.businessName), q(r.category), q(r.segment), q(r.country || 'Thailand'),
  q(r.province), q(r.district), q(r.address), n(r.latitude), n(r.longitude), q(r.phone), q(r.email),
  q(r.website), q(r.facebook), /^\d{4}-\d{2}-\d{2}$/.test(r.dateJoin || '') ? q(r.dateJoin) + '::date' : 'null',
  r.tc_owner ? n(idByName.get(r.tc_owner)) : 'null',
  q(r.visit_status), q('seed'),
  ts(r.created_at) === 'null' ? 'now()' : ts(r.created_at),
];
insert('places', placeCols, customers.map(r => placeRow(r, 'Existing')));
insert('places', placeCols, prospects.map(r => placeRow(r, 'Prospect')));

const day = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? q(v) + '::date' : 'null';
const visits = [...customers, ...prospects].flatMap(r =>
  (Array.isArray(r.visitRounds) ? r.visitRounds : []).map(v => [
    q(r.id), n(v.round), q(v.status), day(v.apptDate), day(v.doneDate),
    v.tc && idByName.has(v.tc) ? n(idByName.get(v.tc)) : 'null',
    q(v.interest), q(v.outcome), q(v.note), q(v.cancelReason || v.reason),
  ]));
if (visits.length)
  insert('place_visits', ['place_id', 'round', 'status', 'appt_date', 'done_date', 'tc_id', 'interest', 'outcome', 'note', 'cancel_reason'], visits);

const statCols = ['customer_count', 'prospect_count', 'coverage', 'gap_score', 'gap_level', 'gap_count', 'gap_depth',
  'gap_breadth', 'top_gap_segment', 'gap_segs', 'top_segment', 'segment_distribution'];
const statRow = s => [
  n(s.customerCount || 0), n(s.prospectCount || 0), n(s.coverage), n(s.gapScore), q(s.gapLevel), n(s.gapCount),
  n(s.gapDepth), n(s.gapBreadth), q(s.topGapSegment), j(s.gapSegs || []), q(s.topSegment), j(s.segmentDistribution || {}),
];
insert('area_stats', ['province', 'density', ...statCols], areas.map(a => [q(a.province), n(a.density), ...statRow(a)]));
insert('district_stats', ['province', 'district', ...statCols], districts.map(d => [q(d.province), q(d.district), ...statRow(d)]));

insert('zones', ['zone_id', 'state', 'name', 'name_en', 'color', 'province', 'districts', 'geom', 'version'],
  zones.map(f => {
    const p = f.properties;
    return [
      q(p.zone_id), q('live'), q(p.zone_name), q(p.zone_name_en), q(p.color), q(p.province),
      'array[' + (p.districts || []).map(q).join(',') + ']::text[]', geo(f.geometry), '1',
    ];
  }), 10);

emit('commit;');
emit(`select 'users' as t, count(*) from users
union all select 'provinces', count(*) from provinces
union all select 'customers', count(*) from customers
union all select 'leads', count(*) from leads
union all select 'place_visits', count(*) from place_visits
union all select 'area_stats', count(*) from area_stats
union all select 'district_stats', count(*) from district_stats
union all select 'zones', count(*) from zones;`);

process.stdout.write(out.join('\n') + '\n');
