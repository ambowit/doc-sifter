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
  id?: string;
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

// Build chapter tree from flat list.
// Priority: parent_id relationship first, then order_index, then insertion order (createdAt).
// Chapters with empty/null number are treated as unnumbered and kept in their original order.
function buildChapterTree(chapters: Chapter[]): Chapter[] {
  // Use parent_id if available (proper relational tree)
  const hasParentIds = chapters.some(c => c.parentId !== null);

  if (hasParentIds) {
    const map = new Map<string, Chapter & { children: Chapter[] }>();
    chapters.forEach(c => map.set(c.id, { ...c, children: [] }));
    const roots: (Chapter & { children: Chapter[] })[] = [];
    chapters.forEach(c => {
      const node = map.get(c.id)!;
      if (c.parentId && map.has(c.parentId)) {
        map.get(c.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    });
    // Sort children by orderIndex then createdAt
    const sortChildren = (nodes: (Chapter & { children: Chapter[] })[]) => {
      nodes.sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0) || a.createdAt.localeCompare(b.createdAt));
      nodes.forEach(n => sortChildren(n.children as (Chapter & { children: Chapter[] })[]));
    };
    sortChildren(roots);
    return roots;
  }

  // No parent_id: group by level, children matched by number prefix, preserve insertion order for unnumbered
  const level1 = chapters.filter(c => c.level === 1);
  const level2 = chapters.filter(c => c.level === 2);
  const level3 = chapters.filter(c => c.level >= 3);

  // Sort level1: numbered chapters sorted numerically, unnumbered keep original array order
  const sortByNumber = (arr: Chapter[]) => {
    return [...arr].sort((a, b) => {
      const ai = getOrderIndex(a.number);
      const bi = getOrderIndex(b.number);
      if (ai !== bi) return ai - bi;
      return a.createdAt.localeCompare(b.createdAt);
    });
  };

  const sortedLevel1 = sortByNumber(level1);

  return sortedLevel1.map(parent => {
    const parentNum = (parent.number || "").trim();
    const children = sortByNumber(
      level2.filter(child => {
        const childNum = (child.number || "").trim();
        if (!childNum || !parentNum) return false;
        // e.g. parent "1", child "1.1" or "1.2"
        return childNum.startsWith(parentNum + ".");
      })
    ).map(child => {
      const childNum = (child.number || "").trim();
      const grandChildren = sortByNumber(
        level3.filter(gc => {
          const gcNum = (gc.number || "").trim();
          return gcNum.startsWith(childNum + ".");
        })
      ).map(gc => ({ ...gc, children: [] }));
      return { ...child, children: grandChildren };
    });
    return { ...parent, children };
  });
}

// Returns a numeric sort key for a chapter number string.
// Unnumbered ("" or null) get a large but finite key so they can be interleaved
// based on their database insertion order (handled at call site via createdAt).
function getOrderIndex(num: string | null | undefined): number {
  const s = (num || "").trim();
  if (!s) return 9000; // unnumbered: after numbered but keep relative order via createdAt

  // Chinese ordinals: 一=1 … 十二=12, 十=10, 十一=11 …
  const zhMap: Record<string, number> = {
    '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
    '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
    '十一': 11, '十二': 12, '十三': 13, '十四': 14, '十五': 15,
  };
  if (zhMap[s] !== undefined) return zhMap[s];

  // "第X章"
  const zhChap = s.match(/第([一二三四五六七八九十]+(?:[一二三四五六七八九])?)/);
  if (zhChap && zhMap[zhChap[1]] !== undefined) return zhMap[zhChap[1]];

  // "附件X" → 8000+
  if (s.startsWith('附件')) return 8000;

  // Arabic numeric prefix "1", "1.2", "1.2.3"
  const parts = s.split('.');
  const first = parseInt(parts[0], 10);
  if (!isNaN(first)) return first + (parts.length > 1 ? parseInt(parts[1], 10) / 100 : 0);

  return 9000;
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
        .order("order_index", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true });

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
        .order("order_index", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true });

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
        ...(ch.id ? { id: ch.id } : {}),
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
