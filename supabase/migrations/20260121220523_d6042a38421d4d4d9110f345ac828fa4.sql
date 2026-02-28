-- Remove the restrictive check constraint on file_type
ALTER TABLE files DROP CONSTRAINT IF EXISTS files_file_type_check;

-- Remove the restrictive check constraint on status as well if exists
ALTER TABLE files DROP CONSTRAINT IF EXISTS files_status_check;