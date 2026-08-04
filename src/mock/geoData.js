// ═══════════════════════════════════════════════════════════════════════════
// src/mock/geoData.js — แหล่งข้อมูลจำลอง "ที่เดียวของทั้งระบบ" (single source of truth)
// ใช้ร่วมกันทั้งฝั่ง Node (gen.mjs สร้าง JSON) และฝั่งเบราว์เซอร์ (lib.js/data.js อ้างชื่อ/พิกัดอำเภอ)
// กติกา (ข้อ 7): มีเฉพาะ 4 จังหวัด · ยอด/สัดส่วนเกรดกำหนดตายตัว · validate() throw เมื่อยอดรวมไม่สอดคล้อง
// หมายเหตุ "พัทยา": เป็นเมืองชายทะเลภาคตะวันออก — ในระบบใช้ key "Pattaya" โดยอิงขอบเขต/พิกัดของพื้นที่เดิม
// ═══════════════════════════════════════════════════════════════════════════

// ── 12 เซกเมนต์ธุรกิจ ตาม Appendix A (ทั้งระบบใช้ชุดนี้) ──
export const SEGMENTS = ["FoodBeverage","HealthBeauty","Hotel","MarketingEvents","AutoTransport",
  "HomeLiving","Education","BusinessServices","Retail","ITElectronics","CleaningMaintenance","Other"];
export const SEG_TH = {
  FoodBeverage:"อาหารและเครื่องดื่ม", HealthBeauty:"สุขภาพและความงาม", Hotel:"โรงแรมและที่พัก",
  MarketingEvents:"การตลาดและอีเวนต์", AutoTransport:"ยานยนต์และขนส่ง", HomeLiving:"บ้านและเฟอร์นิเจอร์",
  Education:"การศึกษาและฝึกอบรม", BusinessServices:"บริการธุรกิจและวิชาชีพ", Retail:"ค้าปลีกและอุปโภคบริโภค",
  ITElectronics:"ไอทีและอิเล็กทรอนิกส์", CleaningMaintenance:"ทำความสะอาดและซ่อมบำรุง", Other:"อื่น ๆ" };
export const SEG_COLOR = {
  FoodBeverage:"#ff5a3c", HealthBeauty:"#e87ba4", Hotel:"#34e0d0", MarketingEvents:"#8a7bff",
  AutoTransport:"#3987e5", HomeLiving:"#c98500", Education:"#33d69f", BusinessServices:"#6d7cff",
  Retail:"#ffb02e", ITElectronics:"#26c6da", CleaningMaintenance:"#9ccc65", Other:"#8aa0be" };
export const SEG_ICON = {
  FoodBeverage:"🍽️", HealthBeauty:"💄", Hotel:"🏨", MarketingEvents:"📣", AutoTransport:"🚗",
  HomeLiving:"🛋️", Education:"🎓", BusinessServices:"💼", Retail:"🛒", ITElectronics:"💻",
  CleaningMaintenance:"🧹", Other:"🏢" };
// ไอคอนเส้น (outline) หมวดธุรกิจ — เนื้อใน SVG viewBox 24×24 จาก lucide (ISC/MIT) แทนอิโมจิ stock
// stroke=currentColor 2px กำหนดที่ตัวห่อ <svg> — ปรับสี/ขนาดจากภายนอกได้ ดู SegmentIcon/segIconSVG ใน lib.js
export const SEG_SVG = {
  FoodBeverage:'<path d="m16 2-2.3 2.3a3 3 0 0 0 0 4.2l1.8 1.8a3 3 0 0 0 4.2 0L22 8"/><path d="M15 15 3.3 3.3a4.2 4.2 0 0 0 0 6l7.3 7.3c.7.7 2 .7 2.8 0L15 15Zm0 0 7 7"/><path d="m2.1 21.8 6.4-6.3"/><path d="m19 5-7 7"/>',
  HealthBeauty:'<path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/><path d="M3.22 13H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27"/>',
  Hotel:'<path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8"/><path d="M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4"/><path d="M12 4v6"/><path d="M2 18h20"/>',
  MarketingEvents:'<path d="M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/><path d="M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14"/><path d="M8 6v8"/>',
  AutoTransport:'<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
  HomeLiving:'<path d="M20 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v3"/><path d="M2 16a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0z"/><path d="M4 18v2"/><path d="M20 18v2"/><path d="M12 4v9"/>',
  Education:'<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
  BusinessServices:'<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
  Retail:'<path d="M16 10a4 4 0 0 1-8 0"/><path d="M3.103 6.034h17.794"/><path d="M3.4 5.467a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.667a2 2 0 0 0-.4-1.2l-2-2.667A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z"/>',
  ITElectronics:'<path d="M18 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h8"/><path d="M10 19v-3.96 3.15"/><path d="M7 19h5"/><rect width="6" height="10" x="16" y="12" rx="2"/>',
  CleaningMaintenance:'<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"/>',
  Other:'<path d="M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z"/><rect x="3" y="14" width="7" height="7" rx="1"/><circle cx="17.5" cy="17.5" r="3.5"/>' };
