-- =============================================================
-- PTE CIP — STARTER COURSE FOR EVERY EMPLOYEE
-- Additive migration. Safe to re-run (idempotent).
-- Run after 14_module_progress.sql.
--
-- Nothing in the app can create a training_enrollments row yet: enrolment and
-- nomination have no UI, so the Learning Module page is empty for everyone
-- except the four people 02_seed.sql happened to enrol. This gives every
-- employee one real course to work through so the page has something to show.
--
-- Fixed UUIDs throughout, so re-running updates the same rows instead of
-- creating a second copy of the course.
--
-- Remove later with:
--   DELETE FROM training_enrollments WHERE course_id = '00000000-0000-0000-0000-0000000029f1';
--   DELETE FROM training_courses     WHERE id        = '00000000-0000-0000-0000-0000000029f1';
-- (course_modules and enrollment_module_progress cascade.)
-- =============================================================

-- Cover art for the catalogue. Nullable: courses without one fall back to
-- generated cover art in the client, so this never shows a broken image.
ALTER TABLE training_courses ADD COLUMN IF NOT EXISTS cover_image_url TEXT;

-- -----------------------------
-- The course
-- -----------------------------
INSERT INTO training_courses
  (id, course_code, title, description, course_type, delivery_mode,
   duration_hours, difficulty, status, cover_image_url)
VALUES (
  '00000000-0000-0000-0000-0000000029f1',
  'PTE-ONB-101',
  'Capability Platform Essentials',
  'How capability works at PTE: rating your own skills honestly, keeping your profile and CV current, recording certificates, and using your learning plan. Start here.',
  'Course',
  'Self Paced',
  2.5,
  'Foundation',
  'Published',
  NULL
)
ON CONFLICT (id) DO UPDATE SET
  title           = EXCLUDED.title,
  description     = EXCLUDED.description,
  duration_hours  = EXCLUDED.duration_hours,
  difficulty      = EXCLUDED.difficulty,
  status          = EXCLUDED.status;

-- -----------------------------
-- Its modules
-- -----------------------------
INSERT INTO course_modules (id, course_id, module_order, module_title, module_description, duration_minutes)
VALUES
  ('00000000-0000-0000-0000-0000000029a1', '00000000-0000-0000-0000-0000000029f1', 1,
   'Skills and capability levels',
   'What L1 to L5 mean, and how self, manager and mentor ratings combine into your effective level.', 30),
  ('00000000-0000-0000-0000-0000000029a2', '00000000-0000-0000-0000-0000000029f1', 2,
   'Building your profile',
   'Summary, experience and education — what a reviewer looks for before verifying a profile.', 40),
  ('00000000-0000-0000-0000-0000000029a3', '00000000-0000-0000-0000-0000000029f1', 3,
   'Recording certificates',
   'Adding a certificate, attaching the certificate file, and what Self-Reported means on your CV.', 35),
  ('00000000-0000-0000-0000-0000000029a4', '00000000-0000-0000-0000-0000000029f1', 4,
   'Your learning plan',
   'Working through modules, and using the plan board to line up what you take on next.', 45)
ON CONFLICT (id) DO UPDATE SET
  module_title       = EXCLUDED.module_title,
  module_description = EXCLUDED.module_description,
  duration_minutes   = EXCLUDED.duration_minutes;

-- -----------------------------
-- Deliberately NOT mapped to any skill.
--
-- An earlier version of this file mapped the two alphabetically-first rows in
-- `skills`, which had it claiming to build "Automotive Cybersecurity Basics".
-- course_skill_map feeds the gap analytics and role-readiness views, so a made-up
-- mapping does not just look odd, it moves real numbers. This course teaches
-- people how to use the platform; it builds no engineering capability.
--
-- Clears the mapping if a previous run of this file inserted one.
-- -----------------------------
DELETE FROM course_skill_map WHERE course_id = '00000000-0000-0000-0000-0000000029f1';

-- -----------------------------
-- Enrol everyone
--
-- 'Approved', not 'Nominated': sync_enrollment_progress() deliberately refuses
-- to advance an enrolment that is still waiting on an approver, so a Nominated
-- starter course would let people tick modules while the card stayed stuck at
-- Nominated. Nobody needs approval to read the onboarding material.
--
-- ON CONFLICT on the natural key, so re-running never duplicates and never
-- resets progress for anyone who has already started it.
-- -----------------------------
INSERT INTO training_enrollments (course_id, employee_id, status, progress_percent, enrolled_at)
SELECT '00000000-0000-0000-0000-0000000029f1', e.id, 'Approved', 0, NOW()
FROM employees e
ON CONFLICT (course_id, employee_id) DO NOTHING;

-- -----------------------------
-- Put it on everyone's plan board too, so both views have content.
-- learning_plan_items has no unique constraint on (employee_id, course_id),
-- so the NOT EXISTS is what makes this re-runnable.
-- -----------------------------
INSERT INTO learning_plan_items (employee_id, course_id, status, priority, progress_percent, notes)
SELECT e.id, '00000000-0000-0000-0000-0000000029f1', 'To Do', 'High', 0, 'Start here'
FROM employees e
WHERE NOT EXISTS (
  SELECT 1 FROM learning_plan_items lpi
  WHERE lpi.employee_id = e.id
    AND lpi.course_id = '00000000-0000-0000-0000-0000000029f1'
);
