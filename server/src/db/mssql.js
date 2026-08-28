// Microsoft SQL Server driver.
//
// Presents exactly the `pg` contract — query(text, params) -> { rows, rowCount }
// and withTransaction(fn) where fn receives a .query(text, params) — so route
// code is dialect-agnostic. Three layers do the work:
//
//   rewrite.js    query text: $n -> @pn, dbo. qualification, safe token swaps
//   normalize.js  parameters in, and result values out
//   errors.js     SQL Server error numbers -> Postgres SQLSTATE strings
//
// `mssql` is required lazily so a Postgres-only deployment never needs the
// package installed.

const { rewrite, placeholderInfo } = require('./rewrite');
const { normalizeMssqlRecordset, inferType, marshalValue } = require('./normalize');
const { annotateMssqlError } = require('./errors');

let sqlMod;
try {
  // eslint-disable-next-line global-require
  sqlMod = require('mssql');
} catch {
  throw new Error(
    '[db] DB_DIALECT=mssql but the `mssql` package is not installed. Run: npm install mssql'
  );
}

function buildConfig() {
  // A full connection string wins, for deployments that already manage one.
  if (process.env.MSSQL_CONNECTION_STRING) return process.env.MSSQL_CONNECTION_STRING;

  const server = process.env.MSSQL_SERVER;
  const database = process.env.MSSQL_DATABASE;

  if (!server || !database) {
    throw new Error(
      '[db] DB_DIALECT=mssql requires MSSQL_SERVER and MSSQL_DATABASE ' +
        '(or MSSQL_CONNECTION_STRING) in server/.env'
    );
  }

  const bool = (name, fallback) => {
    const v = process.env[name];
    if (v === undefined || v === '') return fallback;
    return /^(1|true|yes)$/i.test(v);
  };

  return {
    server,
    database,
    port: Number(process.env.MSSQL_PORT || 1433),
    user: process.env.MSSQL_USER,
    password: process.env.MSSQL_PASSWORD,
    options: {
      // An on-premise instance usually presents a self-signed certificate, so
      // encryption stays on while cert verification is relaxed by default.
      // Both are explicit env vars because "encrypt off" is a real decision.
      encrypt: bool('MSSQL_ENCRYPT', true),
      trustServerCertificate: bool('MSSQL_TRUST_SERVER_CERT', true),
      // Named instances (SQLEXPRESS etc.) are the norm on a client machine.
      ...(process.env.MSSQL_INSTANCE ? { instanceName: process.env.MSSQL_INSTANCE } : {}),
      // Keep BIGINT as a string, matching how pg returns int8.
      useUTC: true,
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    connectionTimeout: 15000,
    requestTimeout: 30000,
  };
}

let poolPromise = null;

function getPool() {
  if (!poolPromise) {
    const pool = new sqlMod.ConnectionPool(buildConfig());
    pool.on('error', (err) => console.error('[db] mssql pool error', err));
    poolPromise = pool.connect();
  }
  return poolPromise;
}

// Binds `params` onto a Request as @p1..@pn.
//
// Only the indices the statement actually MENTIONS are bound, and each is bound
// exactly once. That is what lets a reused placeholder work unchanged: the SQL
// at routes/verification.js:110 mentions $2 twice, and binding @p2 a second
// time would be an error.
function bindParams(request, text, params) {
  const { indices } = placeholderInfo(text);

  for (const n of indices) {
    if (n > params.length) {
      throw new Error(
        `[db] SQL references $${n} but only ${params.length} parameter(s) were passed`
      );
    }
    const value = marshalValue(params[n - 1]);
    request.input(`p${n}`, inferType(sqlMod, value), value);
  }
}

// pg semantics for rowCount: for statements that return rows it is the number
// of rows returned; otherwise the number of rows affected.
function shapeResult(result) {
  const recordset = result.recordset;

  if (recordset) {
    const rows = normalizeMssqlRecordset(recordset);
    return { rows, rowCount: rows.length };
  }

  const affected = Array.isArray(result.rowsAffected)
    ? result.rowsAffected.reduce((a, b) => a + b, 0)
    : 0;
  return { rows: [], rowCount: affected };
}

async function runOn(connectable, text, params = []) {
  const rewritten = rewrite(text);
  const request = new sqlMod.Request(connectable);
  bindParams(request, text, params);

  try {
    return shapeResult(await request.query(rewritten));
  } catch (err) {
    annotateMssqlError(err);
    throw err;
  }
}

async function query(text, params) {
  return runOn(await getPool(), text, params);
}

async function withTransaction(fn) {
  const pool = await getPool();
  const tx = new sqlMod.Transaction(pool);

  // A statement error can DOOM the transaction, after which rollback() throws
  // "No transaction is in progress" — which would replace the real error with a
  // useless one. The driver reports that state via the 'rollback' event.
  let aborted = false;
  tx.on('rollback', () => {
    aborted = true;
  });

  await tx.begin();

  try {
    // NOTE: `mssql` serialises requests on a transaction's single connection,
    // so concurrent queries on the same `tx` throw. Every transactional body in
    // this codebase awaits sequentially; keep it that way. Parallel work belongs
    // on the pool (query()), not inside a transaction.
    const result = await fn({ query: (text, params) => runOn(tx, text, params) });
    await tx.commit();
    return result;
  } catch (err) {
    if (!aborted) {
      try {
        await tx.rollback();
      } catch (rollbackErr) {
        console.error('[db] ROLLBACK failed', rollbackErr);
      }
    }
    throw err;
  }
}

// Boot self-test. Deliberately exercises the three things most likely to be
// broken on a fresh on-premise install, in the order they would fail:
//   1. the DDL was never loaded          -> the TVF does not exist
//   2. boolean params bind as BIT        -> visibility would break everywhere
//   3. uuids round-trip and come back lowercase (see normalize.js)
async function selfTest() {
  const pool = await getPool();

  const basic = await runOn(pool, 'SELECT 1 AS ok');
  if (!basic.rows[0] || basic.rows[0].ok !== 1) {
    throw new Error('[db] self-test: unexpected result from SELECT 1');
  }

  const probe = await runOn(
    pool,
    'SELECT $1 AS flag, CAST($2 AS uniqueidentifier) AS id',
    [false, '00000000-0000-0000-0000-000000000001']
  );
  if (probe.rows[0].flag !== false) {
    throw new Error('[db] self-test: boolean parameter did not round-trip as BIT');
  }
  if (probe.rows[0].id !== '00000000-0000-0000-0000-000000000001') {
    throw new Error(
      `[db] self-test: uuid did not normalise to lowercase (got ${probe.rows[0].id})`
    );
  }

  try {
    await runOn(pool, 'SELECT TOP 1 employee_id FROM visible_employee_ids($1, $2)', [
      '00000000-0000-0000-0000-000000000001',
      false,
    ]);
  } catch (err) {
    throw new Error(
      '[db] self-test: visible_employee_ids() is missing. Load db/mssql/*.sql into this ' +
        `database before starting the API. (${err.message})`
    );
  }
}

async function close() {
  if (!poolPromise) return;
  const pool = await poolPromise;
  await pool.close();
  poolPromise = null;
}

module.exports = { query, withTransaction, selfTest, close };
