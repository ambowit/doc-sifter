import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type FileType = "合同" | "公司治理" | "财务" | "知识产权" | "人事" | "诉讼" | "压缩包" | "其他";
export type FileStatus = "待解析" | "解析中" | "已解析" | "解析失败";

export interface UploadedFile {
  id: string;
  projectId: string;
  name: string;
  originalName: string;
  fileType: FileType;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  status: FileStatus;
  excerpt: string | null;
  pageRef: string | null;
  confidence: number | null;
  parsedContent: Record<string, unknown> | null;
  extractedText: string | null;
  textSummary: string | null;
  ocrProcessed: boolean;
  ocrProcessedAt: string | null;
  extractionStatus: string | null;
  extractionMethod: string | null;
  extractionError: string | null;
  extractionCompletedAt: string | null;
  // OCR 任务状态（PDF 异步处理）
  ocrTaskId: string | null;
  ocrTaskStatus: string | null; // pending | processing | completed | failed
  ocrTaskStartedAt: string | null;
  ocrTaskCompletedAt: string | null;
  // AI 分类字段
  chapterId: string | null;
  aiSummary: string | null;
  aiClassifiedAt: string | null;
  classificationConfidence: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFileData {
  projectId: string;
  name: string;
  originalName: string;
  fileType: FileType;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

function toFiniteNumber(value: unknown, fallback = 0): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : fallback;

  return Number.isFinite(parsed) ? parsed : fallback;
}

// Transform database row to UploadedFile interface
const transformFile = (row: Record<string, unknown>): UploadedFile => ({
  id: row.id as string,
  projectId: row.project_id as string,
  name: row.name as string,
  originalName: row.original_name as string,
  fileType: row.file_type as FileType,
  mimeType: row.mime_type as string,
  sizeBytes: toFiniteNumber(row.size_bytes),
  storagePath: row.storage_path as string,
  status: row.status as FileStatus,
  excerpt: row.excerpt as string | null,
  pageRef: row.page_ref as string | null,
  confidence: row.confidence as number | null,
  parsedContent: row.parsed_content as Record<string, unknown> | null,
  extractedText: row.extracted_text as string | null,
  textSummary: row.text_summary as string | null,
  ocrProcessed: (row.ocr_processed as boolean) || false,
  ocrProcessedAt: row.ocr_processed_at as string | null,
  extractionStatus: row.extraction_status as string | null,
  extractionMethod: row.extraction_method as string | null,
  extractionError: row.extraction_error as string | null,
  extractionCompletedAt: row.extraction_completed_at as string | null,
  // OCR 任务状态（PDF 异步处理）
  ocrTaskId: row.ocr_task_id as string | null,
  ocrTaskStatus: row.ocr_task_status as string | null,
  ocrTaskStartedAt: row.ocr_task_started_at as string | null,
  ocrTaskCompletedAt: row.ocr_task_completed_at as string | null,
  chapterId: row.chapter_id as string | null,
  aiSummary: row.ai_summary as string | null,
  aiClassifiedAt: row.ai_classified_at as string | null,
  classificationConfidence: row.classification_confidence as number | null,
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
});

// Hook to fetch all files for a project
// Automatically polls when there are pending OCR tasks
export function useFiles(projectId: string | undefined) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["files", projectId],
    queryFn: async () => {
      if (!user) throw new Error("User not authenticated");
      if (!projectId) throw new Error("Project ID is required");

      const { data, error } = await supabase
        .from("files")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data || []).map(transformFile);
    },
    enabled: !!user && !!projectId,
  });

  useEffect(() => {
    if (!user || !projectId) return;

    const channel = supabase
      .channel(`files-${projectId}-${Date.now()}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "files",
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["files", projectId] });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [projectId, queryClient, user]);

  return query;
}

// Hook to create a file record
export function useCreateFile() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (data: CreateFileData) => {
      if (!user) throw new Error("User not authenticated");

      const { data: file, error } = await supabase
        .from("files")
        .insert({
          project_id: data.projectId,
          name: data.name,
          original_name: data.originalName,
          file_type: data.fileType,
          mime_type: data.mimeType,
          size_bytes: data.sizeBytes,
          storage_path: data.storagePath,
        })
        .select()
        .single();

      if (error) throw error;
      return transformFile(file);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["files", variables.projectId] });
    },
  });
}

// Hook to update file status
export function useUpdateFileStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      fileId, 
      status, 
      excerpt, 
      pageRef, 
      confidence,
      parsedContent 
    }: { 
      fileId: string; 
      status: FileStatus;
      excerpt?: string;
      pageRef?: string;
      confidence?: number;
      parsedContent?: Record<string, unknown>;
    }) => {
      const updates: Record<string, unknown> = { status };
      if (excerpt !== undefined) updates.excerpt = excerpt;
      if (pageRef !== undefined) updates.page_ref = pageRef;
      if (confidence !== undefined) updates.confidence = confidence;
      if (parsedContent !== undefined) updates.parsed_content = parsedContent;

      const { data, error } = await supabase
        .from("files")
        .update(updates)
        .eq("id", fileId)
        .select()
        .single();

      if (error) throw error;
      return transformFile(data);
    },
    onSuccess: (file) => {
      queryClient.invalidateQueries({ queryKey: ["files", file.projectId] });
    },
  });
}

// Hook to delete a file
export function useDeleteFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ fileId, projectId, storagePath }: { fileId: string; projectId: string; storagePath?: string }) => {
      await invokeAuthedFunction("delete-file", { fileId, projectId, storagePath });
      return { fileId, projectId };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["files", variables.projectId] });
    },
  });
}

// Detect file type based on filename
export function detectFileType(filename: string): FileType {
  const lower = filename.toLowerCase();
  
  // Check for ZIP files first
  if (lower.endsWith(".zip") || lower.endsWith(".rar") || lower.endsWith(".7z")) {
    return "压缩包";
  }
  
  if (lower.includes("合同") || lower.includes("协议") || lower.includes("contract") || lower.includes("agreement")) {
    return "合同";
  }
  if (lower.includes("章程") || lower.includes("决议") || lower.includes("股东") || lower.includes("董事")) {
    return "公司治理";
  }
  if (lower.includes("财务") || lower.includes("审计") || lower.includes("资产") || lower.includes("负债") || lower.includes("利润")) {
    return "财务";
  }
  if (lower.includes("专利") || lower.includes("商标") || lower.includes("著作") || lower.includes("知识产权")) {
    return "知识产权";
  }
  if (lower.includes("员工") || lower.includes("人事") || lower.includes("劳动") || lower.includes("社保")) {
    return "人事";
  }
  if (lower.includes("诉讼") || lower.includes("仲裁") || lower.includes("判决") || lower.includes("裁定")) {
    return "诉讼";
  }
  
  return "其他";
}

// Upload file via Edge Function-issued signed upload URL
export async function uploadFile(
  file: File,
  projectId: string,
  onProgress?: (progress: number) => void
): Promise<{ downloadUrl: string; storagePath: string; fileContent?: ArrayBuffer }> {
  // Generate a collision-resistant file path
  const date = new Date();
  const dateFolder = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const randomId = Math.random().toString(36).substring(2, 10);
  const extension = file.name.split(".").pop() || "bin";
  const storagePath = `${projectId}/${dateFolder}/${randomId}.${extension}`;

  onProgress?.(5);

  try {
    // Step 1: Get pre-signed URL from Edge Function (10%)
    const { data: presignData, error: presignError } = await supabase.functions.invoke("s3-pre-sign-url", {
      body: {
        key: storagePath,
        contentType: file.type || "application/octet-stream",
      },
    });

    if (presignError) {
      throw new Error(`Failed to get upload URL: ${presignError.message}`);
    }

    const { uploadUrl, contentType } = presignData;
    if (!uploadUrl) {
      throw new Error("No upload URL returned");
    }

    onProgress?.(15);

    // Step 2: Upload file directly to S3 with progress tracking (15-90%)
    console.log("[Upload] Starting S3 upload to:", uploadUrl.substring(0, 100) + "...");
    console.log("[Upload] File:", file.name, "Size:", file.size, "Type:", contentType || file.type);
    
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          const percentComplete = Math.round((event.loaded / event.total) * 75) + 15;
          onProgress?.(Math.min(percentComplete, 90));
        }
      });

      xhr.addEventListener("load", () => {
        console.log("[Upload] XHR load event, status:", xhr.status, "response:", xhr.responseText?.substring(0, 200));
        if (xhr.status >= 200 && xhr.status < 300) {
          console.log("[Upload] Upload successful!");
          resolve();
        } else {
          console.error("[Upload] Upload failed with status:", xhr.status, xhr.responseText);
          reject(new Error(`Upload failed with status: ${xhr.status} - ${xhr.responseText?.substring(0, 100)}`));
        }
      });

      xhr.addEventListener("error", (e) => {
        console.error("[Upload] XHR error event:", e);
        reject(new Error("上传失败：网络错误，请检查网络连接后重试"));
      });

      xhr.addEventListener("timeout", () => {
        console.error("[Upload] XHR timeout after", xhr.timeout, "ms for file:", file.name, "size:", file.size);
        reject(new Error(`上传超时，文件过大或网络过慢。请尝试压缩文件或检查网络连接`));
      });

      xhr.addEventListener("abort", () => {
        console.error("[Upload] XHR aborted");
        reject(new Error("Upload aborted"));
      });

      xhr.open("PUT", uploadUrl);
      xhr.setRequestHeader("Content-Type", contentType || file.type || "application/octet-stream");
      // Dynamic timeout based on file size: minimum 5 minutes, add 1 minute per 10MB
      const baseTimeout = 300000; // 5 minutes
      const sizeBasedTimeout = Math.ceil(file.size / (10 * 1024 * 1024)) * 60000; // 1 minute per 10MB
      xhr.timeout = Math.max(baseTimeout, baseTimeout + sizeBasedTimeout);
      console.log("[Upload] Timeout set to:", xhr.timeout, "ms for file size:", file.size);
      xhr.send(file);
    });

    onProgress?.(95);

    // Step 3: Read file content for AI parsing (optional, for small files)
    let fileContent: ArrayBuffer | undefined;
    if (file.size < 10 * 1024 * 1024) { // Only read files < 10MB for parsing
      fileContent = await file.arrayBuffer();
    }

    const downloadUrl = await getFileDownloadUrl(projectId, storagePath);

    onProgress?.(100);

    return {
      downloadUrl,
      storagePath,
      fileContent,
    };
  } catch (error) {
    console.error("Upload error:", error);
    throw error;
  }
}

// Get download URL for a file (signed URL for private bucket)
export async function getFileDownloadUrl(projectId: string, storagePath: string): Promise<string> {
  const data = await invokeAuthedFunction<{ signedUrl?: string; error?: string }>("file-download-url", {
    projectId,
    storagePath,
  });

  if (!data?.signedUrl) {
    console.error("[getFileDownloadUrl] Failed to get signed URL:", data);
    throw new Error(data?.error || "无法获取文件下载链接");
  }

  return data.signedUrl;
}

// Format file size for display
export function formatFileSize(bytes: number | null | undefined): string {
  const normalized = toFiniteNumber(bytes, Number.NaN);
  if (!Number.isFinite(normalized) || normalized < 0) return "--";
  if (normalized < 1024) return `${normalized} B`;
  if (normalized < 1024 * 1024) return `${(normalized / 1024).toFixed(1)} KB`;
  return `${(normalized / (1024 * 1024)).toFixed(1)} MB`;
}

export type FileExtractionMethod = "ocr" | "document" | "spreadsheet" | "presentation" | "text";

export function getFileExtractionMethod(mimeType: string, fileName?: string): FileExtractionMethod | null {
  const m = mimeType.toLowerCase();
  const ext = (fileName || "").split(".").pop()?.toLowerCase() || "";

  // PDF 和图片走 Worker OCR
  if (m.includes("pdf") || ext === "pdf") return "ocr";
  if (m.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff", "tif"].includes(ext)) return "ocr";

  // Office 文件本地提取
  if (m.includes("wordprocessingml") || m.includes("msword") || ext === "docx" || ext === "doc") return "document";
  if (m.includes("spreadsheetml") || m.includes("ms-excel") || ext === "xlsx" || ext === "xls") return "spreadsheet";
  if (m.includes("presentationml") || m.includes("ms-powerpoint") || ext === "pptx" || ext === "ppt") return "presentation";

  // 纯文本
  if (m.includes("text/plain") || ext === "txt") return "text";

  return null;
}

// Check if file type supports automatic text extraction
export function canExtractFileText(mimeType: string, fileName?: string): boolean {
  return getFileExtractionMethod(mimeType, fileName) !== null;
}

// 获取当前用户 access_token，用于手动附加 Authorization header
async function getAuthHeaders(): Promise<Record<string, string>> {
  let { data: { session } } = await supabase.auth.getSession();
  const expiresSoon = !session?.expires_at || session.expires_at * 1000 <= Date.now() + 60_000;

  if (!session?.access_token || expiresSoon) {
    const { data, error } = await supabase.auth.refreshSession();
    if (error) throw new Error("用户登录已失效，请重新登录后重试");
    session = data.session;
  }

  if (!session?.access_token) throw new Error("用户未登��，���刷新页面后重试");

  return {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${session.access_token}`,
  };
}

async function invokeAuthedFunction<T>(functionName: string, body: Record<string, unknown>): Promise<T> {
  const headers = await getAuthHeaders();
  
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const raw = await response.text();
  const data = raw ? JSON.parse(raw) as Record<string, unknown> : {};

  if (!response.ok) {
    throw new Error(
      (typeof data.error === "string" && data.error) ||
      (typeof data.message === "string" && data.message) ||
      `调用 ${functionName} 失败 (${response.status})`
    );
  }

  return data as T;
}

// OCR 提取结果类型
export interface OcrExtractResult {
  success: boolean;
  queued?: boolean;
  skipped?: boolean;
  alreadyQueued?: boolean;
  taskId?: string;
  message?: string;
  error?: string;
}

// Hook to trigger OCR extraction for a file
export function useOcrExtract() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      fileId, 
      mimeType, 
      fileName 
    }: { 
      fileId: string; 
      mimeType: string; 
      fileName: string;
    }): Promise<OcrExtractResult> => {
      return await invokeAuthedFunction<OcrExtractResult>("ocr-extract", { fileId, mimeType, fileName });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["files"], refetchType: "all" });
    },
  });
}

