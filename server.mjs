import {createServer} from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {extname, join, normalize} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = 5173;
const MIME = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.geojson':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.pmtiles':'application/octet-stream'};

// In-memory cache of parsed country-scoped datasets, so filtering a large table
// by ?country= costs one parse per file (not per request) — the DB-side WHERE equivalent.
const _rowCache = new Map();
async function scopedRows(file, country){
  let rows = _rowCache.get(file);
  if(!rows){ rows = JSON.parse(await readFile(file, 'utf8')); _rowCache.set(file, rows); }
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
        createReadStream(file, {start, end}).pipe(res); return;
      }
    }
    res.writeHead(200, {'Content-Type':type,'Accept-Ranges':'bytes','Content-Length':st.size,'Cache-Control':cache});
    createReadStream(file).pipe(res);
  }catch(e){
    res.writeHead(404, {'Content-Type':'text/plain'}).end('404 '+e.message);
  }
}).listen(PORT, ()=>console.log('Geo Intelligence running → http://localhost:'+PORT));
