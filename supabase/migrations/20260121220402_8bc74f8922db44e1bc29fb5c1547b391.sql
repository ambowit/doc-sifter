-- Fix files table columns to allow NULL values
ALTER TABLE files 
  ALTER COLUMN status SET DEFAULT '待解析',
  ALTER COLUMN excerpt SET DEFAULT '',
  ALTER COLUMN page_ref SET DEFAULT '',
  ALTER COLUMN confidence SET DEFAULT 0,
  ALTER COLUMN parsed_content SET DEFAULT '{}';

-- Make optional columns nullable
ALTER TABLE files ALTER COLUMN excerpt DROP NOT NULL;
ALTER TABLE files ALTER COLUMN page_ref DROP NOT NULL;
ALTER TABLE files ALTER COLUMN confidence DROP NOT NULL;
ALTER TABLE files ALTER COLUMN parsed_content DROP NOT NULL;