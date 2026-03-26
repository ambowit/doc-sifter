import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// 文件章节类型
export interface FileSection {
  id: string;
  file_id: string;
  project_id: string;
  title: string;
  level: number;
  order_index: number;
  content: string | null;
  start_position: number | null;
  end_position: number | null;
  matched_chapter_id: string | null;
  match_confidence: number | null;
  match_method: string | null;
  created_at: string;
  updated_at: string;
}

// 带章节信息的文件章节
export interface FileSectionWithChapter extends FileSection {
  chapter?: {
    id: string;
    number: string | null;
    title: string;
    level: number;
  } | null;
  file?: {
    id: string;
    name: string;
  } | null;
}

// 查询文件章节
export function useFileSections(projectId: string | undefined) {
  return useQuery({
    queryKey: ["file-sections", projectId],
    queryFn: async () => {
      if (!projectId) return [];
      
      const { data, error } = await (supabase
        .from("file_sections") as any)
        .select(`
          *,
          chapter:matched_chapter_id (
            id,
            number,
            title,
            level
          ),
          file:file_id (
            id,
            name
          )
        `)
        .eq("project_id", projectId)
        .order("file_id")
        .order("order_index", { ascending: true });

      if (error) {
        console.error("[useFileSections] Query error:", error);
        throw error;
      }

      return (data || []) as FileSectionWithChapter[];
    },
    enabled: !!projectId,
  });
}

// 查询匹配到指定章节的所有内容
export function useChapterSections(chapterId: string | undefined, projectId: string | undefined) {
  return useQuery({
    queryKey: ["chapter-sections", chapterId, projectId],
    queryFn: async () => {
      if (!chapterId || !projectId) return [];
      
      const { data, error } = await (supabase
        .from("file_sections") as any)
        .select(`
          *,
          file:file_id (
            id,
            name
          )
        `)
        .eq("matched_chapter_id", chapterId)
        .eq("project_id", projectId)
        .order("order_index", { ascending: true });

      if (error) {
        console.error("[useChapterSections] Query error:", error);
        throw error;
      }

      return (data || []) as FileSectionWithChapter[];
    },
    enabled: !!chapterId && !!projectId,
  });
}

// 查询单个文件的章节
export function useFileSectionsByFile(fileId: string | undefined) {
  return useQuery({
    queryKey: ["file-sections-by-file", fileId],
    queryFn: async () => {
      if (!fileId) return [];
      
      const { data, error } = await (supabase
        .from("file_sections") as any)
        .select(`
          *,
          chapter:matched_chapter_id (
            id,
            number,
            title,
            level
          )
        `)
        .eq("file_id", fileId)
        .order("order_index", { ascending: true });

      if (error) {
        console.error("[useFileSectionsByFile] Query error:", error);
        throw error;
      }

      return (data || []) as FileSectionWithChapter[];
    },
    enabled: !!fileId,
  });
}

// 解析文档结构
export function useParseDocumentStructure() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      fileId,
      projectId,
      extractedText,
      fileName,
    }: {
      fileId: string;
      projectId: string;
      extractedText: string;
      fileName: string;
    }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error("未登录");
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-document-structure`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            fileId,
            projectId,
            extractedText,
            fileName,
          }),
        }
      );

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || "解析文档结构失败");
      }

      return result;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["file-sections", variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ["file-sections-by-file", variables.fileId] });
    },
    onError: (error) => {
      console.error("[useParseDocumentStructure] Error:", error);
      toast.error("解析文档结构失败", {
        description: error instanceof Error ? error.message : "请稍后重试",
      });
    },
  });
}

// 匹配章节到模板
export function useMatchSectionsToChapters() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      projectId,
      fileId,
    }: {
      projectId: string;
      fileId?: string;
    }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error("未登录");
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/match-sections-to-chapters`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            projectId,
            fileId,
          }),
        }
      );

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || "匹配章节失败");
      }

      return result;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["file-sections", variables.projectId] });
      if (variables.fileId) {
        queryClient.invalidateQueries({ queryKey: ["file-sections-by-file", variables.fileId] });
      }
    },
    onError: (error) => {
      console.error("[useMatchSectionsToChapters] Error:", error);
      toast.error("匹配章节失败", {
        description: error instanceof Error ? error.message : "请稍后重试",
      });
    },
  });
}

