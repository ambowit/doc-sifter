import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { type Chapter } from "@/hooks/useChapters";
import { type UploadedFile, type FileType } from "@/hooks/useFiles";

export interface ChapterFileMapping {
  id: string;
  chapterId: string;
  fileId: string;
  confidence: number;
  isAiSuggested: boolean;
  isConfirmed: boolean;
  createdAt: string;
}

export interface CreateMappingData {
  chapterId: string;
  fileId: string;
  confidence?: number;
  isAiSuggested?: boolean;
  isConfirmed?: boolean;
}

// Transform database row to ChapterFileMapping interface
const transformMapping = (row: Record<string, unknown>): ChapterFileMapping => ({
  id: row.id as string,
  chapterId: row.chapter_id as string,
  fileId: row.file_id as string,
  confidence: row.confidence as number,
  isAiSuggested: row.is_ai_suggested as boolean,
  isConfirmed: row.is_confirmed as boolean,
  createdAt: row.created_at as string,
});

// Hook to fetch all mappings for a project
export function useMappings(projectId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["mappings", projectId],
    queryFn: async () => {
      if (!user) throw new Error("User not authenticated");
      if (!projectId) throw new Error("Project ID is required");

      // Get all chapter IDs for this project
      const { data: chapters, error: chaptersError } = await supabase
        .from("chapters")
        .select("id")
        .eq("project_id", projectId);

      if (chaptersError) throw chaptersError;
      
      if (!chapters || chapters.length === 0) {
        return [];
      }

      const chapterIds = chapters.map(c => c.id);

      // Get mappings for these chapters
      const { data, error } = await supabase
        .from("chapter_file_mappings")
        .select("*")
        .in("chapter_id", chapterIds);

      if (error) throw error;
      return (data || []).map(transformMapping);
    },
    enabled: !!user && !!projectId,
  });
}

// Hook to get mappings for a specific chapter
export function useChapterMappings(chapterId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["chapterMappings", chapterId],
    queryFn: async () => {
      if (!user) throw new Error("User not authenticated");
      if (!chapterId) throw new Error("Chapter ID is required");

      const { data, error } = await supabase
        .from("chapter_file_mappings")
        .select("*")
        .eq("chapter_id", chapterId);

      if (error) throw error;
      return (data || []).map(transformMapping);
    },
    enabled: !!user && !!chapterId,
  });
}

// Hook to create a mapping
export function useCreateMapping() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (data: CreateMappingData) => {
      if (!user) throw new Error("User not authenticated");

      const { data: mapping, error } = await supabase
        .from("chapter_file_mappings")
        .insert({
          chapter_id: data.chapterId,
          file_id: data.fileId,
          confidence: data.confidence || 0,
          is_ai_suggested: data.isAiSuggested || false,
          is_confirmed: data.isConfirmed || false,
        })
        .select()
        .single();

      if (error) throw error;
      return transformMapping(mapping);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mappings"] });
      queryClient.invalidateQueries({ queryKey: ["chapterMappings"] });
    },
  });
}

// Hook to update mapping confirmation status
export function useConfirmMapping() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ mappingId, isConfirmed }: { mappingId: string; isConfirmed: boolean }) => {
      const { data, error } = await supabase
        .from("chapter_file_mappings")
        .update({ is_confirmed: isConfirmed })
        .eq("id", mappingId)
        .select()
        .single();

      if (error) throw error;
      return transformMapping(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mappings"] });
      queryClient.invalidateQueries({ queryKey: ["chapterMappings"] });
    },
  });
}

// Hook to delete a mapping
export function useDeleteMapping() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (mappingId: string) => {
      const { error } = await supabase
        .from("chapter_file_mappings")
        .delete()
        .eq("id", mappingId);

      if (error) throw error;
      return mappingId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mappings"] });
      queryClient.invalidateQueries({ queryKey: ["chapterMappings"] });
    },
  });
}

// Hook to bulk create mappings
export function useBulkCreateMappings() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (mappings: CreateMappingData[]) => {
      if (!user) throw new Error("User not authenticated");

      const mappingsToInsert = mappings.map(m => ({
        chapter_id: m.chapterId,
        file_id: m.fileId,
        confidence: m.confidence || 0,
        is_ai_suggested: m.isAiSuggested || false,
        is_confirmed: m.isConfirmed || false,
      }));

      const { data, error } = await supabase
        .from("chapter_file_mappings")
        .insert(mappingsToInsert)
        .select();

      if (error) throw error;
      return (data || []).map(transformMapping);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mappings"] });
      queryClient.invalidateQueries({ queryKey: ["chapterMappings"] });
    },
  });
}

// Keyword matching for chapters based on file type and name
const CHAPTER_KEYWORDS: Record<string, string[]> = {
  "公司基本情况": ["公司", "设立", "沿革", "股权", "股东", "组织", "架构", "工商", "营业执照", "基本"],
  "公司治理": ["章程", "决议", "股东会", "董事会", "监事会", "高管", "治理"],
  "重大资产": ["房产", "土地", "不动产", "专利", "商标", "著作权", "知识产权", "资产", "设备"],
  "重大合同": ["合同", "协议", "收购", "投资", "借款", "担保", "抵押", "质押"],
  "劳动人事": ["劳动", "员工", "人事", "社保", "公积金", "薪酬", "福利"],
  "税务合规": ["税务", "税收", "纳税", "发票", "税种", "税率"],
  "诉讼仲裁": ["诉讼", "仲裁", "判决", "裁定", "案件", "处罚"],
  "合规经营": ["资质", "许可", "环保", "安全", "合规"],
};

