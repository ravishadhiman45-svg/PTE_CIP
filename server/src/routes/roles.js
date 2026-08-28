// Job roles list + role detail (mandatory skills + people readiness).
const express = require('express');
const { query } = require('../db');
const { visibleIdsSql } = require('../lib/visibility');

const router = express.Router();

// GET /api/roles
//
// The role catalog itself is company-wide (it describes the org, not people),
// but the headcount per role is scoped — otherwise it reports how many people
// hold a role that the caller cannot see a single one of.
router.get('/', async (req, res, next) => {
  try {
    const params = [];
    const scope = visibleIdsSql(req.user, params);
    const { rows } = await query(
      `SELECT jr.id, jr.code, jr.role_name, jr.role_family, jr.function_area,
              jr.role_level, jr.criticality, jr.is_future_role,
              COUNT(DISTINCT b.skill_id) AS required_skills,
              COUNT(DISTINCT e.id) AS employees
       FROM job_roles jr
       LEFT JOIN job_role_skill_benchmarks b ON b.job_role_id = jr.id
       LEFT JOIN employees e ON e.job_role_id = jr.id AND e.id IN (${scope})
       GROUP BY jr.id, jr.code, jr.role_name, jr.role_family, jr.function_area,
                jr.role_level, jr.criticality, jr.is_future_role
       ORDER BY jr.role_name`,
      params
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/roles/:id
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const roleP = query('SELECT * FROM job_roles WHERE id = $1', [id]);

    const skillsP = query(
      `SELECT s.id AS skill_id, s.name AS skill_name, s.criticality,
              b.required_level, b.priority, b.mandatory, b.target_year
       FROM job_role_skill_benchmarks b JOIN skills s ON s.id = b.skill_id
       WHERE b.job_role_id = $1
       ORDER BY b.required_level DESC, s.name`,
      [id]
    );

    // People readiness bucketed from v_role_readiness — scoped to the caller's
    // subtree, so the counts describe their own organization rather than the
    // whole company.
    const readinessParams = [id];
    const readinessP = query(
      `SELECT
         COUNT(*) FILTER (WHERE readiness_percent >= 100) AS ready_now,
         COUNT(*) FILTER (WHERE readiness_percent >= 75 AND readiness_percent < 100) AS ready_3m,
         COUNT(*) FILTER (WHERE readiness_percent >= 50 AND readiness_percent < 75) AS ready_6m,
         COUNT(*) FILTER (WHERE readiness_percent < 50) AS not_ready,
         COUNT(*) AS total,
         ROUND(AVG(readiness_percent), 1) AS avg_readiness
       FROM v_role_readiness
       WHERE job_role_id = $1
         AND employee_id IN (${visibleIdsSql(req.user, readinessParams)})`,
      readinessParams
    );

    // This one names people, so it must be scoped: it used to list every
    // employee holding the role, regardless of who was asking.
    const peopleParams = [id];
    const peopleP = query(
      `SELECT employee_id, employee_name, required_skills, skills_meeting_target, readiness_percent
       FROM v_role_readiness
       WHERE job_role_id = $1
         AND employee_id IN (${visibleIdsSql(req.user, peopleParams)})
       ORDER BY readiness_percent DESC NULLS LAST`,
      peopleParams
    );

    // Per-skill gap for the Analytics tab: what the role demands against what
    // the people actually holding it can do. Scoped like the two queries above,
    // so the averages describe the caller's own organization. Ordered by the
    // widest gap, which is the order the shortfall should be read in.
    const gapParams = [id];
    const gapsP = query(
      `SELECT s.id AS skill_id, s.name AS skill_name, b.required_level, b.priority,
              ROUND(AVG(COALESCE(m.effective_level, 0)), 1) AS avg_level,
              COUNT(e.id) FILTER (WHERE COALESCE(m.effective_level, 0) >= b.required_level) AS meeting,
              COUNT(e.id) AS people
       FROM job_role_skill_benchmarks b
       JOIN skills s ON s.id = b.skill_id
       LEFT JOIN employees e
              ON e.job_role_id = b.job_role_id
             AND e.id IN (${visibleIdsSql(req.user, gapParams)})
       LEFT JOIN v_employee_skill_matrix m
              ON m.employee_id = e.id AND m.skill_id = b.skill_id
       WHERE b.job_role_id = $1
       GROUP BY s.id, s.name, b.required_level, b.priority
       ORDER BY (b.required_level - AVG(COALESCE(m.effective_level, 0))) DESC, s.name`,
      gapParams
    );

    const trainingP = query(
      `SELECT id, title, course_type, delivery_mode, difficulty
       FROM training_courses WHERE linked_job_role_id = $1 ORDER BY title`,
      [id]
    );

    const [role, skills, readiness, people, training, gaps] = await Promise.all([
      roleP,
      skillsP,
      readinessP,
      peopleP,
      trainingP,
      gapsP,
    ]);

    if (role.rows.length === 0) {
      return res.status(404).json({ error: 'Role not found' });
    }

    res.json({
      role: role.rows[0],
      mandatorySkills: skills.rows,
      peopleReadiness: readiness.rows[0] || {},
      people: people.rows,
      trainingPath: training.rows,
      skillGaps: gaps.rows,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
