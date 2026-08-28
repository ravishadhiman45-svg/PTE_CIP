# Database

Two dialect trees, one logical schema.

```
db/pg/      PostgreSQL — Supabase-hosted (our own deployment)
db/mssql/   Microsoft SQL Server 2019/2022 — on-premise client deployment
```

The server picks one at startup via `DB_DIALECT`. See
[`server/src/db/`](../server/src/db/) for how that works, and `server/.env.example`
for the settings.

## Load order

Both trees use the same numbering, deliberately, so the files line up.

**PostgreSQL** — run in the Supabase SQL editor, in order:

| # | File | Notes |
|---|---|---|
| 01 | `01_schema.sql` | 42 tables, 6 views, `set_updated_at()` |
| 02 | `02_seed.sql` | proxy data |
| 05 | `05_profile_cv.sql` | CV tables |
| 06 | `06_cleanup_unused_tables.sql` | drops 18 unused tables |
| 07 | `07_org_hierarchy.sql` | traversal + the visibility predicate |
| 08 | `08_org_seed.sql` | reparents the five roots, then adds `uq_employees_single_root` |
| 09 | `09_scoped_analytics.sql` | `executive_dashboard()` |
| 10 | `10_skill_level_backfill.sql` | |
| 11 | `11_skill_taxonomy_backfill.sql` | |
| 12 | `12_tree_sort_key.sql` | adds `v_employee_tree.sort_key` |

`08` **must** follow `07`: the single-root unique index cannot be created until
the tree is connected. `03_demo_queries.sql` is scratch, not a migration.

**SQL Server** — run in order. Files must be run with a tool that understands
`GO` as a batch separator (`sqlcmd`, Azure Data Studio, SSMS).

| # | File | Notes |
|---|---|---|
| 01 | `01_schema.sql` | tables, indexes, `updated_at` triggers, analytics views |
| 07 | `07_org_hierarchy.sql` | TVFs, cycle trigger, `v_employee_tree`, single-root index |
| 09 | `09_scoped_analytics.sql` | `dbo.executive_dashboard()` |

Data is **not** re-authored as T-SQL inserts. `02_seed` and `08_org_seed` are
74 KB of Postgres `INSERT`s; hand-porting them would be a large, silent source of
transcription errors. Load data by transferring it from a populated Postgres
instance instead.

## Keeping the two in step

Same numbering, same section headings, same table order — so a side-by-side diff
of the comment structure is meaningful even though the SQL differs.

Nothing enforces this automatically. **When you change one tree, change the
other in the same commit.** Two things help:

- `npm run lint:sql` (from `server/`) catches Postgres-only constructs in
  application SQL, and warns on `GROUP BY` clauses that rely on Postgres's
  primary-key functional dependency — valid in Postgres, a runtime error on SQL
  Server, and invisible to a token scan.
- `npm test` runs the real rewriter over every `mssql:` branch of every dual
  constant.

Neither can see *semantic* drift: a `CHECK` constraint added to `db/pg/07` and
forgotten in `db/mssql/07` will pass both. That gap is real and permanent.

## Type mapping

| PostgreSQL | SQL Server | Note |
|---|---|---|
| `UUID` / `gen_random_uuid()` | `UNIQUEIDENTIFIER` / `NEWID()` | `NEWID()` over `NEWSEQUENTIALID()`: sequential GUIDs leak row creation order |
| `TEXT` | `NVARCHAR(450)` | 900 bytes — the widest indexable key |
| `TEXT` (prose columns) | `NVARCHAR(MAX)` | cannot be indexed, so only for `description`, `summary`, `body`, … |
| `TIMESTAMPTZ` / `NOW()` | `DATETIMEOFFSET` / `SYSUTCDATETIME()` | |
| `BOOLEAN` | `BIT` | `TRUE`/`FALSE` → `1`/`0`; T-SQL has no boolean *expression* type, so predicates need an explicit `= 1` |
| `JSONB` | `NVARCHAR(MAX)` | + `ISJSON` where written as JSON |
| `NUMERIC(p,s)` | `DECIMAL(p,s)` | `pg` returns these as **strings**, `mssql` as numbers — reconciled in `db/normalize.js` |
| `DATE` / `INT` | unchanged | |
| `CURRENT_DATE` | `CAST(SYSUTCDATETIME() AS DATE)` | |
| `CREATE OR REPLACE` | `CREATE OR ALTER` | views, functions, procedures, triggers — **not** tables |

## The five places the dialects genuinely differ

Not spelling differences — these needed a different design.

1. **`WITH RECURSIVE … CYCLE`** has no T-SQL equivalent. `employee_subtree()` and
   `employee_ancestors()` accumulate a delimited path of visited ids and refuse
   to revisit one. This also stands in for `MAXRECURSION`: T-SQL defaults to 100
   and *errors* rather than truncating, and `OPTION (MAXRECURSION n)` is not
   allowed inside a view or inline TVF — so the guard has to terminate the
   recursion by itself.

