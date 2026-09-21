// resolveZone.js — หาโซนจากพิกัด (point-in-polygon) พร้อม fallback ชื่อเขต
// ใช้ได้กับ zones.geojson ทุกแบบ: dissolve จาก ADM2 หรือ polygon ที่วาดเอง
// ไม่มี dependency ใช้ได้ทั้ง node และ browser

const R = 6371008.8; // รัศมีโลกเฉลี่ย (m)

/** ระยะจากจุดถึงเซกเมนต์ (m) — ระนาบท้องถิ่น พอสำหรับสเกลเมือง */
function distToSegment(p, a, b) {
  const lat0 = (p[1] * Math.PI) / 180;
  const kx = (Math.PI / 180) * R * Math.cos(lat0), ky = (Math.PI / 180) * R;
  const px = p[0] * kx, py = p[1] * ky;
  const ax = a[0] * kx, ay = a[1] * ky;
  const bx = b[0] * kx, by = b[1] * ky;
  const dx = bx - ax, dy = by - ay;
  const L2 = dx * dx + dy * dy;
  let t = L2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** ray casting — จุดอยู่ในวงแหวนไหม (ring = [[lng,lat],...]) */
function inRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) &&
        lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function bboxOf(ring) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ring) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

export function createZoneResolver(geojson, opts = {}) {
  const { zoneByDistrict = null, edgeWarnMeters = 300 } = opts;

  const parts = [];
  for (const f of geojson.features ?? []) {
    const zid = f.properties?.zone_id;
    const g = f.geometry;
    if (!zid || !g) continue;
    const polys = g.type === 'MultiPolygon' ? g.coordinates
                : g.type === 'Polygon' ? [g.coordinates] : [];
    for (const rings of polys) {
      parts.push({ zid, outer: rings[0], holes: rings.slice(1), bbox: bboxOf(rings[0]) });
    }
  }
  if (!parts.length) throw new Error('resolveZone: geojson ไม่มี feature ที่มี zone_id');

  function zoneAt(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    for (const p of parts) {
      const [x0, y0, x1, y1] = p.bbox;
      if (lng < x0 || lng > x1 || lat < y0 || lat > y1) continue;
      if (!inRing(lng, lat, p.outer)) continue;
      if (p.holes.some(h => inRing(lng, lat, h))) continue;   // ตกในรู = ไม่นับ
      return p.zid;
    }
    return null;
  }

  /** ระยะถึงขอบโซนที่ใกล้ที่สุด (m) */
  function distanceToEdge(lat, lng) {
    let best = Infinity;
    const pt = [lng, lat];
    for (const p of parts) {
      const [x0, y0, x1, y1] = p.bbox;
      const dx = lng < x0 ? x0 - lng : lng > x1 ? lng - x1 : 0;
      const dy = lat < y0 ? y0 - lat : lat > y1 ? lat - y1 : 0;
      if (Math.hypot(dx, dy) * 111000 > best) continue;
      for (const ring of [p.outer, ...p.holes]) {
        for (let i = 1; i < ring.length; i++) {
          const d = distToSegment(pt, ring[i - 1], ring[i]);
          if (d < best) best = d;
        }
      }
    }
    return best;
  }

  function resolve(rec) {
    const lat = rec.latitude ?? rec.lat;
    const lng = rec.longitude ?? rec.lng ?? rec.lon;
    const byPoint = zoneAt(lat, lng);
    const byName  = zoneByDistrict ? zoneByDistrict(rec.district) : null;

    if (byPoint) {
      const d = distanceToEdge(lat, lng);
      return {
        zone_id: byPoint,
        source: 'point',
        near_edge: d < edgeWarnMeters,
        dist_m: Math.round(d),
        // ชื่อเขตบอกคนละโซนกับพิกัด -> ไม่เลือกข้าง ส่งต่อให้คนตัดสิน
        conflict: !!byName && byName !== byPoint,
      };
    }
    return { zone_id: byName ?? null, source: byName ? 'district' : null,
             near_edge: false, dist_m: null, conflict: false };
  }

  return { resolve, zoneAt, distanceToEdge, parts: parts.length };
}

/** สร้าง fallback จาก zones.csv (khet_en/khet_th -> zone_id) */
export function districtLookup(rows, normalize = s =>
  String(s ?? '').toLowerCase().replace(/[^a-z฀-๿]/g, '')) {
  const m = new Map();
  for (const r of rows) {
    if (r.khet_en) m.set(normalize(r.khet_en), r.zone_id);
    if (r.khet_th) m.set(normalize(r.khet_th), r.zone_id);
  }
  return name => m.get(normalize(name)) ?? null;
}
