import {createRequire} from 'node:module';
import {makePool} from './pool.mjs';
import {makeAuthAdapter} from './auth-adapter.mjs';
import {adminSeed} from './admin-seed.mjs';
import {writeAudit} from '../audit.mjs';

const require = createRequire(import.meta.url);
const {makeAuthStore} = require('../../auth-store.cjs');

async function run(argv) {
  if (argv.length > 1 || (argv[0] || '').startsWith('-'))
    throw new Error('usage: node server/db/set-password.mjs [administrator email]');
  const env = process.env;
  const seed = adminSeed(env);
  const email = (argv[0] || seed[0].email).trim().toLowerCase();
  const pool = makePool(env);
  try {
    const m = await pool.query('select count(*)::int as n from schema_migrations').catch(() => null);
    if (!m || !m.rows[0].n) throw new Error('database is not ready, run first: node server/db/migrate.mjs up');
    const store = makeAuthStore(makeAuthAdapter(pool), {seed});
    const user = await store.get(email);
    if (!user) throw new Error('no account with email ' + email);
    if (user.role !== 'Administrator') throw new Error(email + ' is not an Administrator, reset it from the user page instead');
    const r = await store.setPassword(email);
    if (!r.ok) throw new Error(r.error);
    await writeAudit(pool, {actor: {id: null, email: 'server-console'}, ip: null}, 'user_password_reset', email, {via: 'server-console'});
    console.log('account             ' + email);
    console.log('temporary password  ' + r.password);
    console.log('The password must be changed at the first sign-in. Every earlier session of this account was signed out.');
    if (user.status === 'Suspended') console.log('WARNING: this account is suspended and cannot sign in until another administrator re-activates it.');
  } finally {
    await pool.end();
  }
}

run(process.argv.slice(2)).catch(e => {
  console.error('[set-password] ' + e.message);
  process.exitCode = 1;
});
