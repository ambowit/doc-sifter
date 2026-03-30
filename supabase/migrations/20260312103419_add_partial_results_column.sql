-- Align local migration history with remote: add partial_results to report jobs
ALTER TABLE public.report_generation_jobs
  ADD COLUMN IF NOT EXISTS partial_results JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.report_generation_jobs.partial_results IS '分批处理过程中的中间结果';
