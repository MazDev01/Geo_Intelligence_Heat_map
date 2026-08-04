import {SEGMENTS} from "./lib.js";

/* ---------------- PROGRESSIVE / STAGED LOADING ----------------
   The payload is split into stages so the UI can paint the globe skeleton and a
   coarse overview FIRST, then stream in detail. Every stage is cached in memory.

     Stage 1  loadCountries()   countries.json          2.5 KB   → globe dots + search
     Stage 2  loadWorld()       world.geojson           256 KB   → globe borders (overlay)
     Stage 3  loadAreas()       areas.json               22 KB   → per-province AGGREGATES (overview + coarse heatmap)
     Stage 4  loadProvincesGeo() thailand-provinces      1.19 MB → province choropleth outlines
     Stage 5  loadDetail()      customers/prospects      ~3 MB   → individual markers + fine heatmap (ON-DEMAND)

   Business scope = Thailand only, so the detail fetch is scoped at the query
   layer with `?country=` (server-side filter) instead of downloading every
   country and filtering on the client.                                        */
let _countries=null, _world=null, _areas=null, _provGeo=null, _districts=null;
const _detailCache = {};

const j = (url)=> fetch(url).then(r=>r.json());

export async function loadCountries(){ if(!_countries) _countries = await j("./data/countries.json"); return _countries; }
export async function loadWorld(){ if(!_world) _world = await j("./data/world.geojson"); return _world; }
export async function loadProvincesGeo(){ if(!_provGeo) _provGeo = await j("./data/thailand-provinces.geojson"); return _provGeo; }
export async function loadAreas(){
  if(_areas) return _areas;
  const areas = await j("./data/areas.json");
  _areas = { areas, areaByProvince: Object.fromEntries(areas.map(a=>[a.province, a])) };
  return _areas;
}
// District-level (อำเภอ/เขต) aggregates — only populated for the 4 provinces with district data
// (Bangkok Metropolis, Chiang Mai, Phuket, Pattaya). Small file, loaded alongside areas.json.
export async function loadDistricts(){ if(!_districts) _districts = await j("./data/districts.json"); return _districts; }
// Stage 5 — heavy detail, scoped to one country at the query layer (?country=).
export async function loadDetail(country="Thailand"){
  if(_detailCache[country]) return _detailCache[country];
  const q = encodeURIComponent(country);
  const [customersRaw, prospectsRaw] = await Promise.all([
    j(`./data/customers.json?country=${q}`),
    j(`./data/prospects.json?country=${q}`),
  ]);
  // เผื่อ static host (เช่น Netlify) ที่ไม่กรอง ?country= ฝั่ง server — กรองซ้ำฝั่ง client ให้ได้เฉพาะประเทศนี้เสมอ
  const customers = Array.isArray(customersRaw) ? customersRaw.filter(r=>r.country===country) : customersRaw;
  const prospects = Array.isArray(prospectsRaw) ? prospectsRaw.filter(r=>r.country===country) : prospectsRaw;
  _detailCache[country] = { customers, prospects };
  return _detailCache[country];
}

// Back-compat: the "globe" bundle is now just the tiny country aggregates.
export async function loadGlobe(){ return { countries: await loadCountries() }; }

// Back-compat full working set (used by ensureData / deep-links that need everything at once).
export async function loadCountry(country="Thailand"){
  const [areas, provincesGeo, detail, districts] = await Promise.all([loadAreas(), loadProvincesGeo(), loadDetail(country), loadDistricts()]);
  return { customers:detail.customers, prospects:detail.prospects,
    areas:areas.areas, provincesGeo, areaByProvince:areas.areaByProvince, districts };
}

/* ---------------- default filters ---------------- */
export const defaultFilters = ()=>({
  status:{Existing:true, Prospect:true},
  segments: segAllTrue(),
  minScore:0,
  province:"All",
});

/* ---------------- filter predicates ---------------- */
export const custPass = (c,f)=> f.status.Existing && f.segments[c.segment]
  && (f.province==="All"||c.province===f.province);
export const prosPass = (p,f)=> f.status.Prospect && f.segments[p.segment]
  && p.potentialScore>=f.minScore && (f.province==="All"||p.province===f.province);

export function filterData(db, f, country="Thailand"){
  const cs = db.customers.filter(c=>c.country===country && custPass(c,f));
  const ps = db.prospects.filter(p=>p.country===country && prosPass(p,f));
  return {customers:cs, prospects:ps};
}

/* ---------------- STATISTICAL DATA MINING (no ML) ---------------- */
export const oppScore = (avgPot, ratio)=>Math.min(100, Math.round(0.55*avgPot + 0.45*Math.min(100, ratio*7)));

