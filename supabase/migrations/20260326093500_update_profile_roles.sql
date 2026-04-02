-- Expand profile roles to align frontend and database
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'lawyer', 'senior_lawyer', 'junior_lawyer', 'assistant'));

COMMENT ON COLUMN profiles.role IS '用户角色：admin=管理员, lawyer=律师, senior_lawyer=高级律师, junior_lawyer=初级律师, assistant=助理';
