#!/usr/bin/env node
// One-shot aid for porting db/pg/01_schema.sql to T-SQL.
//
// This is NOT a build step. It generated the first version of
// db/mssql/01_schema.sql, which is then maintained BY HAND like any other
// migration. Re-running it would discard hand edits, so it exists to be read
// and to document the type mapping, not to be wired into anything.
//
// Usage: node tools/pg-to-tsql-schema.js > db/mssql/01_schema.generated.sql

const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '../db/pg/01_schema.sql');
const src = fs.readFileSync(SRC, 'utf8');

// ---------------------------------------------------------------------------
// Type mapping
// ---------------------------------------------------------------------------
// TEXT is the awkward one. NVARCHAR(MAX) cannot participate in an index key or
// a UNIQUE constraint (900-byte limit for a clustered key), and a great many of
// these columns are codes and names that get indexed. So: NVARCHAR(450) — 900
// bytes, the largest indexable width — except for columns whose names say they
// hold prose, which become NVARCHAR(MAX).
const LONG_TEXT_COLUMNS = /^(description|summary|body|comments?|notes?|level_definition|justification|message|reason|remarks|content|headline)$/i;

function mapType(pgType, columnName, isKeyish) {
  const t = pgType.trim().toUpperCase();

  if (t === 'UUID') return 'UNIQUEIDENTIFIER';
  if (t === 'TIMESTAMPTZ' || t.startsWith('TIMESTAMP WITH')) return 'DATETIMEOFFSET';
  if (t === 'TIMESTAMP') return 'DATETIME2';
  if (t === 'DATE') return 'DATE';
  if (t === 'BOOLEAN' || t === 'BOOL') return 'BIT';
  if (t === 'JSONB' || t === 'JSON') return 'NVARCHAR(MAX)';
  if (t === 'INT' || t === 'INTEGER' || t === 'INT4') return 'INT';
  if (t === 'BIGINT' || t === 'INT8') return 'BIGINT';
  if (t === 'SMALLINT') return 'SMALLINT';
  if (t.startsWith('NUMERIC') || t.startsWith('DECIMAL')) return t.replace(/^NUMERIC/, 'DECIMAL');
  if (t === 'TEXT') {
    if (!isKeyish && LONG_TEXT_COLUMNS.test(columnName)) return 'NVARCHAR(MAX)';
    return 'NVARCHAR(450)';
  }
  if (t.startsWith('VARCHAR') || t.startsWith('CHARACTER VARYING')) {
    return t.replace(/^CHARACTER VARYING/, 'NVARCHAR').replace(/^VARCHAR/, 'NVARCHAR');
  }
  return `/* TODO unmapped: ${pgType} */ NVARCHAR(450)`;
}

// ---------------------------------------------------------------------------
// Parse the CREATE TABLE statements
// ---------------------------------------------------------------------------
const tables = [];
const tableRe = /CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*?)\n\);/g;

let m;
while ((m = tableRe.exec(src)) !== null) {
  const [, name, body] = m;

  // Split the body on top-level commas only, so CHECK (x IN ('a','b')) and
  // NUMERIC(5,2) survive intact.
  const parts = [];
  let depth = 0;
  let cur = '';
  let inStr = false;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (c === "'" ) inStr = !inStr;
    if (!inStr) {
      if (c === '(') depth += 1;
      else if (c === ')') depth -= 1;
      else if (c === ',' && depth === 0) {
        parts.push(cur);
        cur = '';
        continue;
      }
    }
    cur += c;
  }
  if (cur.trim()) parts.push(cur);

  const columns = [];
  for (const raw of parts) {
    const line = raw.trim();
    if (!line || line.startsWith('--')) continue;

    // Table-level constraint rather than a column.
    if (/^(PRIMARY KEY|UNIQUE|CHECK|CONSTRAINT|FOREIGN KEY)\b/i.test(line)) {
      columns.push({ tableConstraint: line });
      continue;
    }

    // The type is ONE identifier, optionally with a precision in parens.
    // A `[\w ]*` here would greedily swallow "NOT NULL REFERENCES employees"
    // into the type and leave the FK clause unparsed — which silently defeats
    // the cascade analysis below.
    const cm = /^(\w+)\s+([A-Za-z][A-Za-z0-9_]*(?:\s*\([^)]*\))?)\s*(.*)$/s.exec(line);
    if (!cm) {
      columns.push({ raw: line, note: 'unparsed' });
      continue;
    }
    const [, colName, colType, rest] = cm;

    const fk = /REFERENCES\s+(\w+)\s*\(\s*(\w+)\s*\)(\s+ON DELETE (CASCADE|SET NULL|NO ACTION))?/i.exec(rest);

    columns.push({
      name: colName,
      pgType: colType,
      rest: rest.trim(),
      isPk: /\bPRIMARY KEY\b/i.test(rest),
      isUnique: /\bUNIQUE\b/i.test(rest),
      fk: fk ? { table: fk[1], column: fk[2], onDelete: (fk[4] || '').toUpperCase() } : null,
    });
  }

  tables.push({ name, columns });
}

