// Future skills roadmap.
// Derives current vs required capability per skill area for 2026 / 2028 / 2032
// from each category's average assessed level and future_relevance.
const express = require('express');
const { query, sql } = require('../db');
const { visibleIdsSql } = require('../lib/visibility');

const router = express.Router();

// ---------------------------------------------------------------
// Dialect-divergent SQL — see server/src/db/sql.js
// ---------------------------------------------------------------

// MODE() WITHIN GROUP is a Postgres ordered-set aggregate with no T-SQL
// counterpart at all. The equivalent is "the most common value in the group",
// which becomes a correlated TOP 1 ... GROUP BY ... ORDER BY COUNT(*) DESC.
//
// The tie-break differs: Postgres's MODE() picks an arbitrary winner among
// equally-frequent values, so the secondary ORDER BY here makes the T-SQL
// version DETERMINISTIC rather than merely matching. That is a deliberate
// improvement, not an accident — but it means the two can legitimately disagree
// on a tie, which is worth knowing when diffing outputs.
const DOMINANT_RELEVANCE = sql({
  pg: 'MODE() WITHIN GROUP (ORDER BY s.future_relevance)',
  mssql: `(SELECT TOP 1 s2.future_relevance
                 FROM skills s2
                WHERE s2.category_id = sc.id AND s2.future_relevance IS NOT NULL
                GROUP BY s2.future_relevance
                ORDER BY COUNT(*) DESC, s2.future_relevance)`,
});

// BOOL_OR(p) -> MAX(CASE WHEN p THEN 1 ELSE 0 END), compared to produce a real
// boolean so the JSON stays true/false rather than 1/0.
const IS_STRATEGIC = sql({
  pg: "BOOL_OR(s.criticality IN ('High','Critical'))",
  mssql: `CAST(MAX(CASE WHEN s.criticality IN ('High','Critical') THEN 1 ELSE 0 END) AS bit)`,
});


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
