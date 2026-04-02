import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { validateProjectExists, clearInvalidProject } from "@/hooks/useProjects";
import {
  useFiles,
  useCreateFile,
  useDeleteFile,
  useUpdateFileChapter,
  uploadFile,
  detectFileType,
  formatFileSize,
  canExtractFileText,
  isLegacyOfficeFormat,
  useBatchOcrExtract,
  useClassifyFilesWithProgress,
  getFileDownloadUrl,
  type FileType
} from "@/hooks/useFiles";
import {
  isArchiveFile,
  isZipFile,
  extractZipFile,
  detectArchiveType,
} from "@/lib/archiveExtractor";
import { useFlatChapters, type Chapter } from "@/hooks/useChapters";
import { useMappings } from "@/hooks/useMappings";
import {
  useFileSections,
  useChapterSections,
  useBatchParseDocumentStructure,
  useMatchSectionsToChapters,
  type FileSectionWithChapter,
} from "@/hooks/useFileSections";


import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Upload,
  FileText,
  FolderOpen,
  ChevronRight,
  ChevronDown,
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
  Plus,
  BookOpen,
  Check,
  Unlink,

  ShieldCheck,
  Sparkles,
  FileSearch,
  Link2,
  Brain,
  Info,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import mammoth from "mammoth";

interface UploadingFile {
  file: File;
  progress: number;
  status: "uploading" | "completed" | "error";
  error?: string;
}

interface UploadedRoomFile {
  id?: string;
  name: string;
  sizeBytes: number;
  type: FileType;
  storagePath: string;
  downloadUrl?: string;
  mimeType?: string;
  ocrProcessed?: boolean;
  ocrTaskStatus?: string | null;
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

function normalizeChapterNumber(number: string | null | undefined): string {
  return (number || "").trim().replace(/。/g, ".");
}

function buildChapterHierarchy(chapters: Chapter[]) {
  const chapterById = new Map<string, Chapter>();
  const childrenMap = new Map<string, Chapter[]>();
  const roots: Chapter[] = [];

  chapters.forEach((chapter) => chapterById.set(chapter.id, chapter));

  // Strategy 1: use explicit parentId relationship when available.
  const hasParentRelations = chapters.some((c) => !!c.parentId);
  if (hasParentRelations) {
    for (const chapter of chapters) {
      if (chapter.parentId && chapterById.has(chapter.parentId)) {
        const children = childrenMap.get(chapter.parentId) || [];
        children.push(chapter);
        childrenMap.set(chapter.parentId, children);
      } else {
        roots.push(chapter);
      }
    }
  } else {
    // Strategy 2: derive parent from chapter number prefix.
    const numberToId = new Map<string, string>();
    chapters.forEach((chapter) => {
      const number = normalizeChapterNumber(chapter.number);
      if (number) numberToId.set(number, chapter.id);
    });

    let linkedByNumber = false;
    for (const chapter of chapters) {
      const chapterNumber = normalizeChapterNumber(chapter.number);
      const parentNumber = chapterNumber.includes(".")
        ? chapterNumber.split(".").slice(0, -1).join(".")
        : "";
      const parentId = parentNumber ? numberToId.get(parentNumber) : null;

      if (parentId && parentId !== chapter.id) {
        const children = childrenMap.get(parentId) || [];
        children.push(chapter);
        childrenMap.set(parentId, children);
        linkedByNumber = true;
      } else {
        roots.push(chapter);
      }
    }

    // Strategy 3: fallback by level + order when number is unavailable.
    if (!linkedByNumber && chapters.some((c) => c.level > 1)) {
      roots.length = 0;
      childrenMap.clear();
      const levelStack = new Map<number, Chapter>();

      for (const chapter of chapters) {
        const parent = chapter.level > 1 ? levelStack.get(chapter.level - 1) : null;
        if (parent) {
          const children = childrenMap.get(parent.id) || [];
          children.push(chapter);
          childrenMap.set(parent.id, children);
        } else {
          roots.push(chapter);
        }

        levelStack.set(chapter.level, chapter);
        for (const key of Array.from(levelStack.keys())) {
          if (key > chapter.level) levelStack.delete(key);
        }
      }
    }
  }

  const rootChapters = roots.length > 0 ? roots : chapters;
  const descendantIdsByChapter = new Map<string, Set<string>>();

  const collect = (chapterId: string): Set<string> => {
    const cached = descendantIdsByChapter.get(chapterId);
    if (cached) return cached;

    const ids = new Set<string>([chapterId]);
    const children = childrenMap.get(chapterId) || [];
    children.forEach((child) => {
      collect(child.id).forEach((id) => ids.add(id));
    });
    descendantIdsByChapter.set(chapterId, ids);
    return ids;
  };

  chapters.forEach((chapter) => {
    collect(chapter.id);
  });

  return { rootChapters, childrenMap, descendantIdsByChapter };
}

export default function FileUpload() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const currentProjectId = projectId || null;
  const { data: existingFiles = [], isLoading: filesLoading } = useFiles(currentProjectId || undefined);
  const { data: chapters = [] } = useFlatChapters(currentProjectId || undefined);
  const { data: fileSections = [] } = useFileSections(currentProjectId || undefined);
  const { data: mappings = [] } = useMappings(currentProjectId || undefined);

