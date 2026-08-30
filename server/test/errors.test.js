// Error-code translation.
//
// Route handlers branch on Postgres SQLSTATE strings today. Rather than teach
// every handler a second vocabulary, the mssql driver stamps the equivalent
// SQLSTATE on the errors it throws. These tests pin the mapping for the three
// checks that exist in the codebase.

process.env.DB_DIALECT = 'postgres';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  annotateMssqlError,
  isUniqueViolation,
  isForeignKeyViolation,
  isReportingCycle,
  CYCLE_ERROR_NUMBER,
  MSSQL_TO_SQLSTATE,
} = require('../src/db/errors');

const mssqlErr = (number, message = 'boom') => Object.assign(new Error(message), { number });

// ---------------------------------------------------------------------------
// Unique violations — routes/employees.js:241, routes/skills.js:107
// ---------------------------------------------------------------------------

test('SQL Server 2627 and 2601 both map to SQLSTATE 23505', () => {
  assert.equal(annotateMssqlError(mssqlErr(2627)).code, '23505');
  assert.equal(annotateMssqlError(mssqlErr(2601)).code, '23505');
});

test('isUniqueViolation accepts both dialects', () => {
  assert.ok(isUniqueViolation(Object.assign(new Error(), { code: '23505' })), 'postgres');
  assert.ok(isUniqueViolation(mssqlErr(2627)), 'mssql PK/unique constraint');
  assert.ok(isUniqueViolation(mssqlErr(2601)), 'mssql unique index');
});

test('isUniqueViolation rejects unrelated errors', () => {
  assert.equal(isUniqueViolation(null), false);
  assert.equal(isUniqueViolation(undefined), false);
  assert.equal(isUniqueViolation(new Error('nope')), false);
  assert.equal(isUniqueViolation(mssqlErr(547)), false, 'FK violation is not a duplicate');
  assert.equal(isUniqueViolation(Object.assign(new Error(), { code: '23503' })), false);
});

test('foreign-key violations map to 23503', () => {
  assert.equal(annotateMssqlError(mssqlErr(547)).code, '23503');
  assert.ok(isForeignKeyViolation(mssqlErr(547)));
  assert.ok(isForeignKeyViolation(Object.assign(new Error(), { code: '23503' })));
  assert.equal(isForeignKeyViolation(mssqlErr(2627)), false);
});

test('the documented number mapping is complete for the codes we rely on', () => {
  assert.equal(MSSQL_TO_SQLSTATE[2627], '23505');
  assert.equal(MSSQL_TO_SQLSTATE[2601], '23505');
  assert.equal(MSSQL_TO_SQLSTATE[547], '23503');
  assert.equal(MSSQL_TO_SQLSTATE[515], '23502');
});

// ---------------------------------------------------------------------------
// The manager-cycle guard — routes/employees.js:589
// ---------------------------------------------------------------------------

test('the cycle trigger number maps to the check-violation SQLSTATE', () => {
  // routes/employees.js:589 looks for '23514'. Keeping the mapping means the
  // API returns the same response on both dialects.
  assert.equal(annotateMssqlError(mssqlErr(CYCLE_ERROR_NUMBER)).code, '23514');
});

test('the cycle number is in the user-defined range', () => {
  // T-SQL THROW requires an error number >= 50000.
  assert.ok(CYCLE_ERROR_NUMBER >= 50000, `${CYCLE_ERROR_NUMBER} must be >= 50000`);
});

test('isReportingCycle recognises both dialects', () => {
  assert.ok(isReportingCycle(mssqlErr(CYCLE_ERROR_NUMBER)), 'mssql');
  assert.ok(
    isReportingCycle(
      Object.assign(new Error('Reporting cycle: X is already inside the subtree of Y'), {
        code: '23514',
      })
    ),
    'postgres'
  );
});

test('isReportingCycle does not fire on an unrelated check violation', () => {
  // Postgres uses 23514 for EVERY check constraint, so the message match is
  // load-bearing: employees_org_title_check must not be reported as a cycle.
  assert.equal(
    isReportingCycle(
      Object.assign(new Error('violates check constraint "employees_org_title_check"'), {
        code: '23514',
      })
    ),
    false
  );
});

// ---------------------------------------------------------------------------
// Shape robustness
// ---------------------------------------------------------------------------

test('an error number carried on originalError is still found', () => {
  // `mssql` wraps batch failures in a RequestError.
  const wrapped = Object.assign(new Error('Request failed'), {
    originalError: { number: 2627 },
  });
  assert.equal(annotateMssqlError(wrapped).code, '23505');
  assert.ok(isUniqueViolation(wrapped));
});

test('an unmapped error number leaves code untouched', () => {
  const err = annotateMssqlError(mssqlErr(99999));
  assert.equal(err.code, undefined);
});

test('annotating null or undefined does not throw', () => {
  assert.doesNotThrow(() => annotateMssqlError(null));
  assert.doesNotThrow(() => annotateMssqlError(undefined));
});

test('annotate returns the same error object, for use in a throw chain', () => {
  const err = mssqlErr(2627);
  assert.equal(annotateMssqlError(err), err);
});
