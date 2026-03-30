-- Align local migration history with remote: keep duplicate remote OCR task migration version
-- This migration is intentionally idempotent because remote history contains two OCR task versions.
ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS ocr_task_id TEXT,
  ADD COLUMN IF NOT EXISTS ocr_task_status TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ocr_task_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ocr_task_completed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_files_ocr_task_status
  ON public.files(ocr_task_status)
  WHERE ocr_task_status IS NOT NULL;
