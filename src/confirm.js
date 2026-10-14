import {html, useState, useEffect} from "./lib.js";
import {t} from "./i18n.js";
import {Modal, Btn} from "./ui.js";

if(typeof document!=="undefined" && !document.getElementById("ask-css")){
  const st=document.createElement("style"); st.id="ask-css";
  st.textContent=`
.modal:has(.ask-body){width:min(320px,92vw);border-radius:13px}
.modal:has(.ask-body) .modal-h{padding:11px 12px 11px 16px}
.modal:has(.ask-body) .modal-h h2{font-size:14.5px;line-height:1.35}
.modal:has(.ask-body) .modal-h .icon-btn{width:26px !important;height:26px !important}
.modal:has(.ask-body) .modal-b{padding:11px 16px}
.modal:has(.ask-body) .modal-f{padding:9px 12px;gap:7px}
.modal:has(.ask-body) .modal-f .btn{padding:6px 13px;font-size:12.5px;border-radius:8px}
.modal:has(.ask-body) .modal-f .btn.primary{box-shadow:0 4px 10px rgba(230,0,35,.2)}
.ask-body{font-size:12.5px;line-height:1.6;white-space:pre-line}
`;
  document.head.appendChild(st);
}

let show = null;
let pending = null;

export function confirmBox(opts){
  return new Promise(res=>{
    if(!show){
      res(typeof confirm==="function" ? confirm([opts.title, opts.body].filter(Boolean).join("\n")) : false);
      return;
    }
    if(pending) pending.res(false);
    pending = {...opts, res};
    show(pending);
  });
}

export function ConfirmHost(){
  const [ask, setAsk] = useState(null);
  useEffect(()=>{ show = setAsk; return ()=>{ if(show===setAsk) show = null; }; },[]);
  if(!ask) return null;
  const answer = v => { if(pending===ask) pending = null; setAsk(null); ask.res(v); };
  return html`<${Modal} small title=${ask.title} onClose=${()=>answer(false)}
    footer=${html`<${Btn} variant="ghost" onClick=${()=>answer(false)}>${ask.cancel || t("ยกเลิก","Cancel")}</${Btn}>
      <${Btn} variant=${ask.danger?"danger":"primary"} onClick=${()=>answer(true)}>${ask.ok || t("ตกลง","OK")}</${Btn}>`}>
    <div class="ask-body">${ask.body || ""}</div>
  </${Modal}>`;
}
