// Skills library + skill detail.
//
// The skills catalog is company-wide — it describes capability the organization
// cares about, not people. Any per-employee count or list rolled up alongside it
// is scoped to the caller's subtree.
const express = require('express');
const { query, withTransaction, sql, isUniqueViolation } = require('../db');
const { visibleIdsSql } = require('../lib/visibility');

const { insertDefaultLevelDefinitions } = require('../lib/skillLevels');

const router = express.Router();

// ---------------------------------------------------------------
// Dialect-divergent SQL — see server/src/db/sql.js
// ---------------------------------------------------------------

// A skill's label chips, as a JSON array.
//
// Postgres aggregates them with JSON_AGG ... FILTER over the joined rows.
// T-SQL has neither, so it uses a correlated FOR JSON PATH subquery — which is
// arguably clearer, since the labels are 1:N with the skill and were only being
// aggregated to undo the join fan-out in the first place.
//
// The two return DIFFERENT JS types: pg parses json/jsonb into an array, while
// FOR JSON PATH hands back a string. parseJsonColumn() below reconciles that,
// so the API response is identical either way.
const LABELS_JSON = sql({
  pg: `COALESCE(
                JSON_AGG(DISTINCT jsonb_build_object('name', sl.label_name, 'color', sl.label_color))
                  FILTER (WHERE sl.id IS NOT NULL),
                '[]'
              ) AS labels`,
  mssql: `COALESCE((
                SELECT DISTINCT sl2.label_name AS name, sl2.label_color AS color
                  FROM skill_label_map slm2
                  JOIN skill_labels sl2 ON sl2.id = slm2.label_id
                 WHERE slm2.skill_id = s.id
                 FOR JSON PATH
              ), '[]') AS labels`,
});

// ROUND(AVG(x)::numeric, 1) -> ROUND(AVG(CAST(x AS decimal(10,2))), 1).
// The cast is what stops integer division truncating the average; T-SQL has the
// same hazard, so the cast has to survive translation rather than be dropped.
const AVG_LEVEL_SCOPED = sql({
  pg: 'ROUND(AVG(effective_level)::numeric, 1)',
  mssql: 'ROUND(AVG(CAST(effective_level AS decimal(10,2))), 1)',
});
const AVG_REQUIRED = sql({
  pg: 'ROUND(AVG(required_level)::numeric, 1)',
  mssql: 'ROUND(AVG(CAST(required_level AS decimal(10,2))), 1)',
});

const Q_INSERT_CATEGORY = sql({
  pg: `INSERT INTO skill_categories (code, name, description)
       VALUES ($1, $2, $3)
       RETURNING id, code, name, description`,
  mssql: `INSERT INTO skill_categories (code, name, description)
          OUTPUT INSERTED.id, INSERTED.code, INSERTED.name, INSERTED.description
          VALUES ($1, $2, $3)`,
});

const Q_INSERT_SKILL_FULL = sql({
  pg: `INSERT INTO skills (code, name, category_id, description, criticality, future_relevance)
       VALUES ($1,$2,$3,$4,COALESCE($5,'Medium'),COALESCE($6,'Medium'))
       RETURNING id, code, name`,
  // skills carries trg_skills_updated_at, so OUTPUT has to go INTO a table
  // variable rather than straight to the caller.
  mssql: `DECLARE @out TABLE (id UNIQUEIDENTIFIER, code NVARCHAR(450), name NVARCHAR(450));
          INSERT INTO skills (code, name, category_id, description, criticality, future_relevance)
          OUTPUT INSERTED.id, INSERTED.code, INSERTED.name INTO @out
          VALUES ($1,$2,$3,$4,COALESCE($5,'Medium'),COALESCE($6,'Medium'));
          SELECT id, code, name FROM @out;`,
});

