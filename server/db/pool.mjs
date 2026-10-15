import pg from 'pg';

export function connectionConfig(env) {
  if (env.DATABASE_URL) return {connectionString: env.DATABASE_URL};
  if (!env.POSTGRES_PASSWORD)
    throw new Error('DATABASE_URL or POSTGRES_PASSWORD is required');
  return {
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT || 5433),
    database: env.POSTGRES_DB || 'geointel',
    user: env.POSTGRES_USER || 'geointel',
    password: env.POSTGRES_PASSWORD,
  };
}

export function makePool(env = process.env) {
  const pool = new pg.Pool({
    ...connectionConfig(env),
    options: '-c jit=off',
    max: Number(env.DB_POOL_MAX || 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 30000,
  });
  pool.on('error', e => console.error('[db] idle client error:', e.message));
  return pool;
}

export async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (e) {
    try { await client.query('rollback'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}
