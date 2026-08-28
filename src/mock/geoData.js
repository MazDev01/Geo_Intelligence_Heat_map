// ═══════════════════════════════════════════════════════════════════════════
// src/mock/geoData.js — แหล่งข้อมูลจำลอง "ที่เดียวของทั้งระบบ" (single source of truth)
// ใช้ร่วมกันทั้งฝั่ง Node (gen.mjs สร้าง JSON) และฝั่งเบราว์เซอร์ (lib.js/data.js อ้างชื่อ/พิกัดอำเภอ)
// กติกา (ข้อ 7): มีเฉพาะ 4 จังหวัด · ยอดลูกค้า/Lead กำหนดตายตัว · validate() throw เมื่อยอดรวมไม่สอดคล้อง
// หมายเหตุ "พัทยา": เป็นเมืองชายทะเลภาคตะวันออก — ในระบบใช้ key "Pattaya" โดยอิงขอบเขต/พิกัดของพื้นที่เดิม
// ═══════════════════════════════════════════════════════════════════════════

// ── 12 หมวดธุรกิจ (Parent Segment) — ชุดเดียวกับไฟล์ข้อมูลจริงของ Barter ──
// ทั้งระบบใช้ชุดนี้: ลูกค้าจริงมากับหมวดนี้อยู่แล้ว · Lead จำลองถูกสร้างด้วยหมวดชุดเดียวกัน
// เพื่อให้โมเดล Lead (อุปสงค์จาก Lead − อุปทานจากลูกค้า) เทียบกันได้ต่อหมวด
export const SEGMENTS = ["Manufacturing","HomeLiving","FoodBeverage","HealthBeauty","Retail","ProfessionalServices",
  "AutoTransport","Hospitality","Technology","PetAnimal","ArtsCulture","RealEstate"];
export const SEG_TH = {
  Manufacturing:"ผลิตและวัสดุอุตสาหกรรม", HomeLiving:"บ้าน อาคาร และของใช้ในบ้าน",
  FoodBeverage:"อาหารและเครื่องดื่ม", HealthBeauty:"สุขภาพ ความงาม และเวลเนส",
  Retail:"ค้าปลีกและสินค้าอุปโภคบริโภค", ProfessionalServices:"บริการวิชาชีพและการตลาด",
  AutoTransport:"ยานยนต์และขนส่ง", Hospitality:"ที่พักและสันทนาการ",
  Technology:"เทคโนโลยีและการสื่อสาร", PetAnimal:"สัตว์เลี้ยงและสัตว์",
  ArtsCulture:"ศิลปะ วัฒนธรรม และบริการเฉพาะทาง", RealEstate:"อสังหาริมทรัพย์",
  Other:"ไม่ระบุหมวด" };
export const SEG_COLOR = {
  Manufacturing:"#33d69f", HomeLiving:"#c98500", FoodBeverage:"#ff5a3c", HealthBeauty:"#e87ba4",
  Retail:"#ffb02e", ProfessionalServices:"#8a7bff", AutoTransport:"#3987e5", Hospitality:"#34e0d0",
  Technology:"#26c6da", PetAnimal:"#9ccc65", ArtsCulture:"#6d7cff", RealEstate:"#b07be8",
  Other:"#8aa0be" };
export const SEG_ICON = {
  Manufacturing:"🏭", HomeLiving:"🛋️", FoodBeverage:"🍽️", HealthBeauty:"💄", Retail:"🛒",
  ProfessionalServices:"💼", AutoTransport:"🚗", Hospitality:"🏨", Technology:"💻",
  PetAnimal:"🐾", ArtsCulture:"🎨", RealEstate:"🏢", Other:"❓" };
