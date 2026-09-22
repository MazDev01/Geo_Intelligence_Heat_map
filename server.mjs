import {createServer} from 'node:http';
import {readFile, writeFile, rename, stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {extname, join, normalize} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
// ตัวตรวจทะเบียนโซนตัวเดียวกับที่ Vercel ใช้ (api/zones.js) — เป็น .cjs จึงต้องผ่าน createRequire
const {validateZones} = createRequire(import.meta.url)('./zone-validate.cjs');

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

    // ── API: รูปขอบเขตโซนที่แอดมินลากเอง (คู่กับ api/zones.js ที่ใช้บน Vercel) ──
    // ในเครื่องเขียนลง data/zones.geojson ตรง ๆ · GET ตอบ 204 เสมอ ให้หน้าเว็บไปอ่านไฟล์นั้นแทน
    // (บน Vercel เก็บที่ Blob เพราะเขียนไฟล์ไม่ได้ — พฤติกรรมฝั่งหน้าเว็บเหมือนกันทั้งสองที่)
    if(p==='/api/zones'){
      const send = (code,obj)=>{ res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});
        res.end(obj===undefined?'':JSON.stringify(obj)); };
      const STORE = join(ROOT, 'data', 'zones.geojson');
      if(req.method==='GET') return send(204);
      if(req.method==='POST'){
        let raw=''; for await (const chunk of req){ raw += chunk;
          if(raw.length > 1.2e6){ return send(413,{error:'ไฟล์ใหญ่เกิน'}); } }
        const kb = Math.round(Buffer.byteLength(raw,'utf8')/1024);
        if(kb > 600) return send(413,{error:`ไฟล์ ${kb} KB เกินเพดาน 600 KB — ลดหมุดก่อนเซฟ`});
        let gj; try{ gj = JSON.parse(raw||'null'); }catch{ return send(400,{error:'JSON ไม่ถูกต้อง'}); }
        // ใช้ตัวตรวจ "ตัวเดียวกัน" กับ api/zones.js บน Vercel — ก่อนหน้านี้เขียนแยกกันแล้วไม่เท่ากัน
        // (สีผิดรูปแบบผ่านในเครื่องแต่ถูกปฏิเสธบน production) ดู zone-validate.cjs
        const bad = validateZones(gj);
        if(bad) return send(400,{error:'รูปโซนใช้ไม่ได้', message:bad});
        const tmp = STORE+'.tmp';
        await writeFile(tmp, raw);
        await rename(tmp, STORE);
        console.log(`[zones] บันทึก ${gj.features.length} โซน · ${kb} KB`);
        return send(200,{ok:true, zones:gj.features.map(f=>f.properties.zone_id), kb, updatedAt:new Date().toISOString()});
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
