import {readFile, writeFile} from 'node:fs/promises';
import {PROVINCES, PROVINCE_KEYS, DISTRICT_META, SEGMENTS as SEG, GRADE_BANDS, gradeCounts, validateGeoData, segZero} from './src/mock/geoData.js';
import {makeRounds, deriveVisitStatus} from './src/visit-rounds.js';

// ---------- deterministic RNG ----------
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const R = mulberry32(20260711);
const pick = arr => arr[Math.floor(R()*arr.length)];
const rint = (a,b)=>Math.floor(a+R()*(b-a+1));
const rflt = (a,b)=>+(a+R()*(b-a)).toFixed(4);

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

// ---------- อำเภอ/เขต (จาก geoData single source) ----------
// [ชื่ออังกฤษ, น้ำหนักกระจายข้อมูล]
const DISTRICTS = Object.fromEntries(
  Object.entries(DISTRICT_META).map(([prov,list])=>[prov, list.map(([en,,w])=>[en,w])]));
function districtFor(province){
  const list = DISTRICTS[province]; if(!list) return null;
  const total = list.reduce((a,d)=>a+d[1],0); let r = R()*total;
  for(const [name,w] of list){ if(r<w) return name; r-=w; } return list[list.length-1][0];
}

// ---------- naming ----------
const PFX=['ABC','Grand','Royal','Riverside','Sunset','Emerald','Golden','Ocean','Metro','Central','Lotus','Sapphire','Orchid','Bamboo','Nova','Aster','Siam','Baan','Chao','Thara','Imperial','Prime','Summit','Vista','Lumpini','Andaman','Mekong'];
const SFX={
  FoodBeverage:['Restaurant','Kitchen','Bistro','Cafe','Eatery','Seafood'],
  HealthBeauty:['Clinic','Spa','Salon','Wellness','Beauty','Aesthetic'],
  Hotel:['Hotel','Resort','Suites','Residence','Bay Resort','Boutique Hotel'],
  MarketingEvents:['Agency','Studio','Events','Media','Creative'],
  AutoTransport:['Auto','Garage','Motors','Logistics','Transport'],
  HomeLiving:['Furniture','Home','Decor','Living','Interior'],
  Education:['Academy','School','Institute','Learning','Tutoring'],
  BusinessServices:['Consulting','Partners','Services','Office','Advisory'],
  Retail:['Mall','Plaza','Store','Mart','Outlet','Emporium'],
  ITElectronics:['Tech','Digital','Electronics','Systems','IT Solutions'],
  CleaningMaintenance:['Cleaning','Service','Maintenance','Care','Facility'],
  Other:['Group','Center','Enterprise','Co'] };
const TYPE={FoodBeverage:'อาหารและเครื่องดื่ม',HealthBeauty:'สุขภาพและความงาม',Hotel:'โรงแรมและที่พัก',
  MarketingEvents:'การตลาดและอีเวนต์',AutoTransport:'ยานยนต์และขนส่ง',HomeLiving:'บ้านและเฟอร์นิเจอร์',
  Education:'การศึกษาและฝึกอบรม',BusinessServices:'บริการธุรกิจและวิชาชีพ',Retail:'ค้าปลีกและอุปโภคบริโภค',
  ITElectronics:'ไอทีและอิเล็กทรอนิกส์',CleaningMaintenance:'ทำความสะอาดและซ่อมบำรุง',Other:'อื่น ๆ'};
const ROADS=['Sukhumvit','Rama IX','Phahonyothin','Silom','Charoen Krung','Ratchada','Beach','Nimman'];
const SEGMENTS=SEG;
const bizName=seg=>pick(PFX)+' '+pick(SFX[seg]);
const segFor=top=> R()<0.45? top : pick(SEGMENTS);
const dateStr=()=>{const d=rint(0,330);const t=new Date(Date.UTC(2026,6,11)-d*864e5);return t.toISOString().slice(0,10);};
const oppFromRatio=(pot,ratio)=>Math.min(100,Math.round(0.55*pot+0.45*Math.min(100,ratio*7)));

