import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useBulkCreateChapters, type CreateChapterData } from "@/hooks/useChapters";
import { useUpdateFileStatus, type FileStatus } from "@/hooks/useFiles";

export interface ChapterStructure {
  number: string;
  title: string;
  level: number;
  description: string;
  children?: ChapterStructure[];
}

export interface DocumentSummary {
  title: string;
  type: string;
  keyPoints: string[];
  relevantChapters: string[];
  confidence: number;
}

export interface TemplateParseResult {
  chapters: ChapterStructure[];
}

export interface DocumentParseResult {
  summary: DocumentSummary;
}

// Flatten chapter structure to array with parent references
function flattenChapters(
  chapters: ChapterStructure[],
  projectId: string,
  parentId: string | null = null,
  parentNumber: string = ""
): CreateChapterData[] {
  const result: CreateChapterData[] = [];

  chapters.forEach((chapter, index) => {
    const orderIndex = index;

    result.push({
      projectId,
      parentId,
      title: chapter.title,
      number: chapter.number || null,
      level: chapter.level,
      orderIndex,
      description: chapter.description || "",
    });

    if (chapter.children && chapter.children.length > 0) {
      const childChapters = flattenChapters(
        chapter.children,
        projectId,
        null,
        chapter.number
      );
      result.push(...childChapters);
    }
  });

  return result;
}

