// zone-layer.js (v2)
// แก้ครบ 5 ข้อ: 1) ไม่ใช้ outlinePane (pointer-events:none)  2) z-index เหนือ heat
// 3) ไม่ import ไฟล์เอง  4) bubblingMouseEvents แทน L.DomEvent.stop(e)  5) ไม่ export ชื่อสามัญ
//
// ⚠ ปรับจากต้นฉบับ 1 จุดให้เข้ากับโปรเจกต์นี้: label เป็น getter ที่เรียก t()
//   ทั้งแอปสลับ TH/EN ได้แล้ว ถ้าปล่อย label เป็นสตริงไทยตายตัว ชื่อโซนจะเป็นจุดเดียวที่ไม่แปล
//   (คงชื่อ property ว่า `label` และไม่ export zoneName ตามเดิม — เทสต์เดิมยังผ่าน)
import { t, isEN } from "./i18n.js";

/** property ชื่อ `label` (ไม่ใช่ `name`) กันชนกับ zoneName() ใน geoData.js */
export const ZONE_META = {
  SL: { get label(){ return t("สีลม","Silom"); },      color: '#ec4899' },
  LP: { get label(){ return t("ลาดพร้าว","Lat Phrao"); }, color: '#f97316' },
  TL: { get label(){ return t("ทองหล่อ","Thonglor"); },   color: '#7c3aed' },
};

const DEFAULTS = {
  paneName: 'zonePane',
  zIndex: 420,                  // > heat, < labelPane(450)/markerPane(600)
  padding: 0.3,                 // อย่าใช้ 1.5 (พื้นที่พิกเซล 16 เท่า)
  interactive: false,           // default: ไม่แย่งคลิกจากหมุด/จังหวัด
  mustBeAbove: ['overlayPane'], // pane ที่ heat อยู่ — แก้ให้ตรงของจริง
  mustBeBelow: ['markerPane'],
};

