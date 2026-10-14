const EMAIL_RE = /^[a-z0-9_%+-]+(?:\.[a-z0-9_%+-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;
const PHONE_EXT_RE = /^(.*?)(?:\s*(?:#|ต่อ|ext\.?)\s*\d{1,6})?$/i;
const PHONE_TH_RE = /^0(?:[689]\d{8}|[2-7]\d{7})$/;
const PHONE_TH_INTL_RE = /^\+66(?:[689]\d{8}|[2-7]\d{7})$/;
const PHONE_INTL_RE = /^\+(?!66)[1-9]\d{7,14}$/;

export const emailOk = v => { const s = String(v == null ? "" : v).trim(); return s.length <= 254 && EMAIL_RE.test(s); };

export const phoneOk = v => {
  const s = String(v == null ? "" : v).trim();
  if(!/^[0-9+(]/.test(s)) return false;
  const main = PHONE_EXT_RE.exec(s)[1].replace(/[\s\-().]/g, "");
  return PHONE_TH_RE.test(main) || PHONE_TH_INTL_RE.test(main) || PHONE_INTL_RE.test(main);
};

export const phonesOk = v => {
  const parts = String(v == null ? "" : v).split(/[,;\/]/).map(s => s.trim());
  return parts.every(Boolean) && parts.every(p => phoneOk(p.replace(/(\d)\s*-\s*\d{1,2}$/, "$1")));
};