2. **There is no `BEFORE` trigger**, and this is where a naive port breaks. By
   the time an `AFTER` trigger runs the new `manager_id` is already written, so
   "is this row inside its new manager's subtree?" is *always true* and would
   reject every reparent. The correct test is the Postgres one, in the other
   direction: is the proposed **manager** inside the subtree of the row being
   changed? That reads the same before and after the write.
   `AFTER` rather than `INSTEAD OF` is deliberate for a plainer reason: an
   `INSTEAD OF` trigger must perform the write itself, so it would have to
   re-implement the INSERT and UPDATE — including the defaults and the
   `sibling_order` subquery — and stay in step with them forever. An `AFTER`
   trigger only has to answer a yes/no question.

3. **41 `ON DELETE CASCADE`s, two of which SQL Server refuses.** It rejects a
   schema where a table is reachable by more than one cascade path from the same
   ancestor. `mentor_assignments` cascades to `employees` through both
   `mentor_id` and `mentee_id`; `mentor_recommendations` likewise. Those two are
   downgraded to `NO ACTION`, annotated in the DDL. Safe because nothing in the
   API deletes an employee — if that changes, these parents need explicit
   cleanup. (`tools/pg-to-tsql-schema.js` checks this transitively.)

4. **A unique index on a constant expression is not allowed.** Postgres enforces
   a single root with `UNIQUE INDEX ON employees ((TRUE)) WHERE manager_id IS NULL`.
   T-SQL does not need the trick: its unique indexes treat `NULL` as equal to
   `NULL`, so a filtered unique index on `manager_id` over the `NULL` rows
   permits exactly one.

5. **An inline TVF cannot `ORDER BY`.** `employee_chain()` dropped its internal
   ordering and `lib/visibility.js` orders explicitly — a better home for it
   anyway, since a function's internal `ORDER BY` never really guaranteed the
   result order.

## Two restrictions that only bite at runtime

Neither is visible in the DDL, in a schema check, or on any read path. Both were
found by executing against a real instance.

**1. `OUTPUT` without `INTO` is refused on a table with an enabled trigger.**

> The target table ... cannot have any enabled triggers if the statement contains
> an OUTPUT clause without INTO clause.

`employees`, `employee_cv`, `skills`, `training_courses`, `job_roles` and
`organizations` all carry triggers, so every `RETURNING` translated on those
tables must capture into a table variable and select it back:

```sql
DECLARE @out TABLE (id UNIQUEIDENTIFIER, photo_url NVARCHAR(450));
UPDATE employees SET photo_url = @p2
  OUTPUT INSERTED.id, INSERTED.photo_url INTO @out
  WHERE id = @p1;
SELECT id, photo_url FROM @out;
```

This affects only WRITE paths, so it survives any amount of read-only testing.
Two assertions in `server/test/dualsql.test.js` guard it: that OUTPUT on a
trigger-bearing table uses `INTO`, and that anything capturing into a table
variable also selects back out of it.

**2. `EXISTS` cannot be selected as a column.**

Postgres treats `EXISTS (...)` as a boolean expression, so it can appear in a
select list. T-SQL has no boolean expression type — `EXISTS` is only ever a
predicate — so a projection needs
`CAST(CASE WHEN EXISTS (...) THEN 1 ELSE 0 END AS bit)`. `EXISTS` inside a
`WHERE` clause is portable and is deliberately not flagged.

## Running the SQL files

Use a client that treats `GO` as a batch separator. All three files set
`ANSI_NULLS` and `QUOTED_IDENTIFIER` themselves rather than inheriting them,
because **sqlcmd defaults `QUOTED_IDENTIFIER` to OFF while SSMS and Azure Data
Studio default it ON** — and `uq_employees_single_root`, being a filtered index,
requires both ON. Without the explicit `SET`, the schema loads in SSMS and fails
under sqlcmd.

The same applies to ad-hoc DML you run by hand: any `INSERT`/`UPDATE` against
`employees` needs those options, so pass `-I` to sqlcmd:

```bash
sqlcmd -S . -E -C -I -d ptecip -Q "UPDATE employees SET ..."
```

The node driver is unaffected — tedious sets both options ON when it connects.

## Two places the dialects can legitimately disagree

Both are ties that Postgres resolves arbitrarily and the T-SQL port resolves
deterministically. Worth knowing when diffing outputs:

- `v_latest_skill_levels` — `DISTINCT ON` picks an arbitrary row when two
  assessments share `assessed_at`; the `ROW_NUMBER()` replacement breaks the tie
  on `id`.
- `MODE() WITHIN GROUP` in `routes/roadmap.js` — arbitrary among
  equally-frequent values on Postgres; the T-SQL `TOP 1 … ORDER BY COUNT(*) DESC`
  adds a secondary sort.
