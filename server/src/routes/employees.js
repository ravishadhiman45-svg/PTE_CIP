// Employee directory, profile (header + CV + skills passport + learning),
// and the self-service CV editing endpoints.
const express = require('express');
const multer = require('multer');
const { query, withTransaction, sql, isUniqueViolation } = require('../db');
const { requireRole, requireSelfOrAdmin, requireVisible } = require('../middleware/auth');
const { visibleIdsSql, canView, managerChain } = require('../lib/visibility');
const { streamCvPdf, cvFileName } = require('../lib/cvPdf');
const { uploadPublicFile, removePublicFolder } = require('../storage');
const { insertDefaultLevelDefinitions } = require('../lib/skillLevels');

const router = express.Router();

// Roles allowed to onboard people from the UI.
const MANAGE_ROLES = ['admin', 'executive', 'department_head'];

// Hierarchy labels. Deliberately not tied to depth: the org chart puts DDVM at
// depth 3 and 4, DPM at depth 4 and 5. Keep in step with the CHECK constraint in
// db/07_org_hierarchy.sql.
const ORG_TITLES = ['Executive Officer', 'Sr. DVM', 'DVM', 'DDVM', 'DPM', 'TM'];

// Profile pictures are small; keep them in memory and stream to Supabase Storage.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.mimetype)) {
      return cb(new Error('Only PNG, JPG, WEBP or GIF images are allowed'));
    }
    return cb(null, true);
  },
});

// Multer reports oversized/wrong-type files through next(err); translate those
// into a 400 instead of letting the generic error handler call them a 500.
function uploadPhoto(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const message =
        err.code === 'LIMIT_FILE_SIZE' ? 'Image must be smaller than 5 MB' : err.message;
      return res.status(400).json({ error: message });
    }
    return next();
  });
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

// ---------------------------------------------------------------
// Dialect-divergent SQL
//
// These statements use Postgres constructs with no token-level T-SQL
// equivalent, so each is written out per dialect. Both branches take the SAME
// params array, and both still go through the rewriter ($n -> @pn, dbo.
// qualification, boolean marshalling) — only the STRUCTURE is overridden.
//
// The T-SQL conditional inserts use WITH (UPDLOCK, HOLDLOCK) on the existence
// check. That is the standard idiom for a race-free "insert if absent": a bare
// NOT EXISTS lets two concurrent callers both see "absent" and one then hits a
// primary-key violation, whereas ON CONFLICT DO NOTHING is atomic. The locking
// hint restores the atomicity the Postgres version had.
// ---------------------------------------------------------------

const Q_ENSURE_CV = sql({
  pg: 'INSERT INTO employee_cv (employee_id) VALUES ($1) ON CONFLICT (employee_id) DO NOTHING',
  mssql: `INSERT INTO employee_cv (employee_id)
          SELECT $1 WHERE NOT EXISTS (
            SELECT 1 FROM employee_cv WITH (UPDLOCK, HOLDLOCK) WHERE employee_id = $1)`,
});

const Q_INSERT_EMPLOYEE = sql({
  pg: `INSERT INTO employees
         (employee_code, full_name, email, gender, grade, joining_date,
          department_id, team_id, job_role_id, manager_id, location_id, org_title,
          sibling_order)
       VALUES ($1,$2,$3,COALESCE($4,'Not Specified'),$5,$6,$7,$8,$9,$10,$11,$12,
          COALESCE((SELECT MAX(sibling_order) + 1 FROM employees WHERE manager_id = $10), 1))
       RETURNING id, employee_code, full_name, email, org_title`,
  // OUTPUT sits between the column list and VALUES. Returning rows straight to
  // the caller (rather than OUTPUT ... INTO) is what keeps this compatible with
  // the AFTER triggers on `employees`.
  mssql: `INSERT INTO employees
         (employee_code, full_name, email, gender, grade, joining_date,
          department_id, team_id, job_role_id, manager_id, location_id, org_title,
          sibling_order)
       OUTPUT INSERTED.id, INSERTED.employee_code, INSERTED.full_name,
              INSERTED.email, INSERTED.org_title
       VALUES ($1,$2,$3,COALESCE($4,'Not Specified'),$5,$6,$7,$8,$9,$10,$11,$12,
          COALESCE((SELECT MAX(sibling_order) + 1 FROM employees WHERE manager_id = $10), 1))`,
});

