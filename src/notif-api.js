import {t} from "./i18n.js";
import {token} from "./auth.js";
import {localData} from "./data.js";

async function call(method, body){
  if(localData()) return {ok:true, local:true};
  const tk = token();
  if(!tk) return {ok:true, local:true};
  try{
    const r = await fetch("/api/notifications", {method, cache:"no-store",
      headers:{...(body ? {"Content-Type":"application/json"} : {}), Authorization:"Bearer "+tk},
      body: body ? JSON.stringify(body) : undefined});
    const data = await r.json().catch(()=>null);
    if(r.status===404 && !(data && data.error)) return {ok:true, local:true};
    if(!r.ok) return {ok:false, status:r.status, error:(data && data.error) || t("โหลดการแจ้งเตือนไม่สำเร็จ", "Could not load notifications")};
    return {...(data||{}), ok:true};
  }catch(e){
    return {ok:false, error:t("ติดต่อเซิร์ฟเวอร์ไม่ได้", "Could not reach the server")};
  }
}

export const loadInbox = () => call("GET");
export const markInboxRead = ids => call("POST", ids ? {ids} : {all:true});