// 更新章节匹配（手动）
export function useUpdateSectionMatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sectionId,
      chapterId,
      projectId,
    }: {
      sectionId: string;
      chapterId: string | null;
      projectId: string;
    }) => {
      const { error } = await (supabase
        .from("file_sections") as any)
        .update({
          matched_chapter_id: chapterId,
          match_confidence: chapterId ? 100 : null,
          match_method: chapterId ? "manual" : null,
        })
        .eq("id", sectionId);

      if (error) {
        throw error;
      }

      return { sectionId, chapterId };
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["file-sections", variables.projectId] });
    },
    onError: (error) => {
      console.error("[useUpdateSectionMatch] Error:", error);
      toast.error("更新匹配失败");
    },
  });
}

// 删除文件的所有章节
export function useDeleteFileSections() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      fileId,
      projectId,
    }: {
      fileId: string;
      projectId: string;
    }) => {
      const { error } = await (supabase
        .from("file_sections") as any)
        .delete()
        .eq("file_id", fileId);

      if (error) {
        throw error;
      }

      return { fileId };
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["file-sections", variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ["file-sections-by-file", variables.fileId] });
    },
    onError: (error) => {
      console.error("[useDeleteFileSections] Error:", error);
      toast.error("删除章节失败");
    },
  });
}

// 批量解��文档结构（带进度）
export interface ParseProgress {
  isRunning: boolean;
  isPaused: boolean;
  total: number;
  completed: number;
  failed: number;
  current: string | null;
  results: Array<{
    fileId: string;
    fileName: string;
    success: boolean;
    sectionsCount?: number;
    error?: string;
  }>;
}

export function useBatchParseDocumentStructure() {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<ParseProgress>({
    isRunning: false,
    isPaused: false,
    total: 0,
    completed: 0,
    failed: 0,
    current: null,
    results: [],
  });

  const pauseRef = useRef(false);
  const cancelRef = useRef(false);

  const start = useCallback(async (
    files: Array<{
      fileId: string;
      projectId: string;
      extractedText: string;
      fileName: string;
    }>
  ) => {
    if (files.length === 0) return;

    pauseRef.current = false;
    cancelRef.current = false;

    setProgress({
      isRunning: true,
      isPaused: false,
      total: files.length,
      completed: 0,
      failed: 0,
      current: files[0].fileName,
      results: [],
    });

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      toast.error("未登录");
      setProgress(prev => ({ ...prev, isRunning: false }));
      return;
    }

    const results: ParseProgress["results"] = [];

    for (let i = 0; i < files.length; i++) {
      if (cancelRef.current) {
        break;
      }

      while (pauseRef.current) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (cancelRef.current) break;
      }

      if (cancelRef.current) break;

      const file = files[i];
      setProgress(prev => ({
        ...prev,
        current: file.fileName,
      }));

      try {
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-document-structure`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              fileId: file.fileId,
              projectId: file.projectId,
              extractedText: file.extractedText,
              fileName: file.fileName,
            }),
          }
        );

        const result = await response.json();

        if (result.success) {
          results.push({
            fileId: file.fileId,
            fileName: file.fileName,
            success: true,
            sectionsCount: result.sectionsCount,
          });
          setProgress(prev => ({
            ...prev,
            completed: prev.completed + 1,
            results: [...results],
          }));
        } else {
          results.push({
            fileId: file.fileId,
            fileName: file.fileName,
            success: false,
            error: result.error,
          });
          setProgress(prev => ({
            ...prev,
            failed: prev.failed + 1,
            results: [...results],
          }));
        }
      } catch (error) {
        results.push({
          fileId: file.fileId,
          fileName: file.fileName,
          success: false,
          error: error instanceof Error ? error.message : "未知错误",
        });
        setProgress(prev => ({
          ...prev,
          failed: prev.failed + 1,
          results: [...results],
        }));
      }
    }

    setProgress(prev => ({
      ...prev,
      isRunning: false,
      current: null,
    }));

    // 刷新数据
    if (files.length > 0) {
      queryClient.invalidateQueries({ queryKey: ["file-sections", files[0].projectId] });
    }
  }, [queryClient]);

  const pause = useCallback(() => {
    pauseRef.current = true;
    setProgress(prev => ({ ...prev, isPaused: true }));
  }, []);

  const resume = useCallback(() => {
    pauseRef.current = false;
    setProgress(prev => ({ ...prev, isPaused: false }));
  }, []);

  const cancel = useCallback(() => {
    cancelRef.current = true;
    pauseRef.current = false;
    setProgress(prev => ({ ...prev, isRunning: false, isPaused: false, current: null }));
  }, []);

  const reset = useCallback(() => {
    setProgress({
      isRunning: false,
      isPaused: false,
      total: 0,
      completed: 0,
      failed: 0,
      current: null,
      results: [],
    });
  }, []);

  return {
    progress,
    start,
    pause,
    resume,
    cancel,
    reset,
  };
}
