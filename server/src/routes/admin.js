// Admin: users, taxonomy, audit logs, system settings.
const express = require('express');
const { query } = require('../db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// Only admins may hit admin endpoints.
router.use(requireRole('admin'));

// GET /api/admin/users
router.get('/users', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT au.id, au.email, au.display_name, au.is_active, au.last_login_at,
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
       ORDER BY au.display_name`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/audit-logs
router.get('/audit-logs', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT al.id, al.action, al.entity_type, al.entity_id, al.created_at,
              actor.full_name AS actor
       FROM audit_logs al
       LEFT JOIN employees actor ON actor.id = al.actor_employee_id
       ORDER BY al.created_at DESC
       LIMIT 100`
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
