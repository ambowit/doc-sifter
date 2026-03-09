-- Report generation async jobs and persisted reports (latest-only per project/user)

CREATE TABLE IF NOT EXISTS public.generated_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'final' CHECK (status IN ('draft', 'final', 'archived')),
  version INTEGER NOT NULL DEFAULT 1,
  report_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  total_chapters INTEGER NOT NULL DEFAULT 0,
  total_files INTEGER NOT NULL DEFAULT 0,
  issues_found INTEGER NOT NULL DEFAULT 0,
  evidence_file_count INTEGER NOT NULL DEFAULT 0,
  citation_coverage NUMERIC(5,4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.report_generation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  current_stage TEXT NOT NULL DEFAULT 'queued',
  progress_message TEXT,
  processed_chapters INTEGER NOT NULL DEFAULT 0,
  total_chapters INTEGER NOT NULL DEFAULT 0,
  issues_found INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  report_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'report_generation_jobs_report_id_fkey'
  ) THEN
    ALTER TABLE public.report_generation_jobs
      ADD CONSTRAINT report_generation_jobs_report_id_fkey
      FOREIGN KEY (report_id) REFERENCES public.generated_reports(id) ON DELETE SET NULL;
  END IF;
END;
$$;

ALTER TABLE public.generated_reports
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'final',
  ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS report_json JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS summary_json JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS total_chapters INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_files INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS issues_found INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS evidence_file_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS citation_coverage NUMERIC(5,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

UPDATE public.generated_reports gr
SET user_id = p.user_id
FROM public.projects p
WHERE gr.project_id = p.id
  AND gr.user_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'generated_reports_user_id_fkey'
      AND conrelid = 'public.generated_reports'::regclass
  ) THEN
    ALTER TABLE public.generated_reports
      ADD CONSTRAINT generated_reports_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'generated_reports_status_check'
      AND conrelid = 'public.generated_reports'::regclass
  ) THEN
    ALTER TABLE public.generated_reports
      ADD CONSTRAINT generated_reports_status_check
      CHECK (status IN ('draft', 'final', 'archived'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.generated_reports WHERE user_id IS NULL) THEN
    ALTER TABLE public.generated_reports ALTER COLUMN user_id SET NOT NULL;
  END IF;
END;
$$;

WITH ranked AS (
  SELECT
    ctid,
    ROW_NUMBER() OVER (
      PARTITION BY project_id, user_id
      ORDER BY updated_at DESC, created_at DESC, id DESC
    ) AS row_num
  FROM public.generated_reports
  WHERE project_id IS NOT NULL AND user_id IS NOT NULL
)
DELETE FROM public.generated_reports gr
USING ranked
WHERE gr.ctid = ranked.ctid
  AND ranked.row_num > 1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_generated_reports_project_user_unique
  ON public.generated_reports(project_id, user_id);

CREATE INDEX IF NOT EXISTS idx_generated_reports_project_id
  ON public.generated_reports(project_id);

CREATE INDEX IF NOT EXISTS idx_generated_reports_user_id
  ON public.generated_reports(user_id);

CREATE INDEX IF NOT EXISTS idx_report_generation_jobs_project_id
  ON public.report_generation_jobs(project_id);

CREATE INDEX IF NOT EXISTS idx_report_generation_jobs_user_id
  ON public.report_generation_jobs(user_id);

CREATE INDEX IF NOT EXISTS idx_report_generation_jobs_status
  ON public.report_generation_jobs(status);

CREATE INDEX IF NOT EXISTS idx_report_generation_jobs_created_at
  ON public.report_generation_jobs(created_at DESC);

ALTER TABLE public.generated_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_generation_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own generated reports" ON public.generated_reports;
CREATE POLICY "Users can view own generated reports"
  ON public.generated_reports FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own generated reports" ON public.generated_reports;
CREATE POLICY "Users can update own generated reports"
  ON public.generated_reports FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own generated reports" ON public.generated_reports;
CREATE POLICY "Users can insert own generated reports"
  ON public.generated_reports FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access generated reports" ON public.generated_reports;
CREATE POLICY "Service role full access generated reports"
  ON public.generated_reports FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Users can view own report jobs" ON public.report_generation_jobs;
CREATE POLICY "Users can view own report jobs"
  ON public.report_generation_jobs FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own report jobs" ON public.report_generation_jobs;
CREATE POLICY "Users can update own report jobs"
  ON public.report_generation_jobs FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access report jobs" ON public.report_generation_jobs;
CREATE POLICY "Service role full access report jobs"
  ON public.report_generation_jobs FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP TRIGGER IF EXISTS generated_reports_updated_at ON public.generated_reports;
CREATE TRIGGER generated_reports_updated_at
  BEFORE UPDATE ON public.generated_reports
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS report_generation_jobs_updated_at ON public.report_generation_jobs;
CREATE TRIGGER report_generation_jobs_updated_at
  BEFORE UPDATE ON public.report_generation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.report_generation_jobs REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'report_generation_jobs'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.report_generation_jobs;
    END IF;
  END IF;
END;
$$;

COMMENT ON TABLE public.generated_reports IS 'Persisted latest generated report per project/user';
COMMENT ON TABLE public.report_generation_jobs IS 'Async report generation jobs';

