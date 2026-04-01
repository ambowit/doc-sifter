import type {
  TemplateFingerprint as BaseTemplateFingerprint,
  NumberingConfig,
  PageConfig,
  ListStyleConfig,
  FigureStyleConfig,
} from "@/lib/reportTypes";

export interface TemplatePreview {
  primaryColor: string;
  secondaryColor?: string;
  accentColor: string;
  headerDecoration?: "none" | "line" | "double-line" | "gradient" | "pattern";
  sectionDivider?: "none" | "simple" | "dotted" | "diamond" | "wave";
  quoteStyle?: "border-left" | "background" | "quotes" | "bracket";
  titleDecoration?: "none" | "underline" | "box" | "ribbon" | "badge";
  pageCorner?: "none" | "fold" | "stamp" | "watermark";
  bulletStyle?: "disc" | "circle" | "square" | "arrow" | "check" | "number";
}

export type TemplateFingerprint = BaseTemplateFingerprint & {
  preview: TemplatePreview;
  id?: string;
  projectId?: string;
  createdAt?: string;
  updatedAt?: string;
};

const DEFAULT_NUMBERING: NumberingConfig = {
  scheme: "1|1.1|1.1.1",
  headingLevels: 3,
  prefixRules: {
    h1: "",
    h2: "",
    h3: "",
  },
};

const DEFAULT_PAGE: PageConfig = {
  size: "A4",
  orientation: "portrait",
  margin: {
    top: 2.5,
    bottom: 2.5,
    left: 3,
    right: 2.5,
    unit: "cm",
  },
  headerFooter: {
    hasHeader: false,
    hasFooter: true,
    footerHasPageNumber: true,
    pageNumberStyle: "center",
  },
};

const DEFAULT_LISTS: ListStyleConfig = {
  bullet: {
    glyph: "•",
    indentLeftCm: 0.8,
    hangingCm: 0.4,
  },
  ordered: {
    format: "1.",
    indentLeftCm: 0.8,
    hangingCm: 0.4,
  },
};

const DEFAULT_FIGURES: FigureStyleConfig = {
  captionFormat: "图{n}：{title}",
  captionStyle: "caption",
  placeCaption: "below",
  maxWidthPercent: 90,
};

export const DEFAULT_TEMPLATE_FINGERPRINT: TemplateFingerprint = {
  templateId: "tpl_default",
  name: "标准模板",
  version: "1.0",
  locale: "zh-CN",
  extractedAt: new Date().toISOString(),
  status: "draft",
  numbering: DEFAULT_NUMBERING,
  page: DEFAULT_PAGE,
  styles: {
    h1: {
      font: "宋体",
      sizePt: 18,
      bold: true,
      spaceBeforePt: 16,
      spaceAfterPt: 8,
      lineSpacing: 1.3,
      color: "#111827",
    },
    h2: {
      font: "宋体",
      sizePt: 14,
      bold: true,
      spaceBeforePt: 12,
      spaceAfterPt: 6,
      lineSpacing: 1.3,
      color: "#1f2937",
    },
    h3: {
      font: "宋体",
      sizePt: 12,
      bold: true,
      spaceBeforePt: 8,
      spaceAfterPt: 4,
      lineSpacing: 1.3,
      color: "#374151",
    },
    body: {
      font: "宋体",
      sizePt: 11,
      bold: false,
      spaceBeforePt: 0,
      spaceAfterPt: 6,
      lineSpacing: 1.6,
      firstLineIndentCm: 0.75,
      align: "justify",
      color: "#111827",
    },
    quote: {
      font: "宋体",
      sizePt: 10.5,
      bold: false,
      spaceBeforePt: 6,
      spaceAfterPt: 6,
      lineSpacing: 1.5,
      indentLeftCm: 0.6,
      borderLeft: true,
      color: "#374151",
    },
    caption: {
      font: "宋体",
      sizePt: 10,
      bold: false,
      spaceBeforePt: 4,
      spaceAfterPt: 4,
      lineSpacing: 1.3,
      align: "center",
      color: "#4b5563",
    },
    footnote: {
      font: "宋体",
      sizePt: 9,
    },
  },
  lists: DEFAULT_LISTS,
  tables: {
    default: {
      border: "single",
      borderSizePt: 0.5,
      headerFill: "#f3f4f6",
      cellPaddingPt: 4,
      headerBold: true,
      align: "left",
      font: "宋体",
      sizePt: 10,
      borderColor: "#d1d5db",
    },
  },
  figures: DEFAULT_FIGURES,
  toc: [],
  sectionBlueprints: {},
  introVariables: [
    { id: "var_client", name: "委托方名称", value: "", placeholder: "XX资本", required: true },
    { id: "var_target", name: "标的公司名称", value: "", placeholder: "XX有限公司", required: true },
    { id: "var_date", name: "报告日期", value: "", placeholder: "YYYY年MM月DD日", required: true },
    { id: "var_cutoff", name: "截止日期", value: "", placeholder: "YYYY年MM月DD日", required: true },
    { id: "var_firm", name: "律所名称", value: "", placeholder: "XX律师事务所", required: true },
  ],
  introContent: {
    background: "受{委托方名称}委托，本所律师对{标的公司名称}进行法律尽职调查，并出具本报告。",
    scope: "本次尽职调查涵盖公司设立沿革、股权结构、主要资产、重大合同、劳动人事、诉讼仲裁与合规经营等内容。",
    methodology: "调查方法包括文件审阅、访谈核实及必要的公开信息检索。",
    disclaimer: "本报告仅供委托方内部决策参考使用，未经书面同意不得对外披露。",
  },
  preview: {
    primaryColor: "#111827",
    secondaryColor: "#374151",
    accentColor: "#374151",
    headerDecoration: "double-line",
    sectionDivider: "simple",
    quoteStyle: "border-left",
    titleDecoration: "underline",
    pageCorner: "none",
    bulletStyle: "disc",
  },
};

export function createDefaultTemplateFingerprint(): TemplateFingerprint {
  return {
    ...DEFAULT_TEMPLATE_FINGERPRINT,
    extractedAt: new Date().toISOString(),
  };
}
