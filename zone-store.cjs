// ---------------------------------------------------------------------------
// zone-store.cjs — ตรรกะ "ร่าง / อนุมัติ / ประวัติ / สิทธิ์" ของทะเบียนโซน
//
// ใช้ร่วมกันทั้ง dev server (server.mjs) และ Vercel (api/zones.js) เหมือน
// zone-validate.cjs — เคยเขียนแยกกันแล้วตรวจไม่เท่ากันมาแล้วครั้งหนึ่ง
// ที่เก็บต่างกัน (ไฟล์ vs Vercel Blob) จึงรับเข้ามาเป็น adapter
//
// สถานะของทะเบียน:
//   published  ฉบับที่ "มีผลจริง" — แมพของ TC/ผู้บริหารอ่านอันนี้เท่านั้น
//   draft      ฉบับร่างที่แอดมินเซฟไว้รอตรวจ — ไม่มีผลกับใครจนกด "อนุมัติ"
//   history    ฉบับที่เคย published ทุกอัน เก็บไว้ย้อนกลับได้
//
// ⚠ ข้อจำกัดของสิทธิ์: หน้าเว็บเป็น static ไม่มีระบบตัวตนจริง โทเคนที่ผู้ใช้
//   พิมพ์เข้าไปจะถูกส่งเป็น header ตรง ๆ — คนที่นั่งอยู่หน้าเครื่องนั้นเห็นได้
//   สิ่งที่มันกันได้จริงคือ "คนนอกที่รู้แค่ URL" ยิงเขียนทับ ซึ่งเป็นความเสี่ยง
//   ที่มีอยู่จริงตอนนี้ · ไม่ใช่ระบบ auth เต็มรูปแบบ อย่าเข้าใจผิด
// ---------------------------------------------------------------------------

const { validateZones, MAX_BYTES } = require('./zone-validate.cjs');

const PUBLISHED = 'zones.geojson';
const DRAFT     = 'zones.draft.geojson';
const HIST_DIR  = 'history';
const MAX_HISTORY = 20;          // เก็บย้อนหลัง 20 ฉบับ เกินนั้นลบอันเก่าสุด

/**
 * ตรวจสิทธิ์เขียน — ไม่ตั้ง env ZONES_TOKEN ไว้ = เปิดให้เขียน (โหมดเดโม)
 *
 * ⚠ HTTP header เป็น latin-1 ส่งภาษาไทยตรง ๆ ไม่ได้ (เจอมาแล้ว: รหัสถูกแต่ถูกปฏิเสธ)
 *   ฝั่งหน้าเว็บจึงส่ง base64 ของ UTF-8 มา · ที่นี่รับทั้งสองแบบ
 *   (base64 เพื่อให้รหัสภาษาไทยใช้ได้ · ข้อความดิบเพื่อให้ curl/สคริปต์ ASCII ยังใช้ได้)
 */
