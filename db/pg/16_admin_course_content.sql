-- =============================================================
-- PTE CIP — ADMIN COURSE CONTENT MANAGEMENT
-- Additive migration. Safe to re-run (idempotent).
-- Run in the Supabase SQL Editor after 15_sample_course.sql.
--
-- Enables admin to create/manage courses with dynamic content (video, PDF,
-- image, text, link) that automatically appears in the Learning Module.
-- =============================================================

-- Extend training_courses with fields for admin-created courses
ALTER TABLE training_courses ADD COLUMN IF NOT EXISTS short_description TEXT;
ALTER TABLE training_courses ADD COLUMN IF NOT EXISTS cover_image_url TEXT;
ALTER TABLE training_courses ADD COLUMN IF NOT EXISTS thumbnail_path TEXT;
ALTER TABLE training_courses ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE training_courses ADD COLUMN IF NOT EXISTS instructor_name TEXT;
ALTER TABLE training_courses ADD COLUMN IF NOT EXISTS is_admin_created BOOLEAN NOT NULL DEFAULT FALSE;

-- Course content items (lessons/modules with actual content)
-- Replaces static course_modules with rich, typed content
CREATE TABLE IF NOT EXISTS course_content_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES training_courses(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK (content_type IN ('video','image','pdf','text','link')),
  title TEXT NOT NULL,
  description TEXT,
  display_order INT NOT NULL,
  
  -- Video content
  video_url TEXT,
  video_file_path TEXT,
  
  -- Image content
  image_url TEXT,
  image_file_path TEXT,
  
  -- PDF content
  pdf_url TEXT,
  pdf_file_path TEXT,
  
  -- Text/rich content
  text_content TEXT,
  
  -- External link
  external_url TEXT,
  
  duration_minutes INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(course_id, display_order)
);

CREATE INDEX IF NOT EXISTS idx_course_content_items_course
  ON course_content_items(course_id);
CREATE INDEX IF NOT EXISTS idx_course_content_items_order
  ON course_content_items(course_id, display_order);

DROP TRIGGER IF EXISTS trg_course_content_items_updated_at ON course_content_items;
CREATE TRIGGER trg_course_content_items_updated_at 
  BEFORE UPDATE ON course_content_items 
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Track completion of content items (replaces enrollment_module_progress)
CREATE TABLE IF NOT EXISTS content_item_progress (
  enrollment_id UUID NOT NULL REFERENCES training_enrollments(id) ON DELETE CASCADE,
  content_item_id UUID NOT NULL REFERENCES course_content_items(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (enrollment_id, content_item_id)
);

CREATE INDEX IF NOT EXISTS idx_content_item_progress_enrollment
  ON content_item_progress(enrollment_id);

-- Admin-created courses are available directly to employees and do not need
-- a legacy training_enrollments row before their content can be completed.
CREATE TABLE IF NOT EXISTS employee_content_progress (
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  content_item_id UUID NOT NULL REFERENCES course_content_items(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (employee_id, content_item_id)
);

CREATE INDEX IF NOT EXISTS idx_employee_content_progress_employee
  ON employee_content_progress(employee_id);

-- Recompute course progress from completed content items
CREATE OR REPLACE FUNCTION sync_content_progress(p_enrollment_id UUID)
RETURNS INT AS $$
DECLARE
  total      INT;
  done       INT;
  pct        INT;
  cur_status TEXT;
  new_status TEXT;
BEGIN
  -- Count total content items for this course
  SELECT count(*) INTO total
    FROM course_content_items cci
    JOIN training_enrollments te ON te.course_id = cci.course_id
   WHERE te.id = p_enrollment_id;

  -- No content items: fall back to module-based or leave alone
  IF total = 0 THEN
    RETURN NULL;
  END IF;

  -- Count completed content items
  SELECT count(*) INTO done
    FROM content_item_progress
   WHERE enrollment_id = p_enrollment_id;

  SELECT status INTO cur_status FROM training_enrollments WHERE id = p_enrollment_id;
  pct := ROUND((done::numeric / total) * 100);

  -- Only update lifecycle for approved enrollments
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
         completed_at = CASE WHEN new_status = 'Completed' THEN COALESCE(completed_at, NOW())
                             ELSE NULL END
   WHERE id = p_enrollment_id;

  RETURN pct;
END;
$$ LANGUAGE plpgsql;