// ไอคอนเส้น (outline) หมวดธุรกิจ — เนื้อใน SVG viewBox 24×24 จาก lucide (ISC/MIT) แทนอิโมจิ stock
// stroke=currentColor 2px กำหนดที่ตัวห่อ <svg> — ปรับสี/ขนาดจากภายนอกได้ ดู SegmentIcon/segIconSVG ใน lib.js
// คีย์ "Other" ไม่อยู่ใน SEGMENTS — เป็นตัวสำรองเมื่อเจอค่าหมวดที่ไม่รู้จัก (segKey ใน lib.js)
export const SEG_SVG = {
  Manufacturing:'<path d="M12 16h.01"/><path d="M16 16h.01"/><path d="M3 19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9.5a.5.5 0 0 0-.769-.422l-4.462 2.844A.5.5 0 0 1 15 11.5v-2a.5.5 0 0 0-.769-.422L9.77 11.922A.5.5 0 0 1 9 11.5V5a1 1 0 0 0-1-1H6a3 3 0 0 0-3 3z"/><path d="M8 16h.01"/>',
  HomeLiving:'<path d="M20 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v3"/><path d="M2 16a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0z"/><path d="M4 18v2"/><path d="M20 18v2"/><path d="M12 4v9"/>',
  FoodBeverage:'<path d="m16 2-2.3 2.3a3 3 0 0 0 0 4.2l1.8 1.8a3 3 0 0 0 4.2 0L22 8"/><path d="M15 15 3.3 3.3a4.2 4.2 0 0 0 0 6l7.3 7.3c.7.7 2 .7 2.8 0L15 15Zm0 0 7 7"/><path d="m2.1 21.8 6.4-6.3"/><path d="m19 5-7 7"/>',
  HealthBeauty:'<path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/><path d="M3.22 13H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27"/>',
  Retail:'<path d="M16 10a4 4 0 0 1-8 0"/><path d="M3.103 6.034h17.794"/><path d="M3.4 5.467a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.667a2 2 0 0 0-.4-1.2l-2-2.667A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z"/>',
  ProfessionalServices:'<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
  AutoTransport:'<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
  Hospitality:'<path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8"/><path d="M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4"/><path d="M12 4v6"/><path d="M2 18h20"/>',
  Technology:'<path d="M18 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h8"/><path d="M10 19v-3.96 3.15"/><path d="M7 19h5"/><rect width="6" height="10" x="16" y="12" rx="2"/>',
  PetAnimal:'<circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/>',
  ArtsCulture:'<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/><circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/>',
  RealEstate:'<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>',
  Other:'<path d="M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z"/><rect x="3" y="14" width="7" height="7" rx="1"/><circle cx="17.5" cy="17.5" r="3.5"/>' };
export const OTHER_COLOR = "#8aa0be";
// helper ปลอดจำนวนเซกเมนต์ (แทนการ hardcode {Hotel:...,Restaurant:...} 4 หมวดเดิม)
export const segZero    = ()  => Object.fromEntries(SEGMENTS.map(s=>[s,0]));
export const segAllTrue = ()  => Object.fromEntries(SEGMENTS.map(s=>[s,true]));
export const segOnly    = (s) => Object.fromEntries(SEGMENTS.map(x=>[x,x===s]));

// ═══════════════════════════════════════════════════════════════════════════
// แบบจำลอง "Lead สูง" (High-Demand Gap) — แทนการจัดเกรด A/B/C + คะแนนศักยภาพเดิม
// แนวคิด: ความร้อน (heat) ของพื้นที่ = "หมวดธุรกิจที่มีอุปสงค์ในพื้นที่นั้น แต่เครือข่าย Barter ยังขาด"
// ไม่ใช่การให้คะแนนศักยภาพรายบริษัท และไม่ใช้ข้อมูลรีวิวใด ๆ (ลูกค้าไม่มีข้อมูลรีวิว)
//   อุปสงค์ (demand) ต่อหมวด = จำนวนธุรกิจในหมวดนั้นที่ยังไม่อยู่ในเครือข่าย (Lead)
//   อุปทาน (supply)  ต่อหมวด = จำนวนสมาชิกเครือข่ายปัจจุบันในหมวดนั้น (ลูกค้า)
//   ช่องว่าง (gap)   ต่อหมวด = max(0, demand − supply)
// ข้อมูลจริงที่ใช้มีเพียง ชื่อธุรกิจ · หมวดหมู่ธุรกิจ · ที่อยู่ · อีเมล
// ═══════════════════════════════════════════════════════════════════════════

// ค่าอ้างอิงขนาดช่องว่าง (จำนวนราย) ที่ถือว่า "เต็มสเกล" ของแต่ละระดับพื้นที่
export const GAP_REF = { country:900, province:300, cluster:120, district:60 };
export const GAP_TH  = { High:"สูง", Medium:"ปานกลาง", Low:"ต่ำ" };

