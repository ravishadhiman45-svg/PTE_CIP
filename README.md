# PTE CIP — Powertrain Engineering Capability Intelligence Platform

A full-stack skills/capability management platform for a powertrain engineering
organization. Dark-navy SaaS UI, role-based access, and a Supabase-hosted
PostgreSQL database.

- **Frontend:** Next.js 14 (App Router, JSX), Tailwind CSS, Recharts, lucide-react, SWR
- **Backend:** Node.js + Express REST API using `pg` (parameterized SQL, no ORM)
- **Database:** Supabase-hosted PostgreSQL (schema + seed provided)

```
ptecip/
├── client/     # Next.js app (JSX + Tailwind)
├── server/     # Express API
├── db/         # 01_schema.sql, 02_seed.sql, 03_demo_queries.sql, 04_mermaid_erd.md,
│              # 05_profile_cv.sql
└── README.md
```

---

## 1. Set up the database

The server runs against **either** PostgreSQL or **Microsoft SQL Server**,
selected by `DB_DIALECT`. The SQL lives in two parallel trees — see
[`db/README.md`](db/README.md) for the load order, the type mapping, and the
places the two dialects genuinely differ.

- **PostgreSQL / Supabase** — the steps below.
- **Microsoft SQL Server 2019/2022** (on-premise) — run `db/mssql/01_schema.sql`,
  `07_org_hierarchy.sql` and `09_scoped_analytics.sql` with a tool that treats
  `GO` as a batch separator (`sqlcmd`, SSMS, Azure Data Studio), then transfer the
  data from a populated Postgres instance. Seed data is not re-authored as T-SQL.

### PostgreSQL (Supabase)

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run, in order:
   1. `db/pg/01_schema.sql` — creates all tables, views, triggers.
   2. `db/pg/02_seed.sql` — loads demo data (Indian names, powertrain content).
   3. `db/pg/05_profile_cv.sql` — profile/CV tables + the verification approval type.
      Additive and idempotent; safe on an already-seeded database.
   4. `db/pg/07_org_hierarchy.sql` — the reporting tree: `org_title`, cycle and
      single-manager guards, the subtree/ancestor traversal functions, the
      `visible_employee_ids()` visibility predicate and `v_employee_tree`.
   5. `db/pg/08_org_seed.sql` — rebuilds the reporting tree as one connected
      hierarchy (50 synthetic staff) and adds the single-root index. Must run
      after `07`; the index cannot be created until the tree is connected.
   6. `db/pg/09_scoped_analytics.sql` — `executive_dashboard()`, the per-viewer
      replacement for `v_executive_dashboard`.
   7. (optional) `db/pg/03_demo_queries.sql` — sanity-check the screens' queries,
      including the hierarchy and visibility invariants at the end.
3. Get your connection string: **Project Settings → Database → Connection string →
   "Transaction pooler"**. It looks like:
   ```
   postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
   ```
4. For profile pictures, open **Storage → New bucket**, name it `avatars` and mark
   it **Public**. Uploads are refused with a clear message until this exists.

---

## 2. Run the backend (`server/`)

```bash
cd server
npm install
cp .env.example .env      # then edit .env
npm run dev               # http://localhost:4000
```

**`server/.env`**

`server/.env.example` documents every variable; the essentials:

| Variable | Description |
| --- | --- |
| `DB_DIALECT` | **Required.** `postgres` or `mssql`. Never inferred from the connection string — a wrong guess gives a working connection running the wrong SQL. |
| `JWT_SECRET` | Signing key for the app's JWTs. **Required in production**; the server refuses to start without it rather than falling back to a known constant. |
| `SHARED_LOGIN_PASSWORD` | The one shared employee password. (Earlier docs called this `DEMO_PASSWORD`; the code has always read `SHARED_LOGIN_PASSWORD`.) |
| `GOOGLE_CLIENT_ID` | For `POST /api/auth/google`. Optional. |
| `PORT` / `CLIENT_ORIGIN` | API port, and the CORS origin for the client. Set `CLIENT_ORIGIN` on deploy — the localhost default silently blocks a deployed frontend. |

