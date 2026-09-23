import {createServer} from 'node:http';
import {readFile, writeFile, rename, stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {extname, join, normalize} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir, readdir, unlink} from 'node:fs/promises';
import {createRequire} from 'node:module';
// ตรรกะทะเบียนโซนตัวเดียวกับที่ Vercel ใช้ (api/zones.js) — เป็น .cjs จึงต้องผ่าน createRequire
const _req = createRequire(import.meta.url);
const {makeZoneStore, checkWriteAuth} = _req('./zone-store.cjs');

// adapter ฝั่งเครื่อง: เก็บเป็นไฟล์ใน data/  (ฉบับจริง = data/zones.geojson ที่เสิร์ฟ static อยู่แล้ว)
const DATA_DIR = fileURLToPath(new URL('./data/', import.meta.url));
const zonePath = name => DATA_DIR + name;
const zoneStore = makeZoneStore({
  async readJSON(name){ try{ return JSON.parse(await readFile(zonePath(name),'utf8')); }catch{ return null; } },
  async writeText(name, text){
    const full = zonePath(name);
    await mkdir(full.slice(0, Math.max(full.lastIndexOf('/'), full.lastIndexOf('\\'))), {recursive:true});
    await writeFile(full+'.tmp', text);          // เขียนชั่วคราวก่อน rename กันไฟล์พังถ้าดับกลางคัน
    await rename(full+'.tmp', full);
  },
  async list(prefix){
    try{ const dir = zonePath(prefix);
      return (await readdir(dir)).map(n=>prefix+n);
    }catch{ return []; }
  },
  async remove(name){ try{ await unlink(zonePath(name)); }catch{} },
});


// ── บัญชีผู้ใช้: ตรรกะเดียวกับ Vercel (api/auth.js) เก็บเป็นไฟล์ใน data/auth/ ──
const {makeAuthStore} = _req('./auth-store.cjs');
const AUTH_DIR = DATA_DIR + 'auth/';
const SEED_ACCOUNTS = [
  {id:1, name:'System Administrator', email:'admin@geointel.io',      role:'Administrator'},
  {id:2, name:'ผู้บริหารภูมิภาค',       email:'management@geointel.io', role:'Management'},
  {id:3, name:'ณัฐริกา พงษ์ไพบูลย์',     email:'tc.bkk@geointel.io',     role:'Trade Coordinator', province:'Bangkok Metropolis'},
  {id:4, name:'ศุภมาส เจริญสุข',        email:'tc.pty@geointel.io',     role:'Trade Coordinator', province:'Pattaya'},
  {id:6, name:'ธนพล ศรีวัฒน์',          email:'tc.cm@geointel.io',      role:'Trade Coordinator', province:'Chiang Mai'},
  {id:7, name:'ปิยะนุช วงศ์สกุล',        email:'tc.hkt@geointel.io',     role:'Trade Coordinator', province:'Phuket'},
];
const authStore = makeAuthStore({
  async readJSON(name){ try{ return JSON.parse(await readFile(AUTH_DIR+name,'utf8')); }catch{ return null; } },
  async writeText(name, text){
    await mkdir(AUTH_DIR, {recursive:true});
    await writeFile(AUTH_DIR+name+'.tmp', text);
    await rename(AUTH_DIR+name+'.tmp', AUTH_DIR+name);
  },
}, { secret: process.env.AUTH_SECRET || 'geointel-dev-secret', seed: SEED_ACCOUNTS,
     // ในเครื่อง = เดโมเสมอ ให้กดเข้าดูได้ทันทีโดยไม่ต้องไปตั้งรหัสให้ทุกบัญชีก่อน
     seedPassword: process.env.DEMO_PASSWORD !== undefined ? process.env.DEMO_PASSWORD : 'geointel2026' });

// อ่าน body แบบข้อความ (ใช้กับ /api/auth)
const readBodyText = req => new Promise((resolve,reject)=>{
  let s=''; req.on('data',c=>{ s+=c; if(s.length>1e6){ req.destroy(); reject(new Error('ใหญ่เกินไป')); } });
  req.on('end',()=>resolve(s)); req.on('error',reject);
});

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = 5173;
const MIME = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.geojson':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.pmtiles':'application/octet-stream'};

