# Database

One schema, one dialect: **PostgreSQL**, in [`db/pg/`](pg/).

It is loaded two ways, and they are the same files either way:

| `PG_DRIVER` | How the files get in |
| --- | --- |
| `server` | you run them once, in the Supabase SQL editor (or with `psql`) |
| `pglite` | `server/src/db/pglite.js` applies them on first start |

There is no second tree and no translation layer. See
[`server/src/db/`](../server/src/db/) for how the driver is chosen, and
`server/.env.example` for the settings.

## Load order

Run in numeric order. `03_demo_queries.sql` is scratch (SELECTs to run by hand),
and `04_mermaid_erd.md` is a diagram — neither is a migration, and the PGlite
bootstrap skips them.

| # | File | Notes |
|---|---|---|
| 01 | `01_schema.sql` | tables, views, `set_updated_at()`, the `updated_at` triggers |
| 02 | `02_seed.sql` | proxy data — 50 staff, skills, assessments, courses |
| 05 | `05_profile_cv.sql` | CV tables + the verification approval type |
| 06 | `06_cleanup_unused_tables.sql` | drops 18 unused tables |
| 07 | `07_org_hierarchy.sql` | traversal functions, the cycle trigger, the visibility predicate, `v_employee_tree` |
| 08 | `08_org_seed.sql` | reparents the five roots into one tree, then adds `uq_employees_single_root` |
| 09 | `09_scoped_analytics.sql` | `executive_dashboard()` |
| 10 | `10_skill_level_backfill.sql` | |
| 11 | `11_skill_taxonomy_backfill.sql` | |
| 12 | `12_tree_sort_key.sql` | adds `v_employee_tree.sort_key` |
| 13 | `13_learning_module.sql` | free-form certifications on `employee_certifications` |
| 14 | `14_module_progress.sql` | `enrollment_module_progress` + `sync_enrollment_progress()` |
| 15 | `15_sample_course.sql` | a starter course for every employee (data, not schema) |

`08` **must** follow `07`: the single-root unique index cannot be created until
the tree is connected.

## Adding a migration

Add the next numbered `NN_*.sql` file here and run it against Supabase. Nothing
else is needed for the offline install: `pglite.js` globs this directory, so the
new file is applied on the next start of any `.pgdata` that has not seen it, and
skipped on any that has. The ledger is a table called `_pglite_migrations`.

Each file is applied as ONE batch, which Postgres runs as a single implicit
transaction — so a file either lands completely or not at all, and an interrupted
bootstrap resumes from the last complete file.

## What PGlite has to support, and does

PGlite is Postgres, so this list is short. It was verified by loading every file
above and querying the result (`server/test/pglite.test.js`):

- `plpgsql` — `set_updated_at()`, `assert_no_manager_cycle()`,
  `sync_enrollment_progress()`
- `pgcrypto`, for the `CREATE EXTENSION` in `01_schema.sql`. Registered by the
  driver from PGlite's bundled contrib set. (`gen_random_uuid()` is core in
  Postgres 13+ regardless.)
- `WITH RECURSIVE`, `DISTINCT ON`, `FILTER (WHERE …)`, `json_agg` /
  `jsonb_build_object`, `MODE() WITHIN GROUP`, `UNNEST`, `ON CONFLICT`,
  `RETURNING`, window frames, partial and filtered indexes, `BEFORE` triggers
- `uuid`, `numeric`, `bigint`, `timestamptz`, `date`, `jsonb`, `text[]`

## Where the two drivers disagree, and how that is fixed

Both are Postgres, so the SQL is identical. The *drivers* differ in two places,
and `server/src/db/pglite.js` corrects both by handing PGlite `pg`'s own type
parsers — so the values are produced by the same code the Supabase path uses:

| | raw PGlite | `pg` (the reference) |
|---|---|---|
| `bigint` / `int8` | JS number | **string** |
| `date` | UTC-midnight `Date` | **local-midnight `Date`** |
| row count | `affectedRows`, `0` for SELECTs | `rowCount` |

The first two matter because they reach the client verbatim: `count(*)` in the
dashboard KPIs is a string on Supabase, and a chart that suddenly receives a
number formats differently while nothing throws. The third is normalised in the
driver's `shape()`.

`numeric` (string), `float8` (number), `uuid` (lowercase string), `timestamptz`
(`Date`), `json`/`jsonb` (parsed) and array types already agree, and are pinned
by tests rather than assumed.
