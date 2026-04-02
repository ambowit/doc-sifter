-- Align local migration history with remote: add OCR task tracking fields
ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS ocr_task_id TEXT,
  ADD COLUMN IF NOT EXISTS ocr_task_status TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ocr_task_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ocr_task_completed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_files_ocr_task_status
  ON public.files(ocr_task_status)
  WHERE ocr_task_status IS NOT NULL;

COMMENT ON COLUMN public.files.ocr_task_id IS 'Worker 返回的 OCR 任务 ID';
COMMENT ON COLUMN public.files.ocr_task_status IS 'OCR 任务状态: pending / processing / completed / failed';
COMMENT ON COLUMN public.files.ocr_task_started_at IS 'OCR 任务开始时间';
COMMENT ON COLUMN public.files.ocr_task_completed_at IS 'OCR 任务完成时间';