function checkWriteAuth(headers, env) {
  const want = (env && env.ZONES_TOKEN) || '';
  if (!want) return { ok: true, mode: 'open' };          // ยังไม่ได้ตั้งโทเคน = เหมือนเดิม
  const raw = (headers && (headers.authorization || headers.Authorization)) || '';
  const m = /^Bearer\s+(.+)$/.exec(raw);
  const got = m ? m[1].trim() : '';
  if (!got) return { ok: false, code: 401, error: 'ต้องใส่รหัสผู้ดูแลก่อนบันทึก' };
  const wantB64 = Buffer.from(want, 'utf8').toString('base64');
  if (got !== want && got !== wantB64) return { ok: false, code: 403, error: 'รหัสผู้ดูแลไม่ถูกต้อง' };
  return { ok: true, mode: 'token' };
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

/**
 * @param adapter {{ readJSON(name):Promise<any|null>, writeText(name,text):Promise<void>,
 *                   list(prefix):Promise<string[]>, remove(name):Promise<void> }}
 */
function fileAdapter(files) {
  async function listHistory() {
    const names = await files.list(HIST_DIR + '/');
    return names
      .map(n => n.split('/').pop())
      .filter(n => n.endsWith('.geojson'))
      .sort().reverse()
      .map(n => ({ version: n.replace(/\.geojson$/, ''), name: HIST_DIR + '/' + n }));
  }

  /** ย้ายฉบับที่ published อยู่ตอนนี้เข้าประวัติ แล้วตัดของเก่าที่เกินเพดาน */
  async function archiveCurrent() {
    const cur = await files.readJSON(PUBLISHED);
    if (!cur) return null;
    const version = stamp();
    await files.writeText(`${HIST_DIR}/${version}.geojson`, JSON.stringify(cur));
    const hist = await listHistory();
    for (const h of hist.slice(MAX_HISTORY)) { try { await files.remove(h.name); } catch (e) {} }
    return version;
  }

  return {
    getLive:  () => files.readJSON(PUBLISHED),
    getDraft: () => files.readJSON(DRAFT),
    listHistory,
    getVersion: version => files.readJSON(`${HIST_DIR}/${version}.geojson`),
    saveDraft: (gj, raw) => files.writeText(DRAFT, raw),
    async clearDraft() { try { await files.remove(DRAFT); } catch (e) {} },
    async publish(gj, raw, opts) {
      const archived = await archiveCurrent();
      await files.writeText(PUBLISHED, raw);
      if (opts && opts.clearDraft) { try { await files.remove(DRAFT); } catch (e) {} }
      return archived;
    },
  };
}

function makeZoneStore(adapter) {
  const db = typeof adapter.getLive === 'function' ? adapter : fileAdapter(adapter);

  const readPublished = () => db.getLive();
  const readDraft     = () => db.getDraft();
  const listHistory   = () => db.listHistory();

  async function getVersion(version) {
    if (!/^[0-9A-Za-z\-]+$/.test(version || '')) return null;   // กัน path traversal
    return db.getVersion(version);
  }

  const rejected = e => (e && e.zoneError) ? { code: 400, error: 'รูปโซนใช้ไม่ได้', message: e.zoneError } : null;
  async function guard(fn) {
    try { return await fn(); }
    catch (e) { const r = rejected(e); if (r) return r; throw e; }
  }

  function check(raw) {
    const bytes = Buffer.byteLength(raw, 'utf8');
    if (bytes > MAX_BYTES)
      return { code: 413, error: `ไฟล์ ${Math.round(bytes / 1024)} KB เกินเพดาน ${MAX_BYTES / 1024} KB — ลดหมุดก่อนเซฟ` };
    let gj; try { gj = JSON.parse(raw || 'null'); }
    catch { return { code: 400, error: 'JSON ไม่ถูกต้อง' }; }
    const bad = validateZones(gj);
    if (bad) return { code: 400, error: 'รูปโซนใช้ไม่ได้', message: bad };
    return { gj, bytes };
  }

  /** บันทึกเป็น "ฉบับร่าง" — ยังไม่มีผลกับใคร */
  const saveDraft = (raw, actor) => guard(async () => {
    const c = check(raw); if (c.error) return c;
    await db.saveDraft(c.gj, raw, { actor });
    return { ok: true, status: 'draft', zones: c.gj.features.map(f => f.properties.zone_id),
             kb: Math.round(c.bytes / 1024), updatedAt: new Date().toISOString() };
  });

  /** บันทึกแล้วมีผลทันที (ข้ามขั้นตรวจ) — เก็บฉบับเดิมเข้าประวัติก่อนเสมอ */
  const publish = (raw, actor) => guard(async () => {
    const c = check(raw); if (c.error) return c;
    const out = {};
    const archived = await db.publish(c.gj, raw, { action: 'publish', actor, clearDraft: true, out });
    return { ok: true, status: 'published', archived, territory: out.territory || [],
             zones: c.gj.features.map(f => f.properties.zone_id),
             kb: Math.round(c.bytes / 1024), updatedAt: new Date().toISOString() };
  });

  /** อนุมัติฉบับร่าง → ใช้จริง (ฉบับเดิมเข้าประวัติ · ร่างถูกล้าง) */
  const approve = actor => guard(async () => {
    const draft = await readDraft();
    if (!draft) return { code: 404, error: 'ไม่มีฉบับร่างรออนุมัติ' };
    const raw = JSON.stringify(draft);
    const c = check(raw); if (c.error) return c;             // ร่างอาจถูกเซฟไว้ตั้งแต่กฎเก่า ตรวจซ้ำก่อนใช้จริง
    const out = {};
    const archived = await db.publish(c.gj, raw, { action: 'approve', actor, clearDraft: true, out });
    return { ok: true, status: 'published', archived, approved: true, territory: out.territory || [],
             zones: c.gj.features.map(f => f.properties.zone_id), kb: Math.round(c.bytes / 1024) };
  });

  async function discardDraft() {
    const draft = await readDraft();
    if (!draft) return { code: 404, error: 'ไม่มีฉบับร่าง' };
    await db.clearDraft();
    return { ok: true, discarded: true };
  }

  /** ย้อนกลับไปใช้ฉบับในประวัติ — ฉบับปัจจุบันถูกเก็บเข้าประวัติก่อน ไม่หายไปเฉย ๆ */
  const restore = (version, actor) => guard(async () => {
    const old = await getVersion(version);
    if (!old) return { code: 404, error: 'ไม่พบฉบับ ' + version };
    const raw = JSON.stringify(old);
    const c = check(raw); if (c.error) return c;
    const out = {};
    const archived = await db.publish(c.gj, raw, { action: 'restore', actor, out });
    return { ok: true, status: 'published', restored: version, archived, territory: out.territory || [],
             zones: c.gj.features.map(f => f.properties.zone_id) };
  });

  return { readPublished, readDraft, listHistory, getVersion,
           saveDraft, publish, approve, discardDraft, restore };
}

module.exports = { makeZoneStore, fileAdapter, checkWriteAuth, stamp, PUBLISHED, DRAFT, HIST_DIR, MAX_HISTORY };
