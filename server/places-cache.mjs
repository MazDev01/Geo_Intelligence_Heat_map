import pg from 'pg';
import {gzip} from 'node:zlib';
import {promisify} from 'node:util';
import {connectionConfig} from './db/pool.mjs';

const gz = promisify(gzip);
const CHANNEL = 'places_changed';
const MAX_ENTRIES = 64;
const RETRY_MS = 5000;

export function makePlacesCache(env) {
  let version = 0, live = false, client = null, stopped = false, timer = null;
  const entries = new Map();
  const loading = new Map();

  const reset = () => { version++; entries.clear(); loading.clear(); };

  const drop = c => {
    if (client !== c) return;
    client = null;
    live = false;
    reset();
    c.end().catch(() => {});
    if (!stopped && !timer) timer = setTimeout(() => { timer = null; connect(); }, RETRY_MS);
  };

  async function connect() {
    if (stopped) return;
    const c = new pg.Client(connectionConfig(env));
    client = c;
    c.on('notification', reset);
    c.on('error', e => { console.error('[cache] listener error:', e.message); drop(c); });
    c.on('end', () => drop(c));
    try {
      await c.connect();
      await c.query('listen ' + CHANNEL);
    } catch (e) {
      console.error('[cache] listener could not connect:', e.message);
      return drop(c);
    }
    if (client !== c) return;
    reset();
    live = true;
  }

  async function get(key, build) {
    if (!live) return {json: await build()};
    const hit = entries.get(key);
    if (hit) return hit;
    const pending = loading.get(key);
    if (pending) return pending;
    const v = version;
    const promise = (async () => {
      const json = await build();
      const entry = {gz: await gz(json)};
      if (live && v === version) {
        if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value);
        entries.set(key, entry);
      }
      return entry;
    })();
    loading.set(key, promise);
    try { return await promise; }
    finally { if (loading.get(key) === promise) loading.delete(key); }
  }

  connect();
  return {
    get,
    reset,
    get live() { return live; },
    async close() {
      stopped = true;
      clearTimeout(timer);
      const c = client;
      client = null;
      live = false;
      if (c) await c.end().catch(() => {});
    },
  };
}