// Live area analysis computed from filtered records
export function analyzeArea(db, province, f){
  const cs = db.customers.filter(c=>c.province===province && custPass(c,f));
  const ps = db.prospects.filter(p=>p.province===province && prosPass(p,f));
  const dist = segZero();
  cs.forEach(c=>dist[c.segment]++); ps.forEach(p=>dist[p.segment]++);
  const total = cs.length+ps.length;
  const avgPot = ps.length? Math.round(ps.reduce((a,p)=>a+p.potentialScore,0)/ps.length):0;
  const ratio = cs.length? ps.length/cs.length : ps.length;
  const coverage = total? Math.round(cs.length/total*100):0;
  const salesTotal = cs.reduce((a,c)=>a+c.salesValue,0);
  const opportunity = oppScore(avgPot, ratio);
  const gap = ratio>=10?"High":ratio>=5?"Medium":"Low";
  const topSegment = Object.entries(dist).sort((a,b)=>b[1]-a[1])[0][0];
  const density = +(cs.length/((db.areaByProvince[province]?.density||1)+ .01)).toFixed(1);
  const topProspects = [...ps].sort((a,b)=>b.potentialScore-a.potentialScore).slice(0,8);
  const segMix = SEGMENTS.map(s=>({seg:s, cust:cs.filter(c=>c.segment===s).length,
    pros:ps.filter(p=>p.segment===s).length, total:dist[s], pct: total? Math.round(dist[s]/total*100):0}));
  return {province, customers:cs, prospects:ps, customerCount:cs.length, prospectCount:ps.length,
    avgPotential:avgPot, ratio:+ratio.toFixed(1), coverage, salesTotal, opportunity, gap, topSegment,
    density, topProspects, segMix, center: db.areaByProvince[province]?.center };
}

// Ranking table across provinces (Heat Ranking / Business Ranking)
export function rankAreas(db, f, metric="opportunity"){
  const provinces = db.areas.map(a=>a.province);
  const rows = provinces.map(p=>analyzeArea(db,p,f))
    .filter(a=>a.customerCount+a.prospectCount>0);
  const key = {opportunity:"opportunity", customers:"customerCount", prospects:"prospectCount",
    coverage:"coverage", gap:"ratio", sales:"salesTotal"}[metric]||"opportunity";
  return rows.sort((a,b)=>b[key]-a[key]);
}

// Live district analysis — same shape as analyzeArea, but scoped to one อำเภอ/เขต within a province.
// Only meaningful for the 4 provinces with district data (Bangkok Metropolis, Chiang Mai, Phuket, Pattaya).
export function analyzeDistrict(db, province, district, f){
  const cs = db.customers.filter(c=>c.province===province && c.district===district && custPass(c,f));
  const ps = db.prospects.filter(p=>p.province===province && p.district===district && prosPass(p,f));
  const dist = segZero();
  cs.forEach(c=>dist[c.segment]++); ps.forEach(p=>dist[p.segment]++);
  const total = cs.length+ps.length;
  const avgPot = ps.length? Math.round(ps.reduce((a,p)=>a+p.potentialScore,0)/ps.length):0;
  const ratio = cs.length? ps.length/cs.length : ps.length;
  const coverage = total? Math.round(cs.length/total*100):0;
  const salesTotal = cs.reduce((a,c)=>a+c.salesValue,0);
  const opportunity = oppScore(avgPot, ratio);
  const gap = ratio>=10?"High":ratio>=5?"Medium":"Low";
  const topSegment = Object.entries(dist).sort((a,b)=>b[1]-a[1])[0][0];
  return {province, district, customerCount:cs.length, prospectCount:ps.length,
    avgPotential:avgPot, ratio:+ratio.toFixed(1), coverage, salesTotal, opportunity, gap, topSegment};
}

// Ranking table across districts (only the 4 provinces that have district data). Reads the province→district
// list from db.districts (districts.json) so it stays in sync with whatever gen.mjs produced.
export function rankDistricts(db, f, metric="opportunity"){
  const pairs = (db.districts||[]).map(d=>[d.province, d.district]);
  const rows = pairs.map(([p,d])=>analyzeDistrict(db,p,d,f))
    .filter(a=>a.customerCount+a.prospectCount>0);
  const key = {opportunity:"opportunity", customers:"customerCount", prospects:"prospectCount",
    coverage:"coverage", gap:"ratio", sales:"salesTotal"}[metric]||"opportunity";
  return rows.sort((a,b)=>b[key]-a[key]);
}

// Country-level KPIs (respects filters on segments/status/score across all countries)
export function globalKpis(db, f){
  const cs = db.customers.filter(c=>f.segments[c.segment] && f.status.Existing);
  const ps = db.prospects.filter(p=>f.segments[p.segment] && f.status.Prospect && p.potentialScore>=f.minScore);
  const total = cs.length+ps.length;
  const coverage = total? Math.round(cs.length/total*100):0;
  const avgPot = ps.length? Math.round(ps.reduce((a,p)=>a+p.potentialScore,0)/ps.length):0;
  const ratio = cs.length? ps.length/cs.length : ps.length;
  return {customers:cs.length, prospects:ps.length, coverage, opportunity:oppScore(avgPot,ratio),
    salesTotal:cs.reduce((a,c)=>a+c.salesValue,0), countries:db.countries.length};
}

