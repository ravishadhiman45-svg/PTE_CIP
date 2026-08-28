-- Session options, set explicitly rather than inherited from the client.
--
-- sqlcmd defaults QUOTED_IDENTIFIER to OFF while SSMS and Azure Data Studio
-- default it ON, so a file that relies on the client's default loads in one tool
-- and fails in another. Filtered indexes (uq_employees_single_root) REQUIRE both
-- of these, and views/functions/triggers bake the options in at CREATE time — so
-- getting them right here also decides how those objects behave later.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- =============================================================
-- PTE CIP — ORGANIZATIONAL HIERARCHY + VISIBILITY PREDICATE (SQL Server)
--
-- Port of db/pg/07_org_hierarchy.sql. Idempotent; safe to re-run.
-- Run after 01_schema.sql, and BEFORE 08_org_seed.
--
-- This is the file where the two dialects genuinely diverge in structure rather
-- than in spelling. Four things had to be re-thought, each noted at its site:
--
--   1. WITH RECURSIVE ... CYCLE has no T-SQL equivalent -> path-string guard
--   2. There is no BEFORE trigger -> AFTER trigger, with a real trap to avoid
--   3. An inline TVF cannot ORDER BY -> ordering moves to the caller
--   4. A unique index on a constant expression is not allowed -> filtered index
--       on manager_id, exploiting the fact that T-SQL treats NULLs as equal
-- =============================================================

-- -----------------------------
-- Columns
-- -----------------------------
IF COL_LENGTH('dbo.employees', 'org_title') IS NULL
  ALTER TABLE dbo.employees ADD org_title NVARCHAR(450) NULL;
GO

IF COL_LENGTH('dbo.employees', 'sibling_order') IS NULL
  ALTER TABLE dbo.employees ADD sibling_order INT NOT NULL CONSTRAINT df_employees_sibling_order DEFAULT 0;
GO

-- org_title is a LABEL, not a level. The reference org chart puts DDVM at depth
-- 3 and 4, DPM at depth 4 and 5, and TM at depth 6 — so there is deliberately no
-- relationship between title and depth, and no CHECK tying them together.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'employees_org_title_check')
  ALTER TABLE dbo.employees DROP CONSTRAINT employees_org_title_check;
GO
ALTER TABLE dbo.employees ADD CONSTRAINT employees_org_title_check
  CHECK (org_title IS NULL OR org_title IN (
    'Executive Officer', 'Sr. DVM', 'DVM', 'DDVM', 'DPM', 'TM'
  ));
GO

-- Children of a manager, in chart order. Also serves the subtree recursion.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='idx_employees_manager_order' AND object_id=OBJECT_ID('dbo.employees'))
  CREATE INDEX idx_employees_manager_order ON dbo.employees(manager_id, sibling_order);
GO

-- -----------------------------
-- Tree integrity
-- -----------------------------

-- Nobody manages themselves.
--
-- Postgres writes this as `manager_id IS DISTINCT FROM id`, which is NULL-safe.
-- T-SQL has no IS DISTINCT FROM, and a bare `manager_id <> id` would evaluate to
-- UNKNOWN for a root (manager_id NULL) — which a CHECK constraint ACCEPTS, so
-- the behaviour happens to match. The NULL branch is written out anyway, because
-- relying on three-valued logic silently agreeing is not the same as saying what
-- you mean.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'employees_no_self_manage')
  ALTER TABLE dbo.employees DROP CONSTRAINT employees_no_self_manage;
GO
ALTER TABLE dbo.employees ADD CONSTRAINT employees_no_self_manage
  CHECK (manager_id IS NULL OR manager_id <> id);
GO

-- -----------------------------
-- Traversal
--
-- Adjacency list + a recursive CTE is the right shape at this size: 50 rows over
-- <= 6 levels resolves in microseconds.
--
-- CYCLE ... SET ... USING (Postgres 14+) does not exist in T-SQL, so each
-- function accumulates a delimited path of visited ids and refuses to revisit
-- one. The delimiters matter: without the surrounding slashes, CHARINDEX would
-- match an id that merely appears as a substring of the path.
--
-- This also substitutes for MAXRECURSION. T-SQL defaults to 100 and raises an
-- ERROR rather than truncating, and OPTION (MAXRECURSION n) is not permitted
-- inside a view or an inline table-valued function — so the guard has to make
-- the recursion terminate on its own, which it does.
-- -----------------------------

-- Self + every descendant. depth 0 = self, so a leaf returns exactly one row.
-- That single fact is what makes "a leaf sees only themselves" fall out of the
-- visibility rule instead of being special-cased.
CREATE OR ALTER FUNCTION dbo.employee_subtree(@p_root UNIQUEIDENTIFIER)
RETURNS TABLE
AS RETURN
(
  WITH t AS (
    SELECT
      e.id AS employee_id,
      0 AS depth,
      CAST('/' + CAST(e.id AS CHAR(36)) + '/' AS NVARCHAR(MAX)) AS visited
    FROM dbo.employees e
    WHERE e.id = @p_root
    UNION ALL
    SELECT
      c.id,
      t.depth + 1,
      CAST(t.visited + CAST(c.id AS CHAR(36)) + '/' AS NVARCHAR(MAX))
    FROM dbo.employees c
    JOIN t ON c.manager_id = t.employee_id
    WHERE CHARINDEX('/' + CAST(c.id AS CHAR(36)) + '/', t.visited) = 0
  )
  SELECT employee_id, depth FROM t
);
GO

