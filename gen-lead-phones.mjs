// เติมเบอร์โทรให้ข้อมูล Lead (data/prospects.json) — ใช้กับ "ข้อมูลสาธิต" เท่านั้น
//
// ⚠ เบอร์ที่สร้างเป็นของสมมติ ไม่ใช่เบอร์จริงของธุรกิจนั้น ห้ามเอาไปโทรจริง
//   เมื่อได้ข้อมูลจริงจากลูกค้าให้ทับไฟล์นี้ทั้งไฟล์ อย่าใช้สคริปต์นี้กับข้อมูลจริง
//
// สร้างแบบ deterministic จาก id — รันกี่ครั้งก็ได้เบอร์เดิม (ไฟล์ไม่เปลี่ยนโดยไม่จำเป็น)
// รูปแบบตามชุดข้อมูลลูกค้าที่มีอยู่: มือถือ "08X XXX XXXX" · บ้าน/สำนักงาน "0 2XXX XXXX"
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const FILE = process.argv[2] || "data/prospects.json";
const rows = JSON.parse(readFileSync(FILE, "utf8"));

// ตัวเลขสุ่มแบบคงที่จากข้อความ (id) — ใช้ไบต์จาก sha256 ทีละตัว
const digitsOf = (seed, n) => {
  const h = createHash("sha256").update("lead-phone:" + seed).digest();
  let out = "";
  for (let i = 0; i < n; i++) out += (h[i % h.length] % 10).toString();
  return out;
};

// ต่างจังหวัดใช้รหัสพื้นที่จริงของภูมิภาคนั้น เพื่อให้ดูสมจริงตอนสาธิต
const AREA = { "Bangkok Metropolis":"2", "Nonthaburi":"2", "Pathum Thani":"2", "Samut Prakan":"2",
               "Chiang Mai":"53", "Lamphun":"53", "Chiang Rai":"53", "Lampang":"54",
               "Phuket":"76", "Krabi":"75", "Pattaya":"38", "Rayong":"38", "Chachoengsao":"38",
               "Nakhon Ratchasima":"44", "Khon Kaen":"43", "Nakhon Si Thammarat":"75" };

let filled = 0;
for (const r of rows) {
  if (r.phone) continue;
  const d = digitsOf(r.id || r.businessName, 12);
  const mobile = (+d[0] % 3) !== 0;                       // ~2 ใน 3 เป็นมือถือ
  if (mobile) {
    const head = ["06", "08", "09"][+d[1] % 3] + d[2];    // 06X/08X/09X
    r.phone = `${head} ${d.slice(3, 6)} ${d.slice(6, 10)}`;
  } else {
    const area = AREA[r.province] || "2";
    const rest = d.slice(2, 2 + (8 - area.length));       // รวมเลขหลังรหัสพื้นที่ให้ครบ 8 หลัก
    r.phone = `0 ${area}${rest.slice(0, 3 - (area.length - 1))} ${rest.slice(3 - (area.length - 1))}`;
  }
  filled++;
}

writeFileSync(FILE, JSON.stringify(rows, null, 2));
console.log(`เติมเบอร์ให้ ${filled} ระเบียน จากทั้งหมด ${rows.length}`);
console.log("ตัวอย่าง:", rows.slice(0, 5).map(r => `${r.businessName} → ${r.phone}`).join("\n          "));