/* ═══════════════ การจัดกลุ่มเชิงพื้นที่ (Geographic Cluster) ═══════════════
   ข้อจำกัดของข้อมูล: districts.json ไม่มีพิกัดศูนย์กลางของเขต และพิกัดของแต่ละ record
   ถูกสุ่มทั่วทั้งจังหวัด (gen.mjs สุ่มตำแหน่งอิสระจาก label เขต) จึงคำนวณ centroid
   จาก record ไม่ได้อย่างมีความหมาย — ต้องใช้พิกัดศูนย์กลางเขตจริง (DOPA) เป็นข้อมูลอ้างอิง
   เหมือนที่ areas.json ใช้ centroid ของจังหวัด (ไม่ใช่ข้อมูลปลอม เป็นพิกัดจริงของเขต) */
// พิกัดศูนย์กลางอำเภอ/เขต — ใช้จากแหล่งข้อมูลเดียว (src/mock/geoData.js) ครอบคลุม 4 จังหวัด
import {DISTRICT_CENTER, segZero, segAllTrue} from "./mock/geoData.js";
export {DISTRICT_CENTER};

// ระยะทางวงกลมใหญ่ (กม.) ระหว่างสองพิกัด {lat,lng}
const _hav=(a,b)=>{const R=6371,dLat=(b.lat-a.lat)*Math.PI/180,dLng=(b.lng-a.lng)*Math.PI/180,
  s=Math.sin(dLat/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(s));};

// convex hull (Andrew's monotone chain) — จุด [lat,lng] ใช้วาดขอบเขตคร่าวๆ ของกลุ่มบนแผนที่
export function convexHull(pts){
  const P=[...pts].sort((a,b)=>a[1]-b[1]||a[0]-b[0]);
  if(P.length<3) return P;
  const cross=(o,a,b)=>(a[1]-o[1])*(b[0]-o[0])-(a[0]-o[0])*(b[1]-o[1]);
  const lo=[]; for(const p of P){ while(lo.length>=2 && cross(lo[lo.length-2],lo[lo.length-1],p)<=0) lo.pop(); lo.push(p); }
  const up=[]; for(let i=P.length-1;i>=0;i--){ const p=P[i]; while(up.length>=2 && cross(up[up.length-2],up[up.length-1],p)<=0) up.pop(); up.push(p); }
  lo.pop(); up.pop(); return lo.concat(up);
}
// แปดเหลี่ยมรอบจุดศูนย์กลาง (ใช้เมื่อกลุ่มมีสมาชิก <3 เขต จึงไม่มี hull เป็นรูปหลายเหลี่ยม)
function _octagon(cy,cx,r){ const o=[]; for(let k=0;k<8;k++){ const a=k/8*2*Math.PI; o.push([cy+r*Math.sin(a), cx+r*Math.cos(a)]); } return o; }
// ดันจุด hull ออกจากศูนย์กลางเล็กน้อย ให้ขอบเขตครอบจุดเขตแบบหลวมๆ อ่านง่าย
function _padHull(hull,cx,cy,factor,minBuf){
  return hull.map(([lat,lng])=>{ const dLat=lat-cy,dLng=lng-cx,len=Math.hypot(dLat,dLng)||1,ext=Math.max(minBuf,len*(factor-1));
    return [lat+dLat/len*ext, lng+dLng/len*ext]; });
}

const CL_CODES=["A","B","C","D","E","F","G"];
// สีโซนของกลุ่ม — เลี่ยงโทนน้ำเงิน (กันสับสนกับหมุดลูกค้า/Leadที่เป็นน้ำเงิน)
const CL_COLORS=["#e60023","#f59f00","#12b886","#8a5cf6","#e8590c","#0ca678","#d6336c"];

/* จัดกลุ่มเขต/อำเภอของ 1 จังหวัดออกเป็น Cluster อัตโนมัติจากข้อมูลจริง
   - เกณฑ์ผสม: ระยะทางภูมิศาสตร์จริง (พิกัดศูนย์กลางเขต) + ความหนาแน่นที่ใกล้เคียงกัน (ลูกค้า+Lead)
   - วิธี: agglomerative single-link รวมกลุ่มที่ใกล้ที่สุดในสเปซปกติ (geo+density) จนระยะเกิน threshold
   - สมาชิกกลุ่มคิดจากความหนาแน่นรวม "ทั้งหมด" (ไม่ผูกกับตัวกรอง) เพื่อให้โซนคงที่ ส่วนสถิติคิดตามตัวกรอง f
   - จำนวนกลุ่มไม่ตายตัว: เกิดตามการกระจายจริงของจังหวัดนั้น · แต่ละเขตอยู่ได้กลุ่มเดียว */
