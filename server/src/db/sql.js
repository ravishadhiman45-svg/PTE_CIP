// Dual constants, for SQL the rewriter refuses to translate.
//
// Usage:
//   const Q_UPSERT_CV = sql({
//     pg: `INSERT INTO employee_cv (employee_id) VALUES ($1)
//          ON CONFLICT (employee_id) DO NOTHING`,
//     mssql: `INSERT INTO employee_cv (employee_id)
//             SELECT $1 WHERE NOT EXISTS (
//               SELECT 1 FROM employee_cv WHERE employee_id = $1)`,
//   });
//
// Two properties worth keeping in mind when writing one:
//
//  1. BOTH branches are authored with $n placeholders and the SAME parameter
//     list. The mssql branch still goes through the rewriter, so it gets
//     $n -> @pn, dbo. qualification and boolean marshalling for free — you are
//     only overriding the STRUCTURE, not opting out of the pipeline.
//
//  2. Because mssql binds by name, a placeholder may be REUSED in the mssql
//     branch even if the pg branch mentions it once (see the $1 twice above).
//     What you must not do is introduce a placeholder index the caller does not
//     pass; assertSameParams() below catches that.

const { dialect } = require('./dialect');
const { placeholderInfo } = require('./rewrite');

// Both branches must consume the same parameters, or a single `params` array
// cannot serve both. Catching this at module load turns a
// production-only-on-one-dialect bug into a startup crash.
function assertSameParams(pg, mssql) {
  const a = placeholderInfo(pg);
  const b = placeholderInfo(mssql);

  if (a.max !== b.max) {
    throw new Error(
      `[db] dual SQL branches disagree on parameter count (pg uses $1..$${a.max}, ` +
        `mssql uses $1..$${b.max}). They must accept the same params array.\n` +
        `pg: ${pg.trim().slice(0, 160)}`
    );
  }

  // A gap means the caller passes a value nothing reads — usually a copy/paste
  // slip while writing the second branch.
  for (const info of [a, b]) {
    for (let n = 1; n <= info.max; n += 1) {
      if (!info.indices.includes(n)) {
        throw new Error(
          `[db] dual SQL is missing placeholder $${n} (uses ${info.indices.join(', ')}). ` +
            'Renumber so the params array has no unused slots.'
        );
      }
    }
  }
}

// Picks the branch for the active dialect. Validated eagerly, so a malformed
// pair fails at require() time rather than on the first request that hits it.
function sql({ pg, mssql }) {
  if (typeof pg !== 'string' || typeof mssql !== 'string') {
    throw new Error('[db] sql() needs both a `pg` and an `mssql` branch');
  }
  assertSameParams(pg, mssql);
  return dialect === 'mssql' ? mssql : pg;
}

module.exports = { sql, assertSameParams };
