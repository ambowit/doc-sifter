/**
 * DD Report Generation System - Type Definitions
 * 三层JSON数据模型：Template Fingerprint + Knowledge Graph + Report Plan
 * 
 * @version 2.0.0
 * @description 生产级尽职调查报告生成系统类型定义
 */

// =============================================================================
// LAYER 1: TEMPLATE FINGERPRINT (样本指纹)
// =============================================================================

/** 编号规则配置 */
export interface NumberingConfig {
  /** 编号方案: "1|1.1|1.1.1" */
  scheme: string;
  /** 标题层级数 */
  headingLevels: 1 | 2 | 3 | 4;
  /** 各层级前缀规则 */
  prefixRules: {
    h1: string;
    h2: string;
    h3: string;
    h4?: string;
  };
}

/** 页面设置 */
export interface PageConfig {
  /** 纸张大小 */
  size: "A4" | "Letter" | "Legal";
  /** 纸张方向 */
  orientation: "portrait" | "landscape";
  /** 边距配置 (cm) */
  margin: {
    top: number;
    bottom: number;
    left: number;
    right: number;
    unit: "cm" | "pt" | "in";
  };
  /** 页眉页脚配置 */
  headerFooter: {
    hasHeader: boolean;
    hasFooter: boolean;
    footerHasPageNumber: boolean;
    pageNumberStyle: "center" | "right" | "left";
    headerLogo?: {
      enabled: boolean;
      position: "left" | "right" | "center";
      maxHeightCm: number;
    };
  };
}

/** 样式Token基础结构 */
export interface BaseStyleToken {
  /** 字体 */
  font: string;
  /** 字号 (pt) */
  sizePt: number;
  /** 粗体 */
  bold: boolean;
  /** 段前间距 (pt) */
  spaceBeforePt: number;
  /** 段后间距 (pt) */
  spaceAfterPt: number;
  /** 行距 */
  lineSpacing: number;
  /** 颜色 (HEX) */
  color?: string;
}

/** 标题样式Token */
export interface HeadingStyleToken extends BaseStyleToken {
  /** 编号缩进 (cm) */
  numberIndentCm?: number;
}

/** 正文样式Token */
export interface BodyStyleToken extends BaseStyleToken {
  /** 首行缩进 (cm) */
  firstLineIndentCm: number;
  /** 对齐方式 */
  align?: "left" | "justify" | "center" | "right";
}

/** 引用样式Token */
export interface QuoteStyleToken extends BaseStyleToken {
  /** 左缩进 (cm) */
  indentLeftCm: number;
  /** 左边框 */
  borderLeft?: boolean;
}

/** 标题/图注样式Token */
export interface CaptionStyleToken extends BaseStyleToken {
  /** 对齐方式 */
  align: "left" | "center" | "right";
}

/** 脚注样式Token */
export interface FootnoteStyleToken {
  font: string;
  sizePt: number;
}

/** 列表样式配置 */
export interface ListStyleConfig {
  bullet: {
    /** 项目符号 */
    glyph: string;
    /** 左缩进 (cm) */
    indentLeftCm: number;
    /** 悬挂缩进 (cm) */
    hangingCm: number;
  };
  ordered: {
    /** 编号格式 */
    format: string;
    /** 左缩进 (cm) */
    indentLeftCm: number;
    /** 悬挂缩进 (cm) */
    hangingCm: number;
  };
}

/** 表格样式配置 */
export interface TableStyleConfig {
  /** 边框样式 */
  border: "single" | "double" | "none" | "threeLines";
  /** 边框宽度 (pt) */
  borderSizePt: number;
  /** 表头背景色 */
  headerFill: string;
  /** 单元格内边距 (pt) */
  cellPaddingPt: number;
  /** 表头粗体 */
  headerBold: boolean;
  /** 对齐方式 */
  align: "left" | "center" | "right";
  /** 字体 */
  font: string;
  /** 字号 (pt) */
  sizePt: number;
  /** 边框颜色 */
  borderColor?: string;
}

/** 图表样式配置 */
export interface FigureStyleConfig {
  /** 图注格式: "图{n}：{title}" */
  captionFormat: string;
  /** 图注样式引用 */
  captionStyle: string;
  /** 图注位置 */
  placeCaption: "above" | "below";
  /** 图片最大宽度 (相对页面可用宽度) */
  maxWidthPercent?: number;
}

