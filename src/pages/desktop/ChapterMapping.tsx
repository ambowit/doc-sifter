import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useLatestGeneratedReport } from "@/hooks/useGeneratedReports";
import { useProject } from "@/hooks/useProjects";
import { useChapters, flattenChaptersWithNumbers } from "@/hooks/useChapters";
import {
  useFiles,
  useClassifyFilesWithProgress,
  useUpdateFileChapter,
  formatFileSize,
} from "@/hooks/useFiles";
import { AIClassifyDialog } from "@/components/AIClassifyDialog";
import { useGenerateAIReport } from "@/hooks/useReportGeneration";
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

export default function ChapterMapping() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const { data: project } = useProject(projectId);
  const { data: chaptersTree = [] } = useChapters(projectId);
  const flatChapters = flattenChaptersWithNumbers(chaptersTree);
  const { data: files = [], isLoading: filesLoading } = useFiles(projectId);
  const { data: latestReport } = useLatestGeneratedReport(projectId);

  const { progress: classifyProgress, start: startClassify, pause: pauseClassify, resume: resumeClassify, cancel: cancelClassify, reset: resetClassify } = useClassifyFilesWithProgress();
  const updateChapterMutation = useUpdateFileChapter();
  const [showClassifyDialog, setShowClassifyDialog] = useState(false);

  // 报告生成：直接调 AI，不经过 Worker
  const generateAIReport = useGenerateAIReport();
  const jobIsRunning = generateAIReport.isPending;

  const handleStart = async () => {
    if (!projectId) return;
    try {
      await generateAIReport.mutateAsync(projectId);
      toast.success("报告生成成功");
      navigate(`/projects/${projectId}/preview`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "报告生成失败，请重试";
      toast.error(msg);
    }
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
  const level1Chapters = flatChapters.filter((c) => c.level === 1);

  const filesByChapter = level1Chapters.map((chapter) => ({
    chapter,
    files: files.filter((f) => f.chapterId === chapter.id),
  }));

  const unassignedFiles = files.filter((f) => !f.chapterId);

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
              onClick={() => navigate(`/projects/${projectId}/preview`)}
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
        <div className="flex flex-col border-r border-border overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-muted/20 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              资料分类
            </span>
            <span className="text-[11px] text-muted-foreground">
              {files.filter((f) => f.chapterId).length}/{files.length} 已分类
            </span>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-3 space-y-3">
              {filesLoading && (
                <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">加载文件...</span>
                </div>
              )}

              {/* 未分类文件桶 */}
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
              />

              {/* 各章节桶 */}
              {filesByChapter.map(({ chapter, files: chapterFiles }) => (
                <ChapterBucket
                  key={chapter.id}
                  chapterId={chapter.id}
                  label={
                    chapter.number && chapter.number !== chapter.title
                      ? `${chapter.number}、${chapter.title}`
                      : chapter.title
                  }
                  files={chapterFiles}
                  isDragOver={dragOverChapterId === chapter.id}
                  isDragging={!!dragState}
                  onDragOver={() => setDragOverChapterId(chapter.id)}
                  onDragLeave={() => setDragOverChapterId(null)}
                  onDrop={() => handleDrop(chapter.id)}
                  onFileDragStart={(fileId) => handleDragStart(fileId, chapter.id)}
                  onFileDragEnd={handleDragEnd}
                  projectId={projectId!}
                />
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
          {/* AI 生成中提示 */}
          {jobIsRunning && (
            <div className="border-b border-border p-3">
              <div className="flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500 flex-shrink-0" />
                <span className="text-[11px] text-blue-700 font-medium">AI 正在生成报告，请稍候...</span>
              </div>
            </div>
          )}

          {/* 章节结构 */}
          <div className="px-3 py-2 border-b border-border bg-muted/20 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">章节结构</span>
            <span className="text-[11px] text-muted-foreground">{level1Chapters.length} 章</span>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-0.5">
              {flatChapters.map((chapter) => {
                // 只显示一级章节，或者在父章节展开时显示二级章节
                const isLevel1 = chapter.level === 1;
                const isLevel2 = chapter.level === 2;
                
                // 找到二级章节的父章节ID
                const parentChapter = isLevel2 
                  ? flatChapters.find(c => c.level === 1 && flatChapters.indexOf(c) < flatChapters.indexOf(chapter) && 
                      !flatChapters.slice(flatChapters.indexOf(c) + 1, flatChapters.indexOf(chapter)).some(x => x.level === 1))
                  : null;
                
                // 如果是二级章节，检查父章节是否展开
                if (isLevel2 && parentChapter && !expandedChapterIds.has(parentChapter.id)) {
                  return null;
                }
                
                // 三级及以下章节暂不显示
                if (chapter.level > 2) return null;
                
                const isExpanded = expandedChapterIds.has(chapter.id);
                const hasChildren = isLevel1 && flatChapters.some(c => c.level === 2 && 
                  flatChapters.indexOf(c) > flatChapters.indexOf(chapter) &&
                  !flatChapters.slice(flatChapters.indexOf(chapter) + 1, flatChapters.indexOf(c)).some(x => x.level === 1)
                );
                
                return (
                  <div
                    key={chapter.id}
                    className={cn(
                      "flex items-center gap-1.5 py-1 px-2 rounded text-[11px] hover:bg-muted/40",
                      isLevel1 && "font-medium",
                      isLevel2 && "ml-5 text-muted-foreground"
                    )}
                  >
                    {isLevel1 && hasChildren ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setExpandedChapterIds(prev => {
                            const next = new Set(prev);
                            if (next.has(chapter.id)) {
                              next.delete(chapter.id);
                            } else {
                              next.add(chapter.id);
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
                    ) : (
                      <span className="w-4 h-4 flex-shrink-0" />
                    )}
                    <span className="truncate">{chapter.number && chapter.number !== chapter.title ? `${chapter.number}、` : ""}{chapter.title}</span>
                    {isLevel1 && (
                      <span className="ml-auto text-[10px] text-muted-foreground/60 flex-shrink-0">
                        {files.filter((f) => f.chapterId === chapter.id).length}
                      </span>
                    )}
                  </div>
                );
              })}
              {flatChapters.length === 0 && (
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
  files: ReturnType<typeof useFiles>["data"] extends (infer T)[] ? T[] : never[];
  isDragOver: boolean;
  isDragging: boolean;
  onDragOver: () => void;
  onDragLeave: () => void;
  onDrop: () => void;
  onFileDragStart: (fileId: string) => void;
  onFileDragEnd: () => void;
  projectId: string;
  variant?: "default" | "unassigned";
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
        variant === "unassigned" ? "border-dashed border-muted-foreground/30 bg-muted/10" : "border-border bg-card",
        isDragOver && "border-primary/60 bg-primary/5",
        isDragging && !isDragOver && "border-dashed"
      )}
      onDragOver={(e) => { e.preventDefault(); onDragOver(); }}
      onDragLeave={onDragLeave}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
    >
      {/* 桶头部 */}
      <div className={cn(
        "flex items-center justify-between px-3 py-2 border-b",
        variant === "unassigned" ? "border-muted-foreground/10" : "border-border/60"
      )}>
        <div className="flex items-center gap-2 min-w-0">
          <FolderOpen className={cn("w-3.5 h-3.5 flex-shrink-0", variant === "unassigned" ? "text-muted-foreground/50" : "text-muted-foreground")} />
          <span className={cn(
            "text-[11px] font-medium truncate",
            variant === "unassigned" && "text-muted-foreground"
          )}>
            {label}
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground ml-2 flex-shrink-0">{files.length}</span>
      </div>

      {/* 文件列表 */}
      <div className={cn("p-1.5 space-y-0.5 min-h-[36px]", files.length === 0 && isDragging && "min-h-[52px]")}>
        {files.length === 0 && isDragging && (
          <div className="flex items-center justify-center h-10 rounded text-[11px] text-muted-foreground/50 border border-dashed border-muted-foreground/20">
            拖入此处
          </div>
        )}
        {files.map((file) => (
          <div
            key={file.id}
            draggable
            onDragStart={() => onFileDragStart(file.id)}
            onDragEnd={onFileDragEnd}
            className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-muted/40 cursor-grab active:cursor-grabbing group"
          >
            <GripVertical className="w-3 h-3 text-muted-foreground/40 flex-shrink-0 mt-0.5" />
            <FileText className="w-3 h-3 text-muted-foreground/60 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-medium truncate leading-tight">{file.name}</div>
              {file.aiSummary && (
                <div className="text-[10px] text-muted-foreground truncate mt-0.5">{file.aiSummary}</div>
              )}
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[10px] text-muted-foreground/60">{formatFileSize(file.sizeBytes)}</span>
                {file.classificationConfidence !== null && file.classificationConfidence > 0 && (
                  <span className={cn(
                    "text-[10px] px-1 rounded",
                    file.classificationConfidence >= 80 ? "text-emerald-600 bg-emerald-50" :
                    file.classificationConfidence >= 50 ? "text-amber-600 bg-amber-50" :
                    "text-red-600 bg-red-50"
                  )}>
                    {file.classificationConfidence}%
                  </span>
                )}
              </div>
            </div>
            {chapterId !== null && (
              <button
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-muted transition-opacity flex-shrink-0"
                onClick={() => handleRemoveFile(file.id)}
                title="移出章节"
              >
                <X className="w-3 h-3 text-muted-foreground/60" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
