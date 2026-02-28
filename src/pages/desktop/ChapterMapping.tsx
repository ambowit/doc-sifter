import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { validateProjectExists, clearInvalidProject, useCurrentProject } from "@/hooks/useProjects";
import { useChapters, flattenChaptersWithNumbers } from "@/hooks/useChapters";
import { useFiles, formatFileSize } from "@/hooks/useFiles";
import { type AIGeneratedReport } from "@/hooks/useReportGeneration";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  FileText,
  FolderOpen,
  Sparkles,
  Loader2,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  FileQuestion,
  Brain,
  ChevronRight,
  RefreshCw,
  Timer,
  Layers,
} from "lucide-react";

// File category configuration
const categoryConfig: Record<string, { label: string; color: string }> = {
  "公司基本信息": { label: "公司基本信息", color: "bg-blue-100 text-blue-700" },
  "公司治理": { label: "公司治理", color: "bg-purple-100 text-purple-700" },
  "股权结构": { label: "股权结构", color: "bg-indigo-100 text-indigo-700" },
  "劳动人事": { label: "劳动人事", color: "bg-green-100 text-green-700" },
  "知识产权": { label: "知识产权", color: "bg-amber-100 text-amber-700" },
  "重大合同": { label: "重大合同", color: "bg-rose-100 text-rose-700" },
  "财务": { label: "财务", color: "bg-emerald-100 text-emerald-700" },
  "税务": { label: "税务", color: "bg-teal-100 text-teal-700" },
  "资产": { label: "资产", color: "bg-cyan-100 text-cyan-700" },
  "诉讼与行政处罚": { label: "诉讼与行政处罚", color: "bg-red-100 text-red-700" },
  "资质证照": { label: "资质证照", color: "bg-orange-100 text-orange-700" },
  "其他": { label: "其他文件", color: "bg-gray-100 text-gray-700" },
};

// Categorize file by name
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

// Generation step
interface GenerationStep {
  id: string;
  title: string;
  description: string;
  status: "pending" | "running" | "completed" | "error";
  detail?: string;
}

// Chapters per batch
const CHAPTERS_PER_BATCH = 2; // Reduced for stability with detailed content generation

// Chinese number mapping
const chineseNumbers = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
const toChineseNumber = (n: number) => chineseNumbers[n - 1] || String(n);