/** 目录项策略 */
export type SectionPolicy = 
  | "copy_from_template"  // 从模板复制固定内容
  | "generate"            // 基于数据生成
  | "manual";             // 手动编辑

/** 目录项 */
export interface TOCItem {
  /** 唯一标识 */
  id: string;
  /** 层级 */
  level: 1 | 2 | 3 | 4;
  /** 编号 */
  number: string;
  /** 标题 */
  title: string;
  /** 内容策略 */
  policy: SectionPolicy;
  /** 是否固定内容 */
  isFixed?: boolean;
  /** 子目录 */
  children?: TOCItem[];
}

/** 章节蓝图 - 定义每章节的内容块和格式规则 */
export interface SectionBlueprint {
  /** 内容块类型数组 */
  blocks: Array<
    | { type: "template_text_block"; source: string }
    | { type: "definitions_table"; dataRef: string; styleRef: string }
    | { type: "equity_chart"; dataRef: string; caption: string; styleRef: string }
    | { type: "equity_table"; dataRef: string; styleRef: string }
    | { type: "facts_list"; source: string; style: string; maxItems?: number }
    | { type: "reviewed_docs_list"; source: string; style: string }
    | { type: "key_facts"; source: string; style: string; maxItems?: number }
    | { type: "risk_notes"; source: string; style: string; policy?: string }
    | { type: "missing_notice"; condition: string; text: string; style: string }
    | { type: "paragraph"; style: string; text: string; evidenceRefs?: Array<{ fid: string }> }
    | { type: "table"; dataRef: string; styleRef: string; columns: string[] }
    | { type: "figure"; figureKind: string; dataRef: string; caption: string; styleRef: string }
  >;
  /** 格式要求 */
  format: "same_as_template" | "custom";
}

/** Template Fingerprint - 样本报告的完整描述 */
export interface TemplateFingerprint {
  /** 模板ID */
  templateId: string;
  /** 模板名称 */
  name: string;
  /** 版本 */
  version: string;
  /** 语言 */
  locale: string;
  /** 提取时间 */
  extractedAt: string;
  /** 状态 */
  status: "draft" | "locked" | "archived";
  
  /** 编号配置 */
  numbering: NumberingConfig;
  
  /** 页面配置 */
  page: PageConfig;
  
  /** 样式集 */
  styles: {
    h1: HeadingStyleToken;
    h2: HeadingStyleToken;
    h3: HeadingStyleToken;
    h4?: HeadingStyleToken;
    body: BodyStyleToken;
    quote: QuoteStyleToken;
    caption: CaptionStyleToken;
    footnote: FootnoteStyleToken;
  };
  
  /** 列表样式 */
  lists: ListStyleConfig;
  
  /** 表格样式 */
  tables: {
    default: TableStyleConfig;
    threeLines?: TableStyleConfig;
  };
  
  /** 图表样式 */
  figures: FigureStyleConfig;
  
  /** 目录结构 */
  toc: TOCItem[];
  
  /** 章节蓝图 */
  sectionBlueprints: Record<string, SectionBlueprint>;
  
  /** 引言变量 */
  introVariables: Array<{
    id: string;
    name: string;
    value: string;
    placeholder: string;
    required: boolean;
  }>;
  
  /** 引言内容模板 */
  introContent: {
    background: string;
    scope: string;
    methodology: string;
    disclaimer: string;
  };
}

// =============================================================================
// LAYER 2: DATA ROOM KNOWLEDGE GRAPH (数据室知识图谱)
// =============================================================================

/** 实体类型 */
export type EntityType = 
  | "company"
  | "shareholder"
  | "individual"
  | "institution"
  | "transaction"
  | "contract"
  | "asset"
  | "patent"
  | "trademark"
  | "other";

/** 证据引用 */
export interface EvidenceRef {
  /** 文档ID */
  docId: string;
  /** 定位信息 (页码/表格/段落) */
  loc: string;
  /** 引用片段 */
  quote?: string;
}