export const OTHER_COLOR = "#8aa0be";
// helper ปลอดจำนวนเซกเมนต์ (แทนการ hardcode {Hotel:...,Restaurant:...} 4 หมวดเดิม)
export const segZero    = ()  => Object.fromEntries(SEGMENTS.map(s=>[s,0]));
export const segAllTrue = ()  => Object.fromEntries(SEGMENTS.map(s=>[s,true]));
export const segOnly    = (s) => Object.fromEntries(SEGMENTS.map(x=>[x,x===s]));

// เกณฑ์เกรด (คะแนนศักยภาพ) ตาม Appendix B: A = 80–100 · B = 60–79 · C = 0–59
export const GRADE_BANDS = { A:[80,100], B:[60,79], C:[15,59] };
export const gradeOf = s => s>=80?"A":s>=60?"B":"C";
// สัดส่วนเกรดบังคับ ทุกจังหวัดและระดับรวม
export const GRADE_RATIO = { A:0.45, B:0.30, C:0.25 };

// จำนวนเกรดต่อจำนวนLead — ปัดให้ A+B+C = prospects เป๊ะ (C รับเศษ)
export function gradeCounts(prospects){
  const A = Math.round(prospects*GRADE_RATIO.A);
  const B = Math.round(prospects*GRADE_RATIO.B);
  const C = prospects - A - B;
  return { A, B, C };
}

// ── สเปกจังหวัด (ยอดคงที่ตามโจทย์ 7.2) ──
// key = ชื่ออังกฤษที่ใช้ทั้งระบบ · th = ชื่อไทย · center = พิกัดกลางจังหวัด (Pattaya ใช้พิกัดเมืองพัทยา)
export const PROVINCES = [
  { key:"Bangkok Metropolis", th:"กรุงเทพมหานคร", customers:168, prospects:540, topSegment:"Retail",       center:[100.55,13.75] },
  { key:"Pattaya",            th:"ชลบุรี",        customers:88,  prospects:320, topSegment:"Hotel",        center:[100.8825,12.9236] },
  { key:"Phuket",             th:"ภูเก็ต",        customers:82,  prospects:280, topSegment:"Hotel",        center:[98.35,7.95] },
  { key:"Chiang Mai",         th:"เชียงใหม่",     customers:55,  prospects:260, topSegment:"FoodBeverage", center:[98.99,18.79] },
];
export const PROVINCE_KEYS = PROVINCES.map(p=>p.key);
export const provinceSpec = key => PROVINCES.find(p=>p.key===key);

