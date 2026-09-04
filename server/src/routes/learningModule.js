// Learning Module — the "do the work now" workspace.
//
// Sits beside learningPlan.js rather than replacing it: that file owns the
// Kanban board (learning_plan_items, what you intend to do), this one owns the
// module checklists (course_modules + enrollment_module_progress, what you are
// actually working through). The page shows both.
const express = require('express');
const { query } = require('../db');
const { requireVisible } = require('../middleware/auth');
const { isAdmin } = require('../lib/visibility');

const router = express.Router();

// Enrolments with every module and whether it is ticked. One query — the
// modules ride along as JSON so the page never has to fan out per course.
//
// `completed_at: null` is what "not ticked yet" means to the client, so the key
// has to be present on every module — json_build_object keeps nulls.
const COURSES_SQL = `
  SELECT te.id, te.course_id, te.status, te.progress_percent, te.score,
         te.enrolled_at, te.completed_at,
         tc.title, tc.course_code, tc.description, tc.course_type, tc.delivery_mode,
         tc.duration_hours, tc.difficulty, tc.cover_image_url,
         sme.full_name AS owner_sme,
         COALESCE((
           SELECT json_agg(json_build_object(
                    'id',                 cm.id,
                    'module_order',       cm.module_order,
                    'module_title',       cm.module_title,
                    'module_description', cm.module_description,
                    'duration_minutes',   cm.duration_minutes,
                    'completed_at',       emp.completed_at)
                  ORDER BY cm.module_order)
           FROM course_modules cm
           LEFT JOIN enrollment_module_progress emp
                  ON emp.module_id = cm.id AND emp.enrollment_id = te.id
           WHERE cm.course_id = tc.id
         ), '[]'::json) AS modules,
         COALESCE((
           SELECT json_agg(s.name ORDER BY s.name)
           FROM course_skill_map csm JOIN skills s ON s.id = csm.skill_id
           WHERE csm.course_id = tc.id
         ), '[]'::json) AS skills
  FROM training_enrollments te
  JOIN training_courses tc ON tc.id = te.course_id
  LEFT JOIN employees sme ON sme.id = tc.owner_sme_id
  WHERE te.employee_id = $1`;

// Headline numbers. Module counts come from the join table so they mean
// "modules actually ticked", not a share of a percentage.
//
// count(*) is bigint and would arrive as a string, hence ::int. duration_hours
// is NUMERIC, which also arrives as a string, hence ::float.
const STATS_SQL = `SELECT
         (SELECT count(*)::int FROM enrollment_module_progress emp
            JOIN training_enrollments te ON te.id = emp.enrollment_id
           WHERE te.employee_id = $1)                                             AS modules_done,
         (SELECT count(*)::int FROM course_modules cm
            JOIN training_enrollments te ON te.course_id = cm.course_id
           WHERE te.employee_id = $1
             AND te.status IN ('Nominated','Approved','In Progress','Completed')) AS modules_total,
         (SELECT count(*)::int FROM training_enrollments te
           WHERE te.employee_id = $1
             AND te.status IN ('Nominated','Approved','In Progress'))             AS active_courses,
         (SELECT count(*)::int FROM training_enrollments te
           WHERE te.employee_id = $1 AND te.status = 'Completed')                 AS completed_courses,
         (SELECT COALESCE(sum(tc.duration_hours),0)::float
            FROM training_enrollments te JOIN training_courses tc ON tc.id = te.course_id
           WHERE te.employee_id = $1 AND te.status = 'Completed')                 AS hours_done`;

// Ticking a module. ON CONFLICT DO NOTHING is what makes a double-tick a no-op
// rather than a primary-key violation.
const Q_TICK_MODULE = `INSERT INTO enrollment_module_progress (enrollment_id, module_id)
       VALUES ($1,$2) ON CONFLICT DO NOTHING`;

// Recomputes training_enrollments.progress_percent from the ticked share.
// Defined in db/pg/14_module_progress.sql.
const Q_SYNC_PROGRESS = 'SELECT sync_enrollment_progress($1)';

