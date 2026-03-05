-- =============================================================================
-- Migration: Report Generation Jobs & Persistent Reports (Part 1: Tables)
-- =============================================================================

-- Drop existing tables if any (for clean re-run)
DROP TABLE IF EXISTS generated_reports CASCADE;
DROP TABLE IF EXISTS report_generation_jobs CASCADE;

-- 1. Create report_generation_jobs table
CREATE TABLE report_generation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  current_stage TEXT DEFAULT 'queued',
  progress_message TEXT,
  
  processed_chapters INTEGER DEFAULT 0,
  total_chapters INTEGER DEFAULT 0,
  issues_found INTEGER DEFAULT 0,
  
  error_code TEXT,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  
  report_id UUID,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Create generated_reports table
CREATE TABLE generated_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  job_id UUID,
  
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final', 'archived')),
  version INTEGER NOT NULL DEFAULT 1,
  
  report_json JSONB NOT NULL DEFAULT '{}',
  summary_json JSONB DEFAULT '{}',
  
  title TEXT,
  client TEXT,
  target TEXT,
  
  total_chapters INTEGER DEFAULT 0,
  total_files INTEGER DEFAULT 0,
  issues_found INTEGER DEFAULT 0,
  evidence_file_count INTEGER DEFAULT 0,
  citation_coverage NUMERIC(5,4) DEFAULT 0,
  
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Add foreign keys
ALTER TABLE report_generation_jobs
  ADD CONSTRAINT fk_report_jobs_report
  FOREIGN KEY (report_id) REFERENCES generated_reports(id) ON DELETE SET NULL;

ALTER TABLE generated_reports
  ADD CONSTRAINT fk_generated_reports_job
  FOREIGN KEY (job_id) REFERENCES report_generation_jobs(id) ON DELETE SET NULL;

-- 4. Create indexes
CREATE INDEX idx_report_jobs_project_id ON report_generation_jobs(project_id);
CREATE INDEX idx_report_jobs_user_id ON report_generation_jobs(user_id);
CREATE INDEX idx_report_jobs_status ON report_generation_jobs(status);
CREATE INDEX idx_report_jobs_created_at ON report_generation_jobs(created_at DESC);

CREATE INDEX idx_generated_reports_project_id ON generated_reports(project_id);
CREATE INDEX idx_generated_reports_job_id ON generated_reports(job_id);
CREATE INDEX idx_generated_reports_created_by ON generated_reports(created_by);
CREATE INDEX idx_generated_reports_created_at ON generated_reports(created_at DESC);

-- 5. Enable RLS
ALTER TABLE report_generation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_reports ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policies for report_generation_jobs
CREATE POLICY "Users can view own jobs"
  ON report_generation_jobs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own jobs"
  ON report_generation_jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own jobs"
  ON report_generation_jobs FOR UPDATE
  USING (auth.uid() = user_id);

-- 7. RLS Policies for generated_reports
CREATE POLICY "Users can view own reports"
  ON generated_reports FOR SELECT
  USING (auth.uid() = created_by);

CREATE POLICY "Users can create reports"
  ON generated_reports FOR INSERT
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can update own reports"
  ON generated_reports FOR UPDATE
  USING (auth.uid() = created_by);

CREATE POLICY "Users can delete own reports"
  ON generated_reports FOR DELETE
  USING (auth.uid() = created_by);
