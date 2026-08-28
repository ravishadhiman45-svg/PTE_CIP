// Profile / CV verification workflow.
//   request  → an employee asks someone in their reporting line to verify their CV
//   decision → that person approves or rejects it from their inbox
// The request is stored as an `approvals` row (approval_type
// 'Profile Verification', entity = the requester's employee_cv) plus an
// inbox_items row for the approver.
//
// This used to let you ask ANYONE in the directory. Under strict top-down
// visibility the directory is your own subtree, so that would have meant only
// being able to ask your own reports — backwards, and impossible for a leaf
// employee, who has none. Verification now goes UP the chain instead, which is
// also the direction it means something.
const express = require('express');
const { query, withTransaction, sql } = require('../db');

const router = express.Router();

// ---------------------------------------------------------------
// Dialect-divergent SQL — see server/src/db/sql.js
// ---------------------------------------------------------------

// UPDLOCK/HOLDLOCK on the existence check makes this atomic, which is what
// ON CONFLICT DO NOTHING gives for free. Without the hint two concurrent
// callers can both see "absent" and one then hits a primary-key violation.
const Q_ENSURE_CV = sql({
  pg: 'INSERT INTO employee_cv (employee_id) VALUES ($1) ON CONFLICT (employee_id) DO NOTHING',
  mssql: `INSERT INTO employee_cv (employee_id)
          SELECT $1 WHERE NOT EXISTS (
            SELECT 1 FROM employee_cv WITH (UPDLOCK, HOLDLOCK) WHERE employee_id = $1)`,
});

// Note $2 appears TWICE — as requested_by and as entity_id. Named parameters
// make that free on SQL Server; a positional `?` conversion would have needed
// the value duplicated in the params array.
const Q_INSERT_APPROVAL = sql({
  pg: `INSERT INTO approvals
           (approval_type, requested_by, approver_id, entity_type, entity_id, status)
         VALUES ($1,$2,$3,'employee_cv',$2,'Pending')
         RETURNING id, approval_type, status, requested_at`,
  mssql: `INSERT INTO approvals
           (approval_type, requested_by, approver_id, entity_type, entity_id, status)
         OUTPUT INSERTED.id, INSERTED.approval_type, INSERTED.status, INSERTED.requested_at
         VALUES ($1,$2,$3,'employee_cv',$2,'Pending')`,
});

const Q_DECIDE_APPROVAL = sql({
  pg: `UPDATE approvals
            SET status = $2, decision_comments = COALESCE($3, decision_comments), decided_at = NOW()
          WHERE id = $1
          RETURNING id, approval_type, status, decision_comments, decided_at`,
  mssql: `UPDATE approvals
            SET status = $2, decision_comments = COALESCE($3, decision_comments), decided_at = SYSUTCDATETIME()
          OUTPUT INSERTED.id, INSERTED.approval_type, INSERTED.status,
                 INSERTED.decision_comments, INSERTED.decided_at
          WHERE id = $1`,
});


const APPROVAL_TYPE = 'Profile Verification';

// Who may verify this person's CV: their reporting line, nearest manager first.
// The Executive Officer has no chain, so they fall back to their direct reports
// — otherwise the one person at the top could never be verified at all.
async function approverOptions(employeeId) {
  const { rows } = await query(
    `SELECT id, full_name, org_title, photo_url, distance FROM (
       SELECT c.id, c.full_name, c.org_title, c.photo_url, c.distance
       FROM employee_chain($1) c
       UNION ALL
       SELECT e.id, e.full_name, e.org_title, e.photo_url, 1 AS distance
       FROM employees e
       WHERE e.manager_id = $1
         AND e.employment_status = 'Active'
         AND NOT EXISTS (SELECT 1 FROM employee_ancestors($1))
     ) opts
     ORDER BY distance, full_name`,
    [employeeId]
  );
  return rows;
}

// GET /api/verification/approvers — valid targets for my verification request.
router.get('/approvers', async (req, res, next) => {
  try {
    res.json(await approverOptions(req.user.employee_id));
  } catch (err) {
    next(err);
  }
});

