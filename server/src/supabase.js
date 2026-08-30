const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'avatars';

const configured = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);

if (!configured) {
  console.warn(
    '[storage] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — profile picture uploads are disabled.'
  );
}

// Service-role key bypasses RLS, so never expose this client to the browser.
const supabase = configured
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

// Uploads a buffer and returns the public URL.
// `path` is relative to the bucket, e.g. "<employeeId>/avatar-1700000000.png".
async function uploadPublicFile(path, buffer, contentType) {
  if (!supabase) {
    const err = new Error(
      'File storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server/.env.'
    );
    err.status = 503;
    throw err;
  }

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType, upsert: true });

  if (error) {
    const err = new Error(
      `Upload failed: ${error.message}. Check that a public bucket named "${BUCKET}" exists.`
    );
    err.status = 502;
    throw err;
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

// Deletes every stored object under `prefix` (e.g. "<employeeId>/") and returns
// how many were removed. Clearing a profile picture has to purge the objects,
// not just the DB pointer — the bucket is public, so an un-deleted file stays
// reachable by url forever, which defeats the point of removing it.
async function removePublicFolder(prefix) {
  if (!supabase) return 0;

  let removed = 0;
  // list() pages at 100. Delete each page and re-list from the top until the
  // folder is empty; the page cap only guards against looping forever if a
  // delete ever silently no-ops.
  for (let page = 0; page < 20; page += 1) {
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: 100 });
    if (error) {
      const err = new Error(`Could not list stored files: ${error.message}`);
      err.status = 502;
      throw err;
    }
    if (!data || data.length === 0) return removed;

    const paths = data.map((entry) => `${prefix}${entry.name}`);
    const { error: removeError } = await supabase.storage.from(BUCKET).remove(paths);
    if (removeError) {
      const err = new Error(`Could not delete stored files: ${removeError.message}`);
      err.status = 502;
      throw err;
    }
    removed += paths.length;
  }

  return removed;
}

// Deletes specific objects. removePublicFolder() above is the sweep used when a
// whole folder goes away; this is the single-object case — replacing one
// certificate file must not touch the rest of that employee's stored files.
async function removePublicFiles(paths) {
  if (!supabase || !paths || paths.length === 0) return 0;

  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error) {
    const err = new Error(`Could not delete stored files: ${error.message}`);
    err.status = 502;
    throw err;
  }
  return paths.length;
}

module.exports = {
  supabase,
  uploadPublicFile,
  removePublicFolder,
  removePublicFiles,
  BUCKET,
  storageConfigured: configured,
};
