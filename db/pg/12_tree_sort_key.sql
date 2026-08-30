-- =============================================================
-- PTE CIP — v_employee_tree.sort_key
-- Additive migration. Safe to re-run (idempotent).
-- Run after 07_org_hierarchy.sql.
--
-- WHY
-- ---
-- The org chart used to be ordered with:
--
--   ORDER BY string_to_array(t.structural_code, '.')::int[]
--
-- which sorts "2.10" after "2.9" by comparing the segments as integers rather
-- than as text. Correct, but string_to_array and the array cast have no T-SQL
-- equivalent, so it was the one ordering in the codebase that would have needed
-- a per-dialect branch.
--
-- A zero-padded key sorts identically as PLAIN TEXT — "0002.0009." precedes
-- "0002.0010." — so exposing it from the view makes `ORDER BY t.sort_key`
-- correct on both dialects. The ordering became dialect-NEUTRAL instead of
-- dialect-specific, which is a better outcome than a dual constant.
--
-- Four digits per level supports 9999 direct reports; the widest branch here is
-- single digits. structural_code is unchanged and still the human-facing form
-- ("2.1.3"); sort_key exists only to be ordered by.
--
-- Keep in step with db/mssql/07_org_hierarchy.sql, which builds the same column
-- with RIGHT('0000' + ..., 4).
-- =============================================================

DROP VIEW IF EXISTS v_employee_tree;
CREATE VIEW v_employee_tree AS
WITH RECURSIVE ranked AS (
  SELECT
    e.*,
    ROW_NUMBER() OVER (
      PARTITION BY e.manager_id
      ORDER BY e.sibling_order, e.full_name
    ) AS sib
  FROM employees e
),
t AS (
  SELECT
    r.id, r.manager_id, r.employee_code, r.full_name, r.org_title, r.photo_url,
    r.employment_status,
    1 AS depth,
    ''::TEXT AS structural_code,
    ''::TEXT AS sort_key,
    ARRAY[r.id] AS ancestor_path
  FROM ranked r
  WHERE r.manager_id IS NULL
  UNION ALL
  SELECT
    c.id, c.manager_id, c.employee_code, c.full_name, c.org_title, c.photo_url,
    c.employment_status,
    t.depth + 1,
    CASE WHEN t.structural_code = '' THEN c.sib::TEXT
         ELSE t.structural_code || '.' || c.sib::TEXT END,
    t.sort_key || lpad(c.sib::TEXT, 4, '0') || '.',
    t.ancestor_path || c.id
  FROM ranked c
  JOIN t ON c.manager_id = t.id
  WHERE NOT c.id = ANY(t.ancestor_path)
)
SELECT
  t.id,
  t.manager_id,
  t.employee_code,
  t.full_name,
  t.org_title,
  t.photo_url,
  t.employment_status,
  t.depth,
  t.structural_code,
  t.sort_key,
  -- "TM 2.1.3", reproduced from tree position alone. Nothing to keep in sync.
  TRIM(COALESCE(t.org_title, '') || ' ' || t.structural_code) AS display_label,
  t.ancestor_path,
  EXISTS (SELECT 1 FROM employees c WHERE c.manager_id = t.id) AS has_reports
FROM t;
