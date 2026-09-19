// Admin Course Management — create, edit, and publish courses with content.
const express = require('express');
const multer = require('multer');
const path = require('path');
const { query } = require('../db');
const storage = require('../storage');

const router = express.Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return UUID_RE.test(String(value || ''));
}

// Only admins and roles specified in ADMIN_COURSE_ROLES can access these routes
function checkAdminCourseAccess(req, res, next) {
  const roles = (req.user && req.user.roles) || [];
  const allowedRoles = (process.env.ADMIN_COURSE_ROLES || 'admin')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);

  const hasAccess = roles.some((r) => allowedRoles.includes(r));
  if (!hasAccess) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  return next();
}

router.use(checkAdminCourseAccess);

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|pdf|mp4|mov|avi|webm)$/i;
    if (allowed.test(path.extname(file.originalname))) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: images, PDFs, videos.'));
    }
  },
});

// GET /api/admin/courses — list all admin-created courses
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT tc.id, tc.course_code, tc.title, tc.short_description, tc.description,
              tc.cover_image_url, tc.category, tc.instructor_name, tc.status,
              tc.course_type, tc.delivery_mode, tc.duration_hours, tc.difficulty,
              tc.created_at, tc.updated_at,
              (SELECT count(*) FROM course_content_items WHERE course_id = tc.id) AS content_count
       FROM training_courses tc
       WHERE tc.is_admin_created = $1
       ORDER BY tc.created_at DESC`,
      [true]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/courses/:id — get single course with content
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const courseQuery = await query(
      `SELECT tc.* FROM training_courses tc WHERE tc.id = $1 AND tc.is_admin_created = $2`,
      [id, true]
    );

    if (courseQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const contentQuery = await query(
      `SELECT * FROM course_content_items WHERE course_id = $1 ORDER BY display_order`,
      [id]
    );

    return res.json({
      course: courseQuery.rows[0],
      content: contentQuery.rows,
    });
  } catch (err) {
    return next(err);
  }
});

// POST /api/admin/courses — create new course
router.post('/', async (req, res, next) => {
  try {
    const {
      title,
      short_description,
      description,
      category,
      instructor_name,
      course_type = 'Course',
      delivery_mode = 'Self Paced',
      duration_hours,
      difficulty,
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Course title is required' });
    }

    // Generate unique course code
    const codePrefix = 'ADM';
    const timestamp = Date.now().toString().slice(-6);
    const course_code = `${codePrefix}-${timestamp}`;

    const { rows } = await query(
      `INSERT INTO training_courses 
       (course_code, title, short_description, description, category, instructor_name,
        course_type, delivery_mode, duration_hours, difficulty, status, is_admin_created)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        course_code,
        title.trim(),
        short_description || null,
        description || null,
        category || null,
        instructor_name || null,
        course_type,
        delivery_mode,
        duration_hours || null,
        difficulty || null,
        'Draft',
        true,
      ]
    );

    return res.status(201).json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

