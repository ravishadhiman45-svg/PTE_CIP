// One error vocabulary for the route handlers.
//
// Route code branches on Postgres SQLSTATE strings:
//
//   routes/employees.js   isUniqueViolation   duplicate employee_code/email
//   routes/skills.js      isUniqueViolation   duplicate skill code
//   routes/employees.js   isReportingCycle    manager loop
//
// These predicates exist so a handler never has to compare `err.code` to a
// bare string by hand, and so the manager-cycle case has one definition rather
// than a copy of the message regex per call site.

// "this row already exists" — unique_violation.
function isUniqueViolation(err) {
  return Boolean(err) && err.code === '23505';
}

// foreign_key_violation.
function isForeignKeyViolation(err) {
  return Boolean(err) && err.code === '23503';
}

// The manager-reparenting guard in db/pg/07_org_hierarchy.sql raises a
// check_violation whose message carries "Reporting cycle".
function isReportingCycle(err) {
  if (!err) return false;
  return err.code === '23514' && /Reporting cycle/i.test(err.message || '');
}

module.exports = {
  isUniqueViolation,
  isForeignKeyViolation,
  isReportingCycle,
};
