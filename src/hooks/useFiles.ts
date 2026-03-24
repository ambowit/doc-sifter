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
  // 实体识别字段
  entities: unknown[] | null;
  redactedFileUrl: string | null;
  entityTaskId: string | null;
  entityTaskStatus: string | null;
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

// Transform database row to UploadedFile interface
const transformFile = (row: Record<string, unknown>): UploadedFile => ({
  id: row.id as string,
  projectId: row.project_id as string,
  name: row.name as string,
  originalName: row.original_name as string,
  fileType: row.file_type as FileType,
  mimeType: row.mime_type as string,
  sizeBytes: row.size_bytes as number,
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
  entities: row.entities as unknown[] | null,
  redactedFileUrl: row.redacted_file_url as string | null,
  entityTaskId: row.entity_task_id as string | null,
  entityTaskStatus: row.entity_task_status as string | null,
  chapterId: row.chapter_id as string | null,
  aiSummary: row.ai_summary as string | null,
  aiClassifiedAt: row.ai_classified_at as string | null,
  classificationConfidence: row.classification_confidence as number | null,
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
});

// Hook to fetch all files for a project
export function useFiles(projectId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
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
      // Delete from storage if path provided
      if (storagePath) {
        await supabase.storage.from("dd-files").remove([storagePath]);
      }

      // Delete from database
      const { error } = await supabase
        .from("files")
        .delete()
        .eq("id", fileId);

      if (error) throw error;
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

// Upload file to SuperunStorage via Edge Function
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

    const { uploadUrl, contentType, downloadUrl } = presignData;
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
export async function getFileDownloadUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from("dd-files")
    .createSignedUrl(storagePath, 3600); // 1 hour expiry
  
  if (error || !data?.signedUrl) {
    console.error("[getFileDownloadUrl] Failed to get signed URL:", error);
    throw new Error("无法获取文件下载链接");
  }
  
  return data.signedUrl;
}

// Format file size for display
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Check if file type supports OCR / text extraction
export function canOcrFile(mimeType: string, fileName?: string): boolean {
  const m = mimeType.toLowerCase();
  const ext = (fileName || "").split(".").pop()?.toLowerCase() || "";
  // 图片和 PDF → OCR API
  if (["jpeg", "jpg", "png", "gif", "webp", "tiff"].some(t => m.includes(t))) return true;
  if (m.includes("pdf")) return true;
  // Office 文件 → 服务端文本提取
  if (m.includes("word") || ext === "docx" || ext === "doc") return true;
  if (m.includes("presentationml") || ext === "pptx" || ext === "ppt") return true;
  if (m.includes("spreadsheetml") || ext === "xlsx" || ext === "xls") return true;
  if (m.includes("text/plain") || ext === "txt") return true;
  return false;
}

// Hook to trigger OCR extraction for a file
export function useOcrExtract() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      fileId, 
      fileUrl, 
      mimeType, 
      fileName 
    }: { 
      fileId: string; 
      fileUrl: string; 
      mimeType: string; 
      fileName: string;
    }) => {
      const { data, error } = await supabase.functions.invoke("ocr-extract", {
        body: { fileId, fileUrl, mimeType, fileName },
      });

      if (error) throw error;
      
      // Check if the response indicates an error
      if (data?.error) {
        throw new Error(data.error);
      }
      
      return data as { 
        success: boolean; 
        text: string; 
        summary: string;
        method: string;
        pageCount: number;
        ocrFallbackUsed: boolean;
        skipped?: boolean;
      };
    },
    onSuccess: () => {
      // Invalidate files query to refresh OCR status - use refetchType to ensure fresh data
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

// Hook to batch process OCR for multiple files
// Processes files sequentially to avoid overwhelming the Edge Function
export function useBatchOcrExtract() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (files: Array<{ 
      fileId: string; 
      fileUrl: string; 
      mimeType: string; 
      fileName: string;
    }>) => {
      const results: PromiseSettledResult<{ fileId: string; success?: boolean; error?: string }>[] = [];
      
      // Process files sequentially with small delay between requests
      // This avoids overwhelming the Edge Function and reduces timeouts
      for (const file of files) {
        try {
          const { data, error } = await supabase.functions.invoke("ocr-extract", {
            body: file,
          });
          
          if (error) {
            results.push({ 
              status: "rejected", 
              reason: new Error(error.message || "OCR 请求失败") 
            });
          } else if (data?.error) {
            results.push({ 
              status: "rejected", 
              reason: new Error(data.error) 
            });
          } else {
            results.push({ 
              status: "fulfilled", 
              value: { fileId: file.fileId, ...data } 
            });
          }
        } catch (err) {
          results.push({ 
            status: "rejected", 
            reason: err instanceof Error ? err : new Error(String(err)) 
          });
        }
        
        // Small delay between requests to avoid rate limiting
        if (files.indexOf(file) < files.length - 1) {
          await new Promise(r => setTimeout(r, 300));
        }
      }

      const successful = results.filter(r => r.status === "fulfilled").length;
      const failed = results.filter(r => r.status === "rejected").length;
      
      // Collect error messages for failed files
      const errors = results
        .filter((r): r is PromiseRejectedResult => r.status === "rejected")
        .map(r => r.reason?.message || "未知错误");

      return { successful, failed, results, errors };
    },
    onSettled: () => {
      // Always invalidate after mutation settles (success or error)
      // to ensure UI reflects the actual database state
      queryClient.invalidateQueries({ queryKey: ["files"], refetchType: "all" });
    },
  });
}


