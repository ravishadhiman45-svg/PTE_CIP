// Postgres-flavoured SQL -> T-SQL, for the closed set of transforms that are
// provably safe to do on a token stream.
//
// WHY A CLOSED SET
// ----------------
// A regex sweep over SQL text is a correctness landmine, and this codebase
// contains the exact shape that proves it: `LIMIT 1` appears inside CORRELATED
// SCALAR SUBQUERIES (routes/employees.js:367,371,392 and routes/mentor.js:38).
// Translating LIMIT to TOP means moving a token to just after a SELECT keyword,
// and a regex asked to find "the" SELECT finds the OUTER one — silently turning
// a directory listing into a single row. There is no way to get that right
// without a real parser.
//
// So this module handles ONLY transforms that are position-preserving and
// literal-safe. Everything else is FORBIDDEN: rewrite() throws, and
// tools/sql-lint.js reads the same list to fail the build at authoring time.
// That turns "do we trust a regex on SQL?" into "we have mechanically proven
// the input is inside the safe subset."
//
// Every transform below is applied only to CODE segments. String literals,
// quoted identifiers and comments are carved out first, so a query containing
// 'cost $100' or `-- LIMIT 5` is never touched.

const { DB_FUNCTIONS } = require('./dialect');

// ---------------------------------------------------------------------------
// Scanner: split SQL into code / non-code segments.
// ---------------------------------------------------------------------------
// Non-code = anything whose contents must survive byte-for-byte:
//   'single quoted'        with '' escaping
//   "quoted ident"         with "" escaping
//   [bracket ident]        with ]] escaping
//   -- line comment
//   block comments, nesting-aware (Postgres allows nesting; T-SQL tolerates it)
//   $tag$ dollar quoted $tag$   (only in DDL, but cheap to be safe about)
function scan(sql) {
  const segments = [];
  let buf = '';
  let i = 0;

  const flush = () => {
    if (buf) {
      segments.push({ code: true, text: buf });
      buf = '';
    }
  };
  const emit = (text) => {
    flush();
    segments.push({ code: false, text });
  };

  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];

    // line comment
    if (c === '-' && next === '-') {
      let j = i;
      while (j < sql.length && sql[j] !== '\n') j += 1;
      emit(sql.slice(i, j));
      i = j;
      continue;
    }

    // block comment, nesting-aware
    if (c === '/' && next === '*') {
      let j = i + 2;
      let depth = 1;
      while (j < sql.length && depth > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*') {
          depth += 1;
          j += 2;
        } else if (sql[j] === '*' && sql[j + 1] === '/') {
          depth -= 1;
          j += 2;
        } else {
          j += 1;
        }
      }
      emit(sql.slice(i, j));
      i = j;
      continue;
    }

    // Dollar-quoted string. Must be checked before the $n placeholder rule.
    if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        const stop = end === -1 ? sql.length : end + tag.length;
        emit(sql.slice(i, stop));
        i = stop;
        continue;
      }
    }

    // Quoted runs. A doubled delimiter is an escaped delimiter, not a close.
    if (c === "'" || c === '"' || c === '[') {
      const close = c === '[' ? ']' : c;
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === close) {
          if (sql[j + 1] === close) {
            j += 2;
            continue;
          }
          j += 1;
          break;
        }
        j += 1;
      }
      emit(sql.slice(i, j));
      i = j;
      continue;
    }

    buf += c;
    i += 1;
  }

  flush();
  return segments;
}

