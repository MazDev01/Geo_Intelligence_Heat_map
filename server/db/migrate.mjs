import {readdirSync, readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {makePool} from './pool.mjs';

const DIR = fileURLToPath(new URL('./migrations/', import.meta.url));
const NAME_RE = /^(\d{3})_[a-z0-9_]+\.sql$/;
const LOCK_KEY = 762019;

function loadFiles() {
  const names = readdirSync(DIR).filter(n => n.endsWith('.sql')).sort();
  const seen = new Set();
  return names.map(name => {
    const m = NAME_RE.exec(name);
    if (!m) throw new Error('bad migration file name: ' + name + ' (expected 001_some_name.sql)');
    if (seen.has(m[1])) throw new Error('duplicate migration number: ' + m[1]);
    seen.add(m[1]);
    const sql = readFileSync(DIR + name, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
    if (/^\s*(begin|commit|rollback)\s*;/im.test(sql))
      throw new Error(name + ': remove begin/commit/rollback, the runner wraps each file in one transaction');
    return {name, sql, checksum: createHash('sha256').update(sql).digest('hex')};
  });
}

async function ensureTable(client) {
  await client.query(`create table if not exists schema_migrations (
    name       text primary key,
    checksum   text not null,
    applied_at timestamptz not null default now()
  )`);
}

async function appliedMap(client) {
  const r = await client.query('select name, checksum, applied_at from schema_migrations order by name');
  return new Map(r.rows.map(x => [x.name, x]));
}

function checkHistory(files, applied) {
  const known = new Set(files.map(f => f.name));
  for (const name of applied.keys())
    if (!known.has(name)) throw new Error('applied migration is missing from disk: ' + name);
  let gap = null;
  for (const f of files) {
    const a = applied.get(f.name);
    if (!a) { gap = gap || f.name; continue; }
    if (gap) throw new Error(f.name + ' is applied but earlier ' + gap + ' is not');
    if (a.checksum !== f.checksum)
      throw new Error(f.name + ' was edited after it was applied. Add a new migration file instead');
  }
}

async function hasSchema(client) {
  const r = await client.query("select to_regclass('public.users') is not null as yes");
  return r.rows[0].yes;
}

async function run(command) {
  const files = loadFiles();
  const pool = makePool();
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK_KEY]);
    await ensureTable(client);
    const applied = await appliedMap(client);
    checkHistory(files, applied);
    const pending = files.filter(f => !applied.has(f.name));

    if (command === 'status') {
      for (const f of files) {
        const a = applied.get(f.name);
        console.log((a ? 'applied  ' + a.applied_at.toISOString().slice(0, 19) + 'Z' : 'pending                      ') + '  ' + f.name);
      }
      console.log(pending.length + ' pending');
      return;
    }

    if (command === 'baseline') {
      if (applied.size) throw new Error('baseline refused: schema_migrations already has rows');
      if (!(await hasSchema(client))) throw new Error('baseline refused: the database has no tables, run migrate instead');
      const first = files[0];
      if (!first) throw new Error('no migration files');
      await client.query('insert into schema_migrations (name, checksum) values ($1, $2)', [first.name, first.checksum]);
      console.log('baseline  ' + first.name + ' marked as applied without running it');
      return;
    }

    if (command !== 'up') throw new Error('unknown command: ' + command + ' (use up, status or baseline)');

    if (!applied.size && pending.length && (await hasSchema(client)))
      throw new Error('tables exist but no migration is recorded. Run "baseline" once if this database was created from the old schema.sql');

    for (const f of pending) {
      await client.query('begin');
      try {
        await client.query(f.sql);
        await client.query('insert into schema_migrations (name, checksum) values ($1, $2)', [f.name, f.checksum]);
        await client.query('commit');
        console.log('applied   ' + f.name);
      } catch (e) {
        await client.query('rollback');
        throw new Error(f.name + ' failed and was rolled back: ' + e.message);
      }
    }
    console.log(pending.length ? pending.length + ' migration(s) applied' : 'up to date');
  } finally {
    try { await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]); } catch {}
    client.release();
    await pool.end();
  }
}

run(process.argv[2] || 'up').catch(e => {
  console.error('[migrate] ' + e.message);
  process.exitCode = 1;
});
