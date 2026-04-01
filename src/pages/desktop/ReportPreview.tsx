import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  AlertTriangle,
  FileText,
  Download,
  File,
  Loader2,
  BookOpen,
  Shield,
  Sparkles,
  BarChart3,
  RefreshCw,
  Brain,
  AlertCircle,
  PanelRight,
  PanelRightClose,
  Percent,
  FileCode,
  FileWarning,
  ArrowRight,
  ArrowLeft,
  Lock,
  Unlock,
  Palette,
} from "lucide-react";
import { useCurrentProject } from "@/hooks/useProjects";
import { useFlatChapters } from "@/hooks/useChapters";
import { useFiles } from "@/hooks/useFiles";
import { useMappings } from "@/hooks/useMappings";
import { useDefinitions, Definition } from "@/hooks/useDefinitions";
import { useLatestGeneratedReport, usePersistGeneratedReport } from "@/hooks/useGeneratedReports";
import { EquityChart } from "@/components/desktop/EquityChart";
import { DefinitionsTable } from "@/components/desktop/DefinitionsTable";
import { MarkdownRenderer } from "@/components/desktop/MarkdownRenderer";
import { supabase } from "@/integrations/supabase/client";
import { useTemplateFingerprint } from "@/hooks/useTemplateFingerprint";
import { useTemplateStyles } from "@/hooks/useTemplateStyles";
import { normalizeTemplateStyle, type TemplateStyle } from "@/lib/templateStyles";
import { normalizeSupabaseError } from "@/lib/errorUtils";
import { exportToPDF, exportToWord } from "@/lib/exportUtils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Types for AI-generated content
interface ReportSection {
  id: string;
  title: string;
  number: string;
  content: string;
  findings: string[];
  issues: Array<{
    fact: string;
    risk: string;
    suggestion: string;
    severity: "high" | "medium" | "low";
  }>;
  // sourceFiles 移除：证据来源由 chapter_file_mappings 驱动
  locked?: boolean; // 锁定状态，锁定后重新生成时跳过
}

interface ReportMetadata {
  equityStructure: {
    companyName: string;
    shareholders: Array<{
      name: string;
      percentage: number;
      type: "individual" | "company" | "team";
      notes?: string;
    }>;
    notes: string[];
  };
  definitions: Array<{
    name: string;
    shortName: string;
    description?: string;
  }>;
}

// Introduction Template - Fixed content with project variables
function IntroductionSection({
  project,
  fileCount
}: {
  project: { name: string; target?: string; client?: string };
  fileCount: number;
}) {
  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="text-[13px] leading-relaxed text-foreground/90 space-y-4">
      <p className="text-justify">
        受<strong>{project.client || "[委托方]"}</strong>（以下简称"委托方"）委托，本所律师对<strong>{project.target || project.name}</strong>（以下简称"目标公司"或"公司"）进行法律尽职调查，并出具本法律尽职调查报告（以下简称"本报告"）。
      </p>

      <div>
        <p className="font-medium mb-2">一、报告依据</p>
        <p className="text-justify">
          本报告依据委托方提供的数据室文件及相关补充材料编制。本次尽职调查采用文件审阅、访谈核实等方式进行，未对文件的真实性、完整性进行独立核验。
        </p>
      </div>

      <div>
        <p className="font-medium mb-2">二、尽调范围</p>
        <p className="text-justify">
          本次法律尽职调查涵盖目标公司的基本情况、股权结构、主要资产、知识产权、重大合同、劳动人事、诉讼仲裁、合规运营等方面。本报告基于截至{today}收到的数据室文件（共{fileCount}份）进行分析。
        </p>
      </div>

      <div>
        <p className="font-medium mb-2">三、免责声明</p>
        <ul className="list-decimal pl-5 space-y-1">
          <li>本报告仅供委托方内部决策参考使用，未经本所书面同意，不得向任何第三方披露或提供。</li>
          <li>本报告中的法律意见基于现行有效的中国法律法规，如相关法律法规发生变化，本所不承担更新义务。</li>
          <li>本报告的结论基于委托方及目标公司提供的文件资料，如相关文件存在遗漏、不完整或不真实，本所不对由此产生的后果承担责任。</li>
        </ul>
      </div>
    </div>
  );
}

