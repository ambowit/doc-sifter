-- Align local migration history with remote: add file classification and entity fields
ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS chapter_id UUID REFERENCES public.chapters(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ai_summary TEXT,
  ADD COLUMN IF NOT EXISTS ai_classified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS classification_confidence INTEGER,
  ADD COLUMN IF NOT EXISTS entities JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS redacted_file_url TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS entity_task_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS entity_task_status TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS entity_task_started_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS entity_task_completed_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_files_chapter_id ON public.files(chapter_id);
CREATE INDEX IF NOT EXISTS idx_files_project_id ON public.files(project_id);

COMMENT ON COLUMN public.files.ai_summary IS 'AI 分类摘要';
COMMENT ON COLUMN public.files.ai_classified_at IS 'AI 分类完成时间';
COMMENT ON COLUMN public.files.classification_confidence IS 'AI 分类置信度';
COMMENT ON COLUMN public.files.entities IS '实体识别结果，来自 Worker /tasks 回调';
COMMENT ON COLUMN public.files.redacted_file_url IS '脱敏后的 PDF 文件 URL';
COMMENT ON COLUMN public.files.entity_task_id IS '实体识别异步任务 ID';
COMMENT ON COLUMN public.files.entity_task_status IS '实体识别任务状态: pending / processing / completed / failed';
COMMENT ON COLUMN public.files.entity_task_started_at IS '实体识别任务开始时间';
COMMENT ON COLUMN public.files.entity_task_completed_at IS '实体识别任务完成时间';
