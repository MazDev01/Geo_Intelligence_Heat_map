import {readFile} from 'node:fs/promises';
import {withTransaction} from './db/pool.mjs';
import {readScoring} from './settings.mjs';
import {segmentList} from './master-data.mjs';
import {gapFromCounts} from '../src/mock/geoData.js';

const COUNTRY = {country: 'Thailand', center: [13.0, 101.0]};

const activeSegments = async db => (await segmentList(db)).filter(s => s.is_active).map(s => s.code);
const bucket = segs => ({cust: 0, pros: 0, demand: {}, supply: {}, dist: Object.fromEntries(segs.map(s => [s, 0]))});

function add(b, row) {
  const existing = row.type === 'Existing';
  if (existing) b.cust += row.n; else b.pros += row.n;
  if (!Object.hasOwn(b.dist, row.segment)) return;
  const side = existing ? b.supply : b.demand;
  side[row.segment] = (side[row.segment] || 0) + row.n;
  b.dist[row.segment] += row.n;
}

function summarize(b, ref, scoring, segs) {
  const g = gapFromCounts(b.demand, b.supply, ref, scoring, segs);
  const total = b.cust + b.pros;
  return {
    customerCount: b.cust, prospectCount: b.pros,
    coverage: total ? Math.min(100, Math.round(b.cust / total * 100)) : 0,
    gapScore: g.gapScore, gapLevel: g.gapLevel, gapCount: g.gapCount, gapDepth: g.gapDepth, gapBreadth: g.gapBreadth,
    topGapSegment: g.topGapSegment, gapSegs: g.gapSegs,
    topSegment: Object.entries(b.dist).sort((x, y) => y[1] - x[1])[0][0], segmentDistribution: b.dist,
  };
}

const STAT_COLS = `customer_count, prospect_count, coverage, gap_score, gap_level, gap_count, gap_depth, gap_breadth,
  top_gap_segment, gap_segs, top_segment, segment_distribution`;
const STAT_TYPES = `"customerCount" int, "prospectCount" int, coverage numeric, "gapScore" numeric, "gapLevel" text, "gapCount" int,
  "gapDepth" numeric, "gapBreadth" numeric, "topGapSegment" text, "gapSegs" jsonb, "topSegment" text, "segmentDistribution" jsonb`;
const STAT_PICK = `"customerCount", "prospectCount", coverage, "gapScore", "gapLevel", "gapCount", "gapDepth", "gapBreadth",
  "topGapSegment", "gapSegs", "topSegment", "segmentDistribution"`;

async function recompute(tx) {
  const scoring = await readScoring(tx);
  const segs = await activeSegments(tx);
  const rows = (await tx.query(
    `select province, district, segment, type, count(*)::int as n from places where deleted_at is null group by 1, 2, 3, 4`)).rows;
  const areaOf = new Map((await tx.query(
    `select key, (ST_XMax(b) - ST_XMin(b)) * (ST_YMax(b) - ST_YMin(b)) as area from (select key, Box2D(boundary) as b from provinces) p`)).rows
    .map(r => [r.key, Number(r.area) || 0]));

  const country = bucket(segs), provinces = new Map(), districts = new Map();
  for (const r of rows) {
    add(country, r);
    if (!areaOf.has(r.province)) continue;
    if (!provinces.has(r.province)) provinces.set(r.province, bucket(segs));
    add(provinces.get(r.province), r);
    if (!r.district) continue;
    const k = r.province + '\u0000' + r.district;
    if (!districts.has(k)) districts.set(k, {province: r.province, district: r.district, b: bucket(segs)});
    add(districts.get(k).b, r);
  }

  const areas = [...provinces].map(([province, b]) => ({province,
    density: +(b.cust / (areaOf.get(province) + 0.01)).toFixed(1), ...summarize(b, scoring.ref.province, scoring, segs)}));
  const dists = [...districts.values()].map(d => ({province: d.province, district: d.district, ...summarize(d.b, scoring.ref.district, scoring, segs)}));
  const c = summarize(country, scoring.ref.country, scoring, segs);
  delete c.topSegment; delete c.segmentDistribution;

  await tx.query('delete from area_stats');
  await tx.query('delete from district_stats');
  if (areas.length) await tx.query(
    `insert into area_stats (province, density, ${STAT_COLS}, computed_at)
     select province, density, ${STAT_PICK}, now() from jsonb_to_recordset($1::jsonb) as x(province text, density numeric, ${STAT_TYPES})`,
    [JSON.stringify(areas)]);
  if (dists.length) await tx.query(
    `insert into district_stats (province, district, ${STAT_COLS}, computed_at)
     select province, district, ${STAT_PICK}, now() from jsonb_to_recordset($1::jsonb) as x(province text, district text, ${STAT_TYPES})`,
    [JSON.stringify(dists)]);
  await tx.query(
    `insert into stats_state (id, country, computed_at) values (true, $1::jsonb, now())
     on conflict (id) do update set country = excluded.country, computed_at = excluded.computed_at`,
    [JSON.stringify({...COUNTRY, ...c, hasProvinces: true})]);
}

