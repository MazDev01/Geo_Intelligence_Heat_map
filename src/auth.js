// ---------------------------------------------------------------------------
// auth.js — ฝั่งหน้าเว็บของระบบเข้าสู่ระบบ (คู่กับ api/auth.js · auth-store.cjs)
//
// เก็บโทเคนไว้ที่ไหน:
//   จำฉันไว้ = localStorage (อยู่ข้ามการปิดเบราว์เซอร์)  ·  ไม่จำ = sessionStorage (ปิดแท็บแล้วหาย)
//   ⚠ โทเคนใน storage อ่านได้ด้วย JS ถ้ามีช่องโหว่ XSS — ทางที่ปลอดภัยกว่าคือ httpOnly cookie
//     ซึ่งต้องให้ serverless ตั้งคุกกี้เอง (ทำได้ แต่ต้องแก้ทั้ง api/auth.js และ dev server)
//     โครงนี้เลือกแบบ storage ก่อนเพื่อให้ใช้ได้ทั้ง static hosting และ dev server เหมือนกัน
// ---------------------------------------------------------------------------

import {getLang} from "./i18n.js";
const KEY = "geointel.auth";
const API = "/api/auth";

const store = remember => (remember ? localStorage : sessionStorage);

/** อ่านสิ่งที่จำไว้ — ดู sessionStorage ก่อน (เซสชันปัจจุบันชนะค่าที่จำไว้นาน) */
export function readSaved() {
  for (const s of [sessionStorage, localStorage]) {
    try {
      const raw = s.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* โหมดส่วนตัว/ปิด storage = ถือว่าไม่มี */ }
  }
  return null;
}

export function saveAuth(data, remember) {
  clearAuth();
  try { store(remember).setItem(KEY, JSON.stringify(data)); } catch (e) {}
}

const EMAIL_KEY = "geointel.lastEmail";
export function rememberEmail(email, on) {
  try { if (on && email) localStorage.setItem(EMAIL_KEY, email); else localStorage.removeItem(EMAIL_KEY); } catch (e) {}
}
export function lastEmail() {
  try { return localStorage.getItem(EMAIL_KEY) || ""; } catch (e) { return ""; }
}

export function clearAuth() {
  for (const s of [sessionStorage, localStorage]) { try { s.removeItem(KEY); } catch (e) {} }
}

export function replaceAuth(data) {
  for (const s of [sessionStorage, localStorage]) {
    try { if (s.getItem(KEY)) { s.setItem(KEY, JSON.stringify(data)); return; } } catch (e) {}
  }
  try { sessionStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
}

export const token = () => (readSaved() || {}).token || "";

const EXPIRED = "geointel:session-expired";
const sentToken = h => !!h && (typeof h.get === "function" ? !!h.get("Authorization") : !!(h.Authorization || h.authorization));
if (typeof window !== "undefined" && typeof window.fetch === "function" && !window.fetch.geoGuard) {
  const raw = window.fetch.bind(window);
  const urlOf = input => typeof input === "string" ? input : input instanceof URL ? input.href : (input && input.url) || "";
  const withLang = (input, init) => {
    if (!/\/api\//.test(urlOf(input))) return init;
    const headers = new Headers((init && init.headers) || (input instanceof Request ? input.headers : undefined));
    if (!headers.has("X-Lang")) headers.set("X-Lang", getLang());
    return {...(init || {}), headers};
  };
  const guarded = async (input, init) => {
    const res = await raw(input, withLang(input, init));
    if (res.status === 401) {
      const url = urlOf(input);
      const headers = (init && init.headers) || (input && typeof input === "object" && input.headers);
      if (/\/api\//.test(url) && !/\/api\/auth(\?|$)/.test(url) && sentToken(headers) && token()) window.dispatchEvent(new Event(EXPIRED));
    }
    return res;
  };
  guarded.geoGuard = true;
  window.fetch = guarded;
}
export const onSessionExpired = fn => { window.addEventListener(EXPIRED, fn); return () => window.removeEventListener(EXPIRED, fn); };

/** เรียก API — แนบโทเคนให้อัตโนมัติ · คืน {ok:false,error} เสมอเมื่อพลาด ไม่โยน */
export async function call(action, body = {}) {
  try {
    const tk = token();
    const r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(tk ? { Authorization: "Bearer " + tk } : {}) },
      body: JSON.stringify({ action, ...body }),
    });
    const text = await r.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { error: text.slice(0, 200) }; }
    if (!r.ok) return { ok: false, code: r.status, reason: data.reason, error: data.error || `ผิดพลาด ${r.status}` };
    return { ok: true, ...data };
  } catch (e) {
    // เซิร์ฟเวอร์ปิด/เน็ตหลุด — บอกให้ชัดว่าเป็นที่การเชื่อมต่อ ไม่ใช่รหัสผิด
    return { ok: false, code: 0, error: "ติดต่อเซิร์ฟเวอร์ไม่ได้: " + (e && e.message) };
  }
}

const door = () => { try { const m = /^\/(admin|management|tc)\/?$/.exec(location.pathname); return m ? m[1] : undefined; } catch (e) { return undefined; } };
const DOOR_ROLE = { admin: "Administrator", management: "Management", tc: "Trade Coordinator" };
export const doorOk = user => { const d = door(); return !d || !user || user.role === DOOR_ROLE[d]; };
export const login          = (email, password) => call("login", { email, password, door: door() });
export const changePassword = (oldPassword, newPassword) => call("change", { oldPassword, newPassword });
export const me             = () => call("me");
export const logout         = () => call("logout");
export const listUsers      = () => call("users.list");
export const createUser     = rec => call("users.create", rec);
export const updateUser     = (email, patch) => call("users.update", { email, patch });
export const removeUser     = email => call("users.remove", { email });
export const userImpact     = email => call("users.impact", { email });
export const resetPassword  = (email, password) => call("users.password", { email, password });
export const bootstrap      = (email, password) => call("bootstrap", { email, password });
