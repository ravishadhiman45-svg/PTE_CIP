# Dynamic Learning Module Implementation

## Overview

This implementation converts the existing static Learning Module into a dynamic, admin-managed course system while maintaining full compatibility with both **Supabase** and **PGlite** databases.

## What Was Implemented

### 1. Database Schema

**PostgreSQL (`db/pg/16_admin_course_content.sql`):**
- Extended `training_courses` table with admin course fields:
  - `short_description`, `cover_image_url`, `thumbnail_path`
  - `category`, `instructor_name`, `is_admin_created`
- New `course_content_items` table for dynamic content (video, image, PDF, text, link)
- New `content_item_progress` table for tracking completion
- Function `sync_content_progress()` to calculate course completion

**SQL Server (`db/mssql/16_admin_course_content.sql`):**
- Equivalent schema for MSSQL compatibility
- Stored procedure `sync_content_progress` (T-SQL version)

### 2. Backend API Routes

**Admin Course Management (`server/src/routes/adminCourses.js`):**
- `GET /api/admin/courses` - List all admin-created courses
- `GET /api/admin/courses/:id` - Get single course with content
- `POST /api/admin/courses` - Create new course
- `PATCH /api/admin/courses/:id` - Update course details
- `DELETE /api/admin/courses/:id` - Delete course and files
- `POST /api/admin/courses/:id/thumbnail` - Upload course thumbnail
- `POST /api/admin/courses/:id/content` - Add content item (with file upload)
- `PATCH /api/admin/courses/:courseId/content/:contentId` - Update content
- `DELETE /api/admin/courses/:courseId/content/:contentId` - Delete content
- `PATCH /api/admin/courses/:id/publish` - Publish/unpublish course

**Dynamic Learning Module (`server/src/routes/learningModuleDynamic.js`):**
- `GET /api/learning-module/dynamic/published-courses` - Fetch all published courses
- `GET /api/learning-module/dynamic/course/:courseId` - Get single published course

### 3. Frontend Components

**Admin Pages:**
- `/admin/learning` - Course management dashboard
- `CourseEditorModal.jsx` - Create/edit courses with content management

**Learning Module Updates:**
- Modified existing `/learning-module` page to display dynamic courses
- `DynamicCourseList` - Grid view of available courses
- `DynamicCourseModal` - Full-screen course viewer with content navigation
- Support for multiple content types:
  - **Video**: YouTube embeds or uploaded video files
  - **Image**: Display uploaded images
  - **PDF**: Embedded PDF viewer with "Open in New Tab" option
  - **Text**: Rich text content display
  - **Link**: External resource links

### 4. Role-Based Access Control

**Environment Configuration:**
Added `ADMIN_COURSE_ROLES` in `server/.env`:
```env
ADMIN_COURSE_ROLES=admin,executive
```

This allows configuring which permission roles can access admin course management. Users with any of the specified roles can:
- Create, edit, and delete courses
- Add, edit, and delete course content
- Upload media files
- Publish/unpublish courses

### 5. File Storage Integration

Reused existing storage abstraction (`server/src/storage/`) that supports:
- **Supabase Storage** - For cloud deployments
- **Local Disk** - For on-premise/offline deployments (PGlite)

Files are organized in buckets/folders:
- `course-thumbnails/` - Course cover images
- `course-content/videos/` - Uploaded video files
- `course-content/images/` - Uploaded image files
- `course-content/pdfs/` - Uploaded PDF files

## How It Works

### Admin Flow

1. **Access Control**: Admin users (or users with roles in `ADMIN_COURSE_ROLES`) navigate to Admin → Learning tab
2. **Create Course**: Click "Create Course" and fill in:
   - Title, short description, full description
   - Category, instructor, duration, difficulty
   - Upload thumbnail image
3. **Add Content**: After creating course, add content items:
   - Choose content type (video, image, PDF, text, link)
   - Upload files or provide URLs
   - Set title, description, duration
   - Content is automatically ordered
4. **Publish**: Click "Publish" to make course visible in Learning Module
5. **Manage**: Edit, reorder, or delete content items as needed

### User Flow

1. **View Courses**: All published courses appear automatically in the Learning Module
2. **Browse**: Courses displayed in a card grid with thumbnails and metadata
3. **Open Course**: Click any course card to open the full course viewer
4. **Navigate Content**: 
   - Sidebar shows all course lessons
   - Main area displays current content (video, PDF, image, text, or link)
   - Previous/Next buttons for sequential navigation
5. **Complete**: Progress can be tracked (future enhancement ready)

### Database Compatibility

The implementation works with **both** Supabase and PGlite:

**Supabase Mode:**
- Files stored in Supabase Storage buckets
- Full PostgreSQL database functionality
- Public URLs for media files

**PGlite Mode:**
- Files stored on local disk via `STORAGE_DRIVER=localDisk`
- Equivalent SQL functionality in PGlite
- Local file URLs served by Express

The application automatically uses the configured database and storage drivers without code changes.

## Content Types

### 1. Video
- **URL**: Paste YouTube/Vimeo URL (auto-detected and embedded)
- **File Upload**: Upload video file (MP4, MOV, AVI, WEBM)
- Display: Video player with controls

### 2. Image
- **File Upload**: Upload image file (JPG, PNG, GIF)
- Display: Responsive image viewer

