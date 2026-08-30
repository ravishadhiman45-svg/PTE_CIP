-- =============================================================
-- PTE CIP — LEARNING MODULE (profile tab)
-- Additive migration. Safe to re-run (idempotent).
-- Run this in the Supabase SQL Editor after 12_tree_sort_key.sql.
--
-- Makes employee_certifications the single list behind the profile's Learning
-- Module tab. A row either points at the internal `certifications` catalogue —
-- keeping the status / approved_by the approvals flow gave it — or is a
-- free-form entry the employee typed in for themselves (an AWS badge, a PMP, a
-- vendor course), which the app had no way to record at all until now.
--
-- No new table: a second one would have to be UNIONed into the profile query,
-- the learning timeline, the org-wide tracker, v_executive_dashboard,
-- executive_dashboard() and the CV PDF, all to hold the same five dates. The
-- tab shows one list, so this is one table.
--
-- Note: employee_certifications CASCADEs from employees, but Supabase Storage
-- does not — deleting an employee leaves their certificate files behind. Same
-- pre-existing gap profile pictures have; not addressed here.
-- =============================================================

-- A free-form entry has no catalogue row to point at.
ALTER TABLE employee_certifications ALTER COLUMN certification_id DROP NOT NULL;

-- Everything a typed-in certificate carries. All nullable: every catalogue-
-- linked row already in the table stays valid with all of them empty.
ALTER TABLE employee_certifications ADD COLUMN IF NOT EXISTS title_text     TEXT;
ALTER TABLE employee_certifications ADD COLUMN IF NOT EXISTS issuer         TEXT;
ALTER TABLE employee_certifications ADD COLUMN IF NOT EXISTS technology     TEXT;
ALTER TABLE employee_certifications ADD COLUMN IF NOT EXISTS institution    TEXT;
ALTER TABLE employee_certifications ADD COLUMN IF NOT EXISTS credential_id  TEXT;
ALTER TABLE employee_certifications ADD COLUMN IF NOT EXISTS credential_url TEXT;
ALTER TABLE employee_certifications ADD COLUMN IF NOT EXISTS hours          NUMERIC(6,2);
ALTER TABLE employee_certifications ADD COLUMN IF NOT EXISTS notes          TEXT;

-- evidence_file_url (declared in 01_schema.sql, never written until now) is what
-- the browser opens. evidence_path is what Supabase Storage deletes — the object
-- path cannot be parsed back out of a public url once the bucket or project
-- changes, and replacing a certificate has to remove the file it replaced.
ALTER TABLE employee_certifications ADD COLUMN IF NOT EXISTS evidence_path  TEXT;
ALTER TABLE employee_certifications ADD COLUMN IF NOT EXISTS created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Where the row came from. 'Catalog' is the default so every row that already
-- exists keeps reading as the org-issued thing it is.
ALTER TABLE employee_certifications ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'Catalog';
ALTER TABLE employee_certifications DROP CONSTRAINT IF EXISTS employee_certifications_source_check;
ALTER TABLE employee_certifications ADD CONSTRAINT employee_certifications_source_check
  CHECK (source IN ('Catalog','Self'));

-- 'Self-Reported' joins the status list, and is deliberately NOT 'Approved':
-- v_executive_dashboard (01_schema.sql) and executive_dashboard()
-- (09_scoped_analytics.sql) both count status='Approved' as "certified
-- employees", and a self-typed row must not inflate that. statusClasses() in
-- client/lib/ui.js has no entry for it either, so it renders as a neutral slate
-- chip beside the green Approved ones — which is exactly the visual difference
-- between "the organisation issued this" and "I typed this in".
ALTER TABLE employee_certifications DROP CONSTRAINT IF EXISTS employee_certifications_status_check;
ALTER TABLE employee_certifications ADD CONSTRAINT employee_certifications_status_check
  CHECK (status IN ('Requested','Approved','Denied','Expired','Renewal Due','Self-Reported'));

-- A row has to be identifiable as something.
ALTER TABLE employee_certifications DROP CONSTRAINT IF EXISTS employee_certifications_titled_check;
ALTER TABLE employee_certifications ADD CONSTRAINT employee_certifications_titled_check
  CHECK (certification_id IS NOT NULL OR btrim(COALESCE(title_text,'')) <> '');

-- UNIQUE(employee_id, certification_id, issued_date) is left alone. It still
-- stops the approvals flow issuing the same catalogue certification twice on one
-- date; NULLs are distinct in a Postgres unique index, so free-form rows never
-- trip it — two typed "AWS SAA" entries from different years are two records.

CREATE INDEX IF NOT EXISTS idx_employee_certifications_employee
  ON employee_certifications(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_certifications_expiry
  ON employee_certifications(expiry_date) WHERE expiry_date IS NOT NULL;