const Q_INSERT_APP_USER = sql({
  pg: `INSERT INTO app_users (employee_id, email, display_name)
       VALUES ($1,$2,$3) RETURNING id`,
  mssql: `INSERT INTO app_users (employee_id, email, display_name)
          OUTPUT INSERTED.id
          VALUES ($1,$2,$3)`,
});

const Q_GRANT_DEFAULT_ROLE = sql({
  pg: `INSERT INTO user_permission_role_map (user_id, permission_role_id)
       SELECT $1, id FROM app_permission_roles WHERE role_key = 'employee'
       ON CONFLICT DO NOTHING`,
  mssql: `INSERT INTO user_permission_role_map (user_id, permission_role_id)
          SELECT $1, pr.id FROM app_permission_roles pr
           WHERE pr.role_key = 'employee'
             AND NOT EXISTS (
               SELECT 1 FROM user_permission_role_map m WITH (UPDLOCK, HOLDLOCK)
                WHERE m.user_id = $1 AND m.permission_role_id = pr.id)`,
});

// Make sure the 1:1 CV row exists before updating it.
function ensureCv(client, employeeId) {
  return client.query(Q_ENSURE_CV, [employeeId]);
}

// Any CV edit invalidates a previous verification: back to Draft, and any
// approval still sitting in someone's inbox is cancelled.
async function resetVerification(client, employeeId) {
  await ensureCv(client, employeeId);
  await client.query(
    `UPDATE employee_cv
        SET verification_status = 'Draft', verified_by = NULL, verified_at = NULL
      WHERE employee_id = $1 AND verification_status <> 'Draft'`,
    [employeeId]
  );
  await client.query(
    `UPDATE approvals SET status = 'Cancelled', decided_at = NOW()
      WHERE approval_type = 'Profile Verification' AND entity_id = $1 AND status = 'Pending'`,
    [employeeId]
  );
}

// Dates are projected as plain YYYY-MM-DD strings rather than timestamps, so the
// client never has to reason about timezones for a date-only field.
const EXPERIENCE_COLUMNS = sql({
  pg: `id, title, organization,
  to_char(start_date, 'YYYY-MM-DD') AS start_date,
  to_char(end_date, 'YYYY-MM-DD') AS end_date,
  description, sort_order`,
  // CONVERT style 23 is ISO yyyy-mm-dd.
  mssql: `id, title, organization,
  CONVERT(varchar(10), start_date, 23) AS start_date,
  CONVERT(varchar(10), end_date, 23) AS end_date,
  description, sort_order`,
});

const EDUCATION_COLUMNS =
  'id, degree, institution, field_of_study, start_year, end_year, grade, sort_order';

// Turn a typed skill name into a unique code, e.g. "Battery BMS" -> "BATTERY-BMS".
async function uniqueSkillCode(client, name) {
  const base =
    name
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 20) || 'SKILL';
  for (let i = 0; i < 20; i += 1) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const { rows } = await client.query('SELECT 1 FROM skills WHERE code = $1', [candidate]);
    if (rows.length === 0) return candidate;
  }
  return `${base}-${Math.floor(Math.random() * 100000)}`;
}

// ---------------------------------------------------------------
// Directory & onboarding
// ---------------------------------------------------------------

