import {withTransaction} from './pool.mjs';

const KNOWN = new Set(['zone_id', 'zone_name', 'zone_name_en', 'color', 'province', 'districts']);
const MAX_HISTORY = 20;

const versionKey = () => new Date().toISOString().replace(/[:.]/g, '-');

function toRow(feature, position) {
  const p = feature.properties || {};
  const props = {};
  for (const [k, v] of Object.entries(p)) if (!KNOWN.has(k)) props[k] = v;
  return {
    zone_id: p.zone_id,
    name: (typeof p.zone_name === 'string' && p.zone_name.trim()) ? p.zone_name : p.zone_id,
    name_en: p.zone_name_en ?? null,
    color: p.color ?? null,
    province: p.province ?? null,
    districts: Array.isArray(p.districts) ? p.districts : [],
    geometry: JSON.stringify(feature.geometry),
    props: JSON.stringify(props),
    position,
  };
}

function toFeature(r) {
  const properties = {zone_id: r.zone_id, zone_name: r.name};
  if (r.name_en !== null) properties.zone_name_en = r.name_en;
  if (r.color !== null) properties.color = r.color;
  if (r.province !== null) properties.province = r.province;
  properties.districts = r.districts || [];
  return {type: 'Feature', geometry: JSON.parse(r.geometry), properties: {...properties, ...(r.props || {})}};
}

async function readState(db, state) {
  const r = await db.query(
    `select zone_id, name, name_en, color, province, districts, props, ST_AsGeoJSON(geom, 15) as geometry
       from zones where state = $1 order by position, zone_id`, [state]);
  if (!r.rowCount) return null;
  return {type: 'FeatureCollection', features: r.rows.map(toFeature)};
}

async function assertValid(db, rows) {
  for (const row of rows) {
    const r = await db.query(
      `select ST_IsValid(g) as ok, ST_IsValidReason(g) as reason
         from (select ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) as g) x`, [row.geometry]);
    if (!r.rows[0].ok) {
      const e = new Error('invalid zone geometry: ' + row.zone_id);
      e.zoneError = row.zone_id + ': รูปโซนไม่ถูกต้อง เส้นขอบตัดกันเองหรือซ้อนทับตัวเอง (' + r.rows[0].reason + ')';
      throw e;
    }
  }
}

async function writeState(db, state, gj, version, actor) {
  const rows = gj.features.map(toRow);
  await assertValid(db, rows);
  await db.query('delete from zones where state = $1', [state]);
  for (const row of rows)
    await db.query(
      `insert into zones (zone_id, state, name, name_en, color, province, districts, geom, props, position, version, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, ST_SetSRID(ST_GeomFromGeoJSON($8), 4326), $9::jsonb, $10, $11, $12)`,
      [row.zone_id, state, row.name, row.name_en, row.color, row.province, row.districts,
       row.geometry, row.props, row.position, version, actor || null]);
}

export function makeZoneAdapter(pool) {
  return {
    getLive: () => readState(pool, 'live'),
    getDraft: () => readState(pool, 'draft'),

    async listHistory() {
      const r = await pool.query('select version_key from zone_history order by version desc');
      return r.rows.map(x => ({version: x.version_key, name: 'history/' + x.version_key + '.geojson'}));
    },

    async getVersion(key) {
      const r = await pool.query('select snapshot from zone_history where version_key = $1', [String(key)]);
      return r.rowCount ? r.rows[0].snapshot : null;
    },

    saveDraft(gj, raw, opts) {
      return withTransaction(pool, async tx => {
        await tx.query('lock table zones in share row exclusive mode');
        const v = await tx.query("select coalesce(max(version), 1) as v from zones where state = 'live'");
        await writeState(tx, 'draft', gj, v.rows[0].v, opts && opts.actor);
      });
    },

    async clearDraft() {
      await pool.query("delete from zones where state = 'draft'");
    },

    publish(gj, raw, opts) {
      const o = opts || {};
      return withTransaction(pool, async tx => {
        await tx.query('lock table zones in share row exclusive mode');
        const current = await readState(tx, 'live');
        const v = await tx.query(
          `select greatest((select coalesce(max(version), 0) from zones where state = 'live'),
                           (select coalesce(max(version), 0) from zone_history)) as v`);
        const last = v.rows[0].v;
        let archived = null;
        if (current) {
          archived = versionKey();
          await tx.query(
            `insert into zone_history (version, version_key, snapshot, action, actor_id)
             values ($1, $2, $3::jsonb, $4, $5)`,
            [last, archived, JSON.stringify(current), o.action || 'publish', o.actor || null]);
          await tx.query(
            `delete from zone_history where version not in
               (select version from zone_history order by version desc limit $1)`, [MAX_HISTORY]);
        }
        await writeState(tx, 'live', gj, last + 1, o.actor);
        if (o.clearDraft) await tx.query("delete from zones where state = 'draft'");
        return archived;
      });
    },
  };
}
