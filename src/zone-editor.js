// ---------------------------------------------------------------------------
// zone-editor.js — โหมดลากขอบโซนด้วย Geoman
//
// โปรเจกต์นี้ไม่มี npm / bundler (importmap + CDN ล้วน) จึงต่างจากสเปกเดิม 2 จุด:
//   * ไม่ใช่ `npm i @geoman-io/...` แต่โหลด Geoman จาก CDN ตอน enable() ครั้งแรก
//     -> คนที่ไม่ได้เข้าโหมดแก้ไข ไม่ต้องดาวน์โหลด 200 KB นี้เลย
//   * ไม่ใช่ `import.meta.env.DEV` (นั่นของ Vite) แต่ใช้ ?edit=1 ตามที่โปรเจกต์
//     ใช้อยู่แล้วกับ ?perf=1 / ?demo=admin
//
// ฟังก์ชันคำนวณล้วน (countVertices / statsOf / roundCoords) export แยกไว้
// ให้ทดสอบใน node ได้โดยไม่ต้องมี Leaflet
// ---------------------------------------------------------------------------

import { saveZoneRegistry, saveZoneDraft, approveZoneDraft, discardZoneDraft, loadZoneDraft,
         listZoneVersions, restoreZoneVersion, setAdminToken, adminToken, nextColor }
  from './zone-registry.js';   // ทะเบียนโซน: แคชกลาง · ร่าง/อนุมัติ · ประวัติ · รหัสผู้ดูแล

// ไลบรารีหลอมโพลิกอน (union) — โหลดจาก CDN ตอนกดรวมโซนครั้งแรกเท่านั้น
// โปรเจกต์นี้ไม่มี npm แต่โหลด ESM จาก CDN ได้อยู่แล้ว (react/htm/protomaps ก็มาทางนี้)
const CLIPPER_URL = 'https://esm.sh/polygon-clipping@0.15.7';
let clipper = null, clipperTried = false;
async function loadClipper() {
  if (clipper || clipperTried) return clipper;
  clipperTried = true;
  try { const m = await import(CLIPPER_URL); clipper = m.default || m; }
  catch (e) { console.warn('[zone-editor] โหลดไลบรารีหลอมรูปไม่สำเร็จ จะรวมแบบแยกส่วนแทน', e); clipper = null; }
  return clipper;
}

const GEOMAN_VER = '2.18.3';
const GEOMAN_JS  = `https://unpkg.com/@geoman-io/leaflet-geoman-free@${GEOMAN_VER}/dist/leaflet-geoman.min.js`;
const GEOMAN_CSS = `https://unpkg.com/@geoman-io/leaflet-geoman-free@${GEOMAN_VER}/dist/leaflet-geoman.css`;

export const LIMITS = { vertices: 20000, kb: 600 };   // = 40,000 คอมมาใน verify-zones.mjs (มันนับคอมมา ≈2× จุด)
const PRECISION = 5;                                  // ตรงกับ extract-zones.mjs (~1.1 ม.)

/* ── ส่วนคำนวณล้วน: ไม่แตะ Leaflet ทดสอบใน node ได้ ─────────────────────── */

export function countVertices(geojson) {
  let n = 0;
  const walk = c => Array.isArray(c[0]) ? c.forEach(walk) : n++;
  for (const f of geojson.features ?? []) if (f.geometry) walk(f.geometry.coordinates);
  return n;
}

export function roundCoords(geojson, precision = PRECISION) {
  const p = 10 ** precision;
  const walk = c => Array.isArray(c[0])
    ? c.map(walk)
    : [Math.round(c[0] * p) / p, Math.round(c[1] * p) / p];
  return {
    ...geojson,
    features: (geojson.features ?? []).map(f => ({
      ...f,
      geometry: f.geometry ? { ...f.geometry, coordinates: walk(f.geometry.coordinates) } : null,
    })),
  };
}

export function statsOf(geojson) {
  const per = (geojson.features ?? []).map(f => {
    let n = 0;
    const walk = c => Array.isArray(c[0]) ? c.forEach(walk) : n++;
    if (f.geometry) walk(f.geometry.coordinates);
    const g = f.geometry;
    return {
      zone_id: f.properties?.zone_id ?? '?',
      zone_name: f.properties?.zone_name ?? '',
      vertices: n,
      parts: g?.type === 'MultiPolygon' ? g.coordinates.length : g ? 1 : 0,
    };
  });
  const vertices = per.reduce((s, r) => s + r.vertices, 0);
  const kb = Math.round(new TextEncoder().encode(JSON.stringify(geojson)).length / 1024);
  return {
    per, vertices, kb,
    overVertices: vertices > LIMITS.vertices,
    overKb: kb > LIMITS.kb,
  };
}

/* ── ลดจุด (Douglas-Peucker) — ใช้ตอนหมุดถี่เกินจนลากไม่ถนัด ─────────────── */

/** ระยะตั้งฉากจากจุดถึงเส้น a-b · คูณ cos(lat) ให้ระยะแนวตะวันออก-ตกไม่เพี้ยน */
function perpDist(p, a, b) {
  const k = Math.cos(p[1] * Math.PI / 180);
  const px = p[0] * k, ax = a[0] * k, bx = b[0] * k;
  const dx = bx - ax, dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas-Peucker — คงจุดแรก/จุดสุดท้ายเสมอ วงแหวนจึงยังปิดสนิท */
export function simplifyRing(ring, eps) {
  if (ring.length <= 4) return ring;           // สามเหลี่ยมปิด = 4 จุด ลดต่อไม่ได้
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let far = -1, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpDist(ring[i], ring[s], ring[e]);
      if (d > far) { far = d; idx = i; }
    }
    if (far > eps && idx > 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  const out = ring.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : ring;         // เหลือน้อยจนไม่เป็นรูป -> คืนของเดิม
}

export function simplifyGeoJSON(geojson, eps) {
  const ringOf = c => Array.isArray(c[0]?.[0]) ? c.map(ringOf) : simplifyRing(c, eps);
  return {
    ...geojson,
    features: (geojson.features ?? []).map(f => {
      if (!f.geometry) return f;
      const g = f.geometry;
      const coords = g.type === 'MultiPolygon'
        ? g.coordinates.map(poly => poly.map(r => simplifyRing(r, eps)))
        : g.type === 'Polygon' ? g.coordinates.map(r => simplifyRing(r, eps))
        : g.coordinates;
      return { ...f, geometry: { ...g, coordinates: coords } };
    }),
  };
}

const M_PER_DEG = 111320;

/** ระยะระหว่าง 2 พิกัด เป็นเมตร (ระนาบท้องถิ่น พอสำหรับสเกลเมือง) */
function metersBetween(a, b) {
  const k = Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
  return Math.hypot((b[0] - a[0]) * k, b[1] - a[1]) * M_PER_DEG;
}

/**
 * บังคับระยะห่างขั้นต่ำระหว่างหมุด — ต่างจาก DP ตรงที่ DP ลดตาม "ความโค้ง"
 * ช่วงที่คดเคี้ยวมาก (แม่น้ำ) จึงยังเหลือหมุดถี่ ส่วนอันนี้เดินไล่ไปตามเส้น
 * เก็บหมุดถัดไปเมื่อห่างจากหมุดที่เก็บไว้ล่าสุดถึงเกณฑ์เท่านั้น
 */
export function thinRing(ring, minMeters) {
  if (ring.length <= 4) return ring;
  const out = [ring[0]];
  for (let i = 1; i < ring.length - 1; i++) {
    if (metersBetween(out[out.length - 1], ring[i]) >= minMeters) out.push(ring[i]);
  }
  out.push(ring[ring.length - 1]);            // ปิดวงเสมอ
  return out.length >= 4 ? out : ring;
}

export function thinGeoJSON(geojson, minMeters) {
  return {
    ...geojson,
    features: (geojson.features ?? []).map(f => {
      if (!f.geometry) return f;
      const g = f.geometry;
      const coords = g.type === 'MultiPolygon'
        ? g.coordinates.map(poly => poly.map(r => thinRing(r, minMeters)))
        : g.type === 'Polygon' ? g.coordinates.map(r => thinRing(r, minMeters))
        : g.coordinates;
      return { ...f, geometry: { ...g, coordinates: coords } };
    }),
  };
}

/** ลด "รอยหยักเล็กกว่า N เมตร" ทิ้ง แล้วบังคับระยะห่างหมุดขั้นต่ำ N เมตร */
export function coarsen(geojson, meters) {
  const before = countVertices(geojson);
  const out = thinGeoJSON(simplifyGeoJSON(geojson, meters / M_PER_DEG), meters);
  return { geojson: out, before, after: countVertices(out) };
}

/** ลดจุดให้เหลือ ~percent% ของเดิม — หา eps ด้วย binary search ไม่ต้องเดาหน่วย */
export function simplifyToPercent(geojson, percent) {
  const before = countVertices(geojson);
  const target = Math.max(12, Math.round(before * percent / 100));
  let lo = 0, hi = 0.02, best = geojson;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const out = simplifyGeoJSON(geojson, mid);
    const n = countVertices(out);
    if (n > target) lo = mid; else { hi = mid; best = out; }
  }
  return { geojson: best, before, after: countVertices(best) };
}

