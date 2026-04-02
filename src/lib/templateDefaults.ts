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
  selectedStyleId?: string | null;
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
    { id: "var_client", name: "客户名称", value: "", placeholder: "XX资本", required: true },
    { id: "var_target", name: "标的公司名称", value: "", placeholder: "XX有限公司", required: true },
    { id: "var_date", name: "报告日期", value: "", placeholder: "YYYY年MM月DD日", required: true },
    { id: "var_cutoff", name: "截止日期", value: "", placeholder: "YYYY年MM月DD日", required: true },
    { id: "var_firm", name: "律所名称", value: "", placeholder: "XX律师事务所", required: true },
  ],
  introContent: {
    background: "受{客户名称}委托，本所律师对{标的公司名称}进行法律尽职调查，并出具本报告。",
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

// 按项目类型的引言内容配置
export const PROJECT_TYPE_INTRO_CONTENT: Record<string, {
  introContent: {
    background: string;
    scope: string;
    methodology: string;
    disclaimer: string;
  };
  introVariables: Array<{ id: string; name: string; value: string; placeholder: string; required: boolean }>;
}> = {
  // 股权收购
  equity_acquisition: {
    introContent: {
      background: "受{客户名称}委托，就其拟收购{标的公司名称}股权事宜，本所律师对{标的公司名称}（以下简称"目标公司"）进行法律尽职调查，并出具本报告。",
      scope: "本次尽职调查涵盖目标公司的设立沿革、股权结构、公司治理、主要资产、知识产权、重大合同、劳动人事、税务、环保、诉讼仲裁及合规经营等方面。",
      methodology: "调查方法包括审阅目标公司提供的文件资料、访谈目标公司管理层及相关人员、进行工商及诉讼等公开信息检索。",
      disclaimer: "本报告仅供委托方进行本次股权收购交易决策参考使用，未经本所书面同意，不得向任何第三方披露或提供。本报告基于委托方及目标公司提供的文件资料作出，如相关资料存在遗漏或不实，本所不对由此产生的后果承担责任。",
    },
    introVariables: [
      { id: "var_client", name: "客户名称", value: "", placeholder: "XX投资有限公司", required: true },
      { id: "var_target", name: "标的公司名称", value: "", placeholder: "XX科技有限公司", required: true },
      { id: "var_date", name: "报告日期", value: "", placeholder: "YYYY年MM月DD日", required: true },
      { id: "var_cutoff", name: "截止日期", value: "", placeholder: "YYYY年MM月DD日", required: true },
      { id: "var_firm", name: "律所名称", value: "", placeholder: "XX律师事务所", required: true },
    ],
  },
  // 资产收购
  asset_acquisition: {
    introContent: {
      background: "受{客户名称}委托，就其拟收购{标的公司名称}相关资产事宜，本所律师对拟收购资产进行法律尽职调查，并出具本报告。",
      scope: "本次尽职调查涵盖拟收购资产的权属情况、资产价值、抵押质押情况、相关合同、许可资质、诉讼仲裁及其他法律风险等方面。",
      methodology: "调查方法包括审阅资产权属证明文件、相关合同协议、评估报告等资料，访谈资产出让方相关人员，进行不动产登记、动产抵押等公开信息检索。",
      disclaimer: "本报告仅供委托方进行本次资产收购交易决策参考使用，未经本所书面同意，不得向任何第三方披露或提供。",
    },
    introVariables: [
      { id: "var_client", name: "客户名称", value: "", placeholder: "XX集团有限公司", required: true },
      { id: "var_target", name: "标的公司名称", value: "", placeholder: "XX制造有限公司", required: true },
      { id: "var_date", name: "报告日期", value: "", placeholder: "YYYY年MM月DD日", required: true },
      { id: "var_cutoff", name: "截止日期", value: "", placeholder: "YYYY年MM月DD日", required: true },
      { id: "var_firm", name: "律所名称", value: "", placeholder: "XX律师事务所", required: true },
    ],
  },
  // IPO
  ipo: {
    introContent: {
      background: "受{客户名称}委托，就其申请首次公开发行股票并上市事宜，本所作为发行人律师对{标的公司名称}（以下简称"发行人"）进行法律尽职调查，并出具本报告。",
      scope: "本次尽职调查涵盖发行人的设立与历史沿革、独立性、股本及演变、业务与资产、关联交易及同业竞争、董事监事高管、公司治理与规范运作、财务与税务、环境保护、诉讼仲裁及行政处罚等方面。",
      methodology: "调查方法包括审阅发行人提供的文件资料、访谈发行人管理层及相关人员、走访发行人主要经营场所、进行工商登记及诉讼仲裁等公开信息核查。",
      disclaimer: "本报告仅供委托方及中介机构内部工作使用，最终法律意见以正式出具的《律师工作报告》及《法律意见书》为准。未经本所书面同意，本报告不得向监管机构或任何第三方披露。",
    },
    introVariables: [
      { id: "var_client", name: "客户名称", value: "", placeholder: "XX股份有限公司", required: true },
      { id: "var_target", name: "标的公司名称", value: "", placeholder: "XX股份有限公司", required: true },
      { id: "var_date", name: "报告日期", value: "", placeholder: "YYYY年MM月DD日", required: true },
      { id: "var_cutoff", name: "截止日期", value: "", placeholder: "YYYY年MM月DD日", required: true },
      { id: "var_firm", name: "律所名称", value: "", placeholder: "XX律师事务所", required: true },
      { id: "var_exchange", name: "拟上市交易所", value: "", placeholder: "上海证券交易所/深圳证券交易所", required: false },
    ],
  },
  // 债券发行
  bond_issuance: {
    introContent: {
      background: "受{客户名称}委托，就其拟发行公司债券/企业债券事宜，本所作为发行人律师对{标的公司名称}（以下简称"发行人"）进行法律尽职调查，并出具本报告。",
      scope: "本次尽职调查涵盖发行人的主体资格、公司治理、信用情况、发行债券的授权与批准、募集资金用途、偿债能力、担保情况、信息披露及其他法律风险等方面。",
      methodology: "调查方法包括审阅发行人提供的相关文件资料、访谈发行人财务及法务人员、进行工商登记及信用记录等公开信息检索。",
      disclaimer: "本报告仅供委托方及相关中介机构内部决策参考使用，最终法律意见以正式出具的《法律意见书》为准。未经本所书面同意，本报告不得向任何第三方披露。",
    },
    introVariables: [
      { id: "var_client", name: "客户名称", value: "", placeholder: "XX集团股份有限公司", required: true },
      { id: "var_target", name: "标的公司名称", value: "", placeholder: "XX集团股份有限公司", required: true },
      { id: "var_date", name: "报告日期", value: "", placeholder: "YYYY年MM月DD日", required: true },
      { id: "var_cutoff", name: "截止日期", value: "", placeholder: "YYYY年MM月DD日", required: true },
      { id: "var_firm", name: "律所名称", value: "", placeholder: "XX律师事务所", required: true },
      { id: "var_bond_type", name: "债券类型", value: "", placeholder: "公司债券/企业债券", required: false },
    ],
  },
  // 融资
  financing: {
    introContent: {
      background: "受{客户名称}委托，就其拟对{标的公司名称}进行股权投资事宜，本所律师对{标的公司名称}（以下简称"目标公司"）进行法律尽职调查，并出具本报告。",
      scope: "本次尽职调查涵盖目标公司的设立沿革、股权结构、公司治理、核心业务、知识产权、重大合同、劳动人事、财务与税务、诉讼仲裁及合规经营等方面。",
      methodology: "调查方法包括审阅目标公司提供的文件资料、访谈目标公司创始人及管理团队、进行工商登记及诉讼仲裁等公开信息检索。",
      disclaimer: "本报告仅供委托方进行本次投资决策参考使用，未经本所书面同意，不得向任何第三方披露或提供。本报告不构成投资建议，委托方应自行评估投资风险。",
    },
    introVariables: [
      { id: "var_client", name: "客户名称", value: "", placeholder: "XX创业投资基金", required: true },
      { id: "var_target", name: "标的公司名称", value: "", placeholder: "XX科技有限公司", required: true },
      { id: "var_date", name: "报告日期", value: "", placeholder: "YYYY年MM月DD日", required: true },
      { id: "var_cutoff", name: "截止日期", value: "", placeholder: "YYYY年MM月DD日", required: true },
      { id: "var_firm", name: "律所名称", value: "", placeholder: "XX律师事务所", required: true },
      { id: "var_round", name: "融资轮次", value: "", placeholder: "A轮/B轮/C轮", required: false },
    ],
  },
  // 其他
  other: {
    introContent: {
      background: "受{客户名称}委托，本所律师对{标的公司名称}进行法律尽职调查，并出具本报告。",
      scope: "本次尽职调查涵盖公司设立沿革、股权结构、主要资产、重大合同、劳动人事、诉讼仲裁与合规经营等内容。",
      methodology: "调查方法包括文件审阅、访谈核实及必要的公开信息检索。",
      disclaimer: "本报告仅供委托方内部决策参考使用，未经书面同意不得对外披露。",
    },
    introVariables: [
      { id: "var_client", name: "客户名称", value: "", placeholder: "XX资本", required: true },
      { id: "var_target", name: "标的公司名称", value: "", placeholder: "XX有限公司", required: true },
      { id: "var_date", name: "报告日期", value: "", placeholder: "YYYY年MM月DD日", required: true },
      { id: "var_cutoff", name: "截止日期", value: "", placeholder: "YYYY年MM月DD日", required: true },
      { id: "var_firm", name: "律所名称", value: "", placeholder: "XX律师事务所", required: true },
    ],
  },
};

export function createDefaultTemplateFingerprint(): TemplateFingerprint {
  return {
    ...DEFAULT_TEMPLATE_FINGERPRINT,
    extractedAt: new Date().toISOString(),
  };
}

// 根据项目类型创建模板指纹
export function createTemplateFingerprintByProjectType(projectType: string): TemplateFingerprint {
  const typeConfig = PROJECT_TYPE_INTRO_CONTENT[projectType] || PROJECT_TYPE_INTRO_CONTENT.other;
  
  return {
    ...DEFAULT_TEMPLATE_FINGERPRINT,
    extractedAt: new Date().toISOString(),
    introContent: typeConfig.introContent,
    introVariables: typeConfig.introVariables,
  };
}
