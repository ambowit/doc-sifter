import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ChapterStatus, type ChapterStatusType } from "@/lib/enums";

export type { ChapterStatusType as ChapterStatus };

export interface Chapter {
  id: string;
  projectId: string;
  parentId: string | null;
  title: string;
  number: string | null;
  level: number;
  orderIndex: number;
  description: string;
  status: ChapterStatusType;
  createdAt: string;
  updatedAt: string;
  children?: Chapter[];
}

export interface CreateChapterData {
  projectId: string;
  parentId?: string | null;
  title: string;
  number?: string;
  level: number;
  orderIndex: number;
  description?: string;
}

// Transform database row to Chapter interface
const transformChapter = (row: Record<string, unknown>): Chapter => ({
  id: row.id as string,
  projectId: row.project_id as string,
  parentId: row.parent_id as string | null,
  title: row.title as string,
  number: row.number as string | null,
  level: row.level as number,
  orderIndex: row.order_index as number,
  description: row.description as string,
  status: row.status as ChapterStatusType,
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
});

// Build chapter tree from flat list
function buildChapterTree(chapters: Chapter[]): Chapter[] {
  const chapterMap = new Map<string, Chapter>();
  const rootChapters: Chapter[] = [];

  // First pass: create map and initialize children arrays
  chapters.forEach(chapter => {
    chapterMap.set(chapter.id, { ...chapter, children: [] });
  });

  // Second pass: build tree structure
  chapters.forEach(chapter => {
    const chapterWithChildren = chapterMap.get(chapter.id)!;
    if (chapter.parentId && chapterMap.has(chapter.parentId)) {
      const parent = chapterMap.get(chapter.parentId)!;
      parent.children = parent.children || [];
      parent.children.push(chapterWithChildren);
    } else {
      rootChapters.push(chapterWithChildren);
    }
  });

  // Sort children by orderIndex
  const sortChildren = (chapters: Chapter[]) => {
    chapters.sort((a, b) => a.orderIndex - b.orderIndex);
    chapters.forEach(chapter => {
      if (chapter.children && chapter.children.length > 0) {
        sortChildren(chapter.children);
      }
    });
  };

  sortChildren(rootChapters);
  return rootChapters;
}

// Hook to fetch all chapters for a project
export function useChapters(projectId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["chapters", projectId],
    queryFn: async () => {
      if (!user) throw new Error("User not authenticated");
      if (!projectId) throw new Error("Project ID is required");

      const { data, error } = await supabase
        .from("chapters")
        .select("*")
        .eq("project_id", projectId)
        .order("level", { ascending: true })
        .order("order_index", { ascending: true });

      if (error) throw error;
      
      const flatChapters = (data || []).map(transformChapter);
      return buildChapterTree(flatChapters);
    },
    enabled: !!user && !!projectId,
  });
}

// Hook to fetch flat chapter list
export function useFlatChapters(projectId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["flatChapters", projectId],
    queryFn: async () => {
      if (!user) throw new Error("User not authenticated");
      if (!projectId) throw new Error("Project ID is required");

      const { data, error } = await supabase
        .from("chapters")
        .select("*")
        .eq("project_id", projectId)
        .order("level", { ascending: true })
        .order("order_index", { ascending: true });

      if (error) throw error;
      return (data || []).map(transformChapter);
    },
    enabled: !!user && !!projectId,
  });
}

// Hook to create a single chapter
export function useCreateChapter() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (data: CreateChapterData) => {
      if (!user) throw new Error("User not authenticated");

      const { data: chapter, error } = await supabase
        .from("chapters")
        .insert({
          project_id: data.projectId,
          parent_id: data.parentId || null,
          title: data.title,
          number: data.number || null,
          level: data.level,
          order_index: data.orderIndex,
          description: data.description || "",
        })
        .select()
        .single();

      if (error) throw error;
      return transformChapter(chapter);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["chapters", variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ["flatChapters", variables.projectId] });
    },
  });
}

// Hook to bulk create chapters (from AI parsing)
export function useBulkCreateChapters() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ projectId, chapters }: { projectId: string; chapters: CreateChapterData[] }) => {
      if (!user) throw new Error("User not authenticated");

      // First, delete existing chapters for this project
      const { error: deleteError } = await supabase
        .from("chapters")
        .delete()
        .eq("project_id", projectId);

      if (deleteError) throw deleteError;

      // Insert new chapters
      const chaptersToInsert = chapters.map(ch => ({
        project_id: ch.projectId,
        parent_id: ch.parentId || null,
        title: ch.title,
        number: ch.number || null,
        level: ch.level,
        order_index: ch.orderIndex,
        description: ch.description || "",
      }));

      const { data, error } = await supabase
        .from("chapters")
        .insert(chaptersToInsert)
        .select();

      if (error) throw error;
      return (data || []).map(transformChapter);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["chapters", variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ["flatChapters", variables.projectId] });
    },
  });
}

// Hook to update chapter status
export function useUpdateChapterStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ chapterId, status }: { chapterId: string; status: ChapterStatusType }) => {
      const { data, error } = await supabase
        .from("chapters")
        .update({ status })
        .eq("id", chapterId)
        .select()
        .single();

      if (error) throw error;
      return transformChapter(data);
    },
    onSuccess: (chapter) => {
      queryClient.invalidateQueries({ queryKey: ["chapters", chapter.projectId] });
      queryClient.invalidateQueries({ queryKey: ["flatChapters", chapter.projectId] });
    },
  });
}

// Hook to delete all chapters for a project
export function useDeleteProjectChapters() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (projectId: string) => {
      if (!user) {
        console.error("[useDeleteProjectChapters] User not authenticated");
        throw new Error("User not authenticated");
      }

      console.log("[useDeleteProjectChapters] Deleting chapters for project:", projectId);

      const { data, error, count } = await supabase
        .from("chapters")
        .delete()
        .eq("project_id", projectId)
        .select();

      if (error) {
        console.error("[useDeleteProjectChapters] Delete error:", error);
        throw error;
      }

      console.log("[useDeleteProjectChapters] Deleted chapters:", data?.length || 0);
      return projectId;
    },
    onSuccess: (projectId) => {
      console.log("[useDeleteProjectChapters] Success, invalidating queries");
      queryClient.invalidateQueries({ queryKey: ["chapters", projectId] });
      queryClient.invalidateQueries({ queryKey: ["flatChapters", projectId] });
    },
    onError: (error) => {
      console.error("[useDeleteProjectChapters] Mutation error:", error);
    },
  });
}

// Generate chapter number from level and index
export function generateChapterNumber(level: number, parentNumber: string, index: number): string {
  if (level === 1) {
    return String(index + 1);
  }
  return `${parentNumber}.${index + 1}`;
}

// Flatten chapter tree with numbers
export function flattenChaptersWithNumbers(chapters: Chapter[], parentNumber = ""): Array<Chapter & { number: string }> {
  const result: Array<Chapter & { number: string }> = [];
  
  chapters.forEach((chapter, index) => {
    const number = generateChapterNumber(chapter.level, parentNumber, index);
    result.push({ ...chapter, number });
    
    if (chapter.children && chapter.children.length > 0) {
      result.push(...flattenChaptersWithNumbers(chapter.children, number));
    }
  });
  
  return result;
}
