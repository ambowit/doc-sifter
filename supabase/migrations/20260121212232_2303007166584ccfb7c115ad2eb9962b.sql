-- Fix files table: add default values for optional columns
ALTER TABLE files 
  ALTER COLUMN status SET DEFAULT '待解析',
  ALTER COLUMN excerpt SET DEFAULT '',
  ALTER COLUMN page_ref SET DEFAULT '',
  ALTER COLUMN confidence SET DEFAULT 0,
  ALTER COLUMN parsed_content SET DEFAULT '{}';

-- Allow NULL for optional columns
ALTER TABLE files 
  ALTER COLUMN excerpt DROP NOT NULL,
  ALTER COLUMN page_ref DROP NOT NULL,
  ALTER COLUMN confidence DROP NOT NULL,
  ALTER COLUMN parsed_content DROP NOT NULL;