/** 实体 */
export interface Entity {
  /** 实体ID */
  eid: string;
  /** 实体类型 */
  type: EntityType;
  /** 名称 */
  name: string;
  /** 别名/简称 */
  aliases: string[];
  /** 证据引用 */
  refs: EvidenceRef[];
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/** 事实类型 */
export type FactType =
  | "equity_holding"      // 股权持有
  | "establishment"       // 公司设立
  | "registration"        // 工商登记
  | "governance"          // 公司治理
  | "contract_material"   // 重大合同
  | "litigation"          // 诉讼
  | "ip_patent"           // 专利
  | "ip_trademark"        // 商标
  | "ip_software"         // 软著
  | "financial"           // 财务
  | "tax"                 // 税务
  | "hr"                  // 人力资源
  | "compliance"          // 合规
  | "risk_flag"           // 风险标记
  | "other";

/** 冲突信息 */
export interface Conflict {
  /** 冲突事实ID */
  conflictWith: string;
  /** 冲突类型 */
  conflictType: "value_mismatch" | "date_mismatch" | "source_conflict";
  /** 描述 */
  description: string;
}

/** 事实 */
export interface Fact {
  /** 事实ID */
  fid: string;
  /** 事实类型 */
  type: FactType;
  /** 主体实体ID */
  subject: string;
  /** 客体实体ID (可选) */
  object?: string;
  /** 事实值 */
  value: Record<string, unknown>;
  /** 时间信息 */
  time?: {
    asOf?: string;       // 截止日期
    effectiveDate?: string;
    expiryDate?: string;
  };
  /** 证据引用 */
  evidence: EvidenceRef[];
  /** 置信度 (0-1) */
  confidence: number;
  /** 冲突检测 */
  conflicts: Conflict[];
  /** 章节提示 (建议归属的章节) */
  sectionHint?: string;
}

/** 文档类型 */
export type DocumentType =
  | "business_license"    // 营业执照
  | "charter"             // 公司章程
  | "shareholders_resolution" // 股东会决议
  | "board_resolution"    // 董事会决议
  | "registry"            // 股东名册
  | "contract"            // 合同
  | "audit_report"        // 审计报告
  | "tax_filing"          // 税务申报
  | "patent_cert"         // 专利证书
  | "trademark_cert"      // 商标证书
  | "software_cert"       // 软著证书
  | "litigation_doc"      // 诉讼文件
  | "hr_doc"              // 人事文件
  | "other";

/** 文档 */
export interface Document {
  /** 文档ID */
  docId: string;
  /** 文件路径 */
  path: string;
  /** 文件名 */
  filename: string;
  /** 文档类型 */
  docType: DocumentType;
  /** 是否已解析 */
  parsed: boolean;
  /** 解析状态 */
  parseStatus?: "pending" | "processing" | "completed" | "failed";
  /** 页数 */
  pageCount?: number;
  /** 提取的实体数 */
  entityCount?: number;
  /** 提取的事实数 */
  factCount?: number;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/** 章节覆盖率 */
export interface SectionCoverage {
  /** 关联的事实ID */
  facts: string[];
  /** 关联的文档ID */
  docs: string[];
  /** 覆盖率分数 (0-1) */
  coverageScore: number;
  /** 缺失项 */
  missingItems?: string[];
}

/** Data Room Knowledge Graph */
export interface KnowledgeGraph {
  /** 知识图谱ID */
  kgId: string;
  /** 项目ID */
  projectId: string;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
  
  /** 实体列表 */
  entities: Entity[];
  
  /** 事实列表 */
  facts: Fact[];
  
  /** 文档列表 */
  documents: Document[];
  
  /** 章节覆盖率分析 */
  coverage: {
    /** 按章节提示分组 */
    bySectionHint: Record<string, SectionCoverage>;
    /** 总体覆盖率 */
    overallScore: number;
  };
  