// Parse template content to extract chapter structure (fallback parser)
function parseTemplateContent(content: string): ChapterStructure[] {
  const chapters: ChapterStructure[] = [];
  const lines = content.split("\n");

  let currentChapter: ChapterStructure | null = null;
  let chapterIndex = 0;
  let subChapterIndex = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detect chapter headers
    // Pattern: ## 第X章 or # 章节 or 1. or 一、
    const level1Match = trimmed.match(/^(?:##?\s*)?(?:第[一二三四五六七八九十\d]+章|[一二三四五六七八九十]+[、.])\s*(.+)/);
    const level2Match = trimmed.match(/^(?:###\s*)?(?:\d+\.\d+|[（(][一二三四五六七八九十\d]+[)）])\s*(.+)/);

    if (level1Match) {
      chapterIndex++;
      subChapterIndex = 0;
      currentChapter = {
        number: String(chapterIndex), // Use simple numbering
        title: level1Match[1] || trimmed,
        level: 1,
        description: "",
        children: [],
      };
      chapters.push(currentChapter);
    } else if (level2Match && currentChapter) {
      subChapterIndex++;
      currentChapter.children = currentChapter.children || [];
      currentChapter.children.push({
        number: `${chapterIndex}.${subChapterIndex}`,
        title: level2Match[1] || trimmed,
        level: 2,
        description: "",
      });
    } else if (currentChapter && currentChapter.children && currentChapter.children.length > 0) {
      // Add as description to last sub-chapter
      const lastChild = currentChapter.children[currentChapter.children.length - 1];
      if (!lastChild.description) {
        lastChild.description = trimmed;
      }
    } else if (currentChapter && !currentChapter.description) {
      currentChapter.description = trimmed;
    }
  }

  return chapters;
}

// Hook to parse template and extract chapter structure
// Convert file to base64
export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove the data URL prefix (e.g., "data:application/pdf;base64,")
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function useParseTemplate() {
  const { user } = useAuth();
  const bulkCreateChapters = useBulkCreateChapters();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      projectId,
      content,
      filename,
      fileData,
      mimeType,
    }: {
      projectId: string;
      content: string;
      filename?: string;
      fileData?: string;
      mimeType?: string;
    }) => {
      if (!user) throw new Error("User not authenticated");

      console.log("[ParseTemplate] Starting AI parsing", {
        filename,
        contentLength: content?.length,
        projectId,
        hasFileData: !!fileData,
        fileDataLength: fileData?.length,
        mimeType,
      });

      // Use fetch with timeout for better control
      const TIMEOUT_MS = 90000; // 90 seconds
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        console.log("[ParseTemplate] Request timeout, aborting...");
        controller.abort();
      }, TIMEOUT_MS);

      try {
        const requestBody: Record<string, unknown> = {
          type: "template",
          content,
          filename,
        };

        // Include file data if provided (for server-side parsing)
        if (fileData) {
          requestBody.fileData = fileData;
          requestBody.mimeType = mimeType;
          console.log("[ParseTemplate] Including file data for server-side parsing", {
            fileDataLength: fileData.length,
            mimeType,
          });
        }

        // Determine API endpoint based on environment
        // In production (Vercel), use /api/parse
        // In development, use Supabase Edge Function
        const isProduction = import.meta.env.PROD;
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        
        let apiUrl: string;
        let headers: Record<string, string>;
        
        if (isProduction) {
          // Production: use Vercel API route
          apiUrl = "/api/parse";
          headers = { "Content-Type": "application/json" };
          console.log("[ParseTemplate] Using Vercel API route (production)");
        } else {
          // Development: use Supabase Edge Function
          apiUrl = `${supabaseUrl}/functions/v1/parse`;
          headers = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${anonKey}`,
            "apikey": anonKey,
          };
          console.log("[ParseTemplate] Using Supabase Edge Function (development)");
        }

        const response = await fetch(apiUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        console.log("[ParseTemplate] Response status:", response.status);

        if (!response.ok) {
          const errorText = await response.text();
          console.error("[ParseTemplate] Response error:", errorText);
          throw new Error(`AI解析失败: ${response.status} ${errorText}`);
        }

        const data = await response.json();
        console.log("[ParseTemplate] Response data received");

        // Check if data contains an error from the API
        if (data && typeof data === "object" && "error" in data) {
          console.error("[ParseTemplate] API returned error:", data.error);
          throw new Error(`AI解析失败: ${data.error}`);
        }

        const result = data as TemplateParseResult;
        console.log("[ParseTemplate] AI result:", {
          chaptersCount: result.chapters?.length
        });

        if (!result.chapters || result.chapters.length === 0) {
          throw new Error("AI未能生成报告结构");
        }

        // Flatten and create chapters in database
        console.log("[ParseTemplate] Creating chapters in database...");
        const chaptersToCreate = flattenChapters(result.chapters, projectId);
        await bulkCreateChapters.mutateAsync({ projectId, chapters: chaptersToCreate });
        console.log("[ParseTemplate] Chapters created successfully");

        return result;
      } catch (fetchError) {
        clearTimeout(timeoutId);
        console.error("[ParseTemplate] Fetch error:", fetchError);

        if (fetchError instanceof Error) {
          if (fetchError.name === "AbortError") {
            throw new Error("AI解析超时（90秒），请重试");
          }
          throw fetchError;
        }
        throw new Error("AI解析失败: 未知错误");
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["chapters", variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ["flatChapters", variables.projectId] });
    },
  });
}

// Hook to parse document and extract summary
export function useParseDocument() {
  const { user } = useAuth();
  const updateFileStatus = useUpdateFileStatus();

  return useMutation({
    mutationFn: async ({
      fileId,
      content,
      filename
    }: {
      fileId: string;
      content: string;
      filename?: string;
    }) => {
      if (!user) throw new Error("User not authenticated");

      // Update file status to parsing
      await updateFileStatus.mutateAsync({
        fileId,
        status: "解析中" as FileStatus,
      });

      try {
        // Call the parse Edge Function
        const { data, error } = await supabase.functions.invoke("parse", {
          body: {
            type: "document",
            content,
            filename,
          },
        });

        if (error) {
          throw new Error(`Document parsing failed: ${error.message}`);
        }

        const result = data as DocumentParseResult;

        // Update file with parsed content
        await updateFileStatus.mutateAsync({
          fileId,
          status: "已解析" as FileStatus,
          excerpt: result.summary.keyPoints.join("\n"),
          confidence: result.summary.confidence,
          parsedContent: result.summary as unknown as Record<string, unknown>,
        });

        return result;
      } catch (error) {
        // Update file status to failed
        await updateFileStatus.mutateAsync({
          fileId,
          status: "解析失败" as FileStatus,
        });
        throw error;
      }
    },
  });
}

// Hook to parse multiple documents in batch
export function useBatchParseDocuments() {
  const parseDocument = useParseDocument();

  return useMutation({
    mutationFn: async (documents: Array<{ fileId: string; content: string; filename?: string }>) => {
      const results: Array<{ fileId: string; result?: DocumentParseResult; error?: string }> = [];

      // Process documents sequentially to avoid rate limits
      for (const doc of documents) {
        try {
          const result = await parseDocument.mutateAsync(doc);
          results.push({ fileId: doc.fileId, result });
        } catch (error) {
          results.push({
            fileId: doc.fileId,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }

        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      return results;
    },
  });
}

// Utility to extract text content from file (for PDF, Word, etc.)
// This is a simplified version - in production, you'd use proper parsers
export async function extractTextFromFile(file: File): Promise<string> {
  // For text files, read directly
  if (file.type === "text/plain") {
    return await file.text();
  }

  // For PDF and Word files, we'll use a simplified approach
  // In production, you'd use PDF.js or mammoth.js for proper parsing

  // Try to read as text (works for some file types)
  try {
    const text = await file.text();
    // Check if it looks like valid text content
    if (text && text.length > 0 && !text.includes("\u0000")) {
      // Filter out binary content
      const cleanText = text.replace(/[^\x20-\x7E\u4E00-\u9FFF\u3000-\u303F\uFF00-\uFFEF\n\r\t]/g, " ");
      if (cleanText.trim().length > 100) {
        return cleanText;
      }
    }
  } catch {
    // Ignore errors
  }

  // Return a placeholder for files we can't parse client-side
  return `[文件: ${file.name}]\n\n无法在浏览器中直接解析此文件格式。请上传文本文件或 PDF 文件以进行 AI 解析。`;
}

// Demo chapter structure for fallback
const DEMO_CHAPTERS: ChapterStructure[] = [
  {
    number: "1",
    title: "公司基本情况",
    level: 1,
    description: "对目标公司的设立情况、历次股权变更、注册资本变化等进行核查",
    children: [
      { number: "1.1", title: "公司设立及历史沿革", level: 2, description: "历次股权变更、注册资本变化" },
      { number: "1.2", title: "股权结构", level: 2, description: "现有股权结构、股东情况及实际控制人" },
      { number: "1.3", title: "组织架构", level: 2, description: "组织架构、分支机构及关联企业" },
    ],
  },
  {
    number: "2",
    title: "公司治理",
    level: 1,
    description: "核查公司治理结构的合法性和有效性",
    children: [
      { number: "2.1", title: "公司章程", level: 2, description: "公司章程的合法性、有效性及主要条款" },
      { number: "2.2", title: "股东会/董事会决议", level: 2, description: "历次股东会、董事会决议的合法性" },
      { number: "2.3", title: "高级管理人员", level: 2, description: "高管人员的任职资格、竞业限制等" },
    ],
  },
  {
    number: "3",
    title: "重大资产",
    level: 1,
    description: "核查目标公司的重大资产状况",
    children: [
      { number: "3.1", title: "房产及土地", level: 2, description: "不动产权属、租赁情况" },
      { number: "3.2", title: "知识产权", level: 2, description: "专利、商标、著作权等知识产权状况" },
      { number: "3.3", title: "其他重大资产", level: 2, description: "车辆、设备等其他重大资产" },
    ],
  },
  {
    number: "4",
    title: "重大合同",
    level: 1,
    description: "核查重大合同的合法性和风险",
    children: [
      { number: "4.1", title: "股权投资/收购协议", level: 2, description: "重大投资或收购协议" },
      { number: "4.2", title: "借款及担保合同", level: 2, description: "借款、担保合同及风险" },
      { number: "4.3", title: "重大业务合同", level: 2, description: "与主营业务相关的重大合同" },
    ],
  },
  {
    number: "5",
    title: "劳动人事",
    level: 1,
    description: "核查劳动人事合规情况",
    children: [
      { number: "5.1", title: "劳动合同", level: 2, description: "劳动合同签订及执行情况" },
      { number: "5.2", title: "社会保险及公积金", level: 2, description: "社保及公积金缴纳情况" },
      { number: "5.3", title: "劳动争议", level: 2, description: "现有及潜在劳动争议" },
    ],
  },
  {
    number: "6",
    title: "税务合规",
    level: 1,
    description: "核查税务合规情况",
    children: [
      { number: "6.1", title: "税务登记", level: 2, description: "税务登记及纳税主体资格" },
      { number: "6.2", title: "各项税种", level: 2, description: "各项税种的申报及缴纳情况" },
      { number: "6.3", title: "税收优惠", level: 2, description: "享受的税收优惠政策" },
    ],
  },
  {
    number: "第二章",
    title: "公司治理",
    level: 1,
    description: "核查公司治理结构的合法性和有效性",
    children: [
      { number: "2.1", title: "公司章程", level: 2, description: "公司章程的合法性、有效性及主要条款" },
      { number: "2.2", title: "股东会/董事会决议", level: 2, description: "历次股东会、董事会决议的合法性" },
      { number: "2.3", title: "高级管理人员", level: 2, description: "高管人员的任职资格、竞业限制等" },
    ],
  },
  {
    number: "第三章",
    title: "重大资产",
    level: 1,
    description: "核查目标公���的重大资产状况",
    children: [
      { number: "3.1", title: "房产及土地", level: 2, description: "不动产权属、租赁情况" },
      { number: "3.2", title: "知识产权", level: 2, description: "专利、商标、���作权等知识产权状况" },
      { number: "3.3", title: "其他重大资产", level: 2, description: "车辆、设备等其他重大资产" },
    ],
  },
  {
    number: "第四章",
    title: "重大合同",
    level: 1,
    description: "核查重大合同的合法性和风险",
    children: [
      { number: "4.1", title: "股权投资/收购协议", level: 2, description: "重大投资或收购协议" },
      { number: "4.2", title: "借款及担保合同", level: 2, description: "借款、担保合同及风险" },
      { number: "4.3", title: "重大业务合同", level: 2, description: "与主营业务相关的重大合同" },
    ],
  },
  {
    number: "第五章",
    title: "劳动人事",
    level: 1,
    description: "核查劳动人事合规情况",
    children: [
      { number: "5.1", title: "劳动合同", level: 2, description: "劳动合同签订及执行情况" },
      { number: "5.2", title: "社会保险及公积金", level: 2, description: "社保及公积金缴纳情况" },
      { number: "5.3", title: "劳动争议", level: 2, description: "现有及潜在劳动争议" },
    ],
  },
  {
    number: "7",
    title: "诉讼、仲裁及行政处罚",
    level: 1,
    description: "核查诉讼、仲裁及行政处罚情况",
    children: [
      { number: "7.1", title: "诉讼及仲裁", level: 2, description: "现有及潜在诉讼、仲裁案件" },
      { number: "7.2", title: "行政处罚", level: 2, description: "行政处罚情况" },
    ],
  },
  {
    number: "8",
    title: "合规经营",
    level: 1,
    description: "核查合规经营情况",
    children: [
      { number: "8.1", title: "行业资质", level: 2, description: "经营所需的各类资质许可" },
      { number: "8.2", title: "环境保护", level: 2, description: "环保合规情况" },
      { number: "8.3", title: "其他合规事项", level: 2, description: "其他法律法规合规情况" },
    ],
  },
];

// Interface for AI mapping
export interface MappingSuggestion {
  fileId: string;
  fileName: string;
  chapterId: string;
  chapterTitle: string;
  confidence: number;
  reason: string;
  excerpt: string;
}

export interface AIMappingResult {
  success: boolean;
  mappings: MappingSuggestion[];
  processedFiles: number;
  processedChapters: number;
  error?: string;
}

// Hook to run AI mapping analysis
export function useAIMapping() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      projectId,
      files,
      chapters,
    }: {
      projectId: string;
      files: Array<{
        id: string;
        name: string;
        fileType: string;
        storagePath: string;
        content?: string;
      }>;
      chapters: Array<{
        id: string;
        title: string;
        level: number;
        description: string;
        number?: string;
      }>;
    }) => {
      console.log("[AI Mapping] Starting mapping analysis", {
        fileCount: files.length,
        chapterCount: chapters.length
      });

      const { data, error } = await supabase.functions.invoke("ai-mapping", {
        body: { projectId, files, chapters },
      });

      if (error) {
        console.error("[AI Mapping] Error:", error);
        throw new Error(`AI映射失败: ${error.message}`);
      }

      console.log("[AI Mapping] Result:", data);
      return data as AIMappingResult;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["mappings", variables.projectId] });
    },
  });
}

// Mock template content for demo
export const DEMO_TEMPLATE_CONTENT = `
# 法律尽职调查报告

## 第一章 公司基本情况
### 1.1 公司设立及历史沿革
对目标公司的设立情况、历次股权变更、注册资本变化等进行核查

### 1.2 股权结构
核查目标公司现有股权结构、股东情况及实际控制人

### 1.3 组织架构
核查目标公司的组织架构、分支机构及关联企业

## 第二章 公司治理
### 2.1 公司章程
核查公司章程的合法性、有效性及主要条款

### 2.2 股东会/董事会决议
核查历次股东会、董事会决议的合法性

### 2.3 高级管理人员
核查高管人员的任职资格、竞业限制等

## 第三章 重大资产
### 3.1 房产及土地
核查不动产权属、租赁情况

### 3.2 知识产权
核查专利、商标、著作权等知识产权状况

### 3.3 其他重大资产
核查车辆、设备等其他重大资产

## 第四章 重大合同
### 4.1 股权投资/收购协议
核查重大投资或收购协议

### 4.2 借款及担保合同
核查借款、担保合同及风险

### 4.3 重大业务合同
核查与主营业务相关的重大合同

## 第五章 劳动人事
### 5.1 劳动合同
核查劳动合同签订及执行情况

### 5.2 社会保险及公积金
核查社保及公积金缴纳情况

### 5.3 劳动争议
核查现有及潜在劳动争议

## 第六章 税务合规
### 6.1 税务登记
核查税务登记及纳税主体资格

### 6.2 各项税种
核查各项税种的申报及缴纳情况

### 6.3 税收优惠
核查享受的税收优惠政策

## 第七章 诉讼、仲裁及行政处罚
### 7.1 诉讼及仲裁
核查现有及潜在诉讼、仲裁案件

### 7.2 行政处罚
核查行政处罚情况

## 第八章 合规经营
### 8.1 行业资质
核查经营所需的各类资质许可

### 8.2 环境保护
核查环保合规情况

### 8.3 其他合规事项
核查其他法律法规合规情况
`;
