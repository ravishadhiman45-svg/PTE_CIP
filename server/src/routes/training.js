// Training catalog.
const express = require('express');
const { query } = require('../db');

const router = express.Router();

// GET /api/training?search=&type=&category=
router.get('/', async (req, res, next) => {
  try {
    const { search, type, category } = req.query;
    const params = [];
    const where = [];

    if (search) {
      params.push(`%${search}%`);
      where.push(`(tc.title ILIKE $${params.length} OR tc.description ILIKE $${params.length})`);
    }
    if (type) {
      params.push(type);
      where.push(`tc.course_type = $${params.length}`);
    }
    if (category) {
      params.push(category);
      where.push(
        `EXISTS (SELECT 1 FROM course_skill_map csm JOIN skills s ON s.id = csm.skill_id
                 WHERE csm.course_id = tc.id AND s.category_id = $${params.length})`
      );
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const { rows } = await query(
      `SELECT tc.id, tc.course_code, tc.title, tc.description, tc.course_type,
              tc.delivery_mode, tc.duration_hours, tc.difficulty, tc.status,
              sme.full_name AS owner_sme, coord.full_name AS coordinator,
              COALESCE(
                JSON_AGG(DISTINCT s.name) FILTER (WHERE s.id IS NOT NULL), '[]'
              ) AS skills
       FROM training_courses tc
       LEFT JOIN employees sme ON sme.id = tc.owner_sme_id
       LEFT JOIN employees coord ON coord.id = tc.coordinator_id
       LEFT JOIN course_skill_map csm ON csm.course_id = tc.id
       LEFT JOIN skills s ON s.id = csm.skill_id
       ${whereSql}
       GROUP BY tc.id, tc.course_code, tc.title, tc.description, tc.course_type,
                tc.delivery_mode, tc.duration_hours, tc.difficulty, tc.status,
                sme.full_name, coord.full_name
       ORDER BY tc.title`,
      params
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/training/:id — course detail with modules and skills.
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const courseP = query(
      `SELECT tc.*, sme.full_name AS owner_sme, coord.full_name AS coordinator
       FROM training_courses tc
       LEFT JOIN employees sme ON sme.id = tc.owner_sme_id
       LEFT JOIN employees coord ON coord.id = tc.coordinator_id
       WHERE tc.id = $1`,
      [id]
    );
    const modulesP = query(
      `SELECT module_order, module_title, module_description, duration_minutes
       FROM course_modules WHERE course_id = $1 ORDER BY module_order`,
      [id]
    );
    const [course, modules] = await Promise.all([courseP, modulesP]);
    if (course.rows.length === 0) return res.status(404).json({ error: 'Course not found' });
    res.json({ course: course.rows[0], modules: modules.rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/training — admin/coordinator: create a course.
router.post('/', async (req, res, next) => {
  try {
    const {
      course_code,
      title,
      description,
      course_type,
      delivery_mode,
      duration_hours,
      difficulty,
    } = req.body || {};
    if (!course_code || !title || !course_type || !delivery_mode) {
      return res
        .status(400)
        .json({ error: 'course_code, title, course_type and delivery_mode are required' });
    }
    const { rows } = await query(
      `INSERT INTO training_courses
         (course_code, title, description, course_type, delivery_mode, duration_hours, difficulty)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, course_code, title`,
      [course_code, title, description || null, course_type, delivery_mode, duration_hours || null, difficulty || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