// Definitions Section - Use database definitions
function DefinitionsSection({
  definitions
}: {
  definitions: Definition[];
}) {
  // Group by entity type
  const groupedDefs = definitions.reduce((acc, def) => {
    const type = def.entityType;
    if (!acc[type]) acc[type] = [];
    acc[type].push(def);
    return acc;
  }, {} as Record<string, Definition[]>);

  const typeLabels: Record<string, string> = {
    company: "公司主体",
    individual: "自然人",
    institution: "机构",
    transaction: "交易相关",
    other: "其他",
  };

  const orderedTypes = ["company", "individual", "institution", "transaction", "other"];

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-foreground/90 mb-4">
        除非上下文另有说明，本报告所使用的下列术语具有如下含义：
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse border border-border text-[12px]">
          <thead>
            <tr className="bg-muted">
              <th className="border border-border p-2 w-12 text-center">序号</th>
              <th className="border border-border p-2 w-48 text-left">简称</th>
              <th className="border border-border p-2 text-left">全称/定义</th>
            </tr>
          </thead>
          <tbody>
            {orderedTypes.map(type => {
              const defs = groupedDefs[type];
              if (!defs || defs.length === 0) return null;
              return defs.map((def, idx) => (
                <tr key={def.id}>
                  <td className="border border-border p-2 text-center text-muted-foreground">
                    {definitions.findIndex(d => d.id === def.id) + 1}
                  </td>
                  <td className="border border-border p-2 font-medium">{def.shortName}</td>
                  <td className="border border-border p-2">{def.fullName}</td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Equity Structure Section - Visual Chart
function EquityStructureSection({
  metadata
}: {
  metadata: ReportMetadata | null;
}) {
  if (!metadata?.equityStructure?.shareholders?.length) {
    return (
      <div className="p-4 bg-amber-50 border border-amber-200 rounded">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-[13px] text-amber-900">
            股权结构信息尚未提取，请确保数据室中包含工商登记、公司章程等相关文件。
          </div>
        </div>
      </div>
    );
  }

  // Transform for EquityChart component
  const chartData = {
    companyName: metadata.equityStructure.companyName,
    shareholders: metadata.equityStructure.shareholders.map((sh, idx) => ({
      id: `sh-${idx}`,
      name: sh.name,
      percentage: sh.percentage,
      type: sh.type,
      notes: sh.notes,
    })),
    notes: metadata.equityStructure.notes || [],
  };

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-foreground/90">
        根据工商登记信息及相关文件核查，<strong>{chartData.companyName}</strong>的股权结构如下：
      </p>
      <EquityChart data={chartData} />
    </div>
  );
}

// Section Renderer Component
function SectionRenderer({
  section,
  mappedFiles,
  metadata,
  project,
  fileCount,
  definitions,
  onRetry,
  isRetrying,
  templateStyle,
  onUploadClick,
  isLocked,
  onToggleLock,
}: {
  section: ReportSection;
  mappedFiles: Array<{ name: string; id: string }>; // 从 chapter_file_mappings 获取
  metadata?: ReportMetadata | null;
  project?: { name: string; target?: string; client?: string } | null;
  fileCount?: number;
  definitions?: Definition[];
  onRetry?: (sectionId: string, sectionTitle: string) => void;
  isRetrying?: boolean;
  templateStyle?: TemplateStyle;
  onUploadClick?: (sectionTitle: string) => void;
  isLocked?: boolean;
  onToggleLock?: (sectionId: string) => void;
}) {
  const hasIssues = section.issues && section.issues.length > 0;
  const hasFindings = section.findings && section.findings.length > 0;
  // 判断无数据：改为基于 mappedFiles（来自 chapter_file_mappings）
  const hasNoData = section.content.includes("暂无") || mappedFiles.length === 0;

  // Check if section failed due to timeout
  const isTimeoutError = section.content.includes("超时") || section.content.includes("请重试");

  // Check section types for special rendering
  const isIntroSection = section.title.includes("引言") || section.title === "引言";
  const isDefinitionSection = section.title.includes("定义") || section.title.includes("释义") || section.title === "定义";
  const isEquitySection = section.title.includes("股权结构") || section.title.includes("股权架构");

  // Get styles from template or use defaults
  const styles = templateStyle?.styles;
  const headerColor = templateStyle?.preview.primaryColor || "#000";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="bg-card border border-border rounded shadow-sm p-10"
    >
      {/* Section Header */}
      <div className="mb-6 pb-4 border-b-2" style={{ borderColor: headerColor }}>
        <div className="flex items-center justify-between">
          <h2
            className="font-bold text-foreground"
            style={{
              fontFamily: styles?.h1.font || "inherit",
              fontSize: styles ? `${styles.h1.sizePt}pt` : "1.25rem",
              color: styles?.h1.color || "inherit",
            }}
          >
            {section.number && section.number !== section.title && `${section.number} `}
            {section.title}
          </h2>
          <div className="flex items-center gap-3">
            {hasNoData ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onUploadClick?.(section.title)}
                className="h-7 gap-1.5 text-amber-600 border-amber-300 hover:bg-amber-50 hover:text-amber-700"
              >
                <FileWarning className="w-3 h-3" />
                待补充资料
              </Button>
            ) : (
              <Badge variant="outline" className="text-emerald-600 border-emerald-300">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                已核查
              </Badge>
            )}
            {mappedFiles.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                <File className="w-3 h-3 mr-1" />
                {mappedFiles.length} 份证据
              </Badge>
            )}
            {/* Lock button */}
            {onToggleLock && !isIntroSection && !isDefinitionSection && (
              <Button
                size="sm"
                variant={isLocked ? "default" : "ghost"}
                onClick={() => onToggleLock(section.id)}
                className={cn(
                  "h-7 gap-1.5",
                  isLocked
                    ? "bg-amber-500 hover:bg-amber-600 text-white"
                    : "text-muted-foreground hover:text-foreground"
                )}
                title={isLocked ? "点击解锁，允许重新生成" : "点击锁定，防止重新生成"}
              >
                {isLocked ? (
                  <Lock className="w-3 h-3" />
                ) : (
                  <Unlock className="w-3 h-3" />
                )}
                {isLocked ? "已锁定" : "锁定"}
              </Button>
            )}
            {/* Retry button - disabled when locked */}
            {onRetry && !isIntroSection && !isDefinitionSection && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onRetry(section.id, section.title)}
                disabled={isRetrying || isLocked}
                className={cn(
                  "h-7 gap-1.5",
                  isLocked
                    ? "text-muted-foreground/50 cursor-not-allowed"
                    : "text-muted-foreground hover:text-foreground"
                )}
                title={isLocked ? "章节已锁定，无法重新生成" : "重新生成此章节"}
              >
                {isRetrying ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <RefreshCw className="w-3 h-3" />
                )}
                {isRetrying ? "重新生成中..." : "重新生成"}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="space-y-4">
        {/* Special rendering based on section type */}
        {isIntroSection && project ? (
          // Introduction - Use fixed template
          <IntroductionSection project={project} fileCount={fileCount || 0} />
        ) : isDefinitionSection && definitions && definitions.length > 0 ? (
          // Definitions - Use database definitions
          <DefinitionsSection definitions={definitions} />
        ) : isEquitySection ? (
          // Equity Structure - Use visual chart
          <EquityStructureSection metadata={metadata || null} />
        ) : hasNoData ? (
          // No data placeholder with upload button
          <div className="p-6 bg-amber-50 border border-amber-200 rounded">
            <div className="flex items-start gap-4">
              <AlertCircle className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="text-[13px] text-amber-900 font-medium mb-2">
                  尚未获取到「{section.title}」相关的完整资料
                </div>
                <div className="text-[12px] text-amber-700 mb-4">
                  <MarkdownRenderer content={section.content} />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onUploadClick?.(section.title)}
                  className="gap-1.5 text-amber-700 border-amber-300 hover:bg-amber-100"
                >
                  <ArrowRight className="w-3 h-3" />
                  补充资料
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div
            className="text-foreground/90"
            style={{
              fontFamily: styles?.body.font || "inherit",
              fontSize: styles ? `${styles.body.sizePt}pt` : "13px",
              lineHeight: styles?.body.lineSpacing || 1.6,
            }}
          >
            <MarkdownRenderer content={section.content} />
          </div>
        )}

        {/* Findings */}
        {hasFindings && !hasNoData && (
          <div className="mt-6 p-4 bg-blue-50 border border-blue-100 rounded">
            <div className="flex items-start gap-3">
              <BookOpen className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-medium text-[13px] text-blue-900 mb-2">核查发现</div>
                <ul className="list-disc pl-5 space-y-1 text-[12px] text-blue-800">
                  {section.findings.map((finding, idx) => (
                    <li key={idx}>{finding}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Issues Table */}
        {hasIssues && (
          <div className="mt-6">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <span className="font-medium text-[13px] text-amber-700">发现的问题与风险</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse border border-border text-[12px]">
                <thead>
                  <tr className="bg-amber-50">
                    <th className="border border-border p-2 w-10 text-center">序号</th>
                    <th className="border border-border p-2 text-left">事实</th>
                    <th className="border border-border p-2 text-left">问题/风险</th>
                    <th className="border border-border p-2 w-32 text-left">建议</th>
                    <th className="border border-border p-2 w-16 text-center">级别</th>
                  </tr>
                </thead>
                <tbody>
                  {section.issues.map((issue, idx) => (
                    <tr key={idx}>
                      <td className="border border-border p-2 text-center text-muted-foreground">{idx + 1}</td>
                      <td className="border border-border p-2">{issue.fact}</td>
                      <td className="border border-border p-2">{issue.risk}</td>
                      <td className="border border-border p-2">{issue.suggestion}</td>
                      <td className="border border-border p-2 text-center">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px]",
                            issue.severity === "high" && "border-red-300 text-red-600 bg-red-50",
                            issue.severity === "medium" && "border-amber-300 text-amber-600 bg-amber-50",
                            issue.severity === "low" && "border-blue-300 text-blue-600 bg-blue-50"
                          )}
                        >
                          {issue.severity === "high" ? "高" : issue.severity === "medium" ? "中" : "低"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {!hasIssues && !hasNoData && (
          <div className="mt-6 p-3 bg-emerald-50 border border-emerald-100 rounded text-[12px] text-emerald-800">
            未发现明显问题，如需复核可结合证据文件进一步核查。
          </div>
        )}
      </div>
    </motion.div>
  );
}

// Main Report Preview Component
export default function ReportPreview() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();

  // Data hooks
  const { data: currentProject, isLoading: isProjectLoading } = useCurrentProject(projectId);
  const { data: flatChapters = [], isLoading: isChaptersLoading } = useFlatChapters(projectId);
  const { data: files = [], isLoading: isFilesLoading } = useFiles(projectId);
  const { data: mappings = [], isLoading: isMappingsLoading } = useMappings(projectId);
  const { data: definitions = [] } = useDefinitions(projectId);
  const { data: latestReport, isLoading: isReportLoading } = useLatestGeneratedReport(projectId);
  const {
    templateFingerprint,
    isLoading: isTemplateLoading,
    initializeTemplate,
    updateSelectedStyle,
  } = useTemplateFingerprint(projectId);
  const {
    data: templateStyles = [],
    isLoading: isStylesLoading,
  } = useTemplateStyles(projectId);
  const persistGeneratedReport = usePersistGeneratedReport();

  const hasInitializedRef = useRef(false);
  useEffect(() => {
    if (!templateFingerprint && !isTemplateLoading && projectId && !hasInitializedRef.current) {
      hasInitializedRef.current = true;
      initializeTemplate().catch((error) => {
        console.error("[ReportPreview] Initialize template failed:", error);
        toast.error("初始化模板失败，请稍后重试");
      });
    }
  }, [templateFingerprint, isTemplateLoading, projectId, initializeTemplate]);

  const currentTemplate = templateFingerprint || null;
  const [localSelectedStyleId, setLocalSelectedStyleId] = useState<string | null>(null);
  const selectedStyleId =
    localSelectedStyleId || currentTemplate?.selectedStyleId || (templateStyles.length > 0 ? templateStyles[0].id : null);

  const fallbackStyle: TemplateStyle = useMemo(
    () => ({
      id: "fallback",
      projectId: projectId || "",
      name: "标准模板",
      description: null,
      preview: {
        primaryColor: "#111827",
        accentColor: "#374151",
        fontFamily: "宋体",
        headerStyle: "classic",
      },
      styles: {},
      tables: {},
      page: {},
    }),
    [projectId]
  );

  const currentStyle = useMemo<TemplateStyle>(() => {
    const rawStyle =
      templateStyles.find((style) => style.id === selectedStyleId)
      || templateStyles[0]
      || fallbackStyle;
    return normalizeTemplateStyle(rawStyle);
  }, [templateStyles, selectedStyleId, fallbackStyle]);

  useEffect(() => {
    if (localSelectedStyleId) return;
    if (currentTemplate?.selectedStyleId) {
      setLocalSelectedStyleId(currentTemplate.selectedStyleId);
      return;
    }
    if (templateStyles.length > 0) {
      setLocalSelectedStyleId(templateStyles[0].id);
    }
  }, [currentTemplate?.selectedStyleId, templateStyles, localSelectedStyleId]);

  useEffect(() => {
    if (!currentTemplate || currentTemplate.selectedStyleId || templateStyles.length === 0) return;
    updateSelectedStyle(templateStyles[0].id).catch(() => { });
  }, [currentTemplate, templateStyles, updateSelectedStyle]);

  const handleSelectStyle = useCallback(
    (styleId: string) => {
      if (selectedStyleId === styleId) return;
      const previous = selectedStyleId;
      setLocalSelectedStyleId(styleId);
      updateSelectedStyle(styleId)
        .then((data) => {
          setLocalSelectedStyleId(null);
          console.info("[ReportPreview] style selection saved", { styleId, projectId });
          toast.success("已切换模板样式", { description: "样式选择已保存" });
        })
        .catch((error) => {
          console.warn("[ReportPreview] style selection failed", error);
          setLocalSelectedStyleId(previous || null);
          toast.error("保存失败，已回滚", { description: "无法保存模板样式选择" });
        });
    },
    [selectedStyleId, updateSelectedStyle, projectId]
  );

  // 基于 chapter_file_mappings 构建章节-文件映射表
  const chapterFilesMap = useMemo(() => {
    const map = new Map<string, Array<{ name: string; id: string }>>();
    for (const mapping of mappings) {
      const chapterId = mapping.chapterId;
      const file = files.find(f => f.id === mapping.fileId);
      if (file) {
        const existing = map.get(chapterId) || [];
        existing.push({ name: file.originalName, id: file.id });
        map.set(chapterId, existing);
      }
    }
    return map;
  }, [mappings, files]);

  // State for generated report
  const [sections, setSections] = useState<ReportSection[]>([]);
  const [metadata, setMetadata] = useState<ReportMetadata | null>(null);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [isGenerating] = useState(false);

  // Helper to normalize issue fields (handle both English and Chinese field names, and strings)
  const normalizeSeverity = (value: unknown): "high" | "medium" | "low" => {
    if (typeof value === "string") {
      const normalized = value.toLowerCase();
      if (normalized === "high" || normalized === "高") return "high";
      if (normalized === "medium" || normalized === "中" || normalized === "中等") return "medium";
      if (normalized === "low" || normalized === "低") return "low";
    }
    return "low";
  };

  const normalizeIssue = (issue: unknown) => {
    if (typeof issue === "string") {
      const str = issue.trim();
      let severity: "high" | "medium" | "low" = "low";
      if (str.includes("重大") || str.includes("严重") || str.includes("违法")) {
        severity = "high";
      } else if (str.includes("风险") || str.includes("问题") || str.includes("隐患")) {
        severity = "medium";
      }

      let fact = str;
      let risk = "";
      let suggestion = "";

      if (str.startsWith("经核查") || str.includes("核查发现") || str.includes("目标公司")) {
        fact = str;
        if (str.includes("未能提供") || str.includes("未提供") || str.includes("���失")) {
          risk = "由于相关资料缺失，无法全面核实相关合规情况，存在潜在的法律风险";
          suggestion = "建议补充提供相关资料以便进一步核查";
        } else if (str.includes("无法") || str.includes("不能")) {
          risk = "存在核查不完整的风险，可能遗漏重要法律问题";
          suggestion = "建议进一步核实并补充相关证明文件";
        } else {
          risk = "上述情况可能存在潜在的法律或合规风险";
          suggestion = "建议关注并进行进一步核查";
        }
      } else if (str.includes("风险") || str.includes("问题") || str.includes("隐患")) {
        fact = "经核查，发现以下情况";
        risk = str;
        suggestion = "建议关注上述风险并采取相应的风险防控措施";
      } else if (str.includes("建议") || str.includes("应当") || str.includes("需要")) {
        fact = "经核查，发现需要关注的事项";
        risk = "如不采取相应措施，可能存在潜在风险";
        suggestion = str;
      } else {
        fact = str;
        risk = "上述情况需要进一步关注";
        suggestion = "建议进行详细核查并评估潜在影响";
      }
      return { fact, risk, suggestion, severity };
    }

    if (typeof issue === "object" && issue !== null) {
      const obj = issue as Record<string, unknown>;
      const fact = String(obj.fact || obj.事实 || obj.description || "");
      const risk = String(obj.risk || obj.风险 || obj.问题 || obj.problem || "");
      const suggestion = String(obj.suggestion || obj.建议 || obj.advice || obj.recommendation || "");
      const severity = normalizeSeverity(obj.severity || obj.级别 || obj.level);
      return {
        fact: fact || (risk ? "经核查，发现以下情况" : ""),
        risk: risk || (fact ? "上述情况可能存在潜在风险" : ""),
        suggestion: suggestion || "建议关注并进行进一步核查",
        severity,
      };
    }

    return { fact: String(issue), risk: "上述情况需要进一步关注", suggestion: "建议进行详细核查", severity: "low" as const };
  };

  // Load report data from database
  useEffect(() => {
    if (!latestReport?.reportJson) return;

    const reportJson = latestReport.reportJson as { sections?: unknown[]; metadata?: unknown };
    if (!reportJson.sections || !Array.isArray(reportJson.sections)) return;

    const rawSections = reportJson.sections as ReportSection[];

    const normalizedSections: ReportSection[] = rawSections.map((section) => {
      // Normalize issues - filter out empty ones (handle both object and string formats)
      const normalizedIssues = Array.isArray(section.issues)
        ? section.issues.map((issue) => normalizeIssue(issue))
          .filter((issue) => issue.fact || issue.risk || issue.suggestion)
        : [];

      // Normalize findings - handle both string and object formats
      const normalizedFindings = Array.isArray(section.findings)
        ? section.findings.map((finding) => {
          if (typeof finding === "string") return finding;
          if (typeof finding === "object" && finding !== null) {
            const f = finding as Record<string, unknown>;
            if (f.item) return String(f.item);
            if (f.detail) return String(f.detail);
            if (f.text) return String(f.text);
            if (f.content) return String(f.content);
            return JSON.stringify(finding);
          }
          return String(finding);
        })
        : [];

      return {
        id: section.id,
        title: section.title || "",
        number: section.number || "",
        content: section.content || "",
        findings: normalizedFindings,
        issues: normalizedIssues,
        // sourceFiles 移除：证据来源由 chapter_file_mappings 驱动
      };
    });

    let loadedMetadata: ReportMetadata | null = null;
    if (reportJson.metadata && typeof reportJson.metadata === "object") {
      loadedMetadata = reportJson.metadata as ReportMetadata;
    } else {
      const legacy = reportJson as { equityStructure?: ReportMetadata["equityStructure"]; definitions?: ReportMetadata["definitions"] };
      if (legacy.equityStructure || legacy.definitions) {
        loadedMetadata = {
          equityStructure: legacy.equityStructure || { companyName: "", shareholders: [], notes: [] },
          definitions: legacy.definitions || [],
        };
      }
    }

    const sortedSections = sortSectionsByChapterOrder(normalizedSections);
    setSections(sortedSections);
    setMetadata(loadedMetadata);
    setHasGenerated(sortedSections.length > 0);
  }, [latestReport, flatChapters]);

  // Helper function to sort sections by chapter order
  const sortSectionsByChapterOrder = (sectionsToSort: ReportSection[]): ReportSection[] => {
    if (flatChapters.length === 0) return sectionsToSort;
    const chapterOrderMap = new Map(flatChapters.map((ch, idx) => [ch.id, idx]));
    return [...sectionsToSort].sort((a, b) => {
      const orderA = chapterOrderMap.get(a.id) ?? Infinity;
      const orderB = chapterOrderMap.get(b.id) ?? Infinity;
      return orderA - orderB;
    });
  };

  // Calculate total issues
  const totalIssues = useMemo(() => {
    return sections.reduce((sum, s) => sum + (s.issues?.length || 0), 0);
  }, [sections]);

  // Calculate high risk issues
  const highRiskCount = useMemo(() => {
    return sections.reduce((sum, s) =>
      sum + (s.issues?.filter(i => i.severity === "high").length || 0), 0);
  }, [sections]);

  // Persist report data to database
  const saveReportData = async (newSections: ReportSection[], newMetadata: ReportMetadata | null) => {
    if (!projectId || !latestReport) return;

    const baseJson = (latestReport.reportJson || {}) as Record<string, unknown>;
    const nextReportJson = {
      ...baseJson,
      sections: newSections,
      metadata: newMetadata,
      generatedAt: new Date().toISOString(),
    };

    try {
      await persistGeneratedReport.mutateAsync({
        reportId: latestReport.id,
        projectId,
        reportJson: nextReportJson,
        summaryJson: latestReport.summaryJson,
      });
    } catch (err) {
      console.warn("[ReportPreview] Failed to persist report data:", err);
    }
  };

  // UI state
  const [activeSectionId, setActiveSectionId] = useState<string>("");
  const [showEvidenceSidebar, setShowEvidenceSidebar] = useState(true);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<"docx" | "pdf" | "html">("docx");
  const [includeAppendix, setIncludeAppendix] = useState(true);
  const [includeToc, setIncludeToc] = useState(true);

  // Retry state for failed sections
  const [retryingSectionId, setRetryingSectionId] = useState<string | null>(null);

  // Locked sections state - persisted to localStorage per project
  const lockedSectionsKey = `locked-sections-${projectId}`;

  // Initialize locked sections from localStorage
  const [lockedSectionIds, setLockedSectionIds] = useState<Set<string>>(() => {
    if (!projectId) return new Set();
    try {
      const stored = localStorage.getItem(lockedSectionsKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          return new Set(parsed);
        }
      }
    } catch (e) {
      console.error("Failed to load locked sections from localStorage:", e);
    }
    return new Set();
  });

  // Persist locked sections to localStorage whenever they change
  useEffect(() => {
    if (!projectId) return;
    try {
      const arrayData = Array.from(lockedSectionIds);
      localStorage.setItem(lockedSectionsKey, JSON.stringify(arrayData));
    } catch (e) {
      console.error("Failed to save locked sections to localStorage:", e);
    }
  }, [lockedSectionIds, lockedSectionsKey, projectId]);

  // Toggle lock state for a section
  const handleToggleLock = (sectionId: string) => {
    setLockedSectionIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(sectionId)) {
        newSet.delete(sectionId);
        toast.info("章节已解锁，可以重新生成");
      } else {
        newSet.add(sectionId);
        toast.success("章节已锁定，重新生成时将跳过此章节");
      }
      return newSet;
    });
  };

  // Calculate file statistics
  const fileStats = useMemo(() => {
    if (!files.length) return null;
    const filesWithOcr = files.filter(f => f.extractedText || f.textSummary).length;
    return {
      totalFiles: files.length,
      filesWithOcr,
      coveragePercentage: Math.round((filesWithOcr / files.length) * 100)
    };
  }, [files]);

  // Get active section
  const activeSection = useMemo(() => {
    if (!activeSectionId && sections.length > 0) {
      return sections[0];
    }
    return sections.find(s => s.id === activeSectionId) || sections[0];
  }, [activeSectionId, sections]);

  // 获取当前章节关联的文件（从 chapter_file_mappings 获取）
  const activeSectionFiles = useMemo(() => {
    if (!activeSection) return [];
    return chapterFilesMap.get(activeSection.id) || [];
  }, [activeSection, chapterFilesMap]);

  // Set initial active section
  useEffect(() => {
    if (sections.length > 0 && !activeSectionId) {
      setActiveSectionId(sections[0].id);
    }
  }, [sections, activeSectionId]);

  // Retry a single failed section with timeout protection
  const handleRetrySection = async (sectionId: string, sectionTitle: string) => {
    if (!projectId) return;

    // Check if section is locked
    if (lockedSectionIds.has(sectionId)) {
      toast.warning(`章节「${sectionTitle}」已锁定，无法重新生成`);
      return;
    }

    // Prevent multiple simultaneous retries
    if (retryingSectionId) {
      toast.warning("请等待当前重试完成");
      return;
    }

    console.log("[ReportPreview] Starting retry for section:", sectionId, sectionTitle);
    setRetryingSectionId(sectionId);

    // Timeout protection - auto-clear after 120s (backend timeout is 90s)
    const timeoutId = setTimeout(() => {
      console.warn("[ReportPreview] Retry timeout, clearing state");
      setRetryingSectionId(null);
      toast.error("重试超时，请稍后再试");
    }, 120000);

    try {
      toast.info(`正在重新生成「${sectionTitle}」...`);

      // Get current session for JWT auth
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error("请重新登录后再试");
      }

      // Find the chapter info for this section
      const chapter = flatChapters.find(c => c.id === sectionId || c.title === sectionTitle);

      const { data, error } = await supabase.functions.invoke("generate-report", {
        body: {
          projectId,
          mode: "single",
          chapterId: sectionId,
          chapterTitle: sectionTitle,
          chapterNumber: chapter?.number || "",
        },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      // Clear timeout on response
      clearTimeout(timeoutId);

      console.log("[ReportPreview] Retry response:", { success: data?.success, error, data });

      // Handle Supabase invoke error
      if (error) throw error;

      // Handle API-level error (success: false)
      if (data?.success === false) {
        throw new Error(data?.error || "生成失败，请稍后重试");
      }

      // 跳过（无关联文件）
      if (data?.skipped === true) {
        toast.warning(`「${sectionTitle}」无关联文件，已跳过生成。请在文件映射页面为该章节关联相关文件`);
        return;
      }

      // 后端返回 warning 说明 AI 调用失败（如 504）
      if (data?.warning) {
        throw new Error(`AI 服务异常，请稍后重试`);
      }

      if (data?.section) {
        // Helper to normalize issue fields (handle both objects and strings)
        // Reuse the same logic as the main normalizeIssue function
        const normalizeIssueRetry = (issue: unknown) => {
          if (typeof issue === "string") {
            const str = issue.trim();
            let severity: "high" | "medium" | "low" = "low";
            if (str.includes("重大") || str.includes("严重") || str.includes("违法")) {
              severity = "high";
            } else if (str.includes("风险") || str.includes("问题") || str.includes("隐患")) {
              severity = "medium";
            }

            let fact = str;
            let risk = "";
            let suggestion = "";

            if (str.startsWith("经核查") || str.includes("核查发现") || str.includes("目标公司")) {
              fact = str;
              if (str.includes("未能提供") || str.includes("未提供") || str.includes("缺失")) {
                risk = "由于相关资料缺失，无法全面核实相关合规情况，存在潜在的法律风险";
                suggestion = "建议补充提供相关资料以便进一步核查";
              } else if (str.includes("无法") || str.includes("不能")) {
                risk = "存在核查不完整的风险，可能遗漏重要法律问题";
                suggestion = "建议进一步核实并补充相关证明文件";
              } else {
                risk = "上述情况可能存在潜在的法律或合规风险";
                suggestion = "建议关注并进行进一步核查";
              }
            } else if (str.includes("风险") || str.includes("问题") || str.includes("隐患")) {
              fact = "经核查，发现以下情况";
              risk = str;
              suggestion = "建议关注上述风险并采取相应的风险防控措施";
            } else if (str.includes("建议") || str.includes("应当") || str.includes("需要")) {
              fact = "经核查，发现需要关注的事项";
              risk = "如不采取相应措施，可能存在潜在风险";
              suggestion = str;
            } else {
              fact = str;
              risk = "上述情况需要进一步关注";
              suggestion = "建议进行详细核查并评估潜在影响";
            }
            return { fact, risk, suggestion, severity };
          }
          if (typeof issue === "object" && issue !== null) {
            const obj = issue as Record<string, unknown>;
            const fact = String(obj.fact || obj.事实 || obj.description || "");
            const risk = String(obj.risk || obj.风险 || obj.问题 || obj.problem || "");
            const suggestion = String(obj.suggestion || obj.建议 || obj.advice || obj.recommendation || "");
            const severity = normalizeSeverity(obj.severity || obj.级别 || obj.level);
            return {
              fact: fact || (risk ? "经核查，发现以下情况" : ""),
              risk: risk || (fact ? "上述情况可能存在潜在风险" : ""),
              suggestion: suggestion || "建议关注并进行进一步核查",
              severity,
            };
          }
          return { fact: String(issue), risk: "上述情况需要进一步关注", suggestion: "建议进行详细核查", severity: "low" as const };
        };

        // Normalize issues from AI response
        const normalizedIssues = Array.isArray(data.section.issues)
          ? data.section.issues.map((issue: unknown) => normalizeIssueRetry(issue))
            .filter((issue: { fact: string; risk: string; suggestion: string }) => issue.fact || issue.risk || issue.suggestion)
          : [];

        console.log("[v0] Retry section issues:", data.section.issues, "normalized:", normalizedIssues);

        // Normalize findings - handle both string and object formats
        const normalizedFindings = Array.isArray(data.section.findings)
          ? data.section.findings.map((finding: unknown) => {
            if (typeof finding === "string") return finding;
            if (typeof finding === "object" && finding !== null) {
              const f = finding as Record<string, unknown>;
              if (f.item) return String(f.item);
              if (f.detail) return String(f.detail);
              if (f.text) return String(f.text);
              if (f.content) return String(f.content);
              return JSON.stringify(finding);
            }
            return String(finding);
          })
          : [];

        // Ensure all required fields have defaults
        const newSection: ReportSection = {
          id: sectionId,
          title: data.section.title || sectionTitle,
          number: data.section.number || "",
          content: data.section.content || "",
          findings: normalizedFindings,
          issues: normalizedIssues,
          // sourceFiles 移除：证据来源由 chapter_file_mappings 驱动
        };
        // Update section and persist to database
        let updatedSections: ReportSection[] = [];
        setSections(prevSections => {
          updatedSections = prevSections.map(s => s.id === sectionId ? newSection : s);
          return updatedSections;
        });

        await saveReportData(updatedSections, metadata);

        toast.success(`「${sectionTitle}」生成成功`);
        console.log("[ReportPreview] Retry completed successfully");
      } else {
        throw new Error("未获取到章节内容");
      }
    } catch (err) {
      clearTimeout(timeoutId);
      console.error("[ReportPreview] Retry section failed:", err);
      toast.error(`重试失败: ${normalizeSupabaseError(err, "请稍后再试")}`);
    } finally {
      clearTimeout(timeoutId);
      console.log("[ReportPreview] Clearing retryingSectionId");
      setRetryingSectionId(null);
    }
  };

  // Report generation is handled in AI 智能分析 (mapping) via async jobs.

  // Export handler
  const handleExport = async () => {
    if (!currentProject || sections.length === 0) return;

    setIsExporting(true);

    try {
      const projectData = {
        name: currentProject.name,
        target: currentProject.target,
        client: currentProject.client,
      };

      // 为导出构建带映射文件的 sections
      const sectionsWithMappings = sections.map(s => ({
        ...s,
        mappedFiles: chapterFilesMap.get(s.id) || [],
      }));

      if (exportFormat === "pdf") {
        await exportToPDF(projectData, sectionsWithMappings, metadata, definitions, files.length, currentStyle);
        toast.success("PDF 报告已下载");
      } else if (exportFormat === "docx") {
        await exportToWord(projectData, sectionsWithMappings, metadata, definitions, files.length, currentStyle);
        toast.success("Word 报告已下载");
      } else if (exportFormat === "html") {
        // Generate HTML content with selected template style
        const html = generateReportHTML(currentProject, sections, metadata, definitions, files.length, currentStyle, chapterFilesMap);
        const blob = new Blob([html], { type: "text/html;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${currentProject.target || currentProject.name}_法律尽调报告.html`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        toast.success("HTML 报告已下载");
      }
    } catch (err) {
      console.error("Export error:", err);
      toast.error("导出失败", {
        description: err instanceof Error ? err.message : "请稍后重试",
      });
    } finally {
      setIsExporting(false);
      setIsExportDialogOpen(false);
    }
  };

  // Loading state
  const isDataLoading =
    isProjectLoading ||
    isChaptersLoading ||
    isFilesLoading ||
    isMappingsLoading ||
    isReportLoading ||
    isTemplateLoading ||
    isStylesLoading;

  if (isDataLoading) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-background">
          <div>
            <Skeleton className="h-6 w-32 mb-2" />
            <Skeleton className="h-4 w-64" />
          </div>
          <div className="flex gap-3">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  // No project selected
  if (!currentProject) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-semibold mb-2">请先选择项目</h2>
          <p className="text-muted-foreground text-sm mb-4">
            返回仪表板选择一个项目以查看报告
          </p>
          <Button onClick={() => navigate("/")}>返回项目列表</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header Bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-background">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-lg font-semibold text-foreground">尽职调查报告预览</h1>
            {hasGenerated && (
              <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                已��成
              </Badge>
            )}
          </div>
          <p className="text-[13px] text-muted-foreground">
            {currentProject.target || currentProject.name} · {files.length} 份数据室文件
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Style Switcher */}
          {hasGenerated && templateStyles.length > 0 && (
            <div className="flex items-center gap-2 mr-2">
              <Palette className="w-4 h-4 text-muted-foreground" />
              <Select value={selectedStyleId || templateStyles[0].id} onValueChange={handleSelectStyle}>
                <SelectTrigger className="w-36 h-8 text-[12px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {/* 全局模板 */}
                  {templateStyles.filter(s => !s.projectId).map(style => (
                    <SelectItem key={style.id} value={style.id} className="text-[12px]">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-3 h-3 rounded-full border"
                          style={{ backgroundColor: style.preview?.primaryColor || "#111827" }}
                        />
                        {style.name}
                      </div>
                    </SelectItem>
                  ))}
                  {/* 自定义模板（项目专属） */}
                  {templateStyles.filter(s => s.projectId).length > 0 && (
                    <>
                      <div className="border-t my-1" />
                      {templateStyles.filter(s => s.projectId).map(style => (
                        <SelectItem key={style.id} value={style.id} className="text-[12px]">
                          <div className="flex items-center gap-2">
                            <span
                              className="w-3 h-3 rounded-full border border-dashed"
                              style={{ backgroundColor: style.preview?.primaryColor || "#111827" }}
                            />
                            <span>{style.name}</span>
                            <span className="text-[9px] text-muted-foreground">(本项目)</span>
                          </div>
                        </SelectItem>
                      ))}
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/project/${projectId}/upload`)}
            className="gap-2"
          >
            <FileCode className="w-4 h-4" />
            数据室文件
          </Button>
          {hasGenerated ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/project/${projectId}/mapping`)}
                className="gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                重新生成
              </Button>
              <Button
                onClick={() => setIsExportDialogOpen(true)}
                className="gap-2"
                disabled={sections.length === 0}
              >
                <Download className="w-4 h-4" />
                导出报告
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              onClick={() => navigate(`/project/${projectId}/mapping`)}
              className="gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              前往 AI 智能分析
            </Button>
          )}
        </div>
      </div>

      {/* Generation Progress */}
      {isGenerating && (
        <div className="mx-6 mt-4 p-4 bg-card border border-border rounded-lg">
          <div className="flex items-center gap-3 mb-3">
            <Loader2 className="w-5 h-5 text-primary animate-spin" />
            <span className="text-[13px] font-medium">{generationStatus}</span>
          </div>
          <Progress value={generationProgress} className="h-2" />
          <div className="text-[11px] text-muted-foreground mt-2 text-right">
            {generationProgress}%
          </div>
        </div>
      )}

      {/* Pre-generation state - Guide user to AI Analysis page */}
      {!hasGenerated && !isGenerating && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md">
            <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-8 h-8 text-amber-500" />
            </div>
            <h2 className="text-lg font-semibold mb-2">尚未生成报告</h2>
            <p className="text-muted-foreground text-[13px] mb-6">
              请先在「AI 智能分析」页面生成报告内容，
              生成完成后可在此页面预览和下载。
            </p>

            {/* Stats preview */}
            {fileStats && (
              <div className="grid grid-cols-3 gap-4 mb-6 p-4 bg-muted/50 rounded-lg">
                <div className="text-center">
                  <div className="text-2xl font-bold text-primary">
                    {fileStats.totalFiles}
                  </div>
                  <div className="text-[11px] text-muted-foreground">数据室文件</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-emerald-600">
                    {fileStats.filesWithOcr}
                  </div>
                  <div className="text-[11px] text-muted-foreground">已提取内容</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-primary">
                    {flatChapters.length}
                  </div>
                  <div className="text-[11px] text-muted-foreground">报告章节</div>
                </div>
              </div>
            )}

            <Button
              size="lg"
              onClick={() => navigate(`/project/${projectId}/mapping`)}
              className="gap-2"
            >
              <ArrowLeft className="w-5 h-5" />
              前往 AI 智能分析
            </Button>

            {flatChapters.length === 0 && (
              <p className="text-amber-600 text-[12px] mt-3">
                请先在「模板指纹」页面设置报告章节结构
              </p>
            )}
            {files.length === 0 && flatChapters.length > 0 && (
              <p className="text-amber-600 text-[12px] mt-3">
                请先在「数据室文件」页面上传文件
              </p>
            )}
          </div>
        </div>
      )}

      {/* Report Content (after generation) */}
      {hasGenerated && sections.length > 0 && (
        <>
          {/* Summary Stats Banner */}
          <div className="mx-6 mt-4 p-4 bg-card border border-border rounded-lg">
            <div className="flex items-center gap-8">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <BarChart3 className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground uppercase tracking-wider">
                    报告概览
                  </div>
                  <div className="text-[15px] font-semibold">
                    {sections.length} 个章节
                  </div>
                </div>
              </div>

              <div className="flex-1 grid grid-cols-4 gap-4">
                <div className="flex items-center gap-2">
                  <File className="w-4 h-4 text-muted-foreground" />
                  <span className="text-[13px]">
                    数据室文件{" "}
                    <span className="font-semibold">{files.length}</span>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  <span className="text-[13px]">
                    已关联{" "}
                    <span className="font-semibold">
                      {mappings.length}
                    </span>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-500" />
                  <span className="text-[13px]">
                    问题{" "}
                    <span className="font-semibold">{totalIssues}</span>
                    {highRiskCount > 0 && (
                      <span className="text-red-600 ml-1">({highRiskCount}高风险)</span>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Percent className="w-4 h-4 text-emerald-500" />
                  <span className="text-[13px]">
                    有映射章节{" "}
                    <span className="font-semibold">
                      {sections.filter(s => (chapterFilesMap.get(s.id)?.length || 0) > 0).length}/{sections.length}
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Evidence Notice */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mx-6 mt-3 p-3 bg-blue-50 border border-blue-200 rounded flex items-start gap-3"
          >
            <Shield className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-[13px] text-blue-900">AI 智能分析</div>
              <div className="text-[12px] text-blue-700 mt-0.5">
                AI 已自动阅读所有数据室文件，根据每个章节主题智能匹配相关证据。
                报告内容严格基于文件实际内容生成，未找到相关文件的章节将显示"待补充资料"。
              </div>
            </div>
          </motion.div>

          {/* Main Content */}
          <div className="flex-1 grid grid-cols-12 gap-0 min-h-0 mt-4">
            {/* Left: Section Navigation */}
            <div className="col-span-2 border-r border-border flex flex-col">
              <div className="px-3 py-3 border-b border-border bg-surface-subtle">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    章节目录
                  </div>
                  {lockedSectionIds.size > 0 && (
                    <Badge variant="outline" className="text-[9px] h-4 px-1.5 text-amber-600 border-amber-300">
                      <Lock className="w-2.5 h-2.5 mr-0.5" />
                      {lockedSectionIds.size}
                    </Badge>
                  )}
                </div>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-2 space-y-0.5">
                  {sections.map((section) => {
                    const isActive = activeSectionId === section.id;
                    // 基于 chapter_file_mappings 判断
                    const sectionMappedFiles = chapterFilesMap.get(section.id) || [];
                    const hasNoData = sectionMappedFiles.length === 0;
                    const hasIssues = section.issues && section.issues.length > 0;
                    const isSectionLocked = lockedSectionIds.has(section.id);

                    return (
                      <div
                        key={section.id}
                        className={cn(
                          "flex items-center gap-2 py-2 px-2 rounded cursor-pointer text-[12px] transition-colors",
                          isActive
                            ? "bg-primary/10 text-primary font-medium"
                            : "hover:bg-muted/50",
                          isSectionLocked && "border-l-2 border-amber-500"
                        )}
                        onClick={() => setActiveSectionId(section.id)}
                      >
                        <span className="flex-1 truncate">
                          {section.number && section.number !== section.title && `${section.number} `}
                          {section.title}
                        </span>
                        {isSectionLocked && (
                          <Lock className="w-3 h-3 text-amber-500 flex-shrink-0" title="已锁定" />
                        )}
                        {hasNoData && !isSectionLocked && (
                          <FileWarning className="w-3 h-3 text-amber-500 flex-shrink-0" />
                        )}
                        {hasIssues && !hasNoData && !isSectionLocked && (
                          <AlertTriangle className="w-3 h-3 text-amber-500 flex-shrink-0" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>

            {/* Center: Report Content */}
            <div
              className={cn(
                "flex flex-col bg-surface-subtle/30",
                showEvidenceSidebar ? "col-span-7" : "col-span-10"
              )}
            >
              <ScrollArea className="flex-1">
                <div className="max-w-4xl mx-auto py-8 px-12">
                  <AnimatePresence mode="wait">
                    {activeSection && (
                      <SectionRenderer
                        key={activeSection.id}
                        section={activeSection}
                        mappedFiles={activeSectionFiles}
                        metadata={metadata}
                        project={currentProject}
                        fileCount={files.length}
                        definitions={definitions}
                        onRetry={handleRetrySection}
                        isRetrying={retryingSectionId === activeSection.id}
                        templateStyle={currentStyle}
                        isLocked={lockedSectionIds.has(activeSection.id)}
                        onToggleLock={handleToggleLock}
                        onUploadClick={(sectionTitle) => {
                          // Navigate to upload page with section context
                          navigate(`/project/${projectId}/upload?section=${encodeURIComponent(sectionTitle)}`);
                        }}
                      />
                    )}
                  </AnimatePresence>
                </div>
              </ScrollArea>
            </div>

            {/* Right: Evidence Sidebar */}
            {showEvidenceSidebar && (
              <div className="col-span-3 border-l border-border flex flex-col bg-background">
                <div className="px-4 py-3 border-b border-border bg-surface-subtle flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-muted-foreground" />
                    <span className="text-[13px] font-medium">证据文件</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => setShowEvidenceSidebar(false)}
                  >
                    <PanelRightClose className="w-4 h-4" />
                  </Button>
                </div>
                <ScrollArea className="flex-1">
                  <div className="p-3 space-y-3">
                    {activeSectionFiles.length > 0 ? (
                      activeSectionFiles.map((file, idx) => (
                        <motion.div
                          key={file.id}
                          initial={{ opacity: 0, x: 10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: idx * 0.05 }}
                          className="p-3 bg-card border border-border rounded hover:border-primary/50 transition-colors"
                        >
                          <div className="flex items-start gap-2">
                            <File className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <div className="text-[12px] font-medium truncate">
                                {file.name}
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      ))
                    ) : (
                      <div className="py-8 text-center">
                        <FileText className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                        <p className="text-[12px] text-muted-foreground">
                          本章节暂无映射文件
                        </p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
                <div className="p-3 border-t border-border bg-surface-subtle">
                  <div className="text-[11px] text-muted-foreground text-center">
                    共 {activeSectionFiles.length} 份证据文件
                  </div>
                </div>
              </div>
            )}

            {/* Toggle Evidence Sidebar Button (when hidden) */}
            {!showEvidenceSidebar && (
              <Button
                variant="outline"
                size="sm"
                className="fixed right-4 top-1/2 -translate-y-1/2 h-auto py-3 px-1.5 flex flex-col gap-1"
                onClick={() => setShowEvidenceSidebar(true)}
              >
                <PanelRight className="w-4 h-4" />
                <span className="text-[10px]">证据</span>
              </Button>
            )}
          </div>
        </>
      )}

      {/* Export Dialog */}
      <Dialog open={isExportDialogOpen} onOpenChange={setIsExportDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="w-5 h-5" />
              导出尽调报告
            </DialogTitle>
            <DialogDescription>选择输出格式，生成可交付的尽职调查报告</DialogDescription>
          </DialogHeader>

          {!isExporting ? (
            <div className="space-y-4 py-4">
              {/* Format Selection */}
              <div className="space-y-2">
                <Label className="text-[13px]">输出格式</Label>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { id: "html", label: "HTML", desc: "网页格式", icon: FileCode },
                    { id: "pdf", label: "PDF", desc: "PDF文档", icon: FileText },
                    { id: "docx", label: "DOCX", desc: "Word文档", icon: FileText },
                  ].map((format) => (
                    <div
                      key={format.id}
                      className={cn(
                        "p-3 border rounded-lg cursor-pointer transition-all text-center",
                        exportFormat === format.id
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-muted-foreground"
                      )}
                      onClick={() => setExportFormat(format.id as typeof exportFormat)}
                    >
                      <div className="w-10 h-10 rounded mx-auto mb-2 flex items-center justify-center bg-muted">
                        <format.icon className="w-5 h-5 text-muted-foreground" />
                      </div>
                      <div className="font-medium text-[13px]">{format.label}</div>
                      <div className="text-[11px] text-muted-foreground">{format.desc}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Options */}
              <div className="space-y-3">
                <Label className="text-[13px]">报告选项</Label>
                <div className="space-y-2">
                  <div className="flex items-center gap-3 p-3 bg-surface-subtle rounded">
                    <Checkbox
                      id="toc"
                      checked={includeToc}
                      onCheckedChange={(v) => setIncludeToc(v as boolean)}
                    />
                    <div className="flex-1">
                      <Label htmlFor="toc" className="text-[13px] cursor-pointer">
                        生成目录
                      </Label>
                      <p className="text-[11px] text-muted-foreground">
                        在报告开头添加目录导航
                      </p>
                    </div>
                    <BookOpen className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-surface-subtle rounded">
                    <Checkbox
                      id="appendix"
                      checked={includeAppendix}
                      onCheckedChange={(v) => setIncludeAppendix(v as boolean)}
                    />
                    <div className="flex-1">
                      <Label htmlFor="appendix" className="text-[13px] cursor-pointer">
                        证据索引
                      </Label>
                      <p className="text-[11px] text-muted-foreground">
                        附加证据文件索引表
                      </p>
                    </div>
                    <File className="w-4 h-4 text-muted-foreground" />
                  </div>
                </div>
              </div>

              {/* Statistics */}
              <div className="p-3 bg-muted/50 rounded text-[12px]">
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">章节数</span>
                    <span className="font-medium">{sections.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">数据室文件</span>
                    <span className="font-medium">{files.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">发现问题</span>
                    <span className="font-medium">{totalIssues}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">有映射章节</span>
                    <span className={cn(
                      "font-medium",
                      sections.filter(s => (chapterFilesMap.get(s.id)?.length || 0) > 0).length === sections.length
                        ? "text-emerald-600"
                        : "text-amber-600"
                    )}>
                      {sections.filter(s => (chapterFilesMap.get(s.id)?.length || 0) > 0).length}/{sections.length}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-8">
              <div className="flex flex-col items-center mb-6">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                  <Loader2 className="w-6 h-6 text-primary animate-spin" />
                </div>
                <h3 className="font-semibold text-[15px]">正在导出报告</h3>
                <p className="text-[13px] text-muted-foreground">
                  正在生成{exportFormat.toUpperCase()}格式...
                </p>
              </div>
              <Progress value={undefined} className="h-2" />
            </div>
          )}

          {!isExporting && (
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsExportDialogOpen(false)}>
                取消
              </Button>
              <Button onClick={handleExport} className="gap-2">
                <Download className="w-4 h-4" />
                开始导出
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Convert Markdown to HTML (basic support for tables and formatting)
function markdownToHTML(markdown: string): string {
  let html = markdown;

  // Convert Markdown tables to HTML tables
  const tableRegex = /\|(.+)\|\n\|[-:| ]+\|\n((?:\|.+\|\n?)+)/g;
  html = html.replace(tableRegex, (_, headerRow, bodyRows) => {
    const headers = headerRow.split("|").map((h: string) => h.trim()).filter(Boolean);
    const rows = bodyRows.trim().split("\n").map((row: string) =>
      row.split("|").map((c: string) => c.trim()).filter(Boolean)
    );

    return `<table>
      <thead><tr>${headers.map((h: string) => `<th>${h}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((cells: string[]) => `<tr>${cells.map((c: string) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>`;
  });

  // Convert bold **text** to <strong>
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Convert italic *text* to <em>
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Convert headers
  html = html.replace(/^### (.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^## (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^# (.+)$/gm, "<h2>$1</h2>");

  // Convert unordered lists
  html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/g, "<ul>$&</ul>");

  // Convert numbered lists
  html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");

  // Convert paragraphs (lines not already converted)
  const lines = html.split("\n");
  html = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("<")) return line; // Already HTML
    return `<p>${trimmed}</p>`;
  }).join("\n");

  return html;
}

// Helper function to generate HTML report with template style support
function generateReportHTML(
  project: { name: string; target?: string; client?: string },
  sections: ReportSection[],
  metadata: ReportMetadata | null,
  definitions: Definition[],
  fileCount: number,
  templateStyle?: TemplateStyle,
  chapterFilesMapArg?: Map<string, Array<{ name: string; id: string }>>
): string {
  const formatDate = () => {
    const date = new Date();
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  };

  // Get style values from template or use defaults
  const styles = templateStyle?.styles;
  const tables = templateStyle?.tables;
  const page = templateStyle?.page;
  const preview = templateStyle?.preview;

  // Font family mapping - comprehensive list
  const fontFamilyMap: Record<string, string> = {
    "宋体": '"SimSun", "宋体", "STSong", serif',
    "黑体": '"SimHei", "黑体", "STHeiti", sans-serif',
    "仿宋": '"FangSong", "仿宋", "STFangsong", serif',
    "楷体": '"KaiTi", "楷体", "STKaiti", serif',
    "微软雅黑": '"Microsoft YaHei", "微软雅黑", "STXihei", sans-serif',
    "Times New Roman": '"Times New Roman", "Georgia", serif',
    "Arial": '"Arial", "Helvetica", sans-serif',
  };

  const getFont = (font?: string) => fontFamilyMap[font || "宋体"] || fontFamilyMap["宋体"];

  // Use preview colors which are explicitly set for each template
  const primaryColor = preview?.primaryColor || "#000000";
  const accentColor = preview?.accentColor || "#333333";

  // Page settings
  const pageSize = page?.size || "A4";
  const margins = page?.margin || { top: 2.5, bottom: 2.5, left: 2.8, right: 2.8, unit: "cm" };

  // Style values
  const h1Style = styles?.h1 || { font: "宋体", sizePt: 16, bold: true, color: "#000000", lineSpacing: 1.2 };
  const h2Style = styles?.h2 || { font: "宋体", sizePt: 14, bold: true, color: "#000000", lineSpacing: 1.2 };
  const bodyStyle = styles?.body || { font: "宋体", sizePt: 11, lineSpacing: 1.5, firstLineIndentCm: 0.74 };
  const tableStyle = tables?.default || { headerFill: "#f0f0f0", borderColor: "#333333", font: "宋体", sizePt: 10 };

  let html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${project.target || project.name} - 法律尽职调查报告</title>
  <style>
    @page { 
      margin: ${margins.top}${margins.unit} ${margins.right}${margins.unit} ${margins.bottom}${margins.unit} ${margins.left}${margins.unit}; 
      size: ${pageSize}; 
    }
    body { 
      font-family: ${getFont(bodyStyle.font)}; 
      font-size: ${bodyStyle.sizePt}pt; 
      line-height: ${bodyStyle.lineSpacing};
      color: #333;
      max-width: ${pageSize === "A4" ? "210mm" : "216mm"};
      margin: 0 auto;
      padding: 20px;
    }
    
    /* Cover Page */
    .cover { 
      text-align: center; 
      page-break-after: always;
      padding-top: 20%;
      min-height: 80vh;
      position: relative;
    }
    .cover h1 { 
      font-family: ${getFont(h1Style.font)};
      font-size: 28pt; 
      font-weight: bold;
      color: ${primaryColor};
      margin-bottom: 2em;
      letter-spacing: 0.2em;
    }
    .cover h2 {
      font-family: ${getFont(h1Style.font)};
      font-size: 20pt;
      color: ${accentColor};
      margin-bottom: 3em;
    }
    .cover .meta-info {
      margin-top: 6em;
      font-size: 14pt;
      color: #555;
    }
    .cover .meta-info p {
      margin: 0.8em 0;
    }
    .cover .firm {
      font-size: 16pt;
      margin-top: 4em;
      color: ${primaryColor};
      font-weight: bold;
    }
    .cover .date {
      font-size: 14pt;
      margin-top: 1em;
      color: #666;
    }
    .cover .divider {
      width: 60%;
      height: 3px;
      background: linear-gradient(90deg, transparent, ${primaryColor}, transparent);
      margin: 2em auto;
    }
    
    /* Table of Contents */
    .toc { 
      page-break-after: always; 
      padding: 2em 0;
    }
    .toc h2 { 
      font-family: ${getFont(h1Style.font)};
      font-size: ${h1Style.sizePt}pt;
      text-align: center;
      margin-bottom: 2em;
      color: ${primaryColor};
      border-bottom: 2px solid ${primaryColor};
      padding-bottom: 0.5em;
    }
    .toc-item { 
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin: 0.6em 0;
      padding: 0.3em 0;
      border-bottom: 1px dotted #ccc;
    }
    .toc-item:hover {
      background: #f9f9f9;
    }
    .toc-item .toc-title {
      font-family: ${getFont(bodyStyle.font)};
    }
    .toc-item .toc-page {
      color: #999;
      font-size: 10pt;
    }
    
    /* Section Styles */
    .section { 
      page-break-before: always; 
      margin-bottom: 2em;
    }
    .section:first-of-type { 
      page-break-before: auto; 
    }
    .section-title { 
      font-family: ${getFont(h1Style.font)};
      font-size: ${h1Style.sizePt}pt; 
      font-weight: ${h1Style.bold ? "bold" : "normal"}; 
      color: ${h1Style.color || primaryColor};
      margin: 1.5em 0 1em;
      border-bottom: 2px solid ${primaryColor};
      padding-bottom: 0.5em;
    }
    .subsection-title {
      font-family: ${getFont(h2Style.font)};
      font-size: ${h2Style.sizePt}pt;
      font-weight: ${h2Style.bold ? "bold" : "normal"};
      color: ${h2Style.color || accentColor};
      margin: 1.2em 0 0.8em;
    }
    
    /* Content Styles */
    .content { 
      text-align: justify;
      text-indent: ${bodyStyle.firstLineIndentCm || 0.74}cm;
    }
    .content p { 
      margin: 0.8em 0; 
      line-height: ${bodyStyle.lineSpacing};
    }
    .content strong {
      color: ${primaryColor};
    }
    
    /* No Data Warning */
    .no-data {
      background: linear-gradient(135deg, #fff8e6 0%, #fff3cd 100%);
      border-left: 4px solid #f59e0b;
      padding: 1em 1.5em;
      margin: 1em 0;
      border-radius: 0 8px 8px 0;
    }
    .no-data-title {
      font-weight: bold;
      color: #b45309;
      margin-bottom: 0.5em;
    }
    
    /* Table Styles */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 1.5em 0;
      font-family: ${getFont(tableStyle.font)};
      font-size: ${tableStyle.sizePt}pt;
    }
    th, td {
      border: 1px solid ${tableStyle.borderColor};
      padding: 10px 12px;
      text-align: left;
      vertical-align: top;
    }
    th {
      background: ${tableStyle.headerFill};
      font-weight: bold;
      color: ${primaryColor};
    }
    tr:nth-child(even) {
      background: #fafafa;
    }
    tr:hover {
      background: #f5f5f5;
    }
    
    /* Issues Table */
    .issues-table {
      margin-top: 1.5em;
    }
    .issues-table th {
      background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
      color: #92400e;
    }
    .severity-high {
      background: #fee2e2 !important;
      color: #dc2626;
      font-weight: bold;
      text-align: center;
    }
    .severity-medium {
      background: #fef3c7 !important;
      color: #d97706;
      font-weight: bold;
      text-align: center;
    }
    .severity-low {
      background: #dbeafe !important;
      color: #2563eb;
      font-weight: bold;
      text-align: center;
    }
    
    /* Sources Section */
    .sources {
      background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
      padding: 1em 1.5em;
      margin: 1.5em 0;
      font-size: 10pt;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
    }
    .sources-title {
      font-weight: bold;
      color: ${primaryColor};
      margin-bottom: 0.5em;
    }
    .sources-list {
      color: #64748b;
    }
    
    /* Findings Section */
    .findings {
      background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
      padding: 1em 1.5em;
      margin: 1em 0;
      border-radius: 8px;
      border-left: 4px solid #3b82f6;
    }
    .findings-title {
      font-weight: bold;
      color: #1d4ed8;
      margin-bottom: 0.5em;
    }
    .findings ul {
      margin: 0;
      padding-left: 1.5em;
      color: #1e40af;
    }
    .findings li {
      margin: 0.3em 0;
    }
    
    /* Footer */
    .footer {
      margin-top: 4em;
      padding-top: 2em;
      border-top: 1px solid #e5e7eb;
      text-align: center;
      color: #9ca3af;
      font-size: 10pt;
    }
    
    /* Print Optimizations */
    @media print {
      body {
        padding: 0;
      }
      .no-print {
        display: none;
      }
    }
  </style>
</head>
<body>
  <!-- Cover Page -->
  <div class="cover">
    <div style="position: absolute; top: 20px; right: 20px; padding: 4px 12px; background: ${primaryColor}; color: white; font-size: 10pt; border-radius: 4px;">
      模板：${templateStyle?.name || "标准"}
    </div>
    <h2>${project.target || project.name}</h2>
    <div class="divider"></div>
    <h1>法律尽职调查报告</h1>
    <div class="meta-info">
      <p>委托方：${project.client || "未提供"}</p>
      <p>目标公司：${project.target || project.name}</p>
      <p>文件数量：${fileCount} 份</p>
    </div>
    <div class="firm">[ 律师事务所名称 ]</div>
    <div class="date">${formatDate()}</div>
  </div>

  <!-- Table of Contents -->
  <div class="toc">
    <h2>目 录</h2>
    ${sections.map((section, idx) => `
      <div class="toc-item">
              <span class="toc-title">${(section.number && section.number.trim() && section.number !== section.title) ? section.number + " " : ""}${section.title}</span>
        <span class="toc-page">${idx + 1}</span>
      </div>
    `).join("")}
  </div>
`;

  // Add sections
  for (const section of sections) {
    // 基于 chapter_file_mappings 判断
    const sectionMappedFiles = chapterFilesMapArg?.get(section.id) || [];
    const hasNoData = sectionMappedFiles.length === 0;
    const isIntroSection = section.title.includes("引言") || section.title === "引言";
    const isDefinitionSection = section.title.includes("定义") || section.title.includes("释义");
    const isEquitySection = section.title.includes("股权结构") || section.title.includes("股权架构");

    html += `
  <div class="section">
              <h2 class="section-title">${(section.number && section.number.trim() && section.number !== section.title) ? section.number + " " : ""}${section.title}</h2>
`;

    if (isIntroSection) {
      // Fixed introduction template
      const today = new Date().toISOString().split('T')[0];
      html += `
    <div class="content">
      <p>受<strong>${project.client || "[委托方]"}</strong>（以下简称"委托方"）委托，本所律师对<strong>${project.target || project.name}</strong>（以下简称"目标公司"或"公司"）进行法律尽职调查，并出具本法律尽职调查报告（以下简称"本报告"）。</p>
      <p><strong>一、报告依据</strong></p>
      <p>本报告依据委托方提供的数据室文件及相关补充材料编制。本次尽职调查采用文件审阅、访谈核实等方式进行，未对文件的真实性、完整性进行独立核查。</p>
      <p><strong>二、尽调范围</strong></p>
      <p>本次法律尽职调查涵盖目标公司的基本情况、股权结构、主要资产、知识产权、重大合同、劳动人事、诉讼仲裁、合规运营等方面。本报告基于截至${today}收到的数据室文件（共${fileCount}份）进行分析。</p>
      <p><strong>三、免责声明</strong></p>
      <p>1. 本报告仅供委托方内部决策参考使用，未经本所书面同意，不得向任何第三方披露或提供。</p>
      <p>2. 本报告中的法律意见基于现行有效的中国法律法规，如相关法律法规发生变化，本所不承担更新义务。</p>
      <p>3. 本报告的结论基于委托方及目标公司提供的文件资料，如相关文件存在遗漏、不完整或不真实，本所不对由此产生的后果承担责任。</p>
    </div>
`;
    } else if (isDefinitionSection && definitions.length > 0) {
      // Use database definitions
      html += `
    <div class="content">
      <p>除非上下文另有说明，本报告所使用的下列术语具有如下含义：</p>
    </div>
    <table>
      <thead>
        <tr>
          <th>序号</th>
          <th>简称</th>
          <th>全称/定义</th>
        </tr>
      </thead>
      <tbody>
        ${definitions.map((def, idx) => `
          <tr>
            <td>${idx + 1}</td>
            <td>${def.shortName}</td>
            <td>${def.fullName}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
`;
    } else if (isEquitySection && metadata?.equityStructure?.shareholders?.length) {
      // Equity structure with visual representation
      const eq = metadata.equityStructure;
      html += `
    <div class="content">
      <p>根据工商登记信息及相关文件核查，<strong>${eq.companyName}</strong>的股权结构如下：</p>
    </div>
    <table>
      <thead>
        <tr>
          <th>序号</th>
          <th>股东名称</th>
          <th>持股比例</th>
          <th>股东类型</th>
          <th>备注</th>
        </tr>
      </thead>
      <tbody>
        ${eq.shareholders.map((sh, idx) => `
          <tr>
            <td>${idx + 1}</td>
            <td>${sh.name}</td>
            <td>${sh.percentage.toFixed(2)}%</td>
            <td>${sh.type === 'individual' ? '自然人' : sh.type === 'company' ? '法人' : '持股平台'}</td>
            <td>${sh.notes || '-'}</td>
          </tr>
        `).join("")}
        <tr style="background: #f0f0f0; font-weight: bold;">
          <td colspan="2">合计</td>
          <td>${eq.shareholders.reduce((sum, sh) => sum + sh.percentage, 0).toFixed(2)}%</td>
          <td colspan="2"></td>
        </tr>
      </tbody>
    </table>
    ${eq.notes && eq.notes.length > 0 ? `
    <div class="sources">
      <strong>说明：</strong>
      <ol>${eq.notes.map(note => `<li>${note}</li>`).join("")}</ol>
    </div>` : ""}
`;
    } else if (hasNoData) {
      html += `
    <div class="no-data">
      <div class="no-data-title">本章节暂无相关证据文件</div>
      <p>${section.content}</p>
    </div>
`;
    } else {
      html += `
    <div class="content">
      ${markdownToHTML(section.content)}
    </div>
`;
    }

    // Add findings if present
    if (section.findings && section.findings.length > 0) {
      html += `
    <div class="findings">
      <div class="findings-title">核查发现</div>
      <ul>
        ${section.findings.map(finding => `<li>${finding}</li>`).join("")}
      </ul>
    </div>
`;
    }

    // Add issues table if present
    if (section.issues && section.issues.length > 0) {
      html += `
    <h3 class="subsection-title">发现的问题与风险</h3>
    <table class="issues-table">
      <thead>
        <tr>
          <th style="width: 50px;">序号</th>
          <th style="width: 30%;">事实</th>
          <th style="width: 30%;">问题/风险</th>
          <th style="width: 25%;">建议</th>
          <th style="width: 60px;">级别</th>
        </tr>
      </thead>
      <tbody>
        ${section.issues.map((issue, idx) => `
          <tr>
            <td style="text-align: center;">${idx + 1}</td>
            <td>${issue.fact || ""}</td>
            <td>${issue.risk || ""}</td>
            <td>${issue.suggestion || ""}</td>
            <td class="severity-${issue.severity}">${issue.severity === "high" ? "高" : issue.severity === "medium" ? "中" : "低"}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
`;
    }

    // Add source files (从 chapter_file_mappings 获取)
    if (sectionMappedFiles.length > 0) {
      html += `
    <div class="sources">
      <div class="sources-title">证据来源</div>
      <div class="sources-list">${sectionMappedFiles.map(f => f.name).join("、")}</div>
    </div>
`;
    }

    html += `  </div>\n`;
  }

  html += `
  <!-- Footer -->
  <div class="footer">
    <p>本报告由 ${templateStyle?.name || "标准模板"} 生成</p>
    <p>生成日期：${formatDate()}</p>
  </div>
</body>
</html>`;

  return html;
}













