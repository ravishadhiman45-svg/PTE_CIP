// Certification tracker.
const express = require('express');
const { query } = require('../db');
const { visibleIdsSql } = require('../lib/visibility');

const router = express.Router();

// GET /api/certifications/catalog
// The company's certification list, for the picker on a profile's Learning
// Module tab. Catalogue data, not people data, so it carries no subtree
// predicate — same reasoning as the skills library.
router.get('/catalog', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, title, certification_type, validity_months
       FROM certifications
       WHERE active = TRUE
       ORDER BY title`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/certifications?status=&search=
router.get('/', async (req, res, next) => {
  try {
    const { status, search } = req.query;
    const params = [];
    const where = [];

    if (status) {
      params.push(status);
      where.push(`ec.status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(
        `(e.full_name ILIKE $${params.length} OR COALESCE(c.title, ec.title_text) ILIKE $${params.length})`
      );
    }
    // This tracker names the person holding each certification, so it is a
    // per-employee list and follows the subtree rule.
    where.push(`ec.employee_id IN (${visibleIdsSql(req.user, params)})`);
    const whereSql = `WHERE ${where.join(' AND ')}`;

    const { rows } = await query(
      // LEFT JOIN on the catalogue: a certificate an employee typed in on their
      // own profile has no catalogue row, and an inner join would hide it from a
      // page called "Certification Tracker" with no sign anything was missing.
      `SELECT ec.id, e.full_name AS employee, e.org_title,
              COALESCE(c.title, ec.title_text) AS certification,
              COALESCE(c.certification_type, 'Self-Reported') AS certification_type,
              ec.source, ec.status, ec.issued_date, ec.expiry_date,
              appr.full_name AS approved_by
       FROM employee_certifications ec
       JOIN employees e ON e.id = ec.employee_id
       LEFT JOIN certifications c ON c.id = ec.certification_id
       LEFT JOIN employees appr ON appr.id = ec.approved_by
       ${whereSql}
       ORDER BY ec.issued_date DESC NULLS LAST, e.full_name`,
      params
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
