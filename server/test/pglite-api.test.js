// The whole API, running on PGlite, over real HTTP.
//
// WHY A SPAWNED SERVER RATHER THAN A MOUNTED APP
// ----------------------------------------------
// Three of the things this deployment has to get right are only observable in a
// real process:
//
//   * the boot self-test and schema bootstrap actually complete, and the port
//     is bound afterwards — the failure mode being guarded against is a server
//     that starts and then 500s on every request;
//   * a profile photo written by the storage driver is REACHABLE at the URL
//     stored in employees.photo_url, which depends on the express.static mount
//     and the driver agreeing;
//   * data survives a restart, because the offline install's whole premise is
//     that .pgdata is the database.
//
// So this starts `node src/index.js` the way an operator would, talks to it
// with fetch, then kills and restarts it against the SAME data directory.

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const SERVER_ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(SERVER_ROOT, 'src', 'index.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ptecip-pglite-'));
const DATA_DIR = path.join(TMP, '.pgdata');
const UPLOAD_DIR = path.join(TMP, 'uploads');

const PASSWORD = 'test-shared-password';
const ADMIN_EMAIL = 'nidhi.tripathi@ptecip.local';
const ROOT_EMAIL = 'rahul.sharma@ptecip.local';

// A 1x1 PNG, so the uploaded bytes are a real image rather than filler.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

// Boot is WASM compile + (first time) the whole db/pg/ schema.
const SLOW = { timeout: 180000 };

let port;
let child;
let base;
let token;
let adminId;

// ---------------------------------------------------------------------------
// Process control
// ---------------------------------------------------------------------------

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port: p } = srv.address();
      srv.close(() => resolve(p));
    });
  });
}

