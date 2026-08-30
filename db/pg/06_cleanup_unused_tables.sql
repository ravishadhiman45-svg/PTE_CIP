-- =============================================================
-- PTE CIP — DROP UNUSED TABLES
-- Verified against: server/src/**, client/app|components|lib/**,
--                   db/01_schema.sql views, db/03_demo_queries.sql
--
-- 18 tables below have ZERO references in API routes, ZERO in the
-- Next.js client, and ZERO in any view the app queries.
-- Children are dropped before parents, so no CASCADE is needed.
-- Run inside a transaction so you can ROLLBACK if anything trips.
--
-- This file is for an ALREADY-DEPLOYED database. 01_schema.sql and
-- 02_seed.sql have already been stripped of these 18 tables, so a
-- fresh build from those two files never creates them in the first
-- place and does not need this script.
-- =============================================================

BEGIN;

-- Surveys module — never wired to any route or page.
DROP TABLE IF EXISTS survey_answers;
DROP TABLE IF EXISTS survey_assignments;
DROP TABLE IF EXISTS survey_questions;
DROP TABLE IF EXISTS surveys;

-- Assessment campaign/template framework. The app writes skill_assessments
-- directly (employees.js) and never touches campaigns or templates.
DROP TABLE IF EXISTS assessment_questions;
DROP TABLE IF EXISTS assessment_templates;
DROP TABLE IF EXISTS assessment_assignments;
DROP TABLE IF EXISTS assessment_campaigns;

-- Talent flag signals — seeded, never read.
DROP TABLE IF EXISTS employee_talent_flags;
DROP TABLE IF EXISTS talent_flags;

-- Career tracks — roadmap.js builds its own path from job_roles.
DROP TABLE IF EXISTS career_track_roles;
DROP TABLE IF EXISTS career_tracks;

-- Evidence attachments — no upload/read path exists.
DROP TABLE IF EXISTS skill_evidence;

-- Scheduled training sessions + post-course feedback.
-- training.js only reads training_courses / course_skill_map.
DROP TABLE IF EXISTS training_feedback;
DROP TABLE IF EXISTS training_sessions;

-- Profile side-tables with no consumer. NOTE: sme_profiles and
-- mentor_profiles are NOT here — the dashboard views depend on them.
DROP TABLE IF EXISTS sme_skill_map;
DROP TABLE IF EXISTS training_coordinator_profiles;

-- Bulk-import bookkeeping — admin.js reads audit_logs only.
DROP TABLE IF EXISTS import_batches;

COMMIT;

-- =============================================================
-- OPTIONAL step 2: the two drops above leave orphaned FK columns.
-- Nothing in the codebase selects, inserts, or filters on either
-- (verified: 0 occurrences of campaign_id / session_id), and no
-- view reads them, so these ALTERs are safe. Purely cosmetic.
-- =============================================================
-- BEGIN;
-- ALTER TABLE skill_assessments    DROP COLUMN IF EXISTS campaign_id;
-- ALTER TABLE training_enrollments DROP COLUMN IF EXISTS session_id;
-- COMMIT;

-- =============================================================
-- DO NOT DROP — unused in code, but load-bearing:
--   mentor_profiles              -> v_executive_dashboard, v_mentor_dashboard
--   sme_profiles                 -> v_executive_dashboard
--   technical_support_requests   -> v_mentor_dashboard
--   organizations                -> FK parent of locations (used)
--   business_units               -> FK parent of departments (used)
-- =============================================================
