import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {makePool} from './db/pool.mjs';
import {makeAuthAdapter} from './db/auth-adapter.mjs';
import {makeZoneAdapter} from './db/zone-adapter.mjs';
import {makeApi} from './api.mjs';
import {makeStatic} from './static.mjs';

const require = createRequire(import.meta.url);
const {makeAuthStore} = require('../auth-store.cjs');
const {makeZoneStore} = require('../zone-store.cjs');

const env = process.env;
const production = env.NODE_ENV === 'production';
const fail = message => { console.error('[server] ' + message); process.exit(1); };

if (production && !env.AUTH_SECRET) fail('AUTH_SECRET is required when NODE_ENV=production');
if (production && env.AUTH_SECRET.length < 32) fail('AUTH_SECRET must be at least 32 characters');
if (production && env.DEMO_PASSWORD) fail('DEMO_PASSWORD must be empty when NODE_ENV=production');

const secret = env.AUTH_SECRET || randomBytes(32).toString('hex');
if (!env.AUTH_SECRET) console.warn('[server] AUTH_SECRET is not set: using a random key, every restart signs everyone out');

const demoPassword = env.DEMO_PASSWORD || '';
const port = Number(env.PORT || 3000);
const host = env.HOST || '127.0.0.1';
const root = fileURLToPath(new URL('../', import.meta.url));

let pool;
try { pool = makePool(env); } catch (e) { fail(e.message); }

try {
  const r = await pool.query('select count(*)::int as n from schema_migrations');
  if (!r.rows[0].n) throw new Error('no migration has been applied');
} catch (e) {
  await pool.end().catch(() => {});
  fail('database is not ready (' + e.message + '). Start the database, then run: node server/db/migrate.mjs');
}

const authStore = makeAuthStore(makeAuthAdapter(pool), {
  secret,
  seedPassword: demoPassword,
  seed: [{id: 1, name: 'System Administrator', email: (env.ADMIN_EMAIL || 'admin@geointel.io').toLowerCase(), role: 'Administrator'}],
});
const zoneStore = makeZoneStore(makeZoneAdapter(pool));
const api = makeApi({pool, authStore, zoneStore, demoPassword});
const serveStatic = makeStatic(root);

const server = createServer(async (req, res) => {
  let path, query;
  try {
    if (!req.url.startsWith('/') || req.url.startsWith('//')) throw new Error('bad request target');
    const url = new URL(req.url, 'http://localhost');
    path = decodeURIComponent(url.pathname);
    query = url.searchParams;
  } catch {
    res.writeHead(400, {'Content-Type': 'text/plain; charset=utf-8'});
    return res.end('bad request');
  }
  try {
    if (api.has(path)) return await api.handle(req, res, path, query);
    await serveStatic(req, res, path, query);
  } catch (e) {
    console.error('[server] ' + path + ':', e);
    if (res.headersSent) return res.destroy();
    res.writeHead(500, {'Content-Type': 'text/plain; charset=utf-8'});
    res.end('server error');
  }
});

server.on('error', async e => {
  await pool.end().catch(() => {});
  fail(e.code === 'EADDRINUSE'
    ? `port ${port} is already in use. Stop the other server or set PORT to a free port`
    : 'cannot start: ' + e.message);
});

server.listen(port, host, () => {
  console.log(`[server] GeoIntel listening on http://${host}:${port} (${production ? 'production' : 'development'})`);
});

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log('[server] ' + signal + ' received, shutting down');
  server.close(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
  server.closeIdleConnections();
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