// GET /api/learning-module/:employeeId
router.get('/:employeeId', requireVisible('employeeId'), async (req, res, next) => {
  try {
    const { employeeId } = req.params;

    const coursesP = query(
      `${COURSES_SQL}
         AND te.status IN ('Nominated','Approved','In Progress','Completed')
       ORDER BY CASE te.status WHEN 'In Progress' THEN 1 WHEN 'Approved' THEN 2
                               WHEN 'Nominated' THEN 3 ELSE 4 END,
                te.enrolled_at DESC`,
      [employeeId]
    );

    const statsP = query(STATS_SQL, [employeeId]);

    // The Kanban, same shape learningPlan.js returns, so the board renders
    // unchanged now that this page owns it.
    const planP = query(
      `SELECT lpi.id, lpi.status, lpi.priority, lpi.progress_percent, lpi.due_date,
              lpi.notes, lpi.completed_at,
              tc.title, tc.course_type, tc.delivery_mode, tc.duration_hours,
              mtr.full_name AS mentor_name
       FROM learning_plan_items lpi
       LEFT JOIN training_courses tc ON tc.id = lpi.course_id
       LEFT JOIN employees mtr ON mtr.id = tc.owner_sme_id
       WHERE lpi.employee_id = $1
       ORDER BY CASE lpi.status
                  WHEN 'To Do' THEN 1 WHEN 'In Progress' THEN 2
                  WHEN 'Completed' THEN 3 ELSE 4 END,
                lpi.priority`,
      [employeeId]
    );

    const [courses, stats, plan] = await Promise.all([coursesP, statsP, planP]);

    const columns = { 'To Do': [], 'In Progress': [], Completed: [], Archived: [] };
    for (const r of plan.rows) if (columns[r.status]) columns[r.status].push(r);

    res.json({ courses: courses.rows, stats: stats.rows[0], columns });
  } catch (err) {
    next(err);
  }
});

// Your modules are yours. Reads follow the subtree rule (requireVisible above);
// ticking is self-or-admin, checked against the enrolment's own owner rather
// than a url param, so an id from someone else's course cannot be ticked.
async function ownedEnrollment(req, res) {
  const { rows } = await query('SELECT employee_id FROM training_enrollments WHERE id = $1', [
    req.params.enrollmentId,
  ]);
  if (rows.length === 0) {
    res.status(404).json({ error: 'Enrolment not found' });
    return null;
  }
  if (!isAdmin(req.user) && rows[0].employee_id !== req.user.employee_id) {
    res.status(403).json({ error: 'You can only update your own learning' });
    return null;
  }
  return rows[0].employee_id;
}

// The course as the page needs to redraw it, after a tick.
async function courseAfterChange(employeeId, enrollmentId) {
  const { rows } = await query(`${COURSES_SQL} AND te.id = $2`, [employeeId, enrollmentId]);
  return rows[0] || null;
}

// The module must belong to this enrolment's course — otherwise a valid
// enrolment id plus any module id would tick a module from a different course.
async function moduleBelongs(enrollmentId, moduleId) {
  const { rows } = await query(
    `SELECT 1 FROM course_modules cm
      JOIN training_enrollments te ON te.course_id = cm.course_id
     WHERE cm.id = $1 AND te.id = $2`,
    [moduleId, enrollmentId]
  );
  return rows.length > 0;
}

// PUT /api/learning-module/enrollments/:enrollmentId/modules/:moduleId — tick
router.put('/enrollments/:enrollmentId/modules/:moduleId', async (req, res, next) => {
  try {
    const employeeId = await ownedEnrollment(req, res);
    if (!employeeId) return undefined;
    const { enrollmentId, moduleId } = req.params;

    if (!(await moduleBelongs(enrollmentId, moduleId))) {
      return res.status(400).json({ error: 'That module is not part of this course' });
    }

    await query(Q_TICK_MODULE, [enrollmentId, moduleId]);
    await query(Q_SYNC_PROGRESS, [enrollmentId]);
    return res.json(await courseAfterChange(employeeId, enrollmentId));
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/learning-module/enrollments/:enrollmentId/modules/:moduleId — untick
router.delete('/enrollments/:enrollmentId/modules/:moduleId', async (req, res, next) => {
  try {
    const employeeId = await ownedEnrollment(req, res);
    if (!employeeId) return undefined;
    const { enrollmentId, moduleId } = req.params;

    await query(
      'DELETE FROM enrollment_module_progress WHERE enrollment_id = $1 AND module_id = $2',
      [enrollmentId, moduleId]
    );
    await query(Q_SYNC_PROGRESS, [enrollmentId]);
    return res.json(await courseAfterChange(employeeId, enrollmentId));
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
