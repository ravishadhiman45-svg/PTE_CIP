// Learning plan Kanban.
const express = require('express');
const { query, sql } = require('../db');
const { requireVisible } = require('../middleware/auth');
const { isAdmin } = require('../lib/visibility');

const router = express.Router();

// GET /api/learning-plan/:employeeId — Kanban items grouped by status.
router.get('/:employeeId', requireVisible('employeeId'), async (req, res, next) => {
  try {
    const { employeeId } = req.params;
    const { rows } = await query(
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

    const columns = { 'To Do': [], 'In Progress': [], Completed: [], Archived: [] };
    for (const r of rows) {
      if (columns[r.status]) columns[r.status].push(r);
    }
    res.json({ columns, items: rows });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/learning-plan/items/:id — update status/progress (drag-drop).
router.patch('/items/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, progress_percent } = req.body || {};

    const sets = [];
    const params = [];

    if (status) {
      const allowed = ['To Do', 'In Progress', 'Completed', 'Archived'];
      if (!allowed.includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      params.push(status);
      sets.push(`status = $${params.length}`);
      if (status === 'Completed') {
        sets.push('progress_percent = 100');
        sets.push('completed_at = NOW()');
      }
    }
    if (typeof progress_percent === 'number' && status !== 'Completed') {
      params.push(Math.max(0, Math.min(100, progress_percent)));
      sets.push(`progress_percent = $${params.length}`);
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    // Your board is yours. This route previously had no ownership check at all,
    // so any signed-in user could move any other user's cards by item id.
    // Reads follow the subtree rule; writes stay self-or-admin.
    params.push(id);
    const idParam = `$${params.length}`;
    let ownership = '';
    if (!isAdmin(req.user)) {
      params.push(req.user.employee_id);
      ownership = ` AND employee_id = $${params.length}`;
    }

    const { rows } = await query(
      sql({
        pg: `UPDATE learning_plan_items SET ${sets.join(', ')}
       WHERE id = ${idParam}${ownership}
       RETURNING id, status, progress_percent, completed_at`,
        mssql: `UPDATE learning_plan_items SET ${sets.join(', ')}
       OUTPUT INSERTED.id, INSERTED.status, INSERTED.progress_percent, INSERTED.completed_at
       WHERE id = ${idParam}${ownership}`,
      }),
      params
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Item not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
