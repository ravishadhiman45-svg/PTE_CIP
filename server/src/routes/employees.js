// Employee directory, profile (header + CV + skills passport + learning),
// and the self-service CV editing endpoints.
const express = require('express');
const multer = require('multer');
const { query, withTransaction, isUniqueViolation, isReportingCycle } = require('../db');
const { requireRole, requireSelfOrAdmin, requireVisible } = require('../middleware/auth');
const { visibleIdsSql, canView, managerChain } = require('../lib/visibility');
const { streamCvPdf, cvFileName } = require('../lib/cvPdf');
const { uploadPublicFile, removePublicFolder, removePublicFiles } = require('../storage');
const { insertDefaultLevelDefinitions } = require('../lib/skillLevels');
const {
  buildTemplate,
  readRows,
  validateRows,
  normalizeKey,
  ImportError,
} = require('../lib/employeeImport');

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

// Certificates are as often PDFs as images, and a scan is heavier than an
// avatar. A separate instance rather than loosening the filter above: a profile
// picture that is a PDF is still nonsense.
const evidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^(application\/pdf|image\/(png|jpe?g|webp))$/.test(file.mimetype)) {
      return cb(new Error('Only PDF, PNG, JPG or WEBP files are allowed'));
    }
    return cb(null, true);
  },
});

// Same translation as uploadPhoto: multer's own errors are 400s, not 500s.
function uploadEvidence(req, res, next) {
  evidenceUpload.single('file')(req, res, (err) => {
    if (err) {
      const message =
        err.code === 'LIMIT_FILE_SIZE' ? 'Certificate must be smaller than 10 MB' : err.message;
      return res.status(400).json({ error: message });
    }
    return next();
  });
}

// The bulk-onboarding spreadsheet. Same memory-then-parse shape as the photo
// upload; nothing is ever written to disk.
//
// Browsers disagree about the .xlsx mime type — Chrome sends the long
// openxmlformats one, some Windows setups send application/octet-stream, and a
// file dragged out of an email client can arrive as application/zip (which an
// .xlsx genuinely is). So the extension is the gate, and the real check is
// whether ExcelJS can parse it.
const uploadWorkbook = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/\.xlsx$/i.test(file.originalname || '')) {
      return cb(new Error('Upload an .xlsx file — start from the sample template'));
    }
    return cb(null, true);
  },
});

