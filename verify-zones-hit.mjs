#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Gate ที่ 2: โพลิกอนอยู่ "ถูกที่" จริงไหม — ไม่ใช่แค่โครงสร้างถูก
//
// geoBoundaries ADM2 ไม่มีฟิลด์จังหวัด เราจึง filter ด้วยชื่อเขตอย่างเดียว
// ถ้าเผลอหยิบอำเภอชื่อซ้ำจากจังหวัดอื่นมา โครงสร้างจะยังผ่าน gate แรกทุกข้อ
// ทดสอบนี้จึงยิงพิกัดจริงของเขต (จาก DISTRICT_META) เข้าไปดูว่าตกโซนที่ควรตก
// ---------------------------------------------------------------------------
import { readFileSync } from 'node:fs';

const gj = JSON.parse(readFileSync('data/zones.geojson', 'utf8'));

/* ray casting — จุดอยู่ในวงแหวนนอกและไม่อยู่ในรู */
const inRing = ([x, y], ring) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};
const inPoly = (pt, poly) => inRing(pt, poly[0]) && !poly.slice(1).some(h => inRing(pt, h));
const zoneAt = pt => {
  for (const f of gj.features) {
    const g = f.geometry;
    const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
    if (polys.some(p => inPoly(pt, p))) return f.properties.zone_id;
  }
  return null;
};

// [ชื่อเขต, lng, lat, โซนที่ต้องได้]  — พิกัดชุดเดียวกับ DISTRICT_META ใน src/mock/geoData.js
const CASES = [
  ['Watthana',     100.585, 13.740, 'TL'],
  ['Khlong Toei',  100.584, 13.708, 'TL'],
  ['Bang Rak',     100.524, 13.730, 'SL'],
  ['Pathum Wan',   100.534, 13.744, 'SL'],
  ['Sathon',       100.529, 13.708, 'SL'],
  ['Ratchathewi',  100.534, 13.758, 'SL'],
  ['Huai Khwang',  100.579, 13.777, 'LP'],
  ['Chatuchak',    100.559, 13.828, 'SL'],   // เติมรอบ 2 — คั่นระหว่าง SL กับ LP พอดี
  ['Din Daeng',    100.554, 13.769, 'LP'],   // เติมรอบ 2 — ติดห้วยขวางที่เป็น LP อยู่แล้ว
  ['Saphan Sung',  100.686, 13.766, 'TL'],   // เติมรอบ 2 — คั่นระหว่าง LP กับ TL
  ['Khan Na Yao',  100.673, 13.827, 'LP'],   // เติมรอบ 2 — ขอบตะวันออก ต่อจากบึงกุ่ม
  ['Taling Chan',  100.412, 13.777, null],   // อยู่นอกวงจริง — ป้าย SL บนภาพแค่หาที่ว่างเขียน
  // ── ฝั่งธนบุรี: ตัดออกจาก SL รอบที่ 4 — ขอบตะวันตกต้องเป็นแม่น้ำเจ้าพระยาเป๊ะ
  //    5 จุดนี้เคยตอบ SL ก่อนตัด (ยืนยันแล้ว) จึงเป็นเคส null ที่มีความหมายจริง ไม่ใช่จุดมั่ว
  ['Thon Buri',    100.487, 13.727, null],
  ['Khlong San',   100.508, 13.730, null],
  ['Bangkok Noi',  100.470, 13.766, null],
  ['Bang Phlat',   100.505, 13.794, null],
  ['Bangkok Yai',  100.476, 13.723, null],
  ['เชียงใหม่',      98.985,  18.788, null],   // คนละจังหวัด — กันหยิบโพลิกอนผิดจังหวัดมา
];

let bad = 0;
for (const [name, lng, lat, want] of CASES) {
  const got = zoneAt([lng, lat]);
  const okc = got === want;
  if (!okc) bad++;
  console.log(`${okc ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name.padEnd(14)} → ${String(got).padEnd(5)} (ควรได้ ${want})`);
}
console.log(bad ? `\n${bad} เคสไม่ผ่าน` : `\nผ่านทั้งหมด ${CASES.length} เคส — โพลิกอนอยู่ถูกที่`);
process.exit(bad ? 1 : 0);
