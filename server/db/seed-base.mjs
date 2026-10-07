import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {makePool, withTransaction} from './pool.mjs';
import {makeZoneAdapter} from './zone-adapter.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const readJSON = rel => JSON.parse(readFileSync(ROOT + rel, 'utf8'));
const rowsOf = x => Array.isArray(x) ? x : Object.values(x);

function provinceRows() {
  const libText = readFileSync(ROOT + 'src/lib.js', 'utf8');
  const thMatch = /export const PROVINCE_TH\s*=\s*(\{[\s\S]*?\});/.exec(libText);
  if (!thMatch) throw new Error('PROVINCE_TH not found in src/lib.js');
  const PROVINCE_TH = new Function('return ' + thMatch[1])();
  const centerOf = new Map(rowsOf(readJSON('data/areas.json')).map(a => [a.province, a.center]));
  const withDistricts = new Set(rowsOf(readJSON('data/districts.json')).map(d => d.province));
  return readJSON('data/thailand-provinces.geojson').features.map(f => {
    const key = f.properties.name;
    const c = centerOf.get(key);
    return {key, name_th: PROVINCE_TH[key] || key, cx: c ? Number(c[0]) : null, cy: c ? Number(c[1]) : null,
      geometry: f.geometry, has_district_data: withDistricts.has(key)};
  });
}

async function seedProvinces(pool) {
  const rows = provinceRows();
  if (!rows.length) throw new Error('data/thailand-provinces.geojson has no province');
  return withTransaction(pool, async tx => {
    await tx.query('lock table provinces in share row exclusive mode');
    let provinces = 0;
    if (!(await tx.query('select 1 from provinces limit 1')).rowCount) {
      await tx.query(
        `insert into provinces (key, name_th, name_en, center, boundary, has_district_data)
         select x.key, x.name_th, x.key,
                case when x.cx is null or x.cy is null then null else ST_SetSRID(ST_MakePoint(x.cx, x.cy), 4326) end,
                ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(x.geometry::text), 4326)), 3)),
                x.has_district_data
           from jsonb_to_recordset($1::jsonb)
             as x(key text, name_th text, cx float8, cy float8, geometry jsonb, has_district_data boolean)`,
        [JSON.stringify(rows)]);
      await tx.query('update provinces set center = ST_PointOnSurface(boundary) where center is null');
      provinces = rows.length;
    }
    let areas = 0;
    if (!(await tx.query("select 1 from master_data where type = 'areas' limit 1")).rowCount)
      areas = (await tx.query(
        `insert into master_data (type, code, label_th, label_en, sort_order, is_system)
         select 'areas', key, name_th, name_en, (row_number() over (order by key))::int - 1, true from provinces`)).rowCount;
    return {provinces, areas};
  });
}

async function seedZones(pool) {
  const adapter = makeZoneAdapter(pool);
  if ((await pool.query('select 1 from zones limit 1')).rowCount) return 0;
  const gj = readJSON('data/zones.geojson');
  if (!gj.features.length) return 0;
  await adapter.publish(gj, null, {});
  return gj.features.length;
}

const line = (label, n) => console.log(label.padEnd(18) + (n ? n + ' added' : 'already present, skipped'));

async function run(argv) {
  if (argv.length) throw new Error('usage: node server/db/seed-base.mjs');
  const pool = makePool();
  try {
    const m = await pool.query('select count(*)::int as n from schema_migrations').catch(() => null);
    if (!m || !m.rows[0].n) throw new Error('database is not ready, run first: node server/db/migrate.mjs up');
    const p = await seedProvinces(pool);
    const zones = await seedZones(pool);
    line('provinces', p.provinces);
    line('master data areas', p.areas);
    line('zones', zones);
  } finally {
    await pool.end();
  }
}

run(process.argv.slice(2)).catch(e => {
  console.error('[seed-base] ' + e.message);
  process.exitCode = 1;
});
