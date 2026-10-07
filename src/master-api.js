import {t, isEN} from "./i18n.js";
import {token} from "./auth.js";
import {localData} from "./data.js";
import {PROVINCE_TH} from "./lib.js";
import {setSegments, segmentsKey} from "./mock/geoData.js";

const PROVINCE_BASE = {...PROVINCE_TH};
let _DATA = null;

async function call(method, body){
  if(localData()) return {ok:true, local:true};
  const tk = token();
  try{
    const r = await fetch("/api/master-data", {method, cache:"no-store",
      headers:{...(body ? {"Content-Type":"application/json"} : {}), ...(tk ? {Authorization:"Bearer "+tk} : {})},
      body: body ? JSON.stringify(body) : undefined});
    const data = await r.json().catch(()=>null);
    if(r.status===404 && !(data && data.error)) return {ok:true, local:true};
    if(r.status===401) return {ok:false, status:401, error:t("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่", "Your session has expired. Please sign in again")};
    if(r.status===403) return {ok:false, status:403, error:t("บัญชีนี้ไม่มีสิทธิ์แก้ข้อมูลหลัก", "This account may not change master data")};
    if(!r.ok) return {ok:false, status:r.status, error:(data && data.error) || t("บันทึกไม่สำเร็จ", "Could not save")+` (${r.status})`};
    return {...(data||{}), ok:true};
  }catch(e){
    return {ok:false, error:t("ติดต่อเซิร์ฟเวอร์ไม่ได้", "Could not reach the server")};
  }
}

export const masterKey = () => segmentsKey() + JSON.stringify(PROVINCE_TH);
export const masterData = () => _DATA;

export function applyMaster(data){
  _DATA = data || null;
  setSegments(data ? (data.segments||[]) : null);
  for(const k of Object.keys(PROVINCE_TH)) delete PROVINCE_TH[k];
  Object.assign(PROVINCE_TH, PROVINCE_BASE);
  for(const r of (data && data.areas) || []) if(r.label_th) PROVINCE_TH[r.code] = r.label_th;
}

export async function loadMaster(){
  const r = await call("GET");
  if(r.local) return {ok:true, local:true};
  if(!r.ok) return r;
  applyMaster(r.data);
  return {ok:true, data:r.data};
}

export const saveMaster = body => call("POST", body);

export function rejectReasons(){
  const rows = (_DATA && _DATA["reject-reasons"]) || null;
  if(!rows) return null;
  return rows.map(r=>({code:r.code, label:(isEN() ? (r.label_en || r.label_th) : r.label_th), active:r.is_active}));
}
