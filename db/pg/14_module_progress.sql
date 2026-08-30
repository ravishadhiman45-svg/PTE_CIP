-- =============================================================
-- PTE CIP — PER-MODULE PROGRESS (Learning Module page)
-- Additive migration. Safe to re-run (idempotent).
-- Run in the Supabase SQL Editor after 13_learning_module.sql.
--
-- course_modules has always held the module breakdown of every course, but
-- nothing recorded which of them a person had actually done: training_enrollments
-- stores one progress_percent for the whole course. The Learning Module page
-- ticks modules off individually, so it needs a row per (enrollment, module).
--
-- progress_percent on training_enrollments stays the number of record — it is
-- what the dashboards, the Kanban and the CV read. Ticking a module recomputes
-- it from the ticked share of that course's modules, so the two never disagree.
-- Courses with no modules keep whatever percent was set by other means.
-- =============================================================

CREATE TABLE IF NOT EXISTS enrollment_module_progress (
  enrollment_id UUID NOT NULL REFERENCES training_enrollments(id) ON DELETE CASCADE,
  module_id     UUID NOT NULL REFERENCES course_modules(id) ON DELETE CASCADE,
  completed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (enrollment_id, module_id)
);

CREATE INDEX IF NOT EXISTS idx_enrollment_module_progress_enrollment
  ON enrollment_module_progress(enrollment_id);

-- Recompute a course's percent from its ticked modules, and move the enrollment
-- through its own lifecycle: first tick starts it, the last one finishes it.
-- Kept in SQL rather than the route so the number cannot drift if anything else
-- ever writes to this table.
CREATE OR REPLACE FUNCTION sync_enrollment_progress(p_enrollment_id UUID)
RETURNS INT AS $$
DECLARE
  total      INT;
  done       INT;
  pct        INT;
  cur_status TEXT;
  new_status TEXT;
BEGIN
  SELECT count(*) INTO total
    FROM course_modules cm
    JOIN training_enrollments te ON te.course_id = cm.course_id
   WHERE te.id = p_enrollment_id;

  -- No modules defined: nothing to derive from, leave the course alone.
  IF total = 0 THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO done
    FROM enrollment_module_progress
   WHERE enrollment_id = p_enrollment_id;

  SELECT status INTO cur_status FROM training_enrollments WHERE id = p_enrollment_id;
  pct := ROUND((done::numeric / total) * 100);

  -- Only an enrolment that has actually been approved moves through its own
  -- lifecycle. 'Nominated' is still waiting on an approver, and 'Rejected' /
  -- 'Cancelled' / 'Expired' were closed deliberately — ticking a module must not
  -- overrule either, or someone could mark themselves Completed on a course
  -- nobody approved them to take. The percent is still recorded either way.
  IF cur_status IN ('Approved','In Progress','Completed') THEN
    new_status := CASE WHEN pct = 100 THEN 'Completed'
                       WHEN pct > 0   THEN 'In Progress'
                       ELSE cur_status END;
  ELSE
    new_status := cur_status;
  END IF;

  UPDATE training_enrollments
     SET progress_percent = pct,
         status = new_status,
         -- Tied to the status that actually results, so a course held at
         -- 'Nominated' never picks up a completion date, and un-ticking a
         -- module clears the one it had.
         completed_at = CASE WHEN new_status = 'Completed' THEN COALESCE(completed_at, NOW())
                             ELSE NULL END
   WHERE id = p_enrollment_id;

  RETURN pct;
END;
$$ LANGUAGE plpgsql;
