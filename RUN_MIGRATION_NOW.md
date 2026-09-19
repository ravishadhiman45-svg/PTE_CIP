# 🚨 IMPORTANT: Run This Migration NOW

## Error You're Seeing:

```
column tc.short_description does not exist
```

This means the database migration hasn't been run yet.

## Solution (2 Minutes):

### Step 1: Go to Supabase Dashboard

1. Open your browser
2. Go to: https://supabase.com
3. Click on your project: **PTE CIP**

### Step 2: Open SQL Editor

1. In the left sidebar, click **SQL Editor**
2. Click **+ New query**

### Step 3: Copy & Paste This SQL

**Copy the ENTIRE content from: `db/pg/16_admin_course_content.sql`**

Or copy from here:

```sql
-- =============================================================
-- PTE CIP — ADMIN COURSE CONTENT MANAGEMENT
-- =============================================================

-- Extend training_courses with fields for admin-created courses
ALTER TABLE training_courses ADD COLUMN IF NOT EXISTS short_description TEXT;
ALTER TABLE training_courses ADD COLUMN IF NOT EXISTS cover_image_url TEXT;
ALTER TABLE training_courses ADD COLUMN IF NOT EXISTS thumbnail_path TEXT;
ALTER TABLE training_courses ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE training_courses ADD COLUMN IF NOT EXISTS instructor_name TEXT;
ALTER TABLE training_courses ADD COLUMN IF NOT EXISTS is_admin_created BOOLEAN NOT NULL DEFAULT FALSE;

-- Course content items (lessons/modules with actual content)
CREATE TABLE IF NOT EXISTS course_content_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES training_courses(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK (content_type IN ('video','image','pdf','text','link')),
  title TEXT NOT NULL,
  description TEXT,
  display_order INT NOT NULL,

  -- Video content
  video_url TEXT,
  video_file_path TEXT,

  -- Image content
  image_url TEXT,
  image_file_path TEXT,

  -- PDF content
  pdf_url TEXT,
  pdf_file_path TEXT,

  -- Text/rich content
  text_content TEXT,

  -- External link
  external_url TEXT,

  duration_minutes INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(course_id, display_order)
);

CREATE INDEX IF NOT EXISTS idx_course_content_items_course
  ON course_content_items(course_id);
CREATE INDEX IF NOT EXISTS idx_course_content_items_order
  ON course_content_items(course_id, display_order);

DROP TRIGGER IF EXISTS trg_course_content_items_updated_at ON course_content_items;
CREATE TRIGGER trg_course_content_items_updated_at
  BEFORE UPDATE ON course_content_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Track completion of content items
CREATE TABLE IF NOT EXISTS content_item_progress (
  enrollment_id UUID NOT NULL REFERENCES training_enrollments(id) ON DELETE CASCADE,
  content_item_id UUID NOT NULL REFERENCES course_content_items(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (enrollment_id, content_item_id)
);

CREATE INDEX IF NOT EXISTS idx_content_item_progress_enrollment
  ON content_item_progress(enrollment_id);

-- Recompute course progress from completed content items
CREATE OR REPLACE FUNCTION sync_content_progress(p_enrollment_id UUID)
RETURNS INT AS $$
DECLARE
  total      INT;
  done       INT;
  pct        INT;
  cur_status TEXT;
  new_status TEXT;
BEGIN
  SELECT count(*) INTO total
    FROM course_content_items cci
    JOIN training_enrollments te ON te.course_id = cci.course_id
   WHERE te.id = p_enrollment_id;

  IF total = 0 THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO done
    FROM content_item_progress
   WHERE enrollment_id = p_enrollment_id;

  SELECT status INTO cur_status FROM training_enrollments WHERE id = p_enrollment_id;
  pct := ROUND((done::numeric / total) * 100);

  IF cur_status IN ('Approved','In Progress','Completed') THEN
    new_status := CASE WHEN pct = 100 THEN 'Completed'
                       WHEN pct > 0   THEN 'In Progress'
                       ELSE cur_status END;
  ELSE
    new_status := cur_status;
  END IF;

  UPDATE training_enrollments
     SET progress_percent = pct,
         status = new_status,
         completed_at = CASE WHEN new_status = 'Completed' THEN COALESCE(completed_at, NOW())
                             ELSE NULL END
   WHERE id = p_enrollment_id;

  RETURN pct;
END;
$$ LANGUAGE plpgsql;
```

### Step 4: Run the SQL

1. Click the **RUN** button (or press F5)
2. Wait for it to complete (should take 1-2 seconds)
3. You should see: **Success. No rows returned**

### Step 5: Verify It Worked

Run this verification query:

```sql
-- Check if new columns exist
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'training_courses'
  AND column_name IN ('short_description', 'cover_image_url', 'thumbnail_path', 'category', 'instructor_name', 'is_admin_created');

-- Check if new tables exist
SELECT table_name
FROM information_schema.tables
WHERE table_name IN ('course_content_items', 'content_item_progress', 'employee_content_progress');
```

You should see 6 columns and 3 tables in the results.

### Step 6: Restart Your App

After the migration completes:

```bash
# The server should auto-restart (if using npm run dev)
# But if not, restart it manually:
cd /Users/laps/PTE_CIP/server
npm run dev
```

Then refresh your browser at: http://localhost:3000/learning-module

## ✅ Success Indicators

After migration:

- ✅ No more "column does not exist" errors
- ✅ Learning Module page loads without errors
- ✅ You can access `/admin/learning` (if you're an admin)

## ❌ If You Still See Errors

Check these:

1. **Did the SQL run successfully in Supabase?**
   - Look for green success message
   - No red error messages

2. **Did you restart the server?**

   ```bash
   cd /Users/laps/PTE_CIP/server
   # Kill the current process (Ctrl+C)
   npm run dev
   ```

3. **Check server logs for errors**
   - Look at the terminal where `npm run dev` is running
   - Check for database connection errors

## Need Help?

If migration fails, check:

- You're connected to the correct Supabase project
- The `training_courses` table exists
- The `set_updated_at()` function exists (from earlier migrations)

---

**Once this migration runs successfully, the Learning Module will work perfectly! 🎉**