/* ── ส่วนที่ต้องมี Leaflet ────────────────────────────────────────────────── */

let geomanLoading = null;
function loadGeoman() {
  if (typeof window === 'undefined') return Promise.reject(new Error('zone-editor: ต้องรันในเบราว์เซอร์'));
  if (window.L?.PM) return Promise.resolve();
  if (geomanLoading) return geomanLoading;
  geomanLoading = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${GEOMAN_CSS}"]`)) {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = GEOMAN_CSS;
      document.head.appendChild(css);
    }
    const s = document.createElement('script');
    s.src = GEOMAN_JS;
    s.onload = () => window.L?.PM
      ? resolve()
      : reject(new Error('zone-editor: โหลด Geoman แล้วแต่ไม่พบ L.PM'));
    s.onerror = () => reject(new Error(
      `zone-editor: โหลด Geoman ไม่สำเร็จ (${GEOMAN_JS})\n` +
      'โปรเจกต์นี้ดึงไลบรารีจาก CDN — เช็กเน็ต หรือดาวน์โหลดไฟล์มาวางเองแล้วแก้ GEOMAN_JS'));
    document.head.appendChild(s);
  });
  return geomanLoading;
}

/**
 * @param map    L.Map
 * @param zones  ผลลัพธ์จาก createZoneLayer() (ต้องมี .layer และ .paneName)
 */
