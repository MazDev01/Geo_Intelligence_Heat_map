import {t} from "./i18n.js";
import {token} from "./auth.js";
import {localData} from "./data.js";
import {applyServerNotif} from "./notifications.js";
import {setScoring} from "./mock/geoData.js";
import {loadMaster} from "./master-api.js";

async function call(path, method="GET", body){
  if(localData()) return {ok:true, local:true};
  const tk = token();
  try{
    const r = await fetch(path, {method, cache:"no-store",
      headers:{...(body ? {"Content-Type":"application/json"} : {}), ...(tk ? {Authorization:"Bearer "+tk} : {})},
      body: body ? JSON.stringify(body) : undefined});
    const data = await r.json().catch(()=>null);
    if(r.status===404 && !(data && data.error)) return {ok:true, local:true};
    if(r.status===401) return {ok:false, status:401, error:t("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่", "Your session has expired. Please sign in again")};
    if(r.status===403) return {ok:false, status:403, error:t("บัญชีนี้ไม่มีสิทธิ์แก้การตั้งค่านี้", "This account may not change this setting")};
    if(!r.ok) return {ok:false, status:r.status, error:(data && data.error) || t("บันทึกไม่สำเร็จ", "Could not save")+` (${r.status})`};
    return {...(data||{}), ok:true};
  }catch(e){
    return {ok:false, error:t("ติดต่อเซิร์ฟเวอร์ไม่ได้", "Could not reach the server")};
  }
}

export async function loadSettings(){
  const [s, p] = await Promise.all([call("/api/settings"), call("/api/me/prefs"), loadMaster()]);
  if(s.local || p.local) return {ok:true, local:true};
  if(!s.ok || !p.ok) return {ok:false, error:(s.ok ? p : s).error};
  applyServerNotif((s.settings||{}).notifications, (p.prefs||{}).notifOff);
  setScoring((s.settings||{}).scoring);
  return {ok:true};
}

export const saveScoring = scoring => call("/api/settings", "PUT", {scoring});

export const saveSystemNotif = notifications => call("/api/settings", "PUT", {notifications});
export const saveMyNotifOff = notifOff => call("/api/me/prefs", "PUT", {notifOff});
