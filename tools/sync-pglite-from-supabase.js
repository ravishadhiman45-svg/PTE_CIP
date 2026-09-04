#!/usr/bin/env node
// Mirrors the Supabase database into the local PGlite one.
//
// WHY THIS IS A MIRROR AND NOT AN INSERT OF THE MISSING ROWS
// ---------------------------------------------------------
// The two databases have diverged structurally, not just by a few rows. On
// Supabase the reporting tree was RE-ROOTED — a person added through the app is
// now the root, and the seeded Executive Officer reports to them. PGlite still
// has the seed's root.
//
// You cannot reconcile that by inserting the missing people:
//
//   * `uq_employees_single_root` permits exactly one row with manager_id IS
//     NULL, so the new root cannot be inserted while the old one is still root;
//   * the old root cannot be given a manager first, because every employee is
//     inside its subtree, so any manager for it is a reporting cycle and
//     trg_employees_no_cycle rejects it.
//
// Both orders are blocked. Deleting each table and re-inserting the source rows
// sidesteps it entirely: at no point do two roots or a cycle exist.
//
// HOW IT AVOIDS FIGHTING THE SCHEMA
// ---------------------------------
// `session_replication_role = replica` turns off user triggers AND foreign-key
// enforcement for the transaction, so tables can be loaded in any order and the
// source's own `updated_at` values survive instead of being overwritten by
// set_updated_at(). Verified to work in PGlite; the unique INDEXES stay live
// (they are not triggers), which is fine — the source has exactly one root, so
// there is never a second one to collide with.
//
// Everything happens in ONE transaction. A failure part-way leaves the local
// database exactly as it was.
//
// Usage, from anywhere in the repo, with server/.env configured:
//
//   node tools/sync-pglite-from-supabase.js            # dry run: report only
//   node tools/sync-pglite-from-supabase.js --apply    # actually write
//
// The local API must be STOPPED first — PGlite holds an exclusive lock on the
// data directory.

const path = require('path');

// Dependencies live in server/node_modules, and node resolves from THIS file's
// directory upward, which never reaches it. Same reason as in
// tools/migrate-photo-urls.js.
const SERVER_DIR = path.resolve(__dirname, '../server');
const dotenv = require(require.resolve('dotenv', { paths: [SERVER_DIR] }));
const { Pool } = require(require.resolve('pg', { paths: [SERVER_DIR] }));

dotenv.config({ path: path.join(SERVER_DIR, '.env') });

const APPLY = process.argv.includes('--apply');

// PGlite's own bookkeeping. Wiping this would make the next start re-apply
// every file in db/pg/ on top of the data we just loaded.
const NEVER_TOUCH = new Set(['_pglite_migrations']);

// Rows are inserted one statement per chunk. Nothing here is big — the largest
// table is ~100 rows — but Postgres caps a statement at 65535 parameters, so
// this keeps the script honest if the data ever grows.
const CHUNK = 500;

const q = (id) => `"${id.replace(/"/g, '""')}"`;