**When `DB_DIALECT=postgres`:** `DATABASE_URL` (Supabase Transaction pooler), and
`PGSSL=disable` for a local server with no TLS.

**When `DB_DIALECT=mssql`:** `MSSQL_SERVER` + `MSSQL_DATABASE` (plus
`MSSQL_PORT`, `MSSQL_USER`, `MSSQL_PASSWORD`, `MSSQL_INSTANCE` as needed), or a
single `MSSQL_CONNECTION_STRING`.

**Profile pictures** — `STORAGE_DRIVER` is `localDisk` (default) or `supabase`:

| Variable | Description |
| --- | --- |
| `UPLOAD_DIR` | `localDisk` only. Defaults to `server/uploads`. **Back this up with the database** — the DB stores URLs, not image bytes. |
| `PUBLIC_FILE_BASE_URL` | `localDisk` only. Must be absolute and browser-reachable: it is stored in `employees.photo_url` and rendered into an `<img src>` from the client's origin. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET` | `supabase` only. `service_role` bypasses RLS — server-side only, never shipped to the browser. |

Switching an existing deployment from the bucket to local disk does **not** move
the pictures: `photo_url` holds absolute URLs, so old rows keep pointing at
Supabase. Repoint them with:

```bash
node tools/migrate-photo-urls.js              # dry run
node tools/migrate-photo-urls.js --download --apply
```

Health check: `GET http://localhost:4000/api/health` — reports the resolved
dialect and storage driver, so a deployment is verifiable without shell access.

### Checks

```bash
cd server
npm run lint:sql   # SQL that would not run on both dialects
npm test           # 111 tests, no external services needed
npm run check      # both
```

---

## 3. Run the frontend (`client/`)

```bash
cd client
npm install
cp .env.local.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:4000/api
npm run dev                        # http://localhost:3000
```

Open http://localhost:3000 → you'll be redirected to `/login`.

---

## 4. Profile / CV and verification

Every signed-in user gets a self-service CV on `/profile`. The same component
renders read-only at `/employees/[id]` for anyone the viewer is allowed to see —
see *Organizational hierarchy* below. This used to be an open directory where
any signed-in user could read anyone's full record; it no longer is.

- **Edit Profile** — headline, professional summary, phone, location, LinkedIn,
  plus add/edit/remove **experience** and **education** rows. Everything is typed
  in by hand; there is no CV file upload.
- **Profile picture** — the only real file upload. Goes to the Supabase Storage
  bucket; the public URL is saved on `employees.photo_url`.
- **Add Skill** — search the skill library or type a skill that doesn't exist yet
  (it gets created), then set your own level 1–5. Stored as an
  `employee_skill_assignments` link plus a `Self` row in `skill_assessments`, so
  the Skills Passport and `v_employee_skill_matrix` pick it up unchanged.
  A skill a manager or mentor has already assessed can't be removed from here.
- **Request Verification** — pick someone from **your reporting line** (your
  manager, their manager, up to the Executive Officer) and send them a request.
  It becomes an `approvals` row (`Profile Verification`) plus an inbox item for
  them. They **Approve** or **Reject** from *Inbox → Pending Approvals*; the
  result is written back as a `Verified` / `Rejected` badge on the profile and a
  notice in the requester's inbox. Verification points *up* the tree because the
  directory is now your subtree — searching it could only ever offer your own
  reports, and would offer a leaf employee nobody at all.
- Editing any CV detail afterwards drops the profile back to **Not Verified** and
  cancels a still-pending request, so verification always refers to what was
  actually reviewed.

**Add Employee** (`/employees`) is open to `admin`, `executive` and
`department_head`. The manager dropdown is limited to the creator's own subtree,
and a manager is required — there is exactly one root.

**Bulk Add** on the same page onboards a whole team from a spreadsheet. Two
buttons: *Sample Excel* downloads the template, *Bulk Add* uploads the filled-in
copy. Both endpoints sit behind the same three roles, and the spreadsheet obeys
the same rules as the form — it is the same `insertEmployee` underneath.