// Hook to call AI classify-files Edge Function
export function useClassifyFiles() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      projectId,
      files,
      chapters,
    }: {
      projectId: string;
      files: Array<{ id: string; name: string; extractedText?: string | null; textSummary?: string | null }>;
      chapters: Array<{ id: string; number: string; title: string; level: number }>;
    }) => {
      const { data, error } = await supabase.functions.invoke("classify-files", {
        body: { projectId, files, chapters },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { success: boolean; classified: number; results: unknown[] };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["files", variables.projectId] });
    },
  });
}

// AI 分类进度状态
export interface ClassifyProgressState {
  isRunning: boolean;
  isPaused: boolean;
  total: number;
  current: number;
  currentFileName: string;
  completed: number;
  failed: number;
  results: Array<{ fileId: string; fileName: string; success: boolean; chapterId?: string | null; error?: string }>;
}

// Hook 用于带进度的 AI 分类（逐文件处理，支持暂停/取消）
export function useClassifyFilesWithProgress() {
  const queryClient = useQueryClient();
  const abortControllerRef = { current: null as AbortController | null };
  const isPausedRef = { current: false };

  const [progress, setProgress] = useState<ClassifyProgressState>({
    isRunning: false,
    isPaused: false,
    total: 0,
    current: 0,
    currentFileName: "",
    completed: 0,
    failed: 0,
    results: [],
  });

  const start = async ({
    projectId,
    files,
    chapters,
  }: {
    projectId: string;
    files: Array<{ id: string; name: string; extractedText?: string | null; textSummary?: string | null }>;
    chapters: Array<{ id: string; number: string; title: string; level: number }>;
  }) => {
    if (progress.isRunning) return;

    abortControllerRef.current = new AbortController();
    isPausedRef.current = false;

    setProgress({
      isRunning: true,
      isPaused: false,
      total: files.length,
      current: 0,
      currentFileName: "",
      completed: 0,
      failed: 0,
      results: [],
    });

    const results: ClassifyProgressState["results"] = [];

    for (let i = 0; i < files.length; i++) {
      // 检查是否已取消
      if (abortControllerRef.current?.signal.aborted) {
        break;
      }

      // 暂停时等待
      while (isPausedRef.current && !abortControllerRef.current?.signal.aborted) {
        await new Promise((r) => setTimeout(r, 100));
      }

      if (abortControllerRef.current?.signal.aborted) {
        break;
      }

      const file = files[i];
      setProgress((prev) => ({
        ...prev,
        current: i + 1,
        currentFileName: file.name,
      }));

      try {
        const { data, error } = await supabase.functions.invoke("classify-single", {
          body: { projectId, file, chapters },
        });

        if (error || data?.error) {
          results.push({ fileId: file.id, fileName: file.name, success: false, error: error?.message || data?.error });
          setProgress((prev) => ({ ...prev, failed: prev.failed + 1, results: [...results] }));
        } else {
          results.push({ fileId: file.id, fileName: file.name, success: true, chapterId: data?.result?.chapterId });
          setProgress((prev) => ({ ...prev, completed: prev.completed + 1, results: [...results] }));
        }
      } catch (err) {
        results.push({ fileId: file.id, fileName: file.name, success: false, error: String(err) });
        setProgress((prev) => ({ ...prev, failed: prev.failed + 1, results: [...results] }));
      }

      // 小延迟避免请求过快
      if (i < files.length - 1) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    setProgress((prev) => ({
      ...prev,
      isRunning: false,
      isPaused: false,
      currentFileName: "",
    }));

    queryClient.invalidateQueries({ queryKey: ["files", projectId] });

    return { completed: results.filter((r) => r.success).length, failed: results.filter((r) => !r.success).length };
  };

  const pause = () => {
    isPausedRef.current = true;
    setProgress((prev) => ({ ...prev, isPaused: true }));
  };

  const resume = () => {
    isPausedRef.current = false;
    setProgress((prev) => ({ ...prev, isPaused: false }));
  };

  const cancel = () => {
    abortControllerRef.current?.abort();
    setProgress((prev) => ({
      ...prev,
      isRunning: false,
      isPaused: false,
      currentFileName: "",
    }));
  };

  const reset = () => {
    setProgress({
      isRunning: false,
      isPaused: false,
      total: 0,
      current: 0,
      currentFileName: "",
      completed: 0,
      failed: 0,
      results: [],
    });
  };

  return { progress, start, pause, resume, cancel, reset };
}

// Hook to manually update a single file's chapter assignment
export function useUpdateFileChapter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ fileId, chapterId, projectId }: { fileId: string; chapterId: string | null; projectId?: string }) => {
      const { data, error } = await supabase
        .from("files")
        .update({ chapter_id: chapterId })
        .eq("id", fileId)
        .select()
        .single();
      if (error) throw error;
      return { file: transformFile(data), projectId };
    },
    onSuccess: ({ projectId }) => {
      queryClient.invalidateQueries({ queryKey: projectId ? ["files", projectId] : ["files"] });
    },
  });
}

