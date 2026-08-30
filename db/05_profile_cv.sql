-- =============================================================
-- PTE CIP — PROFILE / CV + VERIFICATION
-- Additive migration. Safe to re-run (idempotent).
-- Run this in the Supabase SQL Editor after 01_schema.sql / 02_seed.sql.
--
-- Adds:
--   * employee_cv          — 1:1 hand-typed CV header + verification state
--   * employee_experience  — work history rows
--   * employee_education   — education rows
--   * 'Profile Verification' as an allowed approvals.approval_type
--
-- The three tables are also in 01_schema.sql now, defined identically, so a
-- fresh build already has them and every CREATE below is a no-op. This file is
-- only needed by databases built before they were folded into 01.
--
-- Skills typed in by an employee reuse the existing tables
-- (employee_skill_assignments + skill_assessments with assessor_type 'Self'),
-- so v_employee_skill_matrix / the Skills Passport pick them up for free.
-- =============================================================

-- -----------------------------
-- CV header (one row per employee)
-- -----------------------------
CREATE TABLE IF NOT EXISTS employee_cv (
  employee_id UUID PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  headline TEXT,
  summary TEXT,
  phone TEXT,
  location_text TEXT,
  linkedin_url TEXT,
  verification_status TEXT NOT NULL DEFAULT 'Draft'
    CHECK (verification_status IN ('Draft','Pending','Verified','Rejected')),
  verified_by UUID REFERENCES employees(id),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_employee_cv_updated_at ON employee_cv;
CREATE TRIGGER trg_employee_cv_updated_at BEFORE UPDATE ON employee_cv
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------
-- Experience (work history)
-- -----------------------------
CREATE TABLE IF NOT EXISTS employee_experience (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  organization TEXT,
  start_date DATE,
  end_date DATE,                -- NULL = currently in this role
  description TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_employee_experience_employee ON employee_experience(employee_id);

-- -----------------------------
-- Education
-- -----------------------------
CREATE TABLE IF NOT EXISTS employee_education (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  degree TEXT NOT NULL,
  institution TEXT,
  field_of_study TEXT,
  start_year INT,
  end_year INT,
  grade TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_employee_education_employee ON employee_education(employee_id);

-- -----------------------------
-- Allow the new approval type.
-- The original inline CHECK is auto-named approvals_approval_type_check.
-- -----------------------------
ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_approval_type_check;
ALTER TABLE approvals ADD CONSTRAINT approvals_approval_type_check
  CHECK (approval_type IN (
    'Training Nomination',
    'Certification',
    'Skill Level',
    'Course Publish',
    'Mentor Recommendation',
    'Profile Verification'
  ));

-- Index the approver's pending queue (inbox / approvals list).
CREATE INDEX IF NOT EXISTS idx_approvals_approver_status ON approvals(approver_id, status);
CREATE INDEX IF NOT EXISTS idx_approvals_entity ON approvals(entity_type, entity_id);

-- -----------------------------
-- Persona role backfill.
-- Adding an employee is now open to admin / executive / department_head, but
-- databases seeded before the "extra persona role mappings" block in
-- 02_seed.sql have no department_head mapping at all — so the Department Head
-- persona (Neha Verma) would still be refused. Same statement as the seed.
-- -----------------------------
INSERT INTO user_permission_role_map (user_id, permission_role_id)
SELECT au.id, pr.id
FROM app_users au
JOIN employees e ON e.id = au.employee_id
JOIN app_permission_roles pr ON pr.role_key = 'department_head'
WHERE e.id = '00000000-0000-0000-0000-000000000602'
ON CONFLICT DO NOTHING;