  /** 冲突摘要 */
  conflictSummary: {
    total: number;
    byType: Record<string, number>;
  };
}

// =============================================================================
// LAYER 3: REPORT PLAN (报告编排计划)
// =============================================================================

/** 内容块基础类型 */
export interface BaseContentBlock {
  /** 块ID */
  blockId: string;
  /** 块类型 */
  type: string;
}

/** 模板文本块 */
export interface TemplateTextBlock extends BaseContentBlock {
  type: "template_text_block";
  /** 来源: "template:sec_id" */
  source: string;
  /** 预渲染内容 */
  content?: string;
}

/** 段落块 */
export interface ParagraphBlock extends BaseContentBlock {
  type: "paragraph";
  /** 样式引用 */
  style: string;
  /** 文本内容 */
  text: string;
  /** 证据引用 */
  evidenceRefs?: Array<{ fid: string; docId: string; loc: string }>;
}

/** 表格块 */
export interface TableBlock extends BaseContentBlock {
  type: "table";
  /** 样式引用 */
  styleRef: string;
  /** 数据引用 */
  dataRef: string;
  /** 列定义 */
  columns: Array<{
    key: string;
    label: string;
    width?: number;
  }>;
  /** 表格数据 */
  data: Array<Record<string, unknown>>;
  /** 表标题 */
  caption?: string;
}

/** 定义表块 */
export interface DefinitionsTableBlock extends BaseContentBlock {
  type: "definitions_table";
  /** 数据引用 */
  dataRef: string;
  /** 样式引用 */
  styleRef: string;
  /** 定义数据 */
  definitions: Array<{
    shortName: string;
    fullName: string;
    notes?: string;
  }>;
}

/** 图表块 */
export interface FigureBlock extends BaseContentBlock {
  type: "figure";
  /** 图类型 */
  figureKind: "equity_chart" | "org_chart" | "timeline" | "custom";
  /** 数据引用 */
  dataRef: string;
  /** 图注 */
  caption: string;
  /** 样式引用 */
  styleRef: string;
  /** 图片Base64/URL (渲染后填充) */
  imageData?: string;
}

/** 列表块 */
export interface ListBlock extends BaseContentBlock {
  type: "list";
  /** 列表类型 */
  listType: "bullet" | "ordered";
  /** 样式引用 */
  style: string;
  /** 列表项 */
  items: Array<{
    text: string;
    evidenceRefs?: Array<{ fid: string }>;
  }>;
}

/** 问题表块 */
export interface IssuesTableBlock extends BaseContentBlock {
  type: "issues_table";
  /** 样式引用 */
  styleRef: string;
  /** 问题列表 */
  issues: Array<{
    fact: string;
    risk: string;
    suggestion: string;
    severity: "high" | "medium" | "low";
    evidenceRefs?: Array<{ fid: string; docId: string }>;
  }>;
}

/** 缺失提示块 */
export interface MissingNoticeBlock extends BaseContentBlock {
  type: "missing_notice";
  /** 样式 */
  style: string;
  /** 提示文本 */
  text: string;
  /** 缺失项列表 */
  missingItems: string[];
}

/** 所有内容块类型联合 */
export type ContentBlock =
  | TemplateTextBlock
  | ParagraphBlock
  | TableBlock
  | DefinitionsTableBlock
  | FigureBlock
  | ListBlock
  | IssuesTableBlock
  | MissingNoticeBlock;

/** 章节计划 */
export interface SectionPlan {
  /** 章节ID */
  secId: string;
  /** 章节编号 */
  number: string;
  /** 章节标题 */
  title: string;
  /** 层级 */
  level: 1 | 2 | 3 | 4;
  /** 内容策略 */
  policy: SectionPolicy;
  /** 内容块 */
  contentBlocks: ContentBlock[];
  /** 证据文档ID列表 */
  evidence: string[];
  /** 覆盖率分数 */
  coverageScore: number;
  /** 子章节 */
  children?: SectionPlan[];
}

/** 附录配置 */
export interface AppendixConfig {
  /** 包含证据索引 */
  includeEvidenceIndex: boolean;
  /** 包含定义表 */
  includeDefinitions: boolean;
  /** 包含文件清单 */
  includeFileList: boolean;
}

/** Report Plan - 可渲染的报告计划 */
export interface ReportPlan {
  /** 报告ID */
  reportId: string;
  /** 项目ID */
  projectId: string;
  /** 模板ID */
  templateId: string;
  /** 知识图谱ID */
  kgId: string;
  
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
  /** 状态 */
  status: "draft" | "review" | "approved" | "exported";
  