export async function ensureStats(pool) {
  if (!(await pool.query('select 1 from stats_dirty limit 1')).rowCount) return false;
  return withTransaction(pool, async tx => {
    if (!(await tx.query('delete from stats_dirty')).rowCount) return false;
    await recompute(tx);
    return true;
  });
}

const statOut = (r, segs) => ({
  customerCount: r.customer_count, prospectCount: r.prospect_count, coverage: Number(r.coverage),
  gapScore: Number(r.gap_score), gapLevel: r.gap_level, gapCount: r.gap_count, gapDepth: Number(r.gap_depth), gapBreadth: Number(r.gap_breadth),
  topGapSegment: r.top_gap_segment, gapSegs: (r.gap_segs || []).map(x => ({seg: x.seg, demand: x.demand, supply: x.supply, gap: x.gap})),
  topSegment: r.top_segment, segmentDistribution: Object.fromEntries(segs.map(s => [s, (r.segment_distribution || {})[s] || 0])),
});

const READERS = {
  areas: async (pool, segs) => (await pool.query(
    `select a.*, ST_X(p.center) as cx, ST_Y(p.center) as cy
     from area_stats a join provinces p on p.key = a.province order by a.gap_score desc, a.province`)).rows
    .map(r => { const s = statOut(r, segs); return {province: r.province, center: r.cx == null ? null : [r.cx, r.cy],
      customerCount: s.customerCount, prospectCount: s.prospectCount, coverage: s.coverage, density: Number(r.density), ...s}; }),
  districts: async (pool, segs) => (await pool.query('select * from district_stats order by gap_score desc, province, district')).rows
    .map(r => ({province: r.province, district: r.district, ...statOut(r, segs)})),
  countries: async pool => {
    const c = ((await pool.query('select country from stats_state')).rows[0] || {}).country;
    if (!c || !c.country) return [];
    return [{country: c.country, center: c.center, customerCount: c.customerCount, prospectCount: c.prospectCount, coverage: c.coverage,
      gapScore: c.gapScore, gapLevel: c.gapLevel, gapCount: c.gapCount, gapDepth: c.gapDepth, gapBreadth: c.gapBreadth, topGapSegment: c.topGapSegment,
      gapSegs: (c.gapSegs || []).map(x => ({seg: x.seg, demand: x.demand, supply: x.supply, gap: x.gap})), hasProvinces: true}];
  },
};

export const STAT_FILES = Object.keys(READERS);

export async function readStats(pool, name) {
  try {
    await ensureStats(pool);
    return await READERS[name](pool, name === 'countries' ? null : await activeSegments(pool));
  } catch (e) {
    if (!e || e.code !== '42P01') throw e;
    console.error('[stats] migrations not applied, serving the bundled file:', e.message);
    return JSON.parse(await readFile(new URL(`../data/${name}.json`, import.meta.url), 'utf8'));
  }
}
