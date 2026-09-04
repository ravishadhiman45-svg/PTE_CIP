// Mentor dashboard + mentee list.
const express = require('express');
const { query } = require('../db');
const { requireVisible } = require('../middleware/auth');
const { visibleIdsSql } = require('../lib/visibility');

const router = express.Router();

// The mentor's most recent recommended level for this mentee.
const LATEST_RECOMMENDATION = `(SELECT recommended_level FROM mentor_recommendations mr
                 WHERE mr.mentor_id = ma.mentor_id AND mr.employee_id = ma.mentee_id
                 ORDER BY mr.submitted_at DESC LIMIT 1)`;

// GET /api/mentor/:mentorId/dashboard
//
// NOTE: mentoring deliberately crosses branches — a mentor is often nowhere
// near their mentee in the reporting line. Under strict subtree visibility the
// mentee list below is filtered to people the CALLER can see, so a mentor will
// not see mentees outside their own subtree. That is the chosen rule applied
// consistently, not an oversight; relaxing it means granting an active
// mentor_assignments row a narrow mutual visibility exception.
router.get('/:mentorId/dashboard', requireVisible('mentorId'), async (req, res, next) => {
  try {
    const { mentorId } = req.params;

    const summaryP = query('SELECT * FROM v_mentor_dashboard WHERE mentor_id = $1', [mentorId]);

    // Mentee list: target skill (from assignment), mentee's current level for
    // that skill, a project-application level (mentor recommended level),
    // and last interaction (latest mentoring session).
    const menteeParams = [mentorId];
    const menteeScope = visibleIdsSql(req.user, menteeParams);
    const menteesP = query(
      `SELECT ma.id AS assignment_id,
              mentee.id AS mentee_id,
              mentee.full_name AS mentee_name,
              mentee.photo_url AS mentee_photo,
              s.name AS target_skill,
              esa.target_level,
              COALESCE(m.effective_level, 0) AS current_level,
              ${LATEST_RECOMMENDATION} AS project_level,
              (SELECT MAX(ms.session_date) FROM mentoring_sessions ms
                 WHERE ms.mentor_assignment_id = ma.id) AS last_interaction,
              ma.status
       FROM mentor_assignments ma
       JOIN employees mentee ON mentee.id = ma.mentee_id
       LEFT JOIN skills s ON s.id = ma.skill_id
       LEFT JOIN employee_skill_assignments esa
              ON esa.employee_id = ma.mentee_id AND esa.skill_id = ma.skill_id
       LEFT JOIN v_employee_skill_matrix m
              ON m.employee_id = ma.mentee_id AND m.skill_id = ma.skill_id
       WHERE ma.mentor_id = $1
         AND ma.mentee_id IN (${menteeScope})
       ORDER BY last_interaction DESC NULLS LAST, mentee.full_name`,
      menteeParams
    );

    const [summary, mentees] = await Promise.all([summaryP, menteesP]);

    res.json({
      summary: summary.rows[0] || { mentor_id: mentorId, active_mentees: 0, open_support_requests: 0, submitted_recommendations: 0 },
      mentees: mentees.rows,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
