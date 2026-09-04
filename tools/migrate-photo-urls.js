#!/usr/bin/env node
// Repoints employees.photo_url from a Supabase Storage bucket to local disk.
//
// WHY THIS IS NEEDED
// ------------------
// photo_url stores an ABSOLUTE url, so switching STORAGE_DRIVER does not move
// existing pictures — the rows keep pointing at
// https://<project>.supabase.co/storage/v1/object/public/avatars/<id>/<file>.
// On an offline install that host is usually unreachable, so every avatar
// that already existed silently degrades to initials while newly uploaded ones
// work. The failure is quiet and easy to mistake for "the upload feature is
// broken".
//
// The object KEY is preserved (`<employeeId>/<filename>`), so a picture keeps
// its identity and the timestamped cache-busting still works.
//
// Usage, from the repo root, with server/.env configured:
//
//   node tools/migrate-photo-urls.js              # dry run: report only
//   node tools/migrate-photo-urls.js --download   # also fetch the files
//   node tools/migrate-photo-urls.js --apply      # write the new urls
//   node tools/migrate-photo-urls.js --download --apply
//
// Dry run is the default deliberately: this rewrites a column in place.

// Dependencies live in server/node_modules, and node resolves from THIS file's
// directory upward — which never reaches it. So dotenv is resolved explicitly.
// ../server/src/db needs no help: its own requires resolve from server/.
const SERVER_DIR = require('path').resolve(__dirname, '../server');
const dotenv = require(require.resolve('dotenv', { paths: [SERVER_DIR] }));

dotenv.config({ path: require('path').join(SERVER_DIR, '.env') });

const fs = require('fs/promises');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const DOWNLOAD = process.argv.includes('--download');

const db = require('../server/src/db');

// Relative to server/, NOT to the working directory — the same rule
// storage/localDisk.js applies. path.resolve() against cwd would write the
// avatars into a second folder the running API never reads from.
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(SERVER_DIR, process.env.UPLOAD_DIR)
  : path.join(SERVER_DIR, 'uploads');
const BASE_URL = (process.env.PUBLIC_FILE_BASE_URL || 'http://localhost:4000/files').replace(
  /\/+$/,
  ''
);

// Pulls the "<employeeId>/<filename>" tail out of whatever url is stored.
//
// Anchored on the employee-id-shaped segment rather than on a Supabase url
// shape, so this also works for a url that was already migrated once, or that
// came from some other host.
function extractKey(url) {
  const m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[^/?#]+)(?:[?#]|$)/i.exec(
    url
  );
  return m ? m[1] : null;
}

async function fileExists(key) {
  try {
    await fs.access(path.join(UPLOAD_DIR, key));
    return true;
  } catch {
    return false;
  }
}

async function download(url, key) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const target = path.join(UPLOAD_DIR, key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buf);
  return buf.length;
}

async function main() {
  console.log(`db driver   : ${db.driver}`);
  console.log(`upload dir  : ${UPLOAD_DIR}`);
  console.log(`new base    : ${BASE_URL}`);
  console.log(`mode        : ${APPLY ? 'APPLY' : 'dry run'}${DOWNLOAD ? ' + download' : ''}\n`);

  const { rows } = await db.query(
    `SELECT id, employee_code, full_name, photo_url
       FROM employees
      WHERE photo_url IS NOT NULL AND photo_url <> ''
      ORDER BY employee_code`
  );

  if (rows.length === 0) {
    console.log('No employees have a photo_url. Nothing to migrate.');
    return;
  }

  const alreadyLocal = [];
  const unparsable = [];
  const missingFile = [];
  const ready = [];

  for (const row of rows) {
    if (row.photo_url.startsWith(`${BASE_URL}/`)) {
      alreadyLocal.push(row);
      continue;
    }
    const key = extractKey(row.photo_url);
    if (!key) {
      unparsable.push(row);
      continue;
    }
    row.key = key;
    row.newUrl = `${BASE_URL}/${key}`;

    if (DOWNLOAD && !(await fileExists(key))) {
      try {
        const bytes = await download(row.photo_url, key);
        console.log(`  downloaded ${key} (${bytes} bytes)`);
      } catch (err) {
        console.log(`  FAILED to download ${key}: ${err.message}`);
      }
    }

    if (await fileExists(key)) ready.push(row);
    else missingFile.push(row);
  }

  console.log('');
  console.log(`already local     : ${alreadyLocal.length}`);
  console.log(`ready to repoint  : ${ready.length}`);
  console.log(`file not on disk  : ${missingFile.length}`);
  console.log(`url not parseable : ${unparsable.length}`);

  if (missingFile.length) {
    console.log('\nNo local file for these — run with --download while the old host is');
    console.log('still reachable, or copy the bucket contents into the upload dir:');
    for (const r of missingFile) console.log(`  ${r.employee_code}  ${r.key}`);
  }

  if (unparsable.length) {
    console.log('\nCould not find an "<employeeId>/<file>" key in these urls; fix by hand:');
    for (const r of unparsable) console.log(`  ${r.employee_code}  ${r.photo_url}`);
  }

  if (!APPLY) {
    console.log(`\nDry run — nothing written. Re-run with --apply to repoint ${ready.length} row(s).`);
    return;
  }

  if (ready.length === 0) {
    console.log('\nNothing to write.');
    return;
  }

  // One transaction: a half-migrated column is worse than an unmigrated one,
  // because it makes the remaining rows look like they were never affected.
  await db.withTransaction(async (tx) => {
    for (const row of ready) {
      await tx.query('UPDATE employees SET photo_url = $2 WHERE id = $1', [row.id, row.newUrl]);
    }
  });

  console.log(`\nRepointed ${ready.length} row(s).`);

  // Rows whose file is missing are deliberately LEFT pointing at the old url.
  // A row pointing at an unreachable picture degrades to initials; a row
  // pointing at a local file that does not exist looks identical but hides the
  // fact that the image was never transferred.
  if (missingFile.length) {
    console.log(`Left ${missingFile.length} row(s) on the old url — their files are not local yet.`);
  }
}

main()
  .then(() => db.close())
  .catch(async (err) => {
    console.error(`\n${err.message}`);
    await db.close().catch(() => {});
    process.exit(1);
  });
