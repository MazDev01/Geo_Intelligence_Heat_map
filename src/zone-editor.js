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

  const markDirty = () => { dirty = true; };
  const EVENTS = ['pm:edit', 'pm:markerdragend', 'pm:vertexadded', 'pm:vertexremoved', 'pm:cut'];

  // ประวัติสำหรับ undo — เก็บ "ก่อนแก้" ทุกครั้งที่เริ่มลาก/เพิ่ม/ลบจุด
  // จำกัด 40 ขั้น กันกินหน่วยความจำ (แต่ละขั้นคือ FeatureCollection เต็ม)
  const history = [];
  const pushHistory = () => {
    history.push(clone(zones.layer.toGeoJSON()));
    if (history.length > 40) history.shift();
  };
  const BEFORE = ['pm:markerdragstart', 'pm:vertexadded', 'pm:vertexremoved'];

  /** โหลด geojson กลับเข้า layer แล้วเปิดโหมดแก้ไขต่อถ้าเปิดอยู่ */
  function reload(gj) {
    const wasOn = on;
    api.disable();
    zones.layer.clearLayers();
    zones.layer.addData(clone(gj));
    if (wasOn) api.enable();
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
      if (pane) pane.style.pointerEvents = prevPointerEvents ?? '';
      on = false;
      return api;
    },

    isEnabled: () => on,
    isDirty: () => dirty,

    /** ย้อน 1 ขั้น — ลากพลาดกดอันนี้ ไม่ต้อง revert ทั้งหมด */
    undo() {
      if (!history.length) { console.log('[zone-editor] ไม่มีอะไรให้ย้อนแล้ว'); return api; }
      reload(history.pop());
      console.log(`[zone-editor] ย้อน 1 ขั้น — เหลือย้อนได้อีก ${history.length} ครั้ง`);
      return api;
    },
    undoDepth: () => history.length,

    /**
     * ลดจุดให้เหลือ ~percent% ของปัจจุบัน — หมุดจะห่างขึ้น ลากง่ายขึ้น
     * ทดสอบแล้วว่าลดถึง 8% ยังไม่มีลูกค้าข้ามโซนสักราย (flip = 0)
     */
    /**
     * เหลือเฉพาะหมุดที่จำเป็น — บังคับระยะห่างขั้นต่ำเป็นเมตร
     * ใช้ตัวนี้แทน simplify() เวลาหมุดถี่จนลากไม่ไหว (แถวแม่น้ำ)
     */
    thin(meters = 300) {
      pushHistory();
      const r = coarsen(zones.layer.toGeoJSON(), meters);
      reload(r.geojson);
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

    /** เซฟขึ้นเซิร์ฟเวอร์ — ทุกคนเห็นเส้นใหม่ทันทีที่รีเฟรช (ไม่ต้องหอบไฟล์ไปวางเอง) */
    async publish() {
      const gj = api.toGeoJSON();
      const s = statsOf(gj);
      if (s.overVertices || s.overKb)
        return { ok: false, error: `เกินเพดาน (${s.vertices} จุด · ${s.kb} KB) — กด "หมุดห่าง" ลดจุดก่อน` };
      try {
        const r = await fetch('/api/zones', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(gj),
        });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) return { ok: false, error: body.message || body.error || ('HTTP ' + r.status) };
        dirty = false;
        console.log('[zone-editor] เซฟขึ้นเซิร์ฟเวอร์แล้ว', body);
        return { ok: true, ...body };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },

    revert() {
      reload(snapshot);
      history.length = 0;
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
.zed b{display:block;font-size:12px;color:#5b6472;margin-bottom:7px;letter-spacing:.02em}
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
.zed .zed-row button{margin:4px 0}`;

function buildPanel(map, ed) {
  if (!document.getElementById('zed-style')) {
    const st = document.createElement('style');
    st.id = 'zed-style'; st.textContent = PANEL_CSS;
    document.head.appendChild(st);
  }
  const L = window.L;
  const box = L.DomUtil.create('div', 'zed');
  box.innerHTML = `<b>แก้ขอบโซน</b>
    <button class="zed-go" data-a="toggle">เปิดโหมดลากขอบ</button>
    <div class="zed-row">
      <button data-a="thin" data-m="100">หมุดห่าง 100 ม.</button>
      <button data-a="thin" data-m="200">200 ม.</button>
    </div>
    <button data-a="undo">ย้อน 1 ขั้น</button>
    <button data-a="revert">ย้อนทั้งหมด</button>
    <button class="zed-save" data-a="publish">เซฟขึ้นเซิร์ฟเวอร์</button>
    <button data-a="save">เซฟเป็นไฟล์ (สำรอง)</button>
    <div class="zed-info"></div>`;

  // กันคลิก/สกรอลล์บนแผงไปโดนแมพ (ไม่งั้นกดปุ่มแล้วแมพเลื่อนตาม)
  L.DomEvent.disableClickPropagation(box);
  L.DomEvent.disableScrollPropagation(box);

  const info = box.querySelector('.zed-info');
  const btn = a => box.querySelector(`[data-a="${a}"]`);
  const refresh = () => {
    const s = statsOf(ed.toGeoJSON());
    btn('toggle').textContent = ed.isEnabled() ? 'ปิดโหมดลากขอบ' : 'เปิดโหมดลากขอบ';
    btn('undo').disabled = ed.undoDepth() === 0;
    btn('undo').textContent = `ย้อน 1 ขั้น${ed.undoDepth() ? ` (${ed.undoDepth()})` : ''}`;
    info.textContent = `${s.vertices} หมุด · ${s.kb} KB` + (ed.isDirty() ? ' · ยังไม่ได้เซฟ' : '');
  };

  box.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    const a = b.dataset.a;
    b.disabled = true;
    try {
      if (a === 'toggle') ed.isEnabled() ? ed.disable() : await ed.enable();
      else if (a === 'thin') { if (!ed.isEnabled()) await ed.enable(); ed.thin(+b.dataset.m); }
      else if (a === 'undo') ed.undo();
      else if (a === 'revert') ed.revert();
      else if (a === 'save') ed.download();
      else if (a === 'publish') {
        info.textContent = 'กำลังเซฟ…';
        const r = await ed.publish();
        info.textContent = r.ok
          ? `เซฟแล้ว ${(r.zones||[]).join(" · ")} · ${r.kb} KB — รีเฟรชแล้วทุกคนเห็นเส้นใหม่`
          : 'เซฟไม่สำเร็จ: ' + r.error;
        b.disabled = false;
        return;                       // ข้าม refresh() ไม่งั้นข้อความผลลัพธ์จะถูกเขียนทับทันที
      }
    } catch (err) {
      console.error(err);
      info.textContent = 'ผิดพลาด: ' + err.message;
    }
    b.disabled = false;
    refresh();
  });

  map.getContainer().appendChild(box);
  refresh();
  return { el: box, refresh, destroy(){ box.remove(); } };
}

/** ต่อเข้า lmap.js: เรียกหลังสร้าง zone layer เสร็จ — เปิดเฉพาะ ?edit=1 */
export function mountZoneEditor(map, zones) {
  if (typeof location === 'undefined' || !/[?&]edit=1/.test(location.search)) return null;
  const ed = createZoneEditor(map, zones);
  if (typeof window !== 'undefined') window.E = ed;
  try { ed.panel = buildPanel(map, ed); }
  catch (e) { console.warn('[zone-editor] สร้างแผงปุ่มไม่ได้ ใช้ console แทน', e); }
  console.log('[zone-editor] พร้อมแล้ว — ใช้แผงปุ่มมุมขวาบนของแมพ (หรือพิมพ์ E.enable() ก็ได้)');
  return ed;
}
