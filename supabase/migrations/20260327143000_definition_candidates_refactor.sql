-- Definition management domain refactor: candidate workflow + provenance support

CREATE TABLE IF NOT EXISTS public.definition_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  short_name TEXT,
  full_name TEXT,
  entity_type TEXT NOT NULL DEFAULT 'other' CHECK (entity_type IN ('company', 'individual', 'institution', 'transaction', 'other')),
  notes TEXT,
  confidence NUMERIC(5,4),
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'approved', 'rejected', 'archived')),
  origin TEXT NOT NULL DEFAULT 'ai' CHECK (origin IN ('ai', 'manual', 'imported')),
  source_file_id UUID REFERENCES public.files(id) ON DELETE SET NULL,
  source_page_ref TEXT,
  source_excerpt TEXT,
  source_trace JSONB NOT NULL DEFAULT '[]'::jsonb,
  extraction_batch_id TEXT NOT NULL,
  merged_definition_id UUID REFERENCES public.definitions(id) ON DELETE SET NULL,
  has_conflict BOOLEAN NOT NULL DEFAULT false,
  conflict_with TEXT,
  review_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_definition_candidates_project_id
  ON public.definition_candidates(project_id);

CREATE INDEX IF NOT EXISTS idx_definition_candidates_project_status
  ON public.definition_candidates(project_id, status);

CREATE INDEX IF NOT EXISTS idx_definition_candidates_batch
  ON public.definition_candidates(project_id, extraction_batch_id);

CREATE INDEX IF NOT EXISTS idx_definition_candidates_source_file
  ON public.definition_candidates(source_file_id);

ALTER TABLE public.definition_candidates ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'definition_candidates'
      AND policyname = 'Users can view definition candidates in own projects'
  ) THEN
    CREATE POLICY "Users can view definition candidates in own projects"
      ON public.definition_candidates
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM public.projects p
          WHERE p.id = definition_candidates.project_id
            AND p.user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'definition_candidates'
      AND policyname = 'Users can create definition candidates in own projects'
  ) THEN
    CREATE POLICY "Users can create definition candidates in own projects"
      ON public.definition_candidates
      FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.projects p
          WHERE p.id = definition_candidates.project_id
            AND p.user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'definition_candidates'
      AND policyname = 'Users can update definition candidates in own projects'
  ) THEN
    CREATE POLICY "Users can update definition candidates in own projects"
      ON public.definition_candidates
      FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM public.projects p
          WHERE p.id = definition_candidates.project_id
            AND p.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.projects p
          WHERE p.id = definition_candidates.project_id
            AND p.user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'definition_candidates'
      AND policyname = 'Users can delete definition candidates in own projects'
  ) THEN
    CREATE POLICY "Users can delete definition candidates in own projects"
      ON public.definition_candidates
      FOR DELETE
      USING (
        EXISTS (
          SELECT 1 FROM public.projects p
          WHERE p.id = definition_candidates.project_id
            AND p.user_id = auth.uid()
        )
      );
  END IF;
END $$;

ALTER TABLE public.definitions
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('ai', 'manual', 'imported')),
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_excerpt TEXT,
  ADD COLUMN IF NOT EXISTS source_trace JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_synced_candidate_id UUID REFERENCES public.definition_candidates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_definitions_last_synced_candidate_id
  ON public.definitions(last_synced_candidate_id);

CREATE OR REPLACE VIEW public.active_definitions_view AS
SELECT d.*
FROM public.definitions d;

COMMENT ON TABLE public.definition_candidates IS 'AI 定义候选表，存储待复核的定义抽取结果及证据链';
COMMENT ON COLUMN public.definition_candidates.source_trace IS '来源追踪信息，包含候选来源文件、片段、模型输出等';
COMMENT ON COLUMN public.definitions.source_trace IS '最终定义的来源追踪信息';
