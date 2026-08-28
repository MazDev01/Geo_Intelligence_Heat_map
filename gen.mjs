import {readFile, writeFile} from 'node:fs/promises';
import {PROVINCES, PROVINCE_KEYS, DISTRICT_META, SEGMENTS as SEG, GAP_REF, demandGap, validateGeoData, segZero} from './src/mock/geoData.js';
import {makeRounds, deriveVisitStatus} from './src/visit-rounds.js';

// ═══════════════════════════════════════════════════════════════════════════
// gen.mjs — สร้างไฟล์ข้อมูลใน data/ ให้แอปอ่าน
//   ลูกค้า (customers) = **ข้อมูลจริงจาก Barter** อ่านตรงจาก data/source-customers.json (ไม่สุ่ม ไม่แต่งเติม)
//                        1,662 ราย · 39 จังหวัด · 12 หมวดธุรกิจ · ฟิลด์ที่มีคือ ชื่อ/หมวด/ที่อยู่/จังหวัด/อำเภอ/
//                        พิกัด/โทรศัพท์/เว็บไซต์/เฟซบุ๊ก/วันที่เริ่มเป็นลูกค้า — **ไม่มียอดขายและไม่มีสถานะการค้า**
//   Lead (prospects)   = ยังเป็นข้อมูลจำลอง สร้างเฉพาะ 4 จังหวัดโฟกัส ตามยอดใน PROVINCES
// สร้างซ้ำได้: `node gen.mjs` (RNG เป็น seed คงที่ → Lead ชุดเดิมทุกครั้ง)
// ═══════════════════════════════════════════════════════════════════════════

// ---------- deterministic RNG ----------
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const R = mulberry32(20260711);
const pick = arr => arr[Math.floor(R()*arr.length)];
const rint = (a,b)=>Math.floor(a+R()*(b-a+1));

// ---------- province geometry ----------
// หมายเหตุ: geojson ถูกแก้ property name ของ feature ชายฝั่งตะวันออก เป็น "Pattaya" แล้ว (พัทยาใช้ขอบเขตพื้นที่ชายฝั่งตะวันออกเดิม)
const prov = JSON.parse(await readFile('data/thailand-provinces.geojson','utf8'));
function outerRings(geom){
  if(geom.type==='Polygon') return [geom.coordinates[0]];
  if(geom.type==='MultiPolygon') return geom.coordinates.map(p=>p[0]);
  return [];
}
function bboxOf(rings){let x0=180,y0=90,x1=-180,y1=-90;for(const r of rings)for(const c of r){x0=Math.min(x0,c[0]);x1=Math.max(x1,c[0]);y0=Math.min(y0,c[1]);y1=Math.max(y1,c[1]);}return[x0,y0,x1,y1];}
function centroidOf(rings){let sx=0,sy=0,n=0;for(const r of rings)for(const c of r){sx+=c[0];sy+=c[1];n++;}return[+(sx/n).toFixed(4),+(sy/n).toFixed(4)];}
function pip(pt,ring){let x=pt[0],y=pt[1],inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1];if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))inside=!inside;}return inside;}
function inProvince(pt,rings){return rings.some(r=>pip(pt,r));}

const PROV = {};
for(const f of prov.features){const rings=outerRings(f.geometry);PROV[f.properties.name]={rings,bbox:bboxOf(rings),center:centroidOf(rings)};}

// ---------- อำเภอ/เขต ของ 4 จังหวัดโฟกัส (ใช้กระจาย Lead จำลอง) ----------
// [ชื่ออังกฤษ, น้ำหนักกระจายข้อมูล]
const DISTRICTS = Object.fromEntries(
  Object.entries(DISTRICT_META).map(([prov,list])=>[prov, list.map(([en,,w])=>[en,w])]));
function districtFor(province){
  const list = DISTRICTS[province]; if(!list) return null;
  const total = list.reduce((a,d)=>a+d[1],0); let r = R()*total;
  for(const [name,w] of list){ if(r<w) return name; r-=w; } return list[list.length-1][0];
}

