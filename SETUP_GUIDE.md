# Quick Setup Guide - Dynamic Learning Module

## Step-by-Step Setup

### 1. Database Migration

#### For Supabase (PostgreSQL):
1. Go to your Supabase project: https://supabase.com
2. Open **SQL Editor**
3. Run the migration script:
   ```sql
   -- Copy and paste the contents of:
   -- db/pg/16_admin_course_content.sql
   ```
4. Verify tables created:
   ```sql
   -- Check if new columns exist
   SELECT column_name FROM information_schema.columns 
   WHERE table_name = 'training_courses' 
   AND column_name IN ('is_admin_created', 'short_description', 'cover_image_url');
   
   -- Check if new tables exist
   SELECT table_name FROM information_schema.tables 
   WHERE table_name IN ('course_content_items', 'content_item_progress');
   ```

#### For SQL Server (MSSQL):
1. Open **SQL Server Management Studio** or **Azure Data Studio**
2. Connect to your database
3. Run the migration script:
   ```sql
   -- Copy and paste the contents of:
   -- db/mssql/16_admin_course_content.sql
   ```

### 2. Server Configuration

1. **Update `server/.env`:**
   ```env
   # Your existing configuration...
   
   # Add this line for admin course access:
   ADMIN_COURSE_ROLES=admin,executive
   ```
   
   **Note:** Change `executive` to any role name you want to grant admin course access.

2. **Install dependencies** (if not already done):
   ```bash
   cd server
   npm install
   ```

3. **Start the server:**
   ```bash
   cd server
   npm run dev
   ```

### 3. Client Setup

1. **No additional dependencies needed** - All UI components use existing packages

2. **Start the client:**
   ```bash
   cd client
   npm run dev
   ```

### 4. Verify Installation

#### Test Admin Access:
1. Open browser: `http://localhost:3000`
2. Login with a user that has `admin` or `executive` role
3. Navigate to: `/admin`
4. You should see a new "Learning" tab
5. Click the "Learning" tab
6. Click "Manage Courses" button
7. You should see the course management interface

#### Create Your First Course:
1. Click "**+ Create Course**"
2. Fill in course details:
   - **Title**: "Introduction to Testing" (required)
   - **Short Description**: "Learn the basics"
   - **Category**: "Technology"
   - **Duration**: 2 hours
3. Upload a thumbnail image (optional)
4. Click "**Create & Add Content**"
5. Click "**Add Content Item**"
6. Select content type: **Video**
7. Enter a YouTube URL (e.g., `https://www.youtube.com/watch?v=dQw4w9WgXcQ`)
8. Add title: "Introduction Video"
9. Click "**Add Content**"
10. Click "**Publish**" (top right, changes to green "Published" button)

#### Verify in Learning Module:
1. Navigate to: `/learning-module`
2. You should see your published course in the "Available Courses" section
3. Click on the course card
4. The course viewer should open with your content

## Granting Admin Access to Specific Users

### Method 1: Via Environment Variable (Recommended)

Edit `server/.env`:
```env
# Grant access to multiple roles:
ADMIN_COURSE_ROLES=admin,executive,department_head,hr_manager

# Or just admin:
ADMIN_COURSE_ROLES=admin
```

**Restart the server** after changing the environment variable.

### Method 2: Via Database (Grant Role to User)

If you need to grant a specific user admin access:

```sql
-- Find the user
SELECT * FROM app_users WHERE email = 'user@example.com';

-- Find the admin role
SELECT * FROM app_permission_roles WHERE role_key = 'admin';

-- Grant admin role to user
INSERT INTO user_permission_role_map (user_id, permission_role_id)
VALUES (
  'USER_ID_HERE',
  'ADMIN_ROLE_ID_HERE'
);
```

### Method 3: Create Custom Role

1. **Create a new permission role:**
   ```sql
   INSERT INTO app_permission_roles (role_key, role_name, description)
   VALUES (
     'learning_admin',
     'Learning Administrator',
     'Can manage learning courses and content'
   );
   ```

2. **Assign to users:**
   ```sql
   -- Find user and role IDs
   SELECT id, email FROM app_users WHERE email = 'user@example.com';
   SELECT id, role_key FROM app_permission_roles WHERE role_key = 'learning_admin';
   
   -- Assign role
   INSERT INTO user_permission_role_map (user_id, permission_role_id)
   VALUES ('USER_ID', 'ROLE_ID');
   ```

3. **Update environment variable:**
   ```env
   ADMIN_COURSE_ROLES=admin,learning_admin
   ```

## Checking User Roles

To check which roles a user has:

```sql
SELECT 
  au.email,
  au.display_name,
  pr.role_key,
  pr.role_name
FROM app_users au
JOIN user_permission_role_map uprm ON au.id = uprm.user_id
JOIN app_permission_roles pr ON pr.id = uprm.permission_role_id
WHERE au.email = 'user@example.com';
```

## Storage Configuration

### Using Supabase Storage (Default for Cloud):
```env
STORAGE_DRIVER=supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_STORAGE_BUCKET=avatars
```

