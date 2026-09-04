// PGlite driver — real PostgreSQL, compiled to WASM, running inside this
// process against a plain directory.
//
// WHY
// ---
// The offline deployment target cannot run a database server: no service, no
// login, no credentials, no admin rights. PGlite removes the server without
// removing Postgres, so db/pg/*.sql and every statement in routes/ are used
// VERBATIM. There is no second schema and no SQL translation layer.
//
// It presents exactly the `pg` contract — query(text, params) -> { rows,
// rowCount } and withTransaction(fn) where fn receives .query(text, params) —
// so nothing above this file knows which driver is active.
//
// Three places PGlite's raw output differs from `pg`, all corrected here:
//   * int8/bigint  PGlite parses to a JS number, `pg` returns a string
//   * date         PGlite builds a UTC Date, `pg` builds a local-midnight one
//   * rowCount     PGlite reports `affectedRows` and leaves it 0 for SELECTs
//
// The first two are fixed by handing PGlite `pg`'s own type parsers, so the
// values are produced by the same code the Supabase path uses rather than by a
// lookalike of it.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const types = require('pg-types');

const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');

// A RELATIVE PGLITE_DATA_DIR resolves against the server package root, not the
// process working directory — a service started from C:\Windows\System32 must
// not quietly create a second, empty database. Same reasoning as
// storage/localDisk.js.
const SERVER_ROOT = path.resolve(__dirname, '../..');
const SQL_DIR = path.resolve(SERVER_ROOT, '../db/pg');

const configured = (process.env.PGLITE_DATA_DIR || '').trim();

// `memory://` is PGlite's throwaway instance, used by the test suite.
const dataDir =
  configured === 'memory://'
    ? 'memory://'
    : configured
      ? path.resolve(SERVER_ROOT, configured)
      : path.join(SERVER_ROOT, '.pgdata');

// Only the OIDs where PGlite and `pg` disagree. Overriding the whole table
// would mean silently re-deciding types that already match.
const parsers = {};
for (const oid of [types.builtins.INT8, types.builtins.DATE]) {
  parsers[oid] = types.getTypeParser(oid, 'text');
}

// db/pg/ is the single source of schema truth. Picked up by glob rather than
// listed, so a new numbered migration needs no change here.
//
// 03 is scratch (SELECTs a developer runs by hand) and 04 is a diagram.
const SKIP = new Set(['03_demo_queries.sql']);

function migrationFiles() {
  return fs
    .readdirSync(SQL_DIR)
    .filter((f) => /^\d\d_.*\.sql$/.test(f) && !SKIP.has(f))
    .sort();
}

// Applies any db/pg/*.sql not yet recorded.
//
// The ledger INSERT is appended to the file's own SQL so the two land in ONE
// simple-protocol batch, which Postgres runs as a single implicit transaction.
// A file therefore cannot be half-applied and then recorded — an interrupted
// bootstrap resumes from the last complete file rather than leaving a .pgdata
// that looks loaded but is missing a view.
async function bootstrap(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS _pglite_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const { rows } = await db.query('SELECT filename FROM _pglite_migrations');
  const done = new Set(rows.map((r) => r.filename));
  const pending = migrationFiles().filter((f) => !done.has(f));

  if (pending.length === 0) return;

  console.log(`[db] pglite: applying ${pending.length} schema file(s) from db/pg/`);

  for (const file of pending) {
    const sql = await fsp.readFile(path.join(SQL_DIR, file), 'utf8');
    try {
      await db.exec(
        `${sql}\n;\nINSERT INTO _pglite_migrations (filename) VALUES ('${file}');`
      );
    } catch (err) {
      throw new Error(`[db] pglite: ${file} failed to load — ${err.message}`);
    }
    console.log(`[db] pglite: applied ${file}`);
  }
}

let ready = null;

// Boot is ~5s (WASM compile) plus ~1s the first time, when the schema loads.
// Memoised, and shared by query/withTransaction/selfTest so whichever runs
// first pays for it.
function getDb() {
  if (!ready) {
    ready = (async () => {
      const db = await PGlite.create(dataDir, { extensions: { pgcrypto }, parsers });
      await bootstrap(db);
      return db;
    })().catch((err) => {
      // Do not cache a failed init — a fixed permission or freed lock should be
      // retryable without restarting the process.
      ready = null;
      throw err;
    });
  }
  return ready;
}

// pg semantics: for a statement that returns rows, rowCount is the number of
// rows returned; otherwise the number of rows affected.
function shape(result) {
  const rows = result.rows || [];
  return { rows, rowCount: rows.length > 0 ? rows.length : result.affectedRows || 0 };
}

async function query(text, params) {
  const db = await getDb();
  return shape(await db.query(text, params));
}

// NOTE: PGlite is a SINGLE connection. `db.transaction()` holds it exclusively,
// so queries issued inside must be awaited sequentially — concurrent work on
// the same `tx` would wait on a connection the transaction itself is holding.
// Every transactional body in this codebase already awaits in order; keep it
// that way. Parallel work belongs on query(), outside a transaction.
async function withTransaction(fn) {
  const db = await getDb();
  // PGlite rolls back automatically when the callback throws, and commits when
  // it returns — the same guarantee pg.js implements by hand.
  return db.transaction((tx) => fn({ query: (text, params) => tx.query(text, params).then(shape) }));
}

// Exercised at boot so a broken data directory fails before binding a port.
// Deliberately checks the DDL too: an empty .pgdata that connects fine but has
// no schema would otherwise 500 on every request instead of failing to start.
async function selfTest() {
  const db = await getDb();

  const basic = await db.query('SELECT 1 AS ok');
  if (!basic.rows[0] || basic.rows[0].ok !== 1) {
    throw new Error('[db] pglite self-test: unexpected result from SELECT 1');
  }

  try {
    await db.query('SELECT employee_id FROM visible_employee_ids($1, $2) LIMIT 1', [
      '00000000-0000-0000-0000-000000000001',
      false,
    ]);
  } catch (err) {
    throw new Error(
      `[db] pglite self-test: visible_employee_ids() is missing from ${dataDir}. ` +
        `Delete that directory to have db/pg/*.sql reloaded. (${err.message})`
    );
  }
}

async function close() {
  if (!ready) return;
  const db = await ready;
  ready = null;
  await db.close();
}

module.exports = { query, withTransaction, selfTest, close, dataDir, migrationFiles };