// ═══════════ 1) ลูกค้า — ข้อมูลจริง อ่านตรงจากไฟล์ ไม่มีการสุ่มใด ๆ ═══════════
const SOURCE = JSON.parse(await readFile('data/source-customers.json','utf8'));
const customers = SOURCE.map(r=>({
  id:r.id,                       // = รหัสลูกค้าจากระบบเดิม (AccountNo) · ต่อท้าย -2/-3 เมื่อหนึ่งบัญชีมีหลายสาขา
  accountNo:r.accountNo,
  businessName:r.businessName,
  segment:r.segment,
  status:'Existing',
  country:'Thailand',
  province:r.province,
  district:r.district,
  address:r.address,
  latitude:r.latitude,
  longitude:r.longitude,
  phone:r.phone,
  website:r.website,
  facebook:r.facebook,
  dateJoin:r.dateJoin,           // วันที่เริ่มเป็นลูกค้า (จากไฟล์)
  created_at:r.dateJoin,         // ฟิลด์ที่ตัวกรองช่วงเวลาทั้งระบบใช้ = วันที่เริ่มเป็นลูกค้า
}));

// ═══════════ 2) Lead — ข้อมูลจำลอง เฉพาะ 4 จังหวัดโฟกัส ═══════════
const PFX=['ABC','Grand','Royal','Riverside','Sunset','Emerald','Golden','Ocean','Metro','Central','Lotus','Sapphire','Orchid','Bamboo','Nova','Aster','Siam','Baan','Chao','Thara','Imperial','Prime','Summit','Vista','Lumpini','Andaman','Mekong'];
const SFX={
  Manufacturing:['Industry','Manufacturing','Supplies','Works','Materials'],
  HomeLiving:['Furniture','Home','Decor','Living','Interior'],
  FoodBeverage:['Restaurant','Kitchen','Bistro','Cafe','Eatery','Seafood'],
  HealthBeauty:['Clinic','Spa','Salon','Wellness','Beauty','Aesthetic'],
  Retail:['Mall','Plaza','Store','Mart','Outlet','Emporium'],
  ProfessionalServices:['Agency','Consulting','Partners','Advisory','Media','Creative'],
  AutoTransport:['Auto','Garage','Motors','Logistics','Transport'],
  Hospitality:['Hotel','Resort','Suites','Residence','Bay Resort','Boutique Hotel'],
  Technology:['Tech','Digital','Electronics','Systems','IT Solutions'],
  PetAnimal:['Pet Shop','Animal Care','Pet Clinic','Grooming'],
  ArtsCulture:['Studio','Gallery','Atelier','Craft','Workshop'],
  RealEstate:['Property','Estate','Residence','Land','Realty'] };
const ROADS=['Sukhumvit','Rama IX','Phahonyothin','Silom','Charoen Krung','Ratchada','Beach','Nimman'];
const SEGMENTS=SEG;
const bizName=seg=>pick(PFX)+' '+pick(SFX[seg]);
const segFor=top=> R()<0.45? top : pick(SEGMENTS);
// อีเมลของ Lead (ข้อมูลจำลอง — Lead ยังไม่ใช่ลูกค้า จึงยังไม่มีข้อมูลติดต่อจริงในระบบ)
const MAIL_DOMAINS=['gmail.com','hotmail.com','outlook.co.th','yahoo.com'];
const slug = n => n.toLowerCase().replace(/[^a-z0-9]+/g,'').slice(0,18);
const emailOf = (name,id)=> R()<0.55
  ? 'contact@'+slug(name)+id.slice(-3)+'.co.th'
  : slug(name)+id.slice(-3)+'@'+pick(MAIL_DOMAINS);

let pSeq=1;
const prospects=[];
function samplePoint(name){
  const p=PROV[name]; if(!p) return null;
  const b=p.bbox;
  for(let k=0;k<60;k++){const pt=[b[0]+R()*(b[2]-b[0]),b[1]+R()*(b[3]-b[1])];if(inProvince(pt,p.rings))return pt;}
  return p.center;
}
function addProspect(country,province,lng,lat,seg){
  const id='PRO'+String(pSeq++).padStart(5,'0'), name=bizName(seg);
  prospects.push({id,businessName:name,category:seg,segment:seg,status:'Prospect',country,province,district:districtFor(province),address:rint(1,999)+' '+pick(ROADS)+' Rd',email:emailOf(name,id),latitude:+lat.toFixed(4),longitude:+lng.toFixed(4)});
}
for(const sp of PROVINCES){
  for(let i=0;i<sp.prospects;i++){const pt=samplePoint(sp.key);if(pt)addProspect('Thailand',sp.key,pt[0],pt[1],segFor(sp.topSegment));}
}