**Create storage bucket if needed:**
1. Go to Supabase Dashboard → Storage
2. Click "New bucket"
3. Name: `course-files` or reuse `avatars`
4. Make it **Public**

### Using Local Disk (For PGlite/Offline):
```env
STORAGE_DRIVER=localDisk
UPLOAD_DIR=./uploads
PUBLIC_FILE_BASE_URL=http://localhost:4000/files
```

Files will be saved to `server/uploads/` directory.

## Testing the Implementation

### Test Checklist:

- [ ] **Admin Access**
  - [ ] Login as admin user
  - [ ] Navigate to `/admin`
  - [ ] See "Learning" tab
  - [ ] Click "Manage Courses"

- [ ] **Course Creation**
  - [ ] Create a new course
  - [ ] Upload thumbnail image
  - [ ] Add video content (YouTube URL)
  - [ ] Add PDF content (upload file)
  - [ ] Add image content (upload file)
  - [ ] Add text content
  - [ ] Publish course

- [ ] **Learning Module**
  - [ ] Navigate to `/learning-module`
  - [ ] See published course in grid
  - [ ] Click course card
  - [ ] View video content (YouTube embed works)
  - [ ] Navigate between content items
  - [ ] View PDF content
  - [ ] View image content
  - [ ] View text content

- [ ] **Course Management**
  - [ ] Edit course details
  - [ ] Reorder content items
  - [ ] Delete content items
  - [ ] Unpublish course (should disappear from Learning Module)
  - [ ] Republish course (should reappear)
  - [ ] Delete entire course

- [ ] **Access Control**
  - [ ] Login as non-admin user
  - [ ] Verify `/admin/learning` returns 403
  - [ ] Verify published courses still visible in `/learning-module`

- [ ] **Both Database Modes** (if applicable)
  - [ ] Test with Supabase (PG_DRIVER=server)
  - [ ] Test with PGlite (PG_DRIVER=pglite)
  - [ ] Verify file uploads work in both modes

## Common Issues & Solutions

### Issue: "Insufficient permissions" when accessing admin courses
**Solution:** 
1. Check `ADMIN_COURSE_ROLES` in `server/.env`
2. Verify user has one of the specified roles
3. Restart the server after changing `.env`
4. Check JWT token includes correct roles

### Issue: Courses not appearing in Learning Module
**Solution:**
1. Verify course status is "Published"
2. Check browser console for API errors
3. Verify API endpoint: `GET /api/learning-module/dynamic/published-courses`
4. Check database: `SELECT * FROM training_courses WHERE is_admin_created = true AND status = 'Published';`

### Issue: File upload fails
**Solution:**
1. Check file size (max 100MB)
2. Verify storage configuration in `.env`
3. For Supabase: Check bucket exists and is public
4. For local disk: Check `UPLOAD_DIR` path exists and is writable
5. Check browser network tab for detailed error

### Issue: SQL migration errors
**Solution:**
1. Check if migration was already run: `SELECT * FROM course_content_items LIMIT 1;`
2. For Supabase: Run each statement separately if batch fails
3. For SQL Server: Ensure `GO` statements are recognized by your tool
4. Check database user has DDL permissions

### Issue: Video not playing
**Solution:**
1. For YouTube: Verify URL format is correct
2. For uploaded videos: Check video codec is web-compatible (H.264)
3. Check browser console for CORS errors
4. Verify video URL is accessible

## Example Data

To quickly test, insert sample data:

```sql
-- Create a sample course
INSERT INTO training_courses (
  course_code, title, short_description, description,
  course_type, delivery_mode, status, is_admin_created
) VALUES (
  'ADM-001',
  'Welcome to the Platform',
  'A quick introduction to get you started',
  'This course covers the basics of using the learning platform.',
  'Course',
  'Self Paced',
  'Published',
  true
) RETURNING id;

-- Add sample content (use the returned ID above)
INSERT INTO course_content_items (
  course_id,
  content_type,
  title,
  description,
  display_order,
  video_url
) VALUES (
  'COURSE_ID_HERE',
  'video',
  'Welcome Video',
  'An introduction to the course',
  1,
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
);
```

## Next Steps

After successful setup:

1. **Create actual courses** for your organization
2. **Upload real content** (training videos, PDFs, etc.)
3. **Organize courses** by categories
4. **Publish courses** to make them available
5. **Train admins** on course management
6. **Gather user feedback** on course content

## Support

If you encounter issues:
1. Check the `LEARNING_MODULE_IMPLEMENTATION.md` for detailed technical information
2. Review server logs: `cd server && npm run dev` (watch console output)
3. Check browser console for frontend errors
4. Verify all environment variables are set correctly
5. Ensure database migrations ran successfully

## Summary

You now have:
✅ A fully functional admin course management system  
✅ Dynamic course display in Learning Module  
✅ Support for multiple content types  
✅ Role-based access control  
✅ Both Supabase and PGlite compatibility  
✅ File upload capabilities  

Your users can now access high-quality, dynamic learning content directly in the platform!