// ---------------------------------------------------------------------------
// Cascade-path analysis — the real reason this script exists
// ---------------------------------------------------------------------------
// SQL Server rejects a schema outright when a table can be reached by more than
// one ON DELETE CASCADE path from the same ancestor, or by a self-referencing
// cascade. Postgres has no such restriction, and this schema has 41 cascades,
// so a straight token translation would simply fail to load.
//
// The clearest example: mentor_assignments cascades to employees through BOTH
// mentor_id and mentee_id. Postgres is fine with it; SQL Server errors with
// "may cause cycles or multiple cascade paths".
//
// Resolution: keep the FIRST cascade to a given parent and downgrade the rest to
// NO ACTION, annotating each one. That is safe here because nothing in the API
// deletes an employee, a skill or a course — the only DELETE statements are on
// employee_skill_assignments and the photo column.
const downgrades = [];

for (const table of tables) {
  const seenParents = new Set();

  for (const col of table.columns) {
    if (!col.fk || col.fk.onDelete !== 'CASCADE') continue;

    // A self-referencing cascade is always rejected by SQL Server.
    if (col.fk.table === table.name) {
      col.downgraded = 'self-referencing cascade';
      downgrades.push(`${table.name}.${col.name} -> ${col.fk.table} (self-reference)`);
      continue;
    }

    if (seenParents.has(col.fk.table)) {
      col.downgraded = `second cascade path to ${col.fk.table}`;
      downgrades.push(`${table.name}.${col.name} -> ${col.fk.table} (multiple cascade paths)`);
      continue;
    }
    seenParents.add(col.fk.table);
  }
}

// The check above only catches two cascades to the SAME IMMEDIATE parent.
// SQL Server's restriction is on the whole graph, so a table reachable from one
// ancestor through two different chains is rejected too. This counts paths
// transitively and reports anything left over, rather than leaving it to be
// discovered when the DDL fails to load.
const byName = new Map(tables.map((t) => [t.name, t]));

function cascadeParents(table) {
  const t = byName.get(table);
  if (!t) return [];
  return t.columns
    .filter((c) => c.fk && c.fk.onDelete === 'CASCADE' && !c.downgraded)
    .map((c) => c.fk.table);
}

// Number of distinct cascade paths from `table` up to `ancestor`.
function pathCount(table, ancestor, depth = 0) {
  if (depth > 12) return 0; // cycle guard
  let total = 0;
  for (const parent of cascadeParents(table)) {
    if (parent === ancestor) total += 1;
    total += pathCount(parent, ancestor, depth + 1);
  }
  return total;
}

