import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useLatestGeneratedReport } from "@/hooks/useGeneratedReports";
import { useProject } from "@/hooks/useProjects";
import { useChapters, flattenChaptersWithNumbers } from "@/hooks/useChapters";
import { useFiles, formatFileSize } from "@/hooks/useFiles";
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
  Loader2,
  RefreshCw,
  Sparkles,
  Timer,
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

const categoryConfig: Record<string, { label: string; color: string }> = {
  "公司基本信息": { label: "公司基本信息", color: "bg-blue-100 text-blue-700" },
  "公司治理": { label: "公司治理", color: "bg-purple-100 text-purple-700" },
  "股权结构": { label: "股权结构", color: "bg-indigo-100 text-indigo-700" },
  "劳动人事": { label: "劳动人事", color: "bg-green-100 text-green-700" },
  "知识产权": { label: "知识产权", color: "bg-amber-100 text-amber-700" },
  "重大合同": { label: "重大合同", color: "bg-rose-100 text-rose-700" },
  财务: { label: "财务", color: "bg-emerald-100 text-emerald-700" },
  税务: { label: "税务", color: "bg-teal-100 text-teal-700" },
  资产: { label: "资产", color: "bg-cyan-100 text-cyan-700" },
  "诉讼与行政处罚": { label: "诉讼与行政处罚", color: "bg-red-100 text-red-700" },
  资质证照: { label: "资质证照", color: "bg-orange-100 text-orange-700" },
  其他: { label: "其他文件", color: "bg-gray-100 text-gray-700" },
};

const stageLabelMap: Record<string, string> = {
  queued: "排队中",
  metadata: "提取元数据",
  extract: "生成章节",
  analyze: "汇总分析",
  finalize: "保存报告",
  completed: "完成",
  failed: "失败",
};

function categorizeFile(filename: string): string {
  const name = filename.toLowerCase();
  if (name.includes("营业执照") || name.includes("工商")) return "公司基本信息";
  if (name.includes("章程")) return "公司治理";
  if (name.includes("股权") || name.includes("股东")) return "股权结构";
  if (name.includes("董事") || name.includes("监事") || name.includes("高管")) return "公司治理";
  if (name.includes("劳动") || name.includes("社保") || name.includes("员工")) return "劳动人事";
  if (name.includes("专利") || name.includes("商标") || name.includes("著作权") || name.includes("软著")) return "知识产权";
  if (name.includes("合同") || name.includes("协议")) return "重大合同";
  if (name.includes("财务") || name.includes("审计") || name.includes("报表")) return "财务";
  if (name.includes("税") || name.includes("发票")) return "税务";
  if (name.includes("房产") || name.includes("土地") || name.includes("租赁")) return "资产";
  if (name.includes("诉讼") || name.includes("仲裁") || name.includes("处罚")) return "诉讼与行政处罚";
  if (name.includes("资质") || name.includes("许可") || name.includes("备案")) return "资质证照";
  return "其他";
}