// ── อำเภอ/เขต ต่อจังหวัด (≥6 ทุกจังหวัด เพื่อให้ "อันดับพื้นที่โอกาส" แสดง top-5 ได้จริง) ──
// [ชื่ออังกฤษ, ชื่อไทย, น้ำหนักกระจายข้อมูล, lat, lng]
// พัทยา: ใช้ชื่อย่านจริงในเขตพัทยา/บางละมุง+อำเภอชายฝั่ง (ทุกชื่อเป็นย่าน/อำเภอในพื้นที่ ไม่มีชื่อจังหวัดปน)
export const DISTRICT_META = {
  "Bangkok Metropolis":[
    ["Watthana","วัฒนา",14,13.740,100.585],["Khlong Toei","คลองเตย",12,13.708,100.584],
    ["Bang Rak","บางรัก",9,13.730,100.524],["Pathum Wan","ปทุมวัน",10,13.744,100.534],
    ["Sathon","สาทร",9,13.708,100.529],["Huai Khwang","ห้วยขวาง",8,13.777,100.579],
    ["Chatuchak","จตุจักร",9,13.828,100.559],["Ratchathewi","ราชเทวี",7,13.758,100.534],
  ],
  "Pattaya":[
    ["Bang Lamung","บางละมุง",30,12.933,100.900],["Pattaya City","เมืองพัทยา",24,12.9236,100.8825],
    ["Na Kluea","นาเกลือ",11,12.973,100.897],["Nong Prue","หนองปรือ",10,12.916,100.917],
    ["Si Racha","ศรีราชา",14,13.174,100.930],["Sattahip","สัตหีบ",7,12.664,100.900],
    ["Huai Yai","ห้วยใหญ่",6,12.870,100.960],["Phanat Nikhom","พนัสนิคม",5,13.450,101.184],
  ],
  "Phuket":[
    ["Mueang Phuket","เมืองภูเก็ต",30,7.884,98.388],["Kathu","กะทู้",20,7.911,98.332],
    ["Thalang","ถลาง",16,8.030,98.339],["Patong","ป่าตอง",14,7.896,98.296],
    ["Chalong","ฉลอง",10,7.844,98.339],["Karon","กะรน",7,7.846,98.294],["Rawai","ราไวย์",5,7.772,98.324],
  ],
  "Chiang Mai":[   // 25 อำเภอจริงของเชียงใหม่ · ชื่อไทยไม่มีคำว่า "อำเภอ" นำหน้า
    ["Mueang Chiang Mai","เมืองเชียงใหม่",26,18.788,98.985],["San Sai","สันทราย",12,18.859,99.038],
    ["Hang Dong","หางดง",11,18.688,98.921],["Mae Rim","แม่ริม",10,18.916,98.943],
    ["Saraphi","สารภี",9,18.717,99.037],["San Kamphaeng","สันกำแพง",9,18.745,99.118],
    ["Doi Saket","ดอยสะเก็ด",8,18.869,99.135],["San Pa Tong","สันป่าตอง",8,18.629,98.892],
    ["Fang","ฝาง",8,19.916,99.213],["Chom Thong","จอมทอง",7,18.417,98.677],
    ["Mae Taeng","แม่แตง",7,19.118,98.946],["Mae Ai","แม่อาย",6,20.026,99.291],
    ["Phrao","พร้าว",5,19.372,99.201],["Chiang Dao","เชียงดาว",5,19.367,98.969],
    ["Mae Chaem","แม่แจ่ม",4,18.505,98.363],["Hot","ฮอด",4,18.152,98.605],
    ["Doi Lo","ดอยหล่อ",4,18.470,98.760],["Mae Wang","แม่วาง",4,18.635,98.700],
    ["Chai Prakan","ไชยปราการ",4,19.720,99.145],["Samoeng","สะเมิง",3,18.849,98.728],
    ["Mae On","แม่ออน",3,18.730,99.245],["Doi Tao","ดอยเต่า",3,17.925,98.649],
    ["Wiang Haeng","เวียงแหง",2,19.560,98.653],["Omkoi","อมก๋อย",2,17.792,98.360],
    ["Galyani Vadhana","กัลยาณิวัฒนา",2,19.070,98.290],
  ],
};

// แผนที่ช่วย (derive จาก DISTRICT_META — ให้ lib.js/data.js อ้างที่เดียว)
export const DISTRICT_TH = Object.values(DISTRICT_META).flat()
  .reduce((m,[en,th])=>{ m[en]=th; return m; }, {});
export const DISTRICT_CENTER = Object.values(DISTRICT_META).flat()
  .reduce((m,[en,,,lat,lng])=>{ m[en]={lat,lng}; return m; }, {});