export default function ChapterMapping() {
  const navigate = useNavigate();
  const currentProjectId = localStorage.getItem("dd-organizer-current-project");
  
  const { data: project } = useCurrentProject();
  const { data: chapters = [], isLoading: chaptersLoading } = useChapters(currentProjectId || undefined);
  const { data: files = [], isLoading: filesLoading } = useFiles(currentProjectId || undefined);

  const [isGenerating, setIsGenerating] = useState(false);
  const [generationSteps, setGenerationSteps] = useState<GenerationStep[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(-1);
  const [generatedReport, setGeneratedReport] = useState<AIGeneratedReport | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Batch-level tracking for resume/retry
  type BatchSection = {
    id: string; title: string; number: string; content: string;
    findings: string[]; issues: Array<{ fact: string; risk: string; suggestion: string; severity: string }>;
    sourceFiles: string[];
  };
  const [batchResults, setBatchResults] = useState<Record<number, BatchSection[]>>({});
  const [failedBatchIndices, setFailedBatchIndices] = useState<Set<number>>(new Set());
  const reportMetadataCacheRef = useRef<{
    equityStructure?: {
      companyName: string;
      shareholders: Array<{ name: string; percentage: number; type: string; notes?: string }>;
      notes: string[];
    };
    definitions?: Array<{ name: string; shortName: string; description?: string }>;
  } | null>(null);

  // Validate project
  useEffect(() => {
    const validateProject = async () => {
      if (currentProjectId) {
        const exists = await validateProjectExists(currentProjectId);
        if (!exists) {
          clearInvalidProject();
          toast.error("项目不存在，请重新选择项目");
          navigate("/");
        }
      } else {
        navigate("/");
      }
    };
    validateProject();
  }, [currentProjectId, navigate]);

  // Timer
  useEffect(() => {
    if (isGenerating) {
      setElapsedTime(0);
      timerRef.current = setInterval(() => {
        setElapsedTime(prev => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isGenerating]);

  // Categorize files
  const categorizedFiles = files.reduce((acc, file) => {
    const category = categorizeFile(file.name);
    if (!acc[category]) acc[category] = [];
    acc[category].push(file);
    return acc;
  }, {} as Record<string, typeof files>);

  // Flatten chapters
  const flatChapters = flattenChaptersWithNumbers(chapters);

  // Stats
  const stats = {
    totalFiles: files.length,
    totalChapters: flatChapters.length,
    categories: Object.keys(categorizedFiles).length,
  };

  // Format time
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}分${secs}秒` : `${secs}秒`;
  };

  // Calculate batches
  const totalBatches = Math.ceil(flatChapters.length / CHAPTERS_PER_BATCH);

  // Create steps based on batch count
  const createBatchSteps = (): GenerationStep[] => {
    const steps: GenerationStep[] = [
      { id: "init", title: "初始化", description: "准备数据", status: "pending" },
      { id: "metadata", title: "提取元数据", description: "股权结构与定义", status: "pending" },
    ];
    
    for (let i = 0; i < totalBatches; i++) {
      const startIdx = i * CHAPTERS_PER_BATCH + 1;
      const endIdx = Math.min((i + 1) * CHAPTERS_PER_BATCH, flatChapters.length);
      steps.push({
        id: `batch-${i}`,
        title: `第${toChineseNumber(i + 1)}批`,
        description: `章节 ${startIdx}~${endIdx}（共 ${endIdx - startIdx + 1} 个）`,
        status: "pending"
      });
    }
    
    steps.push(
      { id: "analyze", title: "风险分析", description: "统计法律问题", status: "pending" },
      { id: "complete", title: "完成", description: "报告已就绪", status: "pending" }
    );
    
    return steps;
  };

  // Update step
  const updateStep = (index: number, updates: Partial<GenerationStep>) => {
    setGenerationSteps(prev => prev.map((s, i) => 
      i === index ? { ...s, ...updates } : s
    ));
  };

  // Start step (preserves completed/error states for retry support)
  const startStep = (index: number, detail?: string) => {
    setCurrentStepIndex(index);
    setGenerationSteps(prev => prev.map((s, i) => {
      if (i === index) return { ...s, status: "running" as const, detail };
      // Preserve completed and error states (critical for retry)
      if (s.status === "completed" || s.status === "error") return s;
      return s;
    }));
  };

  // Reset everything for a full restart
  const handleRestartGeneration = () => {
    setBatchResults({});
    setFailedBatchIndices(new Set());
    setGeneratedReport(null);
    setGenerationSteps([]);
    setErrorMessage(null);
    setCurrentStepIndex(-1);
    reportMetadataCacheRef.current = null;
  };

  // Handle generation
  const handleGenerateReport = async () => {
    if (!currentProjectId) {
      toast.error("请先选择项目");
      return;
    }
    
    if (files.length === 0 || flatChapters.length === 0) {
      toast.error("请先上传文件和报告模板");
      return;
    }
    
    if (!project) {
      toast.error("项目信息加载中，请稍后重试");
      return;
    }

    // Determine if this is a retry (some batches completed, some failed)
    const completedBatchCount = Object.keys(batchResults).length;
    const isRetry = completedBatchCount > 0 && failedBatchIndices.size > 0;

    setIsGenerating(true);
    setErrorMessage(null);

    if (!isRetry) {
      // Fresh start
      setGeneratedReport(null);
      setBatchResults({});
      setFailedBatchIndices(new Set());
      reportMetadataCacheRef.current = null;
      const steps = createBatchSteps();
      setGenerationSteps(steps);
      setCurrentStepIndex(-1);
    } else {
      // Retry mode: reset failed steps to pending, keep completed ones
      setFailedBatchIndices(new Set());
      setGenerationSteps(prev => prev.map(s =>
        s.status === "error" ? { ...s, status: "pending" as const, detail: undefined } : s
      ));
    }

    // Local tracker (state updates are async, track locally for the loop)
    const localBatchResults: Record<number, BatchSection[]> = { ...batchResults };
    const localFailedBatches = new Set<number>();

    let reportMetadata = isRetry && reportMetadataCacheRef.current
      ? reportMetadataCacheRef.current
      : {} as NonNullable<typeof reportMetadataCacheRef.current>;

    try {
      if (!isRetry) {
        // Step 0: Initialize
        startStep(0, "连接服务...");
        await new Promise(resolve => setTimeout(resolve, 300));
        updateStep(0, { status: "completed" });

        // Step 1: Extract metadata (equity structure & definitions)
        startStep(1, "提取股权结构与定义...");
        
        try {
          const metadataResult = await supabase.functions.invoke("generate-report", {
            body: { 
              projectId: currentProjectId, 
              mode: "metadata" 
            },
          });

          if (metadataResult.data?.metadata) {
            reportMetadata = metadataResult.data.metadata;
            const shareholders = reportMetadata?.equityStructure?.shareholders?.length || 0;
            const definitions = reportMetadata?.definitions?.length || 0;
            updateStep(1, { 
              status: "completed", 
              detail: `${shareholders} 个股东，${definitions} 个定义` 
            });
          } else {
            updateStep(1, { status: "completed", detail: "已提取" });
          }
        } catch (metaErr) {
          console.warn("Metadata extraction failed:", metaErr);
          updateStep(1, { status: "completed", detail: "跳过" });
        }

        reportMetadataCacheRef.current = reportMetadata;
      }

      // Generate each batch with retry logic
      const MAX_BATCH_RETRIES = 2;
      const RETRY_DELAY_MS = 3000;

      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        // Skip already completed batches (from previous run)
        if (localBatchResults[batchIndex]) {
          console.log(`[ChapterMapping] Batch ${batchIndex + 1} already completed, skipping`);
          continue;
        }

        const stepIndex = batchIndex + 2;
        const startChapter = batchIndex * CHAPTERS_PER_BATCH + 1;
        const endChapter = Math.min((batchIndex + 1) * CHAPTERS_PER_BATCH, flatChapters.length);
        
        startStep(stepIndex, `正在生成章节 ${startChapter}~${endChapter}...`);
        
        let batchSuccess = false;
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= MAX_BATCH_RETRIES; attempt++) {
          if (attempt > 0) {
            console.log(`[ChapterMapping] Retry ${attempt}/${MAX_BATCH_RETRIES} for batch ${batchIndex + 1}`);
            updateStep(stepIndex, { status: "pending", detail: `第 ${attempt} 次重试...` });
            startStep(stepIndex, `重试章节 ${startChapter}~${endChapter}（第${attempt}次）...`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
          } else {
            console.log(`[ChapterMapping] Starting batch ${batchIndex + 1}/${totalBatches}`);
          }

          try {
            const result = await supabase.functions.invoke("generate-report", {
              body: { projectId: currentProjectId, mode: "batch", batchIndex, totalBatches },
            });

            if (result.error) {
              const errorMsg = result.error.message || "";
              const isTimeout = errorMsg.includes("504") || errorMsg.includes("timeout") || errorMsg.includes("non-2xx");
              if (isTimeout && attempt < MAX_BATCH_RETRIES) { lastError = new Error(errorMsg); continue; }
              throw new Error(errorMsg || `第${toChineseNumber(batchIndex + 1)}批生成失败`);
            }

            if (!result.data?.success) {
              const errorMsg = result.data?.error || "";
              const isTimeout = errorMsg.includes("504") || errorMsg.includes("timeout") || errorMsg.includes("Gateway");
              if (isTimeout && attempt < MAX_BATCH_RETRIES) { lastError = new Error(errorMsg); continue; }
              throw new Error(errorMsg || `第${toChineseNumber(batchIndex + 1)}批生成失败`);
            }

            const batchSections = result.data.sections || [];
            localBatchResults[batchIndex] = batchSections;
            setBatchResults(prev => ({ ...prev, [batchIndex]: batchSections }));
            
            const hasWarning = result.data.warning;
            const retryNote = attempt > 0 ? `（重试${attempt}次后成功）` : "";
            updateStep(stepIndex, { 
              status: "completed", 
              detail: hasWarning 
                ? `${batchSections.length} 章节（部分超时）${retryNote}` 
                : `${batchSections.length} 章节完成${retryNote}`
            });

            batchSuccess = true;
            break;
          } catch (batchError) {
            lastError = batchError instanceof Error ? batchError : new Error(String(batchError));
            const isTimeout = lastError.message.includes("504") || lastError.message.includes("timeout") || lastError.message.includes("non-2xx") || lastError.message.includes("Gateway");
            if (isTimeout && attempt < MAX_BATCH_RETRIES) { continue; }
            break; // Non-retryable or exhausted retries
          }
        }

        if (!batchSuccess) {
          // Mark as failed but CONTINUE to next batch
          localFailedBatches.add(batchIndex);
          setFailedBatchIndices(prev => new Set([...prev, batchIndex]));
          const errorDetail = lastError?.message?.includes("504") || lastError?.message?.includes("timeout") || lastError?.message?.includes("Gateway")
            ? "AI 超时，可重试"
            : "生成失败，可重试";
          updateStep(stepIndex, { status: "error", detail: errorDetail });
          console.error(`[ChapterMapping] Batch ${batchIndex + 1} failed:`, lastError?.message);
        }
      }

      // Collect all sections from successful batches (in order)
      const allSections = Object.keys(localBatchResults)
        .map(Number)
        .sort((a, b) => a - b)
        .flatMap(k => localBatchResults[k]);

      const failCount = localFailedBatches.size;
      const successCount = Object.keys(localBatchResults).length;

      if (failCount > 0) {
        // Partial failure: save what we have, let user retry failed batches
        setErrorMessage(`${failCount} 个批次生成失败，${successCount} 个批次已成功`);

        if (allSections.length > 0) {
          const partialSummary = {
            totalIssues: allSections.reduce((acc, s) => acc + (s.issues?.length || 0), 0),
            highRiskCount: allSections.reduce((acc, s) => 
              acc + (s.issues?.filter(i => i.severity === "high").length || 0), 0),
          };

          const partialReport: AIGeneratedReport = {
            projectId: currentProjectId,
            projectName: project?.name || "",
            client: project?.client || "未提供",
            target: project?.target || "未提供",
            generatedAt: new Date().toISOString(),
            content: { sections: allSections },
            statistics: {
              totalFiles: files.length,
              totalChapters: flatChapters.length,
              filesByCategory: Object.fromEntries(
                Object.entries(categorizedFiles).map(([k, v]) => [k, v.length])
              ),
              issuesFound: partialSummary.totalIssues,
              highRiskIssues: partialSummary.highRiskCount,
            },
            equityStructure: reportMetadata?.equityStructure,
            definitions: reportMetadata?.definitions,
            files: files.map(f => ({
              id: f.id,
              name: f.original_name || f.name,
              type: f.file_type,
              category: categorizeFile(f.original_name || f.name),
            })),
          };

          setGeneratedReport(partialReport);
          localStorage.setItem("dd-ai-report", JSON.stringify(partialReport));
        }

        toast.error("部分批次生成失败", {
          description: `${successCount}/${totalBatches} 批成功，可点击重试失败批次`,
        });
      } else {
        // All batches succeeded!
        const analyzeStepIndex = totalBatches + 2;
        startStep(analyzeStepIndex, `统计 ${allSections.length} 个章节...`);
        
        const summary = {
          totalIssues: allSections.reduce((acc, s) => acc + (s.issues?.length || 0), 0),
          highRiskCount: allSections.reduce((acc, s) => 
            acc + (s.issues?.filter(i => i.severity === "high").length || 0), 0),
          mediumRiskCount: allSections.reduce((acc, s) => 
            acc + (s.issues?.filter(i => i.severity === "medium").length || 0), 0),
          lowRiskCount: allSections.reduce((acc, s) => 
            acc + (s.issues?.filter(i => i.severity === "low").length || 0), 0),
        };
        
        await new Promise(resolve => setTimeout(resolve, 500));

        updateStep(analyzeStepIndex, { 
          status: "completed", 
          detail: `发现 ${summary.totalIssues} 个问题` 
        });

        const completeStepIndex = totalBatches + 3;
        setGenerationSteps(prev => prev.map(s => ({ ...s, status: "completed" })));
        setCurrentStepIndex(completeStepIndex);

        const report: AIGeneratedReport = {
          projectId: currentProjectId,
          projectName: project?.name || "",
          client: project?.client || "未提供",
          target: project?.target || "未提供",
          generatedAt: new Date().toISOString(),
          content: { sections: allSections },
          statistics: {
            totalFiles: files.length,
            totalChapters: flatChapters.length,
            filesByCategory: Object.fromEntries(
              Object.entries(categorizedFiles).map(([k, v]) => [k, v.length])
            ),
            issuesFound: summary.totalIssues,
            highRiskIssues: summary.highRiskCount,
          },
          equityStructure: reportMetadata?.equityStructure,
          definitions: reportMetadata?.definitions,
          files: files.map(f => ({
            id: f.id,
            name: f.original_name || f.name,
            type: f.file_type,
            category: categorizeFile(f.original_name || f.name),
          })),
        };

        setGeneratedReport(report);
        
        localStorage.setItem("dd-ai-report", JSON.stringify(report));
        localStorage.setItem(`report_${currentProjectId}`, JSON.stringify({
          sections: allSections,
          metadata: reportMetadata,
          generatedAt: Date.now(),
        }));

        toast.success("报告生成成功", {
          description: `${allSections.length} 个章节，${summary.totalIssues} 个问题`,
        });

        // Clear batch tracking on full success
        setBatchResults({});
        setFailedBatchIndices(new Set());
        reportMetadataCacheRef.current = null;

        setTimeout(() => navigate("/preview"), 1500);
      }
    } catch (error) {
      // Non-batch errors (init, metadata, etc.)
      console.error("Generation error:", error);
      const errorMsg = error instanceof Error ? error.message : "请稍后重试";
      
      setErrorMessage(errorMsg);
      setGenerationSteps(prev => prev.map(s => ({
        ...s,
        status: s.status === "running" ? "error" : s.status
      })));
      
      toast.error("生成失败", { description: errorMsg });
    } finally {
      setIsGenerating(false);
    }
  };

  const isLoading = chaptersLoading || filesLoading;

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

  const isReady = files.length > 0 && flatChapters.length > 0;
  const overallProgress = generationSteps.length > 0
    ? (generationSteps.filter(s => s.status === "completed").length / generationSteps.length) * 100
    : 0;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-background">
        <div>
          <h1 className="text-lg font-semibold">AI 智能生成报告</h1>
          <p className="text-[13px] text-muted-foreground">
            分批处理，每批 {CHAPTERS_PER_BATCH} 个章节，共 {totalBatches} 批
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-4 text-[13px]">
            <div className="flex items-center gap-1.5">
              <FileText className="w-4 h-4 text-muted-foreground" />
              <span className="font-medium">{stats.totalFiles}</span>
              <span className="text-muted-foreground">文件</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-muted-foreground" />
              <span className="font-medium">{stats.totalChapters}</span>
              <span className="text-muted-foreground">章节</span>
            </div>
          </div>

          <div className="h-8 w-px bg-border" />

          <Button
            variant="outline"
            onClick={() => navigate("/preview")}
            className="gap-2"
          >
            报告预览
            <ArrowRight className="w-4 h-4" />
          </Button>

          <Button
            size="lg"
            onClick={handleGenerateReport}
            disabled={isGenerating || !isReady}
            className="gap-2 px-6"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                生成中...
              </>
            ) : failedBatchIndices.size > 0 ? (
              <>
                <RefreshCw className="w-4 h-4" />
                重试失败批次
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                开始生成
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Readiness Banner */}
      {!isReady && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-6 mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3"
        >
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
          <div className="flex-1">
            <div className="font-medium text-amber-900">准备工作未完成</div>
            <div className="text-[13px] text-amber-700 mt-1">
              {files.length === 0 && <p>• 请先上传尽调文件</p>}
              {flatChapters.length === 0 && <p>• 请先上传报告模板</p>}
            </div>
            <Button variant="outline" size="sm" onClick={() => navigate("/upload")} className="mt-3 gap-2">
              前往上传 <ArrowRight className="w-3 h-3" />
            </Button>
          </div>
        </motion.div>
      )}

      {/* Main Content */}
      <div className="flex-1 grid grid-cols-12 gap-0 min-h-0 mt-4">
        {/* Left: Files */}
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

        {/* Center: Progress */}
        <div className="col-span-4 flex flex-col bg-muted/10">
          <div className="px-4 py-3 border-b border-border bg-muted/30">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase">生成进度</span>
              {isGenerating && (
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Timer className="w-3 h-3" />
                  <span>{formatTime(elapsedTime)}</span>
                </div>
              )}
            </div>
          </div>
          
          <div className="flex-1 flex flex-col p-4 overflow-auto">
            {generationSteps.length > 0 ? (
              <>
                <div className="space-y-2">
                  {generationSteps.map((step, index) => {
                    const isActive = step.status === "running";
                    const isCompleted = step.status === "completed";
                    const isError = step.status === "error";
                    
                    return (
                      <motion.div
                        key={step.id}
                        initial={{ opacity: 0.5 }}
                        animate={{ opacity: step.status === "pending" ? 0.5 : 1 }}
                        className={cn(
                          "flex items-start gap-3 p-2.5 rounded-lg transition-all",
                          isActive && "bg-primary/10 border border-primary/30",
                          isCompleted && "bg-emerald-50/80",
                          isError && "bg-red-50 border border-red-200",
                          step.status === "pending" && "bg-muted/20"
                        )}
                      >
                        <div className={cn(
                          "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0",
                          isActive && "bg-primary text-white",
                          isCompleted && "bg-emerald-500 text-white",
                          isError && "bg-red-500 text-white",
                          step.status === "pending" && "bg-muted"
                        )}>
                          {isActive && <Loader2 className="w-3 h-3 animate-spin" />}
                          {isCompleted && <CheckCircle2 className="w-3 h-3" />}
                          {isError && <AlertTriangle className="w-3 h-3" />}
                          {step.status === "pending" && <span className="text-[10px] text-muted-foreground">{index + 1}</span>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className={cn(
                            "font-medium text-[12px]",
                            isActive && "text-primary",
                            isCompleted && "text-emerald-700",
                            isError && "text-red-700"
                          )}>
                            {step.title}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {step.detail || step.description}
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>

                {isGenerating && (
                  <div className="mt-4 p-3 bg-background rounded-lg border">
                    <div className="flex items-center justify-between text-[11px] mb-1.5">
                      <span className="text-muted-foreground">总进度</span>
                      <span className="font-medium">{Math.round(overallProgress)}%</span>
                    </div>
                    <Progress value={overallProgress} className="h-1.5" />
                  </div>
                )}
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                  <Brain className="w-7 h-7 text-primary" />
                </div>
                <h3 className="font-semibold text-[14px] mb-2">准备就绪</h3>
                <p className="text-[12px] text-muted-foreground max-w-[240px]">
                  {flatChapters.length} 章节将分 {totalBatches} 批生成
                </p>
              </div>
            )}

            {errorMessage && !isGenerating && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="font-medium text-red-900 text-[12px]">
                      {failedBatchIndices.size > 0 ? "部分批次生成失败" : "生成失败"}
                    </div>
                    <p className="text-[11px] text-red-700 mt-1">{errorMessage}</p>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <Button variant="outline" size="sm" onClick={handleGenerateReport} className="h-7 text-[11px] gap-1">
                        <RefreshCw className="w-3 h-3" />
                        {failedBatchIndices.size > 0 ? "重试失败批次" : "重试"}
                      </Button>
                      {failedBatchIndices.size > 0 && (
                        <Button variant="ghost" size="sm" onClick={handleRestartGeneration} className="h-7 text-[11px] gap-1 text-muted-foreground">
                          从头开始
                        </Button>
                      )}
                      {generatedReport && (
                        <Button variant="ghost" size="sm" onClick={() => navigate("/preview")} className="h-7 text-[11px] gap-1">
                          查看已生成内容 <ArrowRight className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {generatedReport && !isGenerating && !errorMessage && (
              <div className="mt-4 p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
                <div className="font-semibold text-emerald-900">生成完成</div>
                <p className="text-[12px] text-emerald-700 mt-1 mb-3">
                  用时 {formatTime(elapsedTime)}
                </p>
                <Button 
                  onClick={() => navigate("/preview")} 
                  className="gap-2"
                >
                  进入报告预览
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            )}

            {/* Always show navigation button when not generating */}
            {!isGenerating && !generatedReport && generationSteps.length > 0 && (
              <div className="mt-4 pt-4 border-t border-border">
                <Button 
                  variant="outline"
                  onClick={() => navigate("/preview")} 
                  className="w-full gap-2"
                >
                  前往报告预览
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Right: Chapters */}
        <div className="col-span-3 border-l border-border flex flex-col">
          <div className="px-4 py-3 border-b border-border bg-muted/30">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase">章节结构</span>
              <span className="text-[11px] text-muted-foreground">{flatChapters.length} 章</span>
            </div>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-1">
              {flatChapters.map((chapter, index) => {
                const batchNum = Math.floor(index / CHAPTERS_PER_BATCH);
                const colors = ["text-blue-600", "text-purple-600", "text-emerald-600", "text-amber-600"];
                const bgColors = ["hover:bg-blue-50/50", "hover:bg-purple-50/50", "hover:bg-emerald-50/50", "hover:bg-amber-50/50"];
                
                return (
                  <div
                    key={chapter.id}
                    className={cn(
                      "flex items-center gap-2 py-1.5 px-2 rounded text-[11px]",
                      chapter.level === 1 && "font-medium",
                      chapter.level === 2 && "ml-3 text-muted-foreground",
                      chapter.level === 3 && "ml-6 text-muted-foreground text-[10px]",
                      bgColors[batchNum % bgColors.length]
                    )}
                  >
                    <ChevronRight className={cn(
                      "w-3 h-3 flex-shrink-0",
                      chapter.level === 1 ? colors[batchNum % colors.length] : "text-muted-foreground/50"
                    )} />
                    <span className="font-mono text-[9px] text-muted-foreground w-6">{chapter.number}</span>
                    <span className="truncate">{chapter.title}</span>
                  </div>
                );
              })}
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
