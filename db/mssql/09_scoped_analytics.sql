-- =============================================================
-- PTE CIP — SUBTREE-SCOPED ANALYTICS (SQL Server)
--
-- Port of db/pg/09_scoped_analytics.sql. Idempotent.
-- Run after 01_schema.sql / 07_org_hierarchy.sql / 08_org_seed.
--
-- v_executive_dashboard is eight scalar subqueries with no employee_id column,
-- so unlike the other analytics views it cannot be filtered by the caller —
-- every viewer got org-wide counts. This replaces it with a function that takes
-- the viewer and scopes each employee-keyed subquery through the same
-- visible_employee_ids() predicate the rest of the API uses.
--
-- The view is deliberately LEFT IN PLACE: it is the "whole organization" figure
-- and is still the right thing for an unscoped report. Nothing in the API reads
-- it any more.
--
-- Catalog-level counts (how many skills exist, how many are critical) stay
-- global on purpose. They describe the skills library, not people, so scoping
-- them would be meaningless rather than safer.
-- =============================================================

-- An inline TVF calling another inline TVF, which T-SQL handles fine and inlines
-- into the caller's plan.
--
-- Two dialect notes:
--   * The Postgres version declares RETURNS TABLE (... BIGINT, ... NUMERIC) and
--     relies on the body matching. An inline TVF infers its shape from the
--     SELECT, so the column names are supplied by aliases instead — and they
--     must match what routes/dashboard.js reads.
--   * AVG over an integer column does INTEGER division in T-SQL exactly as in
--     Postgres, so the CASTs to decimal are load-bearing, not decoration.
--     Without them every average would come back whole.
CREATE OR ALTER FUNCTION dbo.executive_dashboard(
  @p_viewer UNIQUEIDENTIFIER,
  @p_is_admin BIT
)
RETURNS TABLE
AS RETURN
(
  SELECT
    (SELECT COUNT(*) FROM dbo.employees e
       JOIN dbo.visible_employee_ids(@p_viewer, @p_is_admin) v ON v.employee_id = e.id
      WHERE e.employment_status = 'Active') AS total_employees,

    (SELECT COUNT(*) FROM dbo.skills WHERE active = 1) AS strategic_skills,

    (SELECT COUNT(*) FROM dbo.employee_certifications ec
       JOIN dbo.visible_employee_ids(@p_viewer, @p_is_admin) v ON v.employee_id = ec.employee_id
      WHERE ec.status = 'Approved') AS certified_employees,

    (SELECT COUNT(*) FROM dbo.mentor_profiles mp
       JOIN dbo.visible_employee_ids(@p_viewer, @p_is_admin) v ON v.employee_id = mp.employee_id
      WHERE mp.mentor_status = 'Active') AS active_mentors,

    (SELECT COUNT(*) FROM dbo.sme_profiles sp
       JOIN dbo.visible_employee_ids(@p_viewer, @p_is_admin) v ON v.employee_id = sp.employee_id
      WHERE sp.active = 1) AS identified_smes,

    (SELECT COUNT(*) FROM dbo.skills WHERE criticality IN ('High','Critical')) AS critical_skill_count,

    (SELECT ROUND(AVG(CAST(r.readiness_percent AS DECIMAL(10,2))), 1) FROM dbo.v_role_readiness r
       JOIN dbo.visible_employee_ids(@p_viewer, @p_is_admin) v ON v.employee_id = r.employee_id)
      AS average_role_readiness_percent,

    (SELECT ROUND(AVG(CAST(te.progress_percent AS DECIMAL(10,2))), 1) FROM dbo.training_enrollments te
       JOIN dbo.visible_employee_ids(@p_viewer, @p_is_admin) v ON v.employee_id = te.employee_id)
      AS average_training_progress_percent
);
GO
