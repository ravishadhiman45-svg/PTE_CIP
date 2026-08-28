-- =============================================================
-- PTE CIP DEMO QUERIES
-- Use these queries to test dashboards and screens.
-- =============================================================

-- 1. Executive dashboard metrics
SELECT * FROM v_executive_dashboard;

-- 2. Skills library table
SELECT s.name AS skill_name, c.name AS category, s.criticality, s.future_relevance,
       COUNT(DISTINCT esa.employee_id) AS assigned_employees,
       COUNT(DISTINCT rb.job_role_id) AS linked_roles,
       COUNT(DISTINCT msm.mentor_id) AS mentors
FROM skills s
LEFT JOIN skill_categories c ON c.id=s.category_id
LEFT JOIN employee_skill_assignments esa ON esa.skill_id=s.id
LEFT JOIN job_role_skill_benchmarks rb ON rb.skill_id=s.id
LEFT JOIN mentor_skill_map msm ON msm.skill_id=s.id
GROUP BY s.id, s.name, c.name, s.criticality, s.future_relevance
ORDER BY s.name;

-- 3. Skill detail: CAN / LIN Communication
SELECT * FROM skills WHERE code='CAN-LIN';

SELECT assessor_type, ROUND(AVG(assessed_level),2) AS avg_level, COUNT(*) AS rating_count
FROM skill_assessments sa
JOIN skills s ON s.id=sa.skill_id
WHERE s.code='CAN-LIN'
GROUP BY assessor_type;

-- 4. Employee skill passport for Jasleen Kaur
SELECT m.skill_name, m.self_level, m.manager_level, m.mentor_level, m.effective_level
FROM v_employee_skill_matrix m
JOIN employees e ON e.id=m.employee_id
WHERE e.email='jasleen.kaur@ptecip.local'
ORDER BY m.skill_name;

-- 5. Mentor dashboard for Gurpreet Singh
SELECT * FROM v_mentor_dashboard WHERE mentor_name='Gurpreet Singh';

-- 6. Mentor mentee list
SELECT mentor.full_name AS mentor, mentee.full_name AS mentee, s.name AS skill, ma.status, ma.start_date
FROM mentor_assignments ma
JOIN employees mentor ON mentor.id=ma.mentor_id
JOIN employees mentee ON mentee.id=ma.mentee_id
LEFT JOIN skills s ON s.id=ma.skill_id
WHERE mentor.full_name='Gurpreet Singh';

-- 7. Training catalog
SELECT tc.title, tc.course_type, tc.delivery_mode, tc.duration_hours, sme.full_name AS owner_sme, coord.full_name AS coordinator, tc.status
FROM training_courses tc
LEFT JOIN employees sme ON sme.id=tc.owner_sme_id
LEFT JOIN employees coord ON coord.id=tc.coordinator_id
ORDER BY tc.title;

-- 8. Learning plan Kanban for Jasleen Kaur
SELECT e.full_name, tc.title, lpi.status, lpi.priority, lpi.progress_percent, lpi.due_date, lpi.notes
FROM learning_plan_items lpi
JOIN employees e ON e.id=lpi.employee_id
LEFT JOIN training_courses tc ON tc.id=lpi.course_id
WHERE e.email='jasleen.kaur@ptecip.local'
ORDER BY CASE lpi.status WHEN 'To Do' THEN 1 WHEN 'In Progress' THEN 2 WHEN 'Completed' THEN 3 ELSE 4 END;

-- 9. Role readiness
SELECT * FROM v_role_readiness ORDER BY readiness_percent DESC;

-- 10. Course development pipeline
SELECT cdr.request_code, cdr.capability_gap_title, s.name AS skill, cdr.status, sme.full_name AS sme, coord.full_name AS coordinator, cdr.target_launch_date
FROM course_development_requests cdr
LEFT JOIN skills s ON s.id=cdr.skill_id
LEFT JOIN employees sme ON sme.id=cdr.sme_id
LEFT JOIN employees coord ON coord.id=cdr.coordinator_id
ORDER BY cdr.created_at DESC;

-- =============================================================
-- HIERARCHY + VISIBILITY INVARIANTS (07_org_hierarchy / 08_org_seed)
-- These are assertions, not reports: each one states the answer it must give.
-- =============================================================

-- 11. Tree shape.
SELECT
  (SELECT count(*) FROM employees WHERE manager_id IS NULL)              AS roots,          -- must be 1
  (SELECT count(*) FROM employees)                                       AS headcount,
  (SELECT count(*) FROM v_employee_tree)                                 AS reachable,      -- must equal headcount
  (SELECT max(depth) FROM v_employee_tree)                               AS max_depth,
  (SELECT count(*) FROM employees WHERE org_title IS NULL)               AS untitled;       -- must be 0

-- `reachable` < `headcount` would mean someone is detached from the tree and
-- therefore invisible to the Executive Officer.

-- 12. The Executive Officer's subtree is the whole organization.
SELECT count(*) AS eo_can_see
FROM employee_subtree((SELECT id FROM employees WHERE manager_id IS NULL));

-- 13. The chart as drawn, indented by depth.
SELECT repeat('  ', depth - 1) || display_label AS chart, full_name, employee_code
FROM v_employee_tree
ORDER BY string_to_array(structural_code, '.')::int[];

-- 14. A leaf sees exactly one person — itself. No special case in the code.
SELECT e.full_name,
       (SELECT count(*) FROM employee_subtree(e.id))   AS can_see,     -- must be 1
       (SELECT count(*) FROM employee_ancestors(e.id)) AS chain_length
FROM employees e
WHERE NOT EXISTS (SELECT 1 FROM employees c WHERE c.manager_id = e.id)
ORDER BY e.full_name
LIMIT 5;

-- 15. Nobody can see outside their own subtree. MUST RETURN ZERO ROWS.
SELECT v.full_name AS viewer, t.employee_id AS leaked
FROM employees v
CROSS JOIN LATERAL visible_employee_ids(v.id, false) t
WHERE NOT EXISTS (
  SELECT 1 FROM employee_subtree(v.id) s WHERE s.employee_id = t.employee_id
);

-- 16. Visibility is strictly one-directional: if A can see B and A <> B,
--     then B must NOT be able to see A. MUST RETURN ZERO ROWS.
SELECT a.full_name AS a, b.full_name AS b
FROM employees a
JOIN employees b ON b.id <> a.id
WHERE can_view_employee(a.id, b.id) AND can_view_employee(b.id, a.id);

-- 17. Guards actually fire. Each of these must ERROR — run them one at a time,
--     inside a transaction you roll back.
-- BEGIN;
--   UPDATE employees SET manager_id = id WHERE employee_code = 'PTE0013';
--     -- expect: Reporting cycle: ... — the BEFORE trigger fires ahead of the
--     -- employees_no_self_manage CHECK, so the trigger reports it first. Both
--     -- guards are in place; the trigger simply gets there sooner.
--   UPDATE employees SET manager_id = (SELECT id FROM employees WHERE employee_code='PTE0021')
--     WHERE employee_code = 'PTE0013';
--     -- expect: Reporting cycle: ... is already inside the subtree of ...
--   UPDATE employees SET manager_id = NULL WHERE employee_code = 'PTE0013';
--     -- expect: duplicate key value violates unique constraint "uq_employees_single_root"
--   UPDATE employees SET org_title = 'Wizard' WHERE employee_code = 'PTE0013';
--     -- expect: violates check constraint "employees_org_title_check"
-- ROLLBACK;
