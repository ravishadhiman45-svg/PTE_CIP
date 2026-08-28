// Where profile images live. Picked once, at module load.
//
//   localDisk  — the server's own filesystem, served by Express. The default,
//                and the right answer for an on-premise install.
//   supabase   — the hosted public bucket. Our own deployment.
//
// Both drivers expose exactly:
//   uploadPublicFile(key, buffer, contentType) -> public URL
//   removePublicFolder(prefix)                 -> number of files removed
//
// so routes/employees.js does not know or care which one is active.
const VALID = ['localDisk', 'supabase'];

const raw = (process.env.STORAGE_DRIVER || 'localDisk').trim();

if (!VALID.includes(raw)) {
  throw new Error(
    `[storage] STORAGE_DRIVER="${raw}" is not recognised. Valid values: ${VALID.join(', ')}`
  );
}

const impl = raw === 'supabase' ? require('./supabase') : require('./localDisk');

module.exports = {
  uploadPublicFile: impl.uploadPublicFile,
  removePublicFolder: impl.removePublicFolder,
  storageConfigured: impl.storageConfigured,
  driver: raw,
  // Only the localDisk driver has these; undefined on supabase.
  UPLOAD_DIR: impl.UPLOAD_DIR,
  BASE_URL: impl.BASE_URL,
  VALID,
};