// ═══════════ 3) areas.json — ทุกจังหวัดที่มีลูกค้าหรือ Lead (ไม่ใช่แค่ 4 จังหวัดแล้ว) ═══════════
const provNames = [...new Set([...customers.map(c=>c.province), ...prospects.map(p=>p.province)])]
  .filter(n=>PROV[n]);
const areas=[];
for(const name of provNames){
  const cs=customers.filter(c=>c.province===name);
  const ps=prospects.filter(p=>p.province===name);
  const dist=segZero();cs.forEach(c=>dist[c.segment]++);ps.forEach(p=>dist[p.segment]++);
  const g=demandGap(cs,ps,GAP_REF.province);
  const b=PROV[name].bbox;
  areas.push({province:name,center:PROV[name].center,customerCount:cs.length,prospectCount:ps.length,
    coverage:(cs.length+ps.length)?Math.min(100,Math.round(cs.length/(cs.length+ps.length)*100)):0,
    density:+(cs.length/((b[2]-b[0])*(b[3]-b[1])+.01)).toFixed(1),
    gapScore:g.gapScore,gapLevel:g.gapLevel,gapCount:g.gapCount,gapDepth:g.gapDepth,gapBreadth:g.gapBreadth,
    topGapSegment:g.topGapSegment,gapSegs:g.gapSegs,
    topSegment:Object.entries(dist).sort((a,b)=>b[1]-a[1])[0][0],segmentDistribution:dist});
}
areas.sort((a,b)=>b.gapScore-a.gapScore);

// ═══════════ 4) districts.json — ระดับอำเภอ/เขต สร้างจากข้อมูลที่มีจริง ═══════════
const dkeys = new Map();
for(const r of customers.concat(prospects)){
  if(!r.district) continue;
  const k=r.province+'|'+r.district;
  if(!dkeys.has(k)) dkeys.set(k,{province:r.province,district:r.district});
}
const districts=[];
for(const {province,district} of dkeys.values()){
  const cs=customers.filter(c=>c.province===province&&c.district===district);
  const ps=prospects.filter(p=>p.province===province&&p.district===district);
  if(cs.length+ps.length===0)continue;
  const dist=segZero();cs.forEach(c=>dist[c.segment]++);ps.forEach(p=>dist[p.segment]++);
  const g=demandGap(cs,ps,GAP_REF.district);
  districts.push({province,district,customerCount:cs.length,prospectCount:ps.length,
    coverage:Math.min(100,Math.round(cs.length/(cs.length+ps.length)*100)),
    gapScore:g.gapScore,gapLevel:g.gapLevel,gapCount:g.gapCount,gapDepth:g.gapDepth,gapBreadth:g.gapBreadth,
    topGapSegment:g.topGapSegment,gapSegs:g.gapSegs,
    topSegment:Object.entries(dist).sort((a,b)=>b[1]-a[1])[0][0],segmentDistribution:dist});
}
districts.sort((a,b)=>b.gapScore-a.gapScore);

// ═══════════ 5) countries.json ═══════════
const countries=[];
{
  const cs=customers, ps=prospects;
  const g=demandGap(cs,ps,GAP_REF.country);
  countries.push({country:'Thailand',center:[13.0,101.0],customerCount:cs.length,prospectCount:ps.length,coverage:Math.min(100,Math.round(cs.length/(cs.length+ps.length)*100)),gapScore:g.gapScore,gapLevel:g.gapLevel,gapCount:g.gapCount,gapDepth:g.gapDepth,gapBreadth:g.gapBreadth,topGapSegment:g.topGapSegment,gapSegs:g.gapSegs,hasProvinces:true});
}

// ---------- วันที่เพิ่ม Lead เข้าระบบ (created_at) — ตัวสุ่มแยก RT ----------
// ลูกค้าใช้ dateJoin จากไฟล์จริงเป็น created_at อยู่แล้ว จึงเหลือแค่ Lead ที่ต้องสุ่ม
const RT = mulberry32(20260713);
const rtint = (a,b)=>Math.floor(a+RT()*(b-a+1));
const ANCHOR = Date.UTC(2026,6,13);
const backToISO = d => new Date(ANCHOR - d*864e5).toISOString().slice(0,10);
for(const p of prospects){
  const back = RT()<0.35 ? rtint(352,365) : Math.round(350*Math.pow(RT(),1.7));
  p.created_at = backToISO(back);
}