-- Strict ancestors (excludes self), nearest first. distance 1 = direct manager.
-- Returns zero rows for the Executive Officer.
CREATE OR ALTER FUNCTION dbo.employee_ancestors(@p_employee UNIQUEIDENTIFIER)
RETURNS TABLE
AS RETURN
(
  WITH a AS (
    SELECT
      e.manager_id AS employee_id,
      1 AS distance,
      CAST('/' + CAST(e.manager_id AS CHAR(36)) + '/' AS NVARCHAR(MAX)) AS visited
    FROM dbo.employees e
    WHERE e.id = @p_employee AND e.manager_id IS NOT NULL
    UNION ALL
    SELECT
      p.manager_id,
      a.distance + 1,
      CAST(a.visited + CAST(p.manager_id AS CHAR(36)) + '/' AS NVARCHAR(MAX))
    FROM dbo.employees p
    JOIN a ON p.id = a.employee_id
    WHERE p.manager_id IS NOT NULL
      AND CHARINDEX('/' + CAST(p.manager_id AS CHAR(36)) + '/', a.visited) = 0
  )
  SELECT employee_id, distance FROM a
);
GO

-- The MINIMAL visibility tier, enforced by projection rather than by discipline:
-- people ABOVE you are exposed as name + title + photo and nothing else. There is
-- no column here through which a CV, contact detail or assessment could leak.
--
-- NOTE: the Postgres version ends with ORDER BY a.distance. An inline TVF in
-- T-SQL may not contain ORDER BY (without TOP), so the ordering moved to the
-- caller — lib/visibility.js managerChain() now orders explicitly. That is the
-- better place for it in any case: a result set's order was never actually
-- guaranteed by a function's internal ORDER BY.
CREATE OR ALTER FUNCTION dbo.employee_chain(@p_employee UNIQUEIDENTIFIER)
RETURNS TABLE
AS RETURN
(
  SELECT e.id, e.full_name, e.org_title, e.photo_url, a.distance
  FROM dbo.employee_ancestors(@p_employee) a
  JOIN dbo.employees e ON e.id = a.employee_id
);
GO

-- -----------------------------
-- Reject a reparent that would close a loop.
--
-- T-SQL has no BEFORE trigger, and this is where a naive port goes wrong.
--
-- By the time an AFTER trigger runs, the new manager_id is already written. The
-- tempting test — "is this row inside the subtree of its new manager?" — is
-- therefore ALWAYS TRUE, because the row is now a child of that manager. It
-- would reject every single reparent.
--
-- The correct test is the Postgres one, in the other direction: is the proposed
-- MANAGER inside the subtree of the row being changed? That question is
-- unaffected by the row's own manager_id, so it reads the same before and after
-- the write, and needs no snapshot semantics.
--
-- An AFTER trigger is also deliberate rather than incidental: an INSTEAD OF
-- trigger on `employees` would break the OUTPUT clause that
-- routes/employees.js relies on for its INSERT and UPDATE statements.
--
-- Error 50007 must stay in step with CYCLE_ERROR_NUMBER in
-- server/src/db/errors.js, which maps it to SQLSTATE 23514 so the API returns
-- the same response on both dialects.
-- -----------------------------
CREATE OR ALTER TRIGGER dbo.trg_employees_no_cycle ON dbo.employees
AFTER INSERT, UPDATE
AS
BEGIN
  SET NOCOUNT ON;

  -- Equivalent to Postgres's `BEFORE INSERT OR UPDATE OF manager_id`.
  IF NOT UPDATE(manager_id) RETURN;

  IF EXISTS (
    SELECT 1
    FROM inserted i
    CROSS APPLY dbo.employee_subtree(i.id) s
    WHERE i.manager_id IS NOT NULL
      AND s.employee_id = i.manager_id
  )
  BEGIN
    THROW 50007, 'Reporting cycle: the proposed manager is already inside this employee''s subtree', 1;
  END
END
GO

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
-- role: their subtree is the org.
--
-- Postgres can use a bare boolean as a predicate (`WHERE COALESCE(p_is_admin,
-- FALSE)`). T-SQL has no boolean expression type, so every one of these needs an
-- explicit `= 1` / `= 0`. Omitting it is a syntax error rather than a silent
-- behaviour change, which is the one mercy here.
-- -----------------------------
CREATE OR ALTER FUNCTION dbo.visible_employee_ids(
  @p_viewer UNIQUEIDENTIFIER,
  @p_is_admin BIT
)
RETURNS TABLE
AS RETURN
(
  SELECT e.id AS employee_id FROM dbo.employees e WHERE COALESCE(@p_is_admin, 0) = 1
  UNION ALL
  SELECT s.employee_id FROM dbo.employee_subtree(@p_viewer) s WHERE COALESCE(@p_is_admin, 0) = 0
);
GO

