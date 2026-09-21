// สกัด 28 เขตของ กทม. จาก geoBoundaries ADM2 (265 MB) → geojson เล็ก ๆ ติด zone_id
//
// ⚠ ไฟล์นี้ไม่มีฟิลด์จังหวัด — filter ด้วยชื่อเขตอย่างเดียว จึงต้องเช็กชื่อซ้ำข้ามจังหวัดก่อน
//   (เช่น "Watthana Nakhon" ที่สระแก้ว ไม่ใช่ "Vadhana" ที่ กทม.)
// สตรีมทีละบรรทัด (1 feature = 1 บรรทัด · ยาวได้ถึง 1.8 ล้านตัวอักษร) JSON.parse เฉพาะบรรทัดที่ตรง
import {createReadStream, writeFileSync} from "node:fs";
import {createInterface} from "node:readline";

const SRC = process.argv[2] || "geoBoundaries-THA-ADM2.geojson";
const OUT = process.argv[3] || "bkk-zones-raw.geojson";
const PRECISION = 5;                      // 5 ตำแหน่ง ≈ 1.1 เมตร — พอเกินพอสำหรับแผนที่ระดับเขต

const norm = s => (s ?? "").normalize("NFC").replace(/[\s.\-]/g, "").toLowerCase();

/* khet_en (ตาม zones.seed) → โซน · Vadhana = วัฒนา ตามที่ geoBoundaries สะกด */
const ZONE_OF = {};
const put = (zone, names) => names.forEach(n => ZONE_OF[norm(n)] = zone);
// ⚠ ขอบตะวันตกของ SL = แม่น้ำเจ้าพระยา — ไม่ข้ามไปฝั่งธนบุรี
// (บางพลัด · บางกอกน้อย · บางกอกใหญ่ · ธนบุรี · คลองสาน ถูกตัดออกรอบที่ 4)
put("SL", ["Phra Nakhon","Dusit","Pom Prap Sattru Phai","Samphanthawong","Bang Rak","Sathon",
           "Yan Nawa","Bang Kho Laem","Pathum Wan","Ratchathewi","Phaya Thai","Bang Sue","Chatuchak"]);
put("LP", ["Lat Phrao","Wang Thonglang","Bang Kapi","Huai Khwang","Bueng Kum","Din Daeng","Khan Na Yao"]);
put("TL", ["Vadhana","Khlong Toei","Phra Khanong","Suan Luang","Bang Na","Prawet","Saphan Sung"]);
const ZONE_NAME = {SL:"สีลม", LP:"ลาดพร้าว", TL:"ทองหล่อ"};

const round = c => Array.isArray(c[0]) ? c.map(round) : [ +c[0].toFixed(PRECISION), +c[1].toFixed(PRECISION) ];

const seen = {}, feats = [];
const rl = createInterface({input: createReadStream(SRC, {encoding:"utf8"}), crlfDelay: Infinity});
for await (const line of rl){
  const m = line.match(/"shapeName":\s*"((?:[^"\\]|\\.)*)"/);
  if(!m) continue;
  const zone = ZONE_OF[norm(m[1])];
  if(!zone) continue;
  (seen[m[1]] = seen[m[1]] || []).push(line.length);
  const f = JSON.parse(line.replace(/,\s*$/, ""));
  feats.push({type:"Feature",
    properties:{zone_id:zone, zone_name:ZONE_NAME[zone], khet_en:m[1]},
    geometry:{type:f.geometry.type, coordinates:round(f.geometry.coordinates)}});
}

/* ── gate: ชื่อซ้ำข้ามจังหวัด ── */
const dup = Object.entries(seen).filter(([,v]) => v.length > 1);
if(dup.length){
  console.error("❌ ชื่อเขตซ้ำข้ามจังหวัด — filter ด้วยชื่ออย่างเดียวไม่ปลอดภัย:");
  for(const [n,v] of dup) console.error(`   ${n} × ${v.length}  (ขนาดบรรทัด ${v.join(", ")})`);
  process.exit(1);
}
const want = Object.keys(ZONE_OF).length;   // นับจากตาราง ไม่ฝังตัวเลข — เติมเขตแล้ว gate ขยับตาม
const got  = Object.keys(seen).length;
console.log(`เจอ ${got} / ${want} เขต · ไม่มีชื่อซ้ำ`);
if(got !== want){
  console.error("❌ ได้ไม่ครบ 28 เขต:");
  for(const k of Object.keys(ZONE_OF)) if(!Object.keys(seen).some(s=>norm(s)===k)) console.error("   ขาด " + k);
  process.exit(1);
}

writeFileSync(OUT, JSON.stringify({type:"FeatureCollection", features:feats}));
const kb = Math.round(Buffer.byteLength(JSON.stringify({type:"FeatureCollection",features:feats}))/1024);
const perZone = {};
for(const f of feats) perZone[f.properties.zone_id] = (perZone[f.properties.zone_id]||0)+1;
console.log(`เขียน ${OUT} · ${kb} KB · ${feats.length} feature  (SL ${perZone.SL} · LP ${perZone.LP} · TL ${perZone.TL})`);