// POST /api/verification/request  { approver_employee_id, message? }
router.post('/request', async (req, res, next) => {
  try {
    const me = req.user.employee_id;
    const { approver_employee_id, message } = req.body || {};

    if (!approver_employee_id) {
      return res.status(400).json({ error: 'approver_employee_id is required' });
    }
    if (approver_employee_id === me) {
      return res.status(400).json({ error: 'You cannot verify your own profile' });
    }

    // Enforced server-side, not just in the picker: the approver must be on
    // your reporting line.
    const options = await approverOptions(me);
    const approver = options.find((o) => o.id === approver_employee_id);
    if (!approver) {
      return res.status(400).json({
        error: 'You can only ask someone in your reporting line to verify your profile',
      });
    }

    const approval = await withTransaction(async (client) => {
      // One open request at a time — asking someone else supersedes the old one.
      await client.query(
        `UPDATE approvals SET status = 'Cancelled', decided_at = NOW()
          WHERE approval_type = $2 AND entity_id = $1 AND status = 'Pending'`,
        [me, APPROVAL_TYPE]
      );

      await client.query(
        Q_ENSURE_CV,
        [me]
      );
      await client.query(
        `UPDATE employee_cv
            SET verification_status = 'Pending', verified_by = NULL, verified_at = NULL
          WHERE employee_id = $1`,
        [me]
      );

      const inserted = await client.query(
        Q_INSERT_APPROVAL,
        [APPROVAL_TYPE, me, approver_employee_id]
      );
      const row = inserted.rows[0];

      await client.query(
        `INSERT INTO inbox_items
           (recipient_employee_id, item_type, title, body, related_entity_type, related_entity_id, priority)
         VALUES ($1,'Approval',$2,$3,'approval',$4,'Medium')`,
        [
          approver_employee_id,
          `Profile verification requested by ${req.user.full_name}`,
          message ||
            `${req.user.full_name} has asked you to review and verify their profile / CV details.`,
          row.id,
        ]
      );

      return row;
    });

    res.status(201).json({ ...approval, approver_name: approver.full_name });
  } catch (err) {
    next(err);
  }
});

// POST /api/verification/:id/decision  { decision: 'Approved'|'Rejected', comments? }
router.post('/:id/decision', async (req, res, next) => {
  try {
    const me = req.user.employee_id;
    const { decision, comments } = req.body || {};

    if (!['Approved', 'Rejected'].includes(decision)) {
      return res.status(400).json({ error: "decision must be 'Approved' or 'Rejected'" });
    }

    const existing = await query(
      `SELECT a.id, a.approval_type, a.approver_id, a.requested_by, a.entity_id, a.status,
              rq.full_name AS requested_by_name
       FROM approvals a
       LEFT JOIN employees rq ON rq.id = a.requested_by
       WHERE a.id = $1`,
      [req.params.id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Approval not found' });
    }

    const approval = existing.rows[0];
    if (approval.approver_id !== me) {
      return res.status(403).json({ error: 'You are not the approver for this request' });
    }
    if (approval.status !== 'Pending') {
      return res.status(409).json({ error: `This request was already ${approval.status.toLowerCase()}` });
    }

    const updated = await withTransaction(async (client) => {
      const { rows } = await client.query(
        Q_DECIDE_APPROVAL,
        [approval.id, decision, comments || null]
      );

      if (approval.approval_type === APPROVAL_TYPE) {
        await client.query(
          Q_ENSURE_CV,
          [approval.entity_id]
        );
        await client.query(
          `UPDATE employee_cv
              SET verification_status = $2, verified_by = $3, verified_at = NOW()
            WHERE employee_id = $1`,
          [approval.entity_id, decision === 'Approved' ? 'Verified' : 'Rejected', me]
        );
      }

      // Close out the approver's own inbox item for this request…
      await client.query(
        `UPDATE inbox_items SET status = 'Actioned'
          WHERE recipient_employee_id = $1 AND related_entity_id = $2`,
        [me, approval.id]
      );

      // …and tell the requester what happened.
      await client.query(
        `INSERT INTO inbox_items
           (recipient_employee_id, item_type, title, body, related_entity_type, related_entity_id, priority)
         VALUES ($1,'System Notice',$2,$3,'approval',$4,$5)`,
        [
          approval.requested_by,
          decision === 'Approved'
            ? `${req.user.full_name} verified your profile`
            : `${req.user.full_name} rejected your profile verification`,
          comments ||
            (decision === 'Approved'
              ? 'Your profile / CV details have been verified.'
              : 'Your profile / CV details were not verified. Please review and request again.'),
          approval.id,
          decision === 'Approved' ? 'Low' : 'High',
        ]
      );

      return rows[0];
    });

    res.json({ ...updated, requested_by_name: approval.requested_by_name });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
