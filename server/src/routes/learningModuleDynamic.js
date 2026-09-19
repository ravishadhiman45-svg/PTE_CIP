// Dynamic Learning Module — supports admin-created courses with content items.
//
// This route fetches both:
// 1. Published admin-created courses (from course_content_items)
// 2. Traditional enrolled courses (from course_modules)
const express = require('express');
const { query } = require('../db');
const storage = require('../storage');

const router = express.Router();

// Fetch all published admin-created courses with their content items
const PUBLISHED_COURSES_SQL = `
  SELECT tc.id, tc.course_code, tc.title, tc.short_description, tc.description,
         tc.course_type, tc.delivery_mode, tc.duration_hours, tc.difficulty,
         tc.cover_image_url, tc.category, tc.instructor_name, tc.created_at,
         COALESCE((
           SELECT json_agg(json_build_object(
                    'id',                cci.id,
                    'content_type',      cci.content_type,
                    'title',             cci.title,
                    'description',       cci.description,
                    'display_order',     cci.display_order,
                    'video_url',         cci.video_url,
                    'video_file_path',   cci.video_file_path,
                    'image_url',         cci.image_url,
                    'image_file_path',   cci.image_file_path,
                    'pdf_url',           cci.pdf_url,
                    'pdf_file_path',     cci.pdf_file_path,
                    'text_content',      cci.text_content,
                    'external_url',      cci.external_url,
                    'duration_minutes',  cci.duration_minutes,
                    'completed_at',      (SELECT ecp.completed_at FROM employee_content_progress ecp WHERE ecp.content_item_id = cci.id AND ecp.employee_id = $3))
                  ORDER BY cci.display_order)
           FROM course_content_items cci
           WHERE cci.course_id = tc.id
         ), '[]'::json) AS content_items
  FROM training_courses tc
  WHERE tc.is_admin_created = $1 AND tc.status = $2
  ORDER BY tc.created_at DESC`;

