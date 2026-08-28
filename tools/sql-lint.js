#!/usr/bin/env node
// Fails the build when SQL in the server cannot run on both dialects.
//
// The rewriter (server/src/db/rewrite.js) handles a CLOSED set of transforms and
// throws on everything else. That protects production, but only once the query
// actually executes — which on a two-dialect codebase can mean "the first time
// the on-premise customer clicks that button". This lint moves the same check to
// authoring time, reading the SAME forbidden list so the two cannot disagree.
//
// A SQL literal is EXEMPT when it is the value of a `pg:` or `mssql:` property,
// i.e. it lives inside a db/sql.js dual constant. That is the whole enforcement
// mechanism: divergent SQL is allowed, but only where the divergence is written
// down explicitly and visible in review.
//
// Usage:
//   node tools/sql-lint.js            report and exit non-zero on violations
//   node tools/sql-lint.js --report   report and always exit 0

process.env.DB_DIALECT = process.env.DB_DIALECT || 'postgres';

const fs = require('fs');
const path = require('path');

const { findForbidden } = require('../server/src/db/rewrite');

const ROOT = path.resolve(__dirname, '../server/src');
const REPORT_ONLY = process.argv.includes('--report');

// ---------------------------------------------------------------------------
// Extract string and template literals from JS source, with line numbers.
// ---------------------------------------------------------------------------
// A real parser would be nicer, but the shape here is narrow: literals passed to
// query()/client.query(). What this MUST get right is not mistaking a quote
// inside a comment or a different literal for a delimiter, so it tracks state
// properly rather than regex-matching.
function extractLiterals(src) {
  const out = [];
  let i = 0;
  let line = 1;

  const lineOf = (idx) => {
    let n = 1;
    for (let k = 0; k < idx; k += 1) if (src[k] === '\n') n += 1;
    return n;
  };

  while (i < src.length) {
    const c = src[i];

    if (c === '\n') {
      line += 1;
      i += 1;
      continue;
    }

    // JS line comment
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }

    // JS block comment
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') line += 1;
        i += 1;
      }
      i += 2;
      continue;
    }

    // Template literal. Interpolations are replaced with a neutral token so an
    // interpolated fragment cannot hide a forbidden keyword, while the
    // surrounding literal text stays checkable.
    if (c === '`') {
      const start = i;
      const startLine = line;
      let text = '';
      i += 1;
      while (i < src.length && src[i] !== '`') {
        if (src[i] === '\\') {
          text += src[i] + (src[i + 1] || '');
          i += 2;
          continue;
        }
        if (src[i] === '$' && src[i + 1] === '{') {
          // Skip to the matching brace, honouring nesting.
          let depth = 1;
          i += 2;
          while (i < src.length && depth > 0) {
            if (src[i] === '{') depth += 1;
            else if (src[i] === '}') depth -= 1;
            else if (src[i] === '\n') line += 1;
            i += 1;
          }
          text += ' __INTERP__ ';
          continue;
        }
        if (src[i] === '\n') line += 1;
        text += src[i];
        i += 1;
      }
      i += 1;
      out.push({ text, line: startLine, index: start });
      continue;
    }

    // Quoted strings
    if (c === "'" || c === '"') {
      const start = i;
      const startLine = line;
      const quote = c;
      let text = '';
      i += 1;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') {
          text += src[i + 1] === 'n' ? '\n' : src[i + 1] || '';
          i += 2;
          continue;
        }
        if (src[i] === '\n') line += 1;
        text += src[i];
        i += 1;
      }
      i += 1;
      out.push({ text, line: startLine, index: start });
      continue;
    }

    i += 1;
  }

  return out;
}

// Does this literal look like a SQL statement or a projection fragment?
function looksLikeSql(text) {
  if (text.length < 12) return false;
  const t = text.toUpperCase();
  const verb = /\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|WITH\s+RECURSIVE)\b/.test(t);
  const clause = /\b(FROM|INTO|SET|WHERE|VALUES|ORDER\s+BY|RETURNING)\b/.test(t);
  // Bare projection fragments (EXPERIENCE_COLUMNS et al) have no verb but do
  // carry dialect-specific functions, so catch those too.
  const fragment = /\b(TO_CHAR|ARRAY_AGG|JSON_AGG|FILTER\s*\()\b/.test(t);
  return (verb && clause) || fragment;
}

// Is this literal the value of a `pg:` / `mssql:` key — i.e. inside a dual
// constant, where divergence is intentional and declared?
function isDualBranch(src, index) {
  const before = src.slice(Math.max(0, index - 40), index);
  return /\b(pg|mssql)\s*:\s*$/.test(before);
}