// ช่องว่างรายหมวดของพื้นที่หนึ่ง — เรียงจากหมวดที่ขาดมากสุด
export function gapBySegment(customers=[], prospects=[]){
  const demand = segZero(), supply = segZero();
  for(const p of prospects) if(demand[p.segment]!=null) demand[p.segment]++;
  for(const c of customers) if(supply[c.segment]!=null) supply[c.segment]++;
  return SEGMENTS.map(seg=>({ seg, demand:demand[seg], supply:supply[seg],
      gap: Math.max(0, demand[seg]-supply[seg]) }))
    .sort((a,b)=> b.gap-a.gap || b.demand-a.demand);
}

// ระดับช่องว่างจากดัชนี 0–100
export const gapLevelOf = s => s>=67 ? "High" : s>=34 ? "Medium" : "Low";

/* ดัชนี Lead สูง 0–100 ของพื้นที่ ประกอบด้วย 3 องค์ประกอบ
     ลึก (depth 45%)     = สัดส่วนอุปสงค์ที่ยังไม่ถูกเติม  → พื้นที่ที่ Lead ล้นเทียบสมาชิกที่มี
     กว้าง (breadth 25%) = สัดส่วนหมวดที่ยังขาด            → ขาดหลายหมวด = เติมได้หลายทาง
     ปริมาณ (volume 30%) = ขนาดช่องว่างเทียบค่าอ้างอิง      → พื้นที่เล็กที่ขาดไม่กี่รายไม่ควรร้อนเท่าเมืองใหญ่ */
export function demandGap(customers=[], prospects=[], ref=GAP_REF.district){
  const segs = gapBySegment(customers, prospects);
  const demandTotal = segs.reduce((a,x)=>a+x.demand, 0);
  const gapCount    = segs.reduce((a,x)=>a+x.gap, 0);
  const present     = segs.filter(x=>x.demand+x.supply>0).length;
  const missing     = segs.filter(x=>x.gap>0).length;
  const depth   = demandTotal ? gapCount/demandTotal : 0;
  const breadth = present ? missing/present : 0;
  const volume  = Math.min(1, gapCount/(ref||1));
  const gapScore = Math.round(100*(0.45*depth + 0.25*breadth + 0.30*volume));
  return { gapScore, gapLevel:gapLevelOf(gapScore), gapCount, demandTotal,
    gapDepth:+(depth*100).toFixed(0), gapBreadth:missing, segsPresent:present,
    gapSegs: segs.filter(x=>x.gap>0).slice(0,5),
    topGapSegment: (segs[0] && segs[0].gap>0) ? segs[0].seg : null };
}

