import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useLatestGeneratedReport } from "@/hooks/useGeneratedReports";
import { useProject } from "@/hooks/useProjects";
import { useChapters, flattenChaptersWithNumbers } from "@/hooks/useChapters";
import {
  useFiles,
  useClassifyFiles,
  useUpdateFileChapter,
  formatFileSize,
} from "@/hooks/useFiles";
import { useReportJob } from "@/hooks/useReportJob";
import { useActiveReportJob } from "@/hooks/useActiveReportJob";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  ChevronRight,
  FileQuestion,
  FileText,
  FolderOpen,
  GripVertical,
  Loader2,
  RefreshCw,
  Sparkles,
  Timer,
  X,
} from "lucide-react";

type ProgressStepStatus = "pending" | "running" | "completed" | "error";

interface ProgressStep {
  key: string;
  title: string;
  description: string;
}

const progressSteps: ProgressStep[] = [
  { key: "queued", title: "任务排队", description: "等待执行资源" },
  { key: "metadata", title: "提取元数据", description: "提取股权结构和定义" },
  { key: "extract", title: "生成章节", description: "分批生成章节内容" },
  { key: "analyze", title: "汇总分析", description: "汇总问题与证据" },
  { key: "finalize", title: "保存报告", description: "持久化到数据库" },
  { key: "completed", title: "完成", description: "报告可在预览页查看" },
];

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

  const classifyMutation = useClassifyFiles();
  const updateChapterMutation = useUpdateFileChapter();

  // 报告生成相关
  const { createJob, cancelJob } = useReportJob({ projectId: projectId || "" });
  const { job, isPolling } = useActiveReportJob(projectId);
  const jobIsRunning = job?.status === "running" || job?.status === "pending";
  const jobIsSucceeded = job?.status === "succeeded";
  const [isCancelling, setIsCancelling] = useState(false);
  const [isJobStuck, setIsJobStuck] = useState(false);
  const lastProgressRef = useRef<{ time: number; message: string | null }>({ time: Date.now(), message: null });

  useEffect(() => {
    if (!jobIsRunning) { setIsJobStuck(false); return; }
    const interval = setInterval(() => {
      const now = Date.now();
      const msg = job?.progressMessage ?? null;
      if (msg !== lastProgressRef.current.message) {
        lastProgressRef.current = { time: now, message: msg };
        setIsJobStuck(false);
      } else if (now - lastProgressRef.current.time > 60000) {
        setIsJobStuck(true);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [jobIsRunning, job?.progressMessage]);

  const handleStart = async () => {
    if (!projectId) return;
    try {
      const jobId = await createJob();
      if (!jobId) throw new Error("创建任务失败");
      toast.success("报告生成任务已启动");
    } catch {
      toast.error("启动失败，请重试");
    }
  };

  const handleCancelJob = async () => {
    if (!job?.id || !projectId) return;
    setIsCancelling(true);
    try {
      await cancelJob({ jobId: job.id, projectId });
      toast.info("任务已取消");
    } finally {
      setIsCancelling(false);
    }
  };

  // ── AI 分类 ──────────────────────────────────────────────
  const handleAIClassify = async () => {
    if (!projectId || !files.length || !flatChapters.length) return;
    try {
      const result = await classifyMutation.mutateAsync({
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
      toast.success(`AI 分类完成，共处理 ${result.classified} 个文件`);
    } catch (err) {
      toast.error(`AI 分类失败：${err instanceof Error ? err.message : "未知错误"}`);
    }
  };

  // ── 拖拽逻辑 ──────────────────────────────────────────────
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragOverChapterId, setDragOverChapterId] = useState<string | null | "unassigned">(null);

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

  // ── 进度步骤状态 ──────────────────────────────────────────
  const getStepStatus = (stepKey: string): ProgressStepStatus => {
    if (!job) return "pending";
    const stepOrder = progressSteps.map((s) => s.key);
    const currentIdx = stepOrder.indexOf(job.currentStep || "queued");
    const stepIdx = stepOrder.indexOf(stepKey);
    if (job.status === "failed") return stepIdx <= currentIdx ? "error" : "pending";
    if (stepIdx < currentIdx) return "completed";
    if (stepIdx === currentIdx) return job.status === "running" ? "running" : "pending";
    return "pending";
  };

  const classifyIsRunning = classifyMutation.isPending;

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
            disabled={classifyIsRunning || !files.length || !flatChapters.length}
            onClick={handleAIClassify}
          >
            {classifyIsRunning ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            {classifyIsRunning ? "AI 分类中..." : "AI 自动分类"}
          </Button>
          {latestReport && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => navigate(`/projects/${projectId}/report`)}
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

        {/* 右侧：章节结构 + 任务进度 */}
        <div className="flex flex-col overflow-hidden">
          {/* 任务进度（仅在任务运行时展示） */}
          {(jobIsRunning || jobIsSucceeded || job?.status === "failed") && (
            <div className="border-b border-border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase">任务进度</span>
                {jobIsRunning && (
                  <Badge variant="secondary" className="text-[10px] h-5 gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    运行中
                  </Badge>
                )}
                {jobIsSucceeded && (
                  <Badge className="text-[10px] h-5 bg-emerald-500">
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    完成
                  </Badge>
                )}
              </div>
              {job && (
                <Progress
                  value={progressSteps.findIndex((s) => s.key === (job.currentStep || "queued")) / (progressSteps.length - 1) * 100}
                  className="h-1.5"
                />
              )}
              <div className="space-y-1">
                {progressSteps.map((step) => {
                  const status = getStepStatus(step.key);
                  return (
                    <div key={step.key} className={cn("flex items-center gap-2 py-0.5", status === "pending" && "opacity-40")}>
                      {status === "completed" && <CheckCircle2 className="w-3 h-3 text-emerald-500 flex-shrink-0" />}
                      {status === "running" && <Loader2 className="w-3 h-3 text-blue-500 animate-spin flex-shrink-0" />}
                      {status === "error" && <AlertTriangle className="w-3 h-3 text-red-500 flex-shrink-0" />}
                      {status === "pending" && <div className="w-3 h-3 rounded-full border border-muted-foreground/30 flex-shrink-0" />}
                      <div className="min-w-0">
                        <div className={cn("text-[11px] font-medium leading-tight truncate", status === "completed" && "text-emerald-700", status === "error" && "text-red-700")}>
                          {step.title}
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          {status === "running" && job?.progressMessage ? job.progressMessage : step.description}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {isPolling && !isJobStuck && (
                <div className="p-2 rounded border border-blue-200 bg-blue-50 text-blue-700 text-[10px] flex items-center gap-1.5">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  轮询兜底中
                </div>
              )}
              {isJobStuck && jobIsRunning && (
                <div className="p-2 rounded border border-amber-200 bg-amber-50 text-amber-800 text-[10px] space-y-2">
                  <div className="flex items-center gap-1.5 font-medium">
                    <Timer className="w-3 h-3" />
                    任务可能已卡住
                  </div>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={handleCancelJob} disabled={isCancelling}>
                      取消
                    </Button>
                    <Button size="sm" className="h-6 text-[10px] px-2" disabled={isCancelling}
                      onClick={() => handleCancelJob().then(() => setTimeout(handleStart, 500))}>
                      重试
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 章节结构 */}
          <div className="px-3 py-2 border-b border-border bg-muted/20 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">章节结构</span>
            <span className="text-[11px] text-muted-foreground">{level1Chapters.length} 章</span>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-0.5">
              {flatChapters.map((chapter) => (
                <div
                  key={chapter.id}
                  className={cn(
                    "flex items-center gap-1.5 py-1 px-2 rounded text-[11px] hover:bg-muted/40",
                    chapter.level === 1 && "font-medium",
                    chapter.level === 2 && "ml-3 text-muted-foreground",
                    chapter.level === 3 && "ml-6 text-muted-foreground text-[10px]"
                  )}
                >
                  <ChevronRight className="w-3 h-3 flex-shrink-0 text-muted-foreground/50" />
                  <span className="truncate">{chapter.number && chapter.number !== chapter.title ? `${chapter.number}、` : ""}{chapter.title}</span>
                  {chapter.level === 1 && (
                    <span className="ml-auto text-[10px] text-muted-foreground/60 flex-shrink-0">
                      {files.filter((f) => f.chapterId === chapter.id).length}
                    </span>
                  )}
                </div>
              ))}
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