  // 基于 chapter_file_mappings 构建 fileId → Set<chapterId> 的多对多映射表（唯一真源）
  const fileChapterMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const m of mappings) {
      if (!map.has(m.fileId)) map.set(m.fileId, new Set());
      map.get(m.fileId)!.add(m.chapterId);
    }
    return map;
  }, [mappings]);

  // AI 自动匹配
  const {
    progress: classifyProgress,
    start: startClassify,
    cancel: cancelClassify,
  } = useClassifyFilesWithProgress();

  const classifySuccessMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    if (!classifyProgress.isRunning) return map;

    const dedup = new Set<string>();

    for (const result of classifyProgress.results) {
      if (!result.success || !result.chapterId) continue;
      const key = `${result.fileId}::${result.chapterId}`;
      if (dedup.has(key)) continue;
      dedup.add(key);

      if (!map.has(result.fileId)) map.set(result.fileId, new Set());
      map.get(result.fileId)!.add(result.chapterId);
    }

    return map;
  }, [classifyProgress.isRunning, classifyProgress.results]);

  const effectiveFileChapterMap = useMemo(() => {
    const map = new Map<string, Set<string>>();

    for (const [fileId, chapterIds] of fileChapterMap.entries()) {
      map.set(fileId, new Set(chapterIds));
    }

    for (const [fileId, chapterIds] of classifySuccessMap.entries()) {
      if (!map.has(fileId)) map.set(fileId, new Set());
      const target = map.get(fileId)!;
      chapterIds.forEach((chapterId) => target.add(chapterId));
    }

    return map;
  }, [fileChapterMap, classifySuccessMap]);

  const createFileMutation = useCreateFile();
  const deleteFileMutation = useDeleteFile();
  const batchOcrMutation = useBatchOcrExtract();
  const updateFileChapterMutation = useUpdateFileChapter();
  
  // 文档结构解析
  const {
    progress: parseProgress,
    start: startBatchParse,
    cancel: cancelParse,
    reset: resetParse,
  } = useBatchParseDocumentStructure();
  const matchSectionsMutation = useMatchSectionsToChapters();

  // State for chapter selector popover
  const [chapterSelectorFileId, setChapterSelectorFileId] = useState<string | null>(null);

  // Selected chapter for left-right panel view
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [hasInitializedChapter, setHasInitializedChapter] = useState(false);
  
  // 右侧面板 Tab: files=原始文件, sections=解析内容
  const [rightPanelTab, setRightPanelTab] = useState<"files" | "sections">("files");

  // Expanded parent chapters in sidebar
  const [expandedParentChapters, setExpandedParentChapters] = useState<Set<string>>(new Set());

  const [dataRoomDragOver, setDataRoomDragOver] = useState(false);
  const [previewFile, setPreviewFile] = useState<{
    name: string;
    storagePath: string;
    type: FileType;
    downloadUrl?: string;
  } | null>(null);
  const [wordPreviewHtml, setWordPreviewHtml] = useState<string | null>(null);
  const [isConvertingWord, setIsConvertingWord] = useState(false);
  const [isClearingAllFiles, setIsClearingAllFiles] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedRoomFile[]>([]);
  const [ocrProcessingIds, setOcrProcessingIds] = useState<Set<string>>(new Set());
  // 已成功提交给 Worker 正在处理中的文件 id（用于防止横幅重复显示）
  const [submittedToWorkerIds, setSubmittedToWorkerIds] = useState<Set<string>>(new Set());
  const [isPreparingOcr, setIsPreparingOcr] = useState(false);
  // 用户关闭失败提示 banner（仅隐藏横幅，文件行仍保留失败状态）
  const [dismissedFailedBanner, setDismissedFailedBanner] = useState(false);
  // 上一次失败文件数量，用于检测新失败时重新显示 banner
  const prevFailedCountRef = useRef(0);
  
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

  // Get chapter info by ID
  const getChapterById = useCallback((chapterId: string) => {
    return chapters.find(c => c.id === chapterId);
  }, [chapters]);

  // 检查文件是否已关联章节（基于 chapter_file_mappings）
  const isFileMappedToChapter = useCallback((fileId: string, chapterId: string): boolean => {
    return effectiveFileChapterMap.get(fileId)?.has(chapterId) ?? false;
  }, [effectiveFileChapterMap]);

  const chaptersHierarchy = useMemo(() => buildChapterHierarchy(chapters), [chapters]);

  const selectedChapterScopeIds = useMemo(() => {
    if (!selectedChapterId || selectedChapterId === "unassigned") return null;
    return chaptersHierarchy.descendantIdsByChapter.get(selectedChapterId) || new Set([selectedChapterId]);
  }, [chaptersHierarchy.descendantIdsByChapter, selectedChapterId]);

  // Get files for the selected chapter（基于 chapter_file_mappings）
  const selectedChapterFiles = useMemo(() => {
    if (!selectedChapterId) return [];
    if (selectedChapterId === 'unassigned') {
      return existingFiles.filter(f => !effectiveFileChapterMap.has(f.id));
    }

    const scopeIds = selectedChapterScopeIds || new Set([selectedChapterId]);
    return existingFiles.filter((file) => {
      const mapped = effectiveFileChapterMap.get(file.id);
      if (!mapped || mapped.size === 0) return false;
      for (const chapterId of mapped) {
        if (scopeIds.has(chapterId)) return true;
      }
      return false;
    });
  }, [selectedChapterId, selectedChapterScopeIds, existingFiles, effectiveFileChapterMap]);

  // Get selected chapter info
  const selectedChapter = useMemo(() => {
    if (!selectedChapterId || selectedChapterId === 'unassigned') return null;
    return chapters.find(c => c.id === selectedChapterId) || null;
  }, [selectedChapterId, chapters]);

  // 每个章节的解析内容数量
  const sectionCountByChapter = useMemo(() => {
    const countMap = new Map<string, number>();
    fileSections.forEach(section => {
      if (section.matched_chapter_id) {
        const count = countMap.get(section.matched_chapter_id) || 0;
        countMap.set(section.matched_chapter_id, count + 1);
      }
    });
    return countMap;
  }, [fileSections]);

  const aggregatedSectionCountByChapter = useMemo(() => {
    const countMap = new Map<string, number>();
    chapters.forEach((chapter) => {
      const scopeIds = chaptersHierarchy.descendantIdsByChapter.get(chapter.id) || new Set([chapter.id]);
      let total = 0;
      for (const id of scopeIds) {
        total += sectionCountByChapter.get(id) || 0;
      }
      countMap.set(chapter.id, total);
    });
    return countMap;
  }, [chapters, chaptersHierarchy.descendantIdsByChapter, sectionCountByChapter]);

  const aggregatedFileCountByChapter = useMemo(() => {
    const countMap = new Map<string, number>();
    chapters.forEach((chapter) => {
      const scopeIds = chaptersHierarchy.descendantIdsByChapter.get(chapter.id) || new Set([chapter.id]);
      const total = existingFiles.filter((file) => {
        const mapped = effectiveFileChapterMap.get(file.id);
        if (!mapped || mapped.size === 0) return false;
        for (const id of mapped) {
          if (scopeIds.has(id)) return true;
        }
        return false;
      }).length;
      countMap.set(chapter.id, total);
    });
    return countMap;
  }, [chapters, chaptersHierarchy.descendantIdsByChapter, existingFiles, effectiveFileChapterMap]);

  // 当前选中章节的解析内容
  const selectedChapterSections = useMemo(() => {
    if (!selectedChapterId || selectedChapterId === 'unassigned') return [];
    const scopeIds = selectedChapterScopeIds || new Set([selectedChapterId]);
    return fileSections.filter(s => !!s.matched_chapter_id && scopeIds.has(s.matched_chapter_id));
  }, [selectedChapterId, selectedChapterScopeIds, fileSections]);

  // Toggle parent chapter expansion
  const toggleParentChapter = useCallback((parentId: string) => {
    setExpandedParentChapters(prev => {
      const next = new Set(prev);
      if (next.has(parentId)) {
        next.delete(parentId);
      } else {
        next.add(parentId);
      }
      return next;
    });
  }, []);

  // Auto-select first chapter on initial load
  useEffect(() => {
    if (!hasInitializedChapter && chapters.length > 0) {
      // 基于 chapter_file_mappings 判断是否有未分配文件
      const hasUnassigned = existingFiles.some(f => !effectiveFileChapterMap.has(f.id));
      setSelectedChapterId(hasUnassigned ? 'unassigned' : chapters[0].id);
      setHasInitializedChapter(true);
    }
  }, [chapters, existingFiles, hasInitializedChapter, effectiveFileChapterMap]);

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

    // Create a stable fingerprint to detect actual changes from OCR/classification callbacks
    const currentFingerprint = existingFiles
      .map(f => `${f.id}:${f.updatedAt}:${f.ocrProcessed}:${f.ocrTaskStatus}`)
      .join(",");
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
            sizeBytes: f.sizeBytes,
            type: f.fileType,
            storagePath: f.storagePath,
            mimeType: f.mimeType,
            ocrProcessed: f.ocrProcessed,
            ocrTaskStatus: f.ocrTaskStatus,
            downloadUrl: localFile?.downloadUrl,
          };
        });
      setUploadedFiles(updatedFiles);
      // 将已到达终态（completed/failed/null）的文件从 submittedToWorkerIds 移除
      setSubmittedToWorkerIds(prev => {
        if (prev.size === 0) return prev;
        const next = new Set(prev);
        updatedFiles.forEach(f => {
          if (f.id && (f.ocrProcessed || f.ocrTaskStatus === "failed" || f.ocrTaskStatus === null || f.ocrTaskStatus === "completed")) {
            next.delete(f.id);
          }
        });
        return next.size === prev.size ? prev : next;
      });
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
      "doc", "docx", "xls", "xlsx",
    ].includes(ext);
  };

  // Get preview content type
  const getPreviewType = (fileName: string): "image" | "pdf" | "text" | "word" | "excel" | "unsupported" => {
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    if (["jpg", "jpeg", "png", "gif", "bmp", "webp"].includes(ext)) return "image";
    if (ext === "pdf") return "pdf";
    if (["txt", "html", "htm", "xml", "json", "csv"].includes(ext)) return "text";
    if (["doc", "docx"].includes(ext)) return "word";
    if (["xls", "xlsx"].includes(ext)) return "excel";
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
        downloadUrl = await getFileDownloadUrl(projectId, file.storagePath);
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

    // Reset Word preview state
    setWordPreviewHtml(null);
    
    // Set preview file
    setPreviewFile({
      ...file,
      downloadUrl,
    });
    
    // If it's a Word file, convert to HTML
    const previewType = getPreviewType(file.name);
    if (previewType === "word") {
      setIsConvertingWord(true);
      try {
        const response = await fetch(downloadUrl);
        const arrayBuffer = await response.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer });
        setWordPreviewHtml(result.value);
        if (result.messages.length > 0) {
          console.log("[FileUpload] Word conversion messages:", result.messages);
        }
      } catch (err) {
        console.error("[FileUpload] Word conversion error:", err);
        toast.error("Word 文件转换失败");
      } finally {
        setIsConvertingWord(false);
      }
    }
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

  // Handle clear all files
  const handleClearAllFiles = async () => {
    if (!currentProjectId || uploadedFiles.length === 0) return;
    
    setIsClearingAllFiles(true);
    setShowClearConfirm(false);
    
    const totalCount = uploadedFiles.length;
    let successCount = 0;
    let errorCount = 0;
    
    for (const file of uploadedFiles) {
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
        console.error("[FileUpload] Failed to delete file:", file.name, error);
        errorCount++;
      }
    }
    
    // 清空本地状态
    setUploadedFiles([]);
    setSelectedFiles(new Set());
    setIsClearingAllFiles(false);
    
    if (errorCount === 0) {
      toast.success(`已清除全部 ${successCount} 个文件`);
    } else {
      toast.warning(`清除完成: ${successCount}/${totalCount} 个文件成功，${errorCount} 个失败`);
    }
  };

  // Handle batch OCR extraction
  const handleBatchOcr = async (
    files: Array<{
      fileId: string;
      mimeType: string;
      fileName: string;
    }>,
    options?: { autoRedirect?: boolean; force?: boolean }
  ) => {
    if (files.length === 0) return;

    const fileIds = files.map(f => f.fileId);
    setOcrProcessingIds(prev => {
      const newSet = new Set(prev);
      fileIds.forEach(id => newSet.add(id));
      return newSet;
    });

    toast.info(`正在提交 ${files.length} 个文件到后台处理...`, { duration: 3000 });

    try {
      const result = await batchOcrMutation.mutateAsync({ files, force: options?.force ?? false });

      // 成功提交（含 already_processing）的文件标记为"Worker 处理中"，从 stuck 横幅移除
      const succeededIds = (result.results || [])
        .filter((r: { status: string; fileId: string }) => r.status === "queued" || r.status === "already_processing")
        .map((r: { fileId: string }) => r.fileId);
      if (succeededIds.length > 0) {
        setSubmittedToWorkerIds(prev => {
          const next = new Set(prev);
          succeededIds.forEach((id: string) => next.add(id));
          return next;
        });
      }

      if (result.submitted > 0) {
        const batchHint = result.batchCount > 1
          ? `，服务端已分 ${result.batchCount} 批提交`
          : "";
        toast.success(`已提交 ${result.submitted} 个文件到后台处理${batchHint}`);
      }
      if (result.alreadyProcessing > 0) {
        toast.info(`${result.alreadyProcessing} 个文件已在后台处理中`, { duration: 4000 });
      }
      if (result.skipped > 0) {
        toast.info(`${result.skipped} 个文件无需重复提取`, { duration: 4000 });
      }
      if (result.alreadyProcessing > 0) {
        toast.info(`${result.alreadyProcessing} 个文件已在后台处理中`, { duration: 4000 });
      }
      if (result.skipped > 0) {
        toast.info(`${result.skipped} 个文件无需重复提取`, { duration: 4000 });
      }

      if (result.failed > 0) {
        const uniqueErrors = [...new Set(result.errors || [])];
        const errorSummary = uniqueErrors.length > 0
          ? `（${uniqueErrors.slice(0, 2).join("；")}${uniqueErrors.length > 2 ? "等" : ""}）`
          : "";
        toast.warning(`${result.failed} 个文件提交失败${errorSummary}`, { duration: 5000 });
      }
    } catch (error) {
      console.error("[FileUpload] OCR batch processing error:", error);
      const errorMessage = error instanceof Error ? error.message : "未知错误";
      toast.error(`提交后台处理失败: ${errorMessage}`);
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
      mimeType: string;
      fileName: string;
    }> = [];

    for (const storagePath of selectedFiles) {
      const file = uploadedFiles.find(f => f.storagePath === storagePath);
      if (!file?.id || !file.mimeType || !canExtractFileText(file.mimeType, file.name)) continue;
      if (file.ocrProcessed || file.ocrTaskStatus === "pending" || file.ocrTaskStatus === "processing") continue;

      filesToProcess.push({
        fileId: file.id,
        mimeType: file.mimeType,
        fileName: file.name,
      });
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
    if (!file.id || !file.mimeType || !canExtractFileText(file.mimeType, file.name)) return;

    await handleBatchOcr([{
      fileId: file.id,
      mimeType: file.mimeType,
      fileName: file.name,
    }]);
  };

  // Handle retry all failed + stuck files
  const handleRetryAllFailed = async () => {
    // 合并 failed + stuck（pending/processing 但 worker 未收到）
    const allRetryFiles = [...failedOcrFiles, ...stuckOcrFiles];
    if (allRetryFiles.length === 0) return;

    const filesToRetry: Array<{
      fileId: string;
      mimeType: string;
      fileName: string;
    }> = [];

    for (const file of allRetryFiles) {
      if (!file?.id || !file.mimeType || !canExtractFileText(file.mimeType, file.name)) continue;
      filesToRetry.push({
        fileId: file.id,
        mimeType: file.mimeType,
        fileName: file.name,
      });
    }

    if (filesToRetry.length === 0) {
      toast.info("没有可重试的文件");
      return;
    }

    // force=true 确保 pending/processing 状态的文件也能重新入队
    await handleBatchOcr(filesToRetry, { force: true });
  };

  // 正在处理中的文件（processing — worker 已收到，等待回调）
  const processingOcrFiles = uploadedFiles.filter(
    f =>
      f.id &&
      f.mimeType &&
      canExtractFileText(f.mimeType, f.name) &&
      !f.ocrProcessed &&
      f.ocrTaskStatus === "processing" &&
      !ocrProcessingIds.has(f.id)
  );

  // 卡住的文件（pending 但没有本地追踪记录 → worker 未收到）
  // 排除：正在提交中（ocrProcessingIds）、刚成功提交给 worker 等待回调（submittedToWorkerIds）
  const stuckOcrFiles = uploadedFiles.filter(
    f =>
      f.id &&
      f.mimeType &&
      canExtractFileText(f.mimeType, f.name) &&
      !f.ocrProcessed &&
      f.ocrTaskStatus === "pending" &&
      !ocrProcessingIds.has(f.id) &&
      !submittedToWorkerIds.has(f.id)
  );

  // Count files needing extraction (failed + never tried, excluding currently processing)
  const unextractedOcrFiles = uploadedFiles.filter(
    f =>
      f.id &&
      f.mimeType &&
      canExtractFileText(f.mimeType, f.name) &&
      !f.ocrProcessed &&
      f.ocrTaskStatus !== "pending" &&
      f.ocrTaskStatus !== "processing" &&
      !ocrProcessingIds.has(f.id)
  );
  const failedOcrFiles = unextractedOcrFiles.filter(f => f.ocrTaskStatus === "failed");
  
  // 当有新的失败文件时，重新显示 banner
  useEffect(() => {
    const currentFailedCount = failedOcrFiles.length + stuckOcrFiles.length;
    if (currentFailedCount > prevFailedCountRef.current && currentFailedCount > 0) {
      setDismissedFailedBanner(false);
    }
    prevFailedCountRef.current = currentFailedCount;
  }, [failedOcrFiles.length, stuckOcrFiles.length]);
  
  // Handle extracting all unextracted files
  const handleExtractAllUnextracted = async () => {
    if (unextractedOcrFiles.length === 0) return;
    setIsPreparingOcr(true);
    toast.info(`正在准备 ${unextractedOcrFiles.length} 个文件...`);

    const filesToProcess: Array<{
      fileId: string;
      mimeType: string;
      fileName: string;
    }> = [];

    for (const file of unextractedOcrFiles) {
      if (!file.id || !file.mimeType) continue;

      filesToProcess.push({
        fileId: file.id,
        mimeType: file.mimeType,
        fileName: file.name,
      });
    }

    setIsPreparingOcr(false);

    if (filesToProcess.length === 0) {
      toast.error("没有可提交的文件，请稍后重试");
      return;
    }

    await handleBatchOcr(filesToProcess);
  };

  // 解析文档结构
  const handleParseStructure = useCallback(async () => {
    if (!currentProjectId) return;
    
    // 找出有 extractedText 的文件
    const parsableFiles = existingFiles.filter(f => 
      f.extractedText && f.extractedText.length > 100
    );
    
    if (parsableFiles.length === 0) {
      toast.error("没有可解析的文件", { 
        description: "请先提取文件文字内容" 
      });
      return;
    }
    
    toast.info(`开始解析 ${parsableFiles.length} 个文件的结构...`);
    
    await startBatchParse(
      parsableFiles.map(f => ({
        fileId: f.id,
        projectId: currentProjectId,
        extractedText: f.extractedText!,
        fileName: f.name,
      }))
    );
    
    // 解析完成后自动匹配章节
    if (chapters.length > 0) {
      toast.info("正在匹配章节...");
      try {
        await matchSectionsMutation.mutateAsync({ projectId: currentProjectId });
        toast.success("文档结构解析完成");
      } catch (err) {
        console.error("[FileUpload] Match sections error:", err);
        toast.warning("解析完成，但章节匹配失败");
      }
    }
  }, [currentProjectId, existingFiles, chapters, startBatchParse, matchSectionsMutation]);

  // AI 自动匹配文件到章节
  const handleAutoMatch = useCallback(async () => {
    if (!currentProjectId || chapters.length === 0) {
      toast.error("请先设置章节模板");
      return;
    }
    
    // 找出未分配章节且有文字内容的文件（基于 chapter_file_mappings）
    const unassignedFiles = existingFiles.filter(f => 
      !effectiveFileChapterMap.has(f.id) && (f.extractedText || f.textSummary)
    );
    
    if (unassignedFiles.length === 0) {
      toast.info("没有需要匹配的文件", {
        description: "所有文件已分配章节，或没有可分析的文字内容"
      });
      return;
    }
    
    toast.info(`开始智能匹配 ${unassignedFiles.length} 个文件...`);
    
    const result = await startClassify({
      projectId: currentProjectId,
      files: unassignedFiles.map(f => ({
        id: f.id,
        name: f.name,
        extractedText: f.extractedText || null,
        textSummary: f.textSummary || null,
      })),
      chapters: chapters.map(c => ({
        id: c.id,
        number: c.number || "",
        title: c.title,
        level: c.level,
        parentId: c.parentId,
      })),
    });
    
    if (result) {
      if (result.completed > 0) {
        toast.success(`成功匹配 ${result.completed} 个文件`);
      }
      if (result.failed > 0) {
        toast.warning(`${result.failed} 个文件匹配失败`);
      }
    }
  }, [currentProjectId, existingFiles, chapters, startClassify, effectiveFileChapterMap]);

  const handleRemoveFromSelectedScope = useCallback(async (fileId: string) => {
    if (!selectedChapterId || selectedChapterId === "unassigned") return;

    const scopeIds = selectedChapterScopeIds || new Set([selectedChapterId]);
    const mappedIds = effectiveFileChapterMap.get(fileId);
    if (!mappedIds || mappedIds.size === 0) return;

    const targetChapterIds = Array.from(mappedIds).filter((chapterId) => scopeIds.has(chapterId));
    if (targetChapterIds.length === 0) return;

    try {
      await Promise.all(
        targetChapterIds.map((chapterId) =>
          updateFileChapterMutation.mutateAsync({
            fileId,
            chapterId,
            action: "remove",
          })
        )
      );
    } catch (error) {
      console.error("[FileUpload] Failed to remove mappings in selected scope:", error);
      toast.error("移除失败，请重试");
    }
  }, [selectedChapterId, selectedChapterScopeIds, effectiveFileChapterMap, updateFileChapterMutation]);

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

      // Office Open XML files (.docx, .xlsx, .pptx) and ODF files are ZIP-based
      // but must NOT be treated as archives — check extension first
      const officeExtensions = [".docx", ".xlsx", ".pptx", ".dotx", ".xltx", ".potx", ".odt", ".ods", ".odp"];
      const fileExt = "." + file.name.split(".").pop()?.toLowerCase();
      const isOfficeFile = officeExtensions.includes(fileExt);

      let isArchive = !isOfficeFile && isArchiveFile(file);
      let archiveType: "zip" | "rar" | "7z" | null = null;

      if (!isArchive && !isOfficeFile && file.size > 0) {
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
          sizeBytes: file.size,
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
        .filter(r => r.success && r.fileId && r.mimeType && canExtractFileText(r.mimeType, r.file.name))
        .map(r => ({
          fileId: r.fileId!,
          mimeType: r.mimeType!,
          fileName: r.file.name,
        }));

      if (ocrCandidates.length > 0) {
        console.log(`[FileUpload] Auto-triggering OCR for ${ocrCandidates.length} files`);
        setTimeout(() => {
          handleBatchOcr(ocrCandidates);
        }, 500);
      }
    }
    if (failCount > 0) {
      toast.error(`${failCount} 个文件上传失败，请检查网络后重试`);
    }
  }, [currentProjectId, createFileMutation, handleBatchOcr, hasTemplate, navigate, projectId]);

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
      navigate(`/project/${projectId}/template`);
      return;
    }
    navigate(`/project/${projectId}/definitions`);
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
              onClick={() => navigate(`/project/${projectId}/template`)}
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
            onClick={() => navigate(`/project/${projectId}/template`)}
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
                  <div className="flex items-center gap-2">
                  {uploadedFiles.length > 0 && (
                    <>
                      <motion.span
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-emerald-100 text-emerald-700"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        {uploadedFiles.length} 个文件
                      </motion.span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px] text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setShowClearConfirm(true)}
                        disabled={isClearingAllFiles}
                      >
                        {isClearingAllFiles ? (
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        ) : (
                          <Trash2 className="w-3 h-3 mr-1" />
                        )}
                        清除全部
                      </Button>
                    </>
                  )}
                  </div>
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

                  {/* Processing Banner */}
                  {processingOcrFiles.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: -5 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-3"
                    >
                      <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                        <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-blue-900">
                          {processingOcrFiles.length} 个文件提取中
                        </div>
                        <div className="text-[11px] text-blue-700 mt-0.5">
                          正在后台提取文字，完成后自动更新
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {/* Failed / Stuck Extraction Banner */}
                  {(failedOcrFiles.length > 0 || stuckOcrFiles.length > 0) && !dismissedFailedBanner && (
                    <motion.div
                      initial={{ opacity: 0, y: -5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="mb-4 p-3 pr-8 bg-destructive/5 border border-destructive/20 rounded-lg flex items-center gap-3 relative"
                    >
                      {/* 关闭按钮 - 放在整个横幅的右上角 */}
                      <button
                        onClick={() => setDismissedFailedBanner(true)}
                        className="absolute -top-2 -right-2 p-1 bg-background border border-destructive/30 hover:bg-destructive/10 rounded-full transition-colors shadow-sm z-10"
                        title="关闭提示（文件行仍会显示失败状态）"
                      >
                        <X className="w-3 h-3 text-destructive" />
                      </button>
                      <div className="w-8 h-8 rounded-lg bg-destructive/10 flex items-center justify-center flex-shrink-0">
                        <AlertTriangle className="w-4 h-4 text-destructive" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-destructive">
                          {failedOcrFiles.length > 0 && `${failedOcrFiles.length} 个文件提取失败`}
                          {failedOcrFiles.length > 0 && stuckOcrFiles.length > 0 && "，"}
                          {stuckOcrFiles.length > 0 && `${stuckOcrFiles.length} 个任务未被处理`}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          点击"全部重试"强制重新提交，或在文件行单独重试
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

                  {/* Entity Recognition Banner */}
                  {/* Header with actions */}
                  <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      文件与章节对照
                    </div>
                    <Badge variant="secondary" className="text-[10px]">
                      {uploadedFiles.length} 个文件
                    </Badge>
                    {fileSections.length > 0 && (
                      <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-200">
                        <Link2 className="w-3 h-3 mr-1" />
                        {fileSections.length} 段解析内容
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-[11px]"
                      onClick={() => dataRoomInputRef.current?.click()}
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" />
                      添加文件
                    </Button>
                  </div>
                </div>
                  {/* Split Panel Layout: Left=章节目录, Right=文件列表 */}
                  <div
                    className="flex gap-4 h-[450px] border rounded-lg overflow-hidden"
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDataRoomDragOver(true);
                    }}
                    onDragLeave={() => setDataRoomDragOver(false)}
                    onDrop={handleDataRoomDrop}
                  >
                    {/* Left Panel: 章节目录 */}
                    <div className="w-[280px] flex-shrink-0 border-r bg-muted overflow-y-auto">
                      <div className="p-2 border-b bg-muted sticky top-0 z-10">
                        <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                          章节目录
                        </div>
                      </div>
                      <div className="p-1">
                        {/* Unassigned files section */}
                        {(() => {
                          const unassignedCount = existingFiles.filter(f => !effectiveFileChapterMap.has(f.id)).length;
                          const hasMatchableFiles = existingFiles.some(f => !effectiveFileChapterMap.has(f.id) && (f.extractedText || f.textSummary));
                          if (unassignedCount > 0) {
                            return (
                              <div className="mb-1">
                                <button
                                  onClick={() => setSelectedChapterId('unassigned')}
                                  className={cn(
                                    "w-full flex items-center gap-2 px-2 py-2 rounded text-left transition-colors",
                                    selectedChapterId === 'unassigned'
                                      ? "bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300"
                                      : "hover:bg-muted text-amber-700 dark:text-amber-400"
                                  )}
                                >
                                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                                  <span className="flex-1 text-[12px] font-medium truncate">未分配章节的文件</span>
                                  <Badge variant="secondary" className="text-[9px] h-4 bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200">
                                    {unassignedCount}
                                  </Badge>
                                </button>
                                {/* 自动匹配按钮 - 移到未分配章节数量旁边 */}
                                {chapters.length > 0 && hasMatchableFiles && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="w-full h-7 mt-1 text-[10px] text-blue-600 hover:bg-blue-50 justify-start px-2"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleAutoMatch();
                                    }}
                                    disabled={classifyProgress.isRunning}
                                  >
                                    {classifyProgress.isRunning ? (
                                      <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                                    ) : (
                                      <Brain className="w-3 h-3 mr-1.5" />
                                    )}
                                    {classifyProgress.isRunning 
                                      ? `匹配中 ${classifyProgress.completed}/${classifyProgress.total}` 
                                      : "自动匹配章节"}
                                  </Button>
                                )}
                              </div>
                            );
                          }
                          return null;
                        })()}

                        {/* Chapter list with hierarchy */}
                        {(() => {
                          const renderChapterNode = (chapter: Chapter, depth = 0): JSX.Element => {
                            const children = chaptersHierarchy.childrenMap.get(chapter.id) || [];
                            const hasChildren = children.length > 0;
                            const isExpanded = expandedParentChapters.has(chapter.id);
                            const isSelected = selectedChapterId === chapter.id;
                            const totalFileCount = aggregatedFileCountByChapter.get(chapter.id) || 0;
                            const totalSectionCount = aggregatedSectionCountByChapter.get(chapter.id) || 0;

                            return (
                              <div key={chapter.id} className="mb-0.5">
                                <div className="flex items-center" style={{ paddingLeft: `${depth * 14}px` }}>
                                  {hasChildren ? (
                                    <button
                                      onClick={() => toggleParentChapter(chapter.id)}
                                      className="p-1 hover:bg-muted rounded flex-shrink-0"
                                    >
                                      {isExpanded ? (
                                        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                                      ) : (
                                        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                                      )}
                                    </button>
                                  ) : (
                                    <span className="w-5 flex-shrink-0" />
                                  )}
                                  <button
                                    onClick={() => setSelectedChapterId(chapter.id)}
                                    className={cn(
                                      "flex-1 flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors",
                                      isSelected ? "bg-primary/10 text-primary" : "hover:bg-muted text-foreground"
                                    )}
                                  >
                                    <BookOpen
                                      className={cn(
                                        "w-3.5 h-3.5 flex-shrink-0",
                                        isSelected ? "text-primary" : "text-muted-foreground"
                                      )}
                                    />
                                    <span className="text-[10px] text-muted-foreground min-w-[28px] flex-shrink-0">
                                      {chapter.number || "-"}
                                    </span>
                                    <span className={cn("flex-1 truncate", depth === 0 ? "text-[12px] font-medium" : "text-[11px]")}>
                                      {chapter.title}
                                    </span>
                                    <div className="flex items-center gap-1">
                                      <Badge
                                        variant={totalFileCount > 0 ? "secondary" : "outline"}
                                        className={cn(
                                          "text-[9px] h-4 min-w-[18px] justify-center",
                                          totalFileCount === 0 && "text-muted-foreground"
                                        )}
                                        title="原始文件数（含子章节）"
                                      >
                                        {totalFileCount}
                                      </Badge>
                                      {totalSectionCount > 0 && (
                                        <Badge
                                          variant="outline"
                                          className="text-[9px] h-4 min-w-[18px] justify-center text-blue-600 border-blue-200"
                                          title="解析内容数（含子章节）"
                                        >
                                          {totalSectionCount}
                                        </Badge>
                                      )}
                                    </div>
                                  </button>
                                </div>

                                {hasChildren && isExpanded && (
                                  <div className="ml-5 border-l border-border/50 pl-1 mt-0.5">
                                    {children.map((child) => renderChapterNode(child, depth + 1))}
                                  </div>
                                )}
                              </div>
                            );
                          };

                          return chaptersHierarchy.rootChapters.map((chapter) => renderChapterNode(chapter));
                        })()}
                      </div>
                    </div>

                    {/* Right Panel: 文件列表 */}
                    <div className="flex-1 flex flex-col overflow-hidden">
                      {/* Right Panel Header */}
                      <div className="p-2 border-b bg-muted flex items-center justify-between sticky top-0 z-10">
                        <div className="flex items-center gap-2">
                          {selectedChapterId === 'unassigned' ? (
                            <>
                              <AlertTriangle className="w-4 h-4 text-amber-500" />
                              <span className="text-[12px] font-medium text-amber-700 dark:text-amber-400">
                                未分配章节的文件
                              </span>
                            </>
                          ) : selectedChapter ? (
                            <>
                              <BookOpen className="w-4 h-4 text-primary" />
                              <span className="text-[11px] text-muted-foreground">{selectedChapter.number}</span>
                              <span className="text-[12px] font-medium">{selectedChapter.title}</span>
                            </>
                          ) : (
                            <span className="text-[12px] text-muted-foreground">请从左侧选择章节查看文件</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {selectedChapterId && selectedChapterId !== 'unassigned' && (
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button variant="outline" size="sm" className="h-6 text-[10px]">
                                  <Plus className="w-3 h-3 mr-1" />
                                  添加文件
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-80 p-0" align="end">
                                <div className="p-2 border-b bg-muted/30">
                                  <div className="text-[11px] font-medium">选择要添加的文件</div>
                                  <div className="text-[10px] text-muted-foreground">将文件添加到当前章节</div>
                                </div>
                                <Command>
                                  <CommandInput placeholder="搜索文件..." />
                                  <CommandList className="max-h-[250px]">
                                    <CommandEmpty>没有可添加的文件</CommandEmpty>
                                    <CommandGroup>
                                      {uploadedFiles
                                        .filter(f => f.id && selectedChapterId && !isFileMappedToChapter(f.id, selectedChapterId))
                                        .map((file) => (
                                          <CommandItem
                                            key={file.id}
                                            value={file.name}
                                            onSelect={() => {
                                              if (file.id && selectedChapterId && selectedChapterId !== 'unassigned') {
                                                updateFileChapterMutation.mutate({ fileId: file.id, chapterId: selectedChapterId, action: "add" });
                                              }
                                            }}
                                            className="flex items-center gap-2 cursor-pointer"
                                          >
                                            {getFileIcon(file.name)}
                                            <span className="flex-1 truncate text-[12px]">{file.name}</span>
                                            <span className="text-[10px] text-muted-foreground">{file.type}</span>
                                          </CommandItem>
                                        ))}
                                    </CommandGroup>
                                  </CommandList>
                                </Command>
                              </PopoverContent>
                            </Popover>
                          )}
                          {/* Tab 切换 */}
                          {selectedChapterId && selectedChapterId !== 'unassigned' && (
                            <div className="flex items-center gap-1 border rounded-md p-0.5 bg-muted/50">
                              <button
                                onClick={() => setRightPanelTab("files")}
                                className={cn(
                                  "px-2 py-0.5 rounded text-[10px] transition-colors",
                                  rightPanelTab === "files"
                                    ? "bg-background shadow-sm font-medium"
                                    : "text-muted-foreground hover:text-foreground"
                                )}
                              >
                                文件 ({selectedChapterFiles.length})
                              </button>
                              <button
                                onClick={() => setRightPanelTab("sections")}
                                className={cn(
                                  "px-2 py-0.5 rounded text-[10px] transition-colors",
                                  rightPanelTab === "sections"
                                    ? "bg-background shadow-sm font-medium text-blue-600"
                                    : "text-muted-foreground hover:text-foreground"
                                )}
                              >
                                解析内容 ({selectedChapterSections.length})
                              </button>
                            </div>
                          )}
                          {selectedChapterId === 'unassigned' && (
                            <Badge variant="outline" className="text-[10px]">
                              {selectedChapterFiles.length} 个文件
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Content Area */}
                      <div className="flex-1 overflow-y-auto">
                        {!selectedChapterId ? (
                          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                            <FolderOpen className="w-12 h-12 mb-2 opacity-30" />
                            <p className="text-[13px]">请从左侧选择章节</p>
                            <p className="text-[11px] mt-1">查看该章节下的文件列表</p>
                          </div>
                        ) : rightPanelTab === "sections" && selectedChapterId !== 'unassigned' ? (
                          /* 解析内容 Tab */
                          selectedChapterSections.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                              <FileSearch className="w-12 h-12 mb-2 opacity-30" />
                              <p className="text-[13px]">该章节暂无解析内容</p>
                              <p className="text-[11px] mt-1">请先上传文件并点击"解析结构"</p>
                            </div>
                          ) : (
                            <div className="divide-y">
                              {selectedChapterSections.map((section) => (
                                <div
                                  key={section.id}
                                  className="p-3 hover:bg-muted/30"
                                >
                                  <div className="flex items-center gap-2 mb-2">
                                    <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-200">
                                      {section.file?.name || "未知文件"}
                                    </Badge>
                                    <span className="text-[10px] text-muted-foreground">
                                      第 {section.order_index + 1} 段
                                    </span>
                                    {section.match_confidence && (
                                      <Badge variant="secondary" className="text-[9px]">
                                        匹配度 {section.match_confidence}%
                                      </Badge>
                                    )}
                                  </div>
                                  <h4 className="text-[13px] font-medium mb-1">
                                    {section.title}
                                  </h4>
                                  {section.content && (
                                    <p className="text-[12px] text-muted-foreground line-clamp-3">
                                      {section.content.substring(0, 300)}
                                      {section.content.length > 300 && "..."}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          )
                        ) : selectedChapterFiles.length === 0 ? (
                          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                            <FileText className="w-12 h-12 mb-2 opacity-30" />
                            <p className="text-[13px]">该章节暂无文件</p>
                            <p className="text-[11px] mt-1">可以通过自动匹配或手动添加文件</p>
                          </div>
                        ) : (
                          <div className="divide-y">
                        {/* Table Header */}
                        <div className="flex items-center gap-2 px-3 py-2 bg-muted text-[10px] text-muted-foreground uppercase tracking-wider sticky top-0 z-10">
                              <span className="flex-1">文件名称</span>
                              <span className="w-16 text-center">类型</span>
                              <span className="w-20 text-right">大小</span>
                              <span className="w-32 text-center">操作</span>
                            </div>
                            {selectedChapterFiles.map((file) => {
                              const isFailed = file.ocrTaskStatus === "failed" && !ocrProcessingIds.has(file.id!);
                              const isUnsupported = isLegacyOfficeFormat(file.name);
                              return (
                              <div
                                key={file.storagePath}
                                className={cn(
                                  "flex items-center gap-2 px-3 py-2 text-[13px] group transition-colors relative",
                                  isFailed 
                                    ? "bg-red-50/70 hover:bg-red-50" 
                                    : "hover:bg-muted/30"
                                )}
                              >
                                {/* Remove from current chapter - positioned at top-right of the entire row */}
                                {selectedChapterId && selectedChapterId !== 'unassigned' && file.id && (
                                  <button
                                    onClick={() => void handleRemoveFromSelectedScope(file.id!)}
                                    className="absolute -top-1 -right-1 p-1 hover:bg-destructive/10 rounded-full opacity-0 group-hover:opacity-100 transition-opacity bg-background border border-border shadow-sm z-10"
                                    title="从当前章节范围移除"
                                  >
                                    <X className="w-3 h-3 text-destructive" />
                                  </button>
                                )}
                                {getFileIcon(file.name)}
                                <span className="flex-1 truncate" title={file.name}>{file.name}</span>
                                
                                {/* OCR Task Status Indicator */}
                                {isUnsupported ? (
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-help">
                                          <Info className="w-3 h-3" />
                                          <span>不支持</span>
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent side="top" className="max-w-[200px] text-[11px]">
                                        <p>老版本 Office 格式（.doc/.xls/.ppt）不支持提取</p>
                                        <p className="text-muted-foreground mt-1">请转换为 .docx/.xlsx/.pptx 后重新上传</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                ) : file.ocrTaskStatus === "pending" || file.ocrTaskStatus === "processing" ? (
                                  <span className="flex items-center gap-1 text-[10px] text-blue-600" title="正在后台处理中">
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    <span>处理中</span>
                                  </span>
                                ) : isFailed ? (
                                  <div className="flex items-center gap-1.5">
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span className="flex items-center gap-1 text-[10px] text-red-500 cursor-help">
                                            <AlertTriangle className="w-3 h-3" />
                                            <span>提取失败</span>
                                          </span>
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="max-w-[240px] text-[11px]">
                                          <p className="font-medium text-red-600">文件内容提取失败</p>
                                          <p className="text-muted-foreground mt-1">可能原因：文件损坏、格式不兼容或服务器繁忙</p>
                                          <p className="text-muted-foreground mt-1">点击"重试"按钮重新提取</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                    <button
                                      onClick={() => {
                                        const fileToRetry = {
                                          fileId: file.id!,
                                          fileName: file.name,
                                          mimeType: file.mimeType || "application/octet-stream",
                                        };
                                        handleBatchOcr([fileToRetry], { force: true });
                                      }}
                                      className="flex items-center gap-0.5 text-[10px] text-red-500 hover:text-red-700 hover:bg-red-100 px-1.5 py-0.5 rounded transition-colors"
                                      title="点击重新提取"
                                      disabled={ocrProcessingIds.has(file.id!)}
                                    >
                                      <RefreshCw className="w-3 h-3" />
                                      <span>重试</span>
                                    </button>
                                  </div>
                                ) : file.ocrProcessed ? (
                                  <span className="flex items-center gap-1 text-[10px] text-green-600" title="已完成文字提取">
                                    <CheckCircle className="w-3 h-3" />
                                  </span>
                                ) : null}

                                <span className="w-16 text-center text-[10px] text-muted-foreground px-1.5 py-0.5 bg-muted rounded">
                                  {file.type}
                                </span>
                                <span className="w-20 text-right text-[10px] text-muted-foreground font-mono">
                                  {formatFileSize(file.sizeBytes)}
                                </span>

                                {/* File Actions */}
                                <div className="w-32 flex items-center justify-center gap-0.5">
                                  {/* Preview */}
                                  <button
                                    onClick={() => handlePreviewFile(file)}
                                    className="p-1.5 hover:bg-muted rounded"
                                    title="预览"
                                  >
                                    <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                                  </button>

                                  {/* Download */}
                                  <button
                                    onClick={async () => {
                                      let url = file.downloadUrl;
                                      if (!url) {
                                        try {
                                          url = await getFileDownloadUrl(projectId, file.storagePath);
                                        } catch (error) {
                                          toast.error("获取下载链接失败");
                                          return;
                                        }
                                      }
                                      if (url) window.open(url, "_blank");
                                    }}
                                    className="p-1.5 hover:bg-muted rounded"
                                    title="下载"
                                  >
                                    <Download className="w-3.5 h-3.5 text-muted-foreground" />
                                  </button>

                                  {/* Edit Chapter Assignment */}
                                  {file.id && (
                                    <Popover>
                                      <PopoverTrigger asChild>
                                        <button
                                          className="p-1.5 hover:bg-primary/10 rounded"
                                          title="关联章节"
                                        >
                                          <BookOpen className="w-3.5 h-3.5 text-primary" />
                                        </button>
                                      </PopoverTrigger>
                                      <PopoverContent className="w-72 p-0" align="end">
                                        <div className="p-2 border-b bg-muted/30">
                                          <div className="text-[11px] font-medium">关联章节</div>
                                          <div className="text-[10px] text-muted-foreground truncate">{file.name}</div>
                                        </div>
                                        <Command>
                                          <CommandInput placeholder="搜索章节..." />
                                          <CommandList className="max-h-[200px]">
                                            <CommandEmpty>未找到章节</CommandEmpty>
                                            <CommandGroup>
                                              {chapters.map((chapter) => {
                                                const isMapped = isFileMappedToChapter(file.id!, chapter.id);
                                                return (
                                                  <CommandItem
                                                    key={chapter.id}
                                                    value={chapter.number && chapter.number !== chapter.title ? `${chapter.number} ${chapter.title}` : chapter.title}
                                                    onSelect={() => {
                                                      if (!file.id) return;
                                                      updateFileChapterMutation.mutate({
                                                        fileId: file.id,
                                                        chapterId: chapter.id,
                                                        action: isMapped ? "remove" : "add",
                                                      });
                                                    }}
                                                    className="flex items-center gap-2 cursor-pointer"
                                                  >
                                                    <Checkbox checked={isMapped} className="w-3.5 h-3.5" />
                                                    <span className="text-[11px] text-muted-foreground min-w-[32px]">
                                                      {chapter.number || "-"}
                                                    </span>
                                                    <span className="flex-1 truncate text-[12px]">
                                                      {chapter.title}
                                                    </span>
                                                    {isMapped && <Check className="w-3.5 h-3.5 text-primary" />}
                                                  </CommandItem>
                                                );
                                              })}
                                            </CommandGroup>
                                          </CommandList>
                                        </Command>
                                      </PopoverContent>
                                    </Popover>
                                  )}

                                  {/* Delete file */}
                                  <button
                                    onClick={() => handleDeleteFile(file)}
                                    className="p-1.5 hover:bg-destructive/10 rounded"
                                    title="删除文件"
                                    disabled={deleteFileMutation.isPending}
                                  >
                                    <Trash2 className="w-3.5 h-3.5 text-destructive/70 hover:text-destructive" />
                                  </button>
                                </div>
                              </div>
                            );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Clear All Files Confirm Dialog */}
      <Dialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" />
              确认清除全部文件
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground mb-4">
              此操作将删除数据室中的所有 {uploadedFiles.length} 个文件，删除后无法恢复。
            </p>
            <p className="text-sm text-muted-foreground">
              确定要继续吗？
            </p>
          </div>
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => setShowClearConfirm(false)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handleClearAllFiles}
              disabled={isClearingAllFiles}
            >
              {isClearingAllFiles ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  清除中...
                </>
              ) : (
                "确认清除"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
                  <div className="flex flex-col h-full">
                    <iframe
                      src={url}
                      className="w-full h-[60vh] rounded-lg border"
                      title={previewFile.name}
                      onError={() => {
                        console.log("[v0] PDF iframe failed to load");
                      }}
                    />
                    <div className="text-center text-[11px] text-muted-foreground mt-2">
                      如果预览加载失败，请点击下方"下载文件"按钮查看
                    </div>
                  </div>
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
              
              // Word 文档预览
              if (previewType === "word") {
                if (isConvertingWord) {
                  return (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <Loader2 className="w-12 h-12 mb-4 animate-spin text-primary" />
                      <p>正在转换 Word 文档...</p>
                    </div>
                  );
                }
                
                if (wordPreviewHtml) {
                  return (
                    <div className="bg-white border rounded-lg p-6 max-h-[60vh] overflow-auto">
                      <div 
                        className="prose prose-sm max-w-none word-preview"
                        dangerouslySetInnerHTML={{ __html: wordPreviewHtml }}
                        style={{
                          fontSize: '12pt',
                          lineHeight: 1.6,
                        }}
                      />
                    </div>
                  );
                }
                
                return (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <AlertTriangle className="w-12 h-12 mb-4 text-amber-500" />
                    <p className="mb-4">Word 文件转换失败</p>
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
              }
              
              // Excel 预览提示
              if (previewType === "excel") {
                return (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <FileSpreadsheet className="w-16 h-16 mb-4 text-green-600" />
                    <p className="mb-4">Excel 文件暂不支持在线预览</p>
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
