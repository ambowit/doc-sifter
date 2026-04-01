import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normalizeSupabaseError } from "@/lib/errorUtils";
import {
  DEFAULT_TEMPLATE_FINGERPRINT,
  createDefaultTemplateFingerprint,
  type TemplateFingerprint,
} from "@/lib/templateDefaults";

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
  selected_style_id: string | null;
  created_at: string;
  updated_at: string;
}

// Transform DB record to frontend format, merging with defaults
function transformTemplateFingerprint(db: DbTemplateFingerprint): TemplateFingerprint {
  return {
    ...DEFAULT_TEMPLATE_FINGERPRINT,
    id: db.id,
    projectId: db.project_id,
    templateId: db.template_id || DEFAULT_TEMPLATE_FINGERPRINT.templateId,
    name: db.name || DEFAULT_TEMPLATE_FINGERPRINT.name,
    version: db.version || DEFAULT_TEMPLATE_FINGERPRINT.version,
    locale: db.locale || DEFAULT_TEMPLATE_FINGERPRINT.locale,
    status: (db.status as TemplateFingerprint["status"]) || DEFAULT_TEMPLATE_FINGERPRINT.status,
    numbering: (db.numbering as TemplateFingerprint["numbering"]) || DEFAULT_TEMPLATE_FINGERPRINT.numbering,
    page: (db.page as TemplateFingerprint["page"]) || DEFAULT_TEMPLATE_FINGERPRINT.page,
    styles: (db.styles as TemplateFingerprint["styles"]) || DEFAULT_TEMPLATE_FINGERPRINT.styles,
    lists: (db.lists as TemplateFingerprint["lists"]) || DEFAULT_TEMPLATE_FINGERPRINT.lists,
    tables: (db.tables as TemplateFingerprint["tables"]) || DEFAULT_TEMPLATE_FINGERPRINT.tables,
    figures: (db.figures as TemplateFingerprint["figures"]) || DEFAULT_TEMPLATE_FINGERPRINT.figures,
    toc: (db.toc as TemplateFingerprint["toc"]) || DEFAULT_TEMPLATE_FINGERPRINT.toc,
    sectionBlueprints:
      (db.section_blueprints as TemplateFingerprint["sectionBlueprints"]) ||
      DEFAULT_TEMPLATE_FINGERPRINT.sectionBlueprints,
    introVariables:
      (db.intro_variables as TemplateFingerprint["introVariables"]) ||
      DEFAULT_TEMPLATE_FINGERPRINT.introVariables,
    introContent:
      (db.intro_content as TemplateFingerprint["introContent"]) || DEFAULT_TEMPLATE_FINGERPRINT.introContent,
    selectedStyleId: db.selected_style_id || null,
    createdAt: db.created_at,
    updatedAt: db.updated_at,
  };
}

export const DEFAULT_TEMPLATE = DEFAULT_TEMPLATE_FINGERPRINT;

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

      const stylesPayload = rest.styles || DEFAULT_TEMPLATE.styles;

      const payload = {
        project_id: pid,
        template_id: rest.templateId || DEFAULT_TEMPLATE.templateId,
        name: rest.name || DEFAULT_TEMPLATE.name,
        version: rest.version || DEFAULT_TEMPLATE.version,
        locale: rest.locale || DEFAULT_TEMPLATE.locale,
        status: rest.status || DEFAULT_TEMPLATE.status,
        numbering: rest.numbering || DEFAULT_TEMPLATE.numbering,
        page: rest.page || DEFAULT_TEMPLATE.page,
        styles: stylesPayload,
        lists: rest.lists || DEFAULT_TEMPLATE.lists,
        tables: rest.tables || DEFAULT_TEMPLATE.tables,
        figures: rest.figures || DEFAULT_TEMPLATE.figures,
        toc: rest.toc || DEFAULT_TEMPLATE.toc,
        section_blueprints: rest.sectionBlueprints || DEFAULT_TEMPLATE.sectionBlueprints,
        intro_variables: rest.introVariables || DEFAULT_TEMPLATE.introVariables,
        intro_content: rest.introContent || DEFAULT_TEMPLATE.introContent,
        selected_style_id: rest.selectedStyleId || null,
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

  const updateSelectedStyleMutation = useMutation({
    mutationFn: async (selectedStyleId: string | null) => {
      if (!projectId) return null;
      const { data, error } = await supabase
        .from("template_fingerprints")
        .update({ selected_style_id: selectedStyleId })
        .eq("project_id", projectId)
        .select()
        .single();

      if (error) throw new Error(normalizeSupabaseError(error, "更新模板样式失败"));
      return transformTemplateFingerprint(data as DbTemplateFingerprint);
    },
    onMutate: async (selectedStyleId) => {
      if (!projectId) return;
      await queryClient.cancelQueries({ queryKey: ["templateFingerprint", projectId] });
      const previous = queryClient.getQueryData<TemplateFingerprint | null>([
        "templateFingerprint",
        projectId,
      ]);
      if (previous) {
        queryClient.setQueryData(["templateFingerprint", projectId], {
          ...previous,
          selectedStyleId,
        });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["templateFingerprint", projectId], context.previous);
      }
    },
    onSuccess: (data) => {
      if (!data) return;
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
      ...createDefaultTemplateFingerprint(),
    });
  };

  return {
    templateFingerprint,
    isLoading,
    error,
    refetch,
    saveTemplate: saveMutation.mutateAsync,
    updateSelectedStyle: updateSelectedStyleMutation.mutateAsync,
    deleteTemplate: deleteMutation.mutateAsync,
    initializeTemplate,
    isSaving: saveMutation.isPending,
    isUpdatingSelectedStyle: updateSelectedStyleMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}