export function buildClusters(db, province, f, opts={}){
  const T=opts.T??0.34, wGeo=opts.wGeo??1, wDen=opts.wDen??0.55;
  const ds=(db.districts||[]).filter(d=>d.province===province);
  if(!ds.length) return [];
  const nodes=ds.map(d=>{ const c=DISTRICT_CENTER[d.district]||{lat:0,lng:0};
    return {district:d.district, lat:c.lat, lng:c.lng, base:d.customerCount+d.prospectCount}; });
  let geoSpread=0.001, baseMin=Infinity, baseMax=-Infinity;
  for(const a of nodes){ baseMin=Math.min(baseMin,a.base); baseMax=Math.max(baseMax,a.base);
    for(const b of nodes){ const dd=_hav(a,b); if(dd>geoSpread) geoSpread=dd; } }
  const baseRange=(baseMax-baseMin)||1;
  const dist=(a,b)=>Math.sqrt(wGeo*(_hav(a,b)/geoSpread)**2 + wDen*(Math.abs(a.base-b.base)/baseRange)**2);
  let groups=nodes.map(n=>[n]);
  const linkDist=(A,B)=>{ let m=Infinity; for(const a of A) for(const b of B){ const d=dist(a,b); if(d<m)m=d; } return m; };
  while(groups.length>1){ let bi=0,bj=1,best=Infinity;
    for(let i=0;i<groups.length;i++) for(let jj=i+1;jj<groups.length;jj++){ const d=linkDist(groups[i],groups[jj]); if(d<best){best=d;bi=i;bj=jj;} }
    if(best>T) break; groups[bi]=groups[bi].concat(groups[bj]); groups.splice(bj,1);
  }
  const latVals=nodes.map(n=>n.lat); const spreadDeg=(Math.max(...latVals)-Math.min(...latVals))||0.2;
  const clusters=groups.map(members=>{
    const set=new Set(members.map(m=>m.district));
    const cs=db.customers.filter(c=>c.province===province && set.has(c.district) && custPass(c,f));
    const ps=db.prospects.filter(p=>p.province===province && set.has(p.district) && prosPass(p,f));
    const existing=cs.length, prospect=ps.length, market=existing+prospect;
    const coverage= market? existing/market*100 : 0;
    const avgPot= ps.length? Math.round(ps.reduce((a,p)=>a+p.potentialScore,0)/ps.length):0;
    const ratio= existing? prospect/existing : prospect;
    const opportunity= oppScore(avgPot, ratio);
    const gap= ratio>=10?"High":ratio>=5?"Medium":"Low";
    const segCounts=segZero();
    cs.forEach(c=>segCounts[c.segment]++); ps.forEach(p=>segCounts[p.segment]++);
    const anchor=[...members].sort((a,b)=>b.base-a.base)[0];   // เขตหนาแน่นสุด = ตัวตั้งชื่อกลุ่ม
    const cy=members.reduce((s,m)=>s+m.lat,0)/members.length, cx=members.reduce((s,m)=>s+m.lng,0)/members.length;
    let hull=convexHull(members.map(m=>[m.lat,m.lng]));
    if(hull.length<3) hull=_octagon(cy,cx, Math.max(0.02, spreadDeg*0.10));
    hull=_padHull(hull,cx,cy,1.28,0.012);
    return { districts:[...set], anchor:anchor.district, memberCount:members.length,
      members:members.map(m=>({district:m.district,lat:m.lat,lng:m.lng,base:m.base})).sort((a,b)=>b.base-a.base),
      center:{lat:cy,lng:cx}, hull, existing, prospect, market, coverage, avgPot,
      ratio:+ratio.toFixed(1), opportunity, gap, gapRai:Math.max(0,prospect-existing),
      segCounts, topSegment:Object.entries(segCounts).sort((a,b)=>b[1]-a[1])[0][0] };
  });
  clusters.sort((a,b)=> b.opportunity-a.opportunity || b.market-a.market);
  clusters.forEach((c,i)=>{ c.code=CL_CODES[i]||("#"+(i+1)); c.color=CL_COLORS[i%CL_COLORS.length]; });
  return clusters;
}

/* ---------------- CSV export helper ---------------- */
export function downloadCSV(filename, rows){
  const csv = rows.map(r=>r.map(c=>`"${String(c??"").replace(/"/g,'""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿"+csv],{type:"text/csv;charset=utf-8"}));
  const a=document.createElement("a"); a.href=url; a.download=filename; a.click(); URL.revokeObjectURL(url);
}
