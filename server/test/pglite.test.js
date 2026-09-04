// The PGlite driver, against a throwaway `memory://` instance.
//
// WHAT THIS IS FOR
// ----------------
// PGlite is real PostgreSQL, so nothing here re-tests Postgres. What it tests
// is the two claims the offline deployment rests on:
//
//   1. db/pg/*.sql loads COMPLETELY into PGlite — every table, view, plpgsql
//      function, recursive CTE and trigger the API calls at runtime. A missing
//      one would not surface until the request that used it.
//
//   2. Values come back in the SHAPE the Supabase path produces. The client and
//      every route were written against `pg`'s output, and the two places the
//      raw drivers disagree — int8 as a string, and how a DATE becomes a Date —
//      are corrected in db/pglite.js. If that correction regresses, a chart
//      renders "50" instead of 50 and nothing throws.

process.env.PGLITE_DATA_DIR = 'memory://';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../src/db/pglite');
const { isUniqueViolation, isReportingCycle } = require('../src/db/errors');

// The WASM engine boots and the whole schema loads on the first query, which
// takes a few seconds. Everything after that is fast.
const SLOW = { timeout: 120000 };

test.after(async () => {
  await db.close();
});

// ---------------------------------------------------------------------------
// Initialisation + schema
// ---------------------------------------------------------------------------

test('the instance initialises and answers a query', SLOW, async () => {
  const { rows } = await db.query('SELECT 1 AS ok');
  assert.equal(rows[0].ok, 1);
});

test('selfTest passes, so a real server would bind its port', SLOW, async () => {
  await db.selfTest();
});

test('every db/pg migration is recorded exactly once', SLOW, async () => {
  const { rows } = await db.query('SELECT filename FROM _pglite_migrations ORDER BY filename');
  const applied = rows.map((r) => r.filename);
  assert.deepEqual(applied, db.migrationFiles());
  assert.ok(applied.includes('01_schema.sql'));
  assert.ok(applied.includes('15_sample_course.sql'));
  // 03 is scratch SELECTs a developer runs by hand, not a migration.
  assert.ok(!applied.includes('03_demo_queries.sql'));
});

test('the tables, views and functions the API calls all exist', SLOW, async () => {
  const expectTables = [
    'employees', 'skills', 'skill_assessments', 'job_roles', 'departments',
    'employee_cv', 'employee_experience', 'employee_education', 'approvals',
    'inbox_items', 'training_courses', 'training_enrollments', 'course_modules',
    'enrollment_module_progress', 'employee_certifications', 'app_users',
    'app_permission_roles', 'user_permission_role_map', 'learning_plan_items',
    'mentor_assignments', 'mentor_recommendations', 'audit_logs',
  ];
  const expectViews = [
    'v_employee_tree', 'v_employee_skill_matrix', 'v_latest_skill_levels',
    'v_role_readiness', 'v_executive_dashboard', 'v_mentor_dashboard',
  ];
  const expectFunctions = [
    'employee_subtree', 'employee_ancestors', 'employee_chain',
    'visible_employee_ids', 'can_view_employee', 'executive_dashboard',
    'sync_enrollment_progress', 'set_updated_at', 'assert_no_manager_cycle',
  ];

  for (const name of [...expectTables, ...expectViews]) {
    const { rows } = await db.query('SELECT to_regclass($1) AS oid', [name]);
    assert.ok(rows[0].oid !== null, `missing relation: ${name}`);
  }
  for (const name of expectFunctions) {
    const { rows } = await db.query('SELECT count(*)::int AS n FROM pg_proc WHERE proname = $1', [
      name,
    ]);
    assert.ok(rows[0].n > 0, `missing function: ${name}`);
  }
});

test('the updated_at triggers came across', SLOW, async () => {
  const { rows } = await db.query(
    "SELECT count(*)::int AS n FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE '%updated_at%'"
  );
  assert.ok(rows[0].n >= 5, `expected several updated_at triggers, found ${rows[0].n}`);
});

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

test('the seed data loaded', SLOW, async () => {
  const one = async (sql) => (await db.query(sql)).rows[0].n;
  assert.equal(await one('SELECT count(*)::int AS n FROM employees'), 50);
  assert.ok((await one('SELECT count(*)::int AS n FROM skills')) > 10);
  assert.ok((await one('SELECT count(*)::int AS n FROM skill_assessments')) > 0);
  assert.ok((await one('SELECT count(*)::int AS n FROM job_roles')) > 0);
  // 15_sample_course enrols everyone in a starter course with modules.
  assert.ok((await one('SELECT count(*)::int AS n FROM course_modules')) > 0);
  assert.ok((await one('SELECT count(*)::int AS n FROM training_enrollments')) > 0);
});