// Turns a JSON column into a parsed value regardless of which driver produced
// it. pg hands back an array already; FOR JSON PATH hands back a string, and
// returns NULL rather than '[]' when the subquery matched nothing.
function parseJsonColumn(rows, column, fallback = []) {
  for (const row of rows) {
    const v = row[column];
    if (v === null || v === undefined) {
      row[column] = fallback;
    } else if (typeof v === 'string') {
      try {
        row[column] = JSON.parse(v);
      } catch {
        row[column] = fallback;
      }
    }
  }
  return rows;
}

// GET /api/skills?search=&category=&label=
router.get('/', async (req, res, next) => {
  try {
    const { search, category, label } = req.query;
    const params = [];
    const where = ['s.active = TRUE'];

    if (search) {
      params.push(`%${search}%`);
      where.push(`(s.name ILIKE $${params.length} OR s.description ILIKE $${params.length})`);
    }
    if (category) {
      params.push(category);
      where.push(`c.id = $${params.length}`);
    }
    if (label) {
      params.push(label);
      where.push(
        `EXISTS (SELECT 1 FROM skill_label_map slm WHERE slm.skill_id = s.id AND slm.label_id = $${params.length})`
      );
    }

    // Appended last so the placeholder numbers land after the filter params.
    const scope = visibleIdsSql(req.user, params);

    const { rows } = await query(
      `SELECT s.id, s.code, s.name AS skill_name, s.criticality, s.future_relevance,
              c.id AS category_id, c.name AS category,
              COUNT(DISTINCT esa.employee_id) AS assigned_employees,
              COUNT(DISTINCT rb.job_role_id) AS linked_roles,
              COUNT(DISTINCT msm.mentor_id) AS mentors,
              ${LABELS_JSON}
       FROM skills s
       LEFT JOIN skill_categories c ON c.id = s.category_id
       LEFT JOIN employee_skill_assignments esa
              ON esa.skill_id = s.id AND esa.employee_id IN (${scope})
       LEFT JOIN job_role_skill_benchmarks rb ON rb.skill_id = s.id
       LEFT JOIN mentor_skill_map msm
              ON msm.skill_id = s.id AND msm.mentor_id IN (${scope})
       LEFT JOIN skill_label_map slm ON slm.skill_id = s.id
       LEFT JOIN skill_labels sl ON sl.id = slm.label_id
       WHERE ${where.join(' AND ')}
       GROUP BY s.id, s.code, s.name, s.criticality, s.future_relevance, c.id, c.name
       ORDER BY s.name`,
      params
    );
    res.json(parseJsonColumn(rows, 'labels'));
  } catch (err) {
    next(err);
  }
});