// แคชผลพาร์สของไฟล์ข้อมูลที่กรองด้วย ?country= ไว้ในหน่วยความจำ (พาร์สครั้งเดียวต่อไฟล์ ไม่ใช่ต่อ request)
// ⚠ ต้องผูกกับ mtime ของไฟล์: ก่อนหน้านี้แคชไม่มีวันหมดอายุ พอรัน gen.mjs ทับไฟล์ข้อมูล
//   เซิร์ฟเวอร์จะยังตอบข้อมูลชุดเก่าต่อไปเงียบ ๆ จนกว่าจะรีสตาร์ต (เคยหลอกให้เข้าใจผิดว่าโค้ดฝั่งหน้าเว็บพัง)
const _rowCache = new Map();
async function scopedRows(file, country){
  const mtime = (await stat(file)).mtimeMs;
  const hit = _rowCache.get(file);
  let rows = hit && hit.mtime === mtime ? hit.rows : null;
  if(!rows){ rows = JSON.parse(await readFile(file, 'utf8')); _rowCache.set(file, {mtime, rows}); }
  return Array.isArray(rows) ? rows.filter(r=>r && r.country===country) : rows;
}

createServer(async (req,res)=>{
  try{
    const [rawPath, qs] = req.url.split('?');
    let p = decodeURIComponent(rawPath);
    if(p==='/'||p==='') p='/index.html';

    // ── API: รายงานแผนการเข้าพบ (visit-plans) — บังคับสิทธิ์จากโทเคนฝั่งเซิร์ฟเวอร์ ──
    // โทเคนสาธิต: Authorization: Bearer base64({email,role,province})
    //   ไม่มีโทเคน → 401 · ไม่ใช่ TC → 403 · ขอ owner/จังหวัดของคนอื่น → 403 (ห้ามเห็นข้อมูลข้ามคน/ข้ามจังหวัด)
    if(p==='/api/visit-plans'){
      const params = new URLSearchParams(qs||'');
      const send = (code,obj)=>{ res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(JSON.stringify(obj)); };
      const auth = req.headers['authorization']||'';
      const m = /^Bearer\s+(.+)$/.exec(auth);
      let tok=null; if(m){ try{ tok = JSON.parse(Buffer.from(m[1],'base64').toString('utf8')); }catch{} }
      if(!tok || !tok.email){ return send(401,{error:'unauthenticated', message:'ต้องเข้าสู่ระบบก่อน'}); }
      if(tok.role!=='Trade Coordinator'){ return send(403,{error:'forbidden', message:'เฉพาะผู้ประสานงานการค้าเท่านั้น'}); }
      const owner = params.get('owner');
      if(owner && owner!==tok.email){ console.warn('[visit-plans] 403 ปฏิเสธ: '+tok.email+' ขอแผนของ '+owner); return send(403,{error:'forbidden', message:'เรียกดูได้เฉพาะแผนของตนเอง'}); }
      const prov = params.get('province');
      if(prov && prov!==tok.province){ return send(403,{error:'forbidden', message:'เรียกดูได้เฉพาะจังหวัดที่รับผิดชอบ'}); }
      return send(200,{ok:true, owner:tok.email, province:tok.province});
    }
    // ── API: การมอบหมายขอบเขตพื้นที่การขาย (TC ↔ จังหวัด/โซน) ──────────────────
    // GET  → อ่าน data/territory.json · ยังไม่มีไฟล์ = {} (หน้าเว็บจะ fallback ไปใช้ค่าตั้งต้นจากโปรไฟล์ TC)
    // POST → เขียนทับทั้งก้อน {assign:{คีย์หน่วย: id ของ TC}}
    // ⚠ ยังไม่มีการตรวจสิทธิ์ — เหมือน static file อื่นในโปรเจกต์สาธิตนี้ (?demo=admin เป็นสวิตช์ฝั่ง client
    //   ไม่ใช่ auth) ถ้าเอาขึ้นใช้จริงต้องกั้นด้วยโทเคนฝั่งเซิร์ฟเวอร์แบบเดียวกับ /api/visit-plans
    if(p==='/api/territory'){
      const send = (code,obj)=>{ res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(JSON.stringify(obj)); };
      const STORE = join(ROOT, 'data', 'territory.json');
      if(req.method==='GET'){
        try{ return send(200, JSON.parse(await readFile(STORE,'utf8'))); }
        catch{ return send(200, {assign:{}, updatedAt:null}); }      // ยังไม่เคยบันทึก = ก้อนว่าง ไม่ใช่ error
      }
      if(req.method==='POST'){
        let raw=''; for await (const chunk of req){ raw += chunk;
          if(raw.length > 1e6){ return send(413,{error:'payload ใหญ่เกิน'}); } }
        let body; try{ body = JSON.parse(raw); }catch{ return send(400,{error:'JSON ไม่ถูกต้อง'}); }
        const a = body && body.assign;
        if(!a || typeof a!=='object' || Array.isArray(a)) return send(400,{error:'ต้องมีฟิลด์ assign เป็น object'});
        // กันค่าขยะ: คีย์ = ชื่อหน่วย (จังหวัด หรือ จังหวัด/โซน) · ค่า = id ของ TC เป็นตัวเลข
        const clean={};
        for(const [k,v] of Object.entries(a)){
          if(typeof k!=='string' || !k || k.length>120) return send(400,{error:'คีย์หน่วยไม่ถูกต้อง: '+k});
          const n = Number(v);
          if(!Number.isInteger(n)) return send(400,{error:'id ของ TC ต้องเป็นจำนวนเต็ม: '+k+'='+v});
          clean[k]=n;
        }
        const out = {assign:clean, updatedAt:new Date().toISOString()};
        const tmp = STORE+'.tmp';                                    // เขียนไฟล์ชั่วคราวก่อน rename กันไฟล์พังถ้าดับกลางคัน
        await writeFile(tmp, JSON.stringify(out,null,2));
        await rename(tmp, STORE);
        console.log(`[territory] บันทึก ${Object.keys(clean).length} หน่วย`);
        return send(200,{ok:true, saved:Object.keys(clean).length, updatedAt:out.updatedAt});
      }
      return send(405,{error:'รองรับเฉพาะ GET กับ POST'});
    }

    // ── API: บัญชีผู้ใช้ + รหัสผ่าน (คู่กับ api/auth.js ที่ใช้บน Vercel) ──
    // ในเครื่องเก็บเป็นไฟล์ data/auth/users.json (อยู่ใน .gitignore — รหัสผ่านของแต่ละเครื่องไม่ควรขึ้น git)
    if(p==='/api/auth'){
      const send = (code,obj)=>{ res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
        res.end(obj===undefined?'':JSON.stringify(obj)); };
      if(req.method!=='POST') return send(405,{error:'ใช้ POST เท่านั้น'});
      let body={};
      try{ body = JSON.parse(await readBodyText(req) || '{}'); }
      catch(e){ return send(400,{error:'อ่านคำขอไม่ได้'}); }
      const action = String(body.action||'');
      const reply = r => send(r && r.ok ? 200 : ((r&&r.code)||400), r);
      try{
        if(action==='login')  return reply(await authStore.login(body.email, body.password));
        if(action==='change'){
          const who = await authStore.auth(req.headers); if(!who.ok) return send(who.code, who);
          return reply(await authStore.changePassword(who.user.email, body.oldPassword, body.newPassword));
        }
        if(action==='bootstrap'){
          if(!(await authStore.bootstrapNeeded())) return send(403,{ok:false,error:'ระบบตั้งค่าครั้งแรกไปแล้ว'});
          const target = await authStore.get(body.email);
          if(!target || target.role!=='Administrator') return send(400,{ok:false,error:'ตั้งได้เฉพาะบัญชีผู้ดูแลระบบ'});
          return reply(await authStore.setPassword(body.email, body.password));
        }
        if(action==='info') return send(200,{ok:true, demo: authStore.demoMode(), demoPassword: authStore.demoMode()? (process.env.DEMO_PASSWORD || 'geointel2026') : ''});
        if(action==='me'){ const who = await authStore.auth(req.headers); return send(who.ok?200:who.code, who); }
        const admin = await authStore.auth(req.headers, 'Administrator');
        if(!admin.ok) return send(admin.code, admin);
        if(action==='users.list')     return send(200,{ok:true, users: await authStore.list()});
        if(action==='users.create')   return reply(await authStore.create(body));
        if(action==='users.update')   return reply(await authStore.update(body.email, body.patch));
        if(action==='users.remove')   return reply(await authStore.remove(body.email, admin.user.email));
        if(action==='users.password') return reply(await authStore.setPassword(body.email, body.password));
        return send(400,{error:'ไม่รู้จักคำสั่ง: '+action});
      }catch(e){ console.error('[auth]', e); return send(500,{error:'เซิร์ฟเวอร์ผิดพลาด: '+e.message}); }
    }

    // ── API: รูปขอบเขตโซนที่แอดมินลากเอง (คู่กับ api/zones.js ที่ใช้บน Vercel) ──
    // ในเครื่องเขียนลง data/zones.geojson ตรง ๆ · GET ตอบ 204 เสมอ ให้หน้าเว็บไปอ่านไฟล์นั้นแทน
    // (บน Vercel เก็บที่ Blob เพราะเขียนไฟล์ไม่ได้ — พฤติกรรมฝั่งหน้าเว็บเหมือนกันทั้งสองที่)
    if(p==='/api/zones'){
      const send = (code,obj)=>{ res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});
        res.end(obj===undefined?'':JSON.stringify(obj)); };
      const q = new URLSearchParams(qs||'');
      const reply = r => (r && r.ok) ? (console.log('[zones]', JSON.stringify(r)), send(200,r))
                                     : send((r&&r.code)||500, r||{error:'ไม่สำเร็จ'});
      if(req.method==='GET'){
        if(q.get('history')) return send(200,{versions: await zoneStore.listHistory()});
        if(q.get('version')){ const v = await zoneStore.getVersion(q.get('version'));
          return v ? send(200,v) : send(404,{error:'ไม่พบฉบับนี้'}); }
        if(q.get('draft')){ const d = await zoneStore.readDraft(); return d ? send(200,d) : send(204); }
        // ฉบับที่มีผลจริงในเครื่อง = data/zones.geojson ที่เสิร์ฟเป็น static อยู่แล้ว
        // ตอบ 204 เพื่อให้หน้าเว็บไปอ่านไฟล์นั้นตรง ๆ (ไม่ต้องส่ง 120 KB ซ้ำสองทาง)
        return send(204);
      }
      if(req.method==='POST'){
        const auth = checkWriteAuth(req.headers, process.env);
        if(!auth.ok) return send(auth.code,{error:auth.error});
        if(q.get('approve')) return reply(await zoneStore.approve());
        if(q.get('discard')) return reply(await zoneStore.discardDraft());
        if(q.get('restore')) return reply(await zoneStore.restore(q.get('restore')));
        let raw=''; for await (const chunk of req){ raw += chunk;
          if(raw.length > 1.2e6){ return send(413,{error:'ไฟล์ใหญ่เกิน'}); } }
        return reply(q.get('publish') ? await zoneStore.publish(raw) : await zoneStore.saveDraft(raw));
      }
      return send(405,{error:'รองรับเฉพาะ GET กับ POST'});
    }

    const file = normalize(join(ROOT, p));
    if(!file.startsWith(ROOT)){ res.writeHead(403).end('forbidden'); return; }

    // Query-layer country filter: only ship the rows in business scope (Thailand).
    const country = new URLSearchParams(qs||'').get('country');
    if(country && extname(file).toLowerCase()==='.json'){
      const filtered = await scopedRows(file, country);
      res.writeHead(200, {'Content-Type':'application/json','Cache-Control':'no-cache'});
      res.end(JSON.stringify(filtered));
      return;
    }

    const ext = extname(file).toLowerCase();
    // ไฟล์โค้ด (html/js/mjs/css) ใช้ no-store เพื่อไม่ให้เบราว์เซอร์แคชโมดูล ESM เก่าไว้
    // ระหว่างพัฒนา — แก้ปัญหาที่ต้อง hard refresh ทุกครั้ง เห็นผลทันทีแค่รีเฟรชธรรมดา
    // ไฟล์ข้อมูลก้อนใหญ่ (json/geojson) ยังใช้ no-cache (revalidate) เพื่อไม่ให้โหลดซ้ำหนักเกินจำเป็น
    const isCode = ext==='.html'||ext==='.js'||ext==='.mjs'||ext==='.css';
    const type = MIME[ext]||'application/octet-stream';
    const cache = isCode?'no-store':'no-cache';

    // ── HTTP Range (206 Partial Content) ──────────────────────────────────────
    // จำเป็นสำหรับ .pmtiles: protomaps อ่านเฉพาะ byte-range เล็กๆ ของ archive ต่อ tile
    // ไม่ใช่ทั้งไฟล์ ถ้า static server ตอบ 200 เต็มก้อนทุกครั้ง POC จะช้าผิดปกติ
    // แล้วสรุปผิดว่า "Protomaps ช้า" ทั้งที่เป็นข้อจำกัดของ server. ใช้ stream ทุกไฟล์
    // (แทน readFile ทั้งก้อน) + โฆษณา Accept-Ranges เสมอ
    const st = await stat(file);
    // ── กันเซิร์ฟเวอร์ล่มจากการขอ path ที่เป็นโฟลเดอร์ ──────────────────────
    // stat() ผ่านสำหรับโฟลเดอร์ แต่ createReadStream จะยิง error 'EISDIR' แบบ async
    // ซึ่งอยู่นอก try/catch ก้อนนี้ → กลายเป็น unhandled 'error' event และโปรเซสตายทั้งตัว
    // (เจอได้ง่ายมาก เช่นเบราว์เซอร์ขอ "//" หรือ "/src/") จึงตอบ 404 ตั้งแต่ตรงนี้
    if(st.isDirectory()){ res.writeHead(404, {'Content-Type':'text/plain'}); res.end('404 not a file'); return; }
    const range = req.headers['range'];
    if(range){
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if(m){
        let start = m[1]==='' ? undefined : parseInt(m[1],10);
        let end   = m[2]==='' ? undefined : parseInt(m[2],10);
        if(start===undefined){ start = Math.max(0, st.size-(end||0)); end = st.size-1; }   // suffix: bytes=-N
        else if(end===undefined || end>=st.size){ end = st.size-1; }
        if(isNaN(start) || start>end || start>=st.size){
          res.writeHead(416, {'Content-Range':`bytes */${st.size}`, 'Accept-Ranges':'bytes'}).end(); return;
        }
        res.writeHead(206, {'Content-Type':type,'Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${st.size}`,'Content-Length':end-start+1,'Cache-Control':cache});
        createReadStream(file, {start, end}).on('error',e=>{ console.error('[stream]', e.code||e.message); if(!res.headersSent) res.writeHead(500,{'Content-Type':'text/plain'}); res.end(); }).pipe(res); return;
      }
    }
    res.writeHead(200, {'Content-Type':type,'Accept-Ranges':'bytes','Content-Length':st.size,'Cache-Control':cache});
    createReadStream(file).on('error',e=>{ console.error('[stream]', e.code||e.message); if(!res.headersSent) res.writeHead(500,{'Content-Type':'text/plain'}); res.end(); }).pipe(res);
  }catch(e){
    res.writeHead(404, {'Content-Type':'text/plain'}).end('404 '+e.message);
  }
}).listen(PORT, ()=>console.log('Geo Intelligence running → http://localhost:'+PORT));