- The template is **generated per caller**, not served from `/public`: its
  Reference sheet carries that user's own manager subtree, so the Manager
  dropdown can only ever offer people they are allowed to place a hire under. A
  department head's copy lists their branch and nothing else.
- Columns are matched by **header text**, so a reordered sheet or an extra column
  of the customer's own still imports. Departments, teams, job roles, locations,
  hierarchy titles and genders are typed as *names* and resolved to ids;
  ambiguity (two teams called "Platform") is reported, never guessed.
- Every lookup column **names its accepted values** — in the hint row under the
  header, in a hover note on the header carrying the full list, and again in any
  rejection. A generic "pick from the dropdown" is the one piece of guidance
  guaranteed to waste the reader's time.
- A `dropWhenEmpty` lookup column (Department, Team, Job Role, Location) is
  **left out of the template entirely** when its table has no rows, which is the
  state of a database built from `db/mssql/` — only `db/pg/02_seed.sql` ever
  populated them. There is no value the writer could put in an empty dropdown
  that would be accepted, so shipping the column can only produce a rejected
  upload. It reappears on its own once the first row exists, and the parser
  still knows the column, so a sheet downloaded earlier keeps importing.
- A row's manager may be someone listed on an **earlier row of the same file**,
  which is what lets a new team arrive with its lead in one upload. Forward
  references are refused rather than reordered.
- The import is **all-or-nothing**. Every row is validated, and every existing
  code/email collision looked up, *before* anything is written; the inserts share
  one transaction. A rejected upload answers `400` with a per-row breakdown of
  everything wrong with the file at once and leaves the directory untouched.

The format lives in `server/src/lib/employeeImport.js` — one module owning both
the template and the parser, so the two cannot drift. It is deliberately
database-free, which is what lets `server/test/employee-import.test.js` round-trip
real workbooks through the real headers with no connection.

---

## 5. Organizational hierarchy and visibility

`employees.manager_id` is the reporting tree: a single self-referencing adjacency
list, one root, ragged by design (some branches stop at `DDVM` or `DPM`, one
reaches `TM` at depth 6).

**Identity.** Three identifiers with separate jobs:

| Identifier | Stability | Purpose |
| ---------- | --------- | ------- |
| `employees.id` (uuid) | Immutable, never reused | FK target, all joins, audit |
| `employees.employee_code` (`PTE0001`) | Stable across transfers | Human/HR reference |
| structural code (`2.3.1.1`) | **Derived in `v_employee_tree`, never stored** | Org-chart display |

The positional code is computed from `sibling_order` at read time. Storing it
would mean renumbering an entire subtree on every transfer — and a code that
renumbers was never a stable identifier. `org_title` is a *label*, not a level:
the reference chart puts `DDVM` at two different depths and `DPM` at two more, so
nothing ties title to depth. Depth is computed.

**Visibility.** One rule, enforced by `visible_employee_ids()` in
`db/pg/07_org_hierarchy.sql` and applied through `server/src/lib/visibility.js`:

| Tier | Who | What they see |
| ---- | --- | ------------- |
| FULL | you + your entire subtree, all levels | the complete record |
| MINIMAL | the chain above you | name, title, photo — nothing else |
| NONE | peers, siblings, other branches | nothing; requests answer `404` |
| admin | everyone | the complete record |

Two properties fall out of the rule rather than being special-cased: a **leaf
employee** sees exactly one person, because their subtree is just themselves; and
the **Executive Officer** sees everyone, because the root's subtree is the
organization. The `executive` permission role grants no extra reach — position in
the tree does.

Out-of-subtree lookups answer **404, not 403**, on purpose: a 403 confirms the id
names a real person, which would let anyone map the company by probing ids.

Hierarchy and permission roles are **orthogonal**. `app_permission_roles` answers
"what features can I use"; the tree answers "whose records can I see". `admin` is
the only role that touches visibility.

**Guards** (all in the database, so they hold for direct SQL too): exactly one
root (`uq_employees_single_root`), nobody manages themselves, and no reporting
cycles (`trg_employees_no_cycle`).

**Org Chart** (`/org-chart`) is open to everyone and shows the viewer's own
subtree plus the name-and-title chain above them.

---