// ── validate: บังคับกฎความสอดคล้อง (ข้อ 7.3) — throw ถ้าไม่ผ่าน ──
export function validateGeoData({customers, prospects}){
  const err = [];
  const only = new Set(PROVINCE_KEYS);
  // 1) จังหวัดต้องมีเฉพาะ 4 จังหวัด และประเทศไทยเท่านั้น
  for(const r of customers.concat(prospects)){
    if(r.country!=="Thailand") err.push(`พบประเทศนอกไทย: ${r.country}`);
    if(!only.has(r.province)) err.push(`พบจังหวัดนอกสเปก: ${r.province}`);
  }
  // 2) ยอดลูกค้า/Lead + สัดส่วนเกรด ต่อจังหวัด ต้องตรงสเปก
  for(const sp of PROVINCES){
    const cs = customers.filter(c=>c.province===sp.key);
    const ps = prospects.filter(p=>p.province===sp.key);
    if(cs.length!==sp.customers) err.push(`${sp.key}: ลูกค้า ${cs.length} ≠ ${sp.customers}`);
    if(ps.length!==sp.prospects) err.push(`${sp.key}: Lead ${ps.length} ≠ ${sp.prospects}`);
    const g = gradeCounts(sp.prospects);
    const got = {A:0,B:0,C:0}; ps.forEach(p=>{ got[gradeOf(p.potentialScore)]++; });
    ["A","B","C"].forEach(k=>{ if(Math.abs(got[k]-g[k])>1) err.push(`${sp.key}: เกรด ${k} ${got[k]} ≠ ${g[k]} (±1)`); });
    // A+B+C ต้องเท่ากับจำนวนLead
    if(got.A+got.B+got.C!==ps.length) err.push(`${sp.key}: A+B+C ≠ Lead`);
    // อำเภอ ≥ 6
    const dist = new Set(cs.concat(ps).map(x=>x.district));
    if(dist.size<6) err.push(`${sp.key}: อำเภอ ${dist.size} < 6`);
  }
  // 3) ยอดรวมทั้งหมด
  const totC = PROVINCES.reduce((a,p)=>a+p.customers,0), totP = PROVINCES.reduce((a,p)=>a+p.prospects,0);
  if(customers.length!==totC) err.push(`ลูกค้ารวม ${customers.length} ≠ ${totC}`);
  if(prospects.length!==totP) err.push(`Leadรวม ${prospects.length} ≠ ${totP}`);
  if(err.length) throw new Error("ข้อมูลจำลองไม่สอดคล้องตามกฎ 7.3:\n - "+err.join("\n - "));
  return true;
}

// ═══ เครื่องคิดคะแนนศักยภาพ (Appendix B) — ใช้ร่วมกันทั้งฟอร์มและ gen ═══
// กลุ่มกว้างของเซกเมนต์ (ใช้ตัดสิน "ตรงบางส่วน" ในปัจจัย Category Match)
export const SEG_GROUP = {
  FoodBeverage:"food", Hotel:"hospitality",
  HealthBeauty:"services", MarketingEvents:"services", BusinessServices:"services", Education:"services", CleaningMaintenance:"services",
  AutoTransport:"mobility", HomeLiving:"retail", ITElectronics:"retail", Retail:"retail", Other:"other" };
export const catMatchOf = (segment, target) => !segment||!target ? "none"
  : segment===target ? "exact"
  : (SEG_GROUP[segment] && SEG_GROUP[segment]===SEG_GROUP[target]) ? "partial" : "none";

// คืน {score 0-100, grade, catMatch, breakdown[]} — แต่ละปัจจัยคิดเกณฑ์สูงสุดที่เข้าเงื่อนไขเพียงข้อเดียว
export function scoreProspect({segment, targetSegment, rating=0, reviewCount=0, hasWebsite=false, hasPhone=false, zoneOpp="Low", catMatch}={}){
  const cm = catMatch || catMatchOf(segment, targetSegment);
  const bd=[]; let s=0;
  const put=(pts,label,opts={})=>{ if(pts>0) s+=pts; bd.push({pts,label,...opts}); };
  // Category Match
  if(cm==="exact")   put(20,"หมวดหมู่ตรงตัว");
  else if(cm==="partial") put(10,"หมวดหมู่ตรงบางส่วน");
  else put(0,"หมวดหมู่ไม่ตรง",{miss:true,hint:"ตรงตัว +20 · ตรงบางส่วน +10"});
  // Rating Quality
  if(rating>=4.2) put(15,`คะแนนรีวิว ${rating}`);
  else if(rating>=3.5) put(8,`คะแนนรีวิว ${rating}`);
  else put(0,"คะแนนรีวิวต่ำกว่า 3.5",{miss:true,hint:"≥3.5 +8 · ≥4.2 +15"});
  // Review Volume
  if(reviewCount>=100) put(15,`${reviewCount} รีวิว`);
  else if(reviewCount>=50) put(10,`${reviewCount} รีวิว`);
  else if(reviewCount>=20) put(5,`${reviewCount} รีวิว`);
  else put(0,"รีวิวน้อยกว่า 20",{miss:true,hint:"≥20 +5 · ≥50 +10 · ≥100 +15"});
  // Contact Availability
  if(hasWebsite) put(10,"มีเว็บไซต์"); else put(0,"ยังไม่มีเว็บไซต์",{miss:true,hint:"+10 ถ้ามี"});
  if(hasPhone)   put(10,"มีเบอร์โทรศัพท์"); else put(0,"ยังไม่มีเบอร์โทรศัพท์",{miss:true,hint:"+10 ถ้ามี"});
  // Location Opportunity
  if(zoneOpp==="High") put(30,"โซนโอกาสสูง");
  else if(zoneOpp==="Medium") put(15,"โซนโอกาสปานกลาง");
  else put(0,"โซนโอกาสต่ำ",{miss:true,hint:"ปานกลาง +15 · สูง +30"});
  s=Math.min(100,s);
  return { score:s, grade:gradeOf(s), catMatch:cm, breakdown:bd };
}

