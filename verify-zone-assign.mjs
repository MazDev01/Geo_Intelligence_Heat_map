#!/usr/bin/env node
// ===========================================================================
// Gate ของ assignment (v2)
//
//   node verify-zone-assign.mjs <records.json> --province "Bangkok" \
//        [--display zones.geojson] [--assign zones.full.geojson]
//        [--baseline zone-baseline.json] [--margin-km 25]
//        [--resolver ./src/resolveZone.js] [--write-baseline]
//
// เปลี่ยนจาก v1:
//   * กรองจังหวัดก่อนเสมอ -> ไม่นับเชียงใหม่/ภูเก็ตปนเข้ามาเป็น false alarm
//   * เลิกบังคับ noZone === 0  (23/50 เขตอยู่นอกโซนโดยตั้งใจ)
//     -> เทียบ "รายเรกคอร์ด" กับ baseline เป็น: lost / gained / moved
//        (เทียบยอดรวมจะพลาดเคสสลับ 5 ออก 5 เข้า = net 0 แต่มีคนหลุดจริง)
//   * กรอบพิกัดคิดจาก bbox ของ zones.geojson + margin ไม่ hardcode
// ===========================================================================
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';

const argv = process.argv.slice(2);
const arg  = (k, d) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1]; };
const has  = k => argv.includes(k);

const SRC       = argv[0];
const PROVINCE  = arg('--province', null);
const DISPLAY   = arg('--display', 'data/zones.geojson');
const ASSIGN    = arg('--assign', null);
const BASEFILE  = arg('--baseline', 'zone-baseline.json');
const MARGIN_KM = Number(arg('--margin-km', 25));
const RESOLVER  = arg('--resolver', './src/resolveZone.js');
const WRITE     = has('--write-baseline');
const ACCEPT    = has('--accept-bad-coords');

const { createZoneResolver, districtLookup } =
  await import(pathToFileURL(resolvePath(process.cwd(), RESOLVER)).href);

let bad = 0;
const red  = (...a) => { bad++; console.error('\x1b[31m✗\x1b[0m', ...a); };
const ok   = (...a) => console.log('\x1b[32m✓\x1b[0m', ...a);
const note = (...a) => console.log('\x1b[33m!\x1b[0m', ...a);

for (const f of [SRC, DISPLAY]) if (!f || !existsSync(f)) {
  console.error(`ไม่พบไฟล์: ${f}`); process.exit(1);
}

// ---- โหลด + กรองจังหวัด ---------------------------------------------------
const raw = JSON.parse(readFileSync(SRC, 'utf8'));
const all = Array.isArray(raw) ? raw
          : raw.customers ?? raw.data ?? raw.records ?? raw.features?.map(f => f.properties) ?? [];
if (!all.length) { console.error('ไม่พบเรกคอร์ดใน ' + SRC); process.exit(1); }

const provOf = r => String(r.province ?? r.provinceName ?? r.changwat ?? '');
let recs = all, scopeNote = 'ทั้งไฟล์';
if (PROVINCE) {
  const needle = PROVINCE.toLowerCase();
  recs = all.filter(r => provOf(r).toLowerCase().includes(needle));
  scopeNote = `province ~ "${PROVINCE}"`;
  if (!recs.length) { console.error(`กรอง province="${PROVINCE}" แล้วไม่เหลือเรกคอร์ด`); process.exit(1); }
} else {
  note('ไม่ได้ระบุ --province — ตรวจทั้งไฟล์ และข้ามการตรวจพิกัดหลุดพื้นที่');
}

const idOf = (r, i) => String(r.id ?? r.customerId ?? r.code ?? r.businessName ?? `#${i}`);

// ---- resolver -------------------------------------------------------------
const zonesCsv = existsSync('zones.csv')
  ? readFileSync('zones.csv', 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/)
      .slice(1).map(l => { const c = l.split(','); return { khet_th: c[0], khet_en: c[1], zone_id: c[2] }; })
  : [];
