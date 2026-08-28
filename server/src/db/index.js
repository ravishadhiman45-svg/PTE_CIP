// The data layer. Every route imports from here and from nowhere else.
//
// Contract, identical on both dialects:
//   query(text, params)      -> Promise<{ rows, rowCount }>
//   withTransaction(fn)      -> fn receives { query(text, params) }
//   sql({ pg, mssql })       -> the branch for the active dialect
//   isUniqueViolation(err)   -> dialect-independent error predicates
//
// SQL is authored in POSTGRES flavour with $n placeholders, everywhere. The
// translation to T-SQL happens in here, after any caller-side string building —
// which is what lets lib/visibility.js keep computing placeholder numbers at
// runtime without knowing the dialect.
//
// NOTE: `pool` is deliberately NOT exported. Transactions must go through
// withTransaction so both drivers can implement their own object model;
// `grep -rn "pool" src/routes/` should stay empty.

const { dialect, isMssql, isPostgres } = require('./dialect');
const { sql } = require('./sql');
const {
  isUniqueViolation,
  isForeignKeyViolation,
  isReportingCycle,
  CYCLE_ERROR_NUMBER,
} = require('./errors');

const impl = isMssql ? require('./mssql') : require('./pg');

module.exports = {
  query: impl.query,
  withTransaction: impl.withTransaction,
  selfTest: impl.selfTest,
  close: impl.close,

  dialect,
  isMssql,
  isPostgres,

  sql,
  isUniqueViolation,
  isForeignKeyViolation,
  isReportingCycle,
  CYCLE_ERROR_NUMBER,
};