  /** 报告变量 */
  variables: Record<string, string>;
  
  /** 章节计划 */
  sections: SectionPlan[];
  
  /** 附录配置 */
  appendix: AppendixConfig;
  
  /** 元数据 */
  metadata: {
    /** 目标公司 */
    targetCompany: string;
    /** 委托方 */
    client: string;
    /** 报告日期 */
    reportDate: string;
    /** 截止日 */
    cutoffDate: string;
    /** 律所 */
    lawFirm: string;
  };
  
  /** 统计信息 */
  statistics: {
    totalSections: number;
    totalDocuments: number;
    totalFacts: number;
    totalIssues: number;
    highRiskIssues: number;
    averageCoverage: number;
  };
}

// =============================================================================
// DOCX GENERATION TYPES (DOCX生成类型)
// =============================================================================

/** DOCX样式映射 */
export interface DOCXStyleMapping {
  /** Word样式名称 */
  styleName: string;
  /** 基于的样式 */
  basedOn?: string;
  /** 样式属性 */
  properties: {
    font?: string;
    size?: number;
    bold?: boolean;
    italic?: boolean;
    color?: string;
    alignment?: "left" | "center" | "right" | "justify";
    spaceBefore?: number;
    spaceAfter?: number;
    lineSpacing?: number;
    firstLineIndent?: number;
    leftIndent?: number;
    rightIndent?: number;
  };
}

/** DOCX渲染配置 */
export interface DOCXRenderConfig {
  /** 页面设置 */
  page: PageConfig;
  /** 样式映射 */
  styles: Record<string, DOCXStyleMapping>;
  /** 编号定义 */
  numbering: {
    abstractNumId: number;
    levels: Array<{
      level: number;
      format: string;
      text: string;
      alignment: string;
    }>;
  };
  /** 表格默认设置 */
  tableDefaults: TableStyleConfig;
  /** 图表设置 */
  figureDefaults: FigureStyleConfig;
}

/** QA检查项 */
export interface QACheckItem {
  /** 检查项ID */
  id: string;
  /** 类别 */
  category: "page" | "heading" | "paragraph" | "table" | "figure" | "toc" | "evidence";
  /** 检查项名称 */
  name: string;
  /** 是否通过 */
  passed: boolean;
  /** 差异描述 */
  diff?: string;
  /** 严重程度 */
  severity: "error" | "warning" | "info";
}

/** QA报告 */
export interface QAReport {
  /** 检查时间 */
  checkedAt: string;
  /** 检查项 */
  items: QACheckItem[];
  /** 通过率 */
  passRate: number;
  /** 是否可交付 */
  deliverable: boolean;
}

// =============================================================================
// COMPOSER PIPELINE TYPES (Composer管线类型)
// =============================================================================

/** 管线步骤状态 */
export type PipelineStepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

/** 管线步骤 */
export interface PipelineStep {
  /** 步骤ID */
  stepId: string;
  /** 步骤名称 */
  name: string;
  /** 状态 */
  status: PipelineStepStatus;
  /** 开始时间 */
  startedAt?: string;
  /** 完成时间 */
  completedAt?: string;
  /** 错误信息 */
  error?: string;
  /** 输出 */
  output?: unknown;
}

/** Composer管线 */
export interface ComposerPipeline {
  /** 管线ID */
  pipelineId: string;
  /** 项目ID */
  projectId: string;
  /** 模板ID */
  templateId: string;
  
  /** 步骤列表 */
  steps: PipelineStep[];
  
  /** 当前步骤索引 */
  currentStep: number;
  
  /** 整体状态 */
  status: "idle" | "running" | "completed" | "failed";
  
  /** 中间产物 */
  artifacts: {
    templateFingerprint?: TemplateFingerprint;
    knowledgeGraph?: KnowledgeGraph;
    reportPlan?: ReportPlan;
    docxConfig?: DOCXRenderConfig;
    qaReport?: QAReport;
  };
}

// =============================================================================
// UTILITY TYPES
// =============================================================================

/** 深度只读 */
export type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};

/** 部分更新 */
export type PartialUpdate<T> = {
  [P in keyof T]?: T[P] extends object ? PartialUpdate<T[P]> : T[P];
};
