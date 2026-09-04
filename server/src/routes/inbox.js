// Inbox items and approvals for the logged-in user.
const express = require('express');
const { query } = require('../db');

const router = express.Router();

// COUNT(*) is bigint, which the driver hands back as a STRING. The ::int cast is
// what makes the badge count a JS number.
const Q_UNREAD_COUNT = `SELECT COUNT(*)::int AS unread FROM inbox_items
       WHERE recipient_employee_id = $1 AND status = 'Unread'`;

const Q_MARK_READ = `UPDATE inbox_items SET status = 'Read'
       WHERE id = $1 AND recipient_employee_id = $2 AND status = 'Unread'
       RETURNING id, status`;

// GET /api/inbox — items for the current employee.
router.get('/', async (req, res, next) => {
  try {
    const employeeId = req.user.employee_id;
    const { rows } = await query(
      `SELECT id, item_type, title, body, status, priority, due_at, created_at,
              related_entity_type, related_entity_id
       FROM inbox_items
       WHERE recipient_employee_id = $1
       ORDER BY CASE status WHEN 'Unread' THEN 0 ELSE 1 END,
                created_at DESC`,
      [employeeId]
    );
    const unread = rows.filter((r) => r.status === 'Unread').length;
    res.json({ items: rows, unread });
  } catch (err) {
    next(err);
  }
});

// GET /api/inbox/count — unread badge count.
router.get('/count', async (req, res, next) => {
  try {
    const employeeId = req.user.employee_id;
    const { rows } = await query(
      Q_UNREAD_COUNT,
      [employeeId]
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/inbox/:id/read — mark an item read.
router.patch('/:id/read', async (req, res, next) => {
  try {
    const employeeId = req.user.employee_id;
    const { rows } = await query(
      Q_MARK_READ,
      [req.params.id, employeeId]
    );
    res.json(rows[0] || { id: req.params.id, status: 'Read' });
  } catch (err) {
    next(err);
  }
});

// GET /api/inbox/approvals — approvals where the current user is approver.
router.get('/approvals', async (req, res, next) => {
  try {
    const employeeId = req.user.employee_id;
    const { rows } = await query(
      `SELECT a.id, a.approval_type, a.entity_type, a.entity_id, a.status,
              a.decision_comments, a.requested_at, a.decided_at,
              rq.full_name AS requested_by, a.requested_by AS requested_by_id
       FROM approvals a
       LEFT JOIN employees rq ON rq.id = a.requested_by
       WHERE a.approver_id = $1
       ORDER BY CASE a.status WHEN 'Pending' THEN 0 ELSE 1 END, a.requested_at DESC`,
      [employeeId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