function uploadSheet(req, res, next) {
  uploadWorkbook.single('file')(req, res, (err) => {
    if (err) {
      const message =
        err.code === 'LIMIT_FILE_SIZE' ? 'The file must be smaller than 5 MB' : err.message;
      return res.status(400).json({ error: message });
    }
    return next();
  });
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

// Dates are projected as plain YYYY-MM-DD strings rather than timestamps, so the
// client never has to reason about timezones for a date-only field.
const EXPERIENCE_COLUMNS = `id, title, organization,
  to_char(start_date, 'YYYY-MM-DD') AS start_date,
  to_char(end_date, 'YYYY-MM-DD') AS end_date,
  description, sort_order`;

const EDUCATION_COLUMNS =
  'id, degree, institution, field_of_study, start_year, end_year, grade, sort_order';

const Q_ENSURE_CV = 'INSERT INTO employee_cv (employee_id) VALUES ($1) ON CONFLICT (employee_id) DO NOTHING';

const Q_INSERT_EMPLOYEE = `INSERT INTO employees
         (employee_code, full_name, email, gender, grade, joining_date,
          department_id, team_id, job_role_id, manager_id, location_id, org_title,
          sibling_order)
       VALUES ($1,$2,$3,COALESCE($4,'Not Specified'),$5,$6,$7,$8,$9,$10,$11,$12,
          COALESCE((SELECT MAX(sibling_order) + 1 FROM employees WHERE manager_id = $10), 1))
       RETURNING id, employee_code, full_name, email, org_title`;

const Q_INSERT_APP_USER = `INSERT INTO app_users (employee_id, email, display_name)
       VALUES ($1,$2,$3) RETURNING id`;

const Q_GRANT_DEFAULT_ROLE = `INSERT INTO user_permission_role_map (user_id, permission_role_id)
       SELECT $1, id FROM app_permission_roles WHERE role_key = 'employee'
       ON CONFLICT DO NOTHING`;

// Onboarding course, put on a new hire's Learning Module at creation.
//
// db/pg/15_sample_course.sql enrols everyone who existed WHEN IT RAN, which is a
// one-time snapshot — so before this, anyone added afterwards landed on an empty
// Learning Module and empty Plan Board, and the only fix was re-running a seed
// file. Enrolling here covers both the single Add Employee form and the bulk
// spreadsheet import, since both go through insertEmployee().
//
// Matched by course_code, not the seeded uuid: SELECT ... FROM training_courses
// yields NO ROWS on a database where 15_sample_course.sql was never loaded, so
// this is a silent no-op there rather than a foreign-key error.
const Q_ENROL_ONBOARDING = `INSERT INTO training_enrollments
         (course_id, employee_id, status, progress_percent, enrolled_at)
       SELECT tc.id, $1, 'Approved', 0, NOW()
         FROM training_courses tc
        WHERE tc.course_code = 'PTE-ONB-101'
       ON CONFLICT (course_id, employee_id) DO NOTHING`;

// ...and on their plan board, so both tabs of the page have content. Mirrors
// 15_sample_course.sql, which seeds the same pair.
const Q_PLAN_ONBOARDING = `INSERT INTO learning_plan_items
         (employee_id, course_id, status, priority, progress_percent, notes)
       SELECT $1, tc.id, 'To Do', 'High', 0, 'Start here'
         FROM training_courses tc
        WHERE tc.course_code = 'PTE-ONB-101'
          AND NOT EXISTS (
            SELECT 1 FROM learning_plan_items lpi
             WHERE lpi.employee_id = $1 AND lpi.course_id = tc.id)`;

// --- Scalar / projection fragments -----------------------------------------

// COUNT(*) is bigint, which the driver returns as a STRING. The ::int cast is
// what makes it a JS number.
const DIRECT_REPORTS_COUNT = '(SELECT count(*)::int FROM employees c WHERE c.manager_id = e.id)';
const SUBTREE_COUNT = '(SELECT count(*)::int FROM employee_subtree(e.id))';

const ACTIVE_MENTOR_NAME = `(SELECT me.full_name FROM mentor_assignments ma
               JOIN employees me ON me.id = ma.mentor_id
               WHERE ma.mentee_id = e.id AND ma.status = 'Active'
               ORDER BY ma.start_date ASC LIMIT 1)`;

const LATEST_TARGET_ROLE = `(SELECT jr2.role_name FROM mentor_recommendations mr
               JOIN job_roles jr2 ON jr2.id = mr.recommended_role_id
               WHERE mr.employee_id = e.id AND mr.recommended_role_id IS NOT NULL
               ORDER BY mr.submitted_at DESC LIMIT 1)`;

const PENDING_APPROVER = `(SELECT ap.full_name FROM approvals a
               JOIN employees ap ON ap.id = a.approver_id
               WHERE a.approval_type = 'Profile Verification'
                 AND a.entity_id = e.id AND a.status = 'Pending'
               ORDER BY a.requested_at DESC LIMIT 1)`;

// --- Statements -------------------------------------------------------------

const Q_RECENT_LEARNING = `SELECT tc.title, te.status, te.completed_at, te.progress_percent, tc.course_type
     FROM training_enrollments te JOIN training_courses tc ON tc.id = te.course_id
     WHERE te.employee_id = $1
     ORDER BY COALESCE(te.completed_at, te.enrolled_at) DESC
     LIMIT 8`;

const Q_REPARENT = `UPDATE employees
          SET manager_id    = $2,
              org_title     = COALESCE($3, org_title),
              sibling_order = COALESCE($4,
                COALESCE((SELECT MAX(sibling_order) + 1 FROM employees WHERE manager_id = $2), 1))
        WHERE id = $1
        RETURNING id, full_name, manager_id, org_title, sibling_order`;

// The only true UPSERT in the codebase.
const Q_UPSERT_CV = `INSERT INTO employee_cv (employee_id, headline, summary, phone, location_text, linkedin_url)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (employee_id) DO UPDATE
           SET headline = EXCLUDED.headline,
               summary = EXCLUDED.summary,
               phone = EXCLUDED.phone,
               location_text = EXCLUDED.location_text,
               linkedin_url = EXCLUDED.linkedin_url
         RETURNING employee_id, headline, summary, phone, location_text, linkedin_url,
                   verification_status`;

const Q_INSERT_EXPERIENCE = `INSERT INTO employee_experience
           (employee_id, title, organization, start_date, end_date, description, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,0))
         RETURNING ${EXPERIENCE_COLUMNS}`;

const Q_UPDATE_EXPERIENCE = `UPDATE employee_experience
            SET title = $3, organization = $4, start_date = $5, end_date = $6,
                description = $7, sort_order = COALESCE($8, sort_order)
          WHERE id = $1 AND employee_id = $2
          RETURNING ${EXPERIENCE_COLUMNS}`;

const Q_INSERT_EDUCATION = `INSERT INTO employee_education
           (employee_id, degree, institution, field_of_study, start_year, end_year, grade, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,0))
         RETURNING ${EDUCATION_COLUMNS}`;

const Q_UPDATE_EDUCATION = `UPDATE employee_education
            SET degree = $3, institution = $4, field_of_study = $5, start_year = $6,
                end_year = $7, grade = $8, sort_order = COALESCE($9, sort_order)
          WHERE id = $1 AND employee_id = $2
          RETURNING ${EDUCATION_COLUMNS}`;

const Q_FIND_SKILL_BY_NAME = 'SELECT id FROM skills WHERE name ILIKE $1 LIMIT 1';

const Q_INSERT_SKILL_MINIMAL = `INSERT INTO skills (code, name, description, category_id)
             VALUES ($1, $2, 'Added from an employee profile', $3)
             RETURNING id`;

const Q_ASSIGN_SKILL = `INSERT INTO employee_skill_assignments (employee_id, skill_id, assigned_by_employee_id)
         VALUES ($1,$2,$3)
         ON CONFLICT (employee_id, skill_id) DO NOTHING`;

const Q_HAS_OTHER_ASSESSMENT = `SELECT 1 FROM skill_assessments
          WHERE employee_id = $1 AND skill_id = $2
            AND assessor_type IN ('Manager','Mentor','SME')
          LIMIT 1`;

// Direct reports — the DOWN side of the record, always full-record visible
// because anyone you can see has a subtree contained in your own.
const Q_DIRECT_REPORTS = `SELECT e.id, e.full_name, e.org_title, e.photo_url,
            jr.role_name AS job_role,
            EXISTS (SELECT 1 FROM employees c WHERE c.manager_id = e.id) AS has_reports
     FROM employees e
     LEFT JOIN job_roles jr ON jr.id = e.job_role_id
     WHERE e.manager_id = $1
     ORDER BY e.sibling_order, e.full_name`;

const Q_SET_PHOTO = 'UPDATE employees SET photo_url = $2 WHERE id = $1 RETURNING id, photo_url';

const Q_CLEAR_PHOTO = 'UPDATE employees SET photo_url = NULL WHERE id = $1 RETURNING id, photo_url';

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

// Whole-history counts for the Learning Module stat row.
//
// count(*) is bigint and would arrive as a string, hence ::int. duration_hours
// is NUMERIC, which also arrives as a string, hence ::float.
const Q_LEARNING_STATS = `SELECT
       (SELECT count(*)::int FROM training_enrollments te
         WHERE te.employee_id = $1 AND te.status = 'Completed')             AS courses_completed,
       (SELECT count(*)::int FROM training_enrollments te
         WHERE te.employee_id = $1
           AND te.status IN ('Nominated','Approved','In Progress'))         AS courses_in_progress,
       (SELECT COALESCE(sum(tc.duration_hours), 0)::float
          FROM training_enrollments te
          JOIN training_courses tc ON tc.id = te.course_id
         WHERE te.employee_id = $1 AND te.status = 'Completed')             AS course_hours`;

// Courses still running, each with its module list and which modules are done.
//
// The client reads `completed_at == null` to mean "module not ticked", so the
// key has to be present on every module — json_build_object keeps nulls.
const Q_ACTIVE_ENROLLMENTS = `SELECT te.id, te.course_id, te.status, te.progress_percent, te.enrolled_at,
            tc.title, tc.course_type, tc.delivery_mode, tc.duration_hours, tc.difficulty,
            COALESCE((
              SELECT json_agg(json_build_object(
                       'id',               cm.id,
                       'module_order',     cm.module_order,
                       'module_title',     cm.module_title,
                       'duration_minutes', cm.duration_minutes,
                       'completed_at',     emp.completed_at)
                     ORDER BY cm.module_order)
              FROM course_modules cm
              LEFT JOIN enrollment_module_progress emp
                     ON emp.module_id = cm.id AND emp.enrollment_id = te.id
              WHERE cm.course_id = tc.id
            ), '[]'::json) AS modules
     FROM training_enrollments te
     JOIN training_courses tc ON tc.id = te.course_id
     WHERE te.employee_id = $1
       AND te.status IN ('Nominated','Approved','In Progress')
     ORDER BY te.enrolled_at DESC
     LIMIT 12`;

// The learning journey: one chronology out of four tables. Every branch produces
// the same six columns so the UNION types line up; the first branch fixes them.
//
// A "level up" is an assessment that beats every earlier one for that skill - a
// running max over the preceding rows - so a manager re-confirming L3 after L3
// is not an event, and the very first rating is.
const Q_LEARNING_TIMELINE = `WITH level_ups AS (
       SELECT s.name AS skill_name, sa.assessed_level, sa.assessor_type, sa.assessed_at,
              MAX(sa.assessed_level) OVER (
                PARTITION BY sa.skill_id ORDER BY sa.assessed_at
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
              ) AS previous_best
       FROM skill_assessments sa
       JOIN skills s ON s.id = sa.skill_id
       WHERE sa.employee_id = $1 AND sa.status IN ('Submitted','Approved')
     )
     SELECT * FROM (
       SELECT 'course'::text AS kind,
              te.completed_at AS event_at,
              tc.title AS title,
              tc.course_type AS detail,
              NULLIF(concat_ws(' · ',
                tc.delivery_mode,
                CASE WHEN tc.duration_hours IS NOT NULL THEN tc.duration_hours || ' hrs' END,
                CASE WHEN te.score IS NOT NULL THEN 'Score ' || te.score END), '') AS meta,
              NULL::int AS level
       FROM training_enrollments te
       JOIN training_courses tc ON tc.id = te.course_id
       WHERE te.employee_id = $1 AND te.status = 'Completed' AND te.completed_at IS NOT NULL

       UNION ALL

       SELECT 'certification',
              ec.issued_date::timestamptz,
              COALESCE(c.title, ec.title_text),
              COALESCE(ec.issuer, c.certification_type, 'Certification'),
              NULLIF(concat_ws(' · ',
                ec.institution,
                CASE WHEN ec.expiry_date IS NOT NULL
                     THEN 'Valid to ' || to_char(ec.expiry_date, 'DD Mon YYYY') END,
                CASE WHEN ec.source = 'Self' THEN 'Self-reported' ELSE ec.status END), ''),
              NULL::int
       FROM employee_certifications ec
       LEFT JOIN certifications c ON c.id = ec.certification_id
       WHERE ec.employee_id = $1 AND ec.issued_date IS NOT NULL

       UNION ALL

       SELECT 'skill',
              lu.assessed_at,
              lu.skill_name,
              CASE WHEN lu.previous_best IS NULL
                   THEN 'First rating · L' || lu.assessed_level
                   ELSE 'L' || lu.previous_best || ' → L' || lu.assessed_level END,
              lu.assessor_type || ' assessment',
              lu.assessed_level
       FROM level_ups lu
       WHERE lu.previous_best IS NULL OR lu.assessed_level > lu.previous_best

       UNION ALL

       SELECT 'mentoring',
              ms.session_date,
              ms.topic,
              COALESCE(ms.mode, 'Session'),
              mtr.full_name,
              NULL::int
       FROM mentoring_sessions ms
       JOIN mentor_assignments ma ON ma.id = ms.mentor_assignment_id
       JOIN employees mtr ON mtr.id = ma.mentor_id
       WHERE ma.mentee_id = $1
     ) events
     ORDER BY event_at DESC
     LIMIT 40`;

// One projection for certifications, used by the profile payload AND re-read
// after every write: RETURNING cannot reach the joined catalogue title or the
// approver's name, so writes select through this instead. That is what keeps the
// object shape identical everywhere the client sees a certification.
//
// LEFT JOIN, not an inner one: a free-form row has no catalogue entry, and an
// inner join would silently drop exactly the rows this list exists to show.
//
// Dates go out as 'YYYY-MM-DD' strings for the same reason EXPERIENCE_COLUMNS
// does it — they land straight in an <input type="date">, and a Date round-trip
// through JSON shifts the day across a timezone.
const CERTIFICATION_SELECT = `
  SELECT ec.id, ec.certification_id, ec.source, ec.status,
         COALESCE(c.title, ec.title_text) AS title,
         ec.title_text, ec.issuer, ec.technology, ec.institution,
         ec.credential_id, ec.credential_url, ec.hours, ec.notes,
         to_char(ec.issued_date, 'YYYY-MM-DD') AS issued_date,
         to_char(ec.expiry_date, 'YYYY-MM-DD') AS expiry_date,
         ec.evidence_file_url,
         c.certification_type, c.validity_months,
         appr.full_name AS approved_by
    FROM employee_certifications ec
    LEFT JOIN certifications c ON c.id = ec.certification_id
    LEFT JOIN employees appr   ON appr.id = ec.approved_by`;

// Only the id comes back: the row the client gets is re-read through
// CERTIFICATION_SELECT, which RETURNING could not produce anyway — it reaches
// the joined catalogue title and the approver's name.
const Q_INSERT_CERTIFICATION = `INSERT INTO employee_certifications
           (employee_id, source, status, certification_id, title_text, issuer, technology,
            institution, issued_date, expiry_date, credential_id, credential_url, hours, notes)
         VALUES ($1,'Self','Self-Reported',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id`;

function selectCertification(client, certId) {
  return client
    .query(`${CERTIFICATION_SELECT} WHERE ec.id = $1`, [certId])
    .then(({ rows }) => rows[0] || null);
}

// Certificate files live OUTSIDE the "<employeeId>/" prefix on purpose:
// DELETE /:id/photo sweeps removePublicFolder(`${id}/`), which would otherwise
// take a person's certificates with their profile picture.
const certificatePrefix = (employeeId, certId) => `certificates/${employeeId}/${certId}/`;

// A source='Catalog' row was issued through the approvals flow. Letting someone
// edit or delete it from their own profile would let them rewrite — or erase —
// an organisational record, so the self-service editor only owns 'Self' rows.
const CATALOG_ROW_MESSAGE =
  'This certification was issued through the organisation and cannot be changed here.';

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

// The dropdown data behind both onboarding paths: the Add Employee form and the
// Reference sheet of the bulk-import template. One loader, so a value that is
// selectable in the form is always accepted by the importer and vice versa.
async function loadFormOptions(user) {
  // The manager list is the caller's own subtree: you may place a new hire
  // under yourself or under anyone already beneath you, and nowhere else.
  // This used to return the entire active directory.
  //
  // employee_code and email ride along because the spreadsheet needs an
  // identifier a human can type; the form ignores them.
  const managerParams = [];
  const managerSql = `
    SELECT e.id, e.full_name, e.org_title, e.employee_code, e.email
    FROM employees e
    WHERE e.employment_status = 'Active'
      AND e.id IN (${visibleIdsSql(user, managerParams)})
    ORDER BY e.full_name`;

  const [departments, teams, roles, locations, managers] = await Promise.all([
    query('SELECT id, name FROM departments ORDER BY name'),
    query('SELECT id, name, department_id FROM teams ORDER BY name'),
    query('SELECT id, role_name FROM job_roles ORDER BY role_name'),
    query('SELECT id, name FROM locations ORDER BY name'),
    query(managerSql, managerParams),
  ]);

  return {
    departments: departments.rows,
    teams: teams.rows,
    jobRoles: roles.rows,
    locations: locations.rows,
    managers: managers.rows,
    orgTitles: ORG_TITLES,
  };
}

// The single INSERT path, shared by POST / and POST /bulk so the two can never
// drift on what "creating an employee" means (sibling ordering, the default
// login account, the employee permission role).
async function insertEmployee(client, payload) {
  const emp = await client.query(Q_INSERT_EMPLOYEE, [
    payload.employee_code,
    payload.full_name,
    payload.email,
    payload.gender || null,
    payload.grade || null,
    payload.joining_date || null,
    payload.department_id || null,
    payload.team_id || null,
    payload.job_role_id || null,
    payload.manager_id,
    payload.location_id || null,
    payload.org_title || null,
  ]);
  const created = emp.rows[0];

  if (payload.create_login) {
    const user = await client.query(Q_INSERT_APP_USER, [created.id, payload.email, payload.full_name]);
    await client.query(Q_GRANT_DEFAULT_ROLE, [user.rows[0].id]);
  }

  // Onboarding content. Inside the caller's transaction on purpose: a rolled-back
  // employee must not leave an enrolment pointing at nobody.
  await client.query(Q_ENROL_ONBOARDING, [created.id]);
  await client.query(Q_PLAN_ONBOARDING, [created.id]);

  return created;
}

// GET /api/employees/form-options — dropdown data for the Add Employee form.
router.get('/form-options', requireRole(...MANAGE_ROLES), async (req, res, next) => {
  try {
    res.json(await loadFormOptions(req.user));
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
    const employee = await withTransaction((client) =>
      insertEmployee(client, {
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
        create_login,
      })
    );

    res.status(201).json(employee);
  } catch (err) {
    // Friendly message for duplicate code/email.
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: 'An employee with that code or email already exists' });
    }
    next(err);
  }
});