const byName = zonesCsv.length ? districtLookup(zonesCsv) : null;

const displayGj = JSON.parse(readFileSync(DISPLAY, 'utf8'));
const display = createZoneResolver(displayGj, { zoneByDistrict: byName });
const assign  = ASSIGN && existsSync(ASSIGN)
  ? createZoneResolver(JSON.parse(readFileSync(ASSIGN, 'utf8')), { zoneByDistrict: byName })
  : display;

// กรอบพื้นที่ = bbox ของโซน + margin (แทนค่า hardcode)
let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity;
for (const f of displayGj.features ?? []) {
  const g = f.geometry;
  const polys = g?.type === 'MultiPolygon' ? g.coordinates : g?.type === 'Polygon' ? [g.coordinates] : [];
  for (const rings of polys) for (const [x, y] of rings[0]) {
    if (x < X0) X0 = x; if (x > X1) X1 = x; if (y < Y0) Y0 = y; if (y > Y1) Y1 = y;
  }
}
const mLat = MARGIN_KM / 111;
const mLng = MARGIN_KM / (111 * Math.cos(((Y0 + Y1) / 2) * Math.PI / 180));
const AREA = { x0: X0 - mLng, x1: X1 + mLng, y0: Y0 - mLat, y1: Y1 + mLat };

console.log(`${all.length} เรกคอร์ด -> ${recs.length} เข้าขอบเขต (${scopeNote})`);
console.log(`display=${DISPLAY} (${display.parts} part)` +
            (assign !== display ? ` · assign=${ASSIGN} (${assign.parts} part)` : ' · assign=ไฟล์เดียวกัน') +
            ` · กรอบพื้นที่ = bbox โซน + ${MARGIN_KM} กม.`);

// ---- เดินข้อมูล -----------------------------------------------------------
const zoneOf = {};                     // id -> zone_id | null
let flips = 0, nearEdge = 0, conflict = 0, outOfArea = 0, noCoord = 0;
const dupe = new Map(), flipList = [], conflictList = [], outList = [], outIds = [];

recs.forEach((r, i) => {
  const id  = idOf(r, i);
  const lat = r.latitude ?? r.lat, lng = r.longitude ?? r.lng ?? r.lon;
  const a = assign.resolve(r);
  const d = display.resolve(r);

  zoneOf[id] = a.zone_id ?? null;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) noCoord++;
  else {
    if (lng < AREA.x0 || lng > AREA.x1 || lat < AREA.y0 || lat > AREA.y1) {
      outOfArea++;
      outIds.push(id);
      if (outList.length < 5) outList.push(`${id} (${lat.toFixed(3)},${lng.toFixed(3)})`);
    }
    const k = `${lat.toFixed(6)},${lng.toFixed(6)}`;
    dupe.set(k, (dupe.get(k) ?? 0) + 1);
  }
  if (a.zone_id !== d.zone_id) {
    flips++;
    if (flipList.length < 5) flipList.push(`${id}: assign=${a.zone_id} display=${d.zone_id}`);
  }
  if (a.near_edge) nearEdge++;
  if (a.conflict) {
    conflict++;
    if (conflictList.length < 5) conflictList.push(`${id}: พิกัด=${a.zone_id} district="${r.district}" ห่างขอบ ${a.dist_m} ม.`);
  }
});

const inZone = Object.values(zoneOf).filter(Boolean).length;
const dupes  = [...dupe.values()].filter(n => n > 1).reduce((s, n) => s + n, 0);
const pct = n => +(100 * n / recs.length).toFixed(1);

const now = {
  version: 2, scope: scopeNote, total: recs.length, inZone, noCoord,
  nearEdge, conflict, outOfArea, dupes,
  pctNearEdge: pct(nearEdge), pctConflict: pct(conflict),
  zones: zoneOf,
};

