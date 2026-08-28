// Who can see whose records.
//
// The rule itself lives in SQL (db/07_org_hierarchy.sql):
//
//   FULL    = your own record + everyone in your subtree, all levels down
//   MINIMAL = the chain above you, as name + title only (employee_chain())
//   NONE    = peers, siblings, other branches
//   admin   = everyone, FULL
//
// Nothing in this file reimplements that rule — these helpers only shuttle the
// viewer's identity into visible_employee_ids() / can_view_employee(). Keeping
// the predicate in one SQL function is what lets an RLS policy call it verbatim
// later without the two definitions drifting apart.
const { query } = require('../db');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// `admin` is the ONLY permission role that affects visibility. executive,
// department_head, manager and the rest answer "what features can I use", not
// "whose records can I see" — the Executive Officer sees everyone because they
// are the root of the tree, not because of a role.
//
// The Array.isArray guard is load-bearing, not defensive noise. Without it a
// `roles` claim that is a STRING would be tested with String.prototype.includes,
// which does substring matching: both "admin" and "not-an-admin" would grant the
// bypass. An authorization check must fail closed on a malformed claim.
function isAdmin(user) {
  const roles = user && user.roles;
  return Array.isArray(roles) && roles.includes('admin');
}

// Appends the viewer + admin flag to `params` and returns a subquery yielding
// every employee id this user may see. Usage:
//
//   const params = [something];
//   const sql = `SELECT ... WHERE e.id IN (${visibleIdsSql(req.user, params)})`;
//   await query(sql, params);
//
// Taking `params` by reference keeps the placeholder numbers correct no matter
// how many the caller already had.
function visibleIdsSql(user, params) {
  params.push(user.employee_id, isAdmin(user));
  return `SELECT employee_id FROM visible_employee_ids($${params.length - 1}, $${params.length})`;
}

// True if `user` may see the full record of `targetId`.
async function canView(user, targetId) {
  if (isAdmin(user)) return true;
  // A malformed :id is a miss, not a 500 — it can never name a real employee.
  if (!UUID_RE.test(String(targetId || ''))) return false;
  const { rows } = await query('SELECT can_view_employee($1, $2, false) AS ok', [
    user.employee_id,
    targetId,
  ]);
  return rows[0].ok === true;
}

// The MINIMAL tier: the reporting line above someone, nearest manager first.
// The SQL function projects only id/name/title/photo, so there is no column
// here through which a CV, contact detail or assessment could leak.
//
// ORDER BY is here rather than inside the function because a T-SQL inline
// table-valued function may not contain one. This is the better home for it
// anyway: "nearest manager first" is a requirement of this caller, and a result
// set's order was never really guaranteed by a function's internal ORDER BY.
async function managerChain(employeeId) {
  const { rows } = await query(
    `SELECT id, full_name, org_title, photo_url, distance
       FROM employee_chain($1)
      ORDER BY distance`,
    [employeeId]
  );
  return rows;
}

module.exports = { isAdmin, visibleIdsSql, canView, managerChain };
