// Profile images on the server's own disk, served by Express.
//
// This is the offline replacement for the Supabase Storage bucket. A machine
// running the PGlite deployment generally has no outbound path to Supabase —
// and if it does, avatar images leaving the premises may itself violate the
// policy that drove the offline requirement in the first place.
//
// Same two-function contract as storage/supabase.js, so the call sites in
// routes/employees.js (:992 upload, :1016 purge) do not change.

const fs = require('fs/promises');
const path = require('path');

// A RELATIVE UPLOAD_DIR resolves against the server package root, not the
// process working directory.
//
// path.resolve() would use cwd, which is fine when you start the app with
// `npm run dev` from server/ and quietly wrong everywhere else: a Windows
// service starts in C:\Windows\System32, and a process manager may start it from
// the repo root. Either way the app would create a second, empty upload folder
// and every existing avatar would 404 — with no error anywhere to explain it.
const SERVER_ROOT = path.resolve(__dirname, '../..');

function resolveUploadDir(configured) {
  if (!configured) return path.join(SERVER_ROOT, 'uploads');
  return path.isAbsolute(configured) ? configured : path.resolve(SERVER_ROOT, configured);
}

const UPLOAD_DIR = resolveUploadDir(process.env.UPLOAD_DIR);

// Absolute, because employees.photo_url is read straight into an <img src>
// from a DIFFERENT origin (the Next.js client on :3000, the API on :4000).
// A relative path would resolve against the client and 404.
const BASE_URL = (process.env.PUBLIC_FILE_BASE_URL || 'http://localhost:4000/files').replace(
  /\/+$/,
  ''
);

// The object key is built from a route parameter (`${id}/avatar-...`), so it is
// untrusted input reaching a filesystem path. Resolve it and require the result
// to stay inside UPLOAD_DIR: without this, an id of "../../src" would let a
// caller write anywhere the process can reach.
//
// Checked with a separator-terminated prefix so that a sibling directory named
// like UPLOAD_DIR + suffix (e.g. "uploads-evil") cannot pass.
function resolveInside(key) {
  const target = path.resolve(UPLOAD_DIR, key);
  const root = UPLOAD_DIR.endsWith(path.sep) ? UPLOAD_DIR : UPLOAD_DIR + path.sep;

  if (target !== UPLOAD_DIR && !target.startsWith(root)) {
    const err = new Error('Invalid storage path');
    err.status = 400;
    throw err;
  }
  return target;
}

// Uploads a buffer and returns its public URL.
// `key` is relative to the storage root, e.g. "<employeeId>/avatar-1700000000.png".
async function uploadPublicFile(key, buffer, _contentType) {
  const target = resolveInside(key);

  await fs.mkdir(path.dirname(target), { recursive: true });
  // Overwrites by design — matches the bucket's `upsert: true`.
  await fs.writeFile(target, buffer);

  // Always forward slashes: this is a URL, not a filesystem path, and on
  // Windows `key` may arrive with backslashes.
  return `${BASE_URL}/${key.split(path.sep).join('/').replace(/^\/+/, '')}`;
}

// Deletes every stored file under `prefix` (e.g. "<employeeId>/") and returns
// how many were removed.
//
// Clearing a profile picture has to purge the files, not just the DB pointer:
// the directory is served statically, so an un-deleted file stays reachable by
// URL forever, which defeats the point of removing it.
async function removePublicFolder(prefix) {
  const target = resolveInside(prefix);

  let entries;
  try {
    entries = await fs.readdir(target, { withFileTypes: true });
  } catch (err) {
    // Nothing stored for this employee yet is the normal case, not an error.
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return 0;
    throw err;
  }

  const files = entries.filter((e) => e.isFile());
  await Promise.all(files.map((e) => fs.unlink(path.join(target, e.name))));

  // Drop the now-empty directory too, so the tree does not accumulate one
  // stale folder per employee who ever removed a picture.
  try {
    await fs.rmdir(target);
  } catch {
    // A non-empty or already-gone directory is fine; the files are what matter.
  }

  return files.length;
}

// Deletes specific objects by key. removePublicFolder() above is the sweep used
// when a whole folder goes away; this is the single-object case — replacing one
// certificate file must not touch the rest of that employee's stored files.
//
// A key that is already gone counts as removed rather than raising: the caller
// deletes the file AFTER committing the row that pointed at it, so a retry must
// not turn a successful edit into a 500.
async function removePublicFiles(keys) {
  if (!keys || keys.length === 0) return 0;

  let removed = 0;
  for (const key of keys) {
    const target = resolveInside(key);
    try {
      await fs.unlink(target);
      removed += 1;
    } catch (err) {
      if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') throw err;
    }
  }
  return removed;
}

module.exports = {
  uploadPublicFile,
  removePublicFolder,
  removePublicFiles,
  UPLOAD_DIR,
  BASE_URL,
  storageConfigured: true,
  driver: 'localDisk',
  // exported for tests
  resolveInside,
};