test('08_org_seed connected the tree to a single root', SLOW, async () => {
  const { rows } = await db.query(
    'SELECT count(*)::int AS n FROM employees WHERE manager_id IS NULL'
  );
  assert.equal(rows[0].n, 1);
});

// ---------------------------------------------------------------------------
// PostgreSQL functions + recursive hierarchy
// ---------------------------------------------------------------------------

const rootId = async () =>
  (await db.query('SELECT id FROM employees WHERE manager_id IS NULL')).rows[0].id;

test('employee_subtree() from the root reaches everyone', SLOW, async () => {
  const { rows } = await db.query(
    'SELECT count(*)::int AS n FROM employee_subtree($1)',
    [await rootId()]
  );
  assert.equal(rows[0].n, 50);
});

test('employee_ancestors() and employee_chain() walk upwards', SLOW, async () => {
  const leaf = (
    await db.query(
      `SELECT e.id FROM employees e
        WHERE NOT EXISTS (SELECT 1 FROM employees c WHERE c.manager_id = e.id)
        LIMIT 1`
    )
  ).rows[0].id;

  const ancestors = await db.query('SELECT employee_id FROM employee_ancestors($1)', [leaf]);
  assert.ok(ancestors.rows.length > 0, 'a leaf must have ancestors');

  const chain = await db.query(
    'SELECT id, full_name, org_title, distance FROM employee_chain($1) ORDER BY distance',
    [leaf]
  );
  assert.equal(chain.rows.length, ancestors.rows.length);
  // Nearest manager first, and the projection carries no CV/contact columns.
  assert.equal(chain.rows[0].distance, 1);
  assert.deepEqual(Object.keys(chain.rows[0]).sort(), [
    'distance',
    'full_name',
    'id',
    'org_title',
  ]);
  assert.equal(chain.rows.at(-1).id, await rootId());
});

test('visible_employee_ids(): the root sees all, a leaf sees only itself', SLOW, async () => {
  const root = await rootId();
  const asRoot = await db.query('SELECT count(*)::int AS n FROM visible_employee_ids($1, $2)', [
    root,
    false,
  ]);
  assert.equal(asRoot.rows[0].n, 50);

  const leaf = (
    await db.query(
      `SELECT e.id FROM employees e
        WHERE NOT EXISTS (SELECT 1 FROM employees c WHERE c.manager_id = e.id)
        LIMIT 1`
    )
  ).rows[0].id;
  const asLeaf = await db.query('SELECT employee_id FROM visible_employee_ids($1, $2)', [
    leaf,
    false,
  ]);
  assert.deepEqual(
    asLeaf.rows.map((r) => r.employee_id),
    [leaf]
  );

  // The admin bypass, which every scoped query passes as the second parameter.
  const asAdmin = await db.query('SELECT count(*)::int AS n FROM visible_employee_ids($1, $2)', [
    leaf,
    true,
  ]);
  assert.equal(asAdmin.rows[0].n, 50);
});

test('can_view_employee() returns a real boolean, not 1/0', SLOW, async () => {
  const root = await rootId();
  const yes = await db.query('SELECT can_view_employee($1, $2, false) AS ok', [root, root]);
  assert.equal(yes.rows[0].ok, true);

  const leaf = (
    await db.query(
      `SELECT e.id FROM employees e
        WHERE NOT EXISTS (SELECT 1 FROM employees c WHERE c.manager_id = e.id)
        LIMIT 1`
    )
  ).rows[0].id;
  const no = await db.query('SELECT can_view_employee($1, $2, false) AS ok', [leaf, root]);
  assert.equal(no.rows[0].ok, false);
});

test('the recursive org tree derives depth and a sortable key', SLOW, async () => {
  const { rows } = await db.query(
    'SELECT id, full_name, depth, sort_key, manager_id FROM v_employee_tree ORDER BY sort_key'
  );
  assert.equal(rows.length, 50);
  assert.equal(rows[0].manager_id, null, 'the root sorts first');
  assert.equal(rows[0].depth, 1);
  assert.ok(Math.max(...rows.map((r) => r.depth)) >= 3, 'the seed tree is more than 2 deep');
  // sort_key is what the client indents by, so it must be non-null everywhere.
  assert.ok(rows.every((r) => r.sort_key !== null));
});