### 3. PDF
- **File Upload**: Upload PDF document
- Display: Embedded PDF viewer + "Open in New Tab" button

### 4. Text
- **Rich Content**: Enter formatted text content
- Display: Formatted text with line breaks

### 5. Link
- **External URL**: Link to external resources
- Display: "Open Link" button with URL preview

## Key Features

✅ **Multi-Course Support**: Create unlimited courses with unlimited content items  
✅ **Draft/Published Status**: Courses only appear when published  
✅ **Content Ordering**: Reorder content items with up/down buttons  
✅ **File Management**: Automatic file cleanup when deleting content/courses  
✅ **Role-Based Access**: Configurable admin access via environment variable  
✅ **Database Agnostic**: Works with Supabase and PGlite  
✅ **Storage Agnostic**: Works with cloud storage and local disk  
✅ **Existing Data Preserved**: Traditional enrolled courses still work  
✅ **Responsive Design**: Mobile-friendly interface  
✅ **No Breaking Changes**: Existing Learning Module functionality maintained  

## Configuration

### Server Environment Variables

Add to `server/.env`:

```env
# Admin Course Management Access
# Comma-separated list of permission roles that can manage learning courses
ADMIN_COURSE_ROLES=admin,executive
```

### Database Setup

**For Supabase:**
Run in Supabase SQL Editor:
```sql
-- Run these in order:
-- 1. db/pg/01_schema.sql (if not already run)
-- 2. db/pg/16_admin_course_content.sql
```

**For PGlite/Local:**
The schema migrations run automatically when PGlite initializes.

**For SQL Server:**
Run in SSMS/Azure Data Studio:
```sql
-- Run these in order:
-- 1. db/mssql/01_schema.sql (if not already run)
-- 2. db/mssql/16_admin_course_content.sql
```

### Storage Configuration

The system uses the existing storage configuration:

**Supabase Storage:**
```env
STORAGE_DRIVER=supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_STORAGE_BUCKET=avatars  # Or create new bucket for courses
```

**Local Disk:**
```env
STORAGE_DRIVER=localDisk
UPLOAD_DIR=./uploads
PUBLIC_FILE_BASE_URL=http://localhost:4000/files
```

## Testing

### Test Admin Access

1. Start the server: `cd server && npm run dev`
2. Start the client: `cd client && npm run dev`
3. Login as a user with `admin` or `executive` role
4. Navigate to `/admin` → Click "Learning" tab
5. Click "Manage Courses" to access course management

### Test Course Creation

1. Click "Create Course"
2. Fill in course details
3. Upload a thumbnail (optional)
4. Click "Create & Add Content"
5. Add content items of different types
6. Click "Publish"
7. Navigate to `/learning-module` to verify course appears

### Test Both Databases

**Supabase Test:**
```env
PG_DRIVER=server
STORAGE_DRIVER=supabase
```
Verify: Courses appear, files upload to Supabase Storage

**PGlite Test:**
```env
PG_DRIVER=pglite
STORAGE_DRIVER=localDisk
PGLITE_DATA_DIR=./.pgdata
```
Verify: Courses appear, files save to local disk

## File Structure

```
server/
├── src/
│   ├── routes/
│   │   ├── adminCourses.js          # Admin course management API
│   │   └── learningModuleDynamic.js # Dynamic course API
│   └── index.js                      # Updated with new routes

client/
├── app/
│   └── (app)/
│       ├── admin/
│       │   ├── page.jsx              # Updated with Learning tab
│       │   └── learning/
│       │       └── page.jsx          # Admin course management UI
│       └── learning-module/
│           └── page.jsx              # Updated Learning Module
└── components/
    └── CourseEditorModal.jsx         # Course creation/editing modal

db/
├── pg/
│   └── 16_admin_course_content.sql  # PostgreSQL schema
└── mssql/
    └── 16_admin_course_content.sql  # SQL Server schema
```

## Future Enhancements

The implementation is ready for:
- ✨ Progress tracking per content item
- ✨ Content completion badges
- ✨ Course ratings and reviews
- ✨ Course categories and filtering
- ✨ Search functionality
- ✨ Enrollment system (assign courses to specific users/roles)
- ✨ Certificates upon completion
- ✨ Quiz/assessment integration
- ✨ Discussion forums per course

## Troubleshooting

**Courses not appearing:**
- Check course status is "Published"
- Verify `is_admin_created = true` in database
- Check browser console for API errors

**Upload failures:**
- Verify storage configuration in `.env`
- Check file size limits (default 100MB)
- Ensure Supabase bucket exists and is public

**Admin access denied:**
- Check user has correct role in database
- Verify `ADMIN_COURSE_ROLES` includes user's role
- Check JWT token is valid

**PGlite not working:**
- Ensure `PG_DRIVER=pglite` in `.env`
- Check `PGLITE_DATA_DIR` path exists
- Verify `STORAGE_DRIVER=localDisk` for file uploads

## Summary

This implementation successfully:
- ✅ Converts the static Learning Module to a dynamic system
- ✅ Maintains full backward compatibility
- ✅ Works with both Supabase and PGlite
- ✅ Provides role-based admin access via environment configuration
- ✅ Supports multiple content types
- ✅ Preserves existing authentication and authorization
- ✅ Reuses existing UI components and patterns
- ✅ Follows the project's architecture and conventions

The system is production-ready and can be extended with additional features as needed.
