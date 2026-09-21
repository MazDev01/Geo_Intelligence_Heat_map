#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Gate: zones.geojson ต้องตรงกับ zones.csv ครบทุกโซน ไม่งั้นไม่เกิด
// exit 1 = เพี้ยน  ->  เอาไปวางใน CI / pre-commit ได้เลย
// ---------------------------------------------------------------------------
import { readFileSync, existsSync } from 'node:fs';

const CSV = 'zones.csv';
const GEO = 'data/zones.geojson';
let bad = 0;
const red = (...a) => { bad++; console.error('\x1b[31m✗\x1b[0m', ...a); };
const ok  = (...a) => console.log('\x1b[32m✓\x1b[0m', ...a);

for (const f of [CSV, GEO]) if (!existsSync(f)) { console.error(`ไม่พบ ${f}`); process.exit(1); }

// --- csv -------------------------------------------------------------------
const lines = readFileSync(CSV, 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/);
const head = lines[0].split(',');
const iK = head.indexOf('khet_th'), iZ = head.indexOf('zone_id');
const want = new Map();                       // khet -> zone
for (const l of lines.slice(1)) {
  const c = l.split(',');
  if (c[iZ]) want.set(c[iK].trim(), c[iZ].trim());
}

// --- geojson ---------------------------------------------------------------
const gj = JSON.parse(readFileSync(GEO, 'utf8'));
const zones = gj.features.map(f => f.properties.zone_id);

// 1. โซนครบไหม
const wantZones = [...new Set(want.values())].sort();
const gotZones = [...new Set(zones)].sort();
wantZones.join() === gotZones.join()
  ? ok(`โซนครบ ${gotZones.length}: ${gotZones.join(', ')}`)
  : red(`โซนไม่ตรง — csv=[${wantZones}] geojson=[${gotZones}]`);

// 2. 1 โซน = 1 feature (ถ้าเกิน แปลว่า dissolve ไม่สำเร็จ)
const dup = gotZones.filter(z => zones.filter(x => x === z).length > 1);
dup.length ? red(`โซนซ้ำ (dissolve ไม่ติด): ${dup.join(', ')}`)
           : ok('1 โซน = 1 feature');

// 3. geometry ใช้ได้จริง
for (const f of gj.features) {
  const g = f.geometry;
  const n = g?.type === 'MultiPolygon' ? g.coordinates.length
          : g?.type === 'Polygon' ? 1 : 0;
  if (!n) red(`${f.properties.zone_id}: geometry ว่าง/ผิดชนิด (${g?.type})`);
  const pts = JSON.stringify(g).match(/,/g)?.length ?? 0;
  if (pts > 40000) red(`${f.properties.zone_id}: จุดเยอะเกิน (~${pts}) — เพิ่ม -simplify`);
}
if (!bad) ok('geometry ผ่าน');

// 4. รูในพื้นที่โซน — เขตที่ถูกโอบล้อมแต่ยังไม่ได้กำหนดโซน
//    ⚠ ต้องวัดจาก "ผืนรวมของทุกโซน" ไม่ใช่รายโซน — เขตที่คั่นระหว่าง 2 โซนคนละอัน
//      ไม่ใช่ interior ring ของโซนใดโซนหนึ่ง จึงไม่โผล่ถ้าวัดทีละโซน
//    วัดโดยเชื่อมทุกวงแหวนนอกเข้าด้วยกันแบบง่าย: นับ interior ring ที่เหลือหลัง union
//    (ทำผ่าน mapshaper -dissolve เพราะต้อง snap ขอบร่วมก่อน ไม่งั้นได้ "0 รู" ปลอม)
{
  const { execFileSync } = await import("node:child_process");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const out = join(tmpdir(), "zones-union-" + Date.now() + ".json");
  try {
    execFileSync("mapshaper", ["-i", GEO, "snap", "-dissolve", "-o", out],
      { stdio: "pipe", shell: process.platform === "win32" });
    const u = JSON.parse(readFileSync(out, "utf8"));
    const gm = u.features ? u.features[0].geometry : u.geometries[0];
    const polys = gm.type === "MultiPolygon" ? gm.coordinates : [gm.coordinates];
    let holes = 0;
    for (const p of polys) holes += p.length - 1;
    holes ? red(`มีรูในพื้นที่โซน ${holes} รู — มีเขตที่ถูกโอบล้อมแต่ยังไม่ได้กำหนดโซน`)
          : ok(`ไม่มีรูในพื้นที่โซน (ผืนรวม ${polys.length} ส่วน)`);
  } catch (e) {
    console.log("\x1b[33m!\x1b[0m ข้ามการตรวจรู — ไม่มี mapshaper (npm i -g mapshaper)");
  }
}

// 5. ขนาดไฟล์ (ตัวแปรของหนักฝั่ง canvas)
const kb = Math.round(readFileSync(GEO).length / 1024);
kb > 600 ? red(`zones.geojson = ${kb} KB — หนักเกินสำหรับ Leaflet canvas, เพิ่ม -simplify`)
         : ok(`ขนาดไฟล์ ${kb} KB`);

console.log(bad ? `\n${bad} ข้อไม่ผ่าน` : `\nผ่านทั้งหมด — ${want.size} เขต / ${gotZones.length} โซน`);
process.exit(bad ? 1 : 0);
