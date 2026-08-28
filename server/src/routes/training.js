// Training catalog.
const express = require('express');
const { query, sql } = require('../db');

const router = express.Router();

// ---------------------------------------------------------------
// Dialect-divergent SQL — see server/src/db/sql.js
// ---------------------------------------------------------------

// A course's skill names as a JSON array. As in routes/skills.js, T-SQL builds
// it with a correlated FOR JSON PATH rather than aggregating the join fan-out.
//
// The shapes differ: pg parses json into an array of strings, while FOR JSON
// PATH yields objects. Requesting a single unnamed column and using
// WITHOUT_ARRAY_WRAPPER would give a bare string, so the mssql branch keeps the
// {name} objects and parseSkillNames() flattens them.
const COURSE_SKILLS_JSON = sql({
  pg: `COALESCE(
                JSON_AGG(DISTINCT s.name) FILTER (WHERE s.id IS NOT NULL), '[]'
              ) AS skills`,
  mssql: `COALESCE((
                SELECT DISTINCT s2.name
                  FROM course_skill_map csm2
                  JOIN skills s2 ON s2.id = csm2.skill_id
                 WHERE csm2.course_id = tc.id
                 FOR JSON PATH
              ), '[]') AS skills`,
});

const Q_INSERT_COURSE = sql({
  pg: `INSERT INTO training_courses
         (course_code, title, description, course_type, delivery_mode, duration_hours, difficulty)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, course_code, title`,
  // training_courses carries trg_training_courses_updated_at, so OUTPUT has to
  // go INTO a table variable rather than straight to the caller.
  mssql: `DECLARE @out TABLE (id UNIQUEIDENTIFIER, course_code NVARCHAR(450), title NVARCHAR(450));
       INSERT INTO training_courses
         (course_code, title, description, course_type, delivery_mode, duration_hours, difficulty)
       OUTPUT INSERTED.id, INSERTED.course_code, INSERTED.title INTO @out
       VALUES ($1,$2,$3,$4,$5,$6,$7);
       SELECT id, course_code, title FROM @out;`,
});

// Flattens the skills column to a string array on both dialects: pg already has
// ["a","b"], FOR JSON PATH gives '[{"name":"a"},{"name":"b"}]'.
function parseSkillNames(rows) {
  for (const row of rows) {
    const v = row.skills;
    if (Array.isArray(v)) {
      row.skills = v.map((x) => (x && typeof x === 'object' ? x.name : x)).filter(Boolean);
      continue;
    }
    if (typeof v === 'string' && v.length > 0) {
      try {
        const parsed = JSON.parse(v);
        row.skills = (Array.isArray(parsed) ? parsed : [])
          .map((x) => (x && typeof x === 'object' ? x.name : x))
          .filter(Boolean);
        continue;
      } catch {
        // fall through
      }
    }
    row.skills = [];
  }
  return rows;
}


// GET /api/training?search=&type=&category=
router.get('/', async (req, res, next) => {
  try {
    const { search, type, category } = req.query;
    const params = [];
    const where = [];

    if (search) {
      params.push(`%${search}%`);
      where.push(`(tc.title ILIKE $${params.length} OR tc.description ILIKE $${params.length})`);
    }
    if (type) {
      params.push(type);
      where.push(`tc.course_type = $${params.length}`);
    }
    if (category) {
      params.push(category);
      where.push(
        `EXISTS (SELECT 1 FROM course_skill_map csm JOIN skills s ON s.id = csm.skill_id
                 WHERE csm.course_id = tc.id AND s.category_id = $${params.length})`
      );
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const { rows } = await query(
      `SELECT tc.id, tc.course_code, tc.title, tc.description, tc.course_type,
              tc.delivery_mode, tc.duration_hours, tc.difficulty, tc.status,
              sme.full_name AS owner_sme, coord.full_name AS coordinator,
              ${COURSE_SKILLS_JSON}
       FROM training_courses tc
       LEFT JOIN employees sme ON sme.id = tc.owner_sme_id
       LEFT JOIN employees coord ON coord.id = tc.coordinator_id
       LEFT JOIN course_skill_map csm ON csm.course_id = tc.id
       LEFT JOIN skills s ON s.id = csm.skill_id
       ${whereSql}
       GROUP BY tc.id, tc.course_code, tc.title, tc.description, tc.course_type,
                tc.delivery_mode, tc.duration_hours, tc.difficulty, tc.status,
                sme.full_name, coord.full_name
       ORDER BY tc.title`,
      params
    );
    res.json(parseSkillNames(rows));
  } catch (err) {
    next(err);
  }
});

// GET /api/training/:id — course detail with modules and skills.
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const courseP = query(
      `SELECT tc.*, sme.full_name AS owner_sme, coord.full_name AS coordinator
       FROM training_courses tc
       LEFT JOIN employees sme ON sme.id = tc.owner_sme_id
       LEFT JOIN employees coord ON coord.id = tc.coordinator_id
       WHERE tc.id = $1`,
      [id]
    );
    const modulesP = query(
      `SELECT module_order, module_title, module_description, duration_minutes
       FROM course_modules WHERE course_id = $1 ORDER BY module_order`,
      [id]
    );
    const [course, modules] = await Promise.all([courseP, modulesP]);
    if (course.rows.length === 0) return res.status(404).json({ error: 'Course not found' });
    res.json({ course: course.rows[0], modules: modules.rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/training — admin/coordinator: create a course.
router.post('/', async (req, res, next) => {
  try {
    const {
      course_code,
      title,
      description,
      course_type,
      delivery_mode,
      duration_hours,
      difficulty,
    } = req.body || {};
    if (!course_code || !title || !course_type || !delivery_mode) {
      return res
        .status(400)
        .json({ error: 'course_code, title, course_type and delivery_mode are required' });
    }
    const { rows } = await query(
      Q_INSERT_COURSE,
      [course_code, title, description || null, course_type, delivery_mode, duration_hours || null, difficulty || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