export function createZoneLayer(map, geojson, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const meta = opts.meta ?? ZONE_META;
  const onPick = opts.onPick ?? null;
  const debug = opts.debug ?? false;

  let activeId = null;
  let interactive = !!o.interactive;

  let pane = map.getPane(o.paneName);
  if (!pane) pane = map.createPane(o.paneName);
  pane.style.zIndex = String(o.zIndex);
  pane.style.pointerEvents = interactive ? 'auto' : 'none';

  const renderer = L.canvas({ padding: o.padding, pane: o.paneName });

  // สี/ชื่อมาจาก properties ของ feature ก่อน (ทะเบียนโซน — ดู zone-registry.js)
  // meta ที่ส่งเข้ามาหรือ ZONE_META เป็นแค่ fallback ให้ไฟล์รุ่นเก่าที่ยังไม่มีฟิลด์ color
  const metaOf = f => {
    const p = f.properties || {};
    const fb = meta[p.zone_id] ?? {};
    return { color: p.color || fb.color || '#64748b',
             label: p.zone_name ? (isEN() ? (p.zone_name_en || p.zone_name) : p.zone_name)
                                : (fb.label ?? p.zone_id) };
  };
  const styleOf = (f, state) => {
    const m = metaOf(f);
    const on = f.properties.zone_id === activeId;
    return {
      color: m.color,
      weight: on ? 3 : state === 'hover' ? 2.5 : 1.5,
      opacity: 0.95,
      fillColor: m.color,
      fillOpacity: on ? 0.28 : state === 'hover' ? 0.24 : 0.14,
    };
  };

  const layer = L.geoJSON(geojson, {
    pane: o.paneName,
    renderer,
    bubblingMouseEvents: false,   // กัน click ทะลุไปโดน polygon จังหวัดข้างล่าง
    style: f => styleOf(f, 'idle'),
    onEachFeature: (f, l) => {
      l.options.bubblingMouseEvents = false;
      l.on('mouseover', () => interactive && l.setStyle(styleOf(f, 'hover')));
      l.on('mouseout',  () => interactive && l.setStyle(styleOf(f, 'idle')));
      l.on('click', e => {
        if (!interactive) return;
        if (e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
        onPick?.(f.properties.zone_id, f.properties);
      });
    },
  });

  function selfCheck({ silent = false } = {}) {
    const problems = [];
    const css = el => (typeof window !== 'undefined' && window.getComputedStyle)
      ? window.getComputedStyle(el) : el.style;
    const zOf = n => {
      const el = map.getPane(n);
      if (!el) return { missing: true };
      const raw = css(el).zIndex;
      const z = parseInt(raw, 10);
      return Number.isNaN(z) ? { unreadable: raw || 'auto' } : { z };
    };
    const me = zOf(o.paneName);
    const mine = me.z;

    if (me.missing)    problems.push(`ไม่มี pane "${o.paneName}"`);
    if (me.unreadable) problems.push(`อ่าน z-index ของ ${o.paneName} ไม่ได้ (= ${me.unreadable})`);

    const cmp = (n, dir) => {
      const r = zOf(n);
      if (r.missing)    return problems.push(`ไม่มี pane "${n}" — ตรวจลำดับกับมันไม่ได้`);
      if (r.unreadable) return problems.push(
        `อ่าน z-index ของ ${n} ไม่ได้ (= ${r.unreadable}) — leaflet.css ถูกโหลดหรือยัง?`);
      if (mine == null) return;
      if (dir === 'above' && mine <= r.z)
        problems.push(`z-index ต่ำไป: ${o.paneName}=${mine} ต้อง > ${n}=${r.z} (โซนจะถูก heat ทับ)`);
      if (dir === 'below' && mine >= r.z)
        problems.push(`z-index สูงไป: ${o.paneName}=${mine} ต้อง < ${n}=${r.z} (โซนจะบังหมุด)`);
    };
    o.mustBeAbove.forEach(n => cmp(n, 'above'));
    o.mustBeBelow.forEach(n => cmp(n, 'below'));

    const pe = css(map.getPane(o.paneName)).pointerEvents;
    const want = interactive ? 'auto' : 'none';
    if (pe !== want)
      problems.push(`pointer-events = "${pe}" แต่ควรเป็น "${want}" (มี CSS ทับอยู่)`);

    if (!map.getPane(o.paneName).querySelector('canvas'))
      problems.push('ยังไม่มี canvas ใน pane — layer ยังไม่ถูก addTo(map)?');

    const nFeat = layer.getLayers().length;
    if (nFeat === 0) problems.push('layer ว่าง — geojson ไม่มี feature');

    if (!silent) {
      console.table(Object.entries(map.getPanes()).map(([name, el]) => ({
        pane: name,
        z: css(el).zIndex,
        pointerEvents: css(el).pointerEvents,
        canvases: el.querySelectorAll('canvas').length,
      })));
      problems.length
        ? problems.forEach(p => console.error('%c[zone-layer] ' + p,
            'background:#b91c1c;color:#fff;padding:2px 6px;border-radius:3px'))
        : console.log(`%c[zone-layer] ok — ${nFeat} โซน, z=${mine}, pointer-events=${pe}`,
            'color:#15803d');
    }
    return problems;
  }

  const api = {
    layer,
    renderer,
    paneName: o.paneName,

    addTo(m = map) {
      layer.addTo(m);
      if (debug) queueMicrotask(() => selfCheck());
      return api;
    },
    remove() { map.removeLayer(layer); return api; },

    setInteractive(v) {
      interactive = !!v;
      map.getPane(o.paneName).style.pointerEvents = interactive ? 'auto' : 'none';
      return api;
    },
    isInteractive: () => interactive,

    setActive(zoneId) {
      activeId = zoneId ?? null;
      layer.eachLayer(l => l.setStyle(styleOf(l.feature, 'idle')));
      return api;
    },
    getActive: () => activeId,

    setVisible(v) { v ? layer.addTo(map) : map.removeLayer(layer); return api; },

    flyTo(zoneId, o2 = {}) {
      // ตัวแปรนี้ห้ามชื่อ t — ไฟล์นี้ import t() ของ i18n มาแล้ว จะโดนบัง
      const target = layer.getLayers().find(l => l.feature.properties.zone_id === zoneId);
      if (target) map.flyToBounds(target.getBounds(), { padding: [40, 40], maxZoom: 13, ...o2 });
      return api;
    },

    list: () => layer.getLayers().map(l => {
      const p = l.feature.properties, m = metaOf(l.feature);
      return { zone_id: p.zone_id, label: m.label, color: m.color,
               province: p.province, n_areas: p.n_src };
    }),

    selfCheck,

    destroy() {
      map.removeLayer(layer);
      const el = map.getPane(o.paneName);
      if (el && el.parentNode) el.parentNode.removeChild(el);
      delete map._panes[o.paneName];
    },
  };
  return api;
}
