-- =============================================================================
-- Migration: Report Generation Jobs & Persistent Reports
-- Purpose: Support server-side report generation with job tracking and persistence
-- =============================================================================

-- 1. Create report_generation_jobs table (任务队列表)
CREATE TABLE IF NOT EXISTS report_generation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Job status state machine: queued -> running -> succeeded/failed/cancelled
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),

  -- Progress tracking
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  current_stage TEXT DEFAULT 'queued' CHECK (current_stage IN ('queued', 'metadata', 'extract', 'analyze', 'finalize', 'completed', 'failed')),
  progress_message TEXT,

  -- Stats during processing
  processed_chapters INTEGER DEFAULT 0,
  total_chapters INTEGER DEFAULT 0,
  issues_found INTEGER DEFAULT 0,

  -- Intermediate batch results
  partial_results JSONB DEFAULT '{}'::jsonb,

  -- Error handling
  error_code TEXT,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,

  -- Result reference (set when report is generated)
  report_id UUID,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Create generated_reports table (报告持久化表)
CREATE TABLE IF NOT EXISTS generated_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  job_id UUID,

  -- Report status
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final', 'archived')),
  version INTEGER NOT NULL DEFAULT 1,

  -- Report content (JSONB for flexible structure)
  report_json JSONB NOT NULL DEFAULT '{}',
  summary_json JSONB DEFAULT '{}',

  -- Metadata
  title TEXT,
  client TEXT,
  target TEXT,

  -- Statistics snapshot
  total_chapters INTEGER DEFAULT 0,
  total_files INTEGER DEFAULT 0,
  issues_found INTEGER DEFAULT 0,
  evidence_file_count INTEGER DEFAULT 0,
  citation_coverage NUMERIC(5,4) DEFAULT 0,

  -- Audit fields
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Add foreign keys
ALTER TABLE report_generation_jobs
  ADD CONSTRAINT IF NOT EXISTS fk_report_jobs_report
  FOREIGN KEY (report_id) REFERENCES generated_reports(id) ON DELETE SET NULL;

ALTER TABLE generated_reports
  ADD CONSTRAINT IF NOT EXISTS fk_generated_reports_job
  FOREIGN KEY (job_id) REFERENCES report_generation_jobs(id) ON DELETE SET NULL;

-- 4. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_report_jobs_project_id ON report_generation_jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_report_jobs_user_id ON report_generation_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_report_jobs_status ON report_generation_jobs(status);
CREATE INDEX IF NOT EXISTS idx_report_jobs_created_at ON report_generation_jobs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_generated_reports_project_id ON generated_reports(project_id);
CREATE INDEX IF NOT EXISTS idx_generated_reports_job_id ON generated_reports(job_id);
CREATE INDEX IF NOT EXISTS idx_generated_reports_created_by ON generated_reports(created_by);
CREATE INDEX IF NOT EXISTS idx_generated_reports_created_at ON generated_reports(created_at DESC);

-- 5. Enable RLS
ALTER TABLE report_generation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_reports ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policies for report_generation_jobs
CREATE POLICY IF NOT EXISTS "Users can view own jobs"
  ON report_generation_jobs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "Users can create own jobs"
  ON report_generation_jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "Users can update own jobs"
  ON report_generation_jobs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "Service role full access on jobs"
  ON report_generation_jobs FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- 7. RLS Policies for generated_reports
CREATE POLICY IF NOT EXISTS "Users can view own reports"
  ON generated_reports FOR SELECT
  USING (auth.uid() = created_by);

CREATE POLICY IF NOT EXISTS "Users can create reports"
  ON generated_reports FOR INSERT
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY IF NOT EXISTS "Users can update own reports"
  ON generated_reports FOR UPDATE
  USING (auth.uid() = created_by);

CREATE POLICY IF NOT EXISTS "Users can delete own reports"
  ON generated_reports FOR DELETE
  USING (auth.uid() = created_by);

CREATE POLICY IF NOT EXISTS "Service role full access on reports"
  ON generated_reports FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- 8. updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE OR REPLACE TRIGGER update_report_jobs_updated_at
  BEFORE UPDATE ON report_generation_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_generated_reports_updated_at
  BEFORE UPDATE ON generated_reports
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 9. Comments
COMMENT ON TABLE report_generation_jobs IS '报告生成任务队列，支持后台异步执行';
COMMENT ON COLUMN report_generation_jobs.status IS '任务状态: queued=排队中, running=执行中, succeeded=成功, failed=失败, cancelled=已取消';
COMMENT ON COLUMN report_generation_jobs.current_stage IS '当前处理阶段';
COMMENT ON COLUMN report_generation_jobs.partial_results IS '分批处理过程中的中间结果';

COMMENT ON TABLE generated_reports IS '持久化的报告结果，支持跨设备访问和版本历史';
COMMENT ON COLUMN generated_reports.report_json IS '完整报告内容JSON';
COMMENT ON COLUMN generated_reports.summary_json IS '报告摘要JSON';