export function createZoneEditor(map, zones) {
  if (!zones?.layer) throw new Error('zone-editor: ต้องส่ง object จาก createZoneLayer() เข้ามา');

  const clone = o => JSON.parse(JSON.stringify(o));
  const snapshot = clone(zones.layer.toGeoJSON());   // ไว้ revert()
  let on = false, dirty = false, prevPointerEvents = null;

  // รูปตั้งต้นสำหรับ "ลดหมุด" — ดู thin() · ล้างทุกครั้งที่มีการแก้รูปด้วยวิธีอื่น
  let thinBase = null;
  const resetThinBase = () => { thinBase = null; };
  const markDirty = () => { dirty = true; resetThinBase(); };
  const EVENTS = ['pm:edit', 'pm:markerdragend', 'pm:vertexadded', 'pm:vertexremoved', 'pm:cut'];

  // ประวัติสำหรับ undo — เก็บ "ก่อนแก้" ทุกครั้งที่เริ่มลาก/เพิ่ม/ลบจุด
  // จำกัด 40 ขั้น กันกินหน่วยความจำ (แต่ละขั้นคือ FeatureCollection เต็ม)
  const history = [];
  // กองทำซ้ำ (redo) — เติมตอน undo · ล้างทันทีที่มีการแก้ใหม่ เพราะเส้นทางเดิมใช้ไม่ได้แล้ว
  const future = [];
  const pushHistory = () => {
    history.push(clone(zones.layer.toGeoJSON()));
    if (history.length > 40) history.shift();
    future.length = 0;
  };
  const BEFORE = ['pm:markerdragstart', 'pm:vertexadded', 'pm:vertexremoved'];

  /* ── สถานะ "เลือกโซนด้วยการคลิก" (ใช้เวลารวมโซน) ───────────────────────── */
  const selected = new Set();
  let pickMode = false, pickPrevPE = null, onSelChange = null;
  let drawing = false;                 // อยู่ระหว่างวาดโซนใหม่ (ยังไม่จบรูป)
  // ⚠ addByDraw() ต้อง await loadGeoman() ก่อน จึงยังไม่ได้เข้าโหมดวาดตอนที่ฟังก์ชันคืนค่ากลับไป
  //    ถ้าไม่บอกกลับ แถบเครื่องมือจะเรนเดอร์ตอน drawing ยังเป็น false แล้วปุ่มย้อนจุดค้างเป็นสีเทา
  let onDrawChange = null;
  const fireDraw = () => { if (onDrawChange) { try { onDrawChange(drawing); } catch (e) { console.warn(e); } } };

  const onPickClick = e => {
    const f = e.target && e.target.feature;
    const id = f && f.properties && f.properties.zone_id;
    if (!id) return;
    if (e.originalEvent) window.L.DomEvent.stopPropagation(e.originalEvent);   // อย่าให้คลิกทะลุไปเลือกจังหวัด
    selected.has(id) ? selected.delete(id) : selected.add(id);
    restyleSelection();
  };

  /** ไฮไลต์โซนที่ติ๊กไว้ — เส้นหนาขึ้น + ประ + ทึบขึ้น เพื่อให้ต่างจากโซนปกติชัด ๆ */
  function restyleSelection() {
    zones.layer.eachLayer(l => {
      const p = (l.feature && l.feature.properties) || {};
      const c = p.color || '#64748b';
      l.setStyle(selected.has(p.zone_id)
        ? { color: c, fillColor: c, weight: 4, dashArray: '6 4', fillOpacity: 0.45 }
        : { color: c, fillColor: c, weight: 1.5, dashArray: null, fillOpacity: 0.14 });
    });
    if (onSelChange) { try { onSelChange([...selected]); } catch (e) { console.warn(e); } }
  }

  /** ผูก click ของโหมดเลือกให้เลเยอร์ชุดปัจจุบัน — ต้องเรียกทุกครั้งที่สร้างเลเยอร์ใหม่
      (reload / merge / addByDraw ทิ้งเลเยอร์เดิมไป handler ที่ผูกไว้จึงหายไปด้วย) */
  function rebindPick() {
    if (!pickMode) return;
    zones.layer.eachLayer(l => { l.off('click', onPickClick); l.on('click', onPickClick); });
  }

  /** โหลด geojson กลับเข้า layer แล้วเปิดโหมดแก้ไขต่อถ้าเปิดอยู่ */
  function reload(gj) {
    resetThinBase();          // รูปเปลี่ยนด้วยวิธีอื่นแล้ว — ลดหมุดรอบหน้าต้องคิดจากรูปใหม่
    const wasOn = on;
    api.disable();
    zones.layer.clearLayers();
    zones.layer.addData(clone(gj));
    if (wasOn) api.enable();
    rebindPick();
    restyleSelection();
  }

  const api = {
    async enable() {
      await loadGeoman();
      if (on) return api;
      const L = window.L;

      // Geoman ผูก .pm ผ่าน L.Map.addInitHook ซึ่งวิ่งตอน "สร้าง" แมพ/เลเยอร์เท่านั้น
      // แต่เราโหลด Geoman ทีหลัง (ตอน enable ครั้งแรก) แมพกับ zone layer เกิดไปก่อนแล้ว
      // ไม่ผูกเองตรงนี้ = map.pm undefined -> setGlobalOptions ระเบิด
      if (!map.pm) { map.pm = new L.PM.Map(map); map.pm.setGlobalOptions({}); }
      L.PM.reInitLayer(zones.layer);   // ไล่ผูก .pm ให้ทุกโพลิกอนใน LayerGroup

      // pane ของโซนตั้ง pointer-events:none ไว้ ไม่งั้นลากหมุดไม่ได้
      const pane = map.getPane(zones.paneName);
      if (pane) { prevPointerEvents = pane.style.pointerEvents; pane.style.pointerEvents = 'auto'; }

      map.pm.setGlobalOptions({
        snapDistance: 15,          // ดูดขอบโซนข้างเคียง กัน "ช่องว่างบางเฉียบ" ที่ตาไม่เห็น
        snapSegment: true,
        allowSelfIntersection: false,
        limitMarkersToCount: 400,  // ขอบ ADM2 มี ~5,884 จุด เรนเดอร์หมุดครบ = เบราว์เซอร์ตาย
      });

      let ready = 0;
      zones.layer.eachLayer(l => {
        if (!l.pm) { console.warn('[zone-editor] เลเยอร์นี้ไม่มี .pm ข้ามไป', l.feature?.properties?.zone_id); return; }
        l.pm.enable({ allowSelfIntersection: false, limitMarkersToCount: 400 });
        EVENTS.forEach(e => l.on(e, markDirty));
        BEFORE.forEach(e => l.on(e, pushHistory));
        ready++;
      });
      if (!ready) throw new Error('[zone-editor] ไม่มีโพลิกอนไหนเปิดแก้ไขได้ — L.PM.reInitLayer ไม่ทำงาน');
      on = true;
      console.log('[zone-editor] เปิดโหมดแก้ไข ' + ready + ' โซน — ลากหมุดได้ · E.stats() ดูตัวเลข · E.download() เซฟ · E.revert() ย้อน');
      return api;
    },

    disable() {
      if (!on) return api;
      zones.layer.eachLayer(l => {
        l.pm.disable();
        EVENTS.forEach(e => l.off(e, markDirty));
        BEFORE.forEach(e => l.off(e, pushHistory));
      });
      const pane = map.getPane(zones.paneName);
      // โหมดเลือกโซนยังต้องคลิกได้ ถึงจะปิดโหมดลากขอบไปแล้ว
      if (pane) pane.style.pointerEvents = pickMode ? 'auto' : (prevPointerEvents ?? '');
      on = false;
      return api;
    },

    isEnabled: () => on,
    isDirty: () => dirty,
    /** สรุปตัวเลขให้ UI ภายนอกใช้ (แถบเครื่องมือด้านบน) ไม่ต้อง import statsOf เอง */
    summary() {
      const s = statsOf(api.toGeoJSON());
      return { zones: api.zones().length, vertices: s.vertices, kb: s.kb,
               dirty, over: s.overVertices || s.overKb, undo: history.length, redo: future.length,
               editing: on, picking: pickMode, picked: [...selected], drawing };
    },

    /** ย้อน 1 ขั้น — ลากพลาดกดอันนี้ ไม่ต้อง revert ทั้งหมด */
    undo() {
      if (!history.length) { console.log('[zone-editor] ไม่มีอะไรให้ย้อนแล้ว'); return api; }
      const now = clone(zones.layer.toGeoJSON());
      const prev = history.pop();
      reload(prev);
      future.push(now);                      // reload() ไม่แตะ future — ดันหลังโหลดเพื่อกันลำดับสลับ
      if (future.length > 40) future.shift();
      console.log(`[zone-editor] ย้อน 1 ขั้น — เหลือย้อนได้อีก ${history.length} ครั้ง · ทำซ้ำได้ ${future.length}`);
      return api;
    },
    undoDepth: () => history.length,

    /** ลบจุดล่าสุดที่เพิ่งคลิกวางระหว่างวาดโซนใหม่ — คนละเรื่องกับ undo() ที่ย้อนทั้งรูป
     *  เหลือจุดเดียวแล้วกดต่อ Geoman จะปิดโหมดวาดเอง (= ยกเลิกการวาด) ซึ่งเป็นพฤติกรรมที่ต้องการ */
    undoVertex() {
      const d = map.pm && map.pm.Draw && map.pm.Draw.Polygon;
      if (!drawing || !d || typeof d._removeLastVertex !== 'function')
        return { ok: false, error: 'ยังไม่ได้เริ่มวาดโซนใหม่' };
      d._removeLastVertex();
      return { ok: true };
    },

    /** ออกจากโหมดวาดโดยไม่สร้างโซน */
    cancelDraw() { if (drawing) map.pm.disableDraw(); return api; },
    isDrawing: () => drawing,
    /** ให้ UI ภายนอกรู้ว่าเข้า/ออกโหมดวาดเมื่อไร (เข้าโหมดช้ากว่าที่กดปุ่มเพราะต้องโหลด Geoman ก่อน) */
    setDrawHandler(fn) { onDrawChange = typeof fn === 'function' ? fn : null; return api; },

    /** ทำซ้ำ — กลับไปรูปที่เพิ่ง undo ทิ้ง (ใช้ได้จนกว่าจะแก้อย่างอื่น) */
    redo() {
      if (!future.length) { console.log('[zone-editor] ไม่มีอะไรให้ทำซ้ำ'); return api; }
      const now = clone(zones.layer.toGeoJSON());
      const next = future.pop();
      reload(next);
      history.push(now);
      if (history.length > 40) history.shift();
      dirty = true;
      console.log(`[zone-editor] ทำซ้ำ 1 ขั้น — เหลือทำซ้ำได้อีก ${future.length}`);
      return api;
    },
    redoDepth: () => future.length,

    /**
     * ลดจุดให้เหลือ ~percent% ของปัจจุบัน — หมุดจะห่างขึ้น ลากง่ายขึ้น
     * ทดสอบแล้วว่าลดถึง 8% ยังไม่มีลูกค้าข้ามโซนสักราย (flip = 0)
     */
    /**
     * เหลือเฉพาะหมุดที่จำเป็น — บังคับระยะห่างขั้นต่ำเป็นเมตร
     * ใช้ตัวนี้แทน simplify() เวลาหมุดถี่จนลากไม่ไหว (แถวแม่น้ำ)
     */
    thin(meters = 300) {
      // ⚠ คิดจาก "รูปก่อนลดหมุดครั้งแรก" ไม่ใช่รูปปัจจุบัน — ไม่งั้นเลือก 100 แล้วเลือก 300 ต่อ
      //   จะเป็นการลดซ้อนกัน (5884→177→85) ซึ่งไม่ตรงกับที่ผู้ใช้คาดว่า "300 ม. = หมุดห่าง 300 ม."
      //   thinBase ถูกล้างเมื่อมีการแก้อย่างอื่น (ลาก/เพิ่ม/รวม/ย้อน) รอบถัดไปจึงคิดจากรูปที่แก้แล้ว
      if(!thinBase) thinBase = clone(zones.layer.toGeoJSON());
      pushHistory();
      const r = coarsen(thinBase, meters);
      const keep = thinBase;                 // reload() ล้าง thinBase ผ่าน resetThinBase — ตั้งกลับหลังโหลด
      reload(r.geojson);
      thinBase = keep;
      dirty = true;
      console.log(`[zone-editor] หมุดห่างกันอย่างน้อย ${meters} ม. · ${r.before} -> ${r.after} จุด (${(r.after / r.before * 100).toFixed(0)}%) · E.undo() ถ้าไม่ชอบ`);
      return r;
    },

    simplify(percent = 40) {
      pushHistory();
      const r = simplifyToPercent(zones.layer.toGeoJSON(), percent);
      reload(r.geojson);
      dirty = true;
      console.log(`[zone-editor] ลดจุด ${r.before} -> ${r.after} (${(r.after / r.before * 100).toFixed(0)}%) · E.undo() ถ้าไม่ชอบ`);
      return r;
    },

    /** FeatureCollection ปัจจุบัน — properties ครบ พิกัดปัดเท่า pipeline */
    toGeoJSON() {
      const gj = zones.layer.toGeoJSON();
      const bySrc = new Map((snapshot.features ?? [])
        .map(f => [f.properties?.zone_id, f.properties]));
      gj.features = (gj.features ?? []).map(f => ({
        ...f,
        properties: { ...(bySrc.get(f.properties?.zone_id) ?? {}), ...f.properties },
      }));
      return roundCoords(gj);
    },

    stats() {
      const s = statsOf(api.toGeoJSON());
      console.table(s.per);
      const flag = (bad, msg) => console.log(`${bad ? '✗' : '✓'} ${msg}`);
      flag(s.overVertices, `จุดรวม ${s.vertices} / เพดาน ${LIMITS.vertices}`);
      flag(s.overKb, `ขนาด ${s.kb} KB / เพดาน ${LIMITS.kb} KB`);
      if (dirty) console.log('! แก้ไปแล้วแต่ยังไม่ได้เซฟ — E.download()');
      return s;
    },

    download(filename = 'zones.geojson') {
      const gj = api.toGeoJSON();
      const s = statsOf(gj);
      if (s.overVertices || s.overKb)
        console.warn(`[zone-editor] เกินเพดาน (${s.vertices} จุด · ${s.kb} KB) — เซฟได้ แต่ verify-zones.mjs จะแดง`);
      const blob = new Blob([JSON.stringify(gj)], { type: 'application/geo+json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      console.log(`[zone-editor] เซฟ ${filename} — วางทับ data/zones.geojson แล้วรัน:\n` +
        '  node verify-zone-assign.mjs data/customers.json --province "Bangkok"');
      return gj;
    },

    /* ── จัดการโซน: เพิ่ม / เปลี่ยนชื่อ / เปลี่ยนสี / รวม / ลบ ─────────────────
       ทั้งหมดแก้ที่ properties ของ feature แล้วค่อย publish() ทีเดียว
       ทะเบียนโซนเป็นแหล่งเดียว (ดู zone-registry.js) จึงไม่ต้องไปแก้โค้ดที่อื่นอีก */

    /** รายการโซนปัจจุบันในตัวแก้ไข */
    zones() {
      return zones.layer.getLayers().map(l => {
        const p = (l.feature && l.feature.properties) || {};
        let n = 0; const walk = c => Array.isArray(c[0]) ? c.forEach(walk) : n++;
        if (l.feature && l.feature.geometry) walk(l.feature.geometry.coordinates);
        return { zone_id: p.zone_id, name: p.zone_name || p.zone_id, color: p.color, province: p.province, vertices: n, _layer: l };
      });
    },

    rename(zoneId, name) {
      const z = api.zones().find(x => x.zone_id === zoneId);
      if (!z) return { ok: false, error: 'ไม่พบโซน ' + zoneId };
      if (!name || !name.trim()) return { ok: false, error: 'ต้องใส่ชื่อ' };
      z._layer.feature.properties.zone_name = name.trim();
      dirty = true;
      return { ok: true };
    },

    recolor(zoneId, hex) {
      if (!/^#[0-9a-fA-F]{6}$/.test(hex || '')) return { ok: false, error: 'สีต้องเป็น #rrggbb' };
      const z = api.zones().find(x => x.zone_id === zoneId);
      if (!z) return { ok: false, error: 'ไม่พบโซน ' + zoneId };
      z._layer.feature.properties.color = hex;
      z._layer.setStyle({ color: hex, fillColor: hex });   // เห็นผลทันทีไม่ต้องรีโหลดเลเยอร์
      dirty = true;
      return { ok: true };
    },

    remove(zoneId) {
      const z = api.zones().find(x => x.zone_id === zoneId);
      if (!z) return { ok: false, error: 'ไม่พบโซน ' + zoneId };
      if (api.zones().length <= 1) return { ok: false, error: 'ต้องเหลือไว้อย่างน้อย 1 โซน' };
      pushHistory();
      zones.layer.removeLayer(z._layer);
      dirty = true;
      return { ok: true };
    },

    /**
     * รวมหลายโซนเข้าเป็นโซนเดียว — โซน "ตัวแรกในรายการ" เป็นตัวที่อยู่ต่อ (เก็บรหัส/ชื่อ/สีไว้)
     * รูปกลายเป็น MultiPolygon ที่มีทุกส่วนของโซนที่รวม
     */
    async merge(...ids) {
      const want = [...new Set(ids.flat().filter(Boolean))];
      if (want.length < 2) return { ok: false, error: 'ต้องเลือกอย่างน้อย 2 โซน' };
      const list = api.zones();
      const picked = want.map(id => list.find(x => x.zone_id === id));
      if (picked.some(x => !x)) return { ok: false, error: 'ไม่พบโซนที่เลือกบางอัน' };
      if (list.length - picked.length < 0) return { ok: false, error: 'รวมไม่ได้' };

      const polysOf = f => f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates];
      pushHistory();
      const keep = picked[0];
      const props = { ...keep._layer.feature.properties };
      // รายชื่อเขต (fallback ตอนเรกคอร์ดไม่มีพิกัด) ต้องรวมกันด้วย ไม่งั้นเขตของโซนที่ถูกกลืนจะหาโซนไม่เจอ
      props.districts = [...new Set(picked.flatMap(z => z._layer.feature.properties.districts || []))];
      const parts = picked.map(z => polysOf(z._layer.feature));

      // หลอมให้เป็นรูปเดียว (เส้นแบ่งเดิมหายไป) ถ้าโหลดไลบรารีได้
      // โหลดไม่ได้/หลอมพลาด → ต่อกันเป็น MultiPolygon แบบเดิม ยังใช้งานได้ แค่เห็นเส้นแบ่ง
      let geometry = null, fused = false, note = '';
      const pc = await loadClipper();
      if (pc && typeof pc.union === 'function') {
        try {
          const out = pc.union(...parts);          // รับ/คืนพิกัดแบบ MultiPolygon
          if (Array.isArray(out) && out.length) {
            geometry = out.length === 1 ? { type: 'Polygon', coordinates: out[0] }
                                       : { type: 'MultiPolygon', coordinates: out };
            fused = true;
            note = out.length === 1
              ? 'หลอมเป็นรูปเดียวแล้ว เส้นแบ่งเดิมหายไป'
              : `หลอมแล้วแต่ยังเหลือ ${out.length} ส่วน — เพราะโซนที่เลือกไม่ได้ติดกันทุกอัน`;
          }
        } catch (e) {
          console.warn('[zone-editor] หลอมรูปไม่สำเร็จ', e);
        }
      }
      if (!geometry) {
        geometry = { type: 'MultiPolygon', coordinates: parts.flat() };
        note = 'ต่อกันแบบแยกส่วน (ยังเห็นเส้นแบ่งเดิม) — หลอมรูปไม่ได้เพราะโหลดไลบรารีไม่สำเร็จ';
      }

      picked.forEach(z => zones.layer.removeLayer(z._layer));
      zones.layer.addData({ type: 'Feature', properties: props, geometry });
      dirty = true;
      selected.clear();
      if (on) { api.disable(); api.enable(); }     // ผูก .pm ให้เลเยอร์ที่เพิ่งสร้าง
      rebindPick(); restyleSelection();
      const after = geometry.type === 'MultiPolygon' ? geometry.coordinates.length : 1;
      return { ok: true, kept: props.zone_id, absorbed: want.slice(1), fused, parts: after, note };
    },

    /* ── เลือกโซนด้วยการคลิกบนแมพ (ใช้แทน dropdown เวลารวมโซน) ─────────────── */

    /**
     * เปิด/ปิดโหมดเลือก — เปิดแล้วคลิกที่โซนบนแมพเพื่อติ๊ก/ยกเลิก
     * ⚠ ตั้ง pointer-events ของ pane เอง ไม่เรียก zones.setInteractive()
     *   เพราะแฟล็ก interactive ใน zone-layer จะปลุก hover ของมันเองมาทับสไตล์ที่ไฮไลต์ไว้
     */
    setPickMode(v) {
      const want = !!v;
      if (want === pickMode) return api;
      pickMode = want;
      const pane = map.getPane(zones.paneName);
      if (pane) {
        if (want) { if (pickPrevPE === null) pickPrevPE = pane.style.pointerEvents; pane.style.pointerEvents = 'auto'; }
        else if (!on) { pane.style.pointerEvents = pickPrevPE ?? ''; pickPrevPE = null; }   // โหมดลากขอบยังต้องคลิกได้
      }
      zones.layer.eachLayer(l => {
        if (want) l.on('click', onPickClick); else l.off('click', onPickClick);
      });
      if (!want) selected.clear();
      restyleSelection();
      return api;
    },
    isPicking: () => pickMode,
    picked: () => [...selected],
    clearPicked() { selected.clear(); restyleSelection(); return api; },
    /** ให้แผงปุ่มรู้เมื่อรายการที่เลือกเปลี่ยน (คลิกบนแมพไม่ผ่านปุ่ม จึง refresh เองไม่ได้) */
    setPickHandler(fn) { onSelChange = fn; return api; },

    /** เพิ่มโซนใหม่โดย "วาด" รูป — คืน Promise ที่ resolve เมื่อวาดเสร็จ */
    async addByDraw({ zone_id, name, province, color }) {
      await loadGeoman();
      const L = window.L;
      // รหัสโซนเป็น "คีย์ภายใน" ที่ทุกอย่างอ้างถึง (ตารางมอบหมาย · ?zone= · resolveZone)
      // จึงต้องมีและห้ามเปลี่ยนทีหลัง แต่ไม่ควรให้แอดมินคิดเอง — สร้างให้อัตโนมัติ
      //   ชื่ออังกฤษ → ใช้ตัวอักษรจากชื่อ (READ ME → README)
      //   ชื่อไทย/ว่าง → Z1 Z2 Z3 … ตัวถัดไปที่ยังไม่ถูกใช้
      const used = new Set(api.zones().map(z => z.zone_id));
      if (!zone_id) {
        const fromName = String(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
        if (fromName && !used.has(fromName)) zone_id = fromName;
        else { let n = 1; while (used.has('Z' + n)) n++; zone_id = 'Z' + n; }
      }
      if (!/^[A-Za-z0-9_-]{1,12}$/.test(zone_id))
        return { ok: false, error: 'รหัสโซนใช้ได้แค่ A-Z 0-9 _ - ยาวไม่เกิน 12' };
      if (used.has(zone_id)) return { ok: false, error: 'รหัสโซนซ้ำ: ' + zone_id };
      if (!map.pm) { map.pm = new L.PM.Map(map); map.pm.setGlobalOptions({}); }

      return new Promise(resolve => {
        let created = false;
        // ⚠ ต้องดัก pm:drawend ด้วย — ลบจุดจนหมดหรือกด Esc, Geoman ปิดโหมดวาดเองโดยไม่ยิง pm:create
        //    ถ้าไม่ดัก Promise นี้ค้างตลอดไป แถบเครื่องมือจะติดสถานะ "กำลังวาด"
        const ended = () => {
          map.off('pm:create', done); map.off('pm:drawend', ended);
          document.removeEventListener('keydown', onKey);
          drawing = false;
          fireDraw();
          if (!created) resolve({ ok: false, cancelled: true });
        };
        const onKey = ev => {
          if (ev.key === 'Backspace' || ev.key === 'Delete') { ev.preventDefault(); api.undoVertex(); }
          else if (ev.key === 'Escape') { ev.preventDefault(); api.cancelDraw(); }
        };
        const done = e => {
          created = true;
          const gj = e.layer.toGeoJSON();
          map.removeLayer(e.layer);                 // เอารูปชั่วคราวของ Geoman ออก
          map.pm.disableDraw();
          pushHistory();
          zones.layer.addData({ type: 'Feature',
            properties: { zone_id, zone_name: name || zone_id, zone_name_en: name || zone_id,
                          color: color || '#0ea5e9', province: province || 'Bangkok Metropolis', districts: [] },
            geometry: gj.geometry });
          dirty = true;
          if (on) { api.disable(); api.enable(); }
          rebindPick();
          resolve({ ok: true });
        };
        map.on('pm:create', done);
        map.on('pm:drawend', ended);
        document.addEventListener('keydown', onKey);
        drawing = true;
        fireDraw();
        map.pm.enableDraw('Polygon', { snappable: true, snapDistance: 15, finishOn: 'dblclick' });
        console.log('[zone-editor] คลิกวางจุดรอบพื้นที่ · ดับเบิลคลิกเพื่อจบรูป · Backspace ย้อนจุด · Esc ยกเลิก');
      });
    },

    /** เซฟเป็น "ฉบับร่าง" — ยังไม่มีผลกับ TC/ผู้บริหารจนมีคนกดอนุมัติ */
    async saveDraft() {
      const gj = api.toGeoJSON();
      const s = statsOf(gj);
      if (s.overVertices || s.overKb)
        return { ok: false, error: `เกินเพดาน (${s.vertices} จุด · ${s.kb} KB) — กด "หมุดห่าง" ลดจุดก่อน` };
      const r = await saveZoneDraft(gj);
      if (r.ok) dirty = false;
      return r;
    },

    /** เซฟแล้วมีผลทันที (ข้ามขั้นอนุมัติ) */
    async publish() {
      const gj = api.toGeoJSON();
      const s = statsOf(gj);
      if (s.overVertices || s.overKb)
        return { ok: false, error: `เกินเพดาน (${s.vertices} จุด · ${s.kb} KB) — กด "หมุดห่าง" ลดจุดก่อน` };
      // ผ่าน zone-registry เพื่อให้แคชกลางกับหน้าอื่น (หน้ามอบหมาย · เมนู TC รายโซน) อัปเดตพร้อมกัน
      const r = await saveZoneRegistry(gj);
      if (r.ok) { dirty = false; console.log('[zone-editor] เซฟขึ้นเซิร์ฟเวอร์แล้ว', r); }
      return r;
    },

    revert() {
      reload(snapshot);
      history.length = 0;
      future.length = 0;
      dirty = false;
      console.log('[zone-editor] ย้อนกลับเป็นรูปตอนเปิดหน้าแล้ว');
      return api;
    },
  };

  return api;
}

/* ── แผงปุ่มบนแมพ — ไม่ต้องแตะ console ───────────────────────────────────── */

const PANEL_CSS = `
/* มุมขวาล่าง · เว้น 30px ให้แถบเครดิต Leaflet ไม่โดนทับ (แถวชิปหมวดหมู่กินมุมขวาบนอยู่) */
.zed{position:absolute;bottom:30px;right:12px;z-index:1200;background:#fff;border:1px solid #d4d8de;
  border-radius:10px;padding:10px;font:13px/1.45 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.18);width:196px}
.zed b{display:block;font-size:12px;color:#5b6472;letter-spacing:.02em}
.zed .zed-head{display:flex;align-items:center;gap:6px;margin-bottom:7px}
.zed .zed-head b{flex:1;margin:0}
.zed .zed-min{width:22px;height:22px;margin:0;padding:0;flex:none;line-height:1;text-align:center;font-size:13px}
/* ย่อแล้วเหลือแค่หัวแผง — ไม่บังมุมแมพตอนไม่ได้ใช้ (แอดมินเห็นแผงนี้ทุกครั้ง) */
.zed.min{width:auto}
.zed.min .zed-body{display:none}
.zed.min .zed-head{margin-bottom:0}
.zed button{display:block;width:100%;margin:4px 0;padding:7px 9px;border:1px solid #d4d8de;border-radius:7px;
  background:#f7f8fa;cursor:pointer;font:inherit;text-align:left}
.zed button:hover:not(:disabled){background:#eef1f5}
.zed button:disabled{opacity:.45;cursor:default}
.zed .zed-go{background:#0b7a3b;border-color:#0b7a3b;color:#fff;font-weight:600}
.zed .zed-go:hover:not(:disabled){background:#0a6b34}
.zed .zed-save{background:#1552b0;border-color:#1552b0;color:#fff;font-weight:600}
.zed .zed-save:hover:not(:disabled){background:#12489a}
.zed .zed-info{font-size:11.5px;color:#5b6472;margin-top:7px;border-top:1px solid #e6e9ee;padding-top:7px}
.zed .zed-row{display:flex;gap:4px}
.zed .zed-row button{margin:4px 0}
/* ── จัดการโซน ── */
.zed .zed-sec{margin-top:9px;padding-top:8px;border-top:1px solid #e6e9ee;font-size:11.5px;font-weight:700;color:#5b6472}
.zed .zed-z{display:flex;align-items:center;gap:5px;margin:4px 0}
.zed .zed-z i{width:10px;height:10px;border-radius:999px;flex:none}
.zed .zed-z .zed-zn{flex:1;min-width:0;border:1px solid #d4d8de;border-radius:6px;padding:3px 5px;font:inherit;font-size:12px}
.zed .zed-z input[type=color]{width:22px;height:22px;padding:0;border:1px solid #d4d8de;border-radius:5px;background:none;cursor:pointer;flex:none}
.zed .zed-z button{width:22px;height:22px;margin:0;padding:0;text-align:center;line-height:1;flex:none;color:#b91c1c}
.zed .zed-add,.zed .zed-merge{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.zed .zed-add input{flex:1;min-width:52px;border:1px solid #d4d8de;border-radius:6px;padding:4px 6px;font:inherit;font-size:12px}
.zed .zed-add button,.zed .zed-merge button{margin:0}
.zed .zed-merge{flex-direction:column}
.zed .zed-merge button{width:100%}
.zed .zed-picked{width:100%;font-size:11.5px;color:#5b6472;line-height:1.35}
.zed .zed-picked b{color:#0b1220}
.zed .zed-pick-on{background:#0b7a3b!important;border-color:#0b7a3b!important;color:#fff!important;font-weight:600}
.zed .zed-draft{font-size:11.5px;line-height:1.4;margin-top:5px}
.zed .zed-draft.on{background:#fff7ed;border:1px solid #fdba74;border-radius:7px;padding:6px 7px;color:#7c2d12}
.zed .zed-draft button{margin:4px 2px 0 0;padding:4px 8px;display:inline-block;width:auto}
.zed .zed-hist{font-size:11.5px;color:#5b6472;max-height:104px;overflow-y:auto;line-height:1.5}
.zed .zed-hist .zed-hrow{display:flex;align-items:center;gap:5px;margin:2px 0}
.zed .zed-hist .zed-hrow span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.zed .zed-hist .zed-hrow button{margin:0;padding:2px 7px;width:auto;flex:none}
.zed .zed-auth{display:flex;gap:4px;margin-top:5px}
.zed .zed-auth input{flex:1;min-width:0;border:1px solid #d4d8de;border-radius:6px;padding:4px 6px;font:inherit;font-size:12px}
.zed .zed-auth button{margin:0;width:auto;flex:none}`;

function buildPanel(map, ed, collapsed) {
  if (!document.getElementById('zed-style')) {
    const st = document.createElement('style');
    st.id = 'zed-style'; st.textContent = PANEL_CSS;
    document.head.appendChild(st);
  }
  const L = window.L;
  const box = L.DomUtil.create('div', 'zed');
  box.innerHTML = `<div class="zed-head"><b>แก้ขอบโซน</b><button class="zed-min" data-a="min" title="ย่อ/ขยายแผง">▾</button></div>
    <div class="zed-body">
    <button class="zed-go" data-a="toggle">เปิดโหมดลากขอบ</button>
    <div class="zed-row">
      <button data-a="thin" data-m="100">หมุดห่าง 100 ม.</button>
      <button data-a="thin" data-m="200">200 ม.</button>
    </div>
    <div class="zed-row">
      <button data-a="undo">ย้อน 1 ขั้น</button>
      <button data-a="redo">ทำซ้ำ</button>
    </div>
    <button data-a="revert">ย้อนทั้งหมด</button>
    <button class="zed-save" data-a="draft">เซฟเป็นฉบับร่าง</button>
    <button class="zed-go" data-a="publish">ใช้จริงทันที (ข้ามการตรวจ)</button>
    <button data-a="save">เซฟเป็นไฟล์ (สำรอง)</button>
    <div class="zed-info"></div>
    <div class="zed-draft"></div>
    <div class="zed-sec">จัดการโซน</div>
    <div class="zed-zones"></div>
    <div class="zed-add">
      <input class="zed-id" placeholder="รหัส เช่น RM" maxlength="12"/>
      <input class="zed-nm" placeholder="ชื่อโซน"/>
      <button data-a="add">+ เพิ่มโซน (วาดรูปใหม่)</button>
    </div>
    <div class="zed-merge">
      <button data-a="pick">เลือกโซนบนแมพ</button>
      <div class="zed-picked">คลิกที่โซนบนแมพเพื่อเลือก (เลือกได้หลายโซน)</div>
      <button data-a="merge">รวมโซนที่เลือก</button>
    </div>
    <div class="zed-sec">ประวัติ · ย้อนกลับ</div>
    <div class="zed-hist">—</div>
    <button data-a="hist">โหลดประวัติ</button>
    <div class="zed-sec">รหัสผู้ดูแล</div>
    <div class="zed-auth">
      <input class="zed-tok" type="password" placeholder="ใส่รหัสถ้าเซิร์ฟเวอร์ตั้งไว้"/>
      <button data-a="tok">จำไว้</button>
    </div>
    </div>`;

  // กันคลิก/สกรอลล์บนแผงไปโดนแมพ (ไม่งั้นกดปุ่มแล้วแมพเลื่อนตาม)
  L.DomEvent.disableClickPropagation(box);
  L.DomEvent.disableScrollPropagation(box);

  const info = box.querySelector('.zed-info');
  const btn = a => box.querySelector(`[data-a="${a}"]`);
  const zonesBox = box.querySelector('.zed-zones');
  const pickedBox = box.querySelector('.zed-picked');

  /* สรุปโซนที่คลิกเลือกไว้ + สถานะปุ่มรวม — เรียกทั้งจาก refresh() และจากการคลิกบนแมพ */
  const renderPicked = () => {
    const ids = ed.picked(), list = ed.zones();
    const nameOf = id => (list.find(z=>z.zone_id===id)||{}).name || id;
    btn('pick').textContent = ed.isPicking() ? 'เสร็จแล้ว (ออกจากโหมดเลือก)' : 'เลือกโซนบนแมพ';
    btn('pick').classList.toggle('zed-pick-on', ed.isPicking());
    btn('merge').disabled = ids.length < 2;
    pickedBox.innerHTML = !ed.isPicking()
      ? 'กดปุ่มด้านบน แล้วคลิกที่โซนบนแมพเพื่อเลือก'
      : ids.length === 0 ? 'คลิกที่โซนบนแมพ — เลือกได้หลายโซน'
      : `เลือกไว้: <b>${ids.map(nameOf).join(' + ')}</b><br/>` +
        (ids.length < 2 ? 'เลือกอีกอย่างน้อย 1 โซน'
                        : `กดรวมแล้วจะเหลือชื่อ <b>${nameOf(ids[0])}</b> (โซนที่คลิกก่อน)`);
  };
  ed.setPickHandler(renderPicked);   // คลิกบนแมพไม่ผ่านปุ่ม จึงต้องให้ตัว editor เรียกกลับมา

  const draftBox = box.querySelector('.zed-draft');
  const histBox  = box.querySelector('.zed-hist');

  /* แถบแจ้งว่ามีฉบับร่างค้างรออนุมัติ + ปุ่มอนุมัติ/ทิ้ง */
  async function renderDraft() {
    const d = await loadZoneDraft();
    draftBox.className = 'zed-draft' + (d ? ' on' : '');
    if (!d) { draftBox.textContent = ''; return; }
    const ids = d.features.map(f => f.properties.zone_id);
    draftBox.innerHTML = `มีฉบับร่างรออนุมัติ · ${d.features.length} โซน (${ids.join(' · ')})
      <div><button data-d="approve">อนุมัติให้มีผลจริง</button><button data-d="discard">ทิ้งร่าง</button></div>`;
    draftBox.querySelector('[data-d="approve"]').onclick = async ev => {
      ev.target.disabled = true;
      const r = await approveZoneDraft();
      info.textContent = r.ok ? 'อนุมัติแล้ว — ทุกคนเห็นเส้นใหม่เมื่อรีเฟรช' : 'อนุมัติไม่สำเร็จ: ' + r.error;
      await renderDraft(); await renderHistory();
    };
    draftBox.querySelector('[data-d="discard"]').onclick = async ev => {
      if (!confirm('ทิ้งฉบับร่างนี้?')) return;
      ev.target.disabled = true;
      const r = await discardZoneDraft();
      info.textContent = r.ok ? 'ทิ้งร่างแล้ว' : 'ทิ้งไม่สำเร็จ: ' + r.error;
      await renderDraft();
    };
  }

  /* ประวัติฉบับที่เคยมีผลจริง + ปุ่มย้อนกลับทีละฉบับ */
  async function renderHistory() {
    const vs = await listZoneVersions();
    if (!vs.length) { histBox.textContent = 'ยังไม่มีประวัติ (ประวัติเกิดขึ้นเมื่อมีการเซฟใช้จริงครั้งแรก)'; return; }
    histBox.innerHTML = '';
    for (const v of vs.slice(0, 20)) {
      const when = v.version.replace(/T/, ' ').replace(/-(\d\d)-(\d\d)-(\d\d\d)Z$/, ':$1:$2');
      const row = document.createElement('div');
      row.className = 'zed-hrow';
      row.innerHTML = `<span title="${v.version}">${when}</span><button>ย้อนกลับ</button>`;
      row.querySelector('button').onclick = async ev => {
        if (!confirm(`ย้อนกลับไปใช้ฉบับ ${when}?\nฉบับปัจจุบันจะถูกเก็บเข้าประวัติ ไม่หายไป`)) return;
        ev.target.disabled = true;
        const r = await restoreZoneVersion(v.version);
        info.textContent = r.ok ? `ย้อนกลับแล้ว — รีเฟรชเพื่อดูผล` : 'ย้อนไม่สำเร็จ: ' + r.error;
        await renderHistory();
      };
      histBox.appendChild(row);
    }
  }

  /* แถวจัดการโซน: สี · ชื่อ (แก้ได้) · ลบ — สร้างใหม่ทุกครั้งที่รายการเปลี่ยน */
  const renderZones = () => {
    const list = ed.zones();
    zonesBox.innerHTML = '';
    for (const z of list) {
      const row = document.createElement('div');
      row.className = 'zed-z';
      row.innerHTML = `<i style="background:${z.color}"></i>
        <input class="zed-zn" value="${(z.name||'').replace(/"/g,'&quot;')}" title="${z.zone_id} · ${z.vertices} หมุด"/>
        <input type="color" value="${z.color||'#0ea5e9'}"/>
        <button title="ลบโซน ${z.zone_id}">✕</button>`;
      const [name, color, del] = [row.querySelector('.zed-zn'), row.querySelector('input[type=color]'), row.querySelector('button')];
      name.onchange  = () => { const r = ed.rename(z.zone_id, name.value); if(!r.ok) info.textContent = r.error; refresh(); };
      color.onchange = () => { const r = ed.recolor(z.zone_id, color.value); if(!r.ok) info.textContent = r.error; refresh(); };
      del.onclick    = () => { if(!confirm(`ลบโซน ${z.name} (${z.zone_id})?\nลูกค้าในโซนนี้จะกลายเป็นไม่มีโซน`)) return;
                               const r = ed.remove(z.zone_id); info.textContent = r.ok ? `ลบ ${z.zone_id} แล้ว — ยังไม่ได้เซฟ` : r.error; refresh(); };
      zonesBox.appendChild(row);
    }
  };

  const refresh = () => {
    const s = statsOf(ed.toGeoJSON());
    btn('toggle').textContent = ed.isEnabled() ? 'ปิดโหมดลากขอบ' : 'เปิดโหมดลากขอบ';
    btn('undo').disabled = ed.undoDepth() === 0;
    btn('undo').textContent = `ย้อน 1 ขั้น${ed.undoDepth() ? ` (${ed.undoDepth()})` : ''}`;
    btn('redo').disabled = ed.redoDepth() === 0;
    btn('redo').textContent = `ทำซ้ำ${ed.redoDepth() ? ` (${ed.redoDepth()})` : ''}`;
    info.textContent = `${ed.zones().length} โซน · ${s.vertices} หมุด · ${s.kb} KB` + (ed.isDirty() ? ' · ยังไม่ได้เซฟ' : '');
    renderZones();
    renderPicked();
  };

  box.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    const a = b.dataset.a;
    b.disabled = true;
    try {
      if (a === 'min') { box.classList.toggle('min');
        b.textContent = box.classList.contains('min') ? '▸' : '▾';
        b.disabled = false; return; }
      else if (a === 'toggle') ed.isEnabled() ? ed.disable() : await ed.enable();
      else if (a === 'thin') { if (!ed.isEnabled()) await ed.enable(); ed.thin(+b.dataset.m); }
      else if (a === 'undo') ed.undo();
      else if (a === 'redo') ed.redo();
      else if (a === 'revert') ed.revert();
      else if (a === 'add') {
        const id = box.querySelector('.zed-id').value.trim().toUpperCase();
        const nm = box.querySelector('.zed-nm').value.trim();
        info.textContent = 'คลิกวางจุดรอบพื้นที่ · ดับเบิลคลิกเพื่อจบรูป';
        const used = ed.zones().map(z=>z.color);
        const r = await ed.addByDraw({ zone_id:id, name:nm || id, color:nextColor(used) });
        if (r.ok) { box.querySelector('.zed-id').value=''; box.querySelector('.zed-nm').value='';
                    info.textContent = `เพิ่มโซน ${id} แล้ว — ยังไม่ได้เซฟ`; }
        else info.textContent = r.error;
        b.disabled = false; refresh(); return;
      }
      else if (a === 'pick') { ed.setPickMode(!ed.isPicking()); b.disabled = false; refresh(); return; }
      else if (a === 'merge') {
        const ids = ed.picked();
        const r = await ed.merge(ids);
        info.textContent = r.ok ? `รวม ${ids.length} โซนแล้ว (เหลือ ${r.kept}) · ${r.note}` : r.error;
        b.disabled = false; refresh(); return;
      }
      else if (a === 'save') ed.download();
      else if (a === 'draft') {
        info.textContent = 'กำลังเซฟฉบับร่าง…';
        const r = await ed.saveDraft();
        info.textContent = r.ok
          ? `เซฟร่างแล้ว ${(r.zones||[]).join(" · ")} · ${r.kb} KB — ยังไม่มีผลกับ TC จนกดอนุมัติ`
          : 'เซฟร่างไม่สำเร็จ: ' + r.error;
        b.disabled = false; await renderDraft(); return;
      }
      else if (a === 'publish') {
        if (!confirm('ใช้จริงทันทีโดยไม่ผ่านการตรวจ?\nTC และผู้บริหารจะเห็นเส้นใหม่ทันทีที่รีเฟรช')) { b.disabled = false; return; }
        info.textContent = 'กำลังเซฟ…';
        const r = await ed.publish();
        info.textContent = r.ok
          ? `ใช้จริงแล้ว ${(r.zones||[]).join(" · ")} · ${r.kb} KB` + (r.archived ? ' · ฉบับเดิมเก็บเข้าประวัติแล้ว' : '')
          : 'เซฟไม่สำเร็จ: ' + r.error;
        b.disabled = false; await renderDraft(); return;   // ข้าม refresh() ไม่งั้นข้อความผลลัพธ์ถูกเขียนทับ
      }
      else if (a === 'hist') { await renderHistory(); b.disabled = false; return; }
      else if (a === 'tok') {
        const v = box.querySelector('.zed-tok').value.trim();
        setAdminToken(v);
        info.textContent = v ? 'จำรหัสไว้ในแท็บนี้แล้ว' : 'ล้างรหัสแล้ว';
        b.disabled = false; return;
      }
    } catch (err) {
      console.error(err);
      info.textContent = 'ผิดพลาด: ' + err.message;
    }
    b.disabled = false;
    refresh();
  });

  map.getContainer().appendChild(box);
  box.querySelector('.zed-tok').value = adminToken();   // จำรหัสไว้ต่อแท็บ
  if (collapsed) { box.classList.add('min'); box.querySelector('.zed-min').textContent = '▸'; }
  refresh();
  renderDraft();                                        // มีร่างค้างอยู่ให้เห็นทันทีที่เปิดแผง
  return { el: box, refresh, destroy(){ box.remove(); } };
}

