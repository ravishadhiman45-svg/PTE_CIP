// One error vocabulary across both drivers.
//
// Route code already branches on Postgres SQLSTATE strings:
//
//   routes/employees.js:241   err.code === '23505'   duplicate employee_code/email
//   routes/skills.js:107      err.code === '23505'   duplicate skill code
//   routes/employees.js:589   err.code === '23514' + /Reporting cycle/  manager loop
//
// Rather than make every handler learn a second set of numbers, the mssql
// driver stamps the equivalent SQLSTATE onto the error it throws. Postgres
// errors already carry `code`, so that path is untouched.

// SQL Server error numbers -> Postgres SQLSTATE.
const MSSQL_TO_SQLSTATE = {
  2627: '23505', // violation of PRIMARY KEY or UNIQUE constraint
  2601: '23505', // cannot insert duplicate key row in a unique index
  547: '23503', // FOREIGN KEY / CHECK constraint conflict
  515: '23502', // cannot insert NULL into a non-nullable column
  8152: '22001', // string or binary data would be truncated
  241: '22007', // failed to convert to a date
};

// The manager-cycle trigger raises this with THROW. It has to be an application
// error number (>= 50000) and it must map to the CHECK-violation SQLSTATE that
// routes/employees.js:589 already looks for, so the API response is identical on
// both dialects.
//
// Keep in sync with db/mssql/07_org_hierarchy.sql.
const CYCLE_ERROR_NUMBER = 50007;

// Annotates an mssql error with a Postgres-compatible `code`, in place.
function annotateMssqlError(err) {
  if (!err) return err;

  // `mssql` surfaces the server number on .number, and wraps batches in a
  // RequestError whose .originalError holds the real one.
  const number =
    err.number ??
    (err.originalError && (err.originalError.number ?? err.originalError.code)) ??
    null;

  if (number === CYCLE_ERROR_NUMBER) {
    err.code = '23514';
    return err;
  }

  const mapped = MSSQL_TO_SQLSTATE[number];
  if (mapped) err.code = mapped;

  return err;
}

// Dialect-independent predicate for "this row already exists".
// Prefer this over comparing `err.code` by hand in new code.
function isUniqueViolation(err) {
  if (!err) return false;
  if (err.code === '23505') return true;
  const number = err.number ?? (err.originalError && err.originalError.number);
  return number === 2627 || number === 2601;
}

function isForeignKeyViolation(err) {
  if (!err) return false;
  if (err.code === '23503') return true;
  const number = err.number ?? (err.originalError && err.originalError.number);
  return number === 547;
}

// The manager-reparenting guard. Postgres raises a check_violation whose message
// carries "Reporting cycle"; SQL Server raises CYCLE_ERROR_NUMBER.
function isReportingCycle(err) {
  if (!err) return false;
  const number = err.number ?? (err.originalError && err.originalError.number);
  if (number === CYCLE_ERROR_NUMBER) return true;
  return err.code === '23514' && /Reporting cycle/i.test(err.message || '');
}

module.exports = {
  MSSQL_TO_SQLSTATE,
  CYCLE_ERROR_NUMBER,
  annotateMssqlError,
  isUniqueViolation,
  isForeignKeyViolation,
  isReportingCycle,
};
