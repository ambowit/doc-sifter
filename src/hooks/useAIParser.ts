import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useBulkCreateChapters, type CreateChapterData } from "@/hooks/useChapters";
import { useUpdateFileStatus, type FileStatus } from "@/hooks/useFiles";
import { normalizeSupabaseError } from "@/lib/errorUtils";
import JSZip from "jszip";

// Extract text from DOCX file (ArrayBuffer) using JSZip
async function extractDocxText(arrayBuffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const docXml = zip.file("word/document.xml");
  if (!docXml) return "";
  const xmlContent = await docXml.async("text");
  return xmlContent
    .replace(/<w:p[^>]*>/g, "\n")
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+|\s+$/gm, "")
    .trim();
}

// Extract text from file object (DOCX or PDF) before sending to AI
export async function extractFileText(file: File): Promise<string> {
  const isDocx =
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.name.endsWith(".docx");

  if (isDocx) {
    const buffer = await file.arrayBuffer();
    const text = await extractDocxText(buffer);
    console.log("[extractFileText] DOCX extracted", { length: text.length, preview: text.substring(0, 200) });
    return text;
  }

  // PDF: use basic text extraction (readable characters)
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const raw = decoder.decode(bytes);
  const chinese = raw.match(/[\u4E00-\u9FFF\u3000-\u303F]{2,}/g) || [];
  const ascii = raw.match(/[A-Za-z0-9\u0020-\u007E]{4,}/g) || [];
  const combined = [...chinese, ...ascii].join("\n").substring(0, 20000);
  console.log("[extractFileText] PDF extracted", { length: combined.length, chineseCount: chinese.length });
  return combined;
}

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

// Generate a UUID v4
function uuidv4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function normalizeTemplateChapter(input: unknown, fallbackLevel = 1): ChapterStructure | null {
  if (!input || typeof input !== "object") return null;

  const chapter = input as Record<string, unknown>;
  const title = typeof chapter.title === "string" ? chapter.title : "";
  const number = typeof chapter.number === "string" ? chapter.number : "";

  if (!title && !number) return null;

  const level = typeof chapter.level === "number" ? chapter.level : fallbackLevel;
  const description = typeof chapter.description === "string" ? chapter.description : "";
  const childrenInput = Array.isArray(chapter.children) ? chapter.children : [];
  const children = childrenInput
    .map((child) => normalizeTemplateChapter(child, level + 1))
    .filter((child): child is ChapterStructure => Boolean(child));

  return {
    number,
    title,
    level,
    description,
    children,
  };
}

function normalizeTemplateResult(data: unknown): TemplateParseResult {
  const payload = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const chapterSource = Array.isArray(payload.chapters)
    ? payload.chapters
    : Array.isArray(payload.table_of_contents)
      ? payload.table_of_contents
      : Array.isArray(payload.tableOfContents)
        ? payload.tableOfContents
        : [];

  const chapters = chapterSource
    .map((chapter) => normalizeTemplateChapter(chapter))
    .filter((chapter): chapter is ChapterStructure => Boolean(chapter));

  return { chapters };
}

// Flatten chapter structure to array with correct parent IDs and globally unique orderIndex.
// Pre-assigns UUIDs so children can reference their parent before insertion.
function flattenChapters(
  chapters: ChapterStructure[],
  projectId: string,
  parentId: string | null = null,
  counter = { value: 0 },
): CreateChapterData[] {
  const result: CreateChapterData[] = [];

  chapters.forEach((chapter) => {
    const id = uuidv4();
    const orderIndex = counter.value++;

    result.push({
      id,
      projectId,
      parentId,
      title: chapter.title,
      number: chapter.number || "",
      level: chapter.level,
      orderIndex,
      description: chapter.description || "",
    });

    if (chapter.children && chapter.children.length > 0) {
      result.push(...flattenChapters(chapter.children, projectId, id, counter));
    }
  });

  return result;
}

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

// 全局 AbortController 引用，用于外部取消
let parseTemplateAbortController: AbortController | null = null;

export function useParseTemplate() {
  const { user } = useAuth();
  const bulkCreateChapters = useBulkCreateChapters();
  const queryClient = useQueryClient();

  const mutation = useMutation({
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
      parseTemplateAbortController = controller; // 保存引用供外部取消
      const timeoutId = setTimeout(() => {
        console.log("[ParseTemplate] Request timeout, aborting...");
        controller.abort();
      }, TIMEOUT_MS);

      try {
        const requestBody: Record<string, unknown> = {
          type: "template",
          content,
          filename,
          // Always pass fileData so Edge Function can do server-side extraction as fallback
          ...(fileData ? { fileData, mimeType } : {}),
        };

        // Call Supabase Edge Function which reads secrets via Deno.env.get()
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

        const response = await fetch(`${supabaseUrl}/functions/v1/parse`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${anonKey}`,
            "apikey": anonKey,
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errText = await response.text();
          console.error("[ParseTemplate] Edge Function error:", response.status, errText);
          throw new Error(`解析失败(${response.status}): ${errText.substring(0, 200)}`);
        }

        const data = await response.json();
        if (data?.error) throw new Error(`AI解析失败: ${data.error}`);

        const result = normalizeTemplateResult(data);
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
            throw new Error("已取消解析");
          }
        }
        throw new Error(normalizeSupabaseError(fetchError, "AI解析失败"));
      } finally {
        parseTemplateAbortController = null;
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["chapters", variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ["flatChapters", variables.projectId] });
    },
  });

  // 返回 mutation 及取消方法
  return {
    ...mutation,
    abort: () => {
      if (parseTemplateAbortController) {
        console.log("[ParseTemplate] User cancelled parsing");
        parseTemplateAbortController.abort();
        parseTemplateAbortController = null;
      }
    },
  };
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