// ---------- ทีมผู้ประสานงานการค้า (TC) + สถานะการเข้าพบ — ตัวสุ่มแยก RTC ----------
const RTC = mulberry32(20260714);
// จุดยึด TC ตามภูมิภาคของ 4 จังหวัดโฟกัส (2 จุดในกรุงเทพฯ เพื่อให้เกิดพื้นที่ทับซ้อนในเมือง)
const TC_SEEDS = [
  {tc:'ธนพล ศรีวัฒน์',       lat:18.79, lng:98.98},   // เชียงใหม่
  {tc:'ณัฐริกา พงษ์ไพบูลย์', lat:13.86, lng:100.62},  // กรุงเทพฯ ตอนเหนือ-ตะวันออก
  {tc:'กิตติศักดิ์ อารยะกุล', lat:13.66, lng:100.45},  // กรุงเทพฯ ตอนใต้-ตะวันตก
  {tc:'ศุภมาส เจริญสุข',      lat:12.93, lng:100.90},  // พัทยา (ภาคตะวันออก)
  {tc:'ปิยะนุช วงศ์สกุล',     lat:7.90,  lng:98.40},   // ภูเก็ต (ภาคใต้)
];
const FOCUS = new Set(PROVINCE_KEYS);
const idHash = id => { let h=0; for(let i=0;i<id.length;i++) h=(h*31+id.charCodeAt(i))>>>0; return h; };
const assignTC = (lat,lng,id)=>{
  const ds=TC_SEEDS.map(s=>({tc:s.tc, d:(lat-s.lat)*(lat-s.lat)+(lng-s.lng)*(lng-s.lng)})).sort((a,b)=>a.d-b.d);
  const near=ds[0], second=ds[1];
  if(second && second.d <= near.d*2.0 && (idHash(id)&1)) return second.tc;
  return near.tc;
};
// ลูกค้านอก 4 จังหวัดโฟกัส = ยังไม่มี TC ดูแล (พื้นที่ไร้ผู้ดูแล — ดูหน้า "จัดการขอบเขตพื้นที่การขาย")
for(const c of customers) c.tc_owner = FOCUS.has(c.province) ? assignTC(c.latitude, c.longitude, c.id) : null;
for(const p of prospects) p.tc_owner = assignTC(p.latitude, p.longitude, p.id);
// ── รอบการเข้าพบ (visit rounds) — สถานะ Lead derive จากรอบ ──
// สัดส่วนสถานการณ์: รอเข้าพบ 50% · นัดหมายแล้ว 15% · รอรอบถัดไป 20% · ใกล้ปิดการขาย 5% · ปิดโอกาส 10%
const isoBack = d => backToISO(d);                     // d>0 = อดีต · d<0 = อนาคต
const pickScenario = ()=>{ const r=RTC();
  return r<0.50?"waiting": r<0.65?"appointment": r<0.85?"followup": r<0.90?"hot":"lost"; };
for(const p of prospects){
  const sc = pickScenario();
  p.visitRounds = makeRounds(sc, p.tc_owner, RTC, isoBack);
  p.visit_status = deriveVisitStatus(p.visitRounds);
}

// ---------- ตรวจกฎความสอดคล้องก่อนเขียนไฟล์ — throw ถ้าไม่ผ่าน ----------
validateGeoData({customers, prospects});

await writeFile('data/customers.json',JSON.stringify(customers));
await writeFile('data/prospects.json',JSON.stringify(prospects));
await writeFile('data/areas.json',JSON.stringify(areas));
await writeFile('data/districts.json',JSON.stringify(districts));
await writeFile('data/countries.json',JSON.stringify(countries,null,2));
console.log('✓ ผ่าน validate · ลูกค้า(จริง):',customers.length,'· Lead(จำลอง):',prospects.length,'· จังหวัด:',areas.length,'· อำเภอ/เขต:',districts.length);
const noTC = customers.filter(c=>!c.tc_owner);
console.log('  ลูกค้าที่ยังไม่มี TC ดูแล (นอก 4 จังหวัดโฟกัส):',noTC.length,'ราย ใน',new Set(noTC.map(c=>c.province)).size,'จังหวัด');
for(const a of areas.slice(0,8)){
  const sp=PROVINCES.find(x=>x.key===a.province);
  console.log(`  ${sp?sp.th:a.province}: ลูกค้า ${a.customerCount} · Lead ${a.prospectCount} · Lead ${a.gapScore} (${a.gapLevel}) · หมวดที่ขาดสุด ${a.topGapSegment}`);
}