// ── สเปกจังหวัด "พื้นที่โฟกัส" 4 จังหวัด ──
// ตั้งแต่รับข้อมูลลูกค้าจริงจาก Barter: **ลูกค้ามาจากไฟล์จริง** (data/source-customers.json) กระจายอยู่ 39 จังหวัด
// สเปกนี้จึงคุมเฉพาะ "Lead จำลอง" ซึ่งยังสร้างเฉพาะ 4 จังหวัดโฟกัส (มีข้อมูลอำเภอ/พิกัดอ้างอิงครบ)
// prospects = จำนวน Lead ตายตัวต่อจังหวัด · topSegment = หมวดที่ Lead เอนไปทาง (ใช้เอียงการสุ่ม)
// key = ชื่ออังกฤษที่ใช้ทั้งระบบ · th = ชื่อไทย · center = พิกัดกลางจังหวัด (Pattaya ใช้พิกัดเมืองพัทยา)
export const PROVINCES = [
  { key:"Bangkok Metropolis", th:"กรุงเทพมหานคร", prospects:540, topSegment:"Retail",       center:[100.55,13.75] },
  { key:"Pattaya",            th:"ชลบุรี",        prospects:320, topSegment:"Hospitality",        center:[100.8825,12.9236] },
  { key:"Phuket",             th:"ภูเก็ต",        prospects:280, topSegment:"Hospitality",        center:[98.35,7.95] },
  { key:"Chiang Mai",         th:"เชียงใหม่",     prospects:260, topSegment:"FoodBeverage", center:[98.99,18.79] },
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
/* ชื่อไทยของอำเภอ/เขตที่พบในข้อมูลจริงจาก Barter แต่อยู่นอก 4 จังหวัดนำร่อง
   DISTRICT_META เก็บได้เฉพาะอำเภอที่มีพิกัดกึ่งกลาง/สถิติประกอบ ส่วนตารางนี้ใช้แปลชื่ออย่างเดียว
   ทำให้คอลัมน์ "อำเภอ / เขต" ในทุกตารางเป็นภาษาไทยเหมือนคอลัมน์อื่น */
const DISTRICT_TH_EXTRA = {
  "Bang Bon":"บางบอน",
  "Bang Kapi":"บางกะปิ",
  "Bang Khae":"บางแค",
  "Bang Khen":"บางเขน",
  "Bang Kho Laem":"บางคอแหลม",
  "Bang Khun Thian":"บางขุนเทียน",
  "Bang Na":"บางนา",
  "Bang Phlat":"บางพลัด",
  "Bang Su":"บางซื่อ",
  "Bangkok Noi":"บางกอกน้อย",
  "Bangkok Yai":"บางกอกใหญ่",
  "Bung Kum":"บึงกุ่ม",
  "Din Daeng":"ดินแดง",
  "Don Mueang":"ดอนเมือง",
  "Dusit":"ดุสิต",
  "Khanna Yao":"คันนายาว",
  "Khlong Sam Wa":"คลองสามวา",
  "Khlong San":"คลองสาน",
  "Lak Si":"หลักสี่",
  "Lat Krabang":"ลาดกระบัง",
  "Lat Phrao":"ลาดพร้าว",
  "Min Buri":"มีนบุรี",
  "Nong Chok":"หนองจอก",
  "Nong Khaem":"หนองแขม",
  "Phasi Charoen":"ภาษีเจริญ",
  "Phaya Thai":"พญาไท",
  "Phra Khanong":"พระโขนง",
  "Prawet":"ประเวศ",
  "Rat Burana":"ราษฎร์บูรณะ",
  "Sai Mai":"สายไหม",
  "Samphanthawong":"สัมพันธวงศ์",
  "Saphan Sung":"สะพานสูง",
  "Suan Luang":"สวนหลวง",
  "Taling Chan":"ตลิ่งชัน",
  "Thawi Watthana":"ทวีวัฒนา",
  "Thawi Vadhana":"ทวีวัฒนา",
  "Thon Buri":"ธนบุรี",
  "Thung Khu":"ทุ่งครุ",
  "Wang Thong Lang":"วังทองหลาง",
  "Yan Nawa":"ยานนาวา",
  "Yannawa":"ยานนาวา",
  "Vadhana":"วัฒนา",
  "Mueang Nonthaburi":"เมืองนนทบุรี",
  "Bang Bua Thong":"บางบัวทอง",
  "Bang Kruai":"บางกรวย",
  "Bang Yai":"บางใหญ่",
  "Pak Kret":"ปากเกร็ด",
  "Sai Noi":"ไทรน้อย",
  "Mueang Pathum Thani":"เมืองปทุมธานี",
  "Khlong Luang":"คลองหลวง",
  "Lam Luk Ka":"ลำลูกกา",
  "Lat Lum Kaeo":"ลาดหลุมแก้ว",
  "Nong Suea":"หนองเสือ",
  "Sam Khok":"สามโคก",
  "Thanyaburi":"ธัญบุรี",
  "Mueang Samut Prakan":"เมืองสมุทรปราการ",
  "Bang Bo":"บางบ่อ",
  "Bang Phli":"บางพลี",
  "Bang Sao Thong":"บางเสาธง",
  "Phra Pradaeng":"พระประแดง",
  "Phra Samut Chedi":"พระสมุทรเจดีย์",
  "Mueang Nakhon Pathom":"เมืองนครปฐม",
  "Bang Len":"บางเลน",
  "Don Tum":"ดอนตูม",
  "Nakhon Chai Si":"นครชัยศรี",
  "Phutthamonthon":"พุทธมณฑล",
  "Sam Phran":"สามพราน",
  "Mueang Samut Sakhon":"เมืองสมุทรสาคร",
  "Ban Phaeo":"บ้านแพ้ว",
  "Krathum Baen":"กระทุ่มแบน",
  "Bang Khonthi":"บางคนที",
  "Phra Nakhon Si Ayutthaya":"พระนครศรีอยุธยา",
  "Bang Pa-In":"บางปะอิน",
  "Bang Pa-in":"บางปะอิน",
  "Bang Sai":"บางไทร",
  "Lat Bua Luang":"ลาดบัวหลวง",
  "Phachi":"ภาชี",
  "Uthai":"อุทัย",
  "Mueang Chon Buri":"เมืองชลบุรี",
  "Ban Bueng":"บ้านบึง",
  "Mueang Rayong":"เมืองระยอง",
  "Klaeng":"แกลง",
  "Nikhom Phatthana":"นิคมพัฒนา",
  "Tha Mai":"ท่าใหม่",
  "Ko Chang":"เกาะช้าง",
  "Ko Kut":"เกาะกูด",
  "Mueang Chachoengsao":"เมืองฉะเชิงเทรา",
  "Bang Nam Priao":"บางน้ำเปรี้ยว",
  "Pleang Yao":"แปลงยาว",
  "Kabin Buri":"กบินทร์บุรี",
  "Mueang Nakhon Nayok":"เมืองนครนายก",
  "Ban Na":"บ้านนา",
  "Ongkharak":"องครักษ์",
  "Mueang Ratchaburi":"เมืองราชบุรี",
  "Bang Phae":"บางแพ",
  "Photharam":"โพธาราม",
  "Tha Yang":"ท่ายาง",
  "Kaeng Krachan":"แก่งกระจาน",
  "Hua Hin":"หัวหิน",
  "Bang Saphan Noi":"บางสะพานน้อย",
  "Sangkhla Buri":"สังขละบุรี",
  "Mueang Chiang Rai":"เมืองเชียงราย",
  "Mueang Lamphun":"เมืองลำพูน",
  "Ban Thi":"บ้านธิ",
  "Mae Tha":"แม่ทา",
  "Pa Sang":"ป่าซาง",
  "Wiang Nong Long":"เวียงหนองล่อง",
  "Mueang Lampang":"เมืองลำปาง",
  "Hang Chat":"ห้างฉัตร",
  "Mueang Pan":"เมืองปาน",
  "Mueang Phitsanulok":"เมืองพิษณุโลก",
  "Mueang Nakhon Sawan":"เมืองนครสวรรค์",
  "Khlong Khlung":"คลองขลุง",
  "Mueang Khon Kaen":"เมืองขอนแก่น",
  "Nong Song Hong":"หนองสองห้อง",
  "Mueang Nakhon Ratchasima":"เมืองนครราชสีมา",
  "Pak Chong":"ปากช่อง",
  "Dan Khun Thot":"ด่านขุนทด",
  "Mueang Yang":"เมืองยาง",
  "Mueang Maha Sarakham":"เมืองมหาสารคาม",
  "Kantharawichai":"กันทรวิชัย",
  "Mueang Surin":"เมืองสุรินทร์",
  "Kantharalak":"กันทรลักษ์",
  "Mueang Nong Khai":"เมืองหนองคาย",
  "Phu Kradueng":"ภูกระดึง",
  "Nong Phai":"หนองไผ่",
  "Mueang Krabi":"เมืองกระบี่",
  "Ko Lanta":"เกาะลันตา",
  "Mueang Nakhon Si Thammarat":"เมืองนครศรีธรรมราช",
  "Mueang Pattani":"เมืองปัตตานี",
  "Mueang Sing Buri":"เมืองสิงห์บุรี",
};
export const DISTRICT_TH = { ...DISTRICT_TH_EXTRA,
  ...Object.values(DISTRICT_META).flat().reduce((m,[en,th])=>{ m[en]=th; return m; }, {}) };
export const DISTRICT_CENTER = Object.values(DISTRICT_META).flat()
  .reduce((m,[en,,,lat,lng])=>{ m[en]={lat,lng}; return m; }, {});

// ── validate: บังคับกฎความสอดคล้องก่อนเขียนไฟล์ — throw ถ้าไม่ผ่าน ──
// เปลี่ยนจากเดิม (ยอดลูกค้าตายตัว 4 จังหวัด) เพราะ **ลูกค้าเป็นข้อมูลจริงจาก Barter** แล้ว
//   ลูกค้า : ตรวจว่าอยู่ในไทย · มีชื่อ/จังหวัด/อำเภอ · หมวดอยู่ใน 12 หมวด · พิกัดในกรอบไทย · รหัสไม่ซ้ำ (จังหวัดมีได้ทั้ง 77)
//   Lead  : ยังเป็นข้อมูลจำลอง จึงคุมเข้มเหมือนเดิม — เฉพาะ 4 จังหวัดโฟกัส ยอดต่อจังหวัดตรงสเปก อำเภอ ≥ 6
export function validateGeoData({customers, prospects}){
  const err = [];
  const only = new Set(PROVINCE_KEYS);
  const segs = new Set(SEGMENTS);

  // 1) ลูกค้า (ข้อมูลจริง)
  const ids = new Set();
  for(const c of customers){
    const at = "ลูกค้า " + c.id + ": ";
    if(c.country !== "Thailand") err.push(at + "ประเทศนอกไทย — " + c.country);
    if(!c.province)     err.push(at + "ไม่มีจังหวัด");
    if(!c.district)     err.push(at + "ไม่มีอำเภอ/เขต");
    if(!c.businessName) err.push(at + "ไม่มีชื่อธุรกิจ");
    if(!segs.has(c.segment)) err.push(at + "หมวดธุรกิจนอกชุด 12 หมวด — " + c.segment);
    if(!(c.latitude >= 5.5 && c.latitude <= 20.6 && c.longitude >= 97 && c.longitude <= 106))
      err.push(at + "พิกัดนอกกรอบประเทศไทย — " + c.latitude + "," + c.longitude);
    if(ids.has(c.id)) err.push("รหัสลูกค้าซ้ำ: " + c.id); else ids.add(c.id);
  }

  // 2) Lead (ข้อมูลจำลอง) — เฉพาะ 4 จังหวัดโฟกัส และยอดต้องตรงสเปก
  for(const p of prospects){
    const at = "Lead " + p.id + ": ";
    if(p.country !== "Thailand") err.push(at + "ประเทศนอกไทย");
    if(!only.has(p.province))    err.push(at + "จังหวัดนอก 4 จังหวัดโฟกัส — " + p.province);
    if(!segs.has(p.segment))     err.push(at + "หมวดธุรกิจนอกชุด 12 หมวด — " + p.segment);
  }
  for(const sp of PROVINCES){
    const ps = prospects.filter(p => p.province === sp.key);
    if(ps.length !== sp.prospects) err.push(sp.key + ": Lead " + ps.length + " ≠ " + sp.prospects);
    const dist = new Set(ps.map(x => x.district));
    if(dist.size < 6) err.push(sp.key + ": Lead ครอบคลุมอำเภอ " + dist.size + " < 6");
  }
  const totP = PROVINCES.reduce((a, p) => a + p.prospects, 0);
  if(prospects.length !== totP) err.push("Lead รวม " + prospects.length + " ≠ " + totP);

  if(err.length) throw new Error("ข้อมูลไม่สอดคล้องตามกฎ:\n - " + err.slice(0, 20).join("\n - ")
    + (err.length > 20 ? "\n   … และอีก " + (err.length - 20) + " ข้อ" : ""));
  return true;
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

// ═══ พิกัด → จังหวัด/โซน (ใช้ validate ขอบเขต + บอกระดับ Lead ของโซนในฟอร์ม) ═══
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
// คืน {out} ถ้านอกพื้นที่ · มิฉะนั้น {province, district, gap} = ระดับ Lead ของอำเภอที่ใกล้พิกัดสุด
export function zoneOf(lat,lng, districts=[]){
  const prov=provinceOf(lat,lng); if(!prov) return {out:true};
  let best=null, bd=Infinity;
  for(const [en,,,dlat,dlng] of (DISTRICT_META[prov]||[])){ const d=(lat-dlat)**2+(lng-dlng)**2; if(d<bd){bd=d;best=en;} }
  const rec=(districts||[]).find(x=>x.province===prov&&x.district===best);
  return { out:false, province:prov, district:best, gap: rec?rec.gapLevel:"Low" };
}
