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
// Preserves the original array order from the database at all times — never re-sorts.
// Uses parent_id links when available, otherwise falls back to level+number-prefix matching.
function buildChapterTree(chapters: Chapter[]): Chapter[] {
  // Tag each chapter with its original array position for stable ordering
  const indexed = chapters.map((c, i) => ({ ...c, _pos: i }));

  const map = new Map<string, (typeof indexed)[0] & { children: (typeof indexed)[0][] }>();
  indexed.forEach(c => map.set(c.id, { ...c, children: [] }));

  const hasParentIds = indexed.some(c => c.parentId !== null);

  if (hasParentIds) {
    // Proper relational tree — use parent_id links
    const roots: (typeof indexed[0] & { children: typeof indexed })[] = [];
    indexed.forEach(c => {
      const node = map.get(c.id)!;
      if (c.parentId && map.has(c.parentId)) {
        map.get(c.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    });
    // Sort by orderIndex (globally unique, set during flattenChapters)
    const sortByOrder = (nodes: typeof roots) => {
      nodes.sort((a, b) => a.orderIndex - b.orderIndex);
      nodes.forEach(n => sortByOrder(n.children as typeof roots));
    };
    sortByOrder(roots);
    return roots as unknown as Chapter[];
  }

  // No parent_id: match children by number prefix, preserve original array order throughout
  const level1 = indexed.filter(c => c.level === 1);
  const level2 = indexed.filter(c => c.level === 2);
  const level3 = indexed.filter(c => c.level >= 3);

  return level1.map(parent => {
    const parentNum = (parent.number || "").trim();
    // Only match numeric-prefixed children; unnumbered chapters have no sub-children
    const children = level2
      .filter(child => {
        const childNum = (child.number || "").trim();
        return childNum && parentNum && childNum.startsWith(parentNum + ".");
      })
      // already in original array order — no sort needed
      .map(child => {
        const childNum = (child.number || "").trim();
        const grandChildren = level3
          .filter(gc => {
            const gcNum = (gc.number || "").trim();
            return gcNum && gcNum.startsWith(childNum + ".");
          })
          .map(gc => ({ ...gc, children: [] }));
        return { ...child, children: grandChildren };
      });
    return { ...parent, children };
  }) as unknown as Chapter[];
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
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });

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
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });

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
