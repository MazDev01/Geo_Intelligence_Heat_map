// ─────────────────────────────────────────────────────────────────────────────
// ยาม perf ของแผนที่ — assert 3 ตัวเลขที่ระเบิดได้จริง
//
// โปรเจกต์นี้ buildless ไม่มี bundler จึงไม่มี import.meta.env.DEV
// เปิดใช้ด้วย query string แทน:  http://localhost:5173/?demo=tc&perf=1
// lmap.js จะ import ไฟล์นี้แบบ dynamic เฉพาะตอนมี ?perf=1 — โหมดปกติไม่โหลดไฟล์นี้เลย
//
// วิธีใช้: เปิดหน้าแผนที่ด้วย ?perf=1 → เปิด DevTools console → ลากแผนที่ → อ่านผล
//          เรียกซ้ำเองได้ที่ window.__mapPerf.canvasAudit()
// ─────────────────────────────────────────────────────────────────────────────

const BUDGET = {
  // 4 ผืน (landPane · maskPane · outlinePane · default renderer จาก preferCanvas)
  // เต็มจอ 1920×1080 ที่ padding ค่าตั้งต้น 0.1 ตกผืนละ ~43 MB → พื้นล่างราว 170 MB
  // ตั้ง 260 MB เป็นเพดาน: เกินกว่านี้แปลว่ามี padding ตัวไหนโป่งผิดปกติ
  canvasMB: 260,
  panRebuild: 0,        // add/remove layer ระหว่างลาก (ไม่เปลี่ยนตัวกรอง) ต้อง = 0
  blockedMsPerPan: 120,
};

export function installMapPerfGuard(map, {group, getGroup, budget = {}} = {}) {
  const B = {...BUDGET, ...budget};
  const fail = (k, got, want, hint) =>
    console.error(`%c[map-perf] ${k} = ${got}  (budget ${want})`,
      "background:#b91c1c;color:#fff;padding:2px 6px;border-radius:3px", hint);
  const pass = (k, got) => console.log(`%c[map-perf] ${k} = ${got}`, "color:#15803d", "ok");

  // ── 1. canvas backing store ────────────────────────────────────────────────
  // Leaflet: canvas = getSize() × (1+2·padding) ทั้งสองแกน แล้ว L.Canvas คูณ 2 อีกเมื่อ Browser.retina
  // (จอ scaling ≥125% ก็นับเป็น retina) → พื้นที่จริง = (1+2p)² × 4 เท่าของพิกเซลบนจอ
  function canvasAudit() {
    const rows = [...document.querySelectorAll(".leaflet-pane canvas")].map(c => ({
      pane: (c.parentElement?.className || "?").replace("leaflet-pane leaflet-", ""),
      px: `${c.width}×${c.height}`,
      MB: +(c.width * c.height * 4 / 1048576).toFixed(1),
    }));
    const total = +rows.reduce((s, r) => s + r.MB, 0).toFixed(1);
    console.table(rows);
    total > B.canvasMB
      ? fail("canvasMB", total, B.canvasMB, "ลด padding ของ L.canvas — padding p ⇒ พื้นที่ (1+2p)² เท่า")
      : pass("canvasMB", total);
    return total;
  }

  // ── 2. cluster rebuild ระหว่างลาก ─────────────────────────────────────────
  // ห่อทั้งฝั่งกลุ่มคลัสเตอร์ และฝั่ง map เอง — โค้ดนี้ "ทิ้งกลุ่มทั้งก้อนแล้วสร้างใหม่"
  // การห่อเฉพาะ instance เดียวจึงจับไม่ครบ ต้องตามด้วย map.addLayer/removeLayer ด้วย
  let adds = 0, removes = 0, arming = false;
  const WRAPPED = new WeakSet();
  const wrapGroup = g => {
    if (!g || WRAPPED.has(g)) return;
    WRAPPED.add(g);
    const bind = (name, add) => {
      const orig = g[name];
      if (!orig) return;
      g[name] = function (x) {
        if (arming) { const n = Array.isArray(x) ? x.length : 1; add(n); }
        return orig.apply(this, arguments);
      };
    };
    bind("addLayer",     n => (adds += n));
    bind("addLayers",    n => (adds += n));
    bind("removeLayer",  n => (removes += n));
    bind("removeLayers", n => (removes += n));
    const clear = g.clearLayers;
    if (clear) g.clearLayers = function () { if (arming) removes += 9999; return clear.apply(this, arguments); };
  };
  wrapGroup(group);

  // ทิ้ง/ใส่เลเยอร์ที่ตัว map — จับเคส "สร้าง markerClusterGroup ใหม่ทุก moveend"
  let groupChurn = 0;
  for (const [name, hit] of [["addLayer", 1], ["removeLayer", 1]]) {
    const orig = map[name];
    map[name] = function (layer) {
      if (arming && layer && layer._featureGroup) groupChurn += hit;   // _featureGroup = markerClusterGroup
      return orig.apply(this, arguments);
    };
  }

  // ── 3. main thread ถูกบล็อกต่อการลาก 1 ครั้ง ──────────────────────────────
  let blocked = 0;
  try {
    new PerformanceObserver(l => { for (const e of l.getEntries()) if (arming) blocked += e.duration; })
      .observe({entryTypes: ["longtask"]});
  } catch (e) {}

  map.on("movestart zoomstart", () => { adds = removes = blocked = groupChurn = 0; arming = true; });
  map.on("moveend zoomend", () => {
    setTimeout(() => {                       // เผื่อ debounce 80ms ของ build()
      arming = false;
      if (getGroup) wrapGroup(getGroup());   // กลุ่มถูกสร้างใหม่ก็ห่อตัวใหม่ต่อ
      const churn = adds + removes + groupChurn * 1000;
      churn > B.panRebuild
        ? fail("panRebuild", `+${adds}/-${removes}${groupChurn ? ` · group×${groupChurn}` : ""}`, B.panRebuild,
               "อย่าสร้าง markerClusterGroup ใหม่ใน moveend — markercluster คัดหมุดนอกจอเองอยู่แล้ว")
        : pass("panRebuild", 0);
      const ms = Math.round(blocked);
      ms > B.blockedMsPerPan
        ? fail("blockedMs", ms, B.blockedMsPerPan, "main thread ถูกบล็อก")
        : pass("blockedMs", ms);
    }, 200);
  });

  map.whenReady(() => setTimeout(canvasAudit, 300));
  window.__mapPerf = {canvasAudit, budget: B};
  console.log("%c[map-perf] guard armed — ลากแผนที่ดูผลได้เลย", "color:#2563eb");
}
