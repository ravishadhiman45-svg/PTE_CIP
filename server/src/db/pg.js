// PostgreSQL-over-TCP driver — Supabase, or any Postgres server.
//
// This is the REFERENCE implementation: its result shapes are what the Next.js
// client and every golden snapshot were built against, so it must not drift.
// db/pglite.js corrects itself towards this file, never the other way round.
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  // Fail fast rather than warn. The previous behaviour logged and then started
  // a server that returned 500 on every single request, which is a much worse
  // way to discover a missing environment variable.
  throw new Error(
    '[db] DATABASE_URL is not set. Copy server/.env.example to server/.env and set your connection string.'
  );
}

// Supabase's pooler certificate is not in the local trust store. Self-hosted
// Postgres over a trusted cert (or a unix socket) does not need this, so it is
// opt-out via PGSSL=disable rather than hardcoded.
const sslDisabled = (process.env.PGSSL || '').toLowerCase() === 'disable';

const pool = new Pool({
  connectionString,
  ssl: sslDisabled ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('[db] Unexpected error on idle client', err);
});

// pg already returns { rows, rowCount }, which is the shape the whole codebase
// destructures, so this is a pass-through.
function query(text, params) {
  return pool.query(text, params);
}

// Runs fn(tx) inside a transaction. `tx` exposes exactly .query(text, params),
// the same contract as the pool-level query, which is what lets helpers such as
// ensureCv(client, id) and uniqueSkillCode(client, name) take either one.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn({ query: (text, params) => client.query(text, params) });
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      // Never let a rollback failure mask the error that caused it.
      console.error('[db] ROLLBACK failed', rollbackErr);
    }
    throw err;
  } finally {
    client.release();
  }
}

// Exercised at boot so a misconfigured deployment fails before binding a port.
async function selfTest() {
  const { rows } = await pool.query('SELECT 1 AS ok');
  if (!rows[0] || rows[0].ok !== 1) throw new Error('[db] self-test returned unexpected result');
}

async function close() {
  await pool.end();
}

module.exports = { query, withTransaction, selfTest, close, pool };
