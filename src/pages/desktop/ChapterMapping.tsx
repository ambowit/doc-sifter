import { useState, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useLatestGeneratedReport } from "@/hooks/useGeneratedReports";
import { useProject } from "@/hooks/useProjects";
import { useChapters, flattenChaptersWithNumbers, type Chapter } from "@/hooks/useChapters";
import {
  useFiles,
  useClassifyFilesWithProgress,
  useUpdateFileChapter,
  formatFileSize,
  type UploadedFile,
} from "@/hooks/useFiles";
import { useMappings } from "@/hooks/useMappings";
import { AIClassifyDialog } from "@/components/AIClassifyDialog";
import { useReportJob } from "@/hooks/useReportJob";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Brain,
  ChevronRight,
  FileQuestion,
  FileText,
  FolderOpen,
  GripVertical,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";

// ── 拖拽状态 ──────────────────────────────────────────────
interface DragState {
  fileId: string;
  sourceChapterId: string | null;
}

type NumberedChapter = Chapter & { number: string };

function collectLeafChapters(chapter: Chapter): Chapter[] {
  if (!chapter.children || chapter.children.length === 0) {
    return [chapter];
  }

  return chapter.children.flatMap((child) => collectLeafChapters(child));
}

export default function ChapterMapping() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const { data: project } = useProject(projectId);
  const { data: chaptersTree = [] } = useChapters(projectId);
  const flatChapters = flattenChaptersWithNumbers(chaptersTree);
  const { data: files = [], isLoading: filesLoading } = useFiles(projectId);
  const { data: mappings = [] } = useMappings(projectId);
  const { data: latestReport } = useLatestGeneratedReport(projectId);

  const { progress: classifyProgress, start: startClassify, pause: pauseClassify, resume: resumeClassify, cancel: cancelClassify, reset: resetClassify } = useClassifyFilesWithProgress();
  const updateChapterMutation = useUpdateFileChapter();
  const [showClassifyDialog, setShowClassifyDialog] = useState(false);

  // 异步报告生成
  const {
    job: reportJob,
    isCreating: isCreatingJob,
    createJob,
    cancelJob,
    reset: resetJob,
  } = useReportJob({
    projectId: projectId || "",
    onSuccess: () => {
      toast.success("报告生成成功");
      navigate(`/project/${projectId}/preview`);
    },
    onError: (errorMessage) => {
      toast.error(errorMessage || "报告生成失败，请重试");
    },
  });

  const jobIsRunning = isCreatingJob || (reportJob?.status === "running" || reportJob?.status === "queued");

  const handleStart = async () => {
    if (!projectId) return;
    await createJob();
  };

  const handleCancelJob = () => {
    cancelJob();
    resetJob();
    toast.info("已取消报告生成");
  };

  // ── AI 分类 ──────────────────────────────────────────────
  const handleOpenClassifyDialog = () => {
    if (!projectId || !files.length || !flatChapters.length) return;
    setShowClassifyDialog(true);
  };

  const handleStartClassify = async () => {
    if (!projectId) return;
    const result = await startClassify({
      projectId,
      files: files.map((f) => ({
        id: f.id,
        name: f.name,
        extractedText: f.extractedText,
        textSummary: f.textSummary,
      })),
      chapters: flatChapters.map((c) => ({
        id: c.id,
        number: c.number || "",
        title: c.title,
        level: c.level,
        parentId: c.parentId,
      })),
    });
    if (result) {
      toast.success(`AI 分类完成，${result.completed} 个成功，${result.failed} 个失败`);
    }
  };

  // ── 拖拽逻辑 ──────────────────────────────────────────────
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragOverChapterId, setDragOverChapterId] = useState<string | null | "unassigned">(null);
  const [expandedChapterIds, setExpandedChapterIds] = useState<Set<string>>(new Set());

  const handleDragStart = (fileId: string, sourceChapterId: string | null) => {
    setDragState({ fileId, sourceChapterId });
  };

  const handleDragEnd = () => {
    setDragState(null);
    setDragOverChapterId(null);
  };

  const handleDrop = async (targetChapterId: string | null) => {
    if (!dragState || !projectId) return;
    if (dragState.sourceChapterId === targetChapterId) return;
    try {
      await updateChapterMutation.mutateAsync({
        fileId: dragState.fileId,
        chapterId: targetChapterId,
        projectId,
      });
    } catch {
      toast.error("移动失败，请重试");
    } finally {
      setDragState(null);
      setDragOverChapterId(null);
    }
  };

  // ── 按章节分组文件 ──────────────────────────────────────
  // 建立快速查找 Map：fileId -> Set of chapterIds
  const fileToChapters = useMemo(() => {
    const map = new Map<string, Set<string>>();
    mappings.forEach((m) => {
      if (!map.has(m.fileId)) map.set(m.fileId, new Set());
      map.get(m.fileId)?.add(m.chapterId);
    });
    return map;
  }, [mappings]);

  const rootChapters = useMemo(() => {
    const roots = chaptersTree.filter((c) => c.level === 1);
    if (roots.length > 0) return roots;
    return chaptersTree;
  }, [chaptersTree]);

  const chapterNumberById = useMemo(() => {
    const map = new Map<string, string>();
    flatChapters.forEach((chapter) => {
      map.set(chapter.id, chapter.number || "");
    });
    return map;
  }, [flatChapters]);

  const leafGroups = useMemo(() => {
    return rootChapters
      .map((root) => {
        const leaves = collectLeafChapters(root).map((leaf) => ({
          ...leaf,
          number: chapterNumberById.get(leaf.id) || "",
        }));
        return {
          root: {
            ...root,
            number: chapterNumberById.get(root.id) || "",
          } as NumberedChapter,
          leaves: leaves as NumberedChapter[],
        };
      })
      .filter((group) => group.leaves.length > 0);
  }, [chapterNumberById, rootChapters]);

  const leafFileCountMap = useMemo(() => {
    const map = new Map<string, number>();
    leafGroups.forEach((group) => {
      group.leaves.forEach((leaf) => {
        const count = files.filter((file) => fileToChapters.get(file.id)?.has(leaf.id)).length;
        map.set(leaf.id, count);
      });
    });
    return map;
  }, [fileToChapters, files, leafGroups]);

  const filesByLeaf = useMemo(() => {
    const map = new Map<string, UploadedFile[]>();
    leafGroups.forEach((group) => {
      group.leaves.forEach((leaf) => {
        const leafFiles = files.filter((file) => fileToChapters.get(file.id)?.has(leaf.id));
        map.set(leaf.id, leafFiles);
      });
    });
    return map;
  }, [fileToChapters, files, leafGroups]);

  const rootGroupFileCountMap = useMemo(() => {
    const map = new Map<string, number>();
    leafGroups.forEach((group) => {
      const count = files.filter((file) => {
        const mapped = fileToChapters.get(file.id);
        if (!mapped || mapped.size === 0) return false;
        for (const leaf of group.leaves) {
          if (mapped.has(leaf.id)) return true;
        }
        return false;
      }).length;
      map.set(group.root.id, count);
    });
    return map;
  }, [fileToChapters, files, leafGroups]);

  const unassignedFiles = files.filter((f) => !fileToChapters.has(f.id));
  const classifiedCount = files.filter((f) => fileToChapters.has(f.id)).length;

  return (
    <div className="h-full flex flex-col bg-background">
      {/* 顶部栏 */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <FolderOpen className="w-4 h-4 text-muted-foreground" />
          <span className="font-semibold text-sm">{project?.name ?? "数据室资料分类"}</span>
          <Badge variant="outline" className="text-[10px] h-5">
            {files.length} 个文件
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1.5"
            disabled={classifyProgress.isRunning || !files.length || !flatChapters.length}
            onClick={handleOpenClassifyDialog}
          >
            {classifyProgress.isRunning ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            {classifyProgress.isRunning ? `分类中 ${classifyProgress.current}/${classifyProgress.total}` : "AI 自动分类"}
          </Button>
          {latestReport && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => navigate(`/project/${projectId}/preview`)}
            >
              查看报告
            </Button>
          )}
          <Button
            size="sm"
            className="h-8 text-xs gap-1.5"
            disabled={jobIsRunning}
            onClick={handleStart}
          >
            {jobIsRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5" />}
            {jobIsRunning ? "生成中..." : "生成报告"}
          </Button>
        </div>
      </div>

      {/* 主体：左侧文件分类 + 右侧章节结构/任务进度 */}
      <div className="flex-1 grid grid-cols-[1fr_280px] overflow-hidden">

        {/* 左侧：文件分类区 */}
        <div className="flex flex-col border-r border-border overflow-hidden h-full">
          <div className="px-4 py-2 border-b border-border bg-muted/20 flex items-center justify-between flex-shrink-0">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              资料分类
            </span>
            <span className="text-[11px] text-muted-foreground">
              {classifiedCount}/{files.length} 已分类
            </span>
          </div>

          <ScrollArea className="flex-1 min-h-0">
            <div className="p-2 space-y-2">
              {filesLoading && (
                <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">加载文件...</span>
                </div>
              )}

              {/* 未分类文件桶 - 只在有未分类文件时显示 */}
              {unassignedFiles.length > 0 && (
                <ChapterBucket
                  chapterId={null}
                  label="未分类文件"
                  files={unassignedFiles}
                  isDragOver={dragOverChapterId === "unassigned"}
                  isDragging={!!dragState}
                  onDragOver={() => setDragOverChapterId("unassigned")}
                  onDragLeave={() => setDragOverChapterId(null)}
                  onDrop={() => handleDrop(null)}
                  onFileDragStart={(fileId) => handleDragStart(fileId, null)}
                  onFileDragEnd={handleDragEnd}
                  projectId={projectId!}
                  variant="unassigned"
                  disabled={jobIsRunning}
                />
              )}

              {/* 父章节分组 + 叶子章节桶 */}
              {leafGroups.map((group) => (
                <div key={group.root.id} className="space-y-1.5">
                  <div className="px-2 py-1 rounded bg-muted/30 border border-border/40 flex items-center justify-between">
                    <span className="text-[10px] font-medium text-muted-foreground truncate">
                      {group.root.number && group.root.number !== group.root.title
                        ? `${group.root.number}、${group.root.title}`
                        : group.root.title}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{rootGroupFileCountMap.get(group.root.id) ?? 0}</span>
                  </div>

                  {group.leaves.map((leaf) => (
                    <ChapterBucket
                      key={leaf.id}
                      chapterId={leaf.id}
                      label={leaf.number && leaf.number !== leaf.title ? `${leaf.number}、${leaf.title}` : leaf.title}
                      files={filesByLeaf.get(leaf.id) || []}
                      isDragOver={dragOverChapterId === leaf.id}
                      isDragging={!!dragState}
                      onDragOver={() => setDragOverChapterId(leaf.id)}
                      onDragLeave={() => setDragOverChapterId(null)}
                      onDrop={() => handleDrop(leaf.id)}
                      onFileDragStart={(fileId) => handleDragStart(fileId, leaf.id)}
                      onFileDragEnd={handleDragEnd}
                      projectId={projectId!}
                      disabled={jobIsRunning}
                    />
                  ))}
                </div>
              ))}

              {!filesLoading && files.length === 0 && (
                <div className="text-center py-16">
                  <FileQuestion className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">暂无文件，请先上传资料</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* 右侧：章节结构 + 生成中提示 */}
        <div className="flex flex-col overflow-hidden">
          {/* AI 生成进度面板 */}
          {jobIsRunning && reportJob && (
            <div className="border-b border-border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500 flex-shrink-0" />
                  <span className="text-[11px] text-blue-700 font-medium">
                    {reportJob.currentStage === "queued" ? "等待处理..." : "AI 正在生成报告"}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px] text-muted-foreground hover:text-destructive"
                  onClick={handleCancelJob}
                >
                  <X className="w-3 h-3 mr-1" />
                  取消
                </Button>
              </div>
              <Progress value={reportJob.progress} className="h-1.5" />
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>{reportJob.progressMessage || "处理中..."}</span>
                <span>{reportJob.processedChapters}/{reportJob.totalChapters} 章节</span>
              </div>
            </div>
          )}

          {/* 章节结构 */}
          <div className="px-3 py-2 border-b border-border bg-muted/20 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">章节结构</span>
	            <span className="text-[11px] text-muted-foreground">{leafGroups.reduce((sum, g) => sum + g.leaves.length, 0)} 叶子章节</span>
	          </div>
	          <ScrollArea className="flex-1">
	            <div className="p-2 space-y-0.5">
              {leafGroups.map((group) => {
                const isExpanded = expandedChapterIds.has(group.root.id);
                return (
                  <div key={group.root.id} className="mb-1">
                    <div className="flex items-center gap-1.5 py-1 px-2 rounded text-[11px] hover:bg-muted/40 font-medium">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setExpandedChapterIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(group.root.id)) {
                              next.delete(group.root.id);
                            } else {
                              next.add(group.root.id);
                            }
                            return next;
                          });
                        }}
                        className="p-0.5 hover:bg-muted rounded"
                      >
                        <ChevronRight
                          className={cn(
                            "w-3 h-3 flex-shrink-0 text-muted-foreground/50 transition-transform",
                            isExpanded && "rotate-90"
                          )}
                        />
                      </button>
                      <span className="truncate">
                        {group.root.number && group.root.number !== group.root.title ? `${group.root.number}、${group.root.title}` : group.root.title}
                      </span>
                      <span className="ml-auto text-[10px] text-muted-foreground/60 flex-shrink-0">
                        {rootGroupFileCountMap.get(group.root.id) ?? 0}
                      </span>
                    </div>

                    {isExpanded && (
                      <div className="ml-5 space-y-0.5">
                        {group.leaves.map((leaf) => (
                          <div
                            key={leaf.id}
                            className="flex items-center gap-1.5 py-1 px-2 rounded text-[11px] text-muted-foreground hover:bg-muted/40"
                          >
                            <span className="w-4 h-4 flex-shrink-0" />
                            <span className="truncate">
                              {leaf.number && leaf.number !== leaf.title ? `${leaf.number}、${leaf.title}` : leaf.title}
                            </span>
                            <span className="ml-auto text-[10px] text-muted-foreground/60 flex-shrink-0">
                              {leafFileCountMap.get(leaf.id) ?? 0}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
	              {leafGroups.length === 0 && (
	                <div className="text-center py-8">
	                  <FileQuestion className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
	                  <p className="text-[11px] text-muted-foreground">暂无章节</p>
	                </div>
	              )}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* AI 分类进度弹窗 */}
      <AIClassifyDialog
        open={showClassifyDialog}
        onOpenChange={setShowClassifyDialog}
        progress={classifyProgress}
        onStart={handleStartClassify}
        onPause={pauseClassify}
        onResume={resumeClassify}
        onCancel={cancelClassify}
        onReset={resetClassify}
        fileCount={files.length}
      />
    </div>
  );
}

// ── ChapterBucket 组件 ────────────────────────────────────
interface ChapterBucketProps {
  chapterId: string | null;
  label: string;
  files: UploadedFile[];
  isDragOver: boolean;
  isDragging: boolean;
  onDragOver: () => void;
  onDragLeave: () => void;
  onDrop: () => void;
  onFileDragStart: (fileId: string) => void;
  onFileDragEnd: () => void;
  projectId: string;
  variant?: "default" | "unassigned";
  disabled?: boolean;
}

function ChapterBucket({
  chapterId,
  label,
  files,
  isDragOver,
  isDragging,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileDragStart,
  onFileDragEnd,
  projectId,
  variant = "default",
  disabled = false,
}: ChapterBucketProps) {
  const updateChapterMutation = useUpdateFileChapter();

  const handleRemoveFile = async (fileId: string) => {
    try {
      await updateChapterMutation.mutateAsync({ fileId, chapterId: null, projectId });
    } catch {
      toast.error("移除失败");
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg border transition-colors",
        variant === "unassigned" ? "border-dashed border-muted-foreground/30 bg-muted/5" : "border-border bg-card",
        isDragOver && !disabled && "border-primary/60 bg-primary/5",
        isDragging && !isDragOver && !disabled && "border-dashed",
        disabled && "opacity-60 pointer-events-none"
      )}
      onDragOver={(e) => { if (disabled) return; e.preventDefault(); onDragOver(); }}
      onDragLeave={() => { if (disabled) return; onDragLeave(); }}
      onDrop={(e) => { if (disabled) return; e.preventDefault(); onDrop(); }}
    >
      {/* 桶头部 */}
      <div className={cn(
        "flex items-center justify-between px-2.5 py-1.5 border-b",
        variant === "unassigned" ? "border-muted-foreground/10" : "border-border/60"
      )}>
        <div className="flex items-center gap-1.5 min-w-0">
          <FolderOpen className={cn("w-3 h-3 flex-shrink-0", variant === "unassigned" ? "text-muted-foreground/50" : "text-muted-foreground")} />
          <span className={cn(
            "text-[10px] font-medium truncate",
            variant === "unassigned" && "text-muted-foreground"
          )}>
            {label}
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground ml-2 flex-shrink-0">{files.length}</span>
      </div>

      {/* 文件列表 */}
      <div className={cn("p-1 space-y-0.5", variant === "unassigned" ? "min-h-[28px]" : "min-h-[32px]", files.length === 0 && isDragging && "min-h-[40px]")}>
        {files.length === 0 && isDragging && (
          <div className="flex items-center justify-center h-8 rounded text-[10px] text-muted-foreground/50 border border-dashed border-muted-foreground/20">
            拖入此处
          </div>
        )}
        {files.map((file) => (
          <div
            key={file.id}
            draggable={!disabled}
            onDragStart={() => { if (!disabled) onFileDragStart(file.id); }}
            onDragEnd={() => { if (!disabled) onFileDragEnd(); }}
            className={cn(
              "flex items-center gap-1.5 px-1.5 py-1 rounded group",
              disabled ? "cursor-default" : "hover:bg-muted/40 cursor-grab active:cursor-grabbing"
            )}
          >
            <GripVertical className="w-2.5 h-2.5 text-muted-foreground/40 flex-shrink-0" />
            <FileText className="w-2.5 h-2.5 text-muted-foreground/60 flex-shrink-0" />
            <div className="flex-1 min-w-0 flex items-center gap-2">
              <span className="text-[10px] font-medium truncate leading-tight">{file.name}</span>
              <span className="text-[9px] text-muted-foreground/60 flex-shrink-0">{formatFileSize(file.sizeBytes)}</span>
              {file.classificationConfidence !== null && file.classificationConfidence > 0 && (
                <span className={cn(
                  "text-[9px] px-1 rounded flex-shrink-0",
                  file.classificationConfidence >= 80 ? "text-emerald-600 bg-emerald-50" :
                  file.classificationConfidence >= 50 ? "text-amber-600 bg-amber-50" :
                  "text-red-600 bg-red-50"
                )}>
                  {file.classificationConfidence}%
                </span>
              )}
            </div>
            {chapterId !== null && !disabled && (
              <button
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-muted transition-opacity flex-shrink-0"
                onClick={() => handleRemoveFile(file.id)}
                title="移出章节"
              >
                <X className="w-2.5 h-2.5 text-muted-foreground/60" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
