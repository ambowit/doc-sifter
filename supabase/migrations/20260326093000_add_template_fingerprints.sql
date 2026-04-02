-- Create template_fingerprints table to persist template structure and styles
CREATE TABLE IF NOT EXISTS template_fingerprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  locale TEXT,
  status TEXT,
  numbering JSONB,
  page JSONB,
  styles JSONB,
  lists JSONB,
  tables JSONB,
  figures JSONB,
  toc JSONB,
  section_blueprints JSONB,
  intro_variables JSONB,
  intro_content JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id)
);

CREATE INDEX IF NOT EXISTS idx_template_fingerprints_project_id
  ON template_fingerprints(project_id);

ALTER TABLE template_fingerprints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view template fingerprints in own projects"
  ON template_fingerprints FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = template_fingerprints.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create template fingerprints in own projects"
  ON template_fingerprints FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = template_fingerprints.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update template fingerprints in own projects"
  ON template_fingerprints FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = template_fingerprints.project_id
      AND projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete template fingerprints in own projects"
  ON template_fingerprints FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = template_fingerprints.project_id
      AND projects.user_id = auth.uid()
    )
  );

DROP TRIGGER IF EXISTS template_fingerprints_updated_at ON template_fingerprints;

CREATE TRIGGER template_fingerprints_updated_at
  BEFORE UPDATE ON template_fingerprints
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

COMMENT ON TABLE template_fingerprints IS '模板指纹表，存储模板结构和样式配置';
