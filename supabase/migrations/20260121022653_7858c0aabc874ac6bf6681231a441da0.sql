-- 项目表：存储尽调项目信息
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  client TEXT NOT NULL,
  target TEXT NOT NULL,
  description TEXT,
  project_type TEXT NOT NULL DEFAULT '股权收购' CHECK (project_type IN ('股权收购', '资产收购', 'IPO', '债券发行', '融资', '其他')),
  report_language TEXT NOT NULL DEFAULT '中文' CHECK (report_language IN ('中文', '英文', '中英双语')),
  strict_evidence_mode BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT '未上传' CHECK (status IN ('未上传', '解析中', '映射中', '待审阅', '已完成')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 启用 RLS
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- RLS 策略：用户只能查看自己的项目
CREATE POLICY "Users can view own projects"
  ON projects FOR SELECT
  USING (auth.uid() = user_id);

-- RLS 策略：用户只能创建自己的项目
CREATE POLICY "Users can create own projects"
  ON projects FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- RLS 策略：用户只能更新自己的项目
CREATE POLICY "Users can update own projects"
  ON projects FOR UPDATE
  USING (auth.uid() = user_id);

-- RLS 策略：用户只能删除自己的项目
CREATE POLICY "Users can delete own projects"
  ON projects FOR DELETE
  USING (auth.uid() = user_id);

-- 创建 updated_at 触发器
CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 文件表：存储上传的尽调文件元数据
CREATE TABLE files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  original_name TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('合同', '公司治理', '财务', '知识产权', '人事', '诉讼', '其他')),
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  storage_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '待解析' CHECK (status IN ('待解析', '解析中', '已解析', '解析失败')),
  excerpt TEXT,
  page_ref TEXT,
  confidence INTEGER CHECK (confidence >= 0 AND confidence <= 100),
  parsed_content JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 启用 RLS
ALTER TABLE files ENABLE ROW LEVEL SECURITY;

-- RLS 策略：用户只能查看自己项目中的文件
CREATE POLICY "Users can view files in own projects"
  ON files FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects 
      WHERE projects.id = files.project_id 
      AND projects.user_id = auth.uid()
    )
  );

-- RLS 策略：用户只能在自己的项目中创建文件
CREATE POLICY "Users can create files in own projects"
  ON files FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects 
      WHERE projects.id = files.project_id 
      AND projects.user_id = auth.uid()
    )
  );

-- RLS 策略：用户只能更新自己项目中的文件
CREATE POLICY "Users can update files in own projects"
  ON files FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projects 
      WHERE projects.id = files.project_id 
      AND projects.user_id = auth.uid()
    )
  );

-- RLS 策略：用户只能删除自己项目中的文件
CREATE POLICY "Users can delete files in own projects"
  ON files FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM projects 
      WHERE projects.id = files.project_id 
      AND projects.user_id = auth.uid()
    )
  );

-- 创建 updated_at 触发器
CREATE TRIGGER files_updated_at
  BEFORE UPDATE ON files
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 章节表：存储报告模板的章节结构
CREATE TABLE chapters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES chapters(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1 AND level <= 5),
  order_index INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  status TEXT NOT NULL DEFAULT '未匹配' CHECK (status IN ('未匹配', '资料不足', '已匹配')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 启用 RLS
ALTER TABLE chapters ENABLE ROW LEVEL SECURITY;

-- RLS 策略：用户只能查看自己项目中的章节
CREATE POLICY "Users can view chapters in own projects"
  ON chapters FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects 
      WHERE projects.id = chapters.project_id 
      AND projects.user_id = auth.uid()
    )
  );

-- RLS 策略：用户只能在自己的项目中创建章节
CREATE POLICY "Users can create chapters in own projects"
  ON chapters FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects 
      WHERE projects.id = chapters.project_id 
      AND projects.user_id = auth.uid()
    )
  );

-- RLS 策略：用户只能更新自己项目中的章节
CREATE POLICY "Users can update chapters in own projects"
  ON chapters FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projects 
      WHERE projects.id = chapters.project_id 
      AND projects.user_id = auth.uid()
    )
  );

-- RLS 策略：用户只能删除自己项目中的章节
CREATE POLICY "Users can delete chapters in own projects"
  ON chapters FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM projects 
      WHERE projects.id = chapters.project_id 
      AND projects.user_id = auth.uid()
    )
  );

-- 创建 updated_at 触发器
CREATE TRIGGER chapters_updated_at
  BEFORE UPDATE ON chapters
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 章节-文件映射表：存储章节与文件的关联关系
CREATE TABLE chapter_file_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  confidence INTEGER CHECK (confidence >= 0 AND confidence <= 100),
  is_ai_suggested BOOLEAN NOT NULL DEFAULT false,
  is_confirmed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(chapter_id, file_id)
);

-- 启用 RLS
ALTER TABLE chapter_file_mappings ENABLE ROW LEVEL SECURITY;

-- RLS 策略：用户只能查看自己项目中的映射
CREATE POLICY "Users can view mappings in own projects"
  ON chapter_file_mappings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM chapters 
      JOIN projects ON projects.id = chapters.project_id
      WHERE chapters.id = chapter_file_mappings.chapter_id 
      AND projects.user_id = auth.uid()
    )
  );

-- RLS 策略：用户只能在自己的项目中创建映射
CREATE POLICY "Users can create mappings in own projects"
  ON chapter_file_mappings FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM chapters 
      JOIN projects ON projects.id = chapters.project_id
      WHERE chapters.id = chapter_file_mappings.chapter_id 
      AND projects.user_id = auth.uid()
    )
  );

-- RLS 策略：用户只能更新自己项目中的映射
CREATE POLICY "Users can update mappings in own projects"
  ON chapter_file_mappings FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM chapters 
      JOIN projects ON projects.id = chapters.project_id
      WHERE chapters.id = chapter_file_mappings.chapter_id 
      AND projects.user_id = auth.uid()
    )
  );

-- RLS 策略：用户只能删除自己项目中的映射
CREATE POLICY "Users can delete mappings in own projects"
  ON chapter_file_mappings FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM chapters 
      JOIN projects ON projects.id = chapters.project_id
      WHERE chapters.id = chapter_file_mappings.chapter_id 
      AND projects.user_id = auth.uid()
    )
  );

-- 添加注释
COMMENT ON TABLE projects IS '尽调项目表';
COMMENT ON TABLE files IS '尽调文件元数据表';
COMMENT ON TABLE chapters IS '报告章节结构表';
COMMENT ON TABLE chapter_file_mappings IS '章节与文件的映射关系表';

-- 创建索引优化查询
CREATE INDEX idx_projects_user_id ON projects(user_id);
CREATE INDEX idx_files_project_id ON files(project_id);
CREATE INDEX idx_chapters_project_id ON chapters(project_id);
CREATE INDEX idx_chapters_parent_id ON chapters(parent_id);
CREATE INDEX idx_mappings_chapter_id ON chapter_file_mappings(chapter_id);
CREATE INDEX idx_mappings_file_id ON chapter_file_mappings(file_id);