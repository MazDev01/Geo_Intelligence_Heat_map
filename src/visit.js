// ── Customer Visit Planning — route math (NOT navigation; sales visit planning only) ──
// Suggests a visit ORDER and estimates distance/time. No GPS / turn-by-turn / live routing.

// จุดเริ่มต้นการวางแผนเข้าพบ = ที่ตั้งสาขา Barter ในจังหวัดนั้นๆ (ไม่ใช่กรุงเทพฯ จุดเดียวทั้งประเทศ)
// ผู้ประสานงาน (TC) แต่ละคนถูกล็อกอยู่จังหวัดของตน จึงเริ่มวางแผนจากสาขาในจังหวัดตัวเอง
export const OFFICES = {
  "Bangkok Metropolis": { id:"__office_bkk", businessName:"สำนักงานใหญ่ · กรุงเทพฯ", segment:"Other", province:"Bangkok Metropolis", latitude:13.7563, longitude:100.5018, office:true },
  "Chiang Mai":         { id:"__office_cnx", businessName:"สาขา Barter · เชียงใหม่",  segment:"Other", province:"Chiang Mai",         latitude:18.7883, longitude:98.9853,  office:true },
  "Phuket":             { id:"__office_hkt", businessName:"สาขา Barter · ภูเก็ต",     segment:"Other", province:"Phuket",             latitude:7.8804,  longitude:98.3923,  office:true },
  "Pattaya":            { id:"__office_pty", businessName:"สาขา Barter · พัทยา",      segment:"Other", province:"Pattaya",            latitude:12.9236, longitude:100.8825, office:true },
};
export const OFFICE = OFFICES["Bangkok Metropolis"];   // ค่าเริ่มต้น (คงชื่อ import เดิมไว้ให้ที่อื่นใช้ได้)
export const officeFor = (province)=> OFFICES[province] || OFFICE;   // ไม่พบจังหวัด → ใช้สำนักงานใหญ่

const ROAD_FACTOR = 1.3;   // straight-line → approx road distance
const AVG_KMH = 40;        // city average for time estimate

export function haversine(a,b){
  const R=6371, dLat=(b.latitude-a.latitude)*Math.PI/180, dLng=(b.longitude-a.longitude)*Math.PI/180;
  const s=Math.sin(dLat/2)**2+Math.cos(a.latitude*Math.PI/180)*Math.cos(b.latitude*Math.PI/180)*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(s));
}
const opp = c => c.opportunityScore ?? c.potentialScore ?? 50;

// Greedy nearest-next from the office, lightly biased toward higher-opportunity customers.
export function optimizeOrder(office, custs){
  const rem=[...custs], order=[]; let cur=office;
  while(rem.length){
    rem.sort((a,b)=> cost(cur,a)-cost(cur,b));
    const n=rem.shift(); order.push(n); cur=n;
  }
  return order;
}
const cost = (from,c)=> haversine(from,c) * (1 - 0.12*(opp(c)/100));   // priority nudge

// Metrics for a GIVEN order (office → ordered stops). Does not reorder.
export function computeRoute(office, ordered){
  const stops=[office, ...ordered]; const legs=[]; let total=0;
  for(let i=1;i<stops.length;i++){ const d=haversine(stops[i-1],stops[i])*ROAD_FACTOR; legs.push(d); total+=d; }
  return { order:ordered, legs, totalKm:total, minutes:Math.round(total/AVG_KMH*60) };
}

// Compare two computed routes (previous → next).
export function compareRoutes(prev, next){
  if(!prev||!next) return null;
  const dist=prev.totalKm-next.totalKm, time=prev.minutes-next.minutes;
  return { prev, next, distSaved:dist, timeSaved:time, shorter: dist>0.05 };
}

// ── Geographic clustering of the SELECTED customers (Client Cluster) ──
// Single-linkage agglomerative: every customer starts as its own cluster; repeatedly merge the two
// clusters whose closest members are within thresholdKm, until no pair is that close. Same idea as the
// map's proximity clustering, but on the selected subset with a real-km threshold — so customers in far
// provinces never end up in the same group. 1–2 customers → a single group (no real clustering needed).
export function clusterCustomers(custs, thresholdKm=50, office=OFFICE){
  let cl = custs.map(c=>[c]);
  for(;;){
    let bi=-1,bj=-1,best=Infinity;
    for(let i=0;i<cl.length;i++) for(let j=i+1;j<cl.length;j++){
      let d=Infinity;                                   // closest pair between the two clusters (single-link)
      for(const a of cl[i]) for(const b of cl[j]){ const h=haversine(a,b); if(h<d) d=h; }
      if(d<best){ best=d; bi=i; bj=j; }
    }
    if(bi<0 || best>thresholdKm) break;
    cl[bi]=cl[bi].concat(cl[bj]); cl.splice(bj,1);
  }
  // largest / nearest-to-office groups first for a stable, sensible display order
  return cl.sort((a,b)=> a.reduce((m,c)=>Math.min(m,haversine(office,c)),Infinity) - b.reduce((m,c)=>Math.min(m,haversine(office,c)),Infinity));
}

// Nearest-neighbour visit order + per-leg distances/time WITHIN one cluster (enters from the office side).
export function clusterRoute(office, members){
  const order = optimizeOrder(office, members);         // greedy nearest-next, reuse the same algorithm
  const legs=[]; let km=0;                               // legs[i] = distance from stop i → stop i+1
  for(let i=1;i<order.length;i++){ const d=haversine(order[i-1],order[i])*ROAD_FACTOR; legs.push(d); km+=d; }
  return { order, legs, km, minutes:Math.round(km/AVG_KMH*60) };
}
export const legMinutes = km => Math.round(km/AVG_KMH*60);

export const fmtKm = km => (Math.round(km*10)/10).toFixed(1)+" กม.";
export function fmtDuration(min){
  const h=Math.floor(min/60), m=min%60;
  return h ? (m? `${h} ชั่วโมง ${m} นาที` : `${h} ชั่วโมง`) : `${m} นาที`;
}
