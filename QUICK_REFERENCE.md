# Quick Reference - Dynamic Learning Module

## 🚀 Quick Start (3 Steps)

### 1. Run Database Migration
```bash
# Supabase: Copy db/pg/16_admin_course_content.sql to SQL Editor and run
# Or for SQL Server: Run db/mssql/16_admin_course_content.sql
```

### 2. Configure Admin Access
```bash
# Add to server/.env:
ADMIN_COURSE_ROLES=admin,executive
```

### 3. Restart Server
```bash
cd server && npm run dev
```

**Done!** Navigate to `/admin` → Learning tab → Manage Courses

---

## 🎯 Key URLs

| URL | Purpose | Access |
|-----|---------|--------|
| `/admin/learning` | Course Management | Admin only |
| `/learning-module` | View Courses | All users |

---

## 📝 Admin Workflow

```
Create Course → Add Content → Publish → Users See It
     ↓              ↓            ↓
  Title       Video/PDF      Status
  Details     Image/Text     Published
  Thumbnail   Link/URL
```

---

## 🔧 Configuration

### Grant Admin Access

**Method 1: Environment Variable** (Recommended)
```env
# server/.env
ADMIN_COURSE_ROLES=admin,executive,your_custom_role
```

**Method 2: Database**
```sql
-- Grant admin role to user
INSERT INTO user_permission_role_map (user_id, permission_role_id)
SELECT 
  (SELECT id FROM app_users WHERE email = 'user@example.com'),
  (SELECT id FROM app_permission_roles WHERE role_key = 'admin');
```

---

## 📂 Content Types Supported

| Type | Upload | URL | Display |
|------|--------|-----|---------|
| Video | ✅ (MP4, MOV) | ✅ (YouTube) | Video Player |
| Image | ✅ (JPG, PNG) | ❌ | Image Viewer |
| PDF | ✅ | ❌ | Embed + Download |
| Text | ❌ | ❌ | Formatted Text |
| Link | ❌ | ✅ | External Link |

---

## 🔍 Troubleshooting

### Courses Not Appearing?
```bash
# Check course status in database:
SELECT id, title, status, is_admin_created 
FROM training_courses 
WHERE is_admin_created = true;

# Should show status = 'Published'
```

### Access Denied?
```bash
# Check user roles:
SELECT au.email, pr.role_key
FROM app_users au
JOIN user_permission_role_map uprm ON au.id = uprm.user_id
JOIN app_permission_roles pr ON pr.id = uprm.permission_role_id
WHERE au.email = 'your.email@example.com';

# Verify ADMIN_COURSE_ROLES includes user's role
cat server/.env | grep ADMIN_COURSE_ROLES
```

### File Upload Fails?
```bash
# Check storage config:
cat server/.env | grep -E "(STORAGE_DRIVER|SUPABASE_|UPLOAD_DIR)"

# For Supabase: Verify bucket exists and is public
# For Local: Check uploads directory exists
ls -la server/uploads/
```

---

## 📊 Database Schema Quick Ref

### New Tables
- `course_content_items` - Course lessons
- `content_item_progress` - User progress

### Modified Tables
- `training_courses` + 6 new columns:
  - `is_admin_created` (identifies admin courses)
  - `short_description`
  - `cover_image_url`
  - `thumbnail_path`
  - `category`
  - `instructor_name`

---

## 🎓 Example: Create First Course

```sql
-- 1. Create course
INSERT INTO training_courses (
  course_code, title, short_description,
  course_type, delivery_mode, status, is_admin_created
) VALUES (
  'TEST-001',
  'Getting Started',
  'Your first course',
  'Course',
  'Self Paced',
  'Published',
  true
) RETURNING id;

-- 2. Add content (replace COURSE_ID with returned ID)
INSERT INTO course_content_items (
  course_id, content_type, title, display_order, video_url
) VALUES (
  'COURSE_ID',
  'video',
  'Welcome Video',
  1,
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
);
```

---

## 🎮 API Endpoints Quick Ref

### Admin Endpoints (Auth Required + Role Check)
```
GET    /api/admin/courses              - List courses
GET    /api/admin/courses/:id          - Get course
POST   /api/admin/courses              - Create course
PATCH  /api/admin/courses/:id          - Update course
DELETE /api/admin/courses/:id          - Delete course
POST   /api/admin/courses/:id/thumbnail - Upload thumbnail
POST   /api/admin/courses/:id/content  - Add content
PATCH  /api/admin/courses/:courseId/content/:id - Update content
DELETE /api/admin/courses/:courseId/content/:id - Delete content
PATCH  /api/admin/courses/:id/publish  - Publish/Unpublish
```

### Public Endpoints (Auth Required)
```
GET /api/learning-module/dynamic/published-courses - Get all published
GET /api/learning-module/dynamic/course/:id        - Get single course
```

---

## 📦 File Structure

```
server/
  src/routes/
    ├── adminCourses.js          ← Admin API
    └── learningModuleDynamic.js ← User API

client/
  app/(app)/
    ├── admin/learning/page.jsx  ← Admin UI
    └── learning-module/page.jsx ← User UI
  components/
    └── CourseEditorModal.jsx    ← Course Editor

db/
  ├── pg/16_admin_course_content.sql    ← PostgreSQL
  └── mssql/16_admin_course_content.sql ← SQL Server
```

---

## ✅ Pre-Deployment Checklist

```
Database:
□ Run migration (16_admin_course_content.sql)
□ Verify tables created (course_content_items, content_item_progress)
□ Test with SELECT queries

Server:
□ Set ADMIN_COURSE_ROLES in .env
□ Restart server
□ Check /api/health endpoint

Access:
□ Verify admin user has correct role
□ Test login and navigate to /admin
□ Confirm "Learning" tab appears

Storage:
□ Configure STORAGE_DRIVER (supabase or localDisk)
□ For Supabase: Create/verify bucket
□ For Local: Create uploads directory

Testing:
□ Create test course
□ Upload thumbnail
□ Add content (all types)
□ Publish course
□ Verify in /learning-module
□ Test as non-admin user

Production:
□ Backup database
□ Document custom roles
□ Train admins
□ Announce to users
```

---

## 🆘 Emergency Commands

### Reset Course (if stuck)
```sql
-- Unpublish course
UPDATE training_courses SET status = 'Draft' WHERE id = 'COURSE_ID';

-- Delete all content
DELETE FROM course_content_items WHERE course_id = 'COURSE_ID';

-- Delete course
DELETE FROM training_courses WHERE id = 'COURSE_ID';
```

### Check What's Published
```sql
SELECT id, title, status, is_admin_created
FROM training_courses
WHERE is_admin_created = true AND status = 'Published';
```

### Fix Role Issues
```sql
-- Show all permission roles
SELECT * FROM app_permission_roles;

-- Show user's roles
SELECT au.email, pr.role_key
FROM app_users au
JOIN user_permission_role_map m ON au.id = m.user_id
JOIN app_permission_roles pr ON pr.id = m.permission_role_id;
```

---

## 📞 Need Help?

1. **Setup Issues**: See `SETUP_GUIDE.md`
2. **Technical Docs**: See `LEARNING_MODULE_IMPLEMENTATION.md`
3. **Full Summary**: See `IMPLEMENTATION_SUMMARY.md`

---

## 🎉 Success Indicators

✅ Admin can access `/admin/learning`  
✅ Can create course with content  
✅ Published courses appear in `/learning-module`  
✅ Users can view course content  
✅ Files upload successfully  
✅ Course viewer works (videos play, PDFs display)  

**If all ✅ then you're ready to go!**

---

*Last Updated: September 11, 2026*
