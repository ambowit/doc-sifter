-- Check and disable RLS on files table if needed
ALTER TABLE files DISABLE ROW LEVEL SECURITY;

-- Drop any existing policies
DROP POLICY IF EXISTS "files_select_policy" ON files;
DROP POLICY IF EXISTS "files_insert_policy" ON files;
DROP POLICY IF EXISTS "files_update_policy" ON files;
DROP POLICY IF EXISTS "files_delete_policy" ON files;