async function baseTables(run) {
  const { rows } = await run(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`
  );
  return rows.map((r) => r.table_name);
}

async function columns(run, table) {
  const { rows } = await run(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [table]
  );
  return rows.map((r) => r.column_name);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set in server/.env — nothing to read from.');
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: (process.env.PGSSL || '').toLowerCase() === 'disable' ? false : { rejectUnauthorized: false },
  });
  const source = (text, params) => pool.query(text, params);

  // PG_DRIVER is forced so this works whatever server/.env currently says: the
  // point of the script is to write to PGlite while reading from the server.
  process.env.PG_DRIVER = 'pglite';
  const lite = require(path.join(SERVER_DIR, 'src/db/pglite'));

  console.log(`source : ${process.env.DATABASE_URL.replace(/:[^:@/]*@/, ':***@')}`);
  console.log(`target : ${lite.dataDir}`);
  console.log(`mode   : ${APPLY ? 'APPLY — the local database will be overwritten' : 'dry run'}`);
  console.log();

  const [srcTables, dstTables] = [await baseTables(source), await baseTables(lite.query)];
  const dstSet = new Set(dstTables);

  const tables = srcTables.filter((t) => dstSet.has(t) && !NEVER_TOUCH.has(t));
  const skipped = srcTables.filter((t) => !dstSet.has(t));

  // Read everything from the source FIRST, so a mid-read failure never leaves
  // the local database half-written.
  const plan = [];
  for (const table of tables) {
    const [srcCols, dstCols] = [await columns(source, table), await columns(lite.query, table)];
    const dstColSet = new Set(dstCols);
    const cols = srcCols.filter((c) => dstColSet.has(c));
    const dropped = srcCols.filter((c) => !dstColSet.has(c));

    const { rows } = await source(`SELECT ${cols.map(q).join(', ')} FROM ${q(table)}`);
    const before = (await lite.query(`SELECT count(*)::int AS n FROM ${q(table)}`)).rows[0].n;

    plan.push({ table, cols, rows, before, dropped });
  }
  await pool.end();

  let width = 0;
  for (const p of plan) width = Math.max(width, p.table.length);

  for (const p of plan) {
    const delta = p.rows.length - p.before;
    const sign = delta === 0 ? '   =' : delta > 0 ? `+${delta}` : String(delta);
    console.log(
      `  ${p.table.padEnd(width)}  local ${String(p.before).padStart(4)} -> ` +
        `${String(p.rows.length).padStart(4)}  ${sign.padStart(5)}` +
        (p.dropped.length ? `   (source-only columns ignored: ${p.dropped.join(', ')})` : '')
    );
  }

  if (skipped.length) {
    console.log();
    console.log(`  not in the local schema, skipped: ${skipped.join(', ')}`);
  }

  if (!APPLY) {
    console.log();
    console.log('Dry run. Re-run with --apply to write.');
    await lite.close();
    return;
  }

  console.log();
  await lite.withTransaction(async (tx) => {
    // Triggers and FK enforcement off for this transaction only.
    await tx.query('SET LOCAL session_replication_role = replica');

    // Every table is emptied before anything is inserted, so a child row can
    // never outlive the parent it referenced.
    for (const p of plan) await tx.query(`DELETE FROM ${q(p.table)}`);

    for (const p of plan) {
      if (p.rows.length === 0) continue;

      const colList = p.cols.map(q).join(', ');
      for (let i = 0; i < p.rows.length; i += CHUNK) {
        const chunk = p.rows.slice(i, i + CHUNK);
        const params = [];
        const tuples = chunk.map((row) => {
          const slots = p.cols.map((c) => {
            params.push(row[c]);
            return `$${params.length}`;
          });
          return `(${slots.join(', ')})`;
        });
        await tx.query(
          `INSERT INTO ${q(p.table)} (${colList}) VALUES ${tuples.join(', ')}`,
          params
        );
      }
    }
  });

  // Verified AFTER the commit, and by counting rather than by trusting the
  // insert: a silently-empty table is the failure this is guarding against.
  let bad = 0;
  for (const p of plan) {
    const after = (await lite.query(`SELECT count(*)::int AS n FROM ${q(p.table)}`)).rows[0].n;
    if (after !== p.rows.length) {
      console.log(`  MISMATCH ${p.table}: expected ${p.rows.length}, found ${after}`);
      bad += 1;
    }
  }

  const total = plan.reduce((n, p) => n + p.rows.length, 0);
  console.log(
    bad === 0
      ? `Done. ${total} rows across ${plan.length} tables, all verified.`
      : `Done with ${bad} mismatched table(s) — see above.`
  );

  await lite.close();
  if (bad > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.message);
  if (/lock|EBUSY|in use/i.test(err.message)) {
    console.error('\nIs the local API still running? PGlite holds an exclusive lock on the data directory.');
  }
  process.exit(1);
});
