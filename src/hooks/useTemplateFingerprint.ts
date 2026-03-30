import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { mockTemplateFingerprint, type TemplateFingerprint as MockTemplateType } from "@/lib/reportMockData";
import { normalizeSupabaseError } from "@/lib/errorUtils";

// Re-export the complete template type from mockData
export type TemplateFingerprint = MockTemplateType & {
  id?: string;
  projectId?: string;
  createdAt?: string;
  updatedAt?: string;
};

interface DbTemplateFingerprint {
  id: string;
  project_id: string;
  template_id: string;
  name: string;
  version: string;
  locale: string | null;
  status: string | null;
  numbering: Record<string, unknown> | null;
  page: Record<string, unknown> | null;
  styles: Record<string, unknown> | null;
  lists: Record<string, unknown> | null;
  tables: Record<string, unknown> | null;
  figures: Record<string, unknown> | null;
  toc: unknown[] | null;
  section_blueprints: Record<string, unknown> | null;
  intro_variables: unknown[] | null;
  intro_content: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

// Transform DB record to frontend format, merging with defaults
function transformTemplateFingerprint(db: DbTemplateFingerprint): TemplateFingerprint {
  return {
    ...mockTemplateFingerprint, // Start with defaults
    id: db.template_id,
    projectId: db.project_id,
    name: db.name,
    version: db.version,
    locale: db.locale || mockTemplateFingerprint.locale,
    status: (db.status as TemplateFingerprint['status']) || mockTemplateFingerprint.status,
    numbering: (db.numbering as TemplateFingerprint['numbering']) || mockTemplateFingerprint.numbering,
    page: (db.page as TemplateFingerprint['page']) || mockTemplateFingerprint.page,
    styles: (db.styles as TemplateFingerprint['styles']) || mockTemplateFingerprint.styles,
    lists: (db.lists as TemplateFingerprint['lists']) || mockTemplateFingerprint.lists,
    tables: (db.tables as TemplateFingerprint['tables']) || mockTemplateFingerprint.tables,
    figures: (db.figures as TemplateFingerprint['figures']) || mockTemplateFingerprint.figures,
    toc: (db.toc as TemplateFingerprint['toc']) || mockTemplateFingerprint.toc,
    sectionBlueprints: (db.section_blueprints as TemplateFingerprint['sectionBlueprints']) || mockTemplateFingerprint.sectionBlueprints,
    introVariables: (db.intro_variables as TemplateFingerprint['introVariables']) || mockTemplateFingerprint.introVariables,
    introContent: (db.intro_content as TemplateFingerprint['introContent']) || mockTemplateFingerprint.introContent,
    createdAt: db.created_at,
    updatedAt: db.updated_at,
  };
}

// Default template uses the mock data as baseline
export const DEFAULT_TEMPLATE = mockTemplateFingerprint;

export function useTemplateFingerprint(projectId: string | undefined) {
  const queryClient = useQueryClient();

  // Fetch template fingerprint for a project
  const {
    data: templateFingerprint,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["templateFingerprint", projectId],
    queryFn: async () => {
      if (!projectId) return null;

      const { data, error } = await supabase
        .from("template_fingerprints")
        .select("*")
        .eq("project_id", projectId)
        .maybeSingle();

      if (error) throw new Error(normalizeSupabaseError(error, "获取模板失败"));

      if (data) {
        return transformTemplateFingerprint(data as DbTemplateFingerprint);
      }

      return null;
    },
    enabled: !!projectId,
  });

  // Create or update template fingerprint
  const saveMutation = useMutation({
    mutationFn: async (template: Partial<TemplateFingerprint> & { projectId: string }) => {
      const { projectId: pid, ...rest } = template;

      const payload = {
        project_id: pid,
        template_id: rest.id || DEFAULT_TEMPLATE.id,
        name: rest.name || DEFAULT_TEMPLATE.name,
        version: rest.version || DEFAULT_TEMPLATE.version,
        locale: rest.locale || DEFAULT_TEMPLATE.locale,
        status: rest.status || DEFAULT_TEMPLATE.status,
        numbering: rest.numbering || DEFAULT_TEMPLATE.numbering,
        page: rest.page || DEFAULT_TEMPLATE.page,
        styles: rest.styles || DEFAULT_TEMPLATE.styles,
        lists: rest.lists || DEFAULT_TEMPLATE.lists,
        tables: rest.tables || DEFAULT_TEMPLATE.tables,
        figures: rest.figures || DEFAULT_TEMPLATE.figures,
        toc: rest.toc || DEFAULT_TEMPLATE.toc,
        section_blueprints: rest.sectionBlueprints || DEFAULT_TEMPLATE.sectionBlueprints,
        intro_variables: rest.introVariables || DEFAULT_TEMPLATE.introVariables,
        intro_content: rest.introContent || DEFAULT_TEMPLATE.introContent,
      };

      // Check if template exists
      const { data: existing } = await supabase
        .from("template_fingerprints")
        .select("id")
        .eq("project_id", pid)
        .maybeSingle();

      if (existing) {
        // Update existing
        const { data, error } = await supabase
          .from("template_fingerprints")
          .update(payload)
          .eq("project_id", pid)
          .select()
          .single();

        if (error) throw new Error(normalizeSupabaseError(error, "更新模板失败"));
        return transformTemplateFingerprint(data as DbTemplateFingerprint);
      } else {
        // Insert new
        const { data, error } = await supabase
          .from("template_fingerprints")
          .insert(payload)
          .select()
          .single();

        if (error) throw new Error(normalizeSupabaseError(error, "保存模板失败"));
        return transformTemplateFingerprint(data as DbTemplateFingerprint);
      }
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["templateFingerprint", data.projectId], data);
    },
  });

  // Delete template fingerprint
  const deleteMutation = useMutation({
    mutationFn: async (templateId: string) => {
      const { error } = await supabase
        .from("template_fingerprints")
        .delete()
        .eq("id", templateId);

      if (error) throw new Error(normalizeSupabaseError(error, "删除模板失败"));
    },
    onSuccess: () => {
      queryClient.setQueryData(["templateFingerprint", projectId], null);
    },
  });

  // Initialize with default template if none exists
  const initializeTemplate = async () => {
    if (!projectId) return null;
    
    return saveMutation.mutateAsync({
      projectId,
      ...DEFAULT_TEMPLATE,
    });
  };

  return {
    templateFingerprint,
    isLoading,
    error,
    refetch,
    saveTemplate: saveMutation.mutateAsync,
    deleteTemplate: deleteMutation.mutateAsync,
    initializeTemplate,
    isSaving: saveMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}