// 批量 OCR 结果类型
export interface BatchOcrResult {
  fileId: string;
  status: "queued" | "skipped" | "already_processing" | "failed";
  taskId?: string;
  error?: string;
}

export interface BatchOcrSummary {
  requested: number;
  eligible: number;
  submitted: number;
  skipped: number;
  failed: number;
  alreadyProcessing: number;
  batchCount: number;
  batchSize: number;
  results: BatchOcrResult[];
  errors: string[];
}

// Hook to batch process OCR for multiple files.
// The client submits the full target set once and the server batches worker task creation.
export function useBatchOcrExtract() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: { 
      files: Array<{ fileId: string; mimeType: string; fileName: string; }>;
      force?: boolean;
    }) => {
      const data = await invokeAuthedFunction<Record<string, unknown>>("ocr-extract", {
        files: payload.files,
        force: payload.force ?? false,
      });

      // 后端立即返回 accepted 数量，实际处理在后台进行，通过 Realtime 更新
      const accepted = Number(data?.accepted || 0);
      return {
        requested: payload.files.length,
        eligible: accepted,
        submitted: accepted,
        skipped: 0,
        failed: 0,
        alreadyProcessing: 0,
        batchCount: 1,
        batchSize: accepted,
        results: [],
        errors: [],
      } satisfies BatchOcrSummary;
    },
    onSuccess: () => {
      // 立即刷新一次，后续通过 Realtime 自动更新
      queryClient.invalidateQueries({ 
        predicate: (query) => query.queryKey[0] === "files",
        refetchType: "all",
      });
    },
  });
}
