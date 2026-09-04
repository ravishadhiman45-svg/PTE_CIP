// Future skills roadmap.
// Derives current vs required capability per skill area for 2026 / 2028 / 2032
// from each category's average assessed level and future_relevance.
const express = require('express');
const { query } = require('../db');
const { visibleIdsSql } = require('../lib/visibility');

const router = express.Router();

// The most common future_relevance in the group. MODE() picks an arbitrary
// winner among equally-frequent values, which is acceptable here: the horizons
// table below buckets relevance coarsely.
const DOMINANT_RELEVANCE = 'MODE() WITHIN GROUP (ORDER BY s.future_relevance)';

const IS_STRATEGIC = "BOOL_OR(s.criticality IN ('High','Critical'))";

// future_relevance → target capability (%) by horizon.
const REQUIRED_BY_RELEVANCE = {
  'Very High': { 2026: 70, 2028: 90, 2032: 100 },
  High: { 2026: 60, 2028: 80, 2032: 95 },
  Medium: { 2026: 55, 2028: 70, 2032: 85 },
  Low: { 2026: 50, 2028: 60, 2032: 70 },
};

router.get('/', async (req, res, next) => {
  try {
    // Average effective level and dominant future relevance per skill category.
    // "Current capability" is measured over the caller's own organization, so a
    // DVM's roadmap reflects their division rather than the whole company.
    const params = [];
    const scope = visibleIdsSql(req.user, params);
    const { rows } = await query(
      `SELECT sc.name AS skill_area,
              ROUND(AVG(COALESCE(m.effective_level,0)), 2) AS avg_level,
              ${DOMINANT_RELEVANCE} AS future_relevance,
              ${IS_STRATEGIC} AS strategic
       FROM skill_categories sc
       JOIN skills s ON s.category_id = sc.id
       LEFT JOIN v_employee_skill_matrix m
              ON m.skill_id = s.id AND m.employee_id IN (${scope})
       GROUP BY sc.name
       ORDER BY sc.name`,
      params
    );

    const roadmap = rows.map((r) => {
      const rel = r.future_relevance || 'Medium';
      const req = REQUIRED_BY_RELEVANCE[rel] || REQUIRED_BY_RELEVANCE.Medium;
      // Current capability as a % of the 5-point scale.
      const current = Math.round((Number(r.avg_level) / 5) * 100);
      return {
        skill_area: r.skill_area,
        strategic: r.strategic,
        future_relevance: rel,
        current_capability: current,
        required: {
          2026: req[2026],
          2028: req[2028],
          2032: req[2032],
        },
        gap: {
          2026: Math.max(req[2026] - current, 0),
          2028: Math.max(req[2028] - current, 0),
          2032: Math.max(req[2032] - current, 0),
        },
      };
    });

    res.json(roadmap);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
