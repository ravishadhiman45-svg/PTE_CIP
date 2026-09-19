-- =============================================================
-- PTE CIP — ADMIN COURSE CONTENT MANAGEMENT (SQL Server)
-- Additive migration. Safe to re-run (idempotent).
-- Run after 14_module_progress.sql.
--
-- Enables admin to create/manage courses with dynamic content (video, PDF,
-- image, text, link) that automatically appears in the Learning Module.
-- =============================================================
-- Extend training_courses with fields for admin-created courses
IF NOT EXISTS (SELECT 1
               FROM   sys.columns
               WHERE  object_id = OBJECT_ID('training_courses')
                      AND name = 'short_description')
  ALTER TABLE training_courses
    ADD short_description NVARCHAR (MAX);

IF NOT EXISTS (SELECT 1
               FROM   sys.columns
               WHERE  object_id = OBJECT_ID('training_courses')
                      AND name = 'cover_image_url')
  ALTER TABLE training_courses
    ADD cover_image_url NVARCHAR (MAX);

IF NOT EXISTS (SELECT 1
               FROM   sys.columns
               WHERE  object_id = OBJECT_ID('training_courses')
                      AND name = 'thumbnail_path')
  ALTER TABLE training_courses
    ADD thumbnail_path NVARCHAR (MAX);

IF NOT EXISTS (SELECT 1
               FROM   sys.columns
               WHERE  object_id = OBJECT_ID('training_courses')
                      AND name = 'category')
  ALTER TABLE training_courses
    ADD category NVARCHAR (255);

IF NOT EXISTS (SELECT 1
               FROM   sys.columns
               WHERE  object_id = OBJECT_ID('training_courses')
                      AND name = 'instructor_name')
  ALTER TABLE training_courses
    ADD instructor_name NVARCHAR (255);

IF NOT EXISTS (SELECT 1
               FROM   sys.columns
               WHERE  object_id = OBJECT_ID('training_courses')
                      AND name = 'is_admin_created')
  ALTER TABLE training_courses
    ADD is_admin_created BIT DEFAULT 0 NOT NULL;


GO
-- Course content items (lessons/modules with actual content)
IF OBJECT_ID('dbo.course_content_items', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.course_content_items (
      id               UNIQUEIDENTIFIER DEFAULT NEWID() PRIMARY KEY,
      course_id        UNIQUEIDENTIFIER NOT NULL FOREIGN KEY REFERENCES training_courses (id) ON DELETE CASCADE,
      content_type     NVARCHAR (50)    NOT NULL CHECK (content_type IN ('video', 'image', 'pdf', 'text', 'link')),
      title            NVARCHAR (500)   NOT NULL,
      description      NVARCHAR (MAX)  ,
      display_order    INT              NOT NULL,
      -- Video content
      video_url        NVARCHAR (MAX)  ,
      video_file_path  NVARCHAR (MAX)  ,
      -- Image content
      image_url        NVARCHAR (MAX)  ,
      image_file_path  NVARCHAR (MAX)  ,
      -- PDF content
      pdf_url          NVARCHAR (MAX)  ,
      pdf_file_path    NVARCHAR (MAX)  ,
      -- Text/rich content
      text_content     NVARCHAR (MAX)  ,
      -- External link
      external_url     NVARCHAR (MAX)  ,
      duration_minutes INT             ,
      created_at       DATETIMEOFFSET   DEFAULT SYSDATETIMEOFFSET() NOT NULL,
      updated_at       DATETIMEOFFSET   DEFAULT SYSDATETIMEOFFSET() NOT NULL,
      UNIQUE (course_id, display_order)
    );
    CREATE INDEX idx_course_content_items_course
      ON course_content_items(course_id);
    CREATE INDEX idx_course_content_items_order
      ON course_content_items(course_id, display_order);
  END


GO
-- Admin-created courses are available directly to employees and do not need
-- a legacy training_enrollments row before their content can be completed.
IF OBJECT_ID('dbo.employee_content_progress', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.employee_content_progress (
      employee_id     UNIQUEIDENTIFIER NOT NULL FOREIGN KEY REFERENCES employees (id) ON DELETE CASCADE,
      content_item_id UNIQUEIDENTIFIER NOT NULL FOREIGN KEY REFERENCES course_content_items (id) ON DELETE CASCADE,
      completed_at    DATETIMEOFFSET   DEFAULT SYSDATETIMEOFFSET() NOT NULL,
      PRIMARY KEY (employee_id, content_item_id)
    );
    CREATE INDEX idx_employee_content_progress_employee
      ON employee_content_progress(employee_id);
  END


GO
-- Track completion of content items
IF OBJECT_ID('dbo.content_item_progress', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.content_item_progress (
      enrollment_id   UNIQUEIDENTIFIER NOT NULL FOREIGN KEY REFERENCES training_enrollments (id) ON DELETE CASCADE,
      content_item_id UNIQUEIDENTIFIER NOT NULL FOREIGN KEY REFERENCES course_content_items (id) ON DELETE CASCADE,
      completed_at    DATETIMEOFFSET   DEFAULT SYSDATETIMEOFFSET() NOT NULL,
      PRIMARY KEY (enrollment_id, content_item_id)
    );
    CREATE INDEX idx_content_item_progress_enrollment
      ON content_item_progress(enrollment_id);
  END


GO
-- Recompute course progress from completed content items
IF OBJECT_ID('dbo.sync_content_progress', 'P') IS NOT NULL
  DROP PROCEDURE dbo.sync_content_progress;


GO
CREATE PROCEDURE dbo.sync_content_progress
@enrollment_id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @total AS INT;
  DECLARE @done AS INT;
  DECLARE @pct AS INT;
  DECLARE @cur_status AS NVARCHAR (50);
  DECLARE @new_status AS NVARCHAR (50);
  -- Count total content items for this course
  SELECT @total = count(*)
  FROM   course_content_items AS cci
         INNER JOIN
         training_enrollments AS te
         ON te.course_id = cci.course_id
  WHERE  te.id = @enrollment_id;
  -- No content items: return NULL
  IF @total = 0
    RETURN NULL;
  -- Count completed content items
  SELECT @done = count(*)
  FROM   content_item_progress
  WHERE  enrollment_id = @enrollment_id;
  SELECT @cur_status = status
  FROM   training_enrollments
  WHERE  id = @enrollment_id;
  SET @pct = ROUND((@done * 100.0) / @total, 0);
  -- Only update lifecycle for approved enrollments
  IF @cur_status IN ('Approved', 'In Progress', 'Completed')
    BEGIN
      SET @new_status = CASE WHEN @pct = 100 THEN 'Completed' WHEN @pct > 0 THEN 'In Progress' ELSE @cur_status END;
    END
  ELSE
    BEGIN
      SET @new_status = @cur_status;
    END
  UPDATE training_enrollments
  SET    progress_percent = @pct,
         status           = @new_status,
         completed_at     = CASE WHEN @new_status = 'Completed' THEN COALESCE (completed_at, SYSDATETIMEOFFSET()) ELSE NULL END
  WHERE  id = @enrollment_id;
  RETURN @pct;
END