-- 添加 OCR 任务相关字段到 files 表
-- 用于追踪异步 OCR 任务状态（大文件走 Worker 处理）

ALTER TABLE files
ADD COLUMN IF NOT EXISTS ocr_task_id TEXT,
ADD COLUMN IF NOT EXISTS ocr_task_status TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS ocr_task_started_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS ocr_task_completed_at TIMESTAMPTZ;

-- 添加索引以便查询待处理的任务
CREATE INDEX IF NOT EXISTS idx_files_ocr_task_status ON files(ocr_task_status) WHERE ocr_task_status IS NOT NULL;

COMMENT ON COLUMN files.ocr_task_id IS 'Worker 返回的任务 ID';
COMMENT ON COLUMN files.ocr_task_status IS 'OCR 任务状态: pending, processing, completed, failed';
COMMENT ON COLUMN files.ocr_task_started_at IS 'OCR 任务开始时间';
COMMENT ON COLUMN files.ocr_task_completed_at IS 'OCR 任务完成时间';
