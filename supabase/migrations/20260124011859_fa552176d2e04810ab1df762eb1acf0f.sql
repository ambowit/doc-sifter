-- Create definitions table to store short names and full names for report entities
CREATE TABLE definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  short_name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT 'other' CHECK (entity_type IN ('company', 'individual', 'institution', 'transaction', 'other')),
  notes TEXT,
  has_conflict BOOLEAN DEFAULT false,
  conflict_with TEXT,
  source_file_id UUID REFERENCES files(id) ON DELETE SET NULL,
  source_page_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create index for faster lookup by project
CREATE INDEX idx_definitions_project_id ON definitions(project_id);

-- Create index for finding conflicts
CREATE INDEX idx_definitions_short_name ON definitions(project_id, short_name);

-- Add comment
COMMENT ON TABLE definitions IS '定义与简称表，存储报告中使用的主体简称和全称';
COMMENT ON COLUMN definitions.entity_type IS '实体类型: company=公司, individual=自然人, institution=机构, transaction=交易, other=其他';
COMMENT ON COLUMN definitions.has_conflict IS '是否存在简称冲突';
COMMENT ON COLUMN definitions.conflict_with IS '与哪个简称冲突';