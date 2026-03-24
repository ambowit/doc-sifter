-- 为 files 表添加实体识别和脱敏相关字段
ALTER TABLE files
  ADD COLUMN IF NOT EXISTS entities JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS redacted_file_url TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS entity_task_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS entity_task_status TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS entity_task_started_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS entity_task_completed_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN files.entities IS '实体识别结果，来自 Worker /tasks 回调';
COMMENT ON COLUMN files.redacted_file_url IS '脱敏后的 PDF 文件 URL';
COMMENT ON COLUMN files.entity_task_id IS 'Worker 异步任务 ID';
COMMENT ON COLUMN files.entity_task_status IS '任务状态: pending / processing / completed / failed';
