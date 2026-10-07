import {t} from "./i18n.js";
import {token, readSaved} from "./auth.js";
import {effectivePerms} from "./permissions.js";
import {localData, downloadCSV} from "./data.js";

const SUMMARY = "report.export_summary", PII = "report.export_raw_pii";
const KIND_PERM = {report:SUMMARY, visit_plans:SUMMARY, dashboard:PII, places:PII, tc_records:PII};
const SOURCE_PERM = {audit:"audit.export", lead_requests:PII};

export const beStamp = () => { const [y,m,d]=new Date().toISOString().slice(0,10).split("-"); return (+y+543)+"-"+m+"-"+d; };

export const permForExport =(kind, format) => format==="pdf" ? SUMMARY : (KIND_PERM[kind] || PII);

function permsOf(role){
  const u = (readSaved()||{}).user;
  return effectivePerms(role, u && u.role===role ? (u.permOverrides||{}) : {});
}
export const canExportKind = (role, kind, format) => permsOf(role).has(permForExport(kind, format));
export const canExportSource = (role, source) => role==="Administrator" && permsOf(role).has(SOURCE_PERM[source]);

const save = (blob, name) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 2000);
};
const nameOf = (r, fallback) => {
  const m = (r.headers.get("content-disposition")||"").match(/filename\*=UTF-8''([^;]+)/);
  try{ return m ? decodeURIComponent(m[1]) : fallback; }catch(e){ return fallback; }
};
async function failure(r){
  const data = await r.json().catch(()=>null);
  if(r.status===401) return t("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่", "Your session has expired. Please sign in again");
  if(r.status===403) return t("บัญชีนี้ไม่มีสิทธิ์ส่งออกข้อมูลนี้", "This account may not export this data");
  if(r.status===413) return t("ข้อมูลใหญ่เกินไป กรุณากรองให้แคบลง", "Too much data — please narrow the filters");
  return (data && data.error) || t("ส่งออกไม่สำเร็จ", "Export failed")+` (${r.status})`;
}

function localExport(format, filename, rows){
  if(format!=="pdf") downloadCSV(filename+".csv", rows);
  return {ok:true, local:true};
}

export async function exportReport({kind, format, filename, rows, records, scope}){
  if(localData()) return localExport(format, filename, rows);
  const tk = token();
  try{
    const r = await fetch("/api/exports", {method:"POST", cache:"no-store",
      headers:{"Content-Type":"application/json", ...(tk ? {Authorization:"Bearer "+tk} : {})},
      body:JSON.stringify({kind, format, filename, records, scope, ...(format==="pdf" ? {} : {rows})})});
    if(!r.ok) return {ok:false, status:r.status, error:await failure(r)};
    if(format==="pdf") return {ok:true};
    save(await r.blob(), nameOf(r, filename+(format==="csv" ? ".csv" : ".xlsx")));
    return {ok:true};
  }catch(e){
    return {ok:false, error:t("ติดต่อเซิร์ฟเวอร์ไม่ได้", "Could not reach the server")};
  }
}

export async function exportFromServer(source, format, params, filename){
  const tk = token();
  const qs = new URLSearchParams({source, format, filename, lang:t("th","en")});
  for(const [k,v] of Object.entries(params||{})) if(v!==undefined && v!==null && v!=="") qs.set(k, String(v));
  try{
    const r = await fetch("/api/exports?"+qs, {cache:"no-store", headers: tk ? {Authorization:"Bearer "+tk} : {}});
    if(!r.ok) return {ok:false, status:r.status, error:await failure(r)};
    save(await r.blob(), nameOf(r, filename+(format==="csv" ? ".csv" : ".xlsx")));
    return {ok:true};
  }catch(e){
    return {ok:false, error:t("ติดต่อเซิร์ฟเวอร์ไม่ได้", "Could not reach the server")};
  }
}
