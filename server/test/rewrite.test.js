// Edge-case suite for the Postgres -> T-SQL rewriter.
//
// The rewriter is the highest-risk component in the dual-dialect design: it
// silently changes SQL that is then executed against a customer's database.
// Everything it is ALLOWED to do is asserted here, and — just as important —
// everything it must REFUSE to do is asserted too, because the value of a
// closed transform set is entirely in the closure.

process.env.DB_DIALECT = 'postgres';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  rewrite,
  findForbidden,
  placeholderInfo,
  scan,
  applyTransforms,
} = require('../src/db/rewrite');

const forbidden = (sql) => findForbidden(sql).map((f) => f.name);

// ---------------------------------------------------------------------------
// Placeholders
// ---------------------------------------------------------------------------

test('placeholders: $n becomes @pn', () => {
  assert.equal(rewrite('SELECT * FROM t WHERE a = $1'), 'SELECT * FROM t WHERE a = @p1');
});

test('placeholders: multi-digit indices are not split', () => {
  // A naive /\$(\d)/ would turn $10 into "@p1 0".
  assert.equal(rewrite('SELECT $1, $9, $10, $11'), 'SELECT @p1, @p9, @p10, @p11');
});

test('placeholders: OUT-OF-ORDER indices keep their numbers', () => {
  // routes/verification.js:92 — a positional `?` conversion would swap these.
  const sql = 'WHERE approval_type = $2 AND entity_id = $1';
  assert.equal(rewrite(sql), 'WHERE approval_type = @p2 AND entity_id = @p1');
});

test('placeholders: REUSED index stays the same name at both sites', () => {
  // routes/verification.js:110 — $2 appears twice. Named params make this free;
  // positional conversion would need the value duplicated in the array.
  const sql = "VALUES ($1,$2,$3,'employee_cv',$2,'Pending')";
  assert.equal(rewrite(sql), "VALUES (@p1,@p2,@p3,'employee_cv',@p2,'Pending')");
});

test('placeholders: dynamic numbering from visibility.js survives splicing', () => {
  // Mirrors lib/visibility.js:41-44 exactly: the fragment is built with runtime
  // indices, spliced into a bigger query, and only then rewritten.
  const params = ['Active'];
  params.push('viewer-uuid', false);
  const fragment = `SELECT employee_id FROM visible_employee_ids($${params.length - 1}, $${params.length})`;
  const full = `SELECT * FROM employees e WHERE e.employment_status = $1 AND e.id IN (${fragment})`;

  assert.equal(
    rewrite(full),
    'SELECT * FROM employees e WHERE e.employment_status = @p1 ' +
      'AND e.id IN (SELECT employee_id FROM dbo.visible_employee_ids(@p2, @p3))'
  );
});

test('placeholderInfo reports distinct indices, de-duplicating reuse', () => {
  assert.deepEqual(placeholderInfo('VALUES ($1,$2,$3,$2)'), { indices: [1, 2, 3], max: 3 });
});

test('placeholderInfo ignores placeholders inside literals', () => {
  assert.deepEqual(placeholderInfo("SELECT 'costs $5' , $1"), { indices: [1], max: 1 });
});

// ---------------------------------------------------------------------------
// Literal / comment safety — the whole reason for a scanner
// ---------------------------------------------------------------------------

test('literals: $n inside a string is NOT a placeholder', () => {
  const sql = "SELECT 'total cost $100' AS label WHERE id = $1";
  assert.equal(rewrite(sql), "SELECT 'total cost $100' AS label WHERE id = @p1");
});

test('literals: doubled quote escape does not end the string early', () => {
  // If '' were read as a close+open, the ILIKE inside would get rewritten.
  const sql = "SELECT 'it''s ILIKE nothing' AS x, y ILIKE $1";
  assert.equal(rewrite(sql), "SELECT 'it''s ILIKE nothing' AS x, y LIKE @p1");
});

test('literals: forbidden token inside a string is not a violation', () => {
  assert.deepEqual(forbidden("SELECT 'ON CONFLICT' AS note"), []);
  assert.deepEqual(forbidden("SELECT 'LIMIT 5' AS note"), []);
});

test('comments: line comment contents are inert', () => {
  const sql = 'SELECT a\n-- LIMIT 5 and ON CONFLICT and ::cast\nFROM t WHERE b = $1';
  assert.deepEqual(forbidden(sql), []);
  assert.match(rewrite(sql), /-- LIMIT 5 and ON CONFLICT and ::cast/);
});

test('comments: block comment contents are inert, and nesting is handled', () => {
  const sql = 'SELECT /* outer /* inner RETURNING */ still comment */ a FROM t';
  assert.deepEqual(forbidden(sql), []);
  assert.equal(rewrite(sql), sql);
});