/**
 * ต่อเข้า lmap.js: เรียกหลังสร้าง zone layer เสร็จ
 * เปิดเมื่อ: ผู้ใช้เป็นแอดมิน (opts.allow) หรือใส่ ?edit=1 มาเอง
 * เดิมเปิดเฉพาะ ?edit=1 ซึ่งหลุดง่าย — สลับบทบาทหรือเปิดแท็บใหม่แล้วแผงหายไปเลย
 */
export function mountZoneEditor(map, zones, opts = {}) {
  const byUrl = typeof location !== 'undefined' && /[?&]edit=1/.test(location.search);
  if (!opts.allow && !byUrl) return null;
  const ed = createZoneEditor(map, zones);
  if (typeof window !== 'undefined') window.E = ed;
  // opts.panel === false = UI อยู่ที่อื่น (แถบเครื่องมือด้านบนใน stage.js) ไม่ต้องสร้างกล่องลอย
  if (opts.panel !== false) {
    try { ed.panel = buildPanel(map, ed, !byUrl); }
    catch (e) { console.warn('[zone-editor] สร้างแผงปุ่มไม่ได้ ใช้ console แทน', e); }
  }
  console.log('[zone-editor] พร้อมแล้ว (เรียก E.* จาก console ได้)');
  return ed;
}
