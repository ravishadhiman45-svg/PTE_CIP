// Proves every dual constant in the codebase is internally consistent.
//
// This closes a real hole. tools/sql-lint.js deliberately EXEMPTS `pg:`/`mssql:`
// branches from the forbidden-construct check, because divergent SQL is exactly
// what a dual constant is for. The consequence is that a Postgres-ism left by
// accident in an `mssql:` branch is checked by nothing — and would surface only
// when that particular statement ran against a customer's SQL Server.
//
// So: run the real rewriter over every mssql branch, and require the pairs to
// agree on their parameters.

process.env.DB_DIALECT = 'postgres';

const test = require('node:test');
const assert = require('node:assert/strict');

const { rewrite, placeholderInfo } = require('../src/db/rewrite');
const { assertSameParams } = require('../src/db/sql');
const { collectDualBranches } = require('../../tools/sql-lint');

const branches = collectDualBranches();
const mssqlBranches = branches.filter((b) => b.kind === 'mssql');
const pgBranches = branches.filter((b) => b.kind === 'pg');

test('the codebase actually contains dual constants to check', () => {
  assert.ok(mssqlBranches.length >= 40, `expected 40+, found ${mssqlBranches.length}`);
});

test('pg and mssql branches come in matched pairs', () => {
  assert.equal(
    pgBranches.length,
    mssqlBranches.length,
    'every pg: branch needs exactly one mssql: sibling'
  );
});

test('every mssql branch survives the rewriter', () => {
  const failures = [];
  for (const b of mssqlBranches) {
    try {
      rewrite(b.text);
    } catch (err) {
      failures.push(`${b.file}:${b.line}\n    ${err.message.split('\n').slice(0, 3).join('\n    ')}`);
    }
  }
  assert.deepEqual(failures, [], `\n${failures.join('\n\n')}\n`);
});

