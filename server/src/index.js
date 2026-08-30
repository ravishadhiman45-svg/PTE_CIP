// PTE CIP Express API entry point.
require('dotenv').config();

const express = require('express');
const cors = require('cors');

const { requireAuth } = require('./middleware/auth');

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const skillsRoutes = require('./routes/skills');
const rolesRoutes = require('./routes/roles');
const employeesRoutes = require('./routes/employees');
const trainingRoutes = require('./routes/training');
const learningPlanRoutes = require('./routes/learningPlan');
const learningModuleRoutes = require('./routes/learningModule');
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

// Health check (public).
app.get('/api/health', (req, res) => res.json({ ok: true, service: 'ptecip-api' }));

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
app.use('/api/learning-module', learningModuleRoutes);
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
app.listen(PORT, () => {
  console.log(`PTE CIP API listening on http://localhost:${PORT}`);
});
