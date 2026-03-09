import { useState, useMemo, useRef, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText,
  ChevronRight,
  Type,
  Table2,
  Image,
  List,
  Palette,
  CheckCircle2,
  Edit3,
  Lock,
  LayoutTemplate,
  BookOpen,
  Save,
  Eye,
  Settings,
  FileCode,
  Hash,
  Ruler,
  ListOrdered,
  AlignCenter,
  AlignJustify,
  Info,
  Upload,
  Sparkles,
  Loader2,
  Trash2,
  FolderOpen,
  ArrowRight,
} from "lucide-react";
import { useCurrentProject } from "@/hooks/useProjects";
import { useChapters, useDeleteProjectChapters, type Chapter } from "@/hooks/useChapters";
import { useParseTemplate, fileToBase64, DEMO_TEMPLATE_CONTENT } from "@/hooks/useAIParser";
import { ChapterStatus, ChapterStatusLabels, type ChapterStatusType } from "@/lib/enums";
import { toast } from "sonner";
import { mockTemplateFingerprint, templateStyles, type TemplateStyle } from "@/lib/reportMockData";
import type { TemplateFingerprint as TFType, TOCItem } from "@/lib/reportTypes";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";

// =============================================================================
// COMPONENTS
// =============================================================================

/** 目录树组件 - 使用真实章节数据 */
function ChapterTree({ chapters, level = 0 }: { chapters: Chapter[]; level?: number }) {
  if (!chapters || chapters.length === 0) {
    return null;
  }

  return (
    <div className={cn("space-y-0.5", level > 0 && "ml-4 border-l border-border pl-3")}>
      {chapters.map((chapter) => (
        <div key={chapter.id}>
          <div
            className={cn(
              "flex items-center gap-2 py-1.5 px-2 rounded text-[13px] hover:bg-muted/50 transition-colors",
              chapter.level === 1 && "text-primary"
            )}
          >
            {chapter.number && (
              <span className="font-mono text-muted-foreground w-8 flex-shrink-0">{chapter.number}</span>
            )}
            <span className={cn(chapter.level === 1 && "font-medium")}>{chapter.title}</span>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] px-1.5 py-0 ml-auto",
                chapter.status === ChapterStatus.MATCHED && "bg-emerald-50 text-emerald-700 border-emerald-200",
                chapter.status === ChapterStatus.INSUFFICIENT_DATA && "bg-amber-50 text-amber-700 border-amber-200",
                chapter.status === ChapterStatus.UNMATCHED && "bg-slate-50 text-slate-600 border-slate-200"
              )}
            >
              {ChapterStatusLabels[chapter.status as ChapterStatusType] || chapter.status}
            </Badge>
          </div>
          {chapter.children && chapter.children.length > 0 && (
            <ChapterTree chapters={chapter.children} level={level + 1} />
          )}
        </div>
      ))}
    </div>
  );
}

/** 空状态 - 需要上传模板 */
function EmptyTemplateState({
  onUploadClick,
  onGenerateClick,
  isGenerating,
  isUploading,
}: {
  onUploadClick: () => void;
  onGenerateClick: () => void;
  isGenerating: boolean;
  isUploading: boolean;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-24 h-24 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center mb-6"
      >
        <LayoutTemplate className="w-12 h-12 text-primary" />
      </motion.div>
      <h2 className="text-xl font-semibold mb-2">尚未设置报告模板</h2>
      <p className="text-muted-foreground text-[14px] max-w-md mb-8">
        上传您的样本报告文件，AI 将自动提取报告结构；或使用标准法律尽调报告模板快速开始。
      </p>
      <div className="flex flex-col sm:flex-row gap-4">
        <Button
          variant="outline"
          size="lg"
          className="gap-2 px-6"
          onClick={onUploadClick}
          disabled={isUploading || isGenerating}
        >
          {isUploading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              正在解析...
            </>
          ) : (
            <>
              <Upload className="w-5 h-5" />
              上传样本报告
            </>
          )}
        </Button>
        <Button
          size="lg"
          className="gap-2 px-6"
          onClick={onGenerateClick}
          disabled={isGenerating || isUploading}
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              AI 生成中...
            </>
          ) : (
            <>
              <Sparkles className="w-5 h-5" />
              AI 生成标准模板
            </>
          )}
        </Button>
      </div>
      <p className="text-[12px] text-muted-foreground mt-4">
        支持 PDF、Word (.docx) 格式
      </p>
    </div>
  );
}

