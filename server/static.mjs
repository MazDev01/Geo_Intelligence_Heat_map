import {createReadStream} from 'node:fs';
import {readFile, stat} from 'node:fs/promises';
import {gzip} from 'node:zlib';
import {promisify} from 'node:util';
import {extname, join, resolve, sep} from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/json; charset=utf-8',
  '.pmtiles': 'application/octet-stream',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

const gz = promisify(gzip);
const COMPRESS = new Set(['.html', '.js', '.json', '.geojson', '.css']);
const COMPRESS_MAX = 8 * 1024 * 1024;

export const DOORS = ['/admin', '/management', '/tc'];
const INDEX_PATHS = new Set(['/', '/index.html', ...DOORS]);
const PUBLIC_DATA = new Set(['world.geojson', 'countries.json', 'areas.json', 'districts.json',
  'thailand-provinces.geojson']);

const SRC_RE = /^\/src\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.js$/;
const CONFIG_RE = /^\/config\/[A-Za-z0-9_.-]+\.js$/;
const DATA_RE = /^\/data\/([A-Za-z0-9_.-]+)$/;
const BASEMAP_RE = /^\/basemap\/[A-Za-z0-9_.-]+\.pmtiles$/;
const VENDOR_RE = /^\/vendor\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:js|css|png|woff2)$/;

export function allowedFile(path) {
  if (path.includes('..') || path.includes('\\') || path.includes('\0')) return null;
  if (INDEX_PATHS.has(path)) return 'index.html';
  if (SRC_RE.test(path) || CONFIG_RE.test(path) || BASEMAP_RE.test(path) || VENDOR_RE.test(path)) return path.slice(1);
  const m = DATA_RE.exec(path);
  if (m && PUBLIC_DATA.has(m[1])) return path.slice(1);
  return null;
}

export function makeStatic(root) {
  const base = resolve(root);
  const zipped = new Map();

  const gzipped = async (file, st) => {
    const hit = zipped.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.body;
    const body = await gz(await readFile(file));
    zipped.set(file, {mtimeMs: st.mtimeMs, size: st.size, body});
    return body;
  };

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
      ...(COMPRESS.has(ext) ? {Vary: 'Accept-Encoding'} : {}),
    };

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

    if (!req.headers.range && COMPRESS.has(ext) && st.size <= COMPRESS_MAX && /\bgzip\b/i.test(req.headers['accept-encoding'] || '')) {
      const body = await gzipped(file, st);
      res.writeHead(200, {...common, 'Content-Encoding': 'gzip', 'Content-Length': body.length});
      return res.end(head ? undefined : body);
    }

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
