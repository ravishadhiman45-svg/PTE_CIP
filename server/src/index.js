// PTE CIP Express API entry point.
require('dotenv').config();

const express = require('express');
const cors = require('cors');

const { requireAuth } = require('./middleware/auth');
const db = require('./db');
const storage = require('./storage');

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const skillsRoutes = require('./routes/skills');
const rolesRoutes = require('./routes/roles');
const employeesRoutes = require('./routes/employees');
const trainingRoutes = require('./routes/training');
const learningPlanRoutes = require('./routes/learningPlan');
const mentorRoutes = require('./routes/mentor');
const certificationsRoutes = require('./routes/certifications');
const roadmapRoutes = require('./routes/roadmap');
const inboxRoutes = require('./routes/inbox');
const verificationRoutes = require('./routes/verification');
const courseDevRoutes = require('./routes/courseDevelopment');
const adminRoutes = require('./routes/admin');

const app = express();

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || 'http://localhost:3000',
    // CORS hides every response header except a short safelist. The CV download
    // reads the filename the server chose out of Content-Disposition, so that
    // one has to be published explicitly.
    exposedHeaders: ['Content-Disposition'],
  })
);
app.use(express.json());

// Profile images, when they live on this machine's disk rather than in a hosted
// bucket. Public on purpose: these URLs are stored in employees.photo_url and
// rendered straight into an <img src>, exactly as the bucket's public URLs were.
//
// `immutable` is safe because the object key is timestamped on every upload
// (routes/employees.js:990) — a changed picture is a changed URL, never a
// changed body at the same URL.
if (storage.driver === 'localDisk') {
  app.use(
    '/files',
    express.static(storage.UPLOAD_DIR, {
      maxAge: '1y',
      immutable: true,
      index: false,
      // Never serve a directory listing or a dotfile out of the upload tree.
      dotfiles: 'ignore',
      redirect: false,
    })
  );
}

// Health check (public). Reports the resolved dialect and storage driver so an
// on-premise deployment can be verified without shell access to the box.
app.get('/api/health', (req, res) =>
  res.json({ ok: true, service: 'ptecip-api', dialect: db.dialect, storage: storage.driver })
);

// Auth (public).
app.use('/api/auth', authRoutes);

// Everything below requires a valid JWT.
app.use('/api', requireAuth);

app.use('/api/dashboard', dashboardRoutes);
app.use('/api/skills', skillsRoutes);
app.use('/api/roles', rolesRoutes);
app.use('/api/employees', employeesRoutes);
app.use('/api/training', trainingRoutes);
app.use('/api/learning-plan', learningPlanRoutes);
app.use('/api/mentor', mentorRoutes);
app.use('/api/certifications', certificationsRoutes);
app.use('/api/roadmap', roadmapRoutes);
app.use('/api/inbox', inboxRoutes);
app.use('/api/verification', verificationRoutes);
app.use('/api/course-development', courseDevRoutes);
app.use('/api/admin', adminRoutes);

// 404 for unknown API routes.
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Central error handler.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[api error]', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 4000;

// Verify the database before binding a port.
//
// The self-test exercises the three things most likely to be wrong on a fresh
// on-premise install, in the order they would fail: the connection, boolean and
// uuid parameter round-tripping, and whether the DDL was ever loaded (the
// visibility function exists). Discovering any of those from a 500 on request
// forty is much worse than refusing to start.
async function main() {
  try {
    await db.selfTest();
  } catch (err) {
    console.error(`[startup] database check failed (dialect=${db.dialect})`);
    console.error(err.message);
    process.exit(1);
  }

  console.log(`[startup] dialect=${db.dialect} storage=${storage.driver}`);

  app.listen(PORT, () => {
    console.log(`PTE CIP API listening on http://localhost:${PORT}`);
  });
}

main();