// ---------------------------------------------------------------
// Bulk onboarding from a spreadsheet
// ---------------------------------------------------------------

// GET /api/employees/import-template — the empty .xlsx an admin fills in.
//
// Generated per caller rather than served as a static file: the Reference sheet
// carries THIS user's manager subtree, so the dropdown can only ever offer
// people they are actually allowed to place a hire under.
router.get('/import-template', requireRole(...MANAGE_ROLES), async (req, res, next) => {
  try {
    const options = await loadFormOptions(req.user);
    const workbook = await buildTemplate(options);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', 'attachment; filename="employee-import-template.xlsx"');
    // Written to a buffer rather than piped: the workbook is a few KB, and a
    // failure mid-stream would otherwise arrive after a 200 header with an
    // attachment name already committed.
    const buffer = await workbook.xlsx.writeBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    next(err);
  }
});

// POST /api/employees/bulk — create many employees from the filled-in template.
//
// ALL OR NOTHING. Every row is validated before anything is written, and the
// inserts share one transaction, so an upload either lands completely or leaves
// the directory untouched. A partial import is the worst outcome here: the admin
// cannot tell which half went in without reading the response row by row, and
// re-uploading the corrected file would duplicate the half that succeeded.
router.post('/bulk', requireRole(...MANAGE_ROLES), uploadSheet, async (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const options = await loadFormOptions(req.user);
    const rows = await readRows(req.file.buffer);
    const { records, errors } = validateRows(rows, options);

    // Codes and emails already taken. Checked up front so a collision is
    // reported against its spreadsheet row, rather than surfacing as a unique
    // violation that names neither the row nor which of the two columns clashed.
    const codes = records.map((r) => r.payload.employee_code);
    const emails = records.map((r) => r.payload.email);
    if (codes.length) {
      const params = [...codes, ...emails];
      const codeList = codes.map((_, i) => `$${i + 1}`).join(',');
      const emailList = emails.map((_, i) => `$${codes.length + i + 1}`).join(',');
      const { rows: clashes } = await query(
        `SELECT employee_code, email FROM employees
          WHERE employee_code IN (${codeList}) OR LOWER(email) IN (${emailList})`,
        params
      );
      const takenCodes = new Set(clashes.map((c) => normalizeKey(c.employee_code)));
      const takenEmails = new Set(clashes.map((c) => normalizeKey(c.email)));
      for (const record of records) {
        const problems = [];
        if (takenCodes.has(normalizeKey(record.payload.employee_code))) {
          problems.push(`Employee Code "${record.payload.employee_code}" already exists`);
        }
        if (takenEmails.has(normalizeKey(record.payload.email))) {
          problems.push(`Email "${record.payload.email}" already exists`);
        }
        if (problems.length) {
          errors.push({ row: record.excelRow, name: record.payload.full_name, problems });
        }
      }
    }

    if (errors.length) {
      errors.sort((a, b) => a.row - b.row);
      return res.status(400).json({
        error: `${errors.length} row${errors.length === 1 ? '' : 's'} could not be imported — nothing was saved.`,
        rows: errors,
      });
    }

    // `managerRef` rows report to someone created earlier in this same file, so
    // their manager_id only exists once that row has been inserted. The
    // validator has already guaranteed the reference points backwards, which is
    // what makes a single forward pass sufficient.
    const created = await withTransaction(async (client) => {
      const done = [];
      const idByRef = new Map();
      for (const record of records) {
        const payload = { ...record.payload };
        if (!payload.manager_id) {
          payload.manager_id = idByRef.get(normalizeKey(record.managerRef));
        }
        const row = await insertEmployee(client, payload);
        for (const ref of [payload.employee_code, payload.email, payload.full_name]) {
          const key = normalizeKey(ref);
          if (key) idByRef.set(key, row.id);
        }
        done.push(row);
      }
      return done;
    });

    res.status(201).json({ created: created.length, employees: created });
  } catch (err) {
    if (err instanceof ImportError) {
      return res.status(400).json({ error: err.message, rows: err.rows });
    }
    if (isUniqueViolation(err)) {
      return res
        .status(409)
        .json({ error: 'An employee code or email in the file is already taken — nothing was saved.' });
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
              ${DIRECT_REPORTS_COUNT} AS direct_reports,
              ${SUBTREE_COUNT} AS visible_people
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
       ORDER BY t.sort_key`,
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
            ${ACTIVE_MENTOR_NAME} AS mentor_name,
            ${LATEST_TARGET_ROLE} AS target_role
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
            ${PENDING_APPROVER} AS pending_with
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
    Q_RECENT_LEARNING,
    [id]
  );

  // Widened for the Learning Module tab. The five keys the CV PDF reads
  // (title / status / issued_date / expiry_date / approved_by) are all still
  // here, with title falling back to title_text, so cvPdf.js needs no change.
  const certsP = query(
    `${CERTIFICATION_SELECT}
     WHERE ec.employee_id = $1
     ORDER BY ec.issued_date DESC NULLS LAST, COALESCE(c.title, ec.title_text)`,
    [id]
  );

  // Whole-history counts for the Learning Module stat row. recentLearning above
  // is LIMIT 8, so the tab cannot derive these from it. Certification figures
  // are deliberately absent — the certifications array is complete, so the
  // client counts valid/expiring itself rather than paying for another query.
  const learningStatsP = query(Q_LEARNING_STATS, [id]);

  // Courses still running, each with its module list and which modules are
  // actually done. completed_at comes from enrollment_module_progress, so the
  // ticks are a record rather than the estimate this used to derive from the
  // course percentage. Ticking happens on the Learning Module page; the profile
  // only reads it.
  const enrollmentsP = query(Q_ACTIVE_ENROLLMENTS, [id]);

  // The learning journey: one chronology out of four tables. Every branch
  // produces the same five columns so the UNION types line up; the first branch
  // fixes them (timestamptz, text, text, text, int).
  //
  // A "level up" is an assessment that beats every earlier one for that skill —
  // a running max over the preceding rows — so a manager re-confirming L3 after
  // L3 is not an event, and the very first rating is.
  const timelineP = query(Q_LEARNING_TIMELINE, [id]);

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
  const reportsP = query(Q_DIRECT_REPORTS, [id]);

  // The UP side: name + title only, all the way to the Executive Officer.
  const chainP = managerChain(id);

  // Positional — a new promise needs a name in the same slot on both sides.
  const [
    header,
    cv,
    experience,
    education,
    passport,
    recentLearning,
    certs,
    learningStats,
    enrollments,
    timeline,
    mentorNotes,
    reports,
    chain,
  ] = await Promise.all([
    headerP,
    cvP,
    experienceP,
    educationP,
    passportP,
    recentLearningP,
    certsP,
    learningStatsP,
    enrollmentsP,
    timelineP,
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
    learningStats: learningStats.rows[0] || {
      courses_completed: 0,
      courses_in_progress: 0,
      course_hours: 0,
    },
    enrollments: enrollments.rows,
    learningTimeline: timeline.rows,
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
      Q_REPARENT,
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
    // than a 500, since it is a legitimate thing for a caller to attempt. The
    // the predicate lives in db/errors.js so the message regex has one home.
    if (isReportingCycle(err)) {
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
        Q_UPSERT_CV,
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
        Q_INSERT_EXPERIENCE,
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
        Q_UPDATE_EXPERIENCE,
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
        Q_INSERT_EDUCATION,
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
        Q_UPDATE_EDUCATION,
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
// Certifications (self-service)
//
// These routes only ever own source='Self' rows — see CATALOG_ROW_MESSAGE.
//
// Unlike experience / education / skills, these deliberately do NOT call
// resetVerification. Those sections print into the CV PDF with no marker, so an
// edit after verification is invisible to a reader and has to invalidate it. A
// certificate prints its status first (cvPdf.js drawCertifications), so a
// self-added one already reads "Self-Reported · Issued …" with no approver —
// the PDF discloses it on its own, and knocking a whole verified profile back to
// Draft over an entry that is already labelled unverified only punishes people
// for keeping their record current.
// ---------------------------------------------------------------

// Blank strings from a form field mean "not filled in", not an empty value.
const blankToNull = (value) => {
  const text = typeof value === 'string' ? value.trim() : value;
  return text === '' || text === undefined ? null : text;
};

const numberOrNull = (value) =>
  value === '' || value === null || value === undefined || !Number.isFinite(Number(value))
    ? null
    : Number(value);

// The values every cert write puts in the same order, matching $3..$12 below.
function certificationValues(body) {
  return [
    blankToNull(body.certification_id),
    blankToNull(body.title_text),
    blankToNull(body.issuer),
    blankToNull(body.technology),
    blankToNull(body.institution),
    blankToNull(body.issued_date),
    blankToNull(body.expiry_date),
    blankToNull(body.credential_id),
    blankToNull(body.credential_url),
    numberOrNull(body.hours),
    blankToNull(body.notes),
  ];
}

// POST /api/employees/:id/certifications
router.post('/:id/certifications', requireSelfOrAdmin(), async (req, res, next) => {
  try {
    const { id } = req.params;
    const body = req.body || {};
    if (!blankToNull(body.certification_id) && !blankToNull(body.title_text)) {
      return res.status(400).json({ error: 'Pick a certificate from the catalogue, or type a title' });
    }

    const row = await withTransaction(async (client) => {
      // source and status are derived here, never taken from the body: anything
      // added from a profile is self-reported, catalogue link or not. The link
      // only normalises the title and type; it does not confer approval, which
      // only the approvals flow can grant.
      const { rows } = await client.query(Q_INSERT_CERTIFICATION, [
        id,
        ...certificationValues(body),
      ]);
      return selectCertification(client, rows[0].id);
    });

    res.status(201).json(row);
  } catch (err) {
    // UNIQUE(employee_id, certification_id, issued_date) — only reachable when a
    // catalogue certificate is added twice with the same issue date.
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: 'That certificate is already on this profile.' });
    }
    next(err);
  }
});

// PUT /api/employees/:id/certifications/:certId
router.put('/:id/certifications/:certId', requireSelfOrAdmin(), async (req, res, next) => {
  try {
    const { id, certId } = req.params;
    const body = req.body || {};
    if (!blankToNull(body.certification_id) && !blankToNull(body.title_text)) {
      return res.status(400).json({ error: 'Pick a certificate from the catalogue, or type a title' });
    }

    const outcome = await withTransaction(async (client) => {
      const owned = await client.query(
        'SELECT source FROM employee_certifications WHERE id = $1 AND employee_id = $2',
        [certId, id]
      );
      if (owned.rows.length === 0) return { state: 'missing' };
      if (owned.rows[0].source !== 'Self') return { state: 'catalog' };

      await client.query(
        `UPDATE employee_certifications
            SET certification_id = $3, title_text = $4, issuer = $5, technology = $6,
                institution = $7, issued_date = $8, expiry_date = $9, credential_id = $10,
                credential_url = $11, hours = $12, notes = $13
          WHERE id = $1 AND employee_id = $2`,
        [certId, id, ...certificationValues(body)]
      );
      return { state: 'ok', row: await selectCertification(client, certId) };
    });

    if (outcome.state === 'missing') return res.status(404).json({ error: 'Certification not found' });
    if (outcome.state === 'catalog') return res.status(409).json({ error: CATALOG_ROW_MESSAGE });
    res.json(outcome.row);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: 'That certificate is already on this profile.' });
    }
    next(err);
  }
});

// DELETE /api/employees/:id/certifications/:certId
router.delete('/:id/certifications/:certId', requireSelfOrAdmin(), async (req, res, next) => {
  try {
    const { id, certId } = req.params;

    const owned = await query(
      'SELECT source FROM employee_certifications WHERE id = $1 AND employee_id = $2',
      [certId, id]
    );
    if (owned.rows.length === 0) return res.status(404).json({ error: 'Certification not found' });
    if (owned.rows[0].source !== 'Self') return res.status(409).json({ error: CATALOG_ROW_MESSAGE });

    // Objects go first, for the same reason DELETE /:id/photo purges before it
    // clears the column: a leftover file in a public bucket stays reachable by
    // url with nothing pointing at it, whereas a row pointing at an object that
    // is already gone just shows a dead link the user can retry deleting. The
    // folder holds this certificate's files only.
    await removePublicFolder(certificatePrefix(id, certId));

    await query('DELETE FROM employee_certifications WHERE id = $1 AND employee_id = $2', [
      certId,
      id,
    ]);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/employees/:id/certifications/:certId/evidence  (multipart, field "file")
// No resetVerification here: attaching evidence changes no character of the CV
// PDF and only strengthens the claim already on it.
router.post(
  '/:id/certifications/:certId/evidence',
  requireSelfOrAdmin(),
  uploadEvidence,
  async (req, res, next) => {
    try {
      const { id, certId } = req.params;
      if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name: file)' });

      const existing = await query(
        'SELECT evidence_path, source FROM employee_certifications WHERE id = $1 AND employee_id = $2',
        [certId, id]
      );
      if (existing.rows.length === 0) return res.status(404).json({ error: 'Certification not found' });
      if (existing.rows[0].source !== 'Self') {
        return res.status(409).json({ error: CATALOG_ROW_MESSAGE });
      }

      const ext = (req.file.originalname.split('.').pop() || 'pdf').toLowerCase().slice(0, 5);
      const path = `${certificatePrefix(id, certId)}evidence-${Date.now()}.${ext}`;
      const publicUrl = await uploadPublicFile(path, req.file.buffer, req.file.mimetype);

      await query(
        `UPDATE employee_certifications SET evidence_file_url = $3, evidence_path = $4
          WHERE id = $1 AND employee_id = $2`,
        [certId, id, publicUrl, path]
      );

      // Replace, don't accumulate — but only once the row points at the new file.
      // The other order would turn a failed upload into a certificate with no
      // evidence at all; this way the worst case is one orphaned object.
      const previous = existing.rows[0].evidence_path;
      if (previous && previous !== path) {
        try {
          await removePublicFiles([previous]);
        } catch (e) {
          console.warn('[storage] could not remove replaced certificate file:', e.message);
        }
      }

      const { rows } = await query(`${CERTIFICATION_SELECT} WHERE ec.id = $1`, [certId]);
      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/employees/:id/certifications/:certId/evidence
router.delete(
  '/:id/certifications/:certId/evidence',
  requireSelfOrAdmin(),
  async (req, res, next) => {
    try {
      const { id, certId } = req.params;

      const owned = await query(
        'SELECT source FROM employee_certifications WHERE id = $1 AND employee_id = $2',
        [certId, id]
      );
      if (owned.rows.length === 0) return res.status(404).json({ error: 'Certification not found' });
      if (owned.rows[0].source !== 'Self') return res.status(409).json({ error: CATALOG_ROW_MESSAGE });

      await removePublicFolder(certificatePrefix(id, certId));
      await query(
        `UPDATE employee_certifications SET evidence_file_url = NULL, evidence_path = NULL
          WHERE id = $1 AND employee_id = $2`,
        [certId, id]
      );

      const { rows } = await query(`${CERTIFICATION_SELECT} WHERE ec.id = $1`, [certId]);
      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

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
        const existing = await client.query(Q_FIND_SKILL_BY_NAME, [name]);
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
            Q_INSERT_SKILL_MINIMAL,
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
        Q_ASSIGN_SKILL,
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
        Q_HAS_OTHER_ASSESSMENT,
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
      Q_SET_PHOTO,
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
      Q_CLEAR_PHOTO,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Employee not found' });

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