// GET /api/skills/categories — for filter dropdown.
router.get('/categories', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.id, c.code, c.name, c.description,
              COUNT(s.id) AS skill_count
       FROM skill_categories c
       LEFT JOIN skills s ON s.category_id = c.id
       GROUP BY c.id, c.code, c.name, c.description
       ORDER BY c.name`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/skills/categories — create a section (skill category).
router.post('/categories', async (req, res, next) => {
  try {
    const { code, name, description } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    // Derive a short code from the name when one isn't supplied.
    const finalCode =
      (code && code.trim()) ||
      name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 12) ||
      'SECTION';
    const { rows } = await query(
      Q_INSERT_CATEGORY,
      [finalCode, name.trim(), description || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: 'A section with that code or name already exists' });
    }
    next(err);
  }
});

// GET /api/skills/labels — for filter dropdown.
router.get('/labels', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT id, label_name, label_color FROM skill_labels ORDER BY label_name');
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/skills/:id — full detail.
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const skillP = query(
      `SELECT s.*, c.name AS category_name
       FROM skills s LEFT JOIN skill_categories c ON c.id = s.category_id
       WHERE s.id = $1`,
      [id]
    );
    const levelsP = query(
      `SELECT level_no, level_title, level_definition
       FROM skill_level_definitions WHERE skill_id = $1 ORDER BY level_no`,
      [id]
    );
    // Proficiency distribution across the latest per-employee effective levels,
    // scoped to the caller's subtree.
    const distParams = [id];
    const distributionP = query(
      `SELECT effective_level AS level, COUNT(*) AS count
       FROM v_employee_skill_matrix
       WHERE skill_id = $1 AND effective_level BETWEEN 1 AND 5
         AND employee_id IN (${visibleIdsSql(req.user, distParams)})
       GROUP BY effective_level ORDER BY effective_level`,
      distParams
    );
    // Benchmark: employee avg effective level vs avg required benchmark.
    // The benchmark side is role metadata and stays global; the employee side
    // is scoped.
    const benchParams = [id];
    const benchScope = visibleIdsSql(req.user, benchParams);
    const benchmarkP = query(
      `SELECT
         (SELECT ${AVG_LEVEL_SCOPED} FROM v_employee_skill_matrix
            WHERE skill_id = $1 AND effective_level > 0
              AND employee_id IN (${benchScope})) AS employee_avg,
         (SELECT ${AVG_REQUIRED} FROM job_role_skill_benchmarks
            WHERE skill_id = $1) AS benchmark`,
      benchParams
    );
    // Names people, so it must be scoped.
    const mentorParams = [id];
    const mentorsP = query(
      `SELECT e.id, e.full_name, e.org_title, e.photo_url, msm.mentor_level, msm.can_certify
       FROM mentor_skill_map msm JOIN employees e ON e.id = msm.mentor_id
       WHERE msm.skill_id = $1
         AND e.id IN (${visibleIdsSql(req.user, mentorParams)})
       ORDER BY msm.mentor_level DESC`,
      mentorParams
    );
    const trainingP = query(
      `SELECT tc.id, tc.title, tc.course_type, tc.delivery_mode
       FROM course_skill_map csm JOIN training_courses tc ON tc.id = csm.course_id
       WHERE csm.skill_id = $1 ORDER BY tc.title`,
      [id]
    );
    const rolesP = query(
      `SELECT jr.id, jr.role_name, jr.function_area, b.required_level, b.priority, b.mandatory
       FROM job_role_skill_benchmarks b JOIN job_roles jr ON jr.id = b.job_role_id
       WHERE b.skill_id = $1 ORDER BY b.required_level DESC`,
      [id]
    );
    const certsP = query(
      `SELECT c.id, c.title, c.certification_type, csm.required_level
       FROM certification_skill_map csm JOIN certifications c ON c.id = csm.certification_id
       WHERE csm.skill_id = $1 ORDER BY c.title`,
      [id]
    );
    const labelsP = query(
      `SELECT sl.label_name AS name, sl.label_color AS color
       FROM skill_label_map slm JOIN skill_labels sl ON sl.id = slm.label_id
       WHERE slm.skill_id = $1`,
      [id]
    );

    const [skill, levels, distribution, benchmark, mentors, training, roles, certs, labels] =
      await Promise.all([skillP, levelsP, distributionP, benchmarkP, mentorsP, trainingP, rolesP, certsP, labelsP]);

    if (skill.rows.length === 0) {
      return res.status(404).json({ error: 'Skill not found' });
    }

    res.json({
      skill: skill.rows[0],
      labels: labels.rows,
      levelDefinitions: levels.rows,
      proficiencyDistribution: distribution.rows,
      benchmark: benchmark.rows[0] || {},
      mentors: mentors.rows,
      linkedTraining: training.rows,
      roles: roles.rows,
      certifications: certs.rows,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/skills — admin: create a skill.
router.post('/', async (req, res, next) => {
  try {
    const { code, name, category_id, description, criticality, future_relevance } = req.body || {};
    if (!code || !name) {
      return res.status(400).json({ error: 'code and name are required' });
    }
    // Skill + rubric go in together: a skill with no level definitions has an
    // empty Level Definition tab and nothing for assessors to rate against.
    const created = await withTransaction(async (client) => {
      const { rows } = await client.query(Q_INSERT_SKILL_FULL, [
        code,
        name,
        category_id || null,
        description || null,
        criticality,
        future_relevance,
      ]);

      await insertDefaultLevelDefinitions(client, rows[0].id);

      return rows[0];
    });

    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
