import {createReadStream} from 'node:fs';
import {readFile, stat} from 'node:fs/promises';
import {extname, join, resolve, sep} from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/json; charset=utf-8',
  '.pmtiles': 'application/octet-stream',
};

export const DOORS = ['/admin', '/management', '/tc'];
const INDEX_PATHS = new Set(['/', '/index.html', ...DOORS]);
const PUBLIC_DATA = new Set(['world.geojson', 'countries.json', 'areas.json', 'districts.json',
  'thailand-provinces.geojson', 'customers.json', 'prospects.json']);
const COUNTRY_FILTERED = new Set(['customers.json', 'prospects.json']);

const SRC_RE = /^\/src\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.js$/;
const CONFIG_RE = /^\/config\/[A-Za-z0-9_.-]+\.js$/;
const DATA_RE = /^\/data\/([A-Za-z0-9_.-]+)$/;
const BASEMAP_RE = /^\/basemap\/[A-Za-z0-9_.-]+\.pmtiles$/;

export function allowedFile(path) {
  if (path.includes('..') || path.includes('\\') || path.includes('\0')) return null;
  if (INDEX_PATHS.has(path)) return 'index.html';
  if (SRC_RE.test(path) || CONFIG_RE.test(path) || BASEMAP_RE.test(path)) return path.slice(1);
  const m = DATA_RE.exec(path);
  if (m && PUBLIC_DATA.has(m[1])) return path.slice(1);
  return null;
}

export function makeStatic(root) {
  const base = resolve(root);
  const rowCache = new Map();

  async function countryRows(file, mtimeMs, country) {
    const hit = rowCache.get(file);
    let rows = hit && hit.mtimeMs === mtimeMs ? hit.rows : null;
    if (!rows) {
      rows = JSON.parse(await readFile(file, 'utf8'));
      rowCache.set(file, {mtimeMs, rows});
    }
    return Array.isArray(rows) ? rows.filter(r => r && r.country === country) : rows;
  }

  const plain = (res, code, text, extra) => {
    res.writeHead(code, {'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...extra});
    res.end(text);
  };

  return async function serve(req, res, path, query) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return plain(res, 405, 'method not allowed', {Allow: 'GET, HEAD'});
    if (path.length > 1 && path.endsWith('/') && DOORS.includes(path.slice(0, -1))) {
      res.writeHead(308, {Location: path.slice(0, -1)});
      return res.end();
    }

    const rel = allowedFile(path);
    if (!rel) return plain(res, 404, 'not found');
    const file = join(base, rel);
    if (file !== base && !file.startsWith(base + sep)) return plain(res, 404, 'not found');

    let st;
    try { st = await stat(file); } catch { return plain(res, 404, 'not found'); }
    if (!st.isFile()) return plain(res, 404, 'not found');

    const ext = extname(file).toLowerCase();
    const head = req.method === 'HEAD';
    const common = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache',
      'Last-Modified': new Date(st.mtimeMs).toUTCString(),
    };

    const country = query.get('country');
    const name = rel.split('/').pop();
    if (country && COUNTRY_FILTERED.has(name)) {
      const body = Buffer.from(JSON.stringify(await countryRows(file, st.mtimeMs, country)));
      res.writeHead(200, {...common, 'Content-Length': body.length});
      return res.end(head ? undefined : body);
    }

    const since = Date.parse(req.headers['if-modified-since'] || '');
    if (!req.headers.range && since && Math.floor(st.mtimeMs / 1000) * 1000 <= since) {
      res.writeHead(304, common);
      return res.end();
    }

    const pipe = (code, headers, opts) => {
      res.writeHead(code, headers);
      if (head) return res.end();
      createReadStream(file, opts)
        .on('error', e => { console.error('[static] stream:', e.code || e.message); res.destroy(); })
        .pipe(res);
    };

    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m && (m[1] !== '' || m[2] !== '')) {
      let start = m[1] === '' ? undefined : parseInt(m[1], 10);
      let end = m[2] === '' ? undefined : parseInt(m[2], 10);
      if (start === undefined) { start = Math.max(0, st.size - end); end = st.size - 1; }
      else if (end === undefined || end >= st.size) end = st.size - 1;
      if (start > end || start >= st.size) {
        res.writeHead(416, {'Content-Range': `bytes */${st.size}`, 'Accept-Ranges': 'bytes'});
        return res.end();
      }
      return pipe(206, {...common, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${st.size}`,
        'Content-Length': end - start + 1}, {start, end});
    }

    pipe(200, {...common, 'Accept-Ranges': 'bytes', 'Content-Length': st.size});
  };
}
