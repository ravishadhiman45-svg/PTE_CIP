// The data layer. Every route imports from here and from nowhere else.
//
// Contract, identical on both drivers:
//   query(text, params)      -> Promise<{ rows, rowCount }>
//   withTransaction(fn)      -> fn receives { query(text, params) }
//   isUniqueViolation(err)   -> error predicates over Postgres SQLSTATEs
//
// There is ONE SQL dialect: PostgreSQL, with $n placeholders. PG_DRIVER only
// chooses where that SQL runs:
//
//   server  -> pg.js      Supabase / any Postgres server over TCP
//   pglite  -> pglite.js  in-process Postgres (WASM) against a local directory
//
// Both are real Postgres, so the schema in db/pg/ and every statement in
// routes/ are shared verbatim. No rewriting, no per-driver SQL.
//
// NOTE: the connection pool is deliberately NOT exported. Transactions must go
// through withTransaction so both drivers can implement their own object model;
// `grep -rn "pool" src/routes/` should stay empty.

const {
  isUniqueViolation,
  isForeignKeyViolation,
  isReportingCycle,
} = require('./errors');

// Kept as an explicit setting so a deployment states its intent rather than
// having it inferred, but there is only one valid value now.
const dialect = (process.env.DB_DIALECT || 'postgres').trim().toLowerCase();
if (dialect !== 'postgres') {
  throw new Error(`[db] DB_DIALECT="${dialect}" is not supported. The only value is: postgres`);
}

const DRIVERS = ['server', 'pglite'];

const driver = (process.env.PG_DRIVER || 'server').trim().toLowerCase();
if (!DRIVERS.includes(driver)) {
  throw new Error(
    `[db] PG_DRIVER="${driver}" is not recognised. Valid values: ${DRIVERS.join(', ')}`
  );
}

const impl = driver === 'pglite' ? require('./pglite') : require('./pg');

module.exports = {
  query: impl.query,
  withTransaction: impl.withTransaction,
  selfTest: impl.selfTest,
  close: impl.close,

  dialect,
  driver,
  DRIVERS,

  isUniqueViolation,
  isForeignKeyViolation,
  isReportingCycle,
};