/** 样式Token卡片 */
function StyleTokenCard({
  label,
  token,
  description,
}: {
  label: string;
  token: Record<string, unknown>;
  description?: string;
}) {
  const formatValue = (key: string, value: unknown): string => {
    if (typeof value === "number") {
      if (key.includes("Pt") || key.includes("Size")) return `${value}pt`;
      if (key.includes("Cm")) return `${value}cm`;
      if (key.includes("Spacing")) return `${value}`;
      return String(value);
    }
    if (typeof value === "boolean") return value ? "是" : "否";
    return String(value);
  };

  const keyLabels: Record<string, string> = {
    font: "字体",
    sizePt: "字号",
    bold: "粗体",
    spaceBeforePt: "段前",
    spaceAfterPt: "段后",
    lineSpacing: "行距",
    color: "颜色",
    firstLineIndentCm: "首行缩进",
    align: "对齐",
    indentLeftCm: "左缩进",
    borderLeft: "左边框",
  };

  return (
    <div className="p-4 border border-border rounded-lg bg-card">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-[13px] font-semibold">{label}</h4>
        {description && (
          <Tooltip>
            <TooltipTrigger>
              <Info className="w-3.5 h-3.5 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-[12px] max-w-xs">{description}</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
        {Object.entries(token).map(([key, value]) => (
          <div key={key} className="flex items-center justify-between">
            <span className="text-muted-foreground">{keyLabels[key] || key}</span>
            <span className="font-mono">
              {key === "color" ? (
                <span className="flex items-center gap-1.5">
                  <span
                    className="w-3 h-3 rounded border border-border"
                    style={{ backgroundColor: String(value) }}
                  />
                  {String(value)}
                </span>
              ) : (
                formatValue(key, value)
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 页面设置面板 */
function PageSettingsPanel({ page }: { page: TFType["page"] }) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-[14px] font-semibold mb-4 flex items-center gap-2">
          <Ruler className="w-4 h-4" />
          页面尺寸
        </h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="p-4 border border-border rounded bg-muted/30">
            <div className="text-[11px] text-muted-foreground mb-1">纸张</div>
            <div className="font-medium">{page.size}</div>
          </div>
          <div className="p-4 border border-border rounded bg-muted/30">
            <div className="text-[11px] text-muted-foreground mb-1">方向</div>
            <div className="font-medium">{page.orientation === "portrait" ? "纵向" : "横向"}</div>
          </div>
          <div className="p-4 border border-border rounded bg-muted/30">
            <div className="text-[11px] text-muted-foreground mb-1">单位</div>
            <div className="font-medium">{page.margin.unit}</div>
          </div>
        </div>
      </div>

      <Separator />

      <div>
        <h3 className="text-[14px] font-semibold mb-4 flex items-center gap-2">
          <AlignCenter className="w-4 h-4" />
          边距设置
        </h3>
        <div className="grid grid-cols-4 gap-4">
          {(["top", "bottom", "left", "right"] as const).map((side) => (
            <div key={side} className="p-4 border border-border rounded bg-muted/30">
              <div className="text-[11px] text-muted-foreground mb-1">
                {side === "top" ? "上" : side === "bottom" ? "下" : side === "left" ? "左" : "右"}
              </div>
              <div className="font-medium font-mono">{page.margin[side]} {page.margin.unit}</div>
            </div>
          ))}
        </div>
      </div>

      <Separator />

      <div>
        <h3 className="text-[14px] font-semibold mb-4 flex items-center gap-2">
          <FileText className="w-4 h-4" />
          页眉页脚
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 border border-border rounded bg-muted/30">
            <div className="flex items-center gap-2 mb-3">
              <Badge variant={page.headerFooter.hasHeader ? "default" : "secondary"} className="text-[10px]">
                {page.headerFooter.hasHeader ? "启用" : "禁用"}
              </Badge>
              <span className="text-[13px]">页眉</span>
            </div>
            {page.headerFooter.headerLogo?.enabled && (
              <div className="text-[12px] text-muted-foreground">
                Logo位置：{page.headerFooter.headerLogo.position === "right" ? "右侧" : page.headerFooter.headerLogo.position === "left" ? "左侧" : "居中"}
                ，最大高度：{page.headerFooter.headerLogo.maxHeightCm}cm
              </div>
            )}
          </div>
          <div className="p-4 border border-border rounded bg-muted/30">
            <div className="flex items-center gap-2 mb-3">
              <Badge variant={page.headerFooter.hasFooter ? "default" : "secondary"} className="text-[10px]">
                {page.headerFooter.hasFooter ? "启用" : "禁用"}
              </Badge>
              <span className="text-[13px]">页脚</span>
            </div>
            {page.headerFooter.footerHasPageNumber && (
              <div className="text-[12px] text-muted-foreground">
                页码位置：{page.headerFooter.pageNumberStyle === "center" ? "居中" : page.headerFooter.pageNumberStyle === "right" ? "右侧" : "左侧"}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 编号配置面板 */
function NumberingPanel({ numbering }: { numbering: TFType["numbering"] }) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-[14px] font-semibold mb-4 flex items-center gap-2">
          <Hash className="w-4 h-4" />
          编号方案
        </h3>
        <div className="p-4 border border-border rounded bg-muted/30">
          <div className="text-[11px] text-muted-foreground mb-2">层级格式</div>
          <div className="flex items-center gap-2">
            {numbering.scheme.split("|").map((level, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Badge variant="outline" className="font-mono text-[12px] px-3">
                  {level}
                </Badge>
                {idx < numbering.scheme.split("|").length - 1 && (
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <Separator />

      <div>
        <h3 className="text-[14px] font-semibold mb-4 flex items-center gap-2">
          <ListOrdered className="w-4 h-4" />
          层级数量
        </h3>
        <div className="p-4 border border-border rounded bg-muted/30">
          <div className="flex items-center gap-4">
            <div>
              <div className="text-[11px] text-muted-foreground mb-1">标题层级</div>
              <div className="text-2xl font-bold">{numbering.headingLevels}</div>
            </div>
            <div className="flex-1 grid grid-cols-3 gap-2">
              {Object.entries(numbering.prefixRules).map(([key, value]) => (
                <div key={key} className="p-2 bg-muted rounded text-center">
                  <div className="text-[10px] text-muted-foreground uppercase">{key}</div>
                  <div className="text-[12px] font-mono">{value || "(无)"}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 表格样式面板 */
function TableStylePanel({ tables }: { tables: TFType["tables"] }) {
  const renderTablePreview = (style: TFType["tables"]["default"], isThreeLines: boolean) => (
    <div className="mt-4">
      <div className="text-[11px] text-muted-foreground mb-2">预览</div>
      <table
        className="w-full text-[11px]"
        style={{
          borderCollapse: "collapse",
          fontFamily: style.font,
        }}
      >
        <thead>
          <tr style={{ backgroundColor: style.headerFill }}>
            <th
              style={{
                border: isThreeLines ? "none" : `${style.borderSizePt}pt solid ${style.borderColor}`,
                borderTop: isThreeLines ? `${style.borderSizePt * 2}pt solid ${style.borderColor}` : undefined,
                borderBottom: isThreeLines ? `${style.borderSizePt}pt solid ${style.borderColor}` : undefined,
                padding: `${style.cellPaddingPt}pt`,
                fontWeight: style.headerBold ? "bold" : "normal",
                textAlign: style.align as "left" | "center" | "right",
              }}
            >
              序号
            </th>
            <th
              style={{
                border: isThreeLines ? "none" : `${style.borderSizePt}pt solid ${style.borderColor}`,
                borderTop: isThreeLines ? `${style.borderSizePt * 2}pt solid ${style.borderColor}` : undefined,
                borderBottom: isThreeLines ? `${style.borderSizePt}pt solid ${style.borderColor}` : undefined,
                padding: `${style.cellPaddingPt}pt`,
                fontWeight: style.headerBold ? "bold" : "normal",
                textAlign: style.align as "left" | "center" | "right",
              }}
            >
              文件名称
            </th>
            <th
              style={{
                border: isThreeLines ? "none" : `${style.borderSizePt}pt solid ${style.borderColor}`,
                borderTop: isThreeLines ? `${style.borderSizePt * 2}pt solid ${style.borderColor}` : undefined,
                borderBottom: isThreeLines ? `${style.borderSizePt}pt solid ${style.borderColor}` : undefined,
                padding: `${style.cellPaddingPt}pt`,
                fontWeight: style.headerBold ? "bold" : "normal",
                textAlign: style.align as "left" | "center" | "right",
              }}
            >
              类型
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td
              style={{
                border: isThreeLines ? "none" : `${style.borderSizePt}pt solid ${style.borderColor}`,
                padding: `${style.cellPaddingPt}pt`,
                textAlign: style.align as "left" | "center" | "right",
              }}
            >
              1
            </td>
            <td
              style={{
                border: isThreeLines ? "none" : `${style.borderSizePt}pt solid ${style.borderColor}`,
                padding: `${style.cellPaddingPt}pt`,
                textAlign: style.align as "left" | "center" | "right",
              }}
            >
              营业执照
            </td>
            <td
              style={{
                border: isThreeLines ? "none" : `${style.borderSizePt}pt solid ${style.borderColor}`,
                padding: `${style.cellPaddingPt}pt`,
                textAlign: style.align as "left" | "center" | "right",
              }}
            >
              公司治理
            </td>
          </tr>
          <tr>
            <td
              style={{
                border: isThreeLines ? "none" : `${style.borderSizePt}pt solid ${style.borderColor}`,
                borderBottom: isThreeLines ? `${style.borderSizePt * 2}pt solid ${style.borderColor}` : undefined,
                padding: `${style.cellPaddingPt}pt`,
                textAlign: style.align as "left" | "center" | "right",
              }}
            >
              2
            </td>
            <td
              style={{
                border: isThreeLines ? "none" : `${style.borderSizePt}pt solid ${style.borderColor}`,
                borderBottom: isThreeLines ? `${style.borderSizePt * 2}pt solid ${style.borderColor}` : undefined,
                padding: `${style.cellPaddingPt}pt`,
                textAlign: style.align as "left" | "center" | "right",
              }}
            >
              公司章程
            </td>
            <td
              style={{
                border: isThreeLines ? "none" : `${style.borderSizePt}pt solid ${style.borderColor}`,
                borderBottom: isThreeLines ? `${style.borderSizePt * 2}pt solid ${style.borderColor}` : undefined,
                padding: `${style.cellPaddingPt}pt`,
                textAlign: style.align as "left" | "center" | "right",
              }}
            >
              公司治理
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-[14px] font-semibold mb-4 flex items-center gap-2">
          <Table2 className="w-4 h-4" />
          默认表格样式
        </h3>
        <div className="p-4 border border-border rounded bg-card">
          <div className="grid grid-cols-4 gap-4 text-[12px]">
            <div>
              <div className="text-muted-foreground mb-1">边框样式</div>
              <div className="font-medium">{tables.default.border === "single" ? "单线" : tables.default.border === "double" ? "双线" : "三线表"}</div>
            </div>
            <div>
              <div className="text-muted-foreground mb-1">边框宽度</div>
              <div className="font-medium font-mono">{tables.default.borderSizePt}pt</div>
            </div>
            <div>
              <div className="text-muted-foreground mb-1">表头背景</div>
              <div className="flex items-center gap-1.5">
                <span className="w-4 h-4 rounded border" style={{ backgroundColor: tables.default.headerFill }} />
                <span className="font-mono">{tables.default.headerFill}</span>
              </div>
            </div>
            <div>
              <div className="text-muted-foreground mb-1">单元格内边距</div>
              <div className="font-medium font-mono">{tables.default.cellPaddingPt}pt</div>
            </div>
          </div>
          {renderTablePreview(tables.default, false)}
        </div>
      </div>

      {tables.threeLines && (
        <>
          <Separator />
          <div>
            <h3 className="text-[14px] font-semibold mb-4 flex items-center gap-2">
              <Table2 className="w-4 h-4" />
              三线表样式
            </h3>
            <div className="p-4 border border-border rounded bg-card">
              <div className="grid grid-cols-4 gap-4 text-[12px]">
                <div>
                  <div className="text-muted-foreground mb-1">边框样式</div>
                  <div className="font-medium">三线表</div>
                </div>
                <div>
                  <div className="text-muted-foreground mb-1">边框宽度</div>
                  <div className="font-medium font-mono">{tables.threeLines.borderSizePt}pt</div>
                </div>
                <div>
                  <div className="text-muted-foreground mb-1">表头背景</div>
                  <div className="font-medium">{tables.threeLines.headerFill === "transparent" ? "透明" : tables.threeLines.headerFill}</div>
                </div>
                <div>
                  <div className="text-muted-foreground mb-1">字号</div>
                  <div className="font-medium font-mono">{tables.threeLines.sizePt}pt</div>
                </div>
              </div>
              {renderTablePreview(tables.threeLines, true)}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function TemplateFingerprint() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const currentProjectId = projectId || null;
  const { data: currentProject, isLoading: projectLoading } = useCurrentProject();
  const { data: chapters = [], isLoading: chaptersLoading } = useChapters(currentProjectId || undefined);

  const parseTemplateMutation = useParseTemplate();
  const deleteChaptersMutation = useDeleteProjectChapters();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [variables, setVariables] = useState(mockTemplateFingerprint.introVariables);
  const [activeTab, setActiveTab] = useState("styles");
  const [selectedStyleId, setSelectedStyleId] = useState<string>(templateStyles[0].id);
  
  // Get current selected style
  const currentStyle = useMemo(() => {
    return templateStyles.find(s => s.id === selectedStyleId) || templateStyles[0];
  }, [selectedStyleId]);

  const hasTemplate = chapters.length > 0;
  const isLoading = projectLoading || chaptersLoading;

  // Count chapters
  const countChapters = useCallback((chapters: Chapter[]): { level1: number; level2: number } => {
    let level1 = 0;
    let level2 = 0;
    chapters.forEach(chapter => {
      if (chapter.level === 1) level1++;
      if (chapter.children) {
        level2 += chapter.children.length;
      }
    });
    return { level1, level2 };
  }, []);

  const chapterCounts = useMemo(() => countChapters(chapters), [chapters, countChapters]);


  // Handle AI generate template
  const handleGenerateTemplate = async () => {
    if (!currentProjectId) {
      toast.error("请先选择或创建一个项目");
      return;
    }

    try {
      await parseTemplateMutation.mutateAsync({
        projectId: currentProjectId,
        content: DEMO_TEMPLATE_CONTENT,
        filename: "标准法律尽调报告模板",
      });
      toast.success("报告模板已生成", {
        description: "已根据标准法律尽调报告模板生成章节结构",
      });
    } catch (error) {
      console.error("[TemplateFingerprint] Generate template error:", error);
      toast.error("生成失败", {
        description: error instanceof Error ? error.message : "请稍后重试",
      });
    }
  };

  // Handle template file upload
  const handleTemplateUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!currentProjectId) {
      toast.error("请先选择或创建一个项目");
      return;
    }

    const file = event.target.files?.[0];
    if (!file) return;

    console.log("[TemplateFingerprint] File selected for upload:", {
      name: file.name,
      type: file.type,
      size: file.size,
    });

    // Clear input value for re-upload
    event.target.value = "";

    const validTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
    ];

    if (!validTypes.includes(file.type)) {
      toast.error("不支持的文件格式", {
        description: "请上传 PDF 或 Word (.docx) 文件",
      });
      return;
    }

    try {
      toast.info(`正在解析 ${file.name}，AI 正在提取报告结构...`, { duration: 5000 });

      // Convert file to base64 for server-side parsing
      const fileData = await fileToBase64(file);

      console.log("[TemplateFingerprint] File converted to base64:", {
        fileDataLength: fileData.length,
        mimeType: file.type,
      });

      await parseTemplateMutation.mutateAsync({
        projectId: currentProjectId,
        content: "", // Empty content, will use fileData for extraction
        filename: file.name,
        fileData,
        mimeType: file.type,
      });

      toast.success("模板解析成功", {
        description: `已从 ${file.name} 提取报告结构`,
      });
    } catch (error) {
      console.error("[TemplateFingerprint] Upload error:", error);
      toast.error("解析失败", {
        description: error instanceof Error ? error.message : "请稍后重试",
      });
    }
  };

  // Handle reset template
  const handleResetTemplate = async () => {
    if (!currentProjectId) return;

    try {
      await deleteChaptersMutation.mutateAsync(currentProjectId);
      toast.success("模板已重置", {
        description: "您可以重新上传或生成新的报告结构",
      });
    } catch (error) {
      console.error("[TemplateFingerprint] Reset error:", error);
      toast.error("重置失败");
    }
  };

  const handleVariableChange = (id: string, value: string) => {
    setVariables((prev) => prev.map((v) => (v.id === id ? { ...v, value } : v)));
  };

  const handleSaveVariables = () => {
    toast.success("变量已保存", { description: "引言变量已更新" });
  };

  // Replace variables in intro content
  const processedIntro = useMemo(() => {
    const content = { ...mockTemplateFingerprint.introContent };
    variables.forEach((v) => {
      const placeholder = `{${v.name}}`;
      const value = v.value || `[${v.placeholder}]`;
      Object.keys(content).forEach((key) => {
        content[key as keyof typeof content] = content[key as keyof typeof content].replace(
          new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
          value
        );
      });
    });
    return content;
  }, [variables]);

  if (isLoading) {
    return (
      <div className="h-full flex flex-col p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[600px] w-full" />
      </div>
    );
  }

  if (!currentProject) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <LayoutTemplate className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-semibold mb-2">请先选择项目</h2>
          <p className="text-muted-foreground text-sm mb-4">返回仪表板选择一个项目</p>
          <Button onClick={() => navigate("/")}>返回项目列表</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.doc,.docx"
        className="hidden"
        onChange={handleTemplateUpload}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-background">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-lg font-semibold text-foreground">模板指纹</h1>
            {hasTemplate && (
              <>
                <Badge variant="outline" className="text-[11px]">
                  <CheckCircle2 className="w-3 h-3 mr-1 text-status-success" />
                  已配置
                </Badge>
                <Badge variant="secondary" className="text-[11px] font-mono">
                  {chapterCounts.level1} 章 / {chapterCounts.level2} 节
                </Badge>
              </>
            )}
          </div>
          <p className="text-[13px] text-muted-foreground">
            {hasTemplate
              ? "查看和管理报告结构模板，配置输出样式"
              : "上传样本报告或使用 AI 生成标准模板"
            }
          </p>
        </div>
        <div className="flex items-center gap-3">
          {hasTemplate && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResetTemplate}
                disabled={deleteChaptersMutation.isPending}
                className="text-muted-foreground"
              >
                <Trash2 className="w-4 h-4 mr-1" />
                重置模板
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={parseTemplateMutation.isPending}
              >
                <Upload className="w-4 h-4 mr-1" />
                重新上传
              </Button>
              <Button onClick={() => navigate(`/project/${projectId}/upload`)} className="gap-2">
                继续上传文件
                <ArrowRight className="w-4 h-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* No template state */}
      {!hasTemplate && (
        <EmptyTemplateState
          onUploadClick={() => fileInputRef.current?.click()}
          onGenerateClick={handleGenerateTemplate}
          isGenerating={parseTemplateMutation.isPending}
          isUploading={false}
        />
      )}

      {/* Has template - Tabs */}
      {hasTemplate && (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <div className="border-b border-border bg-background px-6">
            <TabsList className="h-12 bg-transparent p-0 gap-1">
              <TabsTrigger value="styles" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none gap-2">
                <Palette className="w-4 h-4" />
                模板样式
              </TabsTrigger>
              <TabsTrigger value="toc" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none gap-2">
                <BookOpen className="w-4 h-4" />
                目录结构
              </TabsTrigger>
              <TabsTrigger value="page" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none gap-2">
                <Settings className="w-4 h-4" />
                页面设置
              </TabsTrigger>
              <TabsTrigger value="numbering" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none gap-2">
                <Hash className="w-4 h-4" />
                编号配置
              </TabsTrigger>
              <TabsTrigger value="typography" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none gap-2">
                <Type className="w-4 h-4" />
                排版样式
              </TabsTrigger>
              <TabsTrigger value="tables" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none gap-2">
                <Table2 className="w-4 h-4" />
                表格样式
              </TabsTrigger>
              <TabsTrigger value="intro" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none gap-2">
                <Edit3 className="w-4 h-4" />
                引言编辑
              </TabsTrigger>
              <TabsTrigger value="json" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none gap-2">
                <FileCode className="w-4 h-4" />
                JSON
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Tab Contents */}
          <div className="flex-1 overflow-hidden min-h-0 relative">
            {/* Styles Tab - Template Style Selection */}
            <TabsContent value="styles" className="absolute inset-0 m-0">
              <div className="absolute inset-0 flex">
                {/* Left: Style list */}
                <div className="w-5/12 border-r border-border flex flex-col min-h-0">
                  <div className="shrink-0 px-4 py-3 border-b border-border bg-surface-subtle">
                    <div className="flex items-center gap-2">
                      <Palette className="w-4 h-4 text-muted-foreground" />
                      <span className="text-[13px] font-medium">选择模板样式</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      共 {templateStyles.length} 种预设样式可选
                    </p>
                  </div>
                  <ScrollArea className="h-0 grow">
                    <div className="p-4 space-y-3">
                      {templateStyles.map((style) => (
                        <motion.div
                          key={style.id}
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          className={cn(
                            "p-4 rounded-lg border-2 cursor-pointer transition-all",
                            selectedStyleId === style.id
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-muted-foreground/50 bg-card"
                          )}
                          onClick={() => setSelectedStyleId(style.id)}
                        >
                          <div className="flex items-start gap-3">
                            {/* Color preview */}
                            <div className="flex-shrink-0 w-12 h-12 rounded-lg border border-border overflow-hidden">
                              <div 
                                className="h-1/2" 
                                style={{ backgroundColor: style.preview.primaryColor }}
                              />
                              <div 
                                className="h-1/2" 
                                style={{ backgroundColor: style.preview.accentColor }}
                              />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <h4 className="text-[13px] font-semibold">{style.name}</h4>
                                {selectedStyleId === style.id && (
                                  <Badge variant="default" className="text-[10px] px-1.5">
                                    已选择
                                  </Badge>
                                )}
                              </div>
                              <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">
                                {style.description}
                              </p>
                              <div className="flex items-center gap-2 mt-2">
                                <Badge variant="outline" className="text-[10px]">
                                  {style.preview.fontFamily}
                                </Badge>
                                <Badge variant="outline" className="text-[10px]">
                                  {style.preview.headerStyle === "classic" ? "经典" : 
                                   style.preview.headerStyle === "modern" ? "现代" : "简约"}
                                </Badge>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </ScrollArea>
                  <div className="shrink-0 p-4 border-t border-border bg-surface-subtle">
                    <Button 
                      className="w-full gap-2"
                      onClick={() => {
                        toast.success("样式已应用", {
                          description: `已选择「${currentStyle.name}」样式`,
                        });
                      }}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      应用选中样式
                    </Button>
                  </div>
                </div>

                {/* Right: Style preview */}
                <div className="flex-1 flex flex-col min-h-0 bg-surface-subtle/30">
                  <div className="shrink-0 px-4 py-3 border-b border-border">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Eye className="w-4 h-4 text-muted-foreground" />
                        <span className="text-[13px] font-medium">样式预览</span>
                      </div>
                      <Select value={selectedStyleId} onValueChange={setSelectedStyleId}>
                        <SelectTrigger className="w-40 h-8 text-[12px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {templateStyles.map(style => (
                            <SelectItem key={style.id} value={style.id} className="text-[12px]">
                              {style.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <ScrollArea className="h-0 grow">
                    <div className="p-8">
                      <div 
                        className="max-w-2xl mx-auto bg-card border border-border shadow-sm"
                        style={{ 
                          padding: `${currentStyle.page.margin.top}cm ${currentStyle.page.margin.right}cm`,
                          minHeight: "600px"
                        }}
                      >
                        {/* Report Header Preview */}
                        <div className="text-center mb-8 pb-4 border-b-2" style={{ borderColor: currentStyle.preview.primaryColor }}>
                          <h1 
                            style={{ 
                              fontFamily: currentStyle.styles.h1.font,
                              fontSize: `${currentStyle.styles.h1.sizePt}pt`,
                              fontWeight: currentStyle.styles.h1.bold ? "bold" : "normal",
                              color: currentStyle.styles.h1.color || "#000",
                              marginBottom: `${currentStyle.styles.h1.spaceAfterPt}pt`,
                            }}
                          >
                            法律尽职调查报告
                          </h1>
                          <p 
                            style={{ 
                              fontFamily: currentStyle.styles.body.font,
                              fontSize: `${currentStyle.styles.body.sizePt}pt`,
                              color: "#666",
                            }}
                          >
                            {currentProject?.target || "目标公司名称"}
                          </p>
                        </div>

                        {/* Sample Section */}
                        <div className="mb-6">
                          <h2 
                            style={{ 
                              fontFamily: currentStyle.styles.h1.font,
                              fontSize: `${currentStyle.styles.h1.sizePt}pt`,
                              fontWeight: currentStyle.styles.h1.bold ? "bold" : "normal",
                              color: currentStyle.styles.h1.color || "#000",
                              marginBottom: `${currentStyle.styles.h1.spaceAfterPt}pt`,
                            }}
                          >
                            一、公司基本情况
                          </h2>
                          
                          <h3 
                            style={{ 
                              fontFamily: currentStyle.styles.h2.font,
                              fontSize: `${currentStyle.styles.h2.sizePt}pt`,
                              fontWeight: currentStyle.styles.h2.bold ? "bold" : "normal",
                              color: currentStyle.styles.h2.color || "#000",
                              marginTop: `${currentStyle.styles.h2.spaceBeforePt}pt`,
                              marginBottom: `${currentStyle.styles.h2.spaceAfterPt}pt`,
                            }}
                          >
                            1.1 公司设立及历史沿革
                          </h3>
                          
                          <p 
                            style={{ 
                              fontFamily: currentStyle.styles.body.font,
                              fontSize: `${currentStyle.styles.body.sizePt}pt`,
                              lineHeight: currentStyle.styles.body.lineSpacing,
                              textIndent: `${currentStyle.styles.body.firstLineIndentCm}cm`,
                              textAlign: currentStyle.styles.body.align as "justify" | "left" | "center" | "right" || "justify",
                              marginBottom: `${currentStyle.styles.body.spaceAfterPt}pt`,
                            }}
                          >
                            根据我们审阅的工商登记资料，目标公司成立于2018年3月15日，注册资本人民币5,000万元，已全额实缴。公司统一社会信用代码为91110108MA01XXXXXX。
                          </p>
                          
                          <p 
                            style={{ 
                              fontFamily: currentStyle.styles.body.font,
                              fontSize: `${currentStyle.styles.body.sizePt}pt`,
                              lineHeight: currentStyle.styles.body.lineSpacing,
                              textIndent: `${currentStyle.styles.body.firstLineIndentCm}cm`,
                              textAlign: currentStyle.styles.body.align as "justify" | "left" | "center" | "right" || "justify",
                              marginBottom: `${currentStyle.styles.body.spaceAfterPt}pt`,
                            }}
                          >
                            目标公司的经营范围包括：技术开发、技术咨询、技术服务、技术转让；软件开发；数据处理；计算机系统服务。公司经营范围合法合规，未见超范围经营情形。
                          </p>
                        </div>

                        {/* Sample Table */}
                        <div className="mb-6">
                          <h3 
                            style={{ 
                              fontFamily: currentStyle.styles.h2.font,
                              fontSize: `${currentStyle.styles.h2.sizePt}pt`,
                              fontWeight: currentStyle.styles.h2.bold ? "bold" : "normal",
                              color: currentStyle.styles.h2.color || "#000",
                              marginTop: `${currentStyle.styles.h2.spaceBeforePt}pt`,
                              marginBottom: `${currentStyle.styles.h2.spaceAfterPt}pt`,
                            }}
                          >
                            1.2 股权结构
                          </h3>
                          
                          <table 
                            className="w-full mb-4"
                            style={{
                              fontFamily: currentStyle.tables.default.font,
                              fontSize: `${currentStyle.tables.default.sizePt}pt`,
                              borderCollapse: "collapse",
                            }}
                          >
                            <thead>
                              <tr style={{ backgroundColor: currentStyle.tables.default.headerFill }}>
                                <th style={{
                                  border: `${currentStyle.tables.default.borderSizePt}pt solid ${currentStyle.tables.default.borderColor}`,
                                  padding: `${currentStyle.tables.default.cellPaddingPt}pt`,
                                  fontWeight: currentStyle.tables.default.headerBold ? "bold" : "normal",
                                  textAlign: currentStyle.tables.default.align as "center" | "left" | "right",
                                }}>
                                  序号
                                </th>
                                <th style={{
                                  border: `${currentStyle.tables.default.borderSizePt}pt solid ${currentStyle.tables.default.borderColor}`,
                                  padding: `${currentStyle.tables.default.cellPaddingPt}pt`,
                                  fontWeight: currentStyle.tables.default.headerBold ? "bold" : "normal",
                                  textAlign: currentStyle.tables.default.align as "center" | "left" | "right",
                                }}>
                                  股东名称
                                </th>
                                <th style={{
                                  border: `${currentStyle.tables.default.borderSizePt}pt solid ${currentStyle.tables.default.borderColor}`,
                                  padding: `${currentStyle.tables.default.cellPaddingPt}pt`,
                                  fontWeight: currentStyle.tables.default.headerBold ? "bold" : "normal",
                                  textAlign: currentStyle.tables.default.align as "center" | "left" | "right",
                                }}>
                                  持股比例
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {[
                                { no: 1, name: "张明", ratio: "35%" },
                                { no: 2, name: "李华", ratio: "25%" },
                                { no: 3, name: "深圳创新投资", ratio: "20%" },
                                { no: 4, name: "员工持股平台", ratio: "20%" },
                              ].map((row) => (
                                <tr key={row.no}>
                                  <td style={{
                                    border: `${currentStyle.tables.default.borderSizePt}pt solid ${currentStyle.tables.default.borderColor}`,
                                    padding: `${currentStyle.tables.default.cellPaddingPt}pt`,
                                    textAlign: currentStyle.tables.default.align as "center" | "left" | "right",
                                  }}>
                                    {row.no}
                                  </td>
                                  <td style={{
                                    border: `${currentStyle.tables.default.borderSizePt}pt solid ${currentStyle.tables.default.borderColor}`,
                                    padding: `${currentStyle.tables.default.cellPaddingPt}pt`,
                                    textAlign: currentStyle.tables.default.align as "center" | "left" | "right",
                                  }}>
                                    {row.name}
                                  </td>
                                  <td style={{
                                    border: `${currentStyle.tables.default.borderSizePt}pt solid ${currentStyle.tables.default.borderColor}`,
                                    padding: `${currentStyle.tables.default.cellPaddingPt}pt`,
                                    textAlign: currentStyle.tables.default.align as "center" | "left" | "right",
                                  }}>
                                    {row.ratio}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          
                          <p 
                            style={{ 
                              fontFamily: currentStyle.styles.caption.font,
                              fontSize: `${currentStyle.styles.caption.sizePt}pt`,
                              textAlign: currentStyle.styles.caption.align,
                              color: "#666",
                            }}
                          >
                            表1：目标公司股权结构
                          </p>
                        </div>

                        {/* Quote Sample */}
                        <div 
                          className="mb-6"
                          style={{
                            fontFamily: currentStyle.styles.quote.font,
                            fontSize: `${currentStyle.styles.quote.sizePt}pt`,
                            lineHeight: currentStyle.styles.quote.lineSpacing,
                            marginLeft: `${currentStyle.styles.quote.indentLeftCm}cm`,
                            paddingLeft: currentStyle.styles.quote.borderLeft ? "12px" : "0",
                            borderLeft: currentStyle.styles.quote.borderLeft ? `3px solid ${currentStyle.preview.primaryColor}` : "none",
                            color: "#555",
                          }}
                        >
                          "根据公司章程第十二条规定，股东会是公司的最高权力机构，对公司增加或者减少注册资本、分配利润等重大事项作出决议。"
                        </div>
                      </div>
                    </div>
                  </ScrollArea>
                </div>
              </div>
            </TabsContent>

            {/* TOC Tab - Real Data */}
            <TabsContent value="toc" className="absolute inset-0 m-0">
              <div className="absolute inset-0 flex">
                {/* Left: Chapter list */}
                <div className="w-5/12 border-r border-border flex flex-col min-h-0">
                  <div className="shrink-0 px-4 py-3 border-b border-border bg-surface-subtle">
                    <div className="flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-muted-foreground" />
                      <span className="text-[13px] font-medium">报告目录</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      共 {chapterCounts.level1} 个一级章节 · {chapterCounts.level2} 个二级章节
                    </p>
                  </div>
                  <div className="h-0 grow overflow-y-auto p-4">
                    <ChapterTree chapters={chapters} />
                  </div>
                </div>

                {/* Right: TOC preview */}
                <div className="flex-1 flex flex-col min-h-0 bg-surface-subtle/30">
                  <div className="shrink-0 px-4 py-3 border-b border-border">
                    <div className="flex items-center gap-2">
                      <Eye className="w-4 h-4 text-muted-foreground" />
                      <span className="text-[13px] font-medium">目录预览</span>
                    </div>
                  </div>
                  <div className="h-0 grow overflow-y-auto p-8">
                    <div className="max-w-2xl mx-auto bg-card border border-border shadow-sm p-12">
                      <h1 className="text-2xl font-bold text-center mb-8">目 录</h1>
                      <div className="space-y-2 text-[14px]">
                        {chapters.map((chapter, idx) => (
                          <div key={chapter.id}>
                            <div className="flex items-baseline gap-2">
                              <span className="font-mono w-8">{chapter.number || String(idx + 1)}</span>
                              <span className="flex-1 font-semibold">{chapter.title}</span>
                              <span className="text-muted-foreground border-b border-dotted border-muted-foreground flex-1 mx-2" />
                              <span className="text-muted-foreground">1</span>
                            </div>
                            {chapter.children?.map((child, childIdx) => (
                              <div key={child.id} className="flex items-baseline gap-2 ml-8 mt-1">
                                <span className="font-mono w-8">{child.number || `${idx + 1}.${childIdx + 1}`}</span>
                                <span className="flex-1">{child.title}</span>
                                <span className="text-muted-foreground border-b border-dotted border-muted-foreground flex-1 mx-2" />
                                <span className="text-muted-foreground">1</span>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Page Settings Tab */}
            <TabsContent value="page" className="absolute inset-0 m-0">
              <div className="absolute inset-0 overflow-y-auto">
                <div className="max-w-4xl mx-auto p-8">
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 bg-blue-50 border border-blue-200 rounded flex items-start gap-3 mb-6"
                  >
                    <Settings className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="font-medium text-[13px] text-blue-900">页面设置</div>
                      <div className="text-[12px] text-blue-700 mt-0.5">
                        以下设置从样本报告中提取，将应用于生成的DOCX文档。
                      </div>
                    </div>
                  </motion.div>
                  <PageSettingsPanel page={mockTemplateFingerprint.page} />
                </div>
              </div>
            </TabsContent>

            {/* Numbering Tab */}
            <TabsContent value="numbering" className="absolute inset-0 m-0">
              <div className="absolute inset-0 overflow-y-auto">
                <div className="max-w-4xl mx-auto p-8">
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 bg-blue-50 border border-blue-200 rounded flex items-start gap-3 mb-6"
                  >
                    <Hash className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="font-medium text-[13px] text-blue-900">编号配置</div>
                      <div className="text-[12px] text-blue-700 mt-0.5">
                        定义报告章节的多级编号规则，确保与样本报告一致。
                      </div>
                    </div>
                  </motion.div>
                  <NumberingPanel numbering={mockTemplateFingerprint.numbering} />
                </div>
              </div>
            </TabsContent>

            {/* Typography Tab */}
            <TabsContent value="typography" className="absolute inset-0 m-0">
              <div className="absolute inset-0 overflow-y-auto">
                <div className="max-w-4xl mx-auto p-8 space-y-6">
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 bg-blue-50 border border-blue-200 rounded flex items-start gap-3"
                  >
                    <Palette className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="font-medium text-[13px] text-blue-900">排版样式已提取</div>
                      <div className="text-[12px] text-blue-700 mt-0.5">
                        以下样式Token从样本报告中自动提取，将应用于最终生成的DOCX报告。样式已锁定。
                      </div>
                    </div>
                  </motion.div>

                  <div>
                    <h3 className="text-[15px] font-semibold mb-4 flex items-center gap-2">
                      <Type className="w-4 h-4" />
                      标题样式
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      <StyleTokenCard label="一级标题 H1" token={mockTemplateFingerprint.styles.h1} description="用于报告主要章节标题" />
                      <StyleTokenCard label="二级标题 H2" token={mockTemplateFingerprint.styles.h2} description="用于章节下的子标题" />
                      <StyleTokenCard label="三级标题 H3" token={mockTemplateFingerprint.styles.h3} description="用于细分内容标题" />
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <h3 className="text-[15px] font-semibold mb-4 flex items-center gap-2">
                      <AlignJustify className="w-4 h-4" />
                      正文样式
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      <StyleTokenCard label="正文 Body" token={mockTemplateFingerprint.styles.body} description="报告主体内容的段落样式" />
                      <StyleTokenCard label="引用 Quote" token={mockTemplateFingerprint.styles.quote} description="用于引用原始文件内容" />
                      <StyleTokenCard label="图注 Caption" token={mockTemplateFingerprint.styles.caption} description="图表的标题和注释" />
                      <StyleTokenCard label="脚注 Footnote" token={mockTemplateFingerprint.styles.footnote} description="页面底部的脚注文字" />
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <h3 className="text-[15px] font-semibold mb-4 flex items-center gap-2">
                      <List className="w-4 h-4" />
                      列表样式
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      <StyleTokenCard
                        label="无序列表 Bullet"
                        token={{
                          glyph: mockTemplateFingerprint.lists.bullet.glyph,
                          indentLeftCm: mockTemplateFingerprint.lists.bullet.indentLeftCm,
                          hangingCm: mockTemplateFingerprint.lists.bullet.hangingCm,
                        }}
                      />
                      <StyleTokenCard
                        label="有序列表 Ordered"
                        token={{
                          format: mockTemplateFingerprint.lists.ordered.format,
                          indentLeftCm: mockTemplateFingerprint.lists.ordered.indentLeftCm,
                          hangingCm: mockTemplateFingerprint.lists.ordered.hangingCm,
                        }}
                      />
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <h3 className="text-[15px] font-semibold mb-4 flex items-center gap-2">
                      <Image className="w-4 h-4" />
                      图表样式
                    </h3>
                    <StyleTokenCard
                      label="图表设置 Figures"
                      token={{
                        captionFormat: mockTemplateFingerprint.figures.captionFormat,
                        captionStyle: mockTemplateFingerprint.figures.captionStyle,
                        placeCaption: mockTemplateFingerprint.figures.placeCaption === "below" ? "图下方" : "图上方",
                        maxWidthPercent: `${mockTemplateFingerprint.figures.maxWidthPercent}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Tables Tab */}
            <TabsContent value="tables" className="absolute inset-0 m-0">
              <div className="absolute inset-0 overflow-y-auto">
                <div className="max-w-4xl mx-auto p-8">
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 bg-blue-50 border border-blue-200 rounded flex items-start gap-3 mb-6"
                  >
                    <Table2 className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="font-medium text-[13px] text-blue-900">表格样式</div>
                      <div className="text-[12px] text-blue-700 mt-0.5">
                        定义报告中表格的边框、颜色、字体等样式，确保与样本一致。
                      </div>
                    </div>
                  </motion.div>
                  <TableStylePanel tables={mockTemplateFingerprint.tables} />
                </div>
              </div>
            </TabsContent>

            {/* Intro Tab */}
            <TabsContent value="intro" className="absolute inset-0 m-0">
              <div className="absolute inset-0 flex">
                {/* Left: Variables */}
                <div className="w-4/12 border-r border-border flex flex-col min-h-0">
                  <div className="shrink-0 px-4 py-3 border-b border-border bg-surface-subtle">
                    <div className="flex items-center gap-2">
                      <Edit3 className="w-4 h-4 text-muted-foreground" />
                      <span className="text-[13px] font-medium">可编辑变量</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      填写变量值，将自动替换引言中的占位符
                    </p>
                  </div>
                  <div className="h-0 grow overflow-y-auto p-4">
                    <div className="space-y-4">
                      {variables.map((v) => (
                        <div key={v.id}>
                          <Label className="text-[12px] text-muted-foreground flex items-center gap-1">
                            {v.name}
                            {v.required && <span className="text-red-500">*</span>}
                          </Label>
                          <Input
                            value={v.value}
                            onChange={(e) => handleVariableChange(v.id, e.target.value)}
                            placeholder={v.placeholder}
                            className="mt-1"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="shrink-0 p-4 border-t border-border">
                    <Button onClick={handleSaveVariables} className="w-full gap-2">
                      <Save className="w-4 h-4" />
                      保存变量
                    </Button>
                  </div>
                </div>

                {/* Right: Intro preview */}
                <div className="flex-1 flex flex-col min-h-0 bg-surface-subtle/30">
                  <div className="shrink-0 px-4 py-3 border-b border-border">
                    <div className="flex items-center gap-2">
                      <Eye className="w-4 h-4 text-muted-foreground" />
                      <span className="text-[13px] font-medium">引言预览</span>
                    </div>
                  </div>
                  <div className="h-0 grow overflow-y-auto p-8">
                    <div className="max-w-2xl mx-auto bg-card border border-border shadow-sm p-12">
                      <h1 className="text-xl font-bold mb-8">引 言</h1>

                      <section className="mb-6">
                        <h2 className="text-[15px] font-bold mb-3">一、项目背景</h2>
                        <p className="text-[13px] leading-relaxed text-justify indent-8">
                          {processedIntro.background}
                        </p>
                      </section>

                      <section className="mb-6">
                        <h2 className="text-[15px] font-bold mb-3">二、工作范围</h2>
                        <p className="text-[13px] leading-relaxed text-justify indent-8">
                          {processedIntro.scope}
                        </p>
                      </section>

                      <section className="mb-6">
                        <h2 className="text-[15px] font-bold mb-3">三、尽调方法</h2>
                        <p className="text-[13px] leading-relaxed text-justify indent-8">
                          {processedIntro.methodology}
                        </p>
                      </section>

                      <section className="mb-6">
                        <h2 className="text-[15px] font-bold mb-3">四、免责声明</h2>
                        <p className="text-[13px] leading-relaxed text-justify indent-8">
                          {processedIntro.disclaimer}
                        </p>
                      </section>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* JSON Tab */}
            <TabsContent value="json" className="absolute inset-0 m-0">
              <div className="absolute inset-0 overflow-y-auto">
                <div className="max-w-5xl mx-auto p-8">
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 bg-amber-50 border border-amber-200 rounded flex items-start gap-3 mb-6"
                  >
                    <FileCode className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="font-medium text-[13px] text-amber-900">章节结构 JSON</div>
                      <div className="text-[12px] text-amber-700 mt-0.5">
                        以下是当前报告的章节结构 JSON 数据。
                      </div>
                    </div>
                  </motion.div>
                  <div className="bg-card border border-border rounded-lg overflow-hidden">
                    <div className="px-4 py-2 bg-muted/50 border-b border-border flex items-center justify-between">
                      <span className="text-[12px] font-mono text-muted-foreground">chapters.json</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-[11px]"
                        onClick={() => {
                          navigator.clipboard.writeText(JSON.stringify(chapters, null, 2));
                          toast.success("已复制到剪贴板");
                        }}
                      >
                        复制
                      </Button>
                    </div>
                    <pre className="p-4 text-[11px] font-mono overflow-x-auto bg-muted/20 max-h-[500px]">
                      {JSON.stringify(chapters, null, 2)}
                    </pre>
                  </div>
                </div>
              </div>
            </TabsContent>
          </div>
        </Tabs>
      )}
    </div>
  );
}