let cSeq=1,pSeq=1;
const customers=[], prospects=[];

function samplePoint(name){
  const p=PROV[name]; if(!p) return null;
  const b=p.bbox;
  for(let k=0;k<60;k++){const pt=[b[0]+R()*(b[2]-b[0]),b[1]+R()*(b[3]-b[1])];if(inProvince(pt,p.rings))return pt;}
  return p.center;
}
function addCustomer(country,province,lng,lat,seg){
  const pot=rint(45,99);
  customers.push({id:'CUS'+String(cSeq++).padStart(5,'0'),businessName:bizName(seg),businessType:TYPE[seg],segment:seg,status:'Existing',country,province,district:districtFor(province),address:rint(1,999)+' '+pick(ROADS)+' Rd',latitude:+lat.toFixed(4),longitude:+lng.toFixed(4),salesValue:rint(60,1500)*1000,tradingStatus:pick(['Active','Active','Active','Dormant','At Risk']),lastPurchaseDate:dateStr(),potentialScore:pot,opportunityScore:oppFromRatio(pot,6)});
}
function addProspect(country,province,lng,lat,seg){
  prospects.push({id:'PRO'+String(pSeq++).padStart(5,'0'),businessName:bizName(seg),category:seg,segment:seg,status:'Prospect',country,province,district:districtFor(province),address:rint(1,999)+' '+pick(ROADS)+' Rd',latitude:+lat.toFixed(4),longitude:+lng.toFixed(4),rating:rflt(3.2,5),reviewCount:rint(15,1600),hasWebsite:R()<0.55,hasPhone:R()<0.8});
}

// ---------- สร้างข้อมูล 4 จังหวัด (ยอดคงที่ตามสเปก geoData) ----------
for(const sp of PROVINCES){
  for(let i=0;i<sp.customers;i++){const pt=samplePoint(sp.key);if(pt)addCustomer('Thailand',sp.key,pt[0],pt[1],segFor(sp.topSegment));}
  for(let i=0;i<sp.prospects;i++){const pt=samplePoint(sp.key);if(pt)addProspect('Thailand',sp.key,pt[0],pt[1],segFor(sp.topSegment));}
}

// ---------- ให้คะแนนผู้มุ่งหวัง = บังคับสัดส่วนเกรด A:B:C = 45:30:25 ต่อจังหวัด (ข้อ 7.2) ----------
// A=80-100 · B=60-79 · C=<60 · คะแนนภายในแต่ละแถบสุ่มแบบ deterministic (คงที่ทุกครั้งที่ gen)
for(const sp of PROVINCES){
  const ps = prospects.filter(p=>p.province===sp.key);
  const g = gradeCounts(sp.prospects);   // {A,B,C}
  const ratio = sp.customers ? sp.prospects/sp.customers : sp.prospects;
  ps.forEach((p,i)=>{
    const band = i<g.A ? 'A' : i<g.A+g.B ? 'B' : 'C';
    const [lo,hi] = GRADE_BANDS[band];
    p.potentialScore = lo + Math.floor(R()*(hi-lo+1));
    p.grade = band;
    p.opportunityScore = oppFromRatio(p.potentialScore, ratio);
  });
}

// ---------- areas.json (4 จังหวัด) ----------
const areas=[];
for(const sp of PROVINCES){
  const name=sp.key;
  const cs=customers.filter(c=>c.province===name);
  const ps=prospects.filter(p=>p.province===name);
  const dist=segZero();cs.forEach(c=>dist[c.segment]++);ps.forEach(p=>dist[p.segment]++);
  const avgPot=ps.length?Math.round(ps.reduce((a,p)=>a+p.potentialScore,0)/ps.length):0;
  const ratio=cs.length?ps.length/cs.length:ps.length;
  const b=PROV[name].bbox;
  areas.push({province:name,center:PROV[name].center,customerCount:cs.length,prospectCount:ps.length,avgPotentialScore:avgPot,coverage:Math.min(100,Math.round(cs.length/(cs.length+ps.length)*100)),density:+(cs.length/((b[2]-b[0])*(b[3]-b[1])+.01)).toFixed(1),salesTotal:cs.reduce((a,c)=>a+c.salesValue,0),opportunityScore:oppFromRatio(avgPot,ratio),marketGap:ratio>=10?'High':ratio>=5?'Medium':'Low',topSegment:Object.entries(dist).sort((a,b)=>b[1]-a[1])[0][0],segmentDistribution:dist});
}
areas.sort((a,b)=>b.opportunityScore-a.opportunityScore);

