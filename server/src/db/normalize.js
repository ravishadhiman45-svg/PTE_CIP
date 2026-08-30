// Makes SQL Server result rows indistinguishable from `pg` result rows.
//
// DIRECTION MATTERS: this normalises mssql TOWARDS postgres, never the other
// way round. The Postgres path is the working reference that the Next.js client
// and every golden snapshot were built against, so it must stay byte-identical.
// Every difference below is therefore corrected on the mssql side only.
//
// These are the bugs a SQL rewriter structurally cannot reach, because they
// live in the VALUES rather than in the query text. They are also the ones most
// likely to ship undetected, since the SQL runs fine and only the data is
// subtly wrong.

// Same shape as the guard in lib/visibility.js:16.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// (1) UUID CASING — the one that silently breaks authorization.
//
// `pg` returns uuid values lowercase. `tedious` returns uniqueidentifier
// UPPERCASE. Three sites compare ids with === :
//
//   middleware/auth.js:50      requireSelfOrAdmin — "is this my own record?"
//   routes/verification.js:74  approver must be in the requester's chain
//   routes/verification.js:81  same check, other branch
//
// All three fail CLOSED under a case mismatch, so the symptom would be "you
// cannot edit your own CV" rather than a data breach. That is luck, not design,
// and it is not a property worth relying on.
function normalizeUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value) ? value.toLowerCase() : value;
}

// (2) NUMERIC SHAPE — the one that reaches the React charts.
//
// `pg` returns NUMERIC/DECIMAL and BIGINT as STRINGS (to avoid precision loss),
// while `mssql` returns DECIMAL as a JS number. So routes/dashboard.js:44's
// avg_gap would be "1.25" on Postgres and 1.25 on SQL Server, and that
// difference travels all the way to the client verbatim.
//
// FLOAT/REAL are deliberately absent: `pg` returns float8 as a JS number too,
// so those already agree.
const STRINGIFY_DECLARATIONS = new Set(['decimal', 'numeric', 'money', 'smallmoney']);

// Reads mssql's recordset.columns metadata to decide which columns need
// stringifying. Metadata is used rather than value shape because a JS number
// alone cannot tell you whether the source column was int (agrees with pg) or
// decimal (does not).
function decimalColumns(columns) {
  const names = [];
  if (!columns) return names;
  for (const name of Object.keys(columns)) {
    const col = columns[name];
    const declaration = col && col.type && col.type.declaration;
    if (declaration && STRINGIFY_DECLARATIONS.has(String(declaration).toLowerCase())) {
      names.push(name);
    }
  }
  return names;
}

// Normalises one mssql recordset in place and returns it.
function normalizeMssqlRecordset(recordset) {
  if (!Array.isArray(recordset) || recordset.length === 0) return recordset || [];

  const toStringify = decimalColumns(recordset.columns);

  for (const row of recordset) {
    if (!row || typeof row !== 'object') continue;

    for (const key of Object.keys(row)) {
      row[key] = normalizeUuid(row[key]);
    }

    for (const key of toStringify) {
      const v = row[key];
      // NULL must stay NULL — pg does not turn it into the string "null".
      if (typeof v === 'number') row[key] = String(v);
    }
  }

  return recordset;
}

// (3) PARAMETER MARSHALLING — the inbound half of the same problem.
//
// Infers the SQL Server type for a JS value. Types are resolved from the caller
// -supplied `sql` module so this file never has to require('mssql'), keeping the
// Postgres deployment free of that dependency.
//
// Being exact here is not pedantry: binding a uuid as NVarChar still *works*
// via implicit conversion, but it defeats index seeks on every uuid predicate —
// and uuids are the join key for effectively every query in this app.
function inferType(sql, value) {
  if (value === null || value === undefined) return sql.NVarChar;

  switch (typeof value) {
    case 'boolean':
      // lib/visibility.js:42 pushes a raw JS boolean into all 40 scoped queries.
      return sql.Bit;
    case 'number':
      return Number.isInteger(value) ? sql.Int : sql.Float;
    case 'bigint':
      return sql.BigInt;
    case 'string':
      return UUID_RE.test(value) ? sql.UniqueIdentifier : sql.NVarChar;
    case 'object':
      if (value instanceof Date) return sql.DateTimeOffset;
      if (Buffer.isBuffer(value)) return sql.VarBinary;
      // Arrays and plain objects have no scalar equivalent. Callers that need
      // them must serialise to JSON and use OPENJSON on the SQL side — the
      // rewriter forbids UNNEST precisely so this is a deliberate choice.
      return sql.NVarChar;
    default:
      return sql.NVarChar;
  }
}

// `undefined` is not a value SQL Server can bind; pg coerces it to NULL, so
// match that rather than erroring differently per dialect.
function marshalValue(value) {
  if (value === undefined) return null;
  if (typeof value === 'object' && value !== null && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    return JSON.stringify(value);
  }
  return value;
}

module.exports = {
  UUID_RE,
  normalizeUuid,
  normalizeMssqlRecordset,
  decimalColumns,
  inferType,
  marshalValue,
  STRINGIFY_DECLARATIONS,
};
