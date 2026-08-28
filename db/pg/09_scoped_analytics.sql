-- =============================================================
-- PTE CIP — SUBTREE-SCOPED ANALYTICS
-- Additive migration. Safe to re-run (idempotent).
-- Run after 07_org_hierarchy.sql / 08_org_seed.sql.
--
-- v_executive_dashboard (01_schema.sql:585-594) is eight scalar subqueries with
-- no employee_id column, so unlike the other analytics views it cannot simply be
-- filtered by the caller — every viewer got org-wide counts. This replaces it
-- with a function that takes the viewer and scopes each employee-keyed subquery
-- through the same visible_employee_ids() predicate the rest of the API uses.
--
-- The view is deliberately LEFT IN PLACE: it is the "whole organization" figure
-- and is still the right thing for an unscoped report. Nothing in the API reads
-- it any more.
--
-- Catalog-level counts (how many skills exist, how many are critical) stay
-- global on purpose. They describe the skills library, not people, so scoping
-- them would be meaningless rather than safer.
-- =============================================================

CREATE OR REPLACE FUNCTION executive_dashboard(
  p_viewer UUID,
  p_is_admin BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  total_employees BIGINT,
  strategic_skills BIGINT,
  certified_employees BIGINT,
  active_mentors BIGINT,
  identified_smes BIGINT,
  critical_skill_count BIGINT,
  average_role_readiness_percent NUMERIC,
  average_training_progress_percent NUMERIC
)
LANGUAGE sql STABLE AS $$
  WITH scope AS (
    SELECT employee_id FROM visible_employee_ids(p_viewer, p_is_admin)
  )
  SELECT
    (SELECT COUNT(*) FROM employees e
       JOIN scope v ON v.employee_id = e.id
      WHERE e.employment_status = 'Active'),
    (SELECT COUNT(*) FROM skills WHERE active = TRUE),
    (SELECT COUNT(*) FROM employee_certifications ec
       JOIN scope v ON v.employee_id = ec.employee_id
      WHERE ec.status = 'Approved'),
    (SELECT COUNT(*) FROM mentor_profiles mp
       JOIN scope v ON v.employee_id = mp.employee_id
      WHERE mp.mentor_status = 'Active'),
    (SELECT COUNT(*) FROM sme_profiles sp
       JOIN scope v ON v.employee_id = sp.employee_id
      WHERE sp.active = TRUE),
    (SELECT COUNT(*) FROM skills WHERE criticality IN ('High','Critical')),
    (SELECT ROUND(AVG(r.readiness_percent), 1) FROM v_role_readiness r
       JOIN scope v ON v.employee_id = r.employee_id),
    (SELECT ROUND(AVG(te.progress_percent), 1) FROM training_enrollments te
       JOIN scope v ON v.employee_id = te.employee_id);
$$;