// GET /api/employees/form-options — dropdown data for the Add Employee form.
router.get('/form-options', requireRole(...MANAGE_ROLES), async (req, res, next) => {
  try {
    // The manager list is the caller's own subtree: you may place a new hire
    // under yourself or under anyone already beneath you, and nowhere else.
    // This used to return the entire active directory.
    const managerParams = [];
    const managerSql = `
      SELECT e.id, e.full_name, e.org_title
      FROM employees e
      WHERE e.employment_status = 'Active'
        AND e.id IN (${visibleIdsSql(req.user, managerParams)})
      ORDER BY e.full_name`;

    const [departments, teams, roles, locations, managers] = await Promise.all([
      query('SELECT id, name FROM departments ORDER BY name'),
      query('SELECT id, name, department_id FROM teams ORDER BY name'),
      query('SELECT id, role_name FROM job_roles ORDER BY role_name'),
      query('SELECT id, name FROM locations ORDER BY name'),
      query(managerSql, managerParams),
    ]);
    res.json({
      departments: departments.rows,
      teams: teams.rows,
      jobRoles: roles.rows,
      locations: locations.rows,
      managers: managers.rows,
      orgTitles: ORG_TITLES,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/employees — create an employee (and, by default, a login account).
router.post('/', requireRole(...MANAGE_ROLES), async (req, res, next) => {
  const {
    employee_code,
    full_name,
    email,
    gender,
    grade,
    joining_date,
    department_id,
    team_id,
    job_role_id,
    manager_id,
    location_id,
    org_title,
    create_login = true,
  } = req.body || {};

  if (!employee_code || !full_name || !email) {
    return res.status(400).json({ error: 'employee_code, full_name and email are required' });
  }
  if (org_title && !ORG_TITLES.includes(org_title)) {
    return res.status(400).json({ error: `org_title must be one of: ${ORG_TITLES.join(', ')}` });
  }

  // A manager is now required, and must be someone the caller can already see.
  // Without this you could graft a new hire onto a branch you have no business
  // touching — and a NULL manager would try to create a second root, which the
  // uq_employees_single_root index rejects with an opaque error.
  if (!manager_id) {
    return res.status(400).json({ error: 'manager_id is required — every employee reports to someone' });
  }
  if (!(await canView(req.user, manager_id))) {
    return res
      .status(400)
      .json({ error: 'You can only add people under yourself or someone who reports to you' });
  }

  try {
    const employee = await withTransaction(async (client) => {
      const emp = await client.query(Q_INSERT_EMPLOYEE, [
        employee_code,
        full_name,
        email,
        gender || null,
        grade || null,
        joining_date || null,
        department_id || null,
        team_id || null,
        job_role_id || null,
        manager_id,
        location_id || null,
        org_title || null,
      ]);
      const created = emp.rows[0];

      if (create_login) {
        const user = await client.query(Q_INSERT_APP_USER, [created.id, email, full_name]);
        await client.query(Q_GRANT_DEFAULT_ROLE, [user.rows[0].id]);
      }

      return created;
    });

    res.status(201).json(employee);
  } catch (err) {
    // Friendly message for duplicate code/email.
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: 'An employee with that code or email already exists' });
    }
    next(err);
  }
});

// GET /api/employees?search= — lightweight directory (used by search & pickers).
//
// Scoped to the caller's subtree. A leaf employee sees exactly one row —
// themselves — which falls out of the predicate rather than being special-cased.
router.get('/', async (req, res, next) => {
  try {
    const { search } = req.query;
    const params = [];
    let where = "e.employment_status = 'Active'";
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (e.full_name ILIKE $${params.length} OR e.email ILIKE $${params.length})`;
    }
    where += ` AND e.id IN (${visibleIdsSql(req.user, params)})`;

    const { rows } = await query(
      `SELECT e.id, e.full_name, e.email, e.photo_url, e.org_title,
              jr.role_name AS job_role, d.name AS department
       FROM employees e
       LEFT JOIN job_roles jr ON jr.id = e.job_role_id
       LEFT JOIN departments d ON d.id = e.department_id
       WHERE ${where}
       ORDER BY e.full_name`,
      params
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/employees/me — the signed-in user's own identity, read live.
//
// The JWT carries a snapshot taken at login and lives for 12 hours, so anything
// that changes in between — a new profile picture, a new hierarchy title, a
// transfer — would otherwise not show until the user signed out and back in.
// Always self-scoped, so it needs no visibility gate.
//
// Registered before the /:id/* routes so "me" is never read as an id.
router.get('/me', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT e.id, e.full_name, e.email, e.employee_code, e.photo_url, e.org_title,
              e.grade, jr.role_name AS job_role, d.name AS department, t.name AS team,
              mgr.full_name AS manager_name,
              (SELECT count(*)::int FROM employees c WHERE c.manager_id = e.id) AS direct_reports,
              (SELECT count(*)::int FROM employee_subtree(e.id)) AS visible_people
       FROM employees e
       LEFT JOIN job_roles jr ON jr.id = e.job_role_id
       LEFT JOIN departments d ON d.id = e.department_id
       LEFT JOIN teams t ON t.id = e.team_id
       LEFT JOIN employees mgr ON mgr.id = e.manager_id
       WHERE e.id = $1`,
      [req.user.employee_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Employee not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /api/employees/org-chart — the caller's subtree as a flat, ordered list
// the client can nest. depth is relative to the caller (0 = you).
//
// Registered before the /:id/* routes so "org-chart" is never read as an id.
router.get('/org-chart', async (req, res, next) => {
  try {
    // Nesting is done client-side on manager_id: a node whose manager is absent
    // from this set is a local root. That works identically for a mid-tree
    // manager (one root: themselves) and for an admin (the whole org).
    const params = [];
    const scope = visibleIdsSql(req.user, params);

    const { rows } = await query(
      `SELECT t.id, t.manager_id, t.employee_code, t.full_name, t.org_title,
              t.photo_url, t.display_label, t.structural_code, t.has_reports,
              t.depth AS absolute_depth, t.employment_status,
              jr.role_name AS job_role, d.name AS department
       FROM v_employee_tree t
       LEFT JOIN employees e ON e.id = t.id
       LEFT JOIN job_roles jr ON jr.id = e.job_role_id
       LEFT JOIN departments d ON d.id = e.department_id
       WHERE t.id IN (${scope})
       ORDER BY string_to_array(t.structural_code, '.')::int[]`,
      params
    );

    // The chain above the caller: name + title only, never a full record.
    const chain = await managerChain(req.user.employee_id);

    res.json({ root: req.user.employee_id, nodes: rows, managerChain: chain });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// Profile (read)
// ---------------------------------------------------------------

// Gathers the whole profile payload for one employee. Shared by the JSON
// profile endpoint and the PDF download, so the page and the downloaded CV can
// never disagree about what a person's record says. Returns null when the id
// names nobody.
//
// Callers own the visibility gate — this function does not apply one.
async function loadProfile(id) {
  const headerP = query(
    `SELECT e.id, e.full_name, e.email, e.employee_code, e.grade, e.joining_date, e.photo_url,
            e.org_title,
            jr.role_name AS job_role, d.name AS department, t.name AS team,
            l.name AS location,
            mgr.full_name AS manager_name,
            (SELECT me.full_name FROM mentor_assignments ma
               JOIN employees me ON me.id = ma.mentor_id
               WHERE ma.mentee_id = e.id AND ma.status = 'Active'
               ORDER BY ma.start_date ASC LIMIT 1) AS mentor_name,
            (SELECT jr2.role_name FROM mentor_recommendations mr
               JOIN job_roles jr2 ON jr2.id = mr.recommended_role_id
               WHERE mr.employee_id = e.id AND mr.recommended_role_id IS NOT NULL
               ORDER BY mr.submitted_at DESC LIMIT 1) AS target_role
     FROM employees e
     LEFT JOIN job_roles jr ON jr.id = e.job_role_id
     LEFT JOIN departments d ON d.id = e.department_id
     LEFT JOIN teams t ON t.id = e.team_id
     LEFT JOIN locations l ON l.id = e.location_id
     LEFT JOIN employees mgr ON mgr.id = e.manager_id
     WHERE e.id = $1`,
    [id]
  );

  // Always returns a row for an existing employee, even with no CV yet.
  const cvP = query(
    `SELECT COALESCE(cv.verification_status, 'Draft') AS verification_status,
            cv.headline, cv.summary, cv.phone, cv.location_text, cv.linkedin_url,
            cv.verified_at, cv.updated_at,
            vb.full_name AS verified_by_name,
            (SELECT ap.full_name FROM approvals a
               JOIN employees ap ON ap.id = a.approver_id
               WHERE a.approval_type = 'Profile Verification'
                 AND a.entity_id = e.id AND a.status = 'Pending'
               ORDER BY a.requested_at DESC LIMIT 1) AS pending_with
     FROM employees e
     LEFT JOIN employee_cv cv ON cv.employee_id = e.id
     LEFT JOIN employees vb ON vb.id = cv.verified_by
     WHERE e.id = $1`,
    [id]
  );

  const experienceP = query(
    `SELECT ${EXPERIENCE_COLUMNS} FROM employee_experience
     WHERE employee_id = $1
     ORDER BY sort_order, start_date DESC NULLS LAST`,
    [id]
  );

  const educationP = query(
    `SELECT ${EDUCATION_COLUMNS} FROM employee_education
     WHERE employee_id = $1
     ORDER BY sort_order, end_year DESC NULLS LAST`,
    [id]
  );

  const passportP = query(
    `SELECT skill_id, skill_name, self_level, manager_level, mentor_level, effective_level
     FROM v_employee_skill_matrix
     WHERE employee_id = $1
     ORDER BY effective_level DESC NULLS LAST, skill_name`,
    [id]
  );

  const recentLearningP = query(
    `SELECT tc.title, te.status, te.completed_at, te.progress_percent, tc.course_type
     FROM training_enrollments te JOIN training_courses tc ON tc.id = te.course_id
     WHERE te.employee_id = $1
     ORDER BY COALESCE(te.completed_at, te.enrolled_at) DESC
     LIMIT 8`,
    [id]
  );

  const certsP = query(
    `SELECT c.title, ec.status, ec.issued_date, ec.expiry_date, appr.full_name AS approved_by
     FROM employee_certifications ec
     JOIN certifications c ON c.id = ec.certification_id
     LEFT JOIN employees appr ON appr.id = ec.approved_by
     WHERE ec.employee_id = $1
     ORDER BY ec.issued_date DESC NULLS LAST`,
    [id]
  );

  const mentorNotesP = query(
    `SELECT ms.session_date, ms.mode, ms.topic, ms.notes, ms.action_items,
            mtr.full_name AS mentor_name
     FROM mentoring_sessions ms
     JOIN mentor_assignments ma ON ma.id = ms.mentor_assignment_id
     JOIN employees mtr ON mtr.id = ma.mentor_id
     WHERE ma.mentee_id = $1
     ORDER BY ms.session_date DESC`,
    [id]
  );

  // Direct reports — the DOWN side of the record, always full-record visible
  // because anyone you can see has a subtree contained in your own.
  const reportsP = query(
    `SELECT e.id, e.full_name, e.org_title, e.photo_url,
            jr.role_name AS job_role,
            EXISTS (SELECT 1 FROM employees c WHERE c.manager_id = e.id) AS has_reports
     FROM employees e
     LEFT JOIN job_roles jr ON jr.id = e.job_role_id
     WHERE e.manager_id = $1
     ORDER BY e.sibling_order, e.full_name`,
    [id]
  );

  // The UP side: name + title only, all the way to the Executive Officer.
  const chainP = managerChain(id);

  const [header, cv, experience, education, passport, recentLearning, certs, mentorNotes, reports, chain] =
    await Promise.all([
      headerP,
      cvP,
      experienceP,
      educationP,
      passportP,
      recentLearningP,
      certsP,
      mentorNotesP,
      reportsP,
      chainP,
    ]);

  if (header.rows.length === 0) return null;

  return {
    header: header.rows[0],
    cv: cv.rows[0] || { verification_status: 'Draft' },
    experience: experience.rows,
    education: education.rows,
    skillsPassport: passport.rows,
    recentLearning: recentLearning.rows,
    certifications: certs.rows,
    mentorNotes: mentorNotes.rows,
    directReports: reports.rows,
    managerChain: chain,
  };
}

// GET /api/employees/:id/profile
//
// requireVisible is the whole point of this gate: this route previously had no
// authorization at all, so any signed-in user could read anyone's CV, contact
// details, skills passport and learning history by id.
router.get('/:id/profile', requireVisible(), async (req, res, next) => {
  try {
    const profile = await loadProfile(req.params.id);
    if (!profile) return res.status(404).json({ error: 'Employee not found' });
    res.json(profile);
  } catch (err) {
    next(err);
  }
});

// GET /api/employees/:id/cv.pdf — the same profile as a downloadable CV.
//
// Behind requireVisible for the same reason as the JSON route: a PDF is not a
// weaker way to read someone's record, so it gets the identical gate.
router.get('/:id/cv.pdf', requireVisible(), async (req, res, next) => {
  try {
    const profile = await loadProfile(req.params.id);
    if (!profile) return res.status(404).json({ error: 'Employee not found' });

    // Headers go out before the first byte of the document. Once streamCvPdf
    // has started writing there is no way back to a JSON error response, which
    // is why loadProfile runs to completion first.
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${cvFileName(profile.header.full_name)}"`
    );
    await streamCvPdf(res, profile);
  } catch (err) {
    // A failure mid-stream can only be abandoned — the client already has a
    // 200 and part of a file.
    if (res.headersSent) return res.destroy(err);
    return next(err);
  }
});

// PATCH /api/employees/:id/manager  { manager_id, org_title?, sibling_order? }
//
// Move someone to a different manager. Both the person and their new manager
// must already be inside the caller's subtree, so a reorg can never reach
// across into a branch you cannot see — and never detaches anyone from the
// tree, because manager_id may not be cleared here.
//
// The cycle guard is in the database (trg_employees_no_cycle), not here: it
// holds for any writer, including direct SQL.
router.patch('/:id/manager', requireRole(...MANAGE_ROLES), requireVisible(), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { manager_id, org_title, sibling_order } = req.body || {};

    if (!manager_id) {
      return res.status(400).json({ error: 'manager_id is required' });
    }
    if (manager_id === id) {
      return res.status(400).json({ error: 'An employee cannot report to themselves' });
    }
    if (org_title !== undefined && org_title !== null && !ORG_TITLES.includes(org_title)) {
      return res.status(400).json({ error: `org_title must be one of: ${ORG_TITLES.join(', ')}` });
    }
    if (!(await canView(req.user, manager_id))) {
      return res.status(400).json({ error: 'That manager is not in your organisation' });
    }

    const { rows } = await query(
      `UPDATE employees
          SET manager_id    = $2,
              org_title     = COALESCE($3, org_title),
              sibling_order = COALESCE($4,
                COALESCE((SELECT MAX(sibling_order) + 1 FROM employees WHERE manager_id = $2), 1))
        WHERE id = $1
        RETURNING id, full_name, manager_id, org_title, sibling_order`,
      [
        id,
        manager_id,
        org_title || null,
        Number.isFinite(Number(sibling_order)) ? Number(sibling_order) : null,
      ]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    // The cycle trigger raises check_violation; surface it as a conflict rather
    // than a 500, since it is a legitimate thing for a caller to attempt.
    if (err.code === '23514' && /Reporting cycle/i.test(err.message || '')) {
      return res
        .status(409)
        .json({ error: 'That move would put someone under a person who already reports to them' });
    }
    next(err);
  }
});

// ---------------------------------------------------------------
// CV header (self-service)
// ---------------------------------------------------------------

// PUT /api/employees/:id/cv — upsert the typed CV header.
router.put('/:id/cv', requireSelfOrAdmin(), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { headline, summary, phone, location_text, linkedin_url } = req.body || {};

    const row = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO employee_cv (employee_id, headline, summary, phone, location_text, linkedin_url)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (employee_id) DO UPDATE
           SET headline = EXCLUDED.headline,
               summary = EXCLUDED.summary,
               phone = EXCLUDED.phone,
               location_text = EXCLUDED.location_text,
               linkedin_url = EXCLUDED.linkedin_url
         RETURNING employee_id, headline, summary, phone, location_text, linkedin_url,
                   verification_status`,
        [
          id,
          headline || null,
          summary || null,
          phone || null,
          location_text || null,
          linkedin_url || null,
        ]
      );
      await resetVerification(client, id);
      return rows[0];
    });

    res.json({ ...row, verification_status: 'Draft' });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// Experience (self-service)
// ---------------------------------------------------------------

// POST /api/employees/:id/experience
router.post('/:id/experience', requireSelfOrAdmin(), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, organization, start_date, end_date, description, sort_order } = req.body || {};
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }

    const row = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO employee_experience
           (employee_id, title, organization, start_date, end_date, description, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,0))
         RETURNING ${EXPERIENCE_COLUMNS}`,
        [
          id,
          title.trim(),
          organization || null,
          start_date || null,
          end_date || null,
          description || null,
          Number.isFinite(Number(sort_order)) ? Number(sort_order) : null,
        ]
      );
      await resetVerification(client, id);
      return rows[0];
    });

    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
});

// PUT /api/employees/:id/experience/:expId
router.put('/:id/experience/:expId', requireSelfOrAdmin(), async (req, res, next) => {
  try {
    const { id, expId } = req.params;
    const { title, organization, start_date, end_date, description, sort_order } = req.body || {};
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }

    const row = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE employee_experience
            SET title = $3, organization = $4, start_date = $5, end_date = $6,
                description = $7, sort_order = COALESCE($8, sort_order)
          WHERE id = $1 AND employee_id = $2
          RETURNING ${EXPERIENCE_COLUMNS}`,
        [
          expId,
          id,
          title.trim(),
          organization || null,
          start_date || null,
          end_date || null,
          description || null,
          Number.isFinite(Number(sort_order)) ? Number(sort_order) : null,
        ]
      );
      if (rows.length === 0) return null;
      await resetVerification(client, id);
      return rows[0];
    });

    if (!row) return res.status(404).json({ error: 'Experience entry not found' });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/employees/:id/experience/:expId
router.delete('/:id/experience/:expId', requireSelfOrAdmin(), async (req, res, next) => {
  try {
    const { id, expId } = req.params;
    const deleted = await withTransaction(async (client) => {
      const { rowCount } = await client.query(
        'DELETE FROM employee_experience WHERE id = $1 AND employee_id = $2',
        [expId, id]
      );
      if (rowCount === 0) return false;
      await resetVerification(client, id);
      return true;
    });
    if (!deleted) return res.status(404).json({ error: 'Experience entry not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// Education (self-service)
// ---------------------------------------------------------------

// POST /api/employees/:id/education
router.post('/:id/education', requireSelfOrAdmin(), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { degree, institution, field_of_study, start_year, end_year, grade, sort_order } =
      req.body || {};
    if (!degree || !degree.trim()) {
      return res.status(400).json({ error: 'degree is required' });
    }

    const row = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO employee_education
           (employee_id, degree, institution, field_of_study, start_year, end_year, grade, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,0))
         RETURNING ${EDUCATION_COLUMNS}`,
        [
          id,
          degree.trim(),
          institution || null,
          field_of_study || null,
          start_year || null,
          end_year || null,
          grade || null,
          Number.isFinite(Number(sort_order)) ? Number(sort_order) : null,
        ]
      );
      await resetVerification(client, id);
      return rows[0];
    });

    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
});