test('identifiers: quoted and bracketed identifiers are preserved verbatim', () => {
  const sql = 'SELECT "weird ILIKE col", [ON CONFLICT] FROM t WHERE x = $1';
  assert.equal(rewrite(sql), 'SELECT "weird ILIKE col", [ON CONFLICT] FROM t WHERE x = @p1');
});

test('scan: round-trips losslessly', () => {
  const samples = [
    "SELECT 'a''b' -- c\n FROM t /* d */ WHERE x = $1",
    'SELECT [a]]b], "c""d" FROM t',
    'SELECT $$dollar quoted $1 ILIKE$$ AS x',
  ];
  for (const s of samples) {
    assert.equal(scan(s).map((seg) => seg.text).join(''), s);
  }
});

test('dollar-quoted body is not treated as placeholders', () => {
  const sql = 'SELECT $$body with $1 and ILIKE$$ AS x, $1';
  assert.equal(rewrite(sql), 'SELECT $$body with $1 and ILIKE$$ AS x, @p1');
});

// ---------------------------------------------------------------------------
// Token transforms
// ---------------------------------------------------------------------------

test('ILIKE becomes LIKE', () => {
  assert.equal(
    rewrite('WHERE e.full_name ILIKE $1 OR e.email ILIKE $1'),
    'WHERE e.full_name LIKE @p1 OR e.email LIKE @p1'
  );
});

test('NOW() becomes SYSUTCDATETIME(), with or without inner space', () => {
  assert.equal(rewrite('SET decided_at = NOW()'), 'SET decided_at = SYSUTCDATETIME()');
  assert.equal(rewrite('SET decided_at = now( )'), 'SET decided_at = SYSUTCDATETIME()');
});

test('JOIN ... ON TRUE becomes ON 1=1', () => {
  // routes/dashboard.js:48
  assert.equal(rewrite('JOIN departments d ON TRUE'), 'JOIN departments d ON 1=1');
});

test('boolean literals become BIT values', () => {
  assert.equal(rewrite('WHERE active = TRUE'), 'WHERE active = 1');
  assert.equal(rewrite('SELECT can_view_employee($1, $2, false)'), 'SELECT dbo.can_view_employee(@p1, @p2, 0)');
});

// ---------------------------------------------------------------------------
// NULLS LAST — the one ordering transform, and its unsafe sibling
// ---------------------------------------------------------------------------

test('DESC NULLS LAST is stripped, because T-SQL DESC already sorts NULL last', () => {
  assert.equal(
    rewrite('ORDER BY ec.issued_date DESC NULLS LAST, e.full_name'),
    'ORDER BY ec.issued_date DESC, e.full_name'
  );
});

test('every NULLS LAST in the real codebase is the DESC form', () => {
  // If this ever fails, someone added an ASC NULLS LAST and it must become a
  // dual constant rather than being silently mistranslated.
  const realOrderings = [
    'ORDER BY ec.issued_date DESC NULLS LAST, e.full_name',
    'ORDER BY coverage_percent DESC NULLS LAST',
    'ORDER BY sort_order, start_date DESC NULLS LAST',
    'ORDER BY sort_order, end_year DESC NULLS LAST',
    'ORDER BY effective_level DESC NULLS LAST, skill_name',
    'ORDER BY last_interaction DESC NULLS LAST, mentee.full_name',
    'ORDER BY readiness_percent DESC NULLS LAST',
  ];
  for (const o of realOrderings) {
    assert.doesNotThrow(() => rewrite(o), `should translate: ${o}`);
    assert.ok(!/NULLS/i.test(rewrite(o)));
  }
});

test('ASC NULLS LAST is REFUSED — it is not equivalent in T-SQL', () => {
  assert.deepEqual(forbidden('ORDER BY x ASC NULLS LAST'), ['NULLS FIRST/LAST']);
  assert.throws(() => rewrite('ORDER BY x ASC NULLS LAST'), /NULLS FIRST\/LAST/);
});

test('NULLS FIRST is REFUSED in both directions', () => {
  assert.throws(() => rewrite('ORDER BY x DESC NULLS FIRST'), /NULLS FIRST\/LAST/);
  assert.throws(() => rewrite('ORDER BY x ASC NULLS FIRST'), /NULLS FIRST\/LAST/);
});

// ---------------------------------------------------------------------------
// dbo. qualification
// ---------------------------------------------------------------------------

test('our functions get a dbo. prefix', () => {
  assert.equal(
    rewrite('SELECT employee_id FROM visible_employee_ids($1, $2)'),
    'SELECT employee_id FROM dbo.visible_employee_ids(@p1, @p2)'
  );
  assert.equal(
    rewrite('SELECT id, full_name FROM employee_chain($1)'),
    'SELECT id, full_name FROM dbo.employee_chain(@p1)'
  );
});