const transitiveConflicts = [];
for (const table of tables) {
  for (const other of tables) {
    if (other.name === table.name) continue;
    const n = pathCount(table.name, other.name);
    if (n > 1) transitiveConflicts.push(`${table.name} <- ${other.name}: ${n} cascade paths`);
  }
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------
const out = [];
const w = (s = '') => out.push(s);

w('-- =============================================================');
w('-- PTE CIP — SCHEMA (Microsoft SQL Server 2019/2022)');
w('--');
w('-- Ported from db/pg/01_schema.sql. Keep the two in step: the section');
w('-- headings and table order match deliberately so a diff is meaningful.');
w('--');
w('-- Type mapping:');
w('--   UUID         -> UNIQUEIDENTIFIER      DEFAULT NEWID()');
w('--   TEXT         -> NVARCHAR(450)         (900 bytes: the widest indexable key)');
w('--                -> NVARCHAR(MAX)         for prose columns only, which cannot be indexed');
w('--   TIMESTAMPTZ  -> DATETIMEOFFSET        DEFAULT SYSUTCDATETIME()');
w('--   BOOLEAN      -> BIT                   TRUE/FALSE -> 1/0');
w('--   JSONB        -> NVARCHAR(MAX)         + an ISJSON check where it is written as JSON');
w('--   NUMERIC(p,s) -> DECIMAL(p,s)');
w('--');
w('-- NEWID() is used rather than NEWSEQUENTIALID(): sequential GUIDs leak row');
w('-- creation order, and at this data volume the index fragmentation they avoid');
w('-- is not worth that.');
w('-- =============================================================');
w();

if (downgrades.length) {
  w('-- -----------------------------------------------------------------');
  w('-- ON DELETE CASCADE downgraded to NO ACTION');
  w('--');
  w('-- SQL Server refuses a schema where a table is reachable by more than one');
  w('-- cascade path from the same ancestor, or by a self-referencing cascade.');
  w('-- Postgres allows both. Each FK below therefore drops its cascade:');
  w('--');
  for (const d of downgrades) w(`--   ${d}`);
  w('--');
  w('-- Safe here because nothing in the API deletes an employee, skill or');
  w('-- course; the only DELETE statements target employee_skill_assignments.');
  w('-- If row deletion is ever added, these parents need explicit cleanup.');
  w('-- -----------------------------------------------------------------');
  w();
}

for (const table of tables) {
  w(`IF OBJECT_ID('dbo.${table.name}', 'U') IS NULL`);
  w('BEGIN');
  w(`  CREATE TABLE dbo.${table.name} (`);

  const lines = [];
  for (const col of table.columns) {
    if (col.tableConstraint) {
      lines.push(`    ${col.tableConstraint.replace(/\bTRUE\b/gi, '1').replace(/\bFALSE\b/gi, '0')}`);
      continue;
    }
    if (col.raw) {
      lines.push(`    /* TODO review: ${col.raw} */`);
      continue;
    }

    const isKeyish = col.isPk || col.isUnique;
    let rest = col.rest;

    rest = rest
      .replace(/DEFAULT\s+gen_random_uuid\s*\(\s*\)/gi, 'DEFAULT NEWID()')
      .replace(/DEFAULT\s+NOW\s*\(\s*\)/gi, 'DEFAULT SYSUTCDATETIME()')
      .replace(/DEFAULT\s+TRUE\b/gi, 'DEFAULT 1')
      .replace(/DEFAULT\s+FALSE\b/gi, 'DEFAULT 0')
      // T-SQL has neither of these spellings.
      .replace(/DEFAULT\s+CURRENT_DATE\b/gi, 'DEFAULT CAST(SYSUTCDATETIME() AS DATE)')
      .replace(/DEFAULT\s+CURRENT_TIMESTAMP\b/gi, 'DEFAULT SYSUTCDATETIME()');

    if (col.downgraded) {
      rest = rest.replace(/\s*ON DELETE CASCADE/i, '');
      rest += ` /* was ON DELETE CASCADE: ${col.downgraded} */`;
    }

    lines.push(`    ${col.name} ${mapType(col.pgType, col.name, isKeyish)} ${rest}`.trimEnd());
  }
  w(lines.join(',\n'));
  w('  );');
  w('END');
  w('GO');
  w();
}

console.log(out.join('\n'));

// Diagnostics go to stderr so they do not land in the generated file.
console.error(`-- tables: ${tables.length}`);
console.error(`-- cascade downgrades required: ${downgrades.length}`);
for (const d of downgrades) console.error(`--   ${d}`);
console.error(`-- transitive cascade conflicts remaining: ${transitiveConflicts.length}`);
for (const c of transitiveConflicts) console.error(`--   !! ${c}`);