// ---------------------------------------------------------------------------
// GROUP BY functional-dependency check.
// ---------------------------------------------------------------------------
// Postgres lets you GROUP BY a table's primary key and then select any other
// column of that table ("functional dependency"). T-SQL does not: every
// non-aggregated selected column must appear in GROUP BY. This is invisible to
// the token-level forbidden list, produces no Postgres error, and fails only at
// runtime on SQL Server.
//
// Expanding the GROUP BY list is valid in BOTH dialects, so the fix is a plain
// edit rather than a dual constant.
//
// Heuristic, hence reported as a WARNING: it strips aggregate calls with real
// paren matching, but it does not parse subqueries, so an alias.column that only
// appears inside a correlated subquery can still show up as a false positive.
// FILTER is included because its WHERE clause is part of the aggregate, not a
// bare projection — without it, COUNT(x) FILTER (WHERE y > 0) reports `y` as an
// ungrouped column.
const AGGREGATES = /\b(COUNT|SUM|AVG|MIN|MAX|STRING_AGG|ARRAY_AGG|JSON_AGG|JSONB_AGG|ROUND|BOOL_OR|BOOL_AND|FILTER)\s*\(/i;

// Removes aggregate calls (innermost first) so what remains is the set of
// genuinely bare column references.
function stripAggregates(projection) {
  let text = projection;
  for (let guard = 0; guard < 50; guard += 1) {
    const m = AGGREGATES.exec(text);
    if (!m) break;
    const open = m.index + m[0].length - 1;
    let depth = 1;
    let i = open + 1;
    while (i < text.length && depth > 0) {
      if (text[i] === '(') depth += 1;
      else if (text[i] === ')') depth -= 1;
      i += 1;
    }
    text = text.slice(0, m.index) + ' ' + text.slice(i);
  }
  return text;
}

function checkGroupBy(sqlText) {
  const upper = sqlText.toUpperCase();
  const gbIdx = upper.lastIndexOf('GROUP BY');
  if (gbIdx === -1) return null;
  const selIdx = upper.indexOf('SELECT');
  const fromIdx = upper.indexOf('FROM', selIdx);
  if (selIdx === -1 || fromIdx === -1 || fromIdx > gbIdx) return null;

  const projection = stripAggregates(sqlText.slice(selIdx + 6, fromIdx));

  // GROUP BY runs to the next clause keyword.
  const tail = sqlText.slice(gbIdx + 8);
  const stop = tail.search(/\b(ORDER\s+BY|HAVING|LIMIT|OFFSET|FETCH|UNION|\))/i);
  const groupTerms = (stop === -1 ? tail : tail.slice(0, stop))
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  const grouped = new Set(groupTerms);
  const missing = [];
  for (const m of projection.matchAll(/\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/gi)) {
    const ref = `${m[1]}.${m[2]}`.toLowerCase();
    if (!grouped.has(ref) && !missing.includes(ref)) missing.push(ref);
  }

  return missing.length > 0 ? missing : null;
}

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

// ---------------------------------------------------------------------------

const files = walk(ROOT).sort();
const violations = [];
const groupByWarnings = [];
let checked = 0;
let exempt = 0;

for (const file of files) {
  // The db/ layer itself contains the forbidden list and its own test fixtures.
  if (file.includes(`${path.sep}db${path.sep}`)) continue;

  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(path.resolve(__dirname, '..'), file).split(path.sep).join('/');

  for (const lit of extractLiterals(src)) {
    if (!looksLikeSql(lit.text)) continue;

    // The GROUP BY check applies to BOTH branches of a dual constant, since the
    // pg branch is where the functional-dependency shortcut gets written.
    const missing = checkGroupBy(lit.text);
    if (missing) groupByWarnings.push({ file: rel, line: lit.line, missing });

    if (isDualBranch(src, lit.index)) {
      exempt += 1;
      continue;
    }

    checked += 1;
    const hits = findForbidden(lit.text);
    if (hits.length > 0) {
      violations.push({ file: rel, line: lit.line, hits, snippet: lit.text.trim().slice(0, 90) });
    }
  }
}

if (groupByWarnings.length > 0) {
  console.log('--- WARNING: GROUP BY may rely on Postgres functional dependency ---');
  console.log('T-SQL requires every non-aggregated selected column in GROUP BY.');
  console.log('Expanding the list is valid in both dialects.\n');
  for (const w of groupByWarnings) {
    console.log(`${w.file}:${w.line}`);
    console.log(`    not grouped: ${w.missing.join(', ')}\n`);
  }
}

const byName = new Map();
for (const v of violations) {
  for (const h of v.hits) byName.set(h.name, (byName.get(h.name) || 0) + 1);
}

console.log(`sql-lint: ${checked} single-dialect SQL literal(s) checked, ${exempt} exempt (dual constants)\n`);

if (violations.length === 0) {
  console.log('No violations. All SQL is translatable to T-SQL or declared as a dual constant.');
  process.exit(0);
}

for (const v of violations) {
  console.log(`${v.file}:${v.line}`);
  for (const h of v.hits) console.log(`    ${h.name.padEnd(18)} ${h.hint}`);
  console.log(`    | ${v.snippet.replace(/\s+/g, ' ')}\n`);
}

console.log('--- summary by construct ---');
for (const [name, count] of [...byName.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(3)}  ${name}`);
}
console.log(`\n${violations.length} SQL literal(s) need a dual constant (db/sql.js).`);

process.exit(REPORT_ONLY ? 0 : 1);
