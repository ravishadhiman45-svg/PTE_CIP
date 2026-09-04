// End-to-end check that a profile image written to local storage is actually
// reachable over HTTP at the URL stored in employees.photo_url.
//
// The unit tests in storage.test.js prove the file lands on disk. That is only
// half the feature: photo_url is rendered straight into an <img src>, so if the
// static mount and the URL the driver returns disagree by even a path segment,
// every avatar silently 404s while every test still passes. This wires the real
// express.static mount to the real driver and fetches the result.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const express = require('express');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ptecip-serve-'));
process.env.UPLOAD_DIR = ROOT;
process.env.STORAGE_DRIVER = 'localDisk';

let PORT;
let server;
let storage;

// A 1x1 PNG, so the bytes are a real image rather than arbitrary filler.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const EMP = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

test.before(async () => {
  // Bind an ephemeral port, then point the driver's public base at it — the
  // same relationship PUBLIC_FILE_BASE_URL has to the real deployment.
  await new Promise((resolve) => {
    const app = express();
    server = app.listen(0, () => {
      PORT = server.address().port;
      process.env.PUBLIC_FILE_BASE_URL = `http://127.0.0.1:${PORT}/files`;

      // Mounted exactly as src/index.js does.
      app.use(
        '/files',
        express.static(ROOT, {
          maxAge: '1y',
          immutable: true,
          index: false,
          dotfiles: 'ignore',
          redirect: false,
        })
      );

      storage = require('../src/storage/localDisk');
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise((r) => server.close(r));
  await fsp.rm(ROOT, { recursive: true, force: true });
});

test('an uploaded avatar is fetchable at the URL stored in photo_url', async () => {
  const key = `${EMP}/avatar-1700000000.png`;

  // This is the value routes/employees.js writes to employees.photo_url.
  const photoUrl = await storage.uploadPublicFile(key, PNG, 'image/png');

  const res = await fetch(photoUrl);
  assert.equal(res.status, 200, `GET ${photoUrl}`);

  const body = Buffer.from(await res.arrayBuffer());
  assert.deepEqual(body, PNG, 'served bytes must match what was uploaded');
  assert.match(res.headers.get('content-type'), /image\/png/);
});

test('the stored URL is absolute, so it resolves from the client origin', async () => {
  // The client runs on a different origin from the API. A relative path would
  // resolve against the client and 404.
  const url = await storage.uploadPublicFile(`${EMP}/avatar-abs.png`, PNG, 'image/png');
  assert.ok(/^https?:\/\//.test(url), url);
});

test('a cleared avatar stops being served', async () => {
  const key = `${EMP}/avatar-doomed.png`;
  const url = await storage.uploadPublicFile(key, PNG, 'image/png');
  assert.equal((await fetch(url)).status, 200);

  await storage.removePublicFolder(`${EMP}/`);

  // The whole point of purging the files rather than only the DB pointer: the
  // directory is public, so a surviving file stays reachable by URL forever.
  assert.equal((await fetch(url)).status, 404, 'removed avatar must 404');
});

test('re-upload under a new timestamped key busts the cache', async () => {
  // routes/employees.js:990 timestamps the key on every upload, which is what
  // makes the immutable/1-year cache header safe: a changed picture is a changed
  // URL, never a changed body at the same URL.
  const first = await storage.uploadPublicFile(`${EMP}/avatar-1.png`, PNG, 'image/png');
  const second = await storage.uploadPublicFile(`${EMP}/avatar-2.png`, PNG, 'image/png');
  assert.notEqual(first, second);

  const res = await fetch(second);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control') || '', /immutable/);
});

test('the upload tree is not browsable', async () => {
  // A directory listing would enumerate every employee id that has a picture.
  const res = await fetch(`http://127.0.0.1:${PORT}/files/`);
  assert.notEqual(res.status, 200, 'directory listing must not be served');
});

test('traversal is refused over HTTP as well as in the driver', async () => {
  // express.static normalises these, but assert it rather than assume it.
  for (const attack of ['/files/../package.json', '/files/%2e%2e/package.json']) {
    const res = await fetch(`http://127.0.0.1:${PORT}${attack}`);
    assert.notEqual(res.status, 200, attack);
  }
});

test('a dotfile in the upload tree is not served', async () => {
  await fsp.mkdir(path.join(ROOT, EMP), { recursive: true });
  await fsp.writeFile(path.join(ROOT, EMP, '.secret'), 'nope');
  const res = await fetch(`http://127.0.0.1:${PORT}/files/${EMP}/.secret`);
  assert.notEqual(res.status, 200);
});

test('a missing avatar 404s rather than erroring', async () => {
  // employees.photo_url pointing at a deleted object is the harmless direction:
  // the Avatar component degrades to initials.
  const res = await fetch(`http://127.0.0.1:${PORT}/files/${EMP}/does-not-exist.png`);
  assert.equal(res.status, 404);
});
