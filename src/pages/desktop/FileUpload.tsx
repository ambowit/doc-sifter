import { useState, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { validateProjectExists, clearInvalidProject } from "@/hooks/useProjects";
import { 
  useFiles, 
  useCreateFile, 
  useDeleteFile,
  uploadFile, 
  detectFileType, 
  formatFileSize,
  canOcrFile,
  useBatchOcrExtract,
  type FileType 
} from "@/hooks/useFiles";
import { 
  isArchiveFile, 
  isZipFile, 
  extractZipFile,
  detectArchiveType,
} from "@/lib/archiveExtractor";
import { useChapters } from "@/hooks/useChapters";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Upload,
  FileText,
  FolderOpen,
  ChevronRight,
  CheckCircle2,
  File,
  FileArchive,
  ArrowRight,
  X,
  Loader2,
  AlertTriangle,
  Archive,
  Eye,
  Download,
  FileImage,
  FileSpreadsheet,
  Trash2,
  ScanText,
  CheckCircle,
  LayoutTemplate,
  RefreshCw,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";

interface UploadingFile {
  file: File;
  progress: number;
  status: "uploading" | "completed" | "error";
  error?: string;
}

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
const ALLOWED_TYPES = [
  // Documents
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "application/rtf",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  // Images
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/bmp",
  "image/webp",
  "image/tiff",
  // Archives
  "application/zip",
  "application/x-zip-compressed",
  "application/x-compressed",
  "application/x-rar-compressed",
  "application/vnd.rar",
  "application/x-7z-compressed",
  // Other
  "text/html",
  "application/xml",
  "text/xml",
  "application/json",
];

// File extension fallback for browsers that don't set correct MIME type
const ALLOWED_EXTENSIONS = [
  // Documents
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".txt", ".csv", ".rtf", ".odt", ".ods",
  // Images
  ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tiff", ".tif",
  // Archives
  ".zip", ".rar", ".7z",
  // Other
  ".html", ".htm", ".xml", ".json",
];

export default function FileUpload() {
  const navigate = useNavigate();
  const currentProjectId = localStorage.getItem("dd-organizer-current-project");
  const { data: existingFiles = [], isLoading: filesLoading } = useFiles(currentProjectId || undefined);
  const { data: chapters = [] } = useChapters(currentProjectId || undefined);
  const createFileMutation = useCreateFile();
  const deleteFileMutation = useDeleteFile();
  const batchOcrMutation = useBatchOcrExtract();
  
  const [dataRoomDragOver, setDataRoomDragOver] = useState(false);
  const [previewFile, setPreviewFile] = useState<{
    name: string;
    storagePath: string;
    type: FileType;
    downloadUrl?: string;
  } | null>(null);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<{
    id?: string;
    name: string;
    size: number;
    type: FileType;
    storagePath: string;
    downloadUrl?: string;
    mimeType?: string;
    ocrProcessed?: boolean;
  }[]>([]);
  const [ocrProcessingIds, setOcrProcessingIds] = useState<Set<string>>(new Set());
  const [ocrFailedIds, setOcrFailedIds] = useState<Set<string>>(new Set());
  const [isPreparingOcr, setIsPreparingOcr] = useState(false);
  const [extractionStatus, setExtractionStatus] = useState<{
    isExtracting: boolean;
    archiveName: string;
    progress: number;
    currentFile: string;
  } | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  
  const dataRoomInputRef = useRef<HTMLInputElement>(null);

  // Check if template is ready (chapters exist)
  const hasTemplate = chapters.length > 0;

  // Validate project exists on mount
  useEffect(() => {
    const validateProject = async () => {
      if (currentProjectId) {
        const exists = await validateProjectExists(currentProjectId);
        if (!exists) {
          console.warn("[FileUpload] Project not found, redirecting to dashboard");
          clearInvalidProject();
          toast.error("项目不存在，请重新选择项目");
          navigate("/");
        }
      }
    };
    validateProject();
  }, [currentProjectId, navigate]);

  // Track if we've initialized from database - use stable fingerprint
  const hasInitializedRef = useRef(false);
  const prevFilesFingerprintRef = useRef("");

  // Sync database files with local state - use fingerprint to prevent loops
  useEffect(() => {
    // Skip if still loading
    if (filesLoading) return;

    // Create a stable fingerprint to detect actual changes
    const currentFingerprint = existingFiles.map(f => `${f.id}:${f.ocrProcessed}`).join(",");
    const fingerprintChanged = currentFingerprint !== prevFilesFingerprintRef.current;
    
    // Skip if nothing actually changed
    if (hasInitializedRef.current && !fingerprintChanged) return;
    
    prevFilesFingerprintRef.current = currentFingerprint;
    hasInitializedRef.current = true;

    if (existingFiles.length > 0) {
      const localFileMap = new Map(uploadedFiles.map(f => [f.storagePath, f]));
      const updatedFiles = existingFiles.map(f => {
        const localFile = localFileMap.get(f.storagePath);
        return {
          id: f.id,
          name: f.originalName,
          size: f.sizeBytes,
          type: f.fileType,
          storagePath: f.storagePath,
          mimeType: f.mimeType,
          ocrProcessed: f.ocrProcessed,
          downloadUrl: localFile?.downloadUrl,
        };
      });
      setUploadedFiles(updatedFiles);
    } else {
      setUploadedFiles([]);
    }
  }, [existingFiles, filesLoading]);

  // Calculate file stats
  const getFileStats = () => {
    const stats: Record<FileType, number> = {
      "合同": 0,
      "公司治理": 0,
      "财务": 0,
      "知识产权": 0,
      "人事": 0,
      "诉讼": 0,
      "压缩包": 0,
      "其他": 0,
    };
    uploadedFiles.forEach(f => {
      stats[f.type]++;
    });
    return Object.entries(stats)
      .filter(([, count]) => count > 0)
      .map(([type, count]) => ({ type, count }));
  };

  const validateFile = (file: File): string | null => {
    if (file.size > MAX_FILE_SIZE) {
      return `文件大小超过 500MB 限制`;
    }
    if (ALLOWED_TYPES.includes(file.type)) {
      return null;
    }
    const extension = "." + file.name.split(".").pop()?.toLowerCase();
    if (ALLOWED_EXTENSIONS.includes(extension)) {
      return null;
    }
    return `不支持的文件格式`;
  };

  // Get file icon based on file name
  const getFileIcon = (fileName: string) => {
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    if (["jpg", "jpeg", "png", "gif", "bmp", "webp", "tiff", "tif"].includes(ext)) {
      return <FileImage className="w-4 h-4 text-emerald-500 flex-shrink-0" />;
    }
    if (["xls", "xlsx", "csv", "ods"].includes(ext)) {
      return <FileSpreadsheet className="w-4 h-4 text-green-600 flex-shrink-0" />;
    }
    if (["pdf"].includes(ext)) {
      return <FileText className="w-4 h-4 text-red-500 flex-shrink-0" />;
    }
    if (["doc", "docx", "odt", "rtf"].includes(ext)) {
      return <FileText className="w-4 h-4 text-blue-500 flex-shrink-0" />;
    }
    return <File className="w-4 h-4 text-muted-foreground flex-shrink-0" />;
  };

  // Check if file can be previewed
  const canPreviewFile = (fileName: string): boolean => {
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    return [
      "jpg", "jpeg", "png", "gif", "bmp", "webp",
      "pdf", "txt", "html", "htm",
    ].includes(ext);
  };

  // Get preview content type
  const getPreviewType = (fileName: string): "image" | "pdf" | "text" | "unsupported" => {
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    if (["jpg", "jpeg", "png", "gif", "bmp", "webp"].includes(ext)) return "image";
    if (ext === "pdf") return "pdf";
    if (["txt", "html", "htm", "xml", "json", "csv"].includes(ext)) return "text";
    return "unsupported";
  };

  // Handle file preview
  const handlePreviewFile = async (file: {
    name: string;
    storagePath: string;
    type: FileType;
    downloadUrl?: string;
  }) => {
    let downloadUrl = file.downloadUrl || "";
    
    if (!downloadUrl) {
      try {
        const { data } = await supabase.functions.invoke("s3-pre-sign-url", {
          body: {
            key: file.storagePath,
            contentType: "application/octet-stream",
          },
        });
        downloadUrl = data?.downloadUrl || "";
      } catch (error) {
        console.error("[FileUpload] Failed to get download URL:", error);
        toast.error("获取下载链接失败");
        return;
      }
    }
    
    if (!downloadUrl) {
      toast.error("无法获取文件下载链接");
      return;
    }
    
    setPreviewFile({
      ...file,
      downloadUrl,
    });
  };

  // Handle deleting an uploaded file
  const handleDeleteFile = async (file: {
    id?: string;
    name: string;
    storagePath: string;
  }) => {
    if (!currentProjectId) return;
    
    try {
      if (file.id) {
        await deleteFileMutation.mutateAsync({
          fileId: file.id,
          projectId: currentProjectId,
          storagePath: file.storagePath,
        });
      }
      
      setUploadedFiles(prev => prev.filter(f => f.storagePath !== file.storagePath));
      toast.success(`已删除: ${file.name}`);
    } catch (error) {
      console.error("[FileUpload] Delete file error:", error);
      toast.error(`删除失败: ${file.name}`);
    }
  };

  // Handle removing a failed/uploading file from the list
  const handleRemoveUploadingFile = (index: number) => {
    setUploadingFiles(prev => prev.filter((_, i) => i !== index));
  };

  // Handle clearing all failed uploads
  const handleClearFailedUploads = () => {
    setUploadingFiles(prev => prev.filter(f => f.status !== "error"));
    toast.success("已清除所有失败的上传");
  };

  // Toggle file selection
  const handleToggleFileSelection = (storagePath: string) => {
    setSelectedFiles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(storagePath)) {
        newSet.delete(storagePath);
      } else {
        newSet.add(storagePath);
      }
      return newSet;
    });
  };

  // Select all files
  const handleSelectAllFiles = () => {
    if (selectedFiles.size === uploadedFiles.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(uploadedFiles.map(f => f.storagePath)));
    }
  };

  // Delete selected files
  const handleDeleteSelectedFiles = async () => {
    if (!currentProjectId || selectedFiles.size === 0) return;
    
    const filesToDelete = uploadedFiles.filter(f => selectedFiles.has(f.storagePath));
    const totalCount = filesToDelete.length;
    let successCount = 0;
    
    for (const file of filesToDelete) {
      try {
        if (file.id) {
          await deleteFileMutation.mutateAsync({
            fileId: file.id,
            projectId: currentProjectId,
            storagePath: file.storagePath,
          });
        }
        successCount++;
      } catch (error) {
        console.error("[FileUpload] Delete file error:", error);
      }
    }
    
    setUploadedFiles(prev => prev.filter(f => !selectedFiles.has(f.storagePath)));
    setSelectedFiles(new Set());
    
    if (successCount === totalCount) {
      toast.success(`已删除 ${successCount} 个文件`);
    } else {
      toast.warning(`删除完成: ${successCount}/${totalCount} 个文件`);
    }
  };

  // Handle batch OCR extraction
  const handleBatchOcr = async (
    files: Array<{
      fileId: string;
      fileUrl: string;
      mimeType: string;
      fileName: string;
    }>,
    options?: { autoRedirect?: boolean }
  ) => {
    if (files.length === 0) return;
    
    const fileIds = files.map(f => f.fileId);
    setOcrProcessingIds(prev => {
      const newSet = new Set(prev);
      fileIds.forEach(id => newSet.add(id));
      return newSet;
    });
    // Clear previously failed status for files being retried
    setOcrFailedIds(prev => {
      const newSet = new Set(prev);
      fileIds.forEach(id => newSet.delete(id));
      return newSet;
    });
    
    toast.info(`正在智能分析 ${files.length} 个文件...`, { duration: 3000 });
    
    try {
      const result = await batchOcrMutation.mutateAsync(files);
      
      // Track which files failed
      if (result.results) {
        const failedFileIds: string[] = [];
        result.results.forEach((r, index) => {
          if (r.status === "rejected") {
            failedFileIds.push(files[index].fileId);
          }
        });
        if (failedFileIds.length > 0) {
          setOcrFailedIds(prev => {
            const newSet = new Set(prev);
            failedFileIds.forEach(id => newSet.add(id));
            return newSet;
          });
        }
      }
      
      if (result.successful > 0) {
        toast.success(`已完成 ${result.successful} 个文件的智能分析`);
        
        // Auto redirect only if ALL succeeded
        if (options?.autoRedirect && hasTemplate && result.failed === 0) {
          toast.info("正在跳转到定义管理...", { duration: 2000 });
          setTimeout(() => {
            navigate("/definitions");
          }, 1500);
        }
      }
      if (result.failed > 0) {
        const uniqueErrors = [...new Set(result.errors || [])];
        const errorSummary = uniqueErrors.length > 0 
          ? `（${uniqueErrors.slice(0, 2).join("；")}${uniqueErrors.length > 2 ? "等" : ""}）`
          : "";
        toast.warning(`${result.failed} 个文件分析失败${errorSummary}`, { duration: 5000 });
      }
    } catch (error) {
      console.error("[FileUpload] OCR batch processing error:", error);
      const errorMessage = error instanceof Error ? error.message : "未知错误";
      toast.error(`智能分析失败: ${errorMessage}`);
      // Mark all files in this batch as failed
      setOcrFailedIds(prev => {
        const newSet = new Set(prev);
        fileIds.forEach(id => newSet.add(id));
        return newSet;
      });
    } finally {
      setOcrProcessingIds(prev => {
        const newSet = new Set(prev);
        fileIds.forEach(id => newSet.delete(id));
        return newSet;
      });
    }
  };

  // Handle manual OCR for selected files
  const handleOcrSelectedFiles = async () => {
    if (!currentProjectId || selectedFiles.size === 0) return;
    
    const filesToProcess: Array<{
      fileId: string;
      fileUrl: string;
      mimeType: string;
      fileName: string;
    }> = [];
    
    for (const storagePath of selectedFiles) {
      const file = uploadedFiles.find(f => f.storagePath === storagePath);
      if (!file?.id || !file.mimeType || !canOcrFile(file.mimeType)) continue;
      if (file.ocrProcessed) continue;
      
      try {
        let downloadUrl = file.downloadUrl;
        if (!downloadUrl) {
          const { data } = await supabase.functions.invoke("s3-pre-sign-url", {
            body: { key: storagePath, contentType: file.mimeType },
          });
          downloadUrl = data?.downloadUrl;
        }
        
        if (downloadUrl) {
          filesToProcess.push({
            fileId: file.id,
            fileUrl: downloadUrl,
            mimeType: file.mimeType,
            fileName: file.name,
          });
        }
      } catch (error) {
        console.error("[FileUpload] Failed to get download URL for OCR:", error);
      }
    }
    
    if (filesToProcess.length === 0) {
      toast.info("所选文件无需提取或已提取过");
      return;
    }
    
    await handleBatchOcr(filesToProcess);
    setSelectedFiles(new Set());
  };

  // Handle single file retry extraction
  const handleSingleFileRetry = async (file: {
    id?: string;
    storagePath: string;
    mimeType?: string;
    name: string;
    downloadUrl?: string;
  }) => {
    if (!file.id || !file.mimeType || !canOcrFile(file.mimeType)) return;

    let downloadUrl = file.downloadUrl;
    if (!downloadUrl) {
      try {
        const { data } = await supabase.functions.invoke("s3-pre-sign-url", {
          body: { key: file.storagePath, contentType: file.mimeType },
        });
        downloadUrl = data?.downloadUrl;
      } catch (error) {
        console.error("[FileUpload] Failed to get download URL for retry:", error);
        toast.error(`获取文件链接失败: ${file.name}`);
        return;
      }
    }
    if (!downloadUrl) {
      toast.error("无法获取文件下载链接");
      return;
    }

    await handleBatchOcr([{
      fileId: file.id,
      fileUrl: downloadUrl,
      mimeType: file.mimeType,
      fileName: file.name,
    }]);
  };

  // Handle retry all failed files
  const handleRetryAllFailed = async () => {
    if (ocrFailedIds.size === 0) return;

    const filesToRetry: Array<{
      fileId: string;
      fileUrl: string;
      mimeType: string;
      fileName: string;
    }> = [];

    for (const fileId of ocrFailedIds) {
      const file = uploadedFiles.find(f => f.id === fileId);
      if (!file?.id || !file.mimeType || !canOcrFile(file.mimeType)) continue;

      try {
        let downloadUrl = file.downloadUrl;
        if (!downloadUrl) {
          const { data } = await supabase.functions.invoke("s3-pre-sign-url", {
            body: { key: file.storagePath, contentType: file.mimeType },
          });
          downloadUrl = data?.downloadUrl;
        }
        if (downloadUrl) {
          filesToRetry.push({
            fileId: file.id,
            fileUrl: downloadUrl,
            mimeType: file.mimeType,
            fileName: file.name,
          });
        }
      } catch (error) {
        console.error("[FileUpload] Failed to get download URL for retry:", error);
      }
    }

    if (filesToRetry.length === 0) {
      toast.info("没有可重试的文件");
      return;
    }

    await handleBatchOcr(filesToRetry);
  };

  // Count files needing extraction (failed + never tried, excluding currently processing)
  const unextractedOcrFiles = uploadedFiles.filter(
    f => f.id && f.mimeType && canOcrFile(f.mimeType) && !f.ocrProcessed && !ocrProcessingIds.has(f.id)
  );
  const failedOcrFiles = unextractedOcrFiles.filter(f => f.id && ocrFailedIds.has(f.id));

  // Handle extracting all unextracted files
  const handleExtractAllUnextracted = async () => {
    if (unextractedOcrFiles.length === 0) return;
    setIsPreparingOcr(true);
    toast.info(`正在准备 ${unextractedOcrFiles.length} 个文件...`);

    const filesToProcess: Array<{
      fileId: string;
      fileUrl: string;
      mimeType: string;
      fileName: string;
    }> = [];

    for (const file of unextractedOcrFiles) {
      if (!file.id || !file.mimeType) continue;
      try {
        let downloadUrl = file.downloadUrl;
        if (!downloadUrl) {
          const { data } = await supabase.functions.invoke("s3-pre-sign-url", {
            body: { key: file.storagePath, contentType: file.mimeType },
          });
          downloadUrl = data?.downloadUrl;
        }
        if (downloadUrl) {
          filesToProcess.push({
            fileId: file.id,
            fileUrl: downloadUrl,
            mimeType: file.mimeType,
            fileName: file.name,
          });
        } else {
          console.warn("[FileUpload] No downloadUrl for:", file.name);
        }
      } catch (error) {
        console.error("[FileUpload] Failed to get URL for:", file.name, error);
      }
    }

    setIsPreparingOcr(false);

    if (filesToProcess.length === 0) {
      toast.error("无法获取文件下载链接，请稍后重试");
      return;
    }

    await handleBatchOcr(filesToProcess);
  };

  const handleFileUpload = useCallback(async (files: FileList | File[]) => {
    console.log("[FileUpload] handleFileUpload called with", files.length, "files");
    
    if (!currentProjectId) {
      toast.error("请先选择或创建一个项目");
      navigate("/");
      return;
    }

    const projectExists = await validateProjectExists(currentProjectId);
    if (!projectExists) {
      toast.error("项目不存在或已被删除，请重新选择项目");
      clearInvalidProject();
      navigate("/");
      return;
    }

    const fileArray = Array.from(files);
    let filesToUpload: File[] = [];
    
    for (const file of fileArray) {
      console.log("[FileUpload] Processing file:", file.name, file.type, file.size);
      
      let isArchive = isArchiveFile(file);
      let archiveType: "zip" | "rar" | "7z" | null = null;
      
      if (!isArchive && file.size > 0) {
        archiveType = await detectArchiveType(file);
        if (archiveType) {
          console.log(`[FileUpload] Detected ${archiveType.toUpperCase()} by magic bytes:`, file.name);
          isArchive = true;
        }
      }
      
      if (isArchive) {
        console.log("[FileUpload] Detected archive file:", file.name);
        
        const canExtract = archiveType === "zip" || (!archiveType && isZipFile(file));
        const reason = !canExtract 
          ? `${archiveType === "rar" ? "RAR" : archiveType === "7z" ? "7Z" : "该"}格式暂不支持在线解压。建议：使用 WinRAR/7-Zip 转换为 ZIP 格式，或在本地解压后上传`
          : undefined;
        
        if (canExtract) {
          setExtractionStatus({
            isExtracting: true,
            archiveName: file.name,
            progress: 0,
            currentFile: "正在读取压缩包...",
          });
          
          toast.info(`正在解压 ${file.name}...`);
          
          const extractionResult = await extractZipFile(file, (progress, currentFile) => {
            setExtractionStatus(prev => prev ? {
              ...prev,
              progress,
              currentFile,
            } : null);
          });
          
          setExtractionStatus(null);
          
          if (extractionResult.success && extractionResult.files.length > 0) {
            console.log(`[FileUpload] Extracted ${extractionResult.files.length} files from ${file.name}`);
            toast.success(`从 ${file.name} 提取了 ${extractionResult.files.length} 个文件`);
            
            for (const extractedFile of extractionResult.files) {
              const error = validateFile(extractedFile.file);
              if (!error) {
                filesToUpload.push(extractedFile.file);
              } else {
                console.log(`[FileUpload] Skipping extracted file ${extractedFile.name}: ${error}`);
              }
            }
          } else if (extractionResult.error) {
            toast.error(`解压失败: ${extractionResult.error}`);
          }
        } else {
          toast.error(`${file.name}: 不支持的压缩格式`, {
            description: reason || "建议将压缩包转换为 ZIP 格式后重新上传，或者在本地解压后直接上传文件",
            duration: 8000,
          });
        }
      } else {
        const error = validateFile(file);
        if (error) {
          console.log("[FileUpload] Validation error:", error);
          toast.error(`${file.name}: ${error}`);
        } else {
          filesToUpload.push(file);
        }
      }
    }

    if (filesToUpload.length === 0) {
      console.log("[FileUpload] No valid files to upload after extraction");
      return;
    }

    console.log("[FileUpload] Starting upload for", filesToUpload.length, "files");
    
    setUploadingFiles(filesToUpload.map(f => ({
      file: f,
      progress: 0,
      status: "uploading",
    })));

    const uploadPromises = filesToUpload.map(async (file, index) => {
      try {
        console.log(`[FileUpload] Starting upload for file ${index + 1}:`, file.name);
        
        const { downloadUrl, storagePath } = await uploadFile(
          file,
          currentProjectId,
          (progress) => {
            setUploadingFiles(prev => 
              prev.map((uf, i) => i === index ? { ...uf, progress } : uf)
            );
          }
        );

        console.log(`[FileUpload] Upload complete for ${file.name}, creating database record...`);

        const fileType = detectFileType(file.name);
        const createdFile = await createFileMutation.mutateAsync({
          projectId: currentProjectId,
          name: file.name,
          originalName: file.name,
          fileType,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          storagePath,
        });

        console.log(`[FileUpload] Database record created:`, createdFile.id);

        setUploadingFiles(prev => 
          prev.map((uf, i) => i === index ? { ...uf, status: "completed", progress: 100 } : uf)
        );

        const mimeType = file.type || "application/octet-stream";
        setUploadedFiles(prev => [...prev, {
          id: createdFile.id,
          name: file.name,
          size: file.size,
          type: fileType,
          storagePath,
          downloadUrl,
          mimeType,
          ocrProcessed: false,
        }]);

        console.log(`[FileUpload] File ${file.name} upload SUCCESS!`);
        return { success: true, file, fileId: createdFile.id, downloadUrl, mimeType };
      } catch (error) {
        console.error(`[FileUpload] Failed to upload ${file.name}:`, error);
        setUploadingFiles(prev => 
          prev.map((uf, i) => i === index ? { 
            ...uf, 
            status: "error", 
            error: error instanceof Error ? error.message : "上传失败"
          } : uf)
        );
        return { success: false, file, error };
      }
    });

    const results = await Promise.all(uploadPromises);
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    const clearDelay = failCount > 0 ? 5000 : 2000;
    setTimeout(() => {
      setUploadingFiles(prev => prev.filter(uf => uf.status === "error"));
    }, clearDelay);

    if (failCount > 0) {
      setTimeout(() => {
        setUploadingFiles([]);
      }, 10000);
    }

    if (successCount > 0) {
      toast.success(`成功上传 ${successCount} 个文件`);
      
      const ocrCandidates = results
        .filter(r => r.success && r.downloadUrl && r.mimeType && canOcrFile(r.mimeType))
        .map(r => ({
          fileId: r.fileId!,
          fileUrl: r.downloadUrl!,
          mimeType: r.mimeType!,
          fileName: r.file.name,
        }));
      
      if (ocrCandidates.length > 0) {
        console.log(`[FileUpload] Auto-triggering OCR for ${ocrCandidates.length} files`);
        setTimeout(() => {
          handleBatchOcr(ocrCandidates, { autoRedirect: true });
        }, 500);
      }
    }
    if (failCount > 0) {
      toast.error(`${failCount} 个文件上传失败，请检查网络后重试`);
    }
  }, [currentProjectId, createFileMutation, navigate]);

  const handleDataRoomDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDataRoomDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileUpload(files);
    }
  }, [handleFileUpload]);

  const handleDataRoomInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const fileArray = Array.from(files);
      e.target.value = "";
      handleFileUpload(fileArray);
    }
  };

  const handleContinueToDefinitions = () => {
    if (!hasTemplate) {
      toast.error("请先设置报告模板结构", {
        description: "前往「模板指纹」页面上传或生成报告结构",
      });
      navigate("/template");
      return;
    }
    navigate("/definitions");
  };

  // Show loading if no project selected
  if (!currentProjectId) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[400px]">
        <AlertTriangle className="w-12 h-12 text-status-warning mb-4" />
        <h2 className="text-lg font-semibold mb-2">请先选择项目</h2>
        <p className="text-muted-foreground mb-4">需要先创建或选择一个项目才能上传文件</p>
        <Button onClick={() => navigate("/")}>返回项目列表</Button>
      </div>
    );
  }

  return (
    <div className="p-6 h-full flex flex-col">
      {/* Hidden file inputs */}
      <input
        ref={dataRoomInputRef}
        type="file"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.odt,.ods,.jpg,.jpeg,.png,.gif,.bmp,.webp,.tiff,.tif,.html,.htm,.xml,.json,.zip,.rar,.7z"
        multiple
        className="hidden"
        onChange={handleDataRoomInputChange}
      />

      {/* Page Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">数据室文件</h1>
          <p className="text-[13px] text-muted-foreground mt-1">
            上传尽调资料，AI 自动提取内容后将跳转到定义管理页面
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!hasTemplate && (
            <Button
              variant="outline"
              onClick={() => navigate("/template")}
              className="gap-2"
            >
              <LayoutTemplate className="w-4 h-4" />
              设置报告模板
            </Button>
          )}
          <Button
            onClick={handleContinueToDefinitions}
            disabled={uploadedFiles.length === 0}
            className="gap-2"
          >
            下一步：定义管理
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Template Status Banner */}
      {!hasTemplate && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3"
        >
          <LayoutTemplate className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-medium text-[14px] text-amber-900">尚未设置报告模板</div>
            <div className="text-[13px] text-amber-700 mt-0.5">
              请先前往「模板指纹」页面上传样本报告或使用AI生成报告结构，再进行文件映射。
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/template")}
            className="border-amber-300 text-amber-800 hover:bg-amber-100"
          >
            去设置
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </motion.div>
      )}

      {/* Data Room Panel */}
      <div className="flex-1 flex flex-col border border-border rounded overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface-subtle">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-muted-foreground" />
            <span className="font-semibold text-[13px]">尽调资料数据室</span>
          </div>
          {uploadedFiles.length > 0 && (
            <motion.span
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-emerald-100 text-emerald-700"
            >
              <CheckCircle2 className="w-3 h-3" />
              {uploadedFiles.length} 个文件
            </motion.span>
          )}
        </div>

        <div className="flex-1 overflow-auto">
          {uploadedFiles.length === 0 && uploadingFiles.length === 0 ? (
            <div
              className={cn(
                "h-full flex flex-col items-center justify-center p-8 transition-colors",
                dataRoomDragOver && "bg-primary/5 border-2 border-dashed border-primary"
              )}
              onDragOver={(e) => {
                e.preventDefault();
                setDataRoomDragOver(true);
              }}
              onDragLeave={() => setDataRoomDragOver(false)}
              onDrop={handleDataRoomDrop}
            >
              <motion.div
                animate={dataRoomDragOver ? { scale: 1.05 } : { scale: 1 }}
                className="w-20 h-20 rounded-lg bg-muted flex items-center justify-center mb-4"
              >
                <FileArchive className={cn("w-10 h-10", dataRoomDragOver ? "text-primary" : "text-muted-foreground")} />
              </motion.div>
              <h3 className="text-lg font-medium mb-2">上传尽调资料</h3>
              <p className="text-[13px] text-muted-foreground text-center mb-4 max-w-md">
                {dataRoomDragOver ? (
                  <span className="text-primary font-medium">释放以上传文件</span>
                ) : (
                  <>
                    拖放文件到此处，或点击下方按钮选择文件
                    <br />
                    <span className="text-[11px]">支持 PDF、Word、Excel、PPT、图片、ZIP 等多种格式，最大 500MB</span>
                  </>
                )}
              </p>
              <Button onClick={() => dataRoomInputRef.current?.click()}>
                <Upload className="w-4 h-4 mr-2" />
                选择文件
              </Button>
            </div>
          ) : (
            <div className="p-4">
              {/* Extraction Progress */}
              {extractionStatus && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-4 p-3 bg-primary/5 border border-primary/20 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Archive className="w-5 h-5 text-primary animate-pulse" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <div className="text-[13px] font-medium text-primary truncate">
                          正在解压: {extractionStatus.archiveName}
                        </div>
                        <span className="text-[11px] text-primary/70 ml-2 tabular-nums">
                          {extractionStatus.progress}%
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                        {extractionStatus.currentFile}
                      </div>
                      <div className="h-1.5 bg-primary/10 rounded-full overflow-hidden mt-2">
                        <motion.div
                          className="h-full bg-primary"
                          initial={{ width: 0 }}
                          animate={{ width: `${extractionStatus.progress}%` }}
                          transition={{ duration: 0.2 }}
                        />
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Uploading Files */}
              {uploadingFiles.length > 0 && (
                <div className="mb-4">
                  {uploadingFiles.some(f => f.status === "error") && (
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                        上传队列
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[11px] text-destructive hover:text-destructive"
                        onClick={handleClearFailedUploads}
                      >
                        清除失败项
                      </Button>
                    </div>
                  )}
                  <div className="space-y-2">
                    {uploadingFiles.map((uf, index) => (
                      <motion.div
                        key={index}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex items-center gap-3 p-2 bg-muted/30 rounded group"
                      >
                        <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center">
                          {uf.status === "uploading" ? (
                            <Loader2 className="w-4 h-4 text-primary animate-spin" />
                          ) : uf.status === "completed" ? (
                            <CheckCircle2 className="w-4 h-4 text-status-success" />
                          ) : (
                            <AlertTriangle className="w-4 h-4 text-destructive" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <div className="text-[13px] truncate">{uf.file.name}</div>
                            <div className="flex items-center gap-2">
                              {uf.status === "uploading" && (
                                <span className="text-[11px] text-muted-foreground tabular-nums">
                                  {uf.progress}%
                                </span>
                              )}
                              {uf.status === "completed" && (
                                <span className="text-[11px] text-status-success">已完成</span>
                              )}
                              {uf.status === "error" && (
                                <button
                                  onClick={() => handleRemoveUploadingFile(index)}
                                  className="p-1 hover:bg-muted rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                  title="移除"
                                >
                                  <X className="w-3.5 h-3.5 text-muted-foreground" />
                                </button>
                              )}
                            </div>
                          </div>
                          {uf.status === "uploading" && (
                            <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-1">
                              <motion.div
                                className="h-full bg-primary"
                                initial={{ width: 0 }}
                                animate={{ width: `${uf.progress}%` }}
                                transition={{ duration: 0.3 }}
                              />
                            </div>
                          )}
                          {uf.status === "error" && (
                            <div className="text-[11px] text-destructive mt-1">{uf.error}</div>
                          )}
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}

              {/* File Stats */}
              {uploadedFiles.length > 0 && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    文件分类统计
                  </div>
                  <div className="grid grid-cols-4 gap-2 mb-4">
                    {getFileStats().map((stat, index) => (
                      <motion.div
                        key={stat.type}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: index * 0.05 }}
                        className="p-2 bg-muted/30 rounded"
                      >
                        <div className="text-[11px] text-muted-foreground">{stat.type}</div>
                        <div className="text-lg font-semibold tabular-nums">{stat.count}</div>
                      </motion.div>
                    ))}
                  </div>

                  {/* Failed Extraction Banner */}
                  {failedOcrFiles.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: -5 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mb-4 p-3 bg-destructive/5 border border-destructive/20 rounded-lg flex items-center gap-3"
                    >
                      <div className="w-8 h-8 rounded-lg bg-destructive/10 flex items-center justify-center flex-shrink-0">
                        <AlertTriangle className="w-4 h-4 text-destructive" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-destructive">
                          {failedOcrFiles.length} 个文件提取失败
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          点击“全部重试”或在文件后方单独重试每个文件
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-destructive/30 text-destructive hover:bg-destructive/10 gap-1.5 flex-shrink-0"
                        onClick={handleRetryAllFailed}
                        disabled={ocrProcessingIds.size > 0 || isPreparingOcr}
                      >
                        {(ocrProcessingIds.size > 0 || isPreparingOcr) ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3.5 h-3.5" />
                        )}
                        全部重试
                      </Button>
                    </motion.div>
                  )}

                  {/* Unextracted Files Banner (files never attempted, excluding failed ones) */}
                  {unextractedOcrFiles.length > 0 && failedOcrFiles.length < unextractedOcrFiles.length && (
                    <motion.div
                      initial={{ opacity: 0, y: -5 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-3"
                    >
                      <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                        <ScanText className="w-4 h-4 text-amber-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-amber-900">
                          {unextractedOcrFiles.length} 个文件尚未提取文字
                        </div>
                        <div className="text-[11px] text-amber-700 mt-0.5">
                          提取后可用于 AI 分析和报告生成
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-amber-300 text-amber-800 hover:bg-amber-100 gap-1.5 flex-shrink-0"
                        onClick={handleExtractAllUnextracted}
                        disabled={ocrProcessingIds.size > 0 || isPreparingOcr}
                      >
                        {(ocrProcessingIds.size > 0 || isPreparingOcr) ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <ScanText className="w-3.5 h-3.5" />
                        )}
                        {isPreparingOcr ? "准备中..." : "全部提取"}
                      </Button>
                    </motion.div>
                  )}

                  {/* File List */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedFiles.size === uploadedFiles.length && uploadedFiles.length > 0}
                        onChange={handleSelectAllFiles}
                        className="w-3.5 h-3.5 rounded border-border text-primary focus:ring-primary cursor-pointer"
                        title="全选"
                      />
                      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                        文件清单 ({uploadedFiles.length})
                      </div>
                      {selectedFiles.size > 0 && (
                        <span className="text-[11px] text-primary">
                          已选 {selectedFiles.size} 项
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {selectedFiles.size > 0 && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-[11px]"
                            onClick={handleOcrSelectedFiles}
                            disabled={batchOcrMutation.isPending || ocrProcessingIds.size > 0}
                          >
                            <ScanText className="w-3.5 h-3.5 mr-1" />
                            {batchOcrMutation.isPending ? "提取中..." : "提取文字"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-[11px] text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={handleDeleteSelectedFiles}
                            disabled={deleteFileMutation.isPending}
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-1" />
                            删除选中
                          </Button>
                        </>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-[11px]"
                        onClick={() => dataRoomInputRef.current?.click()}
                      >
                        添加更多
                      </Button>
                    </div>
                  </div>
                  <div
                    className="space-y-1 max-h-[400px] overflow-auto"
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDataRoomDragOver(true);
                    }}
                    onDragLeave={() => setDataRoomDragOver(false)}
                    onDrop={handleDataRoomDrop}
                  >
                    {uploadedFiles.map((file, index) => (
                      <motion.div
                        key={index}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.02 }}
                        className={cn(
                          "flex items-center gap-2 py-1.5 px-2 hover:bg-muted/50 rounded text-[13px] group",
                          selectedFiles.has(file.storagePath) && "bg-primary/5"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={selectedFiles.has(file.storagePath)}
                          onChange={() => handleToggleFileSelection(file.storagePath)}
                          className="w-3.5 h-3.5 rounded border-border text-primary focus:ring-primary cursor-pointer"
                          onClick={(e) => e.stopPropagation()}
                        />
                        {getFileIcon(file.name)}
                        <span className="flex-1 truncate" title={file.name}>{file.name}</span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePreviewFile(file);
                            }}
                            className="p-1 hover:bg-muted rounded"
                            title={canPreviewFile(file.name) ? "预览" : "查看/下载"}
                          >
                            <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                          </button>
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              let url = file.downloadUrl;
                              if (!url) {
                                try {
                                  const { data } = await supabase.functions.invoke("s3-pre-sign-url", {
                                    body: { key: file.storagePath, contentType: "application/octet-stream" },
                                  });
                                  url = data?.downloadUrl;
                                } catch (error) {
                                  console.error("[FileUpload] Failed to get download URL:", error);
                                  toast.error("获取下载链接失败");
                                  return;
                                }
                              }
                              if (url) {
                                window.open(url, "_blank");
                              } else {
                                toast.error("无法获取下载链接");
                              }
                            }}
                            className="p-1 hover:bg-muted rounded"
                            title="下载"
                          >
                            <Download className="w-3.5 h-3.5 text-muted-foreground" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteFile(file);
                            }}
                            className="p-1 hover:bg-destructive/10 rounded"
                            title="删除"
                            disabled={deleteFileMutation.isPending}
                          >
                            <Trash2 className="w-3.5 h-3.5 text-destructive/70 hover:text-destructive" />
                          </button>
                        </div>
                        {/* OCR Status Indicator */}
                        {file.mimeType && canOcrFile(file.mimeType) && (
                          ocrProcessingIds.has(file.id || "") ? (
                            <span className="text-[10px] text-primary px-1.5 py-0.5 bg-primary/10 rounded flex items-center gap-1">
                              <Loader2 className="w-2.5 h-2.5 animate-spin" />
                              提取中
                            </span>
                          ) : file.ocrProcessed ? (
                            <span className="text-[10px] text-status-success px-1.5 py-0.5 bg-status-success/10 rounded flex items-center gap-1">
                              <CheckCircle className="w-2.5 h-2.5" />
                              已提取
                            </span>
                          ) : ocrFailedIds.has(file.id || "") ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSingleFileRetry(file);
                              }}
                              className="text-[10px] text-destructive px-1.5 py-0.5 bg-destructive/10 rounded flex items-center gap-1 hover:bg-destructive/20 transition-colors cursor-pointer"
                              title="点击重新提取"
                            >
                              <RefreshCw className="w-2.5 h-2.5" />
                              提取失败·重试
                            </button>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSingleFileRetry(file);
                              }}
                              className="text-[10px] text-muted-foreground px-1.5 py-0.5 bg-muted rounded flex items-center gap-1 hover:bg-primary/10 hover:text-primary transition-colors cursor-pointer"
                              title="点击提取文字"
                            >
                              <ScanText className="w-2.5 h-2.5" />
                              未提取
                            </button>
                          )
                        )}
                        <span className="text-[11px] text-muted-foreground px-1.5 py-0.5 bg-muted rounded">
                          {file.type}
                        </span>
                        <span className="text-[11px] text-muted-foreground font-mono">
                          {formatFileSize(file.size)}
                        </span>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* File Preview Dialog */}
      <Dialog open={!!previewFile} onOpenChange={(open) => !open && setPreviewFile(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {previewFile && getFileIcon(previewFile.name)}
              <span className="truncate">{previewFile?.name}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto min-h-0">
            {previewFile && (() => {
              const previewType = getPreviewType(previewFile.name);
              const url = previewFile.downloadUrl || "";
              
              if (!url) {
                return (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <AlertTriangle className="w-16 h-16 mb-4" />
                    <p>无法加载文件，请关闭后重试</p>
                  </div>
                );
              }
              
              if (previewType === "image") {
                return (
                  <div className="flex items-center justify-center bg-muted/30 rounded-lg p-4 min-h-[400px]">
                    <img
                      src={url}
                      alt={previewFile.name}
                      className="max-w-full max-h-[60vh] object-contain rounded"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                        (e.target as HTMLImageElement).parentElement!.innerHTML = "<div class='text-muted-foreground text-center py-20'>图片加载失败</div>";
                      }}
                    />
                  </div>
                );
              }
              
              if (previewType === "pdf") {
                return (
                  <iframe
                    src={url}
                    className="w-full h-[60vh] rounded-lg border"
                    title={previewFile.name}
                  />
                );
              }
              
              if (previewType === "text") {
                return (
                  <iframe
                    src={url}
                    className="w-full h-[60vh] rounded-lg border bg-white"
                    title={previewFile.name}
                  />
                );
              }
              
              return (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <File className="w-16 h-16 mb-4" />
                  <p className="mb-4">此文件格式不支持在线预览</p>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-primary hover:underline"
                  >
                    <Download className="w-4 h-4" />
                    下载文件
                  </a>
                </div>
              );
            })()}
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t">
            {previewFile?.downloadUrl && (
              <a
                href={previewFile.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary hover:underline"
              >
                <Download className="w-4 h-4" />
                下载文件
              </a>
            )}
            <Button variant="outline" onClick={() => setPreviewFile(null)}>
              关闭
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
