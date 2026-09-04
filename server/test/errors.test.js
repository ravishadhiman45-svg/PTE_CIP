// Error-code predicates.
//
// Route handlers turn a failed write into a 409 or a 400 based on these, so the
// mapping between a Postgres SQLSTATE and the API response lives here rather
// than being re-derived at each call site.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isUniqueViolation,
  isForeignKeyViolation,
  isReportingCycle,
} = require('../src/db/errors');

const pgErr = (code, message = 'boom') => Object.assign(new Error(message), { code });

// ---------------------------------------------------------------------------
// Unique violations — routes/employees.js, routes/skills.js
// ---------------------------------------------------------------------------

test('23505 is a unique violation', () => {
  assert.equal(isUniqueViolation(pgErr('23505')), true);
});

test('another SQLSTATE is not a unique violation', () => {
  assert.equal(isUniqueViolation(pgErr('23503')), false);
  assert.equal(isUniqueViolation(pgErr('42P01')), false);
});

// ---------------------------------------------------------------------------
// Foreign keys
// ---------------------------------------------------------------------------

test('23503 is a foreign-key violation', () => {
  assert.equal(isForeignKeyViolation(pgErr('23503')), true);
  assert.equal(isForeignKeyViolation(pgErr('23505')), false);
});

// ---------------------------------------------------------------------------
// The manager-reparenting guard — routes/employees.js
//
// db/pg/07_org_hierarchy.sql raises a check_violation whose MESSAGE carries
// "Reporting cycle". Both halves are required: a CHECK constraint failing for
// any other reason must not be reported to the user as a reporting cycle.
// ---------------------------------------------------------------------------

test('a check violation naming a reporting cycle is one', () => {
  const err = pgErr('23514', 'Reporting cycle: a is already inside the subtree of b');
  assert.equal(isReportingCycle(err), true);
});

test('a check violation with a different message is not', () => {
  assert.equal(isReportingCycle(pgErr('23514', 'value too low')), false);
});

test('a reporting-cycle message under a different SQLSTATE is not', () => {
  assert.equal(isReportingCycle(pgErr('23505', 'Reporting cycle')), false);
});

// ---------------------------------------------------------------------------
// Nothing throws on a missing or malformed error.
// ---------------------------------------------------------------------------

test('predicates fail closed on null', () => {
  for (const fn of [isUniqueViolation, isForeignKeyViolation, isReportingCycle]) {
    assert.equal(fn(null), false);
    assert.equal(fn(undefined), false);
    assert.equal(fn({}), false);
  }
});
