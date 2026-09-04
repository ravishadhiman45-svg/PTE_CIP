// Executive dashboard data.
//
// Every figure here is scoped to the caller's subtree, so "the dashboard" means
// something different for each viewer: the Executive Officer gets the whole
// organization, a DVM gets their division, and a leaf employee gets a dashboard
// about exactly one person — themselves. That falls out of the same predicate
// the rest of the API uses rather than being a separate set of rules.
const express = require('express');
const { query } = require('../db');
const { visibleIdsSql, isAdmin } = require('../lib/visibility');

const router = express.Router();

// Average shortfall against the benchmark, floored at zero so someone ahead of
// their required level does not offset a colleague who is behind.
const AVG_GAP = 'ROUND(AVG(GREATEST(COALESCE(b.required_level,0) - COALESCE(m.effective_level,0), 0)), 2)';

// GET /api/dashboard/executive
router.get('/executive', async (req, res, next) => {
  try {
    // v_executive_dashboard has no employee_id to filter on, so it is replaced
    // by a function that takes the viewer (db/09_scoped_analytics.sql).
    const kpiParams = [req.user.employee_id, isAdmin(req.user)];
    const kpisP = query('SELECT * FROM executive_dashboard($1, $2)', kpiParams);

    // Skill coverage by department: average effective level vs a 5-point scale.
    const coverageParams = [];
    const coverageP = query(
      `SELECT d.name AS department,
              ROUND(100.0 * AVG(COALESCE(m.effective_level,0)) / 5.0, 0) AS coverage_percent
       FROM departments d
       JOIN employees e ON e.department_id = d.id AND e.employment_status = 'Active'
       LEFT JOIN v_employee_skill_matrix m ON m.employee_id = e.id
       WHERE e.id IN (${visibleIdsSql(req.user, coverageParams)})
       GROUP BY d.name
       ORDER BY coverage_percent DESC NULLS LAST`,
      coverageParams
    );

    // Capability gap heatmap: skill category (row) x department (col).
    // Value = average gap between required benchmark and effective level.
    const heatmapParams = [];
    const heatmapScope = visibleIdsSql(req.user, heatmapParams);
    const heatmapP = query(
      `SELECT sc.name AS skill_area,
              d.code AS department_code,
              d.name AS department_name,
              ${AVG_GAP} AS avg_gap,
              ROUND(AVG(COALESCE(m.effective_level,0)), 2) AS avg_level
       FROM skill_categories sc
       JOIN skills s ON s.category_id = sc.id
       JOIN departments d ON TRUE
       LEFT JOIN employees e ON e.department_id = d.id
                            AND e.employment_status = 'Active'
                            AND e.id IN (${heatmapScope})
       LEFT JOIN v_employee_skill_matrix m ON m.employee_id = e.id AND m.skill_id = s.id
       LEFT JOIN job_role_skill_benchmarks b ON b.skill_id = s.id AND b.job_role_id = e.job_role_id
       GROUP BY sc.name, d.code, d.name
       ORDER BY sc.name, d.code`,
      heatmapParams
    );

    const [kpis, coverage, heatmap] = await Promise.all([kpisP, coverageP, heatmapP]);

    res.json({
      kpis: kpis.rows[0] || {},
      skillCoverageByDepartment: coverage.rows,
      capabilityGapHeatmap: heatmap.rows,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