const prev = existsSync(BASEFILE) ? JSON.parse(readFileSync(BASEFILE, 'utf8')) : null;
// accept-list ต้องอยู่รอด --write-baseline ไม่งั้นการเขียน baseline ใหม่จะลบการรับทราบทิ้ง
now.acceptedBadCoords = prev?.acceptedBadCoords ?? [];

// --accept-bad-coords: บันทึก id ที่พิกัดหลุดพื้นที่ "ตอนนี้" ว่ารับทราบแล้ว
//   ไม่ใช่การกลบทั้งหมวดแบบ --margin-km — id อยู่ในไฟล์ ตรวจสอบใน git ได้
//   และรายที่ 7 ที่โผล่มาทีหลังยังแดงเหมือนเดิม
if (ACCEPT) {
  if (!PROVINCE) { console.error('--accept-bad-coords ต้องใช้คู่กับ --province'); process.exit(1); }
  const merged = [...new Set([...now.acceptedBadCoords, ...outIds])].sort();
  const added = merged.filter(id => !now.acceptedBadCoords.includes(id));
  now.acceptedBadCoords = merged;
  const out = { ...(prev ?? now), acceptedBadCoords: merged };
  if (!prev) Object.assign(out, now);
  writeFileSync(BASEFILE, JSON.stringify(out, null, 2));
  console.log(`\nรับทราบพิกัดหลุดพื้นที่ ${merged.length} ราย (เพิ่มใหม่ ${added.length}) ลง ${BASEFILE}`);
  added.forEach(id => console.log(`    + ${id}`));
  console.log('  ยังต้องตามแก้ที่ต้นทาง — รายที่ไม่อยู่ในลิสต์นี้จะยังแดง');
  process.exit(0);
}

if (WRITE) {
  writeFileSync(BASEFILE, JSON.stringify(now, null, 2));
  console.log(`\nเขียน baseline ลง ${BASEFILE}`);
  console.log(`  อยู่ในโซน ${inZone}/${recs.length} · near-edge ${now.pctNearEdge}% · conflict ${now.pctConflict}%`);
  if (now.acceptedBadCoords.length) console.log(`  ยกมา: รับทราบพิกัดหลุดพื้นที่ ${now.acceptedBadCoords.length} ราย`);
  process.exit(0);
}

const base = prev;
if (base && base.version !== 2) {
  console.error(`baseline เป็น v${base.version ?? 1} — รัน --write-baseline ใหม่`); process.exit(1);
}

// ---- 1. coverage drift รายเรกคอร์ด ----------------------------------------
//   lost   = เคยอยู่ในโซน ตอนนี้หลุดออก   <- ความเสียหายจริงตอนแก้ขอบ
//   moved  = ย้ายโซน                      <- ตั้งใจก็ได้ แต่ต้องเห็น
//   gained = เคยอยู่นอก ตอนนี้เข้ามา
if (!base) {
  note(`อยู่ในโซน ${inZone}/${recs.length} (${pct(inZone)}%) · นอกโซน ${recs.length - inZone} — ยังไม่มี baseline`);
} else {
  const lost = [], moved = [], gained = [], missing = [];
  for (const [id, was] of Object.entries(base.zones)) {
    if (!(id in zoneOf)) { missing.push(id); continue; }
    const isNow = zoneOf[id];
    if (was && !isNow)          lost.push(id);
    else if (!was && isNow)     gained.push(`${id}->${isNow}`);
    else if (was !== isNow)     moved.push(`${id}: ${was}->${isNow}`);
  }
  const added = Object.keys(zoneOf).filter(id => !(id in base.zones));

  lost.length === 0
    ? ok(`ไม่มีลูกค้าหลุดออกจากโซน (อยู่ในโซน ${inZone}/${recs.length})`)
    : (red(`ลูกค้าหลุดออกจากโซน ${lost.length} ราย — ขอบใหม่หดจนกลุ่มนี้ไม่ถึง`),
       lost.slice(0, 8).forEach(id => console.error(`    ${id}`)));

  if (moved.length) { note(`ย้ายโซน ${moved.length} ราย (ตั้งใจก็ต้องตรวจแล้วรัน --write-baseline)`);
                      moved.slice(0, 8).forEach(m => console.log(`    ${m}`)); }
  if (gained.length) note(`เข้ามาอยู่ในโซนเพิ่ม ${gained.length} ราย`);
  if (missing.length) note(`หายไปจากข้อมูล ${missing.length} ราย`);
  if (added.length)   note(`เรกคอร์ดใหม่ ${added.length} ราย`);
}

