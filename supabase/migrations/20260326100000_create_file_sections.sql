-- 文件章节切分表
-- 存储从文档中解析出的章节结构和内容

CREATE TABLE IF NOT EXISTS file_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  
  -- 章节信息
  title TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  order_index INTEGER NOT NULL DEFAULT 0,
  content TEXT,
  
  -- 在原文中的位置
  start_position INTEGER,
  end_position INTEGER,
  
  -- 与模板章节的匹配关系
  matched_chapter_id UUID REFERENCES chapters(id) ON DELETE SET NULL,
  match_confidence NUMERIC(5,2),
  match_method TEXT, -- 'auto' | 'manual'
  
  -- 时间戳
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_file_sections_file_id ON file_sections(file_id);
CREATE INDEX idx_file_sections_project_id ON file_sections(project_id);
CREATE INDEX idx_file_sections_matched_chapter ON file_sections(matched_chapter_id);
CREATE INDEX idx_file_sections_level ON file_sections(level);

-- 更新时间触发器
CREATE OR REPLACE FUNCTION update_file_sections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_file_sections_updated_at
  BEFORE UPDATE ON file_sections
  FOR EACH ROW
  EXECUTE FUNCTION update_file_sections_updated_at();

-- RLS 策略
ALTER TABLE file_sections ENABLE ROW LEVEL SECURITY;

-- 允许用户访问自己项目的文件章节
CREATE POLICY "Users can view file sections in their projects"
  ON file_sections FOR SELECT
  USING (
    project_id IN (
      SELECT id FROM projects WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert file sections in their projects"
  ON file_sections FOR INSERT
  WITH CHECK (
    project_id IN (
      SELECT id FROM projects WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update file sections in their projects"
  ON file_sections FOR UPDATE
  USING (
    project_id IN (
      SELECT id FROM projects WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete file sections in their projects"
  ON file_sections FOR DELETE
  USING (
    project_id IN (
      SELECT id FROM projects WHERE user_id = auth.uid()
    )
  );

-- 添加注释
COMMENT ON TABLE file_sections IS '文件章节切分表，存储从文档中解析出的章节结构和内容';
COMMENT ON COLUMN file_sections.title IS '章节标题';
COMMENT ON COLUMN file_sections.level IS '章节层级 (1=一级标题, 2=二级标题, etc.)';
COMMENT ON COLUMN file_sections.order_index IS '在同级章节中的排序位置';
COMMENT ON COLUMN file_sections.content IS '该章节的文本内容';
COMMENT ON COLUMN file_sections.start_position IS '在原文中的起始字符位置';
COMMENT ON COLUMN file_sections.end_position IS '在原文中的结束字符位置';
COMMENT ON COLUMN file_sections.matched_chapter_id IS '匹配到的模板章节ID';
COMMENT ON COLUMN file_sections.match_confidence IS '匹配置信度 (0-100)';
COMMENT ON COLUMN file_sections.match_method IS '匹配方式: auto=自动, manual=手动';
