-- =============================================================
-- PTE CIP — ORGANIZATIONAL HIERARCHY + VISIBILITY PREDICATE
-- Additive migration. Safe to re-run (idempotent).
-- Run in the Supabase SQL Editor after 01_schema.sql / 02_seed.sql / 05_profile_cv.sql,
-- and BEFORE 08_org_seed.sql.
--
-- Builds on what already exists: employees.manager_id (01_schema.sql:100) is
-- already a self-referencing adjacency list with an index. This file does not
-- replace it — it makes it traversable, guards its integrity, and derives the
-- visibility rule from it.
--
-- Adds:
--   * employees.org_title       — display label (Executive Officer .. TM)
--   * employees.sibling_order   — deterministic left-to-right chart order
--   * cycle + self-management guards on manager_id
--   * employee_subtree()        — self + all descendants
--   * employee_ancestors()      — the chain up to the Executive Officer
--   * employee_chain()          — ancestors, name/title projection only
--   * visible_employee_ids()    — THE visibility predicate; nothing reimplements it
--   * can_view_employee()       — scalar form, for the requireVisible middleware
--   * v_employee_tree           — depth + derived structural code (e.g. "2.1.3")
--
-- Deliberately NOT here: the single-root unique index. Current seed data has
-- five roots (02_seed.sql:80-87 leaves 601, 607, 608, 609 and 610 with a NULL
-- manager_id), so the index would fail. 08_org_seed.sql reparents them and
-- creates it at the end.
-- =============================================================

-- -----------------------------
-- Columns
-- -----------------------------
ALTER TABLE employees ADD COLUMN IF NOT EXISTS org_title TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS sibling_order INT NOT NULL DEFAULT 0;

-- org_title is a LABEL, not a level. The reference org chart puts DDVM at depth
-- 3 and 4, DPM at depth 4 and 5, and TM at depth 6 — so there is deliberately no
-- relationship between title and depth, and no CHECK tying them together.
-- Depth is computed in v_employee_tree.
-- To widen this list later, reuse the drop-and-recreate pattern from
-- 05_profile_cv.sql:75-84.
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_org_title_check;
ALTER TABLE employees ADD CONSTRAINT employees_org_title_check
  CHECK (org_title IS NULL OR org_title IN (
    'Executive Officer',
    'Sr. DVM',
    'DVM',
    'DDVM',
    'DPM',
    'TM'
  ));

-- Children of a manager, in chart order. Also serves the subtree recursion.
CREATE INDEX IF NOT EXISTS idx_employees_manager_order
  ON employees(manager_id, sibling_order);

-- -----------------------------
-- Tree integrity
-- -----------------------------

-- Nobody manages themselves. (Row-level CHECK: both columns are on the same row.)
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_no_self_manage;
ALTER TABLE employees ADD CONSTRAINT employees_no_self_manage
  CHECK (manager_id IS DISTINCT FROM id);

-- -----------------------------
-- Traversal
--
-- Adjacency list + WITH RECURSIVE is the right shape at this size: 50 rows over
-- <= 6 levels resolves in microseconds. A closure table or ltree would add a
-- denormalization to keep in sync for no measurable gain. Revisit only if
-- headcount grows by an order of magnitude.
--
-- The CYCLE clause (PG 14+; Supabase runs 15/17) is defence-in-depth behind the
-- trigger below — it degrades a cycle into a truncated result instead of an
-- infinite loop.
-- -----------------------------

-- Self + every descendant. depth 0 = self, so a leaf returns exactly one row.
-- That single fact is what makes "a leaf sees only themselves" fall out of the
-- visibility rule instead of being special-cased.
CREATE OR REPLACE FUNCTION employee_subtree(p_root UUID)
RETURNS TABLE (employee_id UUID, depth INT)
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE t AS (
    SELECT e.id, 0 AS depth
    FROM employees e
    WHERE e.id = p_root
    UNION ALL
    SELECT c.id, t.depth + 1
    FROM employees c
    JOIN t ON c.manager_id = t.id
  ) CYCLE id SET is_cycle USING cpath
  SELECT t.id, t.depth FROM t WHERE NOT t.is_cycle;
$$;

