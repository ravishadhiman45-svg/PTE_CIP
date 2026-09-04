// Profile images on local disk.
//
// The object key is built from a route parameter (`${id}/avatar-...` in
// routes/employees.js:990), so it is untrusted input reaching a filesystem
// path. The traversal tests below are the point of this file.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

// A throwaway upload root, set before the module reads UPLOAD_DIR at load time.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ptecip-storage-'));
process.env.UPLOAD_DIR = ROOT;
process.env.PUBLIC_FILE_BASE_URL = 'http://localhost:4000/files';

const storage = require('../src/storage/localDisk');

const EMP = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

test.after(async () => {
  await fsp.rm(ROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

test('upload writes the file and returns an absolute public URL', async () => {
  const key = `${EMP}/avatar-1700000000.png`;
  const url = await storage.uploadPublicFile(key, png, 'image/png');

  // Absolute, because employees.photo_url is rendered into an <img src> from a
  // DIFFERENT origin (client on :3000, API on :4000). A relative path would
  // resolve against the client and 404.
  assert.equal(url, `http://localhost:4000/files/${key}`);
  assert.ok(url.startsWith('http'), 'must be absolute');

  const written = await fsp.readFile(path.join(ROOT, EMP, 'avatar-1700000000.png'));
  assert.deepEqual(written, png);
});

test('upload creates intermediate directories', async () => {
  const key = 'aaaaaaaa-0000-0000-0000-000000000009/nested/deep/avatar.png';
  await storage.uploadPublicFile(key, png, 'image/png');
  assert.ok(fs.existsSync(path.join(ROOT, key)));
});

test('re-uploading the same key overwrites, matching the bucket upsert', async () => {
  const key = `${EMP}/avatar-overwrite.png`;
  await storage.uploadPublicFile(key, Buffer.from('first'), 'image/png');
  await storage.uploadPublicFile(key, Buffer.from('second'), 'image/png');
  const written = await fsp.readFile(path.join(ROOT, key), 'utf8');
  assert.equal(written, 'second');
});

test('the returned URL always uses forward slashes', async () => {
  // On Windows the key can arrive with backslashes; a URL must not.
  const url = await storage.uploadPublicFile(
    `${EMP}${path.sep}avatar-slashes.png`,
    png,
    'image/png'
  );
  assert.ok(!url.includes('\\'), url);
  assert.equal(url, `http://localhost:4000/files/${EMP}/avatar-slashes.png`);
});

// ---------------------------------------------------------------------------
// Removal
// ---------------------------------------------------------------------------

test('removePublicFolder deletes every file and reports the count', async () => {
  const emp = 'bbbbbbbb-0000-0000-0000-000000000001';
  await storage.uploadPublicFile(`${emp}/a.png`, png, 'image/png');
  await storage.uploadPublicFile(`${emp}/b.png`, png, 'image/png');

  const removed = await storage.removePublicFolder(`${emp}/`);
  assert.equal(removed, 2);

  // Purging the files is the point: the directory is served statically, so a
  // surviving file stays reachable by URL forever.
  assert.equal(fs.existsSync(path.join(ROOT, emp, 'a.png')), false);
  assert.equal(fs.existsSync(path.join(ROOT, emp, 'b.png')), false);
});

test('removing a folder that never existed is 0, not an error', async () => {
  // The normal case for an employee who never uploaded a picture.
  assert.equal(await storage.removePublicFolder('cccccccc-0000-0000-0000-000000000099/'), 0);
});

test('removing twice is idempotent', async () => {
  const emp = 'dddddddd-0000-0000-0000-000000000001';
  await storage.uploadPublicFile(`${emp}/a.png`, png, 'image/png');
  assert.equal(await storage.removePublicFolder(`${emp}/`), 1);
  assert.equal(await storage.removePublicFolder(`${emp}/`), 0);
});

test('the emptied directory is cleaned up', async () => {
  // Otherwise the tree accumulates one stale folder per employee who ever
  // removed a picture.
  const emp = 'eeeeeeee-0000-0000-0000-000000000001';
  await storage.uploadPublicFile(`${emp}/a.png`, png, 'image/png');
  await storage.removePublicFolder(`${emp}/`);
  assert.equal(fs.existsSync(path.join(ROOT, emp)), false);
});

// ---------------------------------------------------------------------------
// Path traversal — the security-relevant part
// ---------------------------------------------------------------------------

test('traversal out of the upload root is refused', async () => {
  const attacks = [
    '../escaped.png',
    '../../escaped.png',
    `${EMP}/../../escaped.png`,
    '../../../../../../etc/passwd',
    './../escaped.png',
  ];

  for (const key of attacks) {
    await assert.rejects(
      () => storage.uploadPublicFile(key, png, 'image/png'),
      /Invalid storage path/,
      `should refuse: ${key}`
    );
  }
});

test('a refused upload sets HTTP 400, not 500', async () => {
  // A malformed id is a client error; it should not read as a server fault.
  try {
    await storage.uploadPublicFile('../escaped.png', png, 'image/png');
    assert.fail('should have thrown');
  } catch (err) {
    assert.equal(err.status, 400);
  }
});

test('traversal is refused for removal too', async () => {
  await assert.rejects(() => storage.removePublicFolder('../'), /Invalid storage path/);
  await assert.rejects(() => storage.removePublicFolder(`${EMP}/../../`), /Invalid storage path/);
});

test('nothing escaped the upload root during the traversal attempts', async () => {
  const parent = path.dirname(ROOT);
  assert.equal(fs.existsSync(path.join(parent, 'escaped.png')), false);
});

test('a sibling directory sharing the root prefix cannot be reached', async () => {
  // The containment check must compare against ROOT + separator. Comparing bare
  // string prefixes would let "<root>-evil" pass as inside "<root>".
  const sibling = `${path.basename(ROOT)}-evil`;
  await assert.rejects(
    () => storage.uploadPublicFile(`../${sibling}/x.png`, png, 'image/png'),
    /Invalid storage path/
  );
});

test('an absolute key cannot redirect the write', async () => {
  const absolute = process.platform === 'win32' ? 'C:\\Windows\\Temp\\evil.png' : '/tmp/evil.png';
  await assert.rejects(
    () => storage.uploadPublicFile(absolute, png, 'image/png'),
    /Invalid storage path/
  );
});

// ---------------------------------------------------------------------------
// Driver contract
// ---------------------------------------------------------------------------

test('localDisk implements the same surface as the supabase driver', () => {
  const supabase = require('../src/storage/supabase');
  for (const fn of ['uploadPublicFile', 'removePublicFolder']) {
    assert.equal(typeof storage[fn], 'function', `localDisk.${fn}`);
    assert.equal(typeof supabase[fn], 'function', `supabase.${fn}`);
  }
  // routes/employees.js reads neither driver directly; it must be able to
  // report whether uploads are usable.
  assert.equal(typeof storage.storageConfigured, 'boolean');
  assert.equal(typeof supabase.storageConfigured, 'boolean');
});

test('localDisk needs no configuration to be usable', () => {
  // Unlike the bucket, a filesystem is always there — which is the whole point
  // for an on-premise install.
  assert.equal(storage.storageConfigured, true);
  assert.equal(storage.driver, 'localDisk');
});

test('the storage facade rejects an unknown driver name', () => {
  const prev = process.env.STORAGE_DRIVER;
  process.env.STORAGE_DRIVER = 'dropbox';
  delete require.cache[require.resolve('../src/storage/index.js')];
  try {
    assert.throws(() => require('../src/storage/index.js'), /is not recognised/);
  } finally {
    if (prev === undefined) delete process.env.STORAGE_DRIVER;
    else process.env.STORAGE_DRIVER = prev;
    delete require.cache[require.resolve('../src/storage/index.js')];
  }
});

test('the storage facade defaults to localDisk', () => {
  const prev = process.env.STORAGE_DRIVER;
  delete process.env.STORAGE_DRIVER;
  delete require.cache[require.resolve('../src/storage/index.js')];
  try {
    assert.equal(require('../src/storage/index.js').driver, 'localDisk');
  } finally {
    if (prev !== undefined) process.env.STORAGE_DRIVER = prev;
    delete require.cache[require.resolve('../src/storage/index.js')];
  }
});