// ---------- districts.json (ระดับอำเภอ/เขต — ทั้ง 4 จังหวัด) ----------
const districts=[];
for(const [province,list] of Object.entries(DISTRICTS)){
  for(const [name] of list){
    const cs=customers.filter(c=>c.province===province&&c.district===name);
    const ps=prospects.filter(p=>p.province===province&&p.district===name);
    if(cs.length+ps.length===0)continue;
    const dist=segZero();cs.forEach(c=>dist[c.segment]++);ps.forEach(p=>dist[p.segment]++);
    const avgPot=ps.length?Math.round(ps.reduce((a,p)=>a+p.potentialScore,0)/ps.length):0;
    const ratio=cs.length?ps.length/cs.length:ps.length;
    districts.push({province,district:name,customerCount:cs.length,prospectCount:ps.length,avgPotentialScore:avgPot,
      coverage:Math.min(100,Math.round(cs.length/(cs.length+ps.length)*100)),salesTotal:cs.reduce((a,c)=>a+c.salesValue,0),
      opportunityScore:oppFromRatio(avgPot,ratio),marketGap:ratio>=10?'High':ratio>=5?'Medium':'Low',
      topSegment:Object.entries(dist).sort((a,b)=>b[1]-a[1])[0][0],segmentDistribution:dist});
  }
}
districts.sort((a,b)=>b.opportunityScore-a.opportunityScore);

// ---------- countries.json (มีเฉพาะไทย) ----------
const countries=[];
{
  const cs=customers, ps=prospects;
  const ratio=cs.length?ps.length/cs.length:ps.length;
  const avgPot=ps.length?Math.round(ps.reduce((a,p)=>a+p.potentialScore,0)/ps.length):0;
  countries.push({country:'Thailand',center:[13.0,101.0],customerCount:cs.length,prospectCount:ps.length,coverage:Math.min(100,Math.round(cs.length/(cs.length+ps.length)*100)),opportunityScore:oppFromRatio(avgPot,ratio),salesTotal:cs.reduce((a,c)=>a+c.salesValue,0),hasProvinces:true});
}

// ---------- วันที่เพิ่มเข้าระบบ (created_at) — ตัวสุ่มแยก RT ----------
const RT = mulberry32(20260713);
const rtint = (a,b)=>Math.floor(a+RT()*(b-a+1));
const ANCHOR = Date.UTC(2026,6,13);
const backToISO = d => new Date(ANCHOR - d*864e5).toISOString().slice(0,10);
const daysBack  = iso => Math.round((ANCHOR - Date.parse(iso))/864e5);
for(const c of customers){
  const lb = daysBack(c.lastPurchaseDate);
  const cold = c.tradingStatus==='Dormant'||c.tradingStatus==='At Risk';
  let back;
  if(lb<=120 && !cold && RT()<0.7){ back = lb + rtint(0,10); }
  else if(RT() < (cold?0.8:0.52)){ back = rtint(348,365); }
  else{ back = rtint(0,347); }
  if(back < lb) back = lb + rtint(0,25);
  c.created_at = backToISO(back);
}
for(const p of prospects){
  const back = RT()<0.35 ? rtint(352,365) : Math.round(350*Math.pow(RT(),1.7));
  p.created_at = backToISO(back);
}