// Starts the API and resolves once it reports the port is bound. Rejects with
// the child's own output if it exits first — a silent timeout here would say
// nothing about which of the boot steps failed.
function start() {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [ENTRY], {
      cwd: SERVER_ROOT,
      env: {
        ...process.env,
        // dotenv does not overwrite an existing variable, so these win over
        // whatever server/.env says.
        PG_DRIVER: 'pglite',
        PGLITE_DATA_DIR: DATA_DIR,
        DB_DIALECT: 'postgres',
        STORAGE_DRIVER: 'localDisk',
        UPLOAD_DIR,
        PUBLIC_FILE_BASE_URL: `http://127.0.0.1:${port}/files`,
        PORT: String(port),
        JWT_SECRET: 'pglite-test-secret',
        SHARED_LOGIN_PASSWORD: PASSWORD,
        CLIENT_ORIGIN: 'http://127.0.0.1:3000',
        // Must not leak into the child and reconnect it to Supabase.
        DATABASE_URL: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let log = '';
    const onData = (buf) => {
      log += buf.toString();
      if (log.includes('listening on port')) resolve(proc);
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.once('exit', (code) =>
      reject(new Error(`server exited with code ${code} before listening:\n${log}`))
    );
  });
}

async function stop(proc) {
  if (!proc || proc.exitCode !== null) return;
  const ended = new Promise((resolve) => proc.once('exit', resolve));
  proc.kill();
  await ended;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function api(method, url, { body, auth = true, raw = false } = {}) {
  const headers = {};
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${base}${url}`, {
    method,
    headers,
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
  });

  if (raw) return res;
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

const ok = (r, url) => {
  assert.equal(r.status, 200, `${url} -> ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

test.before(async () => {
  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = await start();
}, SLOW);

test.after(async () => {
  await stop(child);
  await fsp.rm(TMP, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Startup + health
// ---------------------------------------------------------------------------

test('the server started, which means the self-test and schema load passed', SLOW, () => {
  assert.equal(child.exitCode, null);
});

test('the data directory was created on disk', SLOW, () => {
  assert.ok(fs.existsSync(DATA_DIR), `${DATA_DIR} should exist`);
  assert.ok(fs.readdirSync(DATA_DIR).length > 0, 'the data directory should not be empty');
});

test('GET /api/health reports the pglite driver and local storage', SLOW, async () => {
  const body = ok(await api('GET', '/api/health', { auth: false }), '/api/health');
  assert.deepEqual(body, {
    ok: true,
    service: 'ptecip-api',
    dialect: 'postgres',
    driver: 'pglite',
    storage: 'localDisk',
  });
});

// ---------------------------------------------------------------------------
// Authentication — the persona flow, unchanged
// ---------------------------------------------------------------------------

test('a protected route refuses an unauthenticated caller', SLOW, async () => {
  const r = await api('GET', '/api/employees/me', { auth: false });
  assert.equal(r.status, 401);
});

test('POST /api/auth/login issues a token for a seeded persona', SLOW, async () => {
  const body = ok(
    await api('POST', '/api/auth/login', {
      auth: false,
      body: { email: ADMIN_EMAIL, password: PASSWORD },
    }),
    '/api/auth/login'
  );

  assert.equal(typeof body.token, 'string');
  assert.equal(body.user.email, ADMIN_EMAIL);
  assert.ok(Array.isArray(body.user.roles), 'roles must be an ARRAY, never a bare string');
  assert.ok(body.user.roles.includes('admin'));
  assert.equal(body.user.role, 'admin');
  assert.match(body.user.employee_id, /^[0-9a-f-]{36}$/);

  token = body.token;
  adminId = body.user.employee_id;
});

test('login rejects a wrong password and an unknown email', SLOW, async () => {
  const wrongPass = await api('POST', '/api/auth/login', {
    auth: false,
    body: { email: ADMIN_EMAIL, password: 'nope' },
  });
  assert.equal(wrongPass.status, 401);

  const unknown = await api('POST', '/api/auth/login', {
    auth: false,
    body: { email: 'nobody@example.com', password: PASSWORD },
  });
  assert.equal(unknown.status, 403);
});

test('a second persona logs in with the same shared password', SLOW, async () => {
  const body = ok(
    await api('POST', '/api/auth/login', {
      auth: false,
      body: { email: ROOT_EMAIL, password: PASSWORD },
    }),
    'login as root'
  );
  assert.ok(body.user.roles.includes('executive'));
});

// ---------------------------------------------------------------------------
// Read paths
// ---------------------------------------------------------------------------

test('GET /api/employees/me returns the caller', SLOW, async () => {
  const me = ok(await api('GET', '/api/employees/me'), '/api/employees/me');
  assert.equal(me.email, ADMIN_EMAIL);
  assert.equal(me.id, adminId);
});

test('the dashboard answers with KPIs, coverage and a heatmap', SLOW, async () => {
  const d = ok(await api('GET', '/api/dashboard/executive'), '/api/dashboard/executive');
  assert.ok(d.kpis, 'kpis');
  // An admin sees the whole org, so this is the full seeded headcount. It is a
  // STRING because count(*) is bigint — the same shape Supabase returns.
  assert.equal(d.kpis.total_employees, '50');
  assert.ok(Array.isArray(d.skillCoverageByDepartment));
  assert.ok(d.skillCoverageByDepartment.length > 0, 'coverage must not be empty');
  assert.ok(Array.isArray(d.capabilityGapHeatmap));
  assert.ok(d.capabilityGapHeatmap.length > 0, 'the heatmap must not be empty');
});

test('the org tree comes back with derived depth and structural codes', SLOW, async () => {
  const tree = ok(await api('GET', '/api/employees/org-chart'), '/api/employees/org-chart');
  assert.ok(Array.isArray(tree.nodes), 'org-chart.nodes');
  assert.equal(tree.nodes.length, 50);

  const roots = tree.nodes.filter((n) => n.manager_id === null);
  assert.equal(roots.length, 1, 'exactly one root');
  assert.equal(roots[0].absolute_depth, 1);
  assert.equal(roots[0].has_reports, true);
  // depth and the "2.1.3" code are DERIVED by the recursive view, never stored.
  assert.ok(Math.max(...tree.nodes.map((n) => n.absolute_depth)) >= 3);
  assert.ok(tree.nodes.every((n) => typeof n.structural_code === 'string'));
});

test('the directory listing is scoped and complete for an admin', SLOW, async () => {
  const rows = ok(await api('GET', '/api/employees'), '/api/employees');
  assert.equal(rows.length, 50);
  assert.ok(rows.every((r) => typeof r.full_name === 'string'));
});

test('the skills library and one skill detail load', SLOW, async () => {
  const skills = ok(await api('GET', '/api/skills'), '/api/skills');
  assert.ok(skills.length > 0);
  // labels is aggregated as JSON in SQL; it must arrive parsed, not as text.
  assert.ok(Array.isArray(skills[0].labels), 'labels must be an array');

  const detail = ok(await api('GET', `/api/skills/${skills[0].id}`), '/api/skills/:id');
  assert.ok(detail);
});

test('the skill matrix on a profile resolves effective levels', SLOW, async () => {
  // The seeded assessments sit on one employee, so read that profile rather
  // than the admin's own empty passport. An admin may view anyone.
  const rows = ok(await api('GET', '/api/employees'), '/api/employees');

  let assessed = null;
  let owner = null;
  for (const r of rows) {
    const p = ok(await api('GET', `/api/employees/${r.id}/profile`), 'profile');
    assert.ok(p.header, 'profile.header');
    assert.ok(Array.isArray(p.skillsPassport), 'profile.skillsPassport');
    const hit = p.skillsPassport.find((s) => Number(s.effective_level) > 0);
    if (hit) {
      assessed = hit;
      owner = r;
      break;
    }
  }

  assert.ok(assessed, 'the seed data has at least one assessed skill somewhere');
  assert.equal(typeof assessed.effective_level, 'number');
  assert.ok(assessed.skill_name || assessed.name, `unexpected passport row: ${JSON.stringify(assessed)}`);
  assert.ok(owner);
});

test('roles, training, roadmap, inbox and the learning module all answer', SLOW, async () => {
  for (const url of [
    '/api/roles',
    '/api/training',
    '/api/roadmap',
    '/api/inbox',
    '/api/inbox/count',
    `/api/learning-module/${adminId}`,
    `/api/learning-plan/${adminId}`,
    '/api/verification/approvers',
    '/api/admin/users',
    '/api/admin/audit-logs',
  ]) {
    ok(await api('GET', url), url);
  }
});

test('permission_roles on the admin user list is an array', SLOW, async () => {
  const users = ok(await api('GET', '/api/admin/users'), '/api/admin/users');
  assert.ok(users.length > 0);
  assert.ok(Array.isArray(users[0].permission_roles));
});

// ---------------------------------------------------------------------------
// CV write + read back (the transactional path)
// ---------------------------------------------------------------------------

const HEADLINE = 'Principal Powertrain Engineer (pglite test)';

test('PUT /api/employees/:id/cv upserts and returns the row', SLOW, async () => {
  const first = ok(
    await api('PUT', `/api/employees/${adminId}/cv`, {
      body: {
        headline: HEADLINE,
        summary: 'Written by the PGlite integration test.',
        phone: '+91 90000 00000',
        location_text: 'Pune',
        linkedin_url: 'https://example.com/in/test',
      },
    }),
    'PUT cv'
  );
  assert.equal(first.headline, HEADLINE);
  assert.equal(first.employee_id, adminId);

  // The second call must UPDATE, not raise a duplicate key — this is the only
  // real upsert in the codebase.
  const second = ok(
    await api('PUT', `/api/employees/${adminId}/cv`, {
      body: { headline: `${HEADLINE} v2`, summary: 'Second write.' },
    }),
    'PUT cv again'
  );
  assert.equal(second.headline, `${HEADLINE} v2`);
});

test('the CV is read back on the profile', SLOW, async () => {
  const profile = ok(await api('GET', `/api/employees/${adminId}/profile`), 'profile after cv');
  assert.equal(profile.cv.headline, `${HEADLINE} v2`);
  assert.equal(profile.cv.summary, 'Second write.');
});

test('experience rows insert, update and delete with RETURNING', SLOW, async () => {
  const post = await api('POST', `/api/employees/${adminId}/experience`, {
    body: {
      title: 'Test Engineer',
      organization: 'PGlite Motors',
      start_date: '2020-01-15',
      end_date: '2022-06-30',
      description: 'Inserted by the integration test.',
    },
  });
  assert.equal(post.status, 201, JSON.stringify(post.body));
  const created = post.body;
  assert.match(created.id, /^[0-9a-f-]{36}$/);
  // Dates are projected as plain YYYY-MM-DD, not timestamps.
  assert.equal(created.start_date, '2020-01-15');
  assert.equal(created.end_date, '2022-06-30');

  const updated = ok(
    await api('PUT', `/api/employees/${adminId}/experience/${created.id}`, {
      body: {
        title: 'Senior Test Engineer',
        organization: 'PGlite Motors',
        start_date: '2020-01-15',
        end_date: null,
        description: 'Updated.',
      },
    }),
    'PUT experience'
  );
  assert.equal(updated.title, 'Senior Test Engineer');
  assert.equal(updated.end_date, null);

  const removed = await api('DELETE', `/api/employees/${adminId}/experience/${created.id}`);
  assert.ok([200, 204].includes(removed.status), `delete -> ${removed.status}`);
});

test('a CV edit leaves verification in Draft, inside one transaction', SLOW, async () => {
  const profile = ok(await api('GET', `/api/employees/${adminId}/profile`), 'profile');
  assert.equal(profile.cv.verification_status, 'Draft');
});

// ---------------------------------------------------------------------------
// Photo upload / serve / delete, on local disk
// ---------------------------------------------------------------------------

let photoUrl;

test('POST /api/employees/:id/photo stores the file and returns its URL', SLOW, async () => {
  const form = new FormData();
  form.set('file', new Blob([PNG], { type: 'image/png' }), 'avatar.png');

  const res = await fetch(`${base}/api/employees/${adminId}/photo`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));

  assert.equal(body.id, adminId);
  assert.ok(body.photo_url.startsWith(`http://127.0.0.1:${port}/files/${adminId}/avatar-`));
  photoUrl = body.photo_url;

  // And it really is on disk, under the employee's own prefix.
  const files = await fsp.readdir(path.join(UPLOAD_DIR, adminId));
  assert.equal(files.length, 1);
});

test('the stored URL actually serves the image bytes', SLOW, async () => {
  const res = await fetch(photoUrl);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.deepEqual(bytes, PNG);
});

test('the photo URL is what the profile now reports', SLOW, async () => {
  const me = ok(await api('GET', '/api/employees/me'), 'me after upload');
  assert.equal(me.photo_url, photoUrl);
});

test('DELETE /api/employees/:id/photo purges the file and clears the column', SLOW, async () => {
  const body = ok(await api('DELETE', `/api/employees/${adminId}/photo`), 'DELETE photo');
  assert.equal(body.photo_url, null);

  // The file is gone, so the URL no longer serves anything.
  const res = await fetch(photoUrl);
  assert.equal(res.status, 404);
  assert.equal(fs.existsSync(path.join(UPLOAD_DIR, adminId)), false);
});

test('a traversal attempt in the static mount is refused', SLOW, async () => {
  const res = await fetch(`${base}/files/../package.json`, { redirect: 'manual' });
  assert.ok(res.status >= 400, `expected a refusal, got ${res.status}`);
});

// ---------------------------------------------------------------------------
// Manager reparent + the reporting-cycle guard
// ---------------------------------------------------------------------------

test('PATCH /api/employees/:id/manager reparents someone', SLOW, async () => {
  const tree = ok(await api('GET', '/api/employees/org-chart'), 'org-chart');

  // Two LEAVES. Neither can be an ancestor of the other, so this move is
  // legitimate and the cycle trigger must allow it.
  const leaves = tree.nodes.filter((n) => !n.has_reports);
  assert.ok(leaves.length >= 2, 'the seed tree has several leaves');
  const [moved, newManager] = leaves;
  assert.ok(moved.manager_id, 'a leaf has a manager to restore');

  const body = ok(
    await api('PATCH', `/api/employees/${moved.id}/manager`, {
      body: { manager_id: newManager.id },
    }),
    'PATCH manager'
  );
  assert.equal(body.manager_id, newManager.id);
  assert.ok(body.sibling_order >= 1, 'the new sibling_order is derived, not passed in');

  // Confirmed through the recursive view, not just the write's own RETURNING.
  const after = ok(await api('GET', '/api/employees/org-chart'), 'org-chart after move');
  assert.equal(after.nodes.find((n) => n.id === moved.id).manager_id, newManager.id);

  // And back, so the reporting-cycle test below starts from the seeded shape.
  ok(
    await api('PATCH', `/api/employees/${moved.id}/manager`, {
      body: { manager_id: moved.manager_id },
    }),
    'PATCH manager back'
  );
});

test('a move that would form a reporting cycle is refused with 409', SLOW, async () => {
  const tree = ok(await api('GET', '/api/employees/org-chart'), 'org-chart');
  const root = tree.nodes.find((n) => n.manager_id === null);
  const child = tree.nodes.find((n) => n.manager_id === root.id);
  assert.ok(child, 'the root has reports');

  const r = await api('PATCH', `/api/employees/${root.id}/manager`, {
    body: { manager_id: child.id },
  });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.match(r.body.error, /already reports to them/i);

  // The tree is intact — the trigger rejected the write, it did not half-apply.
  const after = ok(await api('GET', '/api/employees/org-chart'), 'org-chart after');
  assert.equal(after.nodes.filter((n) => n.manager_id === null).length, 1);
  assert.equal(after.nodes.length, 50);
});

test('an employee cannot be made to report to themselves', SLOW, async () => {
  const r = await api('PATCH', `/api/employees/${adminId}/manager`, {
    body: { manager_id: adminId },
  });
  assert.equal(r.status, 400);
});

// ---------------------------------------------------------------------------
// Restart + persistence — the whole point of .pgdata
// ---------------------------------------------------------------------------

test('data written before a restart is still there after it', SLOW, async () => {
  await stop(child);
  child = null;

  child = await start();

  // A fresh login, because the point is that the DATABASE survived.
  const login = ok(
    await api('POST', '/api/auth/login', {
      auth: false,
      body: { email: ADMIN_EMAIL, password: PASSWORD },
    }),
    'login after restart'
  );
  token = login.token;

  const profile = ok(
    await api('GET', `/api/employees/${adminId}/profile`),
    'profile after restart'
  );
  assert.equal(profile.cv.headline, `${HEADLINE} v2`, 'the CV write must have persisted');
  assert.equal(profile.header.photo_url, null, 'the photo deletion must have persisted');

  // And the schema was NOT reloaded — the ledger stopped that.
  const health = ok(await api('GET', '/api/health', { auth: false }), 'health after restart');
  assert.equal(health.driver, 'pglite');
});

test('the restarted server did not re-apply the schema', SLOW, async () => {
  // 50 employees, not 100: a second run of 02_seed.sql would have doubled them
  // (its inserts are ON CONFLICT-guarded, but the ledger is what makes this
  // cheap and certain).
  const rows = ok(await api('GET', '/api/employees'), 'employees after restart');
  assert.equal(rows.length, 50);
});