// ---- 2. flip: รูปที่วาด vs รูปที่คำนวณ --------------------------------------
if (assign === display) note('ใช้ geometry ไฟล์เดียวทั้งวาดและคำนวณ — ข้ามการตรวจ flip');
else if (flips === 0)   ok('flip = 0 — รูปที่วาดกับรูปที่คำนวณให้ผลตรงกันทุกจุด');
else { red(`flip = ${flips} ราย — simplify ทำให้จุดข้ามขอบโซน (ต้องเป็น 0)`);
       flipList.forEach(f => console.error('    ' + f)); }

// ---- 3. near-edge ---------------------------------------------------------
if (!base) note(`near-edge ${nearEdge} ราย (${now.pctNearEdge}%)`);
else if (now.pctNearEdge > base.pctNearEdge + 0.5)
  red(`near-edge เพิ่มจาก ${base.pctNearEdge}% เป็น ${now.pctNearEdge}% — ขอบขยับเข้าหากลุ่มลูกค้า`);
else ok(`near-edge ${now.pctNearEdge}% (baseline ${base.pctNearEdge}%)`);

// ---- 4. conflict พิกัด vs ชื่อเขต -------------------------------------------
if (!byName)    note('ไม่มี zones.csv — ข้ามการตรวจ conflict');
else if (!base) note(`conflict ${conflict} ราย (${now.pctConflict}%)`);
else if (now.pctConflict > base.pctConflict + 0.5)
  red(`conflict เพิ่มจาก ${base.pctConflict}% เป็น ${now.pctConflict}%`);
else { ok(`conflict ${now.pctConflict}% (baseline ${base.pctConflict}%)`);
       conflictList.forEach(c => console.log('    ' + c)); }

// ---- 5. คุณภาพพิกัด --------------------------------------------------------
const accepted = new Set(base?.acceptedBadCoords ?? []);
const newBad = outIds.filter(id => !accepted.has(id));
if (!PROVINCE) note('ข้ามการตรวจพิกัดหลุดพื้นที่ (ไม่ได้ระบุ --province)');
else if (!outOfArea) ok('พิกัดทุกจุดอยู่ในกรอบพื้นที่');
else if (!newBad.length)
  ok(`พิกัดหลุดกรอบ ${outOfArea} ราย — รับทราบแล้วทั้งหมด (ยังต้องตามแก้ที่ต้นทาง)`);
else { red(`พิกัดหลุดกรอบพื้นที่รายใหม่ ${newBad.length} ราย (รับทราบไว้แล้ว ${outOfArea - newBad.length}) — พิกัดผิดที่ต้นทาง`);
       newBad.slice(0, 8).forEach(id => console.error('    ' + (outList.find(o => o.startsWith(id)) ?? id))); }

if (noCoord) note(`ไม่มีพิกัด ${noCoord} ราย — ใช้ fallback ชื่อเขต`);
if (dupes)   note(`พิกัดซ้ำกันเป๊ะ ${dupes} ราย — หมุดทับกันบนแมพ`);

console.log(bad ? `\n${bad} ข้อไม่ผ่าน` : '\nผ่านทั้งหมด');
process.exit(bad ? 1 : 0);
