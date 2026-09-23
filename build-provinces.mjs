// สร้าง data/thailand-provinces.geojson จาก geoBoundaries THA ADM1 (แหล่งเดียวกับที่ใช้ทำโซนจาก ADM2)
//
// ทำไมต้องมีไฟล์นี้: ไฟล์ขอบจังหวัดเดิมหยาบมาก (กรุงเทพทั้งจังหวัด 123 จุด) คนละแหล่งกับเส้นโซน
// ที่สกัดจาก ADM2 (5,884 จุด) เส้นสองชุดจึงไม่ทาบกัน — หมุดโซน 7.9% ตกอยู่ "นอก" รูปจังหวัดทั้งที่จริงอยู่ใน
// ใช้ ADM1 ของผู้เผยแพร่เดียวกัน = ขอบจังหวัดคือการรวมขอบเขตเขต/อำเภอชุดเดียวกัน จึงตรงกันโดยธรรมชาติ
//
// วิธีใช้:  node build-provinces.mjs <geoBoundaries-THA-ADM1.geojson> [out]
// ดาวน์โหลดต้นฉบับ (4 MB):
//   https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/gbOpen/THA/ADM1/geoBoundaries-THA-ADM1.geojson
import { readFileSync, writeFileSync } from "node:fs";

const SRC = process.argv[2];
const OUT = process.argv[3] || "data/thailand-provinces.geojson";
const PRECISION = 5;               // 5 ตำแหน่ง ≈ 1.1 เมตร — ละเอียดเกินพอสำหรับระดับจังหวัด และลดขนาดไฟล์ได้มาก
if(!SRC){ console.error("ต้องระบุไฟล์ต้นฉบับ ADM1"); process.exit(1); }

// ⚠ ชื่อจังหวัดคือ "คีย์" ที่ข้อมูลลูกค้า/พื้นที่ทั้งระบบใช้จับคู่ — เปลี่ยนชื่อ = แผนที่หาจังหวัดไม่เจอ
//   ชุดข้อมูลธุรกิจเรียกชลบุรีว่า "Pattaya" จึงต้องคงชื่อนั้นไว้ ไม่ใช่แก้ให้ "ถูก"
const RENAME = { "Bangkok":"Bangkok Metropolis", "Lopburi":"Lop Buri", "Chon Buri":"Pattaya" };
const nameOf = s => { const n = String(s||"").replace(/\s+Province$/,"").trim(); return RENAME[n] || n; };

// ลดจุดแบบ Douglas–Peucker: ต้นฉบับละเอียดระดับเซนติเมตร (145,789 จุด · 2.8 MB) เกินจำเป็นสำหรับเส้นขอบจังหวัด
// 10 เมตรคือจุดสมดุล — ไฟล์ 1.8 MB แต่เส้นยังทาบขอบโซนเท่าเดิม (คลาดเคลื่อนมัธยฐาน 4 ม. เทียบกับ 3 ม. ของต้นฉบับ)
const TOL = +(process.env.TOL || 10);
const K = Math.cos(13.7*Math.PI/180)*111320, KY = 110540;      // องศา → เมตร (ใกล้เคียงพอสำหรับไทย)
const segD = (p,a,b) => { const px=(p[0]-a[0])*K, py=(p[1]-a[1])*KY, bx=(b[0]-a[0])*K, by=(b[1]-a[1])*KY;
  const L=bx*bx+by*by; let t=L?((px*bx+py*by)/L):0; t=Math.max(0,Math.min(1,t));
  return Math.hypot(px-bx*t, py-by*t); };
function simplify(ring, tol){
  if(ring.length < 5 || !tol) return ring;
  const keep = new Uint8Array(ring.length); keep[0] = keep[ring.length-1] = 1;
  const stack = [[0, ring.length-1]];
  while(stack.length){ const [i,j] = stack.pop(); let best=-1, bi=-1;
    for(let k=i+1;k<j;k++){ const d=segD(ring[k],ring[i],ring[j]); if(d>best){ best=d; bi=k; } }
    if(best > tol){ keep[bi]=1; stack.push([i,bi],[bi,j]); } }
  const out = ring.filter((_,i)=>keep[i]);
  return out.length >= 4 ? out : ring;                          // วงเล็กเกินไปหลังลดจุด = คงของเดิมไว้
}

const round = c => Array.isArray(c[0]) ? c.map(round) : [ +c[0].toFixed(PRECISION), +c[1].toFixed(PRECISION) ];
// ปัดตำแหน่งแล้วจุดติดกันอาจซ้ำ — ตัดจุดซ้ำติดกันออก (วงแหวนต้องปิดหัวท้ายเหมือนเดิม)
const dedupe = ring => { const out=[]; for(const p of ring){ const q=out[out.length-1]; if(!q||q[0]!==p[0]||q[1]!==p[1]) out.push(p); }
  if(out.length>2 && (out[0][0]!==out[out.length-1][0] || out[0][1]!==out[out.length-1][1])) out.push(out[0]);
  return out; };
const clean = (coords, depth) => depth===0 ? simplify(dedupe(coords), TOL) : coords.map(c=>clean(c, depth-1));

const src = JSON.parse(readFileSync(SRC,"utf8"));
const features = src.features.map(f=>{
  const g = f.geometry;
  const depth = g.type==="Polygon" ? 1 : 2;          // Polygon: [ring][pt] · MultiPolygon: [poly][ring][pt]
  return { type:"Feature", properties:{ name: nameOf(f.properties.shapeName) },
           geometry:{ type:g.type, coordinates: clean(round(g.coordinates), depth) } };
}).sort((a,b)=>a.properties.name.localeCompare(b.properties.name));

writeFileSync(OUT, JSON.stringify({type:"FeatureCollection", features}));
let n=0; features.forEach(f=>{ const w=c=>Array.isArray(c[0])?c.forEach(w):n++; w(f.geometry.coordinates); });
console.log(`เขียน ${OUT} — ${features.length} จังหวัด · ${n} หมุด`);
