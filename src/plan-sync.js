import {useEffect, useRef} from "./lib.js";
import {t} from "./i18n.js";
import {visitPlansApi} from "./data.js";
import {toast} from "./ui.js";

const SAVE_DELAY = 800;

export function usePlanSync({user, db, visitPlans, setVisitPlans, setActivePlanId}){
  const isTC = !!(user && user.role==="Trade Coordinator");
  const st = useRef(null);
  const latest = useRef(visitPlans);
  latest.current = visitPlans;

  const fresh = ()=>({ key:user ? user.id||user.email : null, loaded:false, loading:false, local:false,
    dirty:new Set(), sid:new Map(), busy:new Set(), timer:null, warned:false });
  if(!st.current || st.current.key!==(user ? user.id||user.email : null)){
    if(st.current && st.current.timer) clearTimeout(st.current.timer);
    st.current = fresh();
  }
  const s = st.current;

  const bodyOf = p => ({ name:String(p.name||"").trim().slice(0,80) || t("แผนไม่มีชื่อ", "Untitled plan"),
    visitDate:p.visitDate||null, items:(p.customers||[]).map(c=>(p.fresh||{})[c.id] ? {placeId:c.id, fresh:true} : c.id), saved:!!p.saved });

  const applyAdded = (id, sent, items) => setVisitPlans(prev=>prev.map(x=>{
    if(x.id!==id) return x;
    const addedAt = {...(x.addedAt||{})}, fresh = {...(x.fresh||{})};
    for(const it of items||[]){
      const sameAdd = (sent.fresh||{})[it.placeId] && addedAt[it.placeId]===(sent.addedAt||{})[it.placeId];
      if(fresh[it.placeId] && !sameAdd) continue;
      addedAt[it.placeId] = it.addedAt || null;
      delete fresh[it.placeId];
    }
    return {...x, addedAt, fresh};
  }));

  const fail = res => {
    if(s.warned) return;
    s.warned = true;
    toast(res.error || t("บันทึกแผนไม่สำเร็จ", "Could not save the plan"), "bad");
  };

  const flush = async ()=>{
    s.timer = null;
    if(!isTC || s.local || !s.loaded) return;
    for(const id of [...s.dirty]){
      if(s.busy.has(id)) continue;
      const p = latest.current.find(x=>x.id===id);
      s.dirty.delete(id);
      if(!p) continue;
      s.busy.add(id);
      const sid = s.sid.get(id);
      const res = await visitPlansApi(sid ? "PUT" : "POST", sid, bodyOf(p));
      s.busy.delete(id);
      if(res.local){ s.local = true; return; }
      if(!res.ok){ s.dirty.add(id); fail(res); continue; }
      s.warned = false;
      const at = res.plan && res.plan.savedAt;
      if(at && p.savedAt!==at) setVisitPlans(prev=>prev.map(x=>x.id===id && x.saved ? {...x, savedAt:at} : x));
      if(res.plan) applyAdded(id, p, res.plan.items);
      if(!sid && res.plan){
        if(latest.current.some(x=>x.id===id)) s.sid.set(id, res.plan.id);
        else await visitPlansApi("DELETE", res.plan.id);
      }
    }
    if(s.dirty.size && !s.timer) s.timer = setTimeout(flush, SAVE_DELAY);
  };

  const schedule = ()=>{
    if(s.timer) clearTimeout(s.timer);
    s.timer = setTimeout(flush, SAVE_DELAY);
  };

  const touch = (...ids)=>{
    if(!isTC || s.local) return;
    ids.flat().filter(Boolean).forEach(id=>s.dirty.add(id));
    s.warned = false;
    schedule();
  };

  const remove = async id => {
    if(!isTC || s.local) return;
    s.dirty.delete(id);
    const sid = s.sid.get(id);
    s.sid.delete(id);
    if(!sid) return;
    const res = await visitPlansApi("DELETE", sid);
    if(!res.ok && !res.local && res.status!==404) toast(res.error, "bad");
  };

  const ready = isTC && ((db.customers||[]).length + (db.prospects||[]).length) > 0;
  useEffect(()=>{
    if(!ready || s.loaded || s.loading || s.local) return;
    s.loading = true;
    visitPlansApi("GET").then(res=>{
      s.loading = false;
      if(res.local){ s.local = true; return; }
      if(!res.ok){ toast(res.error, "bad"); return; }
      s.loaded = true;
      const byId = new Map([...(db.customers||[]), ...(db.prospects||[])].map(x=>[x.id, x]));
      let dropped = 0;
      const plans = res.plans.map(sp=>{
        const customers = [];
        for(const it of sp.items){ const c = byId.get(it.placeId); if(c && !it.deleted) customers.push(c); else dropped++; }
        s.sid.set(sp.id, sp.id);
        if(customers.length!==sp.items.length) s.dirty.add(sp.id);
        return {id:sp.id, name:sp.name, customers, route:null, saved:!!sp.saved, savedAt:sp.savedAt||"", visitDate:sp.visitDate||"",
          addedAt:Object.fromEntries(sp.items.map(it=>[it.placeId, it.addedAt||null])), fresh:{}, fromServer:true};
      });
      if(plans.length){
        const mine = latest.current.filter(p=>s.dirty.has(p.id) && !s.sid.has(p.id));
        setVisitPlans([...plans, ...mine]);
        setActivePlanId(prev=> mine.some(p=>p.id===prev) ? prev : plans[0].id);
      }
      if(dropped) toast(`${t("ร้านที่ถูกลบหรืออยู่นอกพื้นที่ถูกนำออกจากแผน", "Shops that were removed or are outside your area were taken out of your plans:")} ${dropped} ${t("ร้าน", "shops")}`, "warn");
      if(s.dirty.size) schedule();
    });
  }, [ready, user && user.id]);

  useEffect(()=>()=>{ if(s.timer) clearTimeout(s.timer); }, [s]);

  return {touch, remove};
}