const FILE_TYPE_CHAPTER_AFFINITY: Record<FileType, string[]> = {
  "合同": ["重大合同"],
  "公司治理": ["公司治理", "公司基本情况"],
  "财务": ["税务合规", "重大资产"],
  "知识产权": ["重大资产"],
  "人事": ["劳动人事"],
  "诉讼": ["诉讼仲裁"],
  "其他": [],
};

// Smart matching algorithm
export function generateSmartMappingSuggestions(
  files: UploadedFile[],
  chapters: Array<Chapter & { number: string }>
): Array<{
  fileId: string;
  chapterId: string;
  confidence: number;
  reason: string;
}> {
  const suggestions: Array<{
    fileId: string;
    chapterId: string;
    confidence: number;
    reason: string;
  }> = [];

  for (const file of files) {
    const fileName = file.name.toLowerCase();
    const fileType = file.fileType;
    
    // Find best matching chapter
    let bestMatch: { chapter: typeof chapters[0]; score: number; reason: string } | null = null;
    
    for (const chapter of chapters) {
      let score = 0;
      let reason = "";
      
      const chapterTitle = chapter.title.toLowerCase();
      
      // Check file type affinity
      const affinityChapters = FILE_TYPE_CHAPTER_AFFINITY[fileType] || [];
      if (affinityChapters.some(ac => chapterTitle.includes(ac.toLowerCase().replace("重大", "").replace("诉讼仲裁", "诉讼")))) {
        score += 30;
        reason = `文件类型"${fileType}"与章节相关`;
      }
      
      // Check keyword matching
      for (const [chapterKey, keywords] of Object.entries(CHAPTER_KEYWORDS)) {
        if (chapterTitle.includes(chapterKey.toLowerCase().slice(0, 4))) {
          for (const keyword of keywords) {
            if (fileName.includes(keyword)) {
              score += 25;
              reason = reason || `文件名包含关键词"${keyword}"`;
              break;
            }
          }
        }
      }
      
      // Direct title matching
      const chapterWords = chapterTitle.split(/[\s,，、]+/).filter(w => w.length > 1);
      for (const word of chapterWords) {
        if (fileName.includes(word)) {
          score += 20;
          reason = reason || `文件名与章节标题匹配`;
          break;
        }
      }
      
      // Check chapter description
      if (chapter.description) {
        const descWords = chapter.description.toLowerCase().split(/[\s,，、]+/).filter(w => w.length > 1);
        for (const word of descWords) {
          if (word.length > 2 && fileName.includes(word)) {
            score += 15;
            reason = reason || `文件名与章节描述匹配`;
            break;
          }
        }
      }
      
      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { chapter, score, reason };
      }
    }
    
    if (bestMatch && bestMatch.score >= 25) {
      suggestions.push({
        fileId: file.id,
        chapterId: bestMatch.chapter.id,
        confidence: Math.min(95, bestMatch.score + 20),
        reason: bestMatch.reason,
      });
    }
  }
  
  return suggestions;
}

// Group files by their mapped chapters
export function groupFilesByChapter(
  files: UploadedFile[],
  mappings: ChapterFileMapping[],
  chapters: Chapter[]
): Map<string, { chapter: Chapter; files: Array<UploadedFile & { mapping: ChapterFileMapping }> }> {
  const result = new Map<string, { chapter: Chapter; files: Array<UploadedFile & { mapping: ChapterFileMapping }> }>();
  
  // Initialize with all chapters
  for (const chapter of chapters) {
    result.set(chapter.id, { chapter, files: [] });
  }
  
  // Add files to their mapped chapters
  for (const mapping of mappings) {
    const file = files.find(f => f.id === mapping.fileId);
    const chapterEntry = result.get(mapping.chapterId);
    
    if (file && chapterEntry) {
      chapterEntry.files.push({ ...file, mapping });
    }
  }
  
  return result;
}

// Calculate mapping statistics
export function calculateMappingStats(
  files: UploadedFile[],
  mappings: ChapterFileMapping[],
  chapters: Chapter[]
): {
  totalFiles: number;
  mappedFiles: number;
  confirmedMappings: number;
  aiSuggestedMappings: number;
  chaptersWithFiles: number;
  chaptersWithoutFiles: number;
  coveragePercentage: number;
} {
  const mappedFileIds = new Set(mappings.map(m => m.fileId));
  const chaptersWithFilesSet = new Set(mappings.map(m => m.chapterId));
  
  return {
    totalFiles: files.length,
    mappedFiles: mappedFileIds.size,
    confirmedMappings: mappings.filter(m => m.isConfirmed).length,
    aiSuggestedMappings: mappings.filter(m => m.isAiSuggested && !m.isConfirmed).length,
    chaptersWithFiles: chaptersWithFilesSet.size,
    chaptersWithoutFiles: chapters.length - chaptersWithFilesSet.size,
    coveragePercentage: chapters.length > 0 ? Math.round((chaptersWithFilesSet.size / chapters.length) * 100) : 0,
  };
}
