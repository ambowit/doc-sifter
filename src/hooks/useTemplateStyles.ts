import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normalizeSupabaseError } from "@/lib/errorUtils";
import {
  type TemplateStyle,
  ensureTemplateStylePreview,
} from "@/lib/templateStyles";

interface DbTemplateStyle {
  id: string;
  project_id: string;
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

  const query = useQuery({
    queryKey: ["templateStyles", projectId],
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
      queryClient.setQueryData(["templateStyles", data.projectId], (prev: TemplateStyle[] | undefined) => {
        if (!prev) return [data];
        return prev.map((item) => (item.id === data.id ? data : item));
      });
    },
  });

  return {
    ...query,
    updateStyle: updateStyle.mutateAsync,
    isUpdating: updateStyle.isPending,
  };
}