-- Scalar form, for the requireVisible middleware.
--
-- Callers must pass all three arguments: T-SQL scalar functions do have default
-- parameters, but supplying one requires the literal keyword DEFAULT at the call
-- site, which is not something the shared SQL can express. lib/visibility.js
-- always passes the third argument explicitly.
CREATE OR ALTER FUNCTION dbo.can_view_employee(
  @p_viewer UNIQUEIDENTIFIER,
  @p_target UNIQUEIDENTIFIER,
  @p_is_admin BIT
)
RETURNS BIT
AS
BEGIN
  IF COALESCE(@p_is_admin, 0) = 1 RETURN CAST(1 AS BIT);

  IF EXISTS (
    SELECT 1 FROM dbo.employee_subtree(@p_viewer) s WHERE s.employee_id = @p_target
  )
    RETURN CAST(1 AS BIT);

  RETURN CAST(0 AS BIT);
END
GO

-- -----------------------------
-- Org chart view
--
-- depth and the structural code ("2.1.3") are DERIVED, never stored. A stored
-- positional code would have to be renumbered across an entire subtree on every
-- transfer — and a code that renumbers was never a stable identifier to begin
-- with. Identity stays on employees.id and employees.employee_code.
--
-- sort_key is new in both dialects (see db/pg/12_tree_sort_key.sql). Postgres
-- ordered the chart with string_to_array(structural_code,'.')::int[], which has
-- no T-SQL equivalent at all. A zero-padded key sorts identically as plain text,
-- so `ORDER BY sort_key` needs no dual constant — the ordering became
-- dialect-neutral rather than dialect-specific, which is strictly better.
--
-- Four digits per level supports 9999 direct reports; the widest here is single
-- digits.
-- -----------------------------
CREATE OR ALTER VIEW dbo.v_employee_tree AS
WITH ranked AS (
  SELECT
    e.id, e.manager_id, e.employee_code, e.full_name, e.org_title, e.photo_url,
    e.employment_status,
    ROW_NUMBER() OVER (
      PARTITION BY e.manager_id
      ORDER BY e.sibling_order, e.full_name
    ) AS sib
  FROM dbo.employees e
),
t AS (
  SELECT
    r.id, r.manager_id, r.employee_code, r.full_name, r.org_title, r.photo_url,
    r.employment_status,
    1 AS depth,
    CAST('' AS NVARCHAR(400)) AS structural_code,
    CAST('' AS NVARCHAR(400)) AS sort_key,
    CAST('/' + CAST(r.id AS CHAR(36)) + '/' AS NVARCHAR(MAX)) AS ancestor_path
  FROM ranked r
  WHERE r.manager_id IS NULL
  UNION ALL
  SELECT
    c.id, c.manager_id, c.employee_code, c.full_name, c.org_title, c.photo_url,
    c.employment_status,
    t.depth + 1,
    CAST(CASE WHEN t.structural_code = '' THEN CAST(c.sib AS NVARCHAR(10))
              ELSE t.structural_code + '.' + CAST(c.sib AS NVARCHAR(10)) END AS NVARCHAR(400)),
    CAST(t.sort_key + RIGHT('0000' + CAST(c.sib AS NVARCHAR(10)), 4) + '.' AS NVARCHAR(400)),
    CAST(t.ancestor_path + CAST(c.id AS CHAR(36)) + '/' AS NVARCHAR(MAX))
  FROM ranked c
  JOIN t ON c.manager_id = t.id
  WHERE CHARINDEX('/' + CAST(c.id AS CHAR(36)) + '/', t.ancestor_path) = 0
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
  LTRIM(RTRIM(COALESCE(t.org_title, '') + ' ' + t.structural_code)) AS display_label,
  -- NOTE: a delimited string here, where Postgres has UUID[]. Nothing in the API
  -- selects this column, so the type difference does not reach the client.
  t.ancestor_path,
  CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.employees c WHERE c.manager_id = t.id)
            THEN 1 ELSE 0 END AS BIT) AS has_reports
FROM t;
GO

-- -----------------------------
-- Single root
--
-- Postgres expresses this as a unique index on the constant expression (TRUE)
-- filtered to manager_id IS NULL. T-SQL cannot index a constant.
--
-- It does not need to: a UNIQUE index in SQL Server treats NULL as equal to
-- NULL, so a unique index on manager_id FILTERED to the NULL rows permits
-- exactly one of them — which is precisely the single-root rule. (In Postgres
-- the same index would allow unlimited NULLs, which is why it needed the
-- constant-expression trick in the first place.)
--
-- Created here rather than in 08_org_seed because this tree is loaded from an
-- already-reparented dump; if seeding leaves multiple roots, move it to the end
-- of the seed as the Postgres tree does.
-- -----------------------------
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='uq_employees_single_root' AND object_id=OBJECT_ID('dbo.employees'))
  CREATE UNIQUE INDEX uq_employees_single_root
    ON dbo.employees(manager_id) WHERE manager_id IS NULL;
GO