export default function ChapterMapping() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const currentProjectId = projectId || "";

  const { data: project } = useProject(currentProjectId || undefined);
  const { data: chapters = [], isLoading: chaptersLoading } = useChapters(currentProjectId || undefined);
  const { data: files = [], isLoading: filesLoading } = useFiles(currentProjectId || undefined);

  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [lastProgressUpdate, setLastProgressUpdate] = useState<number>(Date.now());
  const [isCancelling, setIsCancelling] = useState(false);
  const monitoredJobIdRef = useRef<string | null>(null);
  const lastProgressRef = useRef<number | null>(null);
  
  // Detect if job is stuck (no progress update for 60 seconds)
  const isJobStuck = useMemo(() => {
    if (!job || !["queued", "running"].includes(job.status)) return false;
    const timeSinceLastUpdate = Date.now() - lastProgressUpdate;
    return timeSinceLastUpdate > 60000; // 60 seconds
  }, [job, lastProgressUpdate]);
  
  // Track progress changes
  useEffect(() => {
    if (job?.progress !== undefined && job.progress !== lastProgressRef.current) {
      lastProgressRef.current = job.progress;
      setLastProgressUpdate(Date.now());
    }
  }, [job?.progress]);

  const flatChapters = useMemo(() => flattenChaptersWithNumbers(chapters), [chapters]);

  const categorizedFiles = useMemo(() => {
    return files.reduce((acc, file) => {
      const category = categorizeFile(file.name);
      if (!acc[category]) acc[category] = [];
      acc[category].push(file);
      return acc;
    }, {} as Record<string, typeof files>);
  }, [files]);

  const {
    job,
    report,
    isCreating,
    isPolling,
    error,
    errorCode,
    createJob,
    startMonitoring,
  } = useReportJob({
    projectId: currentProjectId,
    onSuccess: () => {
      toast.success("报告生成完成", { description: "可前往报告预览查看结果" });
    },
    onError: (message) => {
      toast.error("任务执行失败", { description: message });
    },
  });

  const { data: latestReport } = useLatestGeneratedReport(currentProjectId || undefined);
  const { data: activeJob, isFetching: isDetectingJob } = useActiveReportJob(currentProjectId || undefined);
  const hasPersistedReport = !!latestReport;

  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.status)) {
      return;
    }

    monitoredJobIdRef.current = job.id;
  }, [job]);

  useEffect(() => {
    if (!activeJob?.id || monitoredJobIdRef.current === activeJob.id) {
      return;
    }

    monitoredJobIdRef.current = activeJob.id;
    startMonitoring(activeJob.id);
  }, [activeJob?.id, startMonitoring]);

  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.status)) {
      return;
    }

    const timer = setInterval(() => {
      setElapsedSeconds((value) => value + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [job]);

  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.status)) {
      setElapsedSeconds(0);
    }
  }, [job?.id, job?.status]);

  const progressStatusByStep = useMemo(() => {
    const statusMap = new Map<string, ProgressStepStatus>();
    const stageOrder = new Map(progressSteps.map((step, index) => [step.key, index]));

    progressSteps.forEach((step) => statusMap.set(step.key, "pending"));

    if (!job && hasPersistedReport) {
      progressSteps.forEach((step) => statusMap.set(step.key, "completed"));
      return statusMap;
    }

    if (!job) {
      return statusMap;
    }

    if (job.status === "succeeded") {
      progressSteps.forEach((step) => statusMap.set(step.key, "completed"));
      return statusMap;
    }

    const resolvedStage = stageOrder.has(job.currentStage) ? job.currentStage : "queued";
    const resolvedStageIndex = stageOrder.get(resolvedStage) ?? 0;

    if (job.status === "failed" || job.status === "cancelled") {
      progressSteps.forEach((step, index) => {
        if (index < resolvedStageIndex) {
          statusMap.set(step.key, "completed");
        } else if (index === resolvedStageIndex) {
          statusMap.set(step.key, "error");
        }
      });
      return statusMap;
    }

    progressSteps.forEach((step, index) => {
      if (index < resolvedStageIndex) {
        statusMap.set(step.key, "completed");
      } else if (index === resolvedStageIndex) {
        statusMap.set(step.key, "running");
      }
    });

    return statusMap;
  }, [job, hasPersistedReport]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}分${secs}秒` : `${secs}秒`;
  };

  const isLoading = chaptersLoading || filesLoading;
  const isReady = files.length > 0 && flatChapters.length > 0;
  const jobIsRunning = job?.status === "queued" || job?.status === "running";

  const handleStart = async () => {
    if (!currentProjectId) {
      toast.error("请先选择项目");
      return;
    }

    if (!isReady) {
      toast.error("请先完成文件上传和模板结构配置");
      return;
    }

    setLastProgressUpdate(Date.now());
    lastProgressRef.current = null;
    const createdJobId = await createJob();
    if (createdJobId) {
      monitoredJobIdRef.current = createdJobId;
    }
  };
  
  const handleCancelJob = async () => {
    if (!job?.id) return;
    
    setIsCancelling(true);
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { error } = await supabase
        .from("report_generation_jobs")
        .update({
          status: "cancelled",
          error_message: "用户手动取消",
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      
      if (error) {
        toast.error("取消失败", { description: error.message });
      } else {
        toast.success("任务已取消");
        monitoredJobIdRef.current = null;
      }
    } catch (err) {
      toast.error("取消失败", { description: String(err) });
    } finally {
      setIsCancelling(false);
    }
  };

  if (!currentProjectId) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h2 className="text-lg font-semibold mb-2">请先选择项目</h2>
          <Button onClick={() => navigate("/")}>返回项目列表</Button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-background">
        <div>
          <h1 className="text-lg font-semibold">AI 智能生成报告</h1>
          <p className="text-[13px] text-muted-foreground">
            {`${project?.name || "当前项目"} · ${files.length} 份数据室文件`}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => navigate(`/project/${projectId}/preview`)}>
            报告预览
          </Button>
          <Button onClick={handleStart} disabled={!isReady || isCreating || isDetectingJob} className="gap-2">
            {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {jobIsRunning ? "任务执行中" : hasPersistedReport || job?.status === "succeeded" ? "重新生成" : "开始生成"}
          </Button>
        </div>
      </div>

      {!isReady && (
        <div className="mx-6 mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
          <div>
            <div className="font-medium text-amber-900">准备工作未完成</div>
            <div className="text-[13px] text-amber-700 mt-1 space-y-1">
              {files.length === 0 && <p>• 请先上传尽调文件</p>}
              {flatChapters.length === 0 && <p>• 请先在模板指纹中生成章节结构</p>}
            </div>
          </div>
        </div>
      )}

      <div className="mx-6 mt-4 p-4 border border-border rounded-lg bg-card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Brain className="w-5 h-5 text-primary" />
            <div>
              <div className="text-[13px] font-medium">任务状态</div>
              <div className="text-[12px] text-muted-foreground">
                {job
                  ? `${stageLabelMap[job.currentStage] || job.currentStage} · ${job.progressMessage}`
                  : isDetectingJob
                    ? "正在检查历史任务..."
                    : hasPersistedReport
                      ? "已存在最新报告，可直接预览或重新生成"
                      : "尚未启动任务"}
              </div>
            </div>
          </div>

          {(job || hasPersistedReport) && (
            <div className="text-right">
              {job ? (
                <Badge variant={job.status === "succeeded" ? "default" : job.status === "failed" ? "destructive" : "secondary"}>
                  {job.status === "queued" && "排队中"}
                  {job.status === "running" && "执行中"}
                  {job.status === "succeeded" && "已完成"}
                  {job.status === "failed" && "失败"}
                  {job.status === "cancelled" && "已取消"}
                </Badge>
              ) : (
                <Badge variant="default">已完成</Badge>
              )}
              {(jobIsRunning || isPolling) && (
                <div className="mt-2 flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
                  <Timer className="w-3 h-3" />
                  <span>{formatDuration(elapsedSeconds)}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {(job || hasPersistedReport) && (
          <div className="mt-4 space-y-2">
            <Progress value={job ? job.progress : 100} className="h-2" />
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>
                已处理章节 {job ? `${job.processedChapters}/${job.totalChapters}` : `${latestReport?.totalChapters ?? 0}/${latestReport?.totalChapters ?? 0}`}
              </span>
              <span>{job ? `${job.progress}%` : "100%"}</span>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 rounded border border-red-200 bg-red-50 text-red-700 text-[12px]">
            {error}
            {errorCode && <span className="ml-1">({errorCode})</span>}
          </div>
        )}
      </div>

      <div className="flex-1 grid grid-cols-12 gap-0 min-h-0 mt-4">
        <div className="col-span-5 border-r border-border flex flex-col">
          <div className="px-4 py-3 border-b border-border bg-muted/30">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase">数据室文件</span>
              <span className="text-[11px] text-muted-foreground">{files.length} 个</span>
            </div>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-3">
              {Object.entries(categorizedFiles).map(([category, categoryFiles]) => {
                const config = categoryConfig[category] || categoryConfig["其他"];
                return (
                  <div key={category} className="rounded-lg border border-border overflow-hidden">
                    <div className={cn("px-3 py-2 flex items-center justify-between", config.color)}>
                      <div className="flex items-center gap-2">
                        <FolderOpen className="w-4 h-4" />
                        <span className="font-medium text-[13px]">{config.label}</span>
                      </div>
                      <span className="text-[12px] font-medium">{categoryFiles.length}</span>
                    </div>
                    <div className="divide-y divide-border">
                      {categoryFiles.slice(0, 4).map((file) => (
                        <div key={file.id} className="px-3 py-2 flex items-center gap-2 text-[12px]">
                          <FileText className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                          <span className="truncate flex-1">{file.name}</span>
                          <span className="text-muted-foreground text-[10px]">{formatFileSize(file.sizeBytes)}</span>
                        </div>
                      ))}
                      {categoryFiles.length > 4 && (
                        <div className="px-3 py-2 text-[11px] text-muted-foreground text-center">
                          +{categoryFiles.length - 4} 个文件
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {files.length === 0 && (
                <div className="text-center py-12">
                  <FileQuestion className="w-12 h-12 text-muted-foreground/50 mx-auto mb-3" />
                  <p className="text-[13px] text-muted-foreground">暂无文件</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="col-span-4 flex flex-col bg-muted/10 border-r border-border">
          <div className="px-4 py-3 border-b border-border bg-muted/30">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase">生成进度</span>
              {(jobIsRunning || isPolling) && (
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Timer className="w-3 h-3" />
                  <span>{formatDuration(elapsedSeconds)}</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 p-4 overflow-auto">
            <div className="space-y-2">
              {progressSteps.map((step, index) => {
                const stepStatus = progressStatusByStep.get(step.key) || "pending";
                const isStepRunning = stepStatus === "running";
                const isStepCompleted = stepStatus === "completed";
                const isStepError = stepStatus === "error";

                return (
                  <div
                    key={step.key}
                    className={cn(
                      "flex items-start gap-3 p-2.5 rounded-lg transition-all",
                      isStepRunning && "bg-primary/10 border border-primary/30",
                      isStepCompleted && "bg-emerald-50/80",
                      isStepError && "bg-red-50 border border-red-200",
                      stepStatus === "pending" && "bg-muted/20"
                    )}
                  >
                    <div
                      className={cn(
                        "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0",
                        isStepRunning && "bg-primary text-white",
                        isStepCompleted && "bg-emerald-500 text-white",
                        isStepError && "bg-red-500 text-white",
                        stepStatus === "pending" && "bg-muted"
                      )}
                    >
                      {isStepRunning && <Loader2 className="w-3 h-3 animate-spin" />}
                      {isStepCompleted && <CheckCircle2 className="w-3 h-3" />}
                      {isStepError && <AlertTriangle className="w-3 h-3" />}
                      {stepStatus === "pending" && <span className="text-[10px] text-muted-foreground">{index + 1}</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div
                        className={cn(
                          "font-medium text-[12px]",
                          isStepRunning && "text-primary",
                          isStepCompleted && "text-emerald-700",
                          isStepError && "text-red-700"
                        )}
                      >
                        {step.title}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {isStepRunning && job?.progressMessage ? job.progressMessage : step.description}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {isPolling && job?.status !== "succeeded" && !isJobStuck && (
              <div className="mt-3 p-3 rounded border border-blue-200 bg-blue-50 text-blue-700 text-[12px] flex items-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Realtime中断，已切换轮询兜底</span>
              </div>
            )}
            
            {isJobStuck && jobIsRunning && (
              <div className="mt-3 p-3 rounded border border-amber-200 bg-amber-50 text-amber-800 text-[12px]">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4" />
                  <span className="font-medium">任务可能已卡住</span>
                </div>
                <p className="text-[11px] mb-3">
                  任务已超过 60 秒没有进度更新。可能是后台处理超时或遇到错误。
                </p>
                <div className="flex gap-2">
                  <Button 
                    size="sm" 
                    variant="outline"
                    className="h-7 text-[11px]"
                    onClick={handleCancelJob}
                    disabled={isCancelling}
                  >
                    {isCancelling ? (
                      <>
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        取消中...
                      </>
                    ) : (
                      "取消任务"
                    )}
                  </Button>
                  <Button 
                    size="sm" 
                    className="h-7 text-[11px]"
                    onClick={() => {
                      handleCancelJob().then(() => {
                        setTimeout(() => handleStart(), 500);
                      });
                    }}
                    disabled={isCancelling}
                  >
                    取消并重试
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="col-span-3 flex flex-col">
          <div className="px-4 py-3 border-b border-border bg-muted/30">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase">章节结构</span>
              <span className="text-[11px] text-muted-foreground">{flatChapters.length} 章</span>
            </div>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-1">
              {flatChapters.map((chapter) => (
                <div
                  key={chapter.id}
                  className={cn(
                    "flex items-center gap-2 py-1.5 px-2 rounded text-[11px] hover:bg-muted/50",
                    chapter.level === 1 && "font-medium",
                    chapter.level === 2 && "ml-3 text-muted-foreground",
                    chapter.level === 3 && "ml-6 text-muted-foreground text-[10px]"
                  )}
                >
                  <ChevronRight className="w-3 h-3 flex-shrink-0 text-muted-foreground/70" />
                  <span className="font-mono text-[9px] text-muted-foreground w-6">{chapter.number}</span>
                  <span className="truncate">{chapter.title}</span>
                </div>
              ))}
              {flatChapters.length === 0 && (
                <div className="text-center py-12">
                  <FileQuestion className="w-10 h-10 text-muted-foreground/50 mx-auto mb-2" />
                  <p className="text-[12px] text-muted-foreground">暂无章节</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
