// Google OAuth login → app JWT. Only emails present in the employees table may sign in.
const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { query, sql } = require('../db');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// One shared password for every employee — the real access gate is the
// employees-table email check, which is identical to the Google path.
const SHARED_LOGIN_PASSWORD = process.env.SHARED_LOGIN_PASSWORD;

// Constant-time compare so the shared password can't be probed by timing.
function passwordMatches(supplied) {
  const a = Buffer.from(String(supplied));
  const b = Buffer.from(String(SHARED_LOGIN_PASSWORD));
  // timingSafeEqual throws on length mismatch, so that case is handled first.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// The permission roles for one employee, as a `roles` value.
//
// Postgres aggregates the joined rows with ARRAY_AGG(DISTINCT ...) FILTER.
// T-SQL has neither ARRAY_AGG nor FILTER, and — importantly — does not accept
// STRING_AGG(DISTINCT ...) either, so the DISTINCT has to happen in a derived
// table. Doing that as a correlated subquery also removes the three role joins
// and the GROUP BY from the mssql branch entirely, which is simpler than the
// original: the joins only existed to be collapsed again.
//
// The branches return DIFFERENT shapes — a real array on pg, a comma-separated
// string on SQL Server — which toRoleArray() below reconciles.
const Q_LOOKUP_EMPLOYEE = sql({
  pg: `SELECT e.id AS employee_id, e.full_name, e.email, e.job_role_id,
            e.photo_url, e.org_title,
            jr.role_name AS job_role_name, d.name AS department_name,
            COALESCE(
              ARRAY_AGG(DISTINCT pr.role_key) FILTER (WHERE pr.role_key IS NOT NULL),
              '{}'
            ) AS roles
     FROM employees e
     LEFT JOIN job_roles jr ON jr.id = e.job_role_id
     LEFT JOIN departments d ON d.id = e.department_id
     LEFT JOIN app_users au ON au.employee_id = e.id
     LEFT JOIN user_permission_role_map m ON m.user_id = au.id
     LEFT JOIN app_permission_roles pr ON pr.id = m.permission_role_id
     WHERE lower(e.email) = lower($1)
     GROUP BY e.id, e.full_name, e.email, e.job_role_id, e.photo_url, e.org_title,
              jr.role_name, d.name`,
  mssql: `SELECT e.id AS employee_id, e.full_name, e.email, e.job_role_id,
            e.photo_url, e.org_title,
            jr.role_name AS job_role_name, d.name AS department_name,
            (SELECT STRING_AGG(x.role_key, ',') FROM (
               SELECT DISTINCT pr.role_key
                 FROM app_users au
                 JOIN user_permission_role_map m ON m.user_id = au.id
                 JOIN app_permission_roles pr ON pr.id = m.permission_role_id
                WHERE au.employee_id = e.id AND pr.role_key IS NOT NULL
             ) x) AS roles
     FROM employees e
     LEFT JOIN job_roles jr ON jr.id = e.job_role_id
     LEFT JOIN departments d ON d.id = e.department_id
     WHERE lower(e.email) = lower($1)`,
});

// Normalises the `roles` column to a string array whichever driver produced it.
//
// This must never return a bare string: lib/visibility.js:27 guards with
// Array.isArray precisely because String.prototype.includes does SUBSTRING
// matching, which would make "not-an-admin" satisfy includes('admin').
function toRoleArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string' && value.length > 0) {
    return value.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

// Returns the employee row (with a `roles` array) or null if the email is unknown.
async function lookupEmployeeByEmail(email) {
  const { rows } = await query(Q_LOOKUP_EMPLOYEE, [email]);
  if (rows.length === 0) return null;

  const row = rows[0];
  row.roles = toRoleArray(row.roles);
  return row;
}

// Build the JWT payload + signed token for an employee row.
function issueToken(emp) {
  const roles = emp.roles || [];
  // Pick a primary role for display, in priority order.
  const priority = [
    'admin',
    'executive',
    'department_head',
    'manager',
    'training_coordinator',
    'sme',
    'mentor',
    'employee',
  ];
  const primaryRole = priority.find((p) => roles.includes(p)) || 'employee';

  const payload = {
    employee_id: emp.employee_id,
    email: emp.email,
    full_name: emp.full_name,
    role: primaryRole,
    roles,
    job_role_name: emp.job_role_name,
    department_name: emp.department_name,
    // Snapshot for the first paint. It goes stale the moment someone uploads a
    // new picture or changes title, so the UI refreshes from /employees/me —
    // this only avoids an empty avatar on the very first render.
    photo_url: emp.photo_url,
    org_title: emp.org_title,
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });
  return { token, user: payload };
}

// POST /api/auth/google  { credential }
// `credential` is the Google ID token returned by Google Identity Services.
router.post('/google', async (req, res, next) => {
  try {
    const { credential } = req.body || {};
    if (!credential) {
      return res.status(400).json({ error: 'Missing Google credential' });
    }
    if (!GOOGLE_CLIENT_ID) {
      return res.status(500).json({ error: 'Google sign-in is not configured on the server' });
    }

    // Verify the ID token with Google. Throws if signature/audience/expiry are invalid.
    let googlePayload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: GOOGLE_CLIENT_ID,
      });
      googlePayload = ticket.getPayload();
    } catch (e) {
      return res.status(401).json({ error: 'Invalid Google credential' });
    }

    const email = googlePayload && googlePayload.email;
    if (!email || !googlePayload.email_verified) {
      return res.status(401).json({ error: 'Google account email is not verified' });
    }

    // Email-must-exist gate: only known employees may sign in.
    const emp = await lookupEmployeeByEmail(email);
    if (!emp) {
      return res.status(403).json({ error: 'This Google account is not authorized for PTE CIP' });
    }

    const { token, user } = issueToken(emp);

    // Best-effort: record login + provider (ignore failure).
    query(
      "UPDATE app_users SET last_login_at = NOW(), auth_provider = 'Google' WHERE lower(email) = lower($1)",
      [email]
    ).catch(() => {});

    res.json({ token, user });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login  { email, password }
// Email + shared-password sign-in. The email gate is the same one the Google
// route uses: the address must exist in the employees table.
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    if (!SHARED_LOGIN_PASSWORD) {
      return res.status(500).json({ error: 'Password sign-in is not configured on the server' });
    }

    // Email-must-exist gate: only known employees may sign in.
    const emp = await lookupEmployeeByEmail(String(email).trim());
    if (!emp) {
      return res.status(403).json({ error: 'This email is not authorized for PTE CIP' });
    }

    if (!passwordMatches(password)) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    const { token, user } = issueToken(emp);

    // Best-effort: record login + provider (ignore failure).
    query(
      "UPDATE app_users SET last_login_at = NOW(), auth_provider = 'Password' WHERE lower(email) = lower($1)",
      [emp.email]
    ).catch(() => {});

    res.json({ token, user });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