// ═══ ทีม TC + มอบหมายตามพิกัด (จุดยึดภูมิภาคเดียวกับ gen.mjs) ═══
export const TC_TEAM = ["ธนพล ศรีวัฒน์","ณัฐริกา พงษ์ไพบูลย์","กิตติศักดิ์ อารยะกุล","ศุภมาส เจริญสุข","วีรภัทร ตันติพงศ์","ปิยะนุช วงศ์สกุล"];
const TC_SEEDS = [
  {tc:"ธนพล ศรีวัฒน์",       lat:18.79, lng:98.98},
  {tc:"ณัฐริกา พงษ์ไพบูลย์", lat:13.86, lng:100.62},
  {tc:"กิตติศักดิ์ อารยะกุล", lat:13.66, lng:100.45},
  {tc:"ศุภมาส เจริญสุข",      lat:12.93, lng:100.90},
  {tc:"ปิยะนุช วงศ์สกุล",     lat:7.90,  lng:98.40},
];
export function assignTC(lat,lng){
  if(lat==null||lng==null||isNaN(lat)||isNaN(lng)) return "ยังไม่มอบหมาย";
  let best=TC_SEEDS[0], bd=Infinity;
  for(const s of TC_SEEDS){ const d=(lat-s.lat)**2+(lng-s.lng)**2; if(d<bd){bd=d;best=s;} }
  return best.tc;
}

// ═══ พิกัด → จังหวัด/โซน (ใช้ validate ขอบเขต + คิด Location Opportunity ในฟอร์ม) ═══
// กรอบพิกัดต่อจังหวัด — คำนวณจากพิกัดอำเภอใน DISTRICT_META + เผื่อขอบ (pad)
const PAD = 0.35;
export const PROVINCE_BBOX = Object.fromEntries(Object.entries(DISTRICT_META).map(([prov,list])=>{
  let laMin=90,laMax=-90,lnMin=180,lnMax=-180;
  for(const [,,,lat,lng] of list){ laMin=Math.min(laMin,lat);laMax=Math.max(laMax,lat);lnMin=Math.min(lnMin,lng);lnMax=Math.max(lnMax,lng); }
  return [prov,[laMin-PAD,laMax+PAD,lnMin-PAD,lnMax+PAD]];
}));
export function provinceOf(lat,lng){
  if(lat==null||lng==null||isNaN(lat)||isNaN(lng)) return null;
  for(const [prov,b] of Object.entries(PROVINCE_BBOX)){
    if(lat>=b[0]&&lat<=b[1]&&lng>=b[2]&&lng<=b[3]) return prov;
  }
  return null;
}
// คืน {out} ถ้านอกพื้นที่ · มิฉะนั้น {province, district, gap:'High'|'Medium'|'Low'} จากอำเภอที่ใกล้พิกัดสุด
export function zoneOf(lat,lng, districts=[]){
  const prov=provinceOf(lat,lng); if(!prov) return {out:true};
  let best=null, bd=Infinity;
  for(const [en,,,dlat,dlng] of (DISTRICT_META[prov]||[])){ const d=(lat-dlat)**2+(lng-dlng)**2; if(d<bd){bd=d;best=en;} }
  const rec=(districts||[]).find(x=>x.province===prov&&x.district===best);
  return { out:false, province:prov, district:best, gap: rec?rec.marketGap:"Low" };
}
