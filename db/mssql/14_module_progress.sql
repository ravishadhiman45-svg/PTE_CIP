SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- =============================================================
-- PTE CIP — PER-MODULE PROGRESS (Learning Module page) — SQL Server
--
-- Port of db/pg/14_module_progress.sql. Additive, idempotent.
-- Run after 13_learning_module.sql.
--
-- course_modules has always held the module breakdown of every course, but
-- nothing recorded which of them a person had actually done: training_enrollments
-- stores one progress_percent for the whole course. The Learning Module page
-- ticks modules off individually, so it needs a row per (enrollment, module).
--
-- progress_percent on training_enrollments stays the number of record — it is
-- what the dashboards, the Kanban and the CV read.
-- =============================================================

-- ---------------------------------------------------------------
-- One deliberate divergence from db/pg/14, in the module_id foreign key.
--
-- The Postgres table cascades on BOTH columns. SQL Server will not accept that
-- here: training_courses already cascades to training_enrollments AND to
-- course_modules, so declaring a second cascade into this table creates two
-- cascade paths from one origin table, which is error 1785 at CREATE time.
--
-- enrollment_id keeps the cascade — dropping an enrolment must take its ticks
-- with it, or re-enrolling would inherit a stranger's progress. module_id is
-- left as NO ACTION, so on SQL Server deleting a course_modules row that has
-- ticks against it is REFUSED rather than silently cascading.
--
-- Nothing in the API deletes courses, modules or enrolments — grep the server
-- for `DELETE FROM training_courses` and there is no hit — so this divergence is
-- only reachable from a manual catalogue cleanup, where being told about the
-- dependent rows is arguably the better behaviour anyway. Delete the progress
-- rows first if you hit it.
-- ---------------------------------------------------------------
IF OBJECT_ID('dbo.enrollment_module_progress', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.enrollment_module_progress (
    enrollment_id UNIQUEIDENTIFIER NOT NULL
      REFERENCES training_enrollments(id) ON DELETE CASCADE,
    module_id     UNIQUEIDENTIFIER NOT NULL
      REFERENCES course_modules(id),
    completed_at  DATETIMEOFFSET NOT NULL DEFAULT SYSUTCDATETIME(),
    PRIMARY KEY (enrollment_id, module_id)
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
                WHERE name = 'idx_enrollment_module_progress_enrollment'
                  AND object_id = OBJECT_ID('dbo.enrollment_module_progress'))
  CREATE INDEX idx_enrollment_module_progress_enrollment
    ON dbo.enrollment_module_progress(enrollment_id);
GO

-- ---------------------------------------------------------------
-- Recompute a course's percent from its ticked modules, and move the enrollment
-- through its own lifecycle: first tick starts it, the last one finishes it.
-- Kept in SQL rather than the route so the number cannot drift if anything else
-- ever writes to this table.
--
-- A PROCEDURE, not a function. The Postgres original is a plpgsql FUNCTION that
-- performs an UPDATE; a T-SQL scalar function cannot do DML at all, so there is
-- no function form of this. routes/learningModule.js knows about the split and
-- calls `EXEC dbo.sync_enrollment_progress` on this dialect (Q_SYNC_PROGRESS).
--
-- The Postgres function returns the new percent; no caller reads it, so nothing
-- is lost by the procedure not having a return value.
-- ---------------------------------------------------------------
IF OBJECT_ID('dbo.sync_enrollment_progress', 'P') IS NOT NULL
  DROP PROCEDURE dbo.sync_enrollment_progress;
GO
CREATE PROCEDURE dbo.sync_enrollment_progress
  @p_enrollment_id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @total INT, @done INT, @pct INT;
  DECLARE @cur_status NVARCHAR(450), @new_status NVARCHAR(450);

  SELECT @total = count(*)
    FROM dbo.course_modules cm
    JOIN dbo.training_enrollments te ON te.course_id = cm.course_id
   WHERE te.id = @p_enrollment_id;

  -- No modules defined: nothing to derive from, leave the course alone.
  IF @total = 0 RETURN;

  SELECT @done = count(*)
    FROM dbo.enrollment_module_progress
   WHERE enrollment_id = @p_enrollment_id;

  SELECT @cur_status = status FROM dbo.training_enrollments WHERE id = @p_enrollment_id;

  -- The DECIMAL cast is what stops integer division truncating to 0 or 1 before
  -- the multiply, exactly as ::numeric does on the Postgres side.
  SET @pct = ROUND((CAST(@done AS DECIMAL(10,4)) / @total) * 100, 0);

  -- Only an enrolment that has actually been approved moves through its own
  -- lifecycle. 'Nominated' is still waiting on an approver, and 'Rejected' /
  -- 'Cancelled' / 'Expired' were closed deliberately — ticking a module must not
  -- overrule either, or someone could mark themselves Completed on a course
  -- nobody approved them to take. The percent is still recorded either way.
  IF @cur_status IN ('Approved','In Progress','Completed')
    SET @new_status = CASE WHEN @pct = 100 THEN 'Completed'
                           WHEN @pct > 0   THEN 'In Progress'
                           ELSE @cur_status END;
  ELSE
    SET @new_status = @cur_status;

  UPDATE dbo.training_enrollments
     SET progress_percent = @pct,
         status = @new_status,
         -- Tied to the status that actually results, so a course held at
         -- 'Nominated' never picks up a completion date, and un-ticking a
         -- module clears the one it had.
         completed_at = CASE WHEN @new_status = 'Completed'
                             THEN COALESCE(completed_at, SYSUTCDATETIME())
                             ELSE NULL END
   WHERE id = @p_enrollment_id;
END
GO
