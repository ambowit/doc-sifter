-- Drop the existing check constraint and add a new one with all roles
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin', 'lawyer', 'assistant', 'senior_lawyer', 'junior_lawyer'));

-- Now fix the roles for test users
UPDATE profiles SET role = 'admin' WHERE email = 'admin@ddorganizer.test';
UPDATE profiles SET role = 'senior_lawyer' WHERE email = 'senior@ddorganizer.test';
UPDATE profiles SET role = 'junior_lawyer' WHERE email = 'junior@ddorganizer.test';
UPDATE profiles SET role = 'assistant' WHERE email = 'assistant@ddorganizer.test';