// Parse JSON columns returned from the database
function parseCoursesJson(rows) {
  const toArray = (v) => {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string' && v.length > 0) {
      try {
        const parsed = JSON.parse(v);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  for (const row of rows) {
    row.content_items = toArray(row.content_items);
    row.content_items = row.content_items.map((item) => {
      const publicUrl = (filePath) =>
        filePath && storage.BASE_URL
          ? `${storage.BASE_URL}/${filePath.replace(/^\/+/, '').replace(/\\/g, '/')}`
          : null;

      return {
        ...item,
        video_url: item.video_url || publicUrl(item.video_file_path),
        image_url: item.image_url || publicUrl(item.image_file_path),
        pdf_url: item.pdf_url || publicUrl(item.pdf_file_path),
      };
    });
  }
  return rows;
}

// GET /api/learning-module/dynamic/published-courses
// Returns all published admin-created courses for display in Learning Module
router.get('/published-courses', async (req, res, next) => {
  try {
    const { rows } = await query(PUBLISHED_COURSES_SQL, [true, 'Published', req.user.employee_id]);
    res.json(parseCoursesJson(rows));
  } catch (err) {
    next(err);
  }
});

// GET /api/learning-module/dynamic/course/:courseId
// Get single course with all content items
router.get('/course/:courseId', async (req, res, next) => {
  try {
    const { courseId } = req.params;
    
    const SINGLE_COURSE_SQL = `
      SELECT tc.id, tc.course_code, tc.title, tc.short_description, tc.description,
             tc.course_type, tc.delivery_mode, tc.duration_hours, tc.difficulty,
             tc.cover_image_url, tc.category, tc.instructor_name, tc.created_at,
             COALESCE((
               SELECT json_agg(json_build_object(
                        'id',                cci.id,
                        'content_type',      cci.content_type,
                        'title',             cci.title,
                        'description',       cci.description,
                        'display_order',     cci.display_order,
                        'video_url',         cci.video_url,
                        'video_file_path',   cci.video_file_path,
                        'image_url',         cci.image_url,
                        'image_file_path',   cci.image_file_path,
                        'pdf_url',           cci.pdf_url,
                        'pdf_file_path',     cci.pdf_file_path,
                        'text_content',      cci.text_content,
                        'external_url',      cci.external_url,
                        'duration_minutes',  cci.duration_minutes,
                        'completed_at',      (SELECT ecp.completed_at FROM employee_content_progress ecp WHERE ecp.content_item_id = cci.id AND ecp.employee_id = $4))
                      ORDER BY cci.display_order)
               FROM course_content_items cci
               WHERE cci.course_id = tc.id
             ), '[]'::json) AS content_items
      FROM training_courses tc
      WHERE tc.is_admin_created = $1 AND tc.status = $2 AND tc.id = $3`;
    
    const { rows } = await query(SINGLE_COURSE_SQL, [true, 'Published', courseId, req.user.employee_id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }

    return res.json(parseCoursesJson(rows)[0]);
  } catch (err) {
    return next(err);
  }
});

async function getCourseProgress(employeeId, courseId) {
  const { rows } = await query(
    `SELECT count(*)::int AS total,
                count(ecp.content_item_id)::int AS done,
                COALESCE(tc.duration_hours, 0) AS duration_hours
           FROM course_content_items cci
           JOIN training_courses tc ON tc.id = cci.course_id
           LEFT JOIN employee_content_progress ecp
             ON ecp.content_item_id = cci.id AND ecp.employee_id = $1
          WHERE cci.course_id = $2 AND tc.is_admin_created = $3 AND tc.status = $4
          GROUP BY tc.duration_hours`,
    [employeeId, courseId, true, 'Published']
  );
  const row = rows[0] || { total: 0, done: 0, duration_hours: 0 };
  return { total: Number(row.total), done: Number(row.done), durationHours: Number(row.duration_hours) || 0 };
}

async function syncPlanItem(employeeId, courseId, progress) {
  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const status = percent === 100 ? 'Completed' : percent > 0 ? 'In Progress' : 'To Do';
  const existing = await query('SELECT id FROM learning_plan_items WHERE employee_id = $1 AND course_id = $2', [employeeId, courseId]);

  if (existing.rows.length) {
    await query(
      `UPDATE learning_plan_items SET status = $1, progress_percent = $2,
         completed_at = CASE WHEN $1 = 'Completed' THEN COALESCE(completed_at, NOW()) ELSE NULL END
         WHERE employee_id = $3 AND course_id = $4`,
      [status, percent, employeeId, courseId]
    );
  } else {
    await query(
      `INSERT INTO learning_plan_items (employee_id, course_id, status, progress_percent, completed_at)
          VALUES ($1, $2, $3, $4, CASE WHEN $3 = 'Completed' THEN NOW() ELSE NULL END)`,
      [employeeId, courseId, status, percent]
    );
  }
}

router.put('/course/:courseId/content/:contentId/progress', async (req, res, next) => {
  try {
    const { courseId, contentId } = req.params;
    const employeeId = req.user.employee_id;
    const valid = await query(
      `SELECT 1 FROM course_content_items cci JOIN training_courses tc ON tc.id = cci.course_id
       WHERE cci.id = $1 AND cci.course_id = $2 AND tc.is_admin_created = $3 AND tc.status = $4`,
      [contentId, courseId, true, 'Published']
    );
    if (!valid.rows.length) return res.status(404).json({ error: 'Content item not found' });

    await query(
      `INSERT INTO employee_content_progress (employee_id, content_item_id) VALUES ($1, $2)
           ON CONFLICT (employee_id, content_item_id) DO NOTHING`,
      [employeeId, contentId]
    );
    const progress = await getCourseProgress(employeeId, courseId);
    await syncPlanItem(employeeId, courseId, progress);
    return res.json({ ...progress, percent: progress.total ? Math.round((progress.done / progress.total) * 100) : 0 });
  } catch (err) {
    return next(err);
  }
});

router.delete('/course/:courseId/content/:contentId/progress', async (req, res, next) => {
  try {
    const { courseId, contentId } = req.params;
    const employeeId = req.user.employee_id;
    await query('DELETE FROM employee_content_progress WHERE employee_id = $1 AND content_item_id = $2', [employeeId, contentId]);
    const progress = await getCourseProgress(employeeId, courseId);
    await syncPlanItem(employeeId, courseId, progress);
    return res.json({ ...progress, percent: progress.total ? Math.round((progress.done / progress.total) * 100) : 0 });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
