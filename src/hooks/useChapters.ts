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

// Extract numeric prefix from chapter number (e.g., "1.2" -> 1, "第一章" -> 1)
function getChapterPrefix(num: string | null): number {
  if (!num) return Infinity;
  // Handle "第X章" format
  const zhMatch = num.match(/第([一二三四五六七八九十]+)章/);
  if (zhMatch) {
    const zhNums: Record<string, number> = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
    return zhNums[zhMatch[1]] || parseInt(zhMatch[1], 10) || Infinity;
  }
  // Handle "X.Y" format - extract the first number
  const parts = num.split('.');
  return parseInt(parts[0], 10) || Infinity;
}

// Parse chapter number for natural sorting (e.g., "1.2" -> [1, 2])
function parseChapterNumber(num: string | null): number[] {
  if (!num) return [Infinity];
  // Handle "第X章" format - treat as single level
  const zhMatch = num.match(/第([一二三四五六七八九十]+)章/);
  if (zhMatch) {
    const zhNums: Record<string, number> = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
    return [zhNums[zhMatch[1]] || 0];
  }
  return num.split('.').map(n => parseInt(n, 10) || 0);
}

// Compare two chapter numbers naturally
function compareChapterNumbers(a: string | null, b: string | null): number {
  const partsA = parseChapterNumber(a);
  const partsB = parseChapterNumber(b);
  const maxLen = Math.max(partsA.length, partsB.length);
  
  for (let i = 0; i < maxLen; i++) {
    const numA = partsA[i] ?? 0;
    const numB = partsB[i] ?? 0;
    if (numA !== numB) return numA - numB;
  }
  return 0;
}

// Build chapter tree from flat list based on level and number prefix
function buildChapterTree(chapters: Chapter[]): Chapter[] {
  // Separate chapters by level
  const level1Chapters = chapters.filter(c => c.level === 1);
  const level2Chapters = chapters.filter(c => c.level === 2);
  const level3Chapters = chapters.filter(c => c.level >= 3);

  // Sort level 1 chapters by number
  level1Chapters.sort((a, b) => compareChapterNumbers(a.number, b.number));

  // Build tree: assign children based on number prefix matching
  const rootChapters: Chapter[] = level1Chapters.map(parent => {
    const parentPrefix = getChapterPrefix(parent.number);
    
    // Find level 2 children whose number starts with parent prefix
    const children = level2Chapters
      .filter(child => {
        const childPrefix = getChapterPrefix(child.number);
        return childPrefix === parentPrefix;
      })
      .sort((a, b) => compareChapterNumbers(a.number, b.number))
      .map(child => {
        // Find level 3 children for this level 2 chapter
        const childNumber = child.number || "";
        const grandChildren = level3Chapters
          .filter(gc => {
            const gcNumber = gc.number || "";
            return gcNumber.startsWith(childNumber + ".");
          })
          .sort((a, b) => compareChapterNumbers(a.number, b.number))
          .map(gc => ({ ...gc, children: [] }));
        
        return { ...child, children: grandChildren };
      });
    
    return { ...parent, children };
  });

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

// Flatten tree to ordered list (parent followed by children)
function flattenChapterTree(tree: Chapter[]): Chapter[] {
  const result: Chapter[] = [];
  const traverse = (chapters: Chapter[]) => {
    for (const chapter of chapters) {
      const { children, ...chapterWithoutChildren } = chapter;
      result.push(chapterWithoutChildren as Chapter);
      if (children && children.length > 0) {
        traverse(children);
      }
    }
  };
  traverse(tree);
  return result;
}

// Hook to fetch flat chapter list (sorted by chapter number naturally, parent-child order)
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
      
      // Build tree first to get correct parent-child order, then flatten
      const chapters = (data || []).map(transformChapter);
      const tree = buildChapterTree(chapters);
      return flattenChapterTree(tree);
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