// PATCH /api/admin/courses/:id — update course details
router.patch('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      title,
      short_description,
      description,
      category,
      instructor_name,
      course_type,
      delivery_mode,
      duration_hours,
      difficulty,
      status,
    } = req.body;

    const updates = [];
    const values = [];
    let idx = 1;

    if (title !== undefined) {
      updates.push(`title = $${idx++}`);
      values.push(title.trim());
    }
    if (short_description !== undefined) {
      updates.push(`short_description = $${idx++}`);
      values.push(short_description || null);
    }
    if (description !== undefined) {
      updates.push(`description = $${idx++}`);
      values.push(description || null);
    }
    if (category !== undefined) {
      updates.push(`category = $${idx++}`);
      values.push(category || null);
    }
    if (instructor_name !== undefined) {
      updates.push(`instructor_name = $${idx++}`);
      values.push(instructor_name || null);
    }
    if (course_type !== undefined) {
      updates.push(`course_type = $${idx++}`);
      values.push(course_type);
    }
    if (delivery_mode !== undefined) {
      updates.push(`delivery_mode = $${idx++}`);
      values.push(delivery_mode);
    }
    if (duration_hours !== undefined) {
      updates.push(`duration_hours = $${idx++}`);
      values.push(duration_hours || null);
    }
    if (difficulty !== undefined) {
      updates.push(`difficulty = $${idx++}`);
      values.push(difficulty || null);
    }
    if (status !== undefined) {
      updates.push(`status = $${idx++}`);
      values.push(status);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(id);
    const { rows } = await query(
      `UPDATE training_courses SET ${updates.join(', ')} WHERE id = $${idx} AND is_admin_created = $${
        idx + 1
      } RETURNING *`,
      [...values, true]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }

    return res.json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/admin/courses/:id — delete course
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid course ID' });
    }

    // Get all content items to delete associated files
    const contentQuery = await query(
      `SELECT video_file_path, image_file_path, pdf_file_path
       FROM course_content_items WHERE course_id = $1`,
      [id]
    );

    const filePaths = [];
    for (const row of contentQuery.rows) {
      if (row.video_file_path) filePaths.push(row.video_file_path);
      if (row.image_file_path) filePaths.push(row.image_file_path);
      if (row.pdf_file_path) filePaths.push(row.pdf_file_path);
    }

    // Delete course (cascade will delete content items)
    const { rowCount } = await query(
      `DELETE FROM training_courses WHERE id = $1 AND is_admin_created = $2`,
      [id, true]
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // Delete files from storage
    if (filePaths.length > 0) {
      try {
        await storage.removePublicFiles(filePaths);
      } catch (err) {
        console.error('[adminCourses] failed to delete files:', err);
        // Don't fail the request if file deletion fails
      }
    }

    return res.json({ message: 'Course deleted successfully' });
  } catch (err) {
    return next(err);
  }
});