// ---------------------------------------------------------------------------
// Forbidden constructs. Each must be expressed as an explicit dual constant
// via db/sql.js rather than translated here.
// ---------------------------------------------------------------------------
const FORBIDDEN = [
  {
    name: 'LIMIT',
    re: /\bLIMIT\b/i,
    hint: 'T-SQL needs TOP or OFFSET/FETCH, and LIMIT inside a correlated subquery cannot be relocated safely',
  },
  // Postgres `OFFSET n` only. The T-SQL form is `OFFSET n ROWS FETCH NEXT m
  // ROWS ONLY`, which is legitimate and must not be flagged — hence the
  // lookahead for a following ROWS rather than a bare keyword match.
  {
    name: 'OFFSET',
    re: /\bOFFSET\b(?!\s+\S+\s+ROWS\b)/i,
    hint: 'use OFFSET n ROWS FETCH NEXT m ROWS ONLY, with an explicit ORDER BY',
  },
  { name: '::cast', re: /::/, hint: 'use CAST(x AS type)' },
  {
    name: 'ON CONFLICT',
    re: /\bON\s+CONFLICT\b/i,
    hint: 'use MERGE, or INSERT ... WHERE NOT EXISTS',
  },
  {
    name: 'RETURNING',
    re: /\bRETURNING\b/i,
    hint: 'use OUTPUT INSERTED.* (restricted on tables carrying triggers)',
  },
  {
    name: 'FILTER (WHERE)',
    re: /\bFILTER\s*\(/i,
    hint: 'use COUNT(CASE WHEN p THEN 1 END) / SUM(CASE ...)',
  },
  { name: 'ARRAY_AGG', re: /\bARRAY_AGG\b/i, hint: 'use STRING_AGG and split in JS' },
  { name: 'JSON_AGG', re: /\bJSON_AGG\b/i, hint: 'use FOR JSON PATH, or aggregate in JS' },
  { name: 'STRING_TO_ARRAY', re: /\bSTRING_TO_ARRAY\b/i, hint: 'no array type in T-SQL' },
  { name: 'UNNEST', re: /\bUNNEST\b/i, hint: 'pass JSON and use OPENJSON' },
  {
    name: 'GENERATE_SERIES',
    re: /\bGENERATE_SERIES\b/i,
    hint: 'use a numbers table or a recursive CTE',
  },
  {
    name: 'DISTINCT ON',
    re: /\bDISTINCT\s+ON\b/i,
    hint: 'use ROW_NUMBER() OVER (PARTITION BY ...)',
  },
  { name: '= ANY(...)', re: /=\s*ANY\s*\(/i, hint: 'use IN (...) or a table-valued parameter' },
  {
    name: 'EXCLUDED.',
    re: /\bEXCLUDED\s*\./i,
    hint: 'MERGE exposes the source row under its own alias',
  },
  {
    name: 'GREATEST/LEAST',
    re: /\b(GREATEST|LEAST)\s*\(/i,
    hint: 'not available before SQL Server 2022; use a CASE expression',
  },
  {
    name: 'to_char',
    re: /\bTO_CHAR\s*\(/i,
    hint: 'use CONVERT(varchar(10), d, 23) or FORMAT()',
  },
  { name: 'SIMILAR TO', re: /\bSIMILAR\s+TO\b/i, hint: 'use LIKE, or PATINDEX' },
  // Ordered-set aggregates. T-SQL has no MODE() at all, and its PERCENTILE_CONT
  // is a window function with completely different syntax.
  {
    name: 'WITHIN GROUP',
    re: /\bWITHIN\s+GROUP\b/i,
    hint: 'no ordered-set aggregates in T-SQL; use TOP 1 ... GROUP BY, or a window function',
  },
  {
    name: 'BOOL_OR/BOOL_AND',
    re: /\b(BOOL_OR|BOOL_AND|EVERY)\s*\(/i,
    hint: 'use MAX(CASE WHEN p THEN 1 ELSE 0 END) / MIN(...)',
  },
  {
    name: 'json_build_object',
    re: /\b(JSONB?_BUILD_OBJECT|JSONB?_AGG|ROW_TO_JSON)\s*\(/i,
    hint: 'use FOR JSON PATH',
  },
  // EXISTS in a PROJECTION, not in a WHERE clause.
  //
  // Postgres treats EXISTS(...) as a boolean expression, so it can be selected
  // directly. T-SQL has no boolean expression type: EXISTS is only ever a
  // predicate, and `EXISTS (...) AS x` in a select list is a syntax error.
  //
  // The `) AS` tail is what distinguishes the two uses — EXISTS inside a WHERE
  // is perfectly portable and must not be flagged. One level of nested parens is
  // matched, which covers every case in this codebase.
  {
    name: 'EXISTS as a column',
    re: /\bEXISTS\s*\((?:[^()]|\([^()]*\))*\)\s+AS\b/i,
    hint: 'T-SQL allows EXISTS only as a predicate; use CAST(CASE WHEN EXISTS (...) THEN 1 ELSE 0 END AS bit)',
  },
  // NULLS FIRST, and the ASC form of NULLS LAST, change ordering semantics.
  // Checked AFTER the DESC NULLS LAST transform has removed the safe case.
  {
    name: 'NULLS FIRST/LAST',
    re: /\bNULLS\s+(FIRST|LAST)\b/i,
    hint: 'only "DESC NULLS LAST" is auto-translated; T-SQL sorts NULL as the lowest value',
  },
];

// ---------------------------------------------------------------------------
// The safe transforms.
// ---------------------------------------------------------------------------
function applyTransforms(code) {
  let out = code;

  // $1 -> @p1. Order- and index-preserving, which is what makes this safe for
  // the two patterns that would break a positional `?` conversion:
  // out-of-order placeholders (routes/verification.js:92) and REUSED ones
  // (routes/verification.js:110, routes/employees.js:203). Never convert to `?`.
  out = out.replace(/\$(\d+)/g, '@p$1');

  // SQL Server's default collation is case-insensitive, so LIKE already
  // behaves the way ILIKE does on Postgres.
  out = out.replace(/\bILIKE\b/gi, 'LIKE');

  // NOW() is timestamptz; SYSUTCDATETIME() is the closest UTC equivalent.
  out = out.replace(/\bNOW\s*\(\s*\)/gi, 'SYSUTCDATETIME()');

  // T-SQL has no boolean literal, so JOIN ... ON TRUE needs a real predicate.
  out = out.replace(/\bON\s+TRUE\b/gi, 'ON 1=1');

  // "DESC NULLS LAST" -> "DESC".
  //
  // A genuine no-op rather than a lossy shortcut: T-SQL sorts NULL as the
  // LOWEST value, so a DESC ordering already places NULLs last, which is
  // exactly what the Postgres clause asks for. All 8 occurrences in this
  // codebase are DESC. The ASC form would NOT be equivalent, so it is left
  // alone here and then rejected by the FORBIDDEN scan.
  out = out.replace(/\bDESC\s+NULLS\s+LAST\b/gi, 'DESC');

  // Bare boolean literals -> BIT. Covers `active = TRUE` and the `false`
  // argument in can_view_employee($1,$2,false) at lib/visibility.js:51.
  out = out.replace(/\bTRUE\b/gi, '1').replace(/\bFALSE\b/gi, '0');

  // Schema-qualify our own functions. Scalar UDFs REQUIRE two-part naming in
  // T-SQL; table-valued ones conventionally use it. Word-boundary anchored,
  // skipped when already qualified, and only when followed by a call paren.
  for (const fn of DB_FUNCTIONS) {
    out = out.replace(new RegExp(`(?<!\\.)\\b${fn}\\b(?=\\s*\\()`, 'gi'), `dbo.${fn}`);
  }

  return out;
}

// Scans a Postgres SQL string for constructs the mssql path cannot translate.
// Shared by rewrite() at runtime and tools/sql-lint.js at build time, so the
// two can never disagree about what "safe" means.
function findForbidden(sql, { alreadyTransformed = false } = {}) {
  const hits = [];
  for (const seg of scan(sql)) {
    if (!seg.code) continue;
    const text = alreadyTransformed ? seg.text : applyTransforms(seg.text);
    for (const f of FORBIDDEN) {
      if (f.re.test(text)) hits.push({ name: f.name, hint: f.hint });
    }
  }
  const seen = new Set();
  return hits.filter((h) => (seen.has(h.name) ? false : (seen.add(h.name), true)));
}

const cache = new Map();

// Rewrites one Postgres SQL string for SQL Server. Throws on anything outside
// the safe subset, naming the construct and its intended replacement.
function rewrite(sql) {
  const hit = cache.get(sql);
  if (hit !== undefined) return hit;

  const transformed = scan(sql)
    .map((seg) => (seg.code ? applyTransforms(seg.text) : seg.text))
    .join('');

  const forbidden = findForbidden(transformed, { alreadyTransformed: true });
  if (forbidden.length > 0) {
    const list = forbidden.map((f) => `  - ${f.name}: ${f.hint}`).join('\n');
    const err = new Error(
      `[db] This SQL cannot be auto-translated to T-SQL:\n${list}\n` +
        'Express it as a dual constant via db/sql.js instead.\n' +
        `SQL: ${sql.trim().slice(0, 300)}`
    );
    err.code = 'ESQLDIALECT';
    throw err;
  }

  cache.set(sql, transformed);
  return transformed;
}

// Which placeholder indices the statement actually uses.
// mssql binds by name, so a REUSED placeholder must be bound exactly once —
// this is what lets routes/verification.js:110 ($2 used twice) work unchanged.
function placeholderInfo(sql) {
  const seen = new Set();
  let max = 0;
  for (const seg of scan(sql)) {
    if (!seg.code) continue;
    for (const m of seg.text.matchAll(/\$(\d+)/g)) {
      const n = Number(m[1]);
      seen.add(n);
      if (n > max) max = n;
    }
  }
  return { indices: [...seen].sort((a, b) => a - b), max };
}

module.exports = { rewrite, findForbidden, placeholderInfo, scan, applyTransforms, FORBIDDEN };