// PUT /api/employees/:id/education/:eduId
router.put('/:id/education/:eduId', requireSelfOrAdmin(), async (req, res, next) => {
  try {
    const { id, eduId } = req.params;
    const { degree, institution, field_of_study, start_year, end_year, grade, sort_order } =
      req.body || {};
    if (!degree || !degree.trim()) {
      return res.status(400).json({ error: 'degree is required' });
    }

    const row = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE employee_education
            SET degree = $3, institution = $4, field_of_study = $5, start_year = $6,
                end_year = $7, grade = $8, sort_order = COALESCE($9, sort_order)
          WHERE id = $1 AND employee_id = $2
          RETURNING ${EDUCATION_COLUMNS}`,
        [
          eduId,
          id,
          degree.trim(),
          institution || null,
          field_of_study || null,
          start_year || null,
          end_year || null,
          grade || null,
          Number.isFinite(Number(sort_order)) ? Number(sort_order) : null,
        ]
      );
      if (rows.length === 0) return null;
      await resetVerification(client, id);
      return rows[0];
    });

    if (!row) return res.status(404).json({ error: 'Education entry not found' });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/employees/:id/education/:eduId
router.delete('/:id/education/:eduId', requireSelfOrAdmin(), async (req, res, next) => {
  try {
    const { id, eduId } = req.params;
    const deleted = await withTransaction(async (client) => {
      const { rowCount } = await client.query(
        'DELETE FROM employee_education WHERE id = $1 AND employee_id = $2',
        [eduId, id]
      );
      if (rowCount === 0) return false;
      await resetVerification(client, id);
      return true;
    });
    if (!deleted) return res.status(404).json({ error: 'Education entry not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// Skills typed in by the employee
// ---------------------------------------------------------------

// POST /api/employees/:id/skills  { skill_id? | skill_name?, self_level }
// Picks an existing library skill or creates one from a typed name, links it to
// the employee and records a Self assessment (which drives the skill matrix).
router.post('/:id/skills', requireSelfOrAdmin(), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { skill_id, skill_name, self_level, comments, category_id } = req.body || {};
    const level = Number(self_level);

    if (!skill_id && !(skill_name && skill_name.trim())) {
      return res.status(400).json({ error: 'skill_id or skill_name is required' });
    }
    if (!Number.isInteger(level) || level < 1 || level > 5) {
      return res.status(400).json({ error: 'self_level must be an integer between 1 and 5' });
    }

    const result = await withTransaction(async (client) => {
      let resolvedId = skill_id || null;
      let created = false;

      if (!resolvedId) {
        const name = skill_name.trim();
        const existing = await client.query('SELECT id FROM skills WHERE name ILIKE $1 LIMIT 1', [
          name,
        ]);
        if (existing.rows.length) {
          resolvedId = existing.rows[0].id;
        } else {
          // Only required on this branch: picking an existing library skill
          // needs no category, and demanding one would be nonsense. Skills
          // created without it are what left the library full of rows with an
          // empty Category column (see db/11_skill_taxonomy_backfill.sql).
          if (!category_id) {
            const err = new Error('Pick a category — a new skill joins the company skill library');
            err.status = 400;
            throw err;
          }
          const cat = await client.query('SELECT id FROM skill_categories WHERE id = $1', [
            category_id,
          ]);
          if (cat.rows.length === 0) {
            const err = new Error('Unknown category');
            err.status = 400;
            throw err;
          }

          const code = await uniqueSkillCode(client, name);
          const inserted = await client.query(
            `INSERT INTO skills (code, name, description, category_id)
             VALUES ($1, $2, 'Added from an employee profile', $3)
             RETURNING id`,
            [code, name, category_id]
          );
          resolvedId = inserted.rows[0].id;
          // Same rubric the Skills Library route applies — without it the new
          // skill's Level Definition tab is blank.
          await insertDefaultLevelDefinitions(client, resolvedId);
          created = true;
        }
      }

      await client.query(
        `INSERT INTO employee_skill_assignments (employee_id, skill_id, assigned_by_employee_id)
         VALUES ($1,$2,$3)
         ON CONFLICT (employee_id, skill_id) DO NOTHING`,
        [id, resolvedId, req.user.employee_id]
      );

      // A new row per submission; v_latest_skill_levels reads the most recent.
      await client.query(
        `INSERT INTO skill_assessments
           (employee_id, skill_id, assessor_employee_id, assessor_type, assessed_level, comments, status)
         VALUES ($1,$2,$3,'Self',$4,$5,'Submitted')`,
        [id, resolvedId, req.user.employee_id, level, comments || null]
      );

      const { rows } = await client.query(
        `SELECT skill_id, skill_name, self_level, manager_level, mentor_level, effective_level
         FROM v_employee_skill_matrix WHERE employee_id = $1 AND skill_id = $2`,
        [id, resolvedId]
      );
      return { skill: rows[0] || { skill_id: resolvedId }, created_skill: created };
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/employees/:id/skills/:skillId — drop a self-added skill.
// Refuses when a manager/mentor/SME has assessed it, so employees can't erase
// an organisational assessment from their passport.
router.delete('/:id/skills/:skillId', requireSelfOrAdmin(), async (req, res, next) => {
  try {
    const { id, skillId } = req.params;

    const outcome = await withTransaction(async (client) => {
      const others = await client.query(
        `SELECT 1 FROM skill_assessments
          WHERE employee_id = $1 AND skill_id = $2
            AND assessor_type IN ('Manager','Mentor','SME')
          LIMIT 1`,
        [id, skillId]
      );
      if (others.rows.length) return 'assessed';

      const { rowCount } = await client.query(
        'DELETE FROM employee_skill_assignments WHERE employee_id = $1 AND skill_id = $2',
        [id, skillId]
      );
      if (rowCount === 0) return 'missing';

      await client.query(
        `DELETE FROM skill_assessments
          WHERE employee_id = $1 AND skill_id = $2 AND assessor_type = 'Self'`,
        [id, skillId]
      );
      return 'deleted';
    });

    if (outcome === 'assessed') {
      return res.status(409).json({
        error: 'This skill has a manager or mentor assessment and cannot be removed here.',
      });
    }
    if (outcome === 'missing') {
      return res.status(404).json({ error: 'Skill is not on this profile' });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// Profile picture
// ---------------------------------------------------------------

// POST /api/employees/:id/photo — multipart/form-data, field name "file".
router.post('/:id/photo', requireSelfOrAdmin(), uploadPhoto, async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name: file)' });

    // Timestamped path so the browser/CDN never serves a stale avatar.
    const ext = (req.file.originalname.split('.').pop() || 'png').toLowerCase().slice(0, 5);
    const path = `${id}/avatar-${Date.now()}.${ext}`;

    const publicUrl = await uploadPublicFile(path, req.file.buffer, req.file.mimetype);

    const { rows } = await query(
      'UPDATE employees SET photo_url = $2 WHERE id = $1 RETURNING id, photo_url',
      [id, publicUrl]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Employee not found' });

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/employees/:id/photo — clear the profile picture, for anyone who
// would rather not have one. The stored objects are purged before the row is
// updated: if the purge fails the profile still points at a live picture and
// the call can simply be retried, whereas the other order would leave the file
// public with nothing in the app still referencing it. A row left pointing at a
// deleted object is the harmless direction — Avatar degrades to initials.
router.delete('/:id/photo', requireSelfOrAdmin(), async (req, res, next) => {
  try {
    const { id } = req.params;

    await removePublicFolder(`${id}/`);

    const { rows } = await query(
      'UPDATE employees SET photo_url = NULL WHERE id = $1 RETURNING id, photo_url',
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Employee not found' });

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