test('no mssql branch still contains Postgres-only syntax', () => {
  // A second, blunter net: these tokens have no business in T-SQL at all, and
  // catching them by name gives a clearer failure than a rewriter error would.
  const banned = [
    [/\bRETURNING\b/i, 'RETURNING (use OUTPUT)'],
    [/\bON\s+CONFLICT\b/i, 'ON CONFLICT (use MERGE or WHERE NOT EXISTS)'],
    [/\bILIKE\b/i, 'ILIKE (T-SQL collation is already case-insensitive)'],
    [/::/, ':: cast (use CAST)'],
    [/\bLIMIT\b/i, 'LIMIT (use TOP or OFFSET/FETCH)'],
    [/\bFILTER\s*\(/i, 'FILTER (WHERE) (use CASE)'],
    [/\bARRAY_AGG\b/i, 'ARRAY_AGG'],
    [/\bJSON_AGG\b/i, 'JSON_AGG (use FOR JSON PATH)'],
    [/\bNULLS\s+(FIRST|LAST)\b/i, 'NULLS FIRST/LAST'],
    [/\bEXCLUDED\s*\./i, 'EXCLUDED.'],
    [/\bWITHIN\s+GROUP\b/i, 'WITHIN GROUP'],
    [/\bto_char\s*\(/i, 'to_char (use CONVERT/FORMAT)'],
    [/\bUNNEST\b/i, 'UNNEST (use OPENJSON)'],
    [/\bGREATEST\s*\(|\bLEAST\s*\(/i, 'GREATEST/LEAST (not in SQL Server 2019)'],
  ];

  const failures = [];
  for (const b of mssqlBranches) {
    for (const [re, label] of banned) {
      if (re.test(b.text)) failures.push(`${b.file}:${b.line} — ${label}`);
    }
  }
  assert.deepEqual(failures, [], `\n${failures.join('\n')}\n`);
});

test('no pg branch has been accidentally written in T-SQL', () => {
  // The mirror of the check above. A T-SQL-ism in the pg branch would break the
  // dialect that is currently in production, which is the worse direction.
  const banned = [
    [/\bOUTPUT\s+INSERTED\b/i, 'OUTPUT INSERTED (Postgres uses RETURNING)'],
    [/\bMERGE\s+\w+\s+WITH\b/i, 'MERGE ... WITH (hints are T-SQL only)'],
    [/\bOPENJSON\b/i, 'OPENJSON'],
    [/\bSELECT\s+TOP\s+\d/i, 'SELECT TOP'],
    [/\bFOR\s+JSON\s+PATH\b/i, 'FOR JSON PATH'],
    [/\bSYSUTCDATETIME\b/i, 'SYSUTCDATETIME (Postgres uses NOW())'],
    [/WITH\s*\(\s*(UPDLOCK|HOLDLOCK|NOLOCK)/i, 'locking hint'],
    [/\bSTRING_AGG\s*\(/i, 'STRING_AGG (Postgres has string_agg but these pairs use ARRAY_AGG)'],
  ];

  const failures = [];
  for (const b of pgBranches) {
    for (const [re, label] of banned) {
      if (re.test(b.text)) failures.push(`${b.file}:${b.line} — ${label}`);
    }
  }
  assert.deepEqual(failures, [], `\n${failures.join('\n')}\n`);
});

test('paired branches accept the same params array', () => {
  // Pairs are adjacent in source order: pg first, then its mssql sibling.
  const failures = [];
  for (let i = 0; i < Math.min(pgBranches.length, mssqlBranches.length); i += 1) {
    const pg = pgBranches[i];
    const ms = mssqlBranches[i];
    try {
      assertSameParams(pg.text, ms.text);
    } catch (err) {
      failures.push(`${pg.file}:${pg.line} vs ${ms.file}:${ms.line}\n    ${err.message.split('\n')[0]}`);
    }
  }
  assert.deepEqual(failures, [], `\n${failures.join('\n\n')}\n`);
});

test('an mssql branch may reuse a placeholder the pg branch mentions once', () => {
  // This is the property that lets the conditional-insert rewrites work:
  // ON CONFLICT names the conflict column implicitly, whereas WHERE NOT EXISTS
  // has to compare it again, so $1 appears twice.
  const pg = 'INSERT INTO employee_cv (employee_id) VALUES ($1) ON CONFLICT (employee_id) DO NOTHING';
  const ms =
    'INSERT INTO employee_cv (employee_id) SELECT $1 WHERE NOT EXISTS (SELECT 1 FROM employee_cv WHERE employee_id = $1)';

  assert.doesNotThrow(() => assertSameParams(pg, ms));
  assert.deepEqual(placeholderInfo(ms).indices, [1], 'reuse must not create a second parameter');
});

test('mismatched parameter counts are rejected', () => {
  assert.throws(
    () => assertSameParams('SELECT $1, $2 FROM t', 'SELECT $1 FROM t'),
    /disagree on parameter count/
  );
});

test('a gap in the placeholder numbering is rejected', () => {
  assert.throws(
    () => assertSameParams('SELECT $1, $3 FROM t', 'SELECT $1, $3 FROM t'),
    /missing placeholder \$2/
  );
});

test('MERGE statements are semicolon-terminated', () => {
  // T-SQL requires it, and the error SQL Server gives is not obvious.
  for (const b of mssqlBranches) {
    if (/\bMERGE\b/i.test(b.text)) {
      assert.match(b.text.trim(), /;$/, `${b.file}:${b.line} — MERGE must end with a semicolon`);
    }
  }
});

test('MERGE statements carry HOLDLOCK', () => {
  // Without it MERGE is not race-safe, and can raise a duplicate-key error
  // where the Postgres ON CONFLICT it replaces could not.
  for (const b of mssqlBranches) {
    if (/\bMERGE\b/i.test(b.text)) {
      assert.match(
        b.text,
        /WITH\s*\(\s*HOLDLOCK/i,
        `${b.file}:${b.line} — MERGE needs WITH (HOLDLOCK) to be atomic`
      );
    }
  }
});

test('conditional inserts guard the existence check with UPDLOCK/HOLDLOCK', () => {
  // A bare NOT EXISTS lets two callers both see "absent"; one then hits a
  // primary-key violation that the ON CONFLICT version could not produce.
  const failures = [];
  for (const b of mssqlBranches) {
    if (!/\bWHERE\s+NOT\s+EXISTS\b/i.test(b.text)) continue;
    if (!/\bINSERT\b/i.test(b.text)) continue;
    if (!/WITH\s*\(\s*UPDLOCK\s*,\s*HOLDLOCK\s*\)/i.test(b.text)) {
      failures.push(`${b.file}:${b.line}`);
    }
  }
  assert.deepEqual(failures, [], `\nmissing locking hint:\n${failures.join('\n')}\n`);
});

test('OFFSET/FETCH is only used where an ORDER BY exists', () => {
  // T-SQL requires ORDER BY for OFFSET/FETCH; Postgres LIMIT does not, so this
  // is easy to get wrong when translating.
  for (const b of mssqlBranches) {
    if (/\bOFFSET\b[\s\S]*\bFETCH\s+NEXT\b/i.test(b.text)) {
      assert.match(
        b.text,
        /\bORDER\s+BY\b/i,
        `${b.file}:${b.line} — OFFSET/FETCH requires ORDER BY`
      );
    }
  }
});
