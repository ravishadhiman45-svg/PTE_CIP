// Admin: users, taxonomy, audit logs, system settings.
const express = require('express');
const { query, sql } = require('../db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// ---------------------------------------------------------------
// Dialect-divergent SQL — see server/src/db/sql.js
// ---------------------------------------------------------------

// Permission role names per user. Same shape problem as the roles claim in
// routes/auth.js: T-SQL has no ARRAY_AGG and rejects STRING_AGG(DISTINCT ...),
// so the DISTINCT moves into a derived table inside a correlated subquery — and
// with it, the role joins and the GROUP BY disappear.
//
// pg returns a real array here, SQL Server a comma-separated string.
// toStringArray() reconciles them.
const Q_LIST_USERS = sql({
  pg: `SELECT au.id, au.email, au.display_name, au.is_active, au.last_login_at,
              e.employee_code, d.name AS department, jr.role_name AS job_role,
              COALESCE(
                ARRAY_AGG(DISTINCT pr.role_name) FILTER (WHERE pr.role_name IS NOT NULL), '{}'
              ) AS permission_roles
       FROM app_users au
       LEFT JOIN employees e ON e.id = au.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
       LEFT JOIN job_roles jr ON jr.id = e.job_role_id
       LEFT JOIN user_permission_role_map m ON m.user_id = au.id
       LEFT JOIN app_permission_roles pr ON pr.id = m.permission_role_id
       GROUP BY au.id, au.email, au.display_name, au.is_active, au.last_login_at,
                e.employee_code, d.name, jr.role_name
       ORDER BY au.display_name`,
  mssql: `SELECT au.id, au.email, au.display_name, au.is_active, au.last_login_at,
              e.employee_code, d.name AS department, jr.role_name AS job_role,
              (SELECT STRING_AGG(x.role_name, ',') FROM (
                 SELECT DISTINCT pr.role_name
                   FROM user_permission_role_map m
                   JOIN app_permission_roles pr ON pr.id = m.permission_role_id
                  WHERE m.user_id = au.id AND pr.role_name IS NOT NULL
               ) x) AS permission_roles
       FROM app_users au
       LEFT JOIN employees e ON e.id = au.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
       LEFT JOIN job_roles jr ON jr.id = e.job_role_id
       ORDER BY au.display_name`,
});

// LIMIT -> OFFSET/FETCH. Valid here because the statement already has an
// ORDER BY, which OFFSET/FETCH requires and LIMIT does not.
const Q_AUDIT_LOGS = sql({
  pg: `SELECT al.id, al.action, al.entity_type, al.entity_id, al.created_at,
              actor.full_name AS actor
       FROM audit_logs al
       LEFT JOIN employees actor ON actor.id = al.actor_employee_id
       ORDER BY al.created_at DESC
       LIMIT 100`,
  mssql: `SELECT al.id, al.action, al.entity_type, al.entity_id, al.created_at,
              actor.full_name AS actor
       FROM audit_logs al
       LEFT JOIN employees actor ON actor.id = al.actor_employee_id
       ORDER BY al.created_at DESC
       OFFSET 0 ROWS FETCH NEXT 100 ROWS ONLY`,
});

// Turns a delimited-string aggregate back into an array, so the API response is
// identical on both dialects.
function toStringArray(rows, column) {
  for (const row of rows) {
    const v = row[column];
    if (Array.isArray(v)) continue;
    row[column] =
      typeof v === 'string' && v.length > 0 ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
  }
  return rows;
}


// Only admins may hit admin endpoints.
router.use(requireRole('admin'));

// GET /api/admin/users
router.get('/users', async (req, res, next) => {
  try {
    const { rows } = await query(
      Q_LIST_USERS
    );
    res.json(toStringArray(rows, 'permission_roles'));
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/audit-logs
router.get('/audit-logs', async (req, res, next) => {
  try {
    const { rows } = await query(
      Q_AUDIT_LOGS
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/permission-roles
router.get('/permission-roles', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT pr.id, pr.role_key, pr.role_name, pr.description,
              COUNT(m.user_id) AS user_count
       FROM app_permission_roles pr
       LEFT JOIN user_permission_role_map m ON m.permission_role_id = pr.id
       GROUP BY pr.id, pr.role_key, pr.role_name, pr.description
       ORDER BY pr.role_name`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/settings — system_settings key/value.
router.get('/settings', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT setting_key, setting_value, updated_at FROM system_settings');
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