test('dbo. is not applied twice', () => {
  assert.equal(
    rewrite('FROM dbo.visible_employee_ids($1, $2)'),
    'FROM dbo.visible_employee_ids(@p1, @p2)'
  );
});

test('a function name NOT followed by a call paren is left alone', () => {
  // A column or alias that happens to share the name must not be qualified.
  assert.equal(rewrite('SELECT employee_subtree FROM t'), 'SELECT employee_subtree FROM t');
});

test('a longer identifier containing a function name is left alone', () => {
  assert.equal(
    rewrite('SELECT my_employee_subtree_cache(1)'),
    'SELECT my_employee_subtree_cache(1)'
  );
});

test('built-in aggregates are never qualified', () => {
  const sql = 'SELECT COUNT(*), COALESCE(a, 0), ROUND(AVG(b), 1) FROM t';
  assert.equal(rewrite(sql), sql);
});

// ---------------------------------------------------------------------------
// The forbidden set — each entry proven to be caught
// ---------------------------------------------------------------------------

test('LIMIT is refused, including inside a correlated subquery', () => {
  // routes/employees.js:367 — the exact shape that makes a regex TOP rewrite
  // unsafe. It must be REFUSED, not guessed at.
  const sql = `SELECT e.id,
      (SELECT m.full_name FROM mentor_assignments ma
        ORDER BY ma.start_date ASC LIMIT 1) AS mentor_name
    FROM employees e`;
  assert.deepEqual(forbidden(sql), ['LIMIT']);
  assert.throws(() => rewrite(sql), /LIMIT/);
});

test('each forbidden construct from the real codebase is detected', () => {
  const cases = {
    'SELECT count(*)::int FROM t': '::cast',
    'INSERT INTO t VALUES ($1) ON CONFLICT (id) DO NOTHING': 'ON CONFLICT',
    'UPDATE t SET a = $1 RETURNING id': 'RETURNING',
    'SELECT COUNT(*) FILTER (WHERE x >= 100) FROM t': 'FILTER (WHERE)',
    'SELECT ARRAY_AGG(DISTINCT k) FROM t': 'ARRAY_AGG',
    'SELECT JSON_AGG(DISTINCT s.name) FROM t': 'JSON_AGG',
    "ORDER BY string_to_array(code, '.')": 'STRING_TO_ARRAY',
    'SELECT * FROM UNNEST($1, $2)': 'UNNEST',
    'SELECT DISTINCT ON (a) a, b FROM t': 'DISTINCT ON',
    'WHERE id = ANY($1)': '= ANY(...)',
    'DO UPDATE SET a = EXCLUDED.a': 'EXCLUDED.',
    'SELECT GREATEST(a, 0)': 'GREATEST/LEAST',
    "SELECT to_char(start_date, 'YYYY-MM-DD')": 'to_char',
    'SELECT * FROM t OFFSET 10': 'OFFSET',
    'SELECT generate_series(1, 10)': 'GENERATE_SERIES',
  };
  for (const [sql, expected] of Object.entries(cases)) {
    assert.ok(
      forbidden(sql).includes(expected),
      `expected ${expected} for: ${sql} (got ${JSON.stringify(forbidden(sql))})`
    );
    assert.throws(() => rewrite(sql), /cannot be auto-translated/, sql);
  }
});

test('EXCLUDED. detection is not fooled by a column named excluded_at', () => {
  assert.deepEqual(forbidden('SELECT excluded_at FROM t'), []);
});

test('rewrite errors carry a machine-readable code', () => {
  try {
    rewrite('SELECT a FROM t LIMIT 1');
    assert.fail('should have thrown');
  } catch (err) {
    assert.equal(err.code, 'ESQLDIALECT');
  }
});

// ---------------------------------------------------------------------------
// Idempotence, caching, and degenerate inputs
// ---------------------------------------------------------------------------

test('rewriting is stable when applied to already-safe SQL', () => {
  const sql = 'SELECT a FROM t WHERE b = $1';
  const once = rewrite(sql);
  assert.equal(rewrite(sql), once, 'cached result must match');
  // Re-running the transforms on output must not corrupt it.
  assert.equal(applyTransforms(once), once);
});

test('degenerate inputs do not throw', () => {
  for (const s of ['', '   ', '--only a comment', "'unterminated", '/* unterminated']) {
    assert.doesNotThrow(() => rewrite(s), JSON.stringify(s));
  }
});

test('unterminated literal swallows the rest rather than leaking transforms', () => {
  // Failing closed: better to send SQL Server a syntax error than to silently
  // rewrite tokens the author intended as data.
  assert.equal(rewrite("SELECT 'oops $1 ILIKE"), "SELECT 'oops $1 ILIKE");
});