// ---------- ทีมผู้ประสานงานการค้า (TC) + สถานะการเข้าพบ — ตัวสุ่มแยก RTC ----------
const RTC = mulberry32(20260714);
// จุดยึด TC ตามภูมิภาคของ 4 จังหวัด (2 จุดในกรุงเทพฯ เพื่อให้เกิดพื้นที่ทับซ้อนในเมือง)
const TC_SEEDS = [
  {tc:'ธนพล ศรีวัฒน์',       lat:18.79, lng:98.98},   // เชียงใหม่
  {tc:'ณัฐริกา พงษ์ไพบูลย์', lat:13.86, lng:100.62},  // กรุงเทพฯ ตอนเหนือ-ตะวันออก
  {tc:'กิตติศักดิ์ อารยะกุล', lat:13.66, lng:100.45},  // กรุงเทพฯ ตอนใต้-ตะวันตก
  {tc:'ศุภมาส เจริญสุข',      lat:12.93, lng:100.90},  // พัทยา (ภาคตะวันออก)
  {tc:'ปิยะนุช วงศ์สกุล',     lat:7.90,  lng:98.40},   // ภูเก็ต (ภาคใต้)
];
const idHash = id => { let h=0; for(let i=0;i<id.length;i++) h=(h*31+id.charCodeAt(i))>>>0; return h; };
const assignTC = (lat,lng,id)=>{
  const ds=TC_SEEDS.map(s=>({tc:s.tc, d:(lat-s.lat)*(lat-s.lat)+(lng-s.lng)*(lng-s.lng)})).sort((a,b)=>a.d-b.d);
  const near=ds[0], second=ds[1];
  if(second && second.d <= near.d*2.0 && (idHash(id)&1)) return second.tc;
  return near.tc;
};
for(const c of customers) c.tc_owner = assignTC(c.latitude, c.longitude, c.id);
for(const p of prospects) p.tc_owner = assignTC(p.latitude, p.longitude, p.id);
// ── รอบการเข้าพบ (visit rounds) — สถานะผู้มุ่งหวัง derive จากรอบ (ย้ายจาก visit_status เดิม) ──
// สัดส่วนสถานการณ์: รอเข้าพบ 50% · นัดหมายแล้ว 15% · รอรอบถัดไป 20% · ใกล้ปิดการขาย 5% · ปิดโอกาส 10%
const isoBack = d => backToISO(d);                     // d>0 = อดีต · d<0 = อนาคต
const pickScenario = ()=>{ const r=RTC();
  return r<0.50?"waiting": r<0.65?"appointment": r<0.85?"followup": r<0.90?"hot":"lost"; };
for(const p of prospects){
  const sc = pickScenario();
  p.visitRounds = makeRounds(sc, p.tc_owner, RTC, isoBack);
  p.visit_status = deriveVisitStatus(p.visitRounds);   // สรุปกลับเป็นฟิลด์เดิม เพื่อให้รายงาน/แผนที่ที่อ้าง visit_status ทำงานได้เหมือนเดิม
}

// ---------- ตรวจกฎความสอดคล้อง (ข้อ 7.3) ก่อนเขียนไฟล์ — throw ถ้าไม่ผ่าน ----------
validateGeoData({customers, prospects});

await writeFile('data/customers.json',JSON.stringify(customers));
await writeFile('data/prospects.json',JSON.stringify(prospects));
await writeFile('data/areas.json',JSON.stringify(areas));
await writeFile('data/districts.json',JSON.stringify(districts));
await writeFile('data/countries.json',JSON.stringify(countries,null,2));
console.log('✓ ผ่าน validate 7.3 · customers:',customers.length,'prospects:',prospects.length,'areas:',areas.length,'districts:',districts.length,'countries:',countries.length);
for(const sp of PROVINCES){
  const ps=prospects.filter(p=>p.province===sp.key); const g={A:0,B:0,C:0}; ps.forEach(p=>g[p.grade]++);
  console.log(`  ${sp.th}: ลูกค้า ${customers.filter(c=>c.province===sp.key).length} · ผู้มุ่งหวัง ${ps.length} · A/B/C ${g.A}/${g.B}/${g.C}`);
}