// POST /api/admin/courses/:id/thumbnail — upload course thumbnail
router.post('/:id/thumbnail', upload.single('file'), async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid course ID' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // The public URL is the source of truth for course thumbnails. Do not read
    // the optional thumbnail_path column here so older databases can still
    // upload and replace thumbnails safely.
    const oldQuery = await query(
      `SELECT id FROM training_courses WHERE id = $1 AND is_admin_created = $2`,
      [id, true]
    );

    if (oldQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // Upload new thumbnail
    const ext = path.extname(req.file.originalname);
    const key = `course-thumbnails/${id}-${Date.now()}${ext}`;
    const publicUrl = await storage.uploadPublicFile(key, req.file.buffer, req.file.mimetype);

    // Update course
    const { rows } = await query(
      `UPDATE training_courses SET cover_image_url = $1
       WHERE id = $2 AND is_admin_created = $3 RETURNING *`,
      [publicUrl, id, true]
    );

    return res.json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

// POST /api/admin/courses/:id/content — add content item
router.post('/:id/content', upload.single('file'), async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!isUuid(id)) {
      return res.status(400).json({ error: 'Invalid course ID' });
    }
    const { content_type, title, description, video_url, external_url, text_content, duration_minutes } =
      req.body;

    if (!content_type || !title) {
      return res.status(400).json({ error: 'content_type and title are required' });
    }

    // Verify course exists
    const courseQuery = await query(
      `SELECT id FROM training_courses WHERE id = $1 AND is_admin_created = $2`,
      [id, true]
    );

    if (courseQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // Get next display order
    const orderQuery = await query(
      `SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order FROM course_content_items WHERE course_id = $1`,
      [id]
    );
    const display_order = orderQuery.rows[0].next_order;

    let fileUrl = null;
    let filePath = null;

    // Handle file upload for video, image, pdf
    if (req.file && ['video', 'image', 'pdf'].includes(content_type)) {
      const folder = `course-content/${content_type}s`;
      const ext = path.extname(req.file.originalname);
      const key = `${folder}/${id}-${Date.now()}${ext}`;
      fileUrl = await storage.uploadPublicFile(key, req.file.buffer, req.file.mimetype);
      filePath = key;
    }

    // Insert content item
    const { rows } = await query(
      `INSERT INTO course_content_items 
       (course_id, content_type, title, description, display_order, 
        video_url, video_file_path, image_url, image_file_path, 
        pdf_url, pdf_file_path, text_content, external_url, duration_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        id,
        content_type,
        title.trim(),
        description || null,
        display_order,
        content_type === 'video' && (video_url || fileUrl) ? video_url || fileUrl : null,
        content_type === 'video' && filePath ? filePath : null,
        content_type === 'image' && fileUrl ? fileUrl : null,
        content_type === 'image' && filePath ? filePath : null,
        content_type === 'pdf' && fileUrl ? fileUrl : null,
        content_type === 'pdf' && filePath ? filePath : null,
        content_type === 'text' ? text_content : null,
        content_type === 'link' ? external_url : null,
        duration_minutes || null,
      ]
    );

    return res.status(201).json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

// PATCH /api/admin/courses/:courseId/content/:contentId — update content item
router.patch('/:courseId/content/:contentId', async (req, res, next) => {
  try {
    const { courseId, contentId } = req.params;
    const { title, description, display_order, video_url, external_url, text_content, duration_minutes } =
      req.body;

    const updates = [];
    const values = [];
    let idx = 1;

    if (title !== undefined) {
      updates.push(`title = $${idx++}`);
      values.push(title.trim());
    }
    if (description !== undefined) {
      updates.push(`description = $${idx++}`);
      values.push(description || null);
    }
    if (display_order !== undefined) {
      updates.push(`display_order = $${idx++}`);
      values.push(display_order);
    }
    if (video_url !== undefined) {
      updates.push(`video_url = $${idx++}`);
      values.push(video_url || null);
    }
    if (external_url !== undefined) {
      updates.push(`external_url = $${idx++}`);
      values.push(external_url || null);
    }
    if (text_content !== undefined) {
      updates.push(`text_content = $${idx++}`);
      values.push(text_content || null);
    }
    if (duration_minutes !== undefined) {
      updates.push(`duration_minutes = $${idx++}`);
      values.push(duration_minutes || null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(contentId, courseId);
    const { rows } = await query(
      `UPDATE course_content_items SET ${updates.join(', ')} 
       WHERE id = $${idx} AND course_id = $${idx + 1} RETURNING *`,
      values
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Content item not found' });
    }

    return res.json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/admin/courses/:courseId/content/:contentId — delete content item
router.delete('/:courseId/content/:contentId', async (req, res, next) => {
  try {
    const { courseId, contentId } = req.params;

    // Get file paths to delete
    const contentQuery = await query(
      `SELECT video_file_path, image_file_path, pdf_file_path 
       FROM course_content_items WHERE id = $1 AND course_id = $2`,
      [contentId, courseId]
    );

    if (contentQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Content item not found' });
    }

    const filePaths = [];
    const row = contentQuery.rows[0];
    if (row.video_file_path) filePaths.push(row.video_file_path);
    if (row.image_file_path) filePaths.push(row.image_file_path);
    if (row.pdf_file_path) filePaths.push(row.pdf_file_path);

    // Delete content item
    await query(`DELETE FROM course_content_items WHERE id = $1 AND course_id = $2`, [contentId, courseId]);

    // Delete files from storage
    if (filePaths.length > 0) {
      try {
        await storage.removePublicFiles(filePaths);
      } catch (err) {
        console.error('[adminCourses] failed to delete content files:', err);
      }
    }

    return res.json({ message: 'Content item deleted successfully' });
  } catch (err) {
    return next(err);
  }
});

// PATCH /api/admin/courses/:id/publish — publish/unpublish course
router.patch('/:id/publish', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { publish } = req.body;

    const newStatus = publish ? 'Published' : 'Draft';

    const { rows } = await query(
      `UPDATE training_courses SET status = $1 WHERE id = $2 AND is_admin_created = $3 RETURNING *`,
      [newStatus, id, true]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }

    return res.json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
