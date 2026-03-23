-- 为 files 表添加 AI 分类和摘要字段
ALTER TABLE files
  ADD COLUMN IF NOT EXISTS chapter_id uuid REFERENCES chapters(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ai_summary text,
  ADD COLUMN IF NOT EXISTS ai_classified_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS classification_confidence integer;

-- 为 chapter_id 添加索引，加速按章节查询文件
CREATE INDEX IF NOT EXISTS idx_files_chapter_id ON files(chapter_id);
CREATE INDEX IF NOT EXISTS idx_files_project_id ON files(project_id);
