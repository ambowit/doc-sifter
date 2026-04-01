import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normalizeSupabaseError } from "@/lib/errorUtils";
import {
  type TemplateStyle,
  ensureTemplateStylePreview,
} from "@/lib/templateStyles";

interface DbTemplateStyle {
  id: string;
  project_id: string | null;
  name: string;
  description: string | null;
  preview: Record<string, unknown> | null;
  styles: Record<string, unknown> | null;
  tables: Record<string, unknown> | null;
  page: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

function transformTemplateStyle(db: DbTemplateStyle): TemplateStyle {
  return {
    id: db.id,
    projectId: db.project_id,
    name: db.name,
    description: db.description,
    preview: ensureTemplateStylePreview(db.preview as Record<string, unknown> | null),
    styles: db.styles || {},
    tables: db.tables || {},
    page: db.page || {},
    createdAt: db.created_at,
    updatedAt: db.updated_at,
  };
}

export function useTemplateStyles(projectId: string | undefined) {
  const queryClient = useQueryClient();

  // 获取全局模板
  const globalQuery = useQuery({
    queryKey: ["templateStyles", "global"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("template_styles")
        .select("*")
        .is("project_id", null)
        .order("created_at", { ascending: true });

      if (error) throw new Error(normalizeSupabaseError(error, "获取模板样式失败"));
      return (data || []).map((row) => transformTemplateStyle(row as DbTemplateStyle));
    },
  });

  // 获取项目专属自定义模板
  const customQuery = useQuery({
    queryKey: ["templateStyles", "custom", projectId],
    queryFn: async () => {
      if (!projectId) return null;
      const { data, error } = await supabase
        .from("template_styles")
        .select("*")
        .eq("project_id", projectId)
        .single();

      if (error) {
        if (error.code === "PGRST116") return null; // No rows found
        throw new Error(normalizeSupabaseError(error, "获取自定义模板失败"));
      }
      return data ? transformTemplateStyle(data as DbTemplateStyle) : null;
    },
    enabled: !!projectId,
  });

  // 合并全局模板和自定义模板
  const templateStyles = [
    ...(globalQuery.data || []),
    ...(customQuery.data ? [customQuery.data] : []),
  ];

  const updateStyle = useMutation({
    mutationFn: async (style: TemplateStyle) => {
      const payload = {
        name: style.name,
        description: style.description,
        preview: style.preview,
        styles: style.styles,
        tables: style.tables,
        page: style.page,
      };

      const { data, error } = await supabase
        .from("template_styles")
        .update(payload)
        .eq("id", style.id)
        .select()
        .single();

      if (error) throw new Error(normalizeSupabaseError(error, "更新模板样式失败"));
      return transformTemplateStyle(data as DbTemplateStyle);
    },
    onSuccess: (data) => {
      if (data.projectId) {
        queryClient.setQueryData(["templateStyles", "custom", data.projectId], data);
      } else {
        queryClient.setQueryData(["templateStyles", "global"], (prev: TemplateStyle[] | undefined) => {
          if (!prev) return [data];
          return prev.map((item) => (item.id === data.id ? data : item));
        });
      }
    },
  });

  // 创建或更新项目专属自定义模板
  const upsertCustomStyle = useMutation({
    mutationFn: async ({ projectId, style }: { projectId: string; style: Omit<TemplateStyle, "id" | "projectId" | "createdAt" | "updatedAt"> }) => {
      // 先检查是否已有自定义模板
      const { data: existing } = await supabase
        .from("template_styles")
        .select("id")
        .eq("project_id", projectId)
        .single();

      const payload = {
        project_id: projectId,
        name: style.name,
        description: style.description,
        preview: style.preview,
        styles: style.styles,
        tables: style.tables,
        page: style.page,
      };

      if (existing) {
        // 更新现有自定义模板
        const { data, error } = await supabase
          .from("template_styles")
          .update(payload)
          .eq("id", existing.id)
          .select()
          .single();

        if (error) throw new Error(normalizeSupabaseError(error, "更新自定义模板失败"));
        return transformTemplateStyle(data as DbTemplateStyle);
      } else {
        // 创建新的自定义模板
        const { data, error } = await supabase
          .from("template_styles")
          .insert(payload)
          .select()
          .single();

        if (error) throw new Error(normalizeSupabaseError(error, "创建自定义模板失败"));
        return transformTemplateStyle(data as DbTemplateStyle);
      }
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["templateStyles", "custom", data.projectId], data);
      queryClient.invalidateQueries({ queryKey: ["templateStyles", "custom", data.projectId] });
    },
  });

  return {
    data: templateStyles,
    isLoading: globalQuery.isLoading || customQuery.isLoading,
    isError: globalQuery.isError || customQuery.isError,
    error: globalQuery.error || customQuery.error,
    customStyle: customQuery.data,
    updateStyle: updateStyle.mutateAsync,
    isUpdating: updateStyle.isPending,
    upsertCustomStyle: upsertCustomStyle.mutateAsync,
    isUpsertingCustom: upsertCustomStyle.isPending,
  };
}