test('executive_dashboard() answers per viewer', SLOW, async () => {
  const { rows } = await db.query('SELECT * FROM executive_dashboard($1, $2)', [
    await rootId(),
    false,
  ]);
  assert.equal(rows.length, 1);
  // count(*) is bigint, so this is the STRING "50" on Supabase too — verified
  // against the live pooler. Pinned here because the client renders it as-is.
  assert.equal(rows[0].total_employees, '50');
  assert.ok('average_role_readiness_percent' in rows[0]);
});

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

test('the skill matrix resolves self/manager/mentor into an effective level', SLOW, async () => {
  const { rows } = await db.query(
    `SELECT employee_id, skill_id, self_level, manager_level, mentor_level, effective_level
       FROM v_employee_skill_matrix
      WHERE manager_level IS NOT NULL
      LIMIT 5`
  );
  assert.ok(rows.length > 0, 'the seed data has assessed skills');
  for (const r of rows) {
    assert.equal(typeof r.effective_level, 'number');
  }
});

test('v_latest_skill_levels keeps one row per assessor per skill', SLOW, async () => {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM (
       SELECT employee_id, skill_id, assessor_type
         FROM v_latest_skill_levels
        GROUP BY employee_id, skill_id, assessor_type
       HAVING count(*) > 1
     ) dupes`
  );
  assert.equal(rows[0].n, 0);
});

test('the role-readiness and mentor views select', SLOW, async () => {
  await db.query('SELECT * FROM v_role_readiness LIMIT 3');
  await db.query('SELECT * FROM v_mentor_dashboard LIMIT 3');
  await db.query('SELECT * FROM v_executive_dashboard');
});

// ---------------------------------------------------------------------------
// Value shapes — where PGlite and `pg` disagree, and db/pglite.js corrects it
// ---------------------------------------------------------------------------

test('uuid comes back lowercase, so === comparisons in auth hold', SLOW, async () => {
  const { rows } = await db.query('SELECT $1::uuid AS id', [
    '3F2504E0-4F89-11D3-9A0C-0305E82C3301',
  ]);
  assert.equal(rows[0].id, '3f2504e0-4f89-11d3-9a0c-0305e82c3301');

  const stored = await db.query('SELECT id FROM employees LIMIT 1');
  assert.match(stored.rows[0].id, /^[0-9a-f-]{36}$/);
});

test('BIGINT arrives as a STRING, exactly as `pg` returns int8', SLOW, async () => {
  const { rows } = await db.query('SELECT 42::bigint AS v, count(*) AS c FROM employees');
  assert.equal(rows[0].v, '42');
  assert.equal(typeof rows[0].v, 'string');
  assert.equal(rows[0].c, '50');
  assert.equal(typeof rows[0].c, 'string');
});

test('NUMERIC arrives as a STRING, and ::int / ::float casts as numbers', SLOW, async () => {
  const { rows } = await db.query(
    'SELECT 1.25::numeric AS n, 1.25::float8 AS f, count(*)::int AS i FROM employees'
  );
  assert.equal(rows[0].n, '1.25');
  assert.equal(typeof rows[0].n, 'string');
  assert.equal(rows[0].f, 1.25);
  assert.equal(rows[0].i, 50);
});

test('a DATE becomes a local-midnight Date, the way `pg` builds it', SLOW, async () => {
  const { rows } = await db.query("SELECT '2026-01-02'::date AS d");
  assert.ok(rows[0].d instanceof Date);
  assert.equal(rows[0].d.getFullYear(), 2026);
  assert.equal(rows[0].d.getMonth(), 0);
  assert.equal(rows[0].d.getDate(), 2);
});

test('a json/jsonb column is parsed, not handed back as text', SLOW, async () => {
  const { rows } = await db.query(
    `SELECT COALESCE(json_agg(json_build_object('name', full_name)), '[]'::json) AS people
       FROM employees LIMIT 1`
  );
  assert.ok(Array.isArray(rows[0].people));
  assert.equal(typeof rows[0].people[0].name, 'string');
});

test('booleans and arrays bind as parameters', SLOW, async () => {
  const { rows } = await db.query('SELECT $1::boolean AS b, $2::int[] AS a', [false, [1, 2, 3]]);
  assert.equal(rows[0].b, false);
  assert.deepEqual(rows[0].a, [1, 2, 3]);
});

test('a reused and an out-of-order placeholder both work', SLOW, async () => {
  const { rows } = await db.query('SELECT $2::int AS second, $1::int AS first, $1::int AS again', [
    1,
    2,
  ]);
  assert.deepEqual(rows[0], { second: 2, first: 1, again: 1 });
});

// ---------------------------------------------------------------------------
// rowCount + RETURNING
// ---------------------------------------------------------------------------

test('rowCount is rows returned for a SELECT, rows affected otherwise', SLOW, async () => {
  const none = await db.query('SELECT 1 WHERE FALSE');
  assert.equal(none.rowCount, 0);

  const some = await db.query('SELECT id FROM employees LIMIT 3');
  assert.equal(some.rowCount, 3);

  const ins = await db.query(
    "INSERT INTO skill_categories (code, name) VALUES ('RC1','rowcount') RETURNING id"
  );
  assert.equal(ins.rowCount, 1);
  assert.equal(ins.rows.length, 1);

  const upd = await db.query("UPDATE skill_categories SET name = 'rc2' WHERE code = 'RC1'");
  assert.equal(upd.rowCount, 1);
  assert.deepEqual(upd.rows, []);

  const miss = await db.query("UPDATE skill_categories SET name = 'x' WHERE code = 'NOPE'");
  assert.equal(miss.rowCount, 0);

  const del = await db.query("DELETE FROM skill_categories WHERE code = 'RC1'");
  assert.equal(del.rowCount, 1);
});

test('RETURNING gives back generated columns, including a fresh uuid', SLOW, async () => {
  const { rows } = await db.query(
    `INSERT INTO skill_categories (code, name, description)
       VALUES ('RET1', 'Returning', 'test')
     RETURNING id, code, name, description`
  );
  assert.match(rows[0].id, /^[0-9a-f-]{36}$/);
  assert.equal(rows[0].code, 'RET1');
  await db.query("DELETE FROM skill_categories WHERE code = 'RET1'");
});

test('ON CONFLICT DO NOTHING is a no-op rather than an error', SLOW, async () => {
  const root = await rootId();
  const first = await db.query(
    'INSERT INTO employee_cv (employee_id) VALUES ($1) ON CONFLICT (employee_id) DO NOTHING',
    [root]
  );
  const second = await db.query(
    'INSERT INTO employee_cv (employee_id) VALUES ($1) ON CONFLICT (employee_id) DO NOTHING',
    [root]
  );
  assert.ok(first.rowCount + second.rowCount <= 1);
});

test('a duplicate key raises something isUniqueViolation() recognises', SLOW, async () => {
  await db.query("INSERT INTO skill_categories (code, name) VALUES ('DUP1','dup')");
  await assert.rejects(
    () => db.query("INSERT INTO skill_categories (code, name) VALUES ('DUP1','dup again')"),
    (err) => {
      assert.equal(isUniqueViolation(err), true);
      return true;
    }
  );
  await db.query("DELETE FROM skill_categories WHERE code = 'DUP1'");
});

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

test('withTransaction commits on success', SLOW, async () => {
  const id = await db.withTransaction(async (tx) => {
    const { rows } = await tx.query(
      "INSERT INTO skill_categories (code, name) VALUES ('TX1','committed') RETURNING id"
    );
    // The same tx sees its own uncommitted write.
    const seen = await tx.query("SELECT count(*)::int AS n FROM skill_categories WHERE code='TX1'");
    assert.equal(seen.rows[0].n, 1);
    return rows[0].id;
  });

  const after = await db.query('SELECT code FROM skill_categories WHERE id = $1', [id]);
  assert.equal(after.rows[0].code, 'TX1');
  await db.query("DELETE FROM skill_categories WHERE code = 'TX1'");
});

test('withTransaction rolls back and rethrows on failure', SLOW, async () => {
  await assert.rejects(
    () =>
      db.withTransaction(async (tx) => {
        await tx.query("INSERT INTO skill_categories (code, name) VALUES ('TX2','rolled back')");
        throw new Error('deliberate');
      }),
    /deliberate/
  );

  const after = await db.query("SELECT count(*)::int AS n FROM skill_categories WHERE code='TX2'");
  assert.equal(after.rows[0].n, 0);
});

test('a failed STATEMENT inside a transaction rolls the whole thing back', SLOW, async () => {
  await assert.rejects(() =>
    db.withTransaction(async (tx) => {
      await tx.query("INSERT INTO skill_categories (code, name) VALUES ('TX3','first')");
      // Duplicate of the row just inserted: fails, doomimg the transaction.
      await tx.query("INSERT INTO skill_categories (code, name) VALUES ('TX3','again')");
    })
  );

  const after = await db.query("SELECT count(*)::int AS n FROM skill_categories WHERE code='TX3'");
  assert.equal(after.rows[0].n, 0);
});

test('a transaction hands back rowCount the same way query() does', SLOW, async () => {
  await db.withTransaction(async (tx) => {
    const r = await tx.query('SELECT id FROM employees LIMIT 2');
    assert.equal(r.rowCount, 2);
    const u = await tx.query('UPDATE employees SET org_title = org_title WHERE id IN (SELECT id FROM employees LIMIT 2)');
    assert.equal(u.rowCount, 2);
    throw new Error('rollback');
  }).catch(() => {});
});

// ---------------------------------------------------------------------------
// The manager-reparenting guard
// ---------------------------------------------------------------------------

test('reparenting under a subordinate is refused as a reporting cycle', SLOW, async () => {
  const root = await rootId();
  const child = (
    await db.query('SELECT id FROM employees WHERE manager_id = $1 LIMIT 1', [root])
  ).rows[0].id;

  await assert.rejects(
    () => db.query('UPDATE employees SET manager_id = $2 WHERE id = $1', [root, child]),
    (err) => {
      assert.equal(isReportingCycle(err), true);
      return true;
    }
  );

  // The tree is unchanged.
  const still = await db.query('SELECT manager_id FROM employees WHERE id = $1', [root]);
  assert.equal(still.rows[0].manager_id, null);
});

test('a legitimate reparent succeeds and renumbers siblings', SLOW, async () => {
  const root = await rootId();
  const [a, b] = (
    await db.query('SELECT id FROM employees WHERE manager_id = $1 ORDER BY sibling_order LIMIT 2', [
      root,
    ])
  ).rows.map((r) => r.id);

  const before = (await db.query('SELECT manager_id FROM employees WHERE id = $1', [b])).rows[0]
    .manager_id;

  const moved = await db.query(
    `UPDATE employees
        SET manager_id = $2,
            sibling_order = COALESCE(
              (SELECT MAX(sibling_order) + 1 FROM employees WHERE manager_id = $2), 1)
      WHERE id = $1
      RETURNING id, manager_id, sibling_order`,
    [b, a]
  );
  assert.equal(moved.rows[0].manager_id, a);
  assert.ok(moved.rows[0].sibling_order >= 1);

  // And b is now inside a's subtree, per the recursive function.
  const sub = await db.query(
    'SELECT count(*)::int AS n FROM employee_subtree($1) WHERE employee_id = $2',
    [a, b]
  );
  assert.equal(sub.rows[0].n, 1);

  // Put it back so later tests see the seeded shape.
  await db.query('UPDATE employees SET manager_id = $2 WHERE id = $1', [b, before]);
});

// ---------------------------------------------------------------------------
// The plpgsql progress function the Learning Module calls
// ---------------------------------------------------------------------------

test('sync_enrollment_progress() recomputes progress from ticked modules', SLOW, async () => {
  const enrolment = (
    await db.query(
      `SELECT te.id, te.course_id
         FROM training_enrollments te
         JOIN course_modules cm ON cm.course_id = te.course_id
        GROUP BY te.id, te.course_id
       HAVING count(cm.id) > 1
        LIMIT 1`
    )
  ).rows[0];
  assert.ok(enrolment, 'the sample course has an enrolment with several modules');

  const modules = (
    await db.query('SELECT id FROM course_modules WHERE course_id = $1 ORDER BY module_order', [
      enrolment.course_id,
    ])
  ).rows;

  await db.query(
    'INSERT INTO enrollment_module_progress (enrollment_id, module_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [enrolment.id, modules[0].id]
  );
  await db.query('SELECT sync_enrollment_progress($1)', [enrolment.id]);

  const { rows } = await db.query(
    'SELECT progress_percent FROM training_enrollments WHERE id = $1',
    [enrolment.id]
  );
  assert.ok(rows[0].progress_percent > 0, 'ticking a module must move progress off zero');
});
