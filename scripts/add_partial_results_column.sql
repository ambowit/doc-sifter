-- Add partial_results column to report_generation_jobs table
ALTER TABLE public.report_generation_jobs 
ADD COLUMN IF NOT EXISTS partial_results JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.report_generation_jobs.partial_results IS 'Stores intermediate results during batch processing';