-- Strict ancestors (excludes self), nearest first. distance 1 = direct manager.
-- Returns zero rows for the Executive Officer.
CREATE OR REPLACE FUNCTION employee_ancestors(p_employee UUID)
RETURNS TABLE (employee_id UUID, distance INT)
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE a AS (
    SELECT e.manager_id AS id, 1 AS distance
    FROM employees e
    WHERE e.id = p_employee AND e.manager_id IS NOT NULL
    UNION ALL
    SELECT p.manager_id, a.distance + 1
    FROM employees p
    JOIN a ON p.id = a.id
    WHERE p.manager_id IS NOT NULL
  ) CYCLE id SET is_cycle USING apath
  SELECT a.id, a.distance FROM a WHERE NOT a.is_cycle;
$$;

-- The MINIMAL visibility tier, enforced by projection rather than by discipline:
-- people ABOVE you are exposed as name + title + photo and nothing else. There is
-- no column here through which a CV, contact detail or assessment could leak.
CREATE OR REPLACE FUNCTION employee_chain(p_employee UUID)
RETURNS TABLE (id UUID, full_name TEXT, org_title TEXT, photo_url TEXT, distance INT)
LANGUAGE sql STABLE AS $$
  SELECT e.id, e.full_name, e.org_title, e.photo_url, a.distance
  FROM employee_ancestors(p_employee) a
  JOIN employees e ON e.id = a.employee_id
  ORDER BY a.distance;
$$;

-- Reject a reparent that would close a loop.
--
-- On INSERT the new row is not yet visible to the function, so the subtree comes
-- back empty and this correctly passes: a fresh row cannot close a cycle.
-- On UPDATE the STABLE function reads the pre-statement snapshot, which is
-- exactly the question being asked — is the proposed manager ALREADY below me?
--
-- Caveat: because the snapshot is per-statement, a single multi-row UPDATE could
-- in principle form a cycle across the rows it touches. Reparenting goes through
-- one single-row endpoint, so this is not reachable from the API.
CREATE OR REPLACE FUNCTION assert_no_manager_cycle() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.manager_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM employee_subtree(NEW.id) s WHERE s.employee_id = NEW.manager_id
  ) THEN
    RAISE EXCEPTION
      'Reporting cycle: % is already inside the subtree of %', NEW.manager_id, NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_employees_no_cycle ON employees;
CREATE TRIGGER trg_employees_no_cycle
  BEFORE INSERT OR UPDATE OF manager_id ON employees
  FOR EACH ROW EXECUTE FUNCTION assert_no_manager_cycle();

-- -----------------------------
-- The visibility predicate
--
-- Every scoped query in the API goes through one of these two functions. No
-- route reimplements the rule.
--
--   FULL(v)    = descendants_inclusive(v)  -- own record + entire subtree
--   MINIMAL(v) = strict_ancestors(v)       -- employee_chain(), name/title only
--   NONE       = everyone else             -- peers, siblings, other branches
--   admin      = all employees, FULL       -- role bypass
--
-- The Executive Officer sees all 50 because they are the ROOT, not because of a
-- role: their subtree is the org. The `executive` permission role grants no
-- extra reach.
--
-- These are plain STABLE functions. If enforcement later moves into RLS
-- policies, adding `SECURITY DEFINER SET search_path = public` to both is the
-- entire change — the policy body can call them verbatim.
-- -----------------------------
CREATE OR REPLACE FUNCTION visible_employee_ids(p_viewer UUID, p_is_admin BOOLEAN DEFAULT FALSE)
RETURNS TABLE (employee_id UUID)
LANGUAGE sql STABLE AS $$
  SELECT e.id FROM employees e WHERE COALESCE(p_is_admin, FALSE)
  UNION ALL
  SELECT s.employee_id FROM employee_subtree(p_viewer) s WHERE NOT COALESCE(p_is_admin, FALSE);
$$;

CREATE OR REPLACE FUNCTION can_view_employee(
  p_viewer UUID, p_target UUID, p_is_admin BOOLEAN DEFAULT FALSE
) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(p_is_admin, FALSE) OR EXISTS (
    SELECT 1 FROM employee_subtree(p_viewer) s WHERE s.employee_id = p_target
  );
$$;

-- -----------------------------
-- Org chart view
--
-- depth and the structural code ("2.1.3") are DERIVED, never stored. A stored
-- positional code would have to be renumbered across an entire subtree on every
-- transfer — and a code that renumbers was never a stable identifier to begin
-- with. Identity stays on employees.id (uuid) and employees.employee_code.
-- -----------------------------
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
  -- "TM 2.1.3", reproduced from tree position alone. Nothing to keep in sync.
  TRIM(COALESCE(t.org_title, '') || ' ' || t.structural_code) AS display_label,
  t.ancestor_path,
  EXISTS (SELECT 1 FROM employees c WHERE c.manager_id = t.id) AS has_reports
FROM t;
