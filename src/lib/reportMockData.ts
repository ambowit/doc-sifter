/**
 * DD Report Generation System - Mock Data
 * 三层JSON数据模型的完整Mock数据
 */

import type {
  TemplateFingerprint,
  KnowledgeGraph,
  ReportPlan,
  Entity,
  Fact,
  Document,
  SectionPlan,
  ContentBlock,
} from "./reportTypes";

// =============================================================================
// LAYER 1: TEMPLATE FINGERPRINT MOCK DATA
// =============================================================================

export const mockTemplateFingerprint: TemplateFingerprint = {
  templateId: "tpl_2026_01",
  name: "标准投资尽调报告模板",
  version: "v2.0",
  locale: "zh-CN",
  extractedAt: "2026-01-22T10:30:00Z",
  status: "locked",

  numbering: {
    scheme: "1|1.1|1.1.1",
    headingLevels: 3,
    prefixRules: {
      h1: "",
      h2: "",
      h3: "",
    },
  },

  page: {
    size: "A4",
    orientation: "portrait",
    margin: {
      top: 2.5,
      bottom: 2.5,
      left: 2.8,
      right: 2.8,
      unit: "cm",
    },
    headerFooter: {
      hasHeader: true,
      hasFooter: true,
      footerHasPageNumber: true,
      pageNumberStyle: "center",
      headerLogo: {
        enabled: true,
        position: "right",
        maxHeightCm: 1.2,
      },
    },
  },

  styles: {
    h1: {
      font: "宋体",
      sizePt: 16,
      bold: true,
      spaceBeforePt: 12,
      spaceAfterPt: 6,
      lineSpacing: 1.2,
      color: "#000000",
    },
    h2: {
      font: "宋体",
      sizePt: 14,
      bold: true,
      spaceBeforePt: 10,
      spaceAfterPt: 6,
      lineSpacing: 1.2,
      color: "#000000",
    },
    h3: {
      font: "宋体",
      sizePt: 12,
      bold: true,
      spaceBeforePt: 8,
      spaceAfterPt: 4,
      lineSpacing: 1.2,
      color: "#333333",
    },
    body: {
      font: "宋体",
      sizePt: 11,
      bold: false,
      spaceBeforePt: 0,
      spaceAfterPt: 6,
      lineSpacing: 1.5,
      firstLineIndentCm: 0.74,
      align: "justify",
    },
    quote: {
      font: "宋体",
      sizePt: 10.5,
      bold: false,
      spaceBeforePt: 4,
      spaceAfterPt: 4,
      lineSpacing: 1.3,
      indentLeftCm: 0.74,
      borderLeft: true,
    },
    caption: {
      font: "宋体",
      sizePt: 10.5,
      bold: false,
      spaceBeforePt: 4,
      spaceAfterPt: 8,
      lineSpacing: 1.2,
      align: "center",
    },
    footnote: {
      font: "宋体",
      sizePt: 9,
    },
  },

  lists: {
    bullet: {
      glyph: "•",
      indentLeftCm: 0.74,
      hangingCm: 0.32,
    },
    ordered: {
      format: "1.",
      indentLeftCm: 0.74,
      hangingCm: 0.32,
    },
  },

  tables: {
    default: {
      border: "single",
      borderSizePt: 0.5,
      headerFill: "#F2F2F2",
      cellPaddingPt: 4,
      headerBold: true,
      align: "center",
      font: "宋体",
      sizePt: 10.5,
      borderColor: "#000000",
    },
    threeLines: {
      border: "threeLines",
      borderSizePt: 1,
      headerFill: "transparent",
      cellPaddingPt: 4,
      headerBold: true,
      align: "center",
      font: "宋体",
      sizePt: 10.5,
      borderColor: "#000000",
    },
  },

  figures: {
    captionFormat: "图{n}：{title}",
    captionStyle: "caption",
    placeCaption: "below",
    maxWidthPercent: 100,
  },

  toc: [
    {
      id: "sec_intro",
      level: 1,
      number: "",
      title: "引言",
      policy: "copy_from_template",
      isFixed: true,
      children: [
        { id: "sec_intro_1", level: 2, number: "", title: "项目背景", policy: "copy_from_template", isFixed: true },
        { id: "sec_intro_2", level: 2, number: "", title: "工作范围", policy: "copy_from_template", isFixed: true },
        { id: "sec_intro_3", level: 2, number: "", title: "尽调方法", policy: "copy_from_template", isFixed: true },
        { id: "sec_intro_4", level: 2, number: "", title: "免责声明", policy: "copy_from_template", isFixed: true },
      ],
    },
    {
      id: "sec_def",
      level: 1,
      number: "",
      title: "定义与简称",
      policy: "generate",
    },
    {
      id: "sec_1",
      level: 1,
      number: "1",
      title: "公司基本情况",
      policy: "generate",
      children: [
        { id: "sec_1_1", level: 2, number: "1.1", title: "公司设立及历史沿革", policy: "generate" },
        { id: "sec_1_2", level: 2, number: "1.2", title: "股权结构", policy: "generate" },
        { id: "sec_1_3", level: 2, number: "1.3", title: "公司治理", policy: "generate" },
        { id: "sec_1_4", level: 2, number: "1.4", title: "分支机构", policy: "generate" },
      ],
    },
    {
      id: "sec_2",
      level: 1,
      number: "2",
      title: "业务经营",
      policy: "generate",
      children: [
        { id: "sec_2_1", level: 2, number: "2.1", title: "主要业务", policy: "generate" },
        { id: "sec_2_2", level: 2, number: "2.2", title: "主要客户", policy: "generate" },
        { id: "sec_2_3", level: 2, number: "2.3", title: "主要供应商", policy: "generate" },
      ],
    },
    {
      id: "sec_3",
      level: 1,
      number: "3",
      title: "财务状况",
      policy: "generate",
      children: [
        { id: "sec_3_1", level: 2, number: "3.1", title: "历年财务概况", policy: "generate" },
        { id: "sec_3_2", level: 2, number: "3.2", title: "审计报告分析", policy: "generate" },
        { id: "sec_3_3", level: 2, number: "3.3", title: "税务合规", policy: "generate" },
      ],
    },
    {
      id: "sec_4",
      level: 1,
      number: "4",
      title: "知识产权",
      policy: "generate",
      children: [
        { id: "sec_4_1", level: 2, number: "4.1", title: "专利", policy: "generate" },
        { id: "sec_4_2", level: 2, number: "4.2", title: "商标", policy: "generate" },
        { id: "sec_4_3", level: 2, number: "4.3", title: "软件著作权", policy: "generate" },
        { id: "sec_4_4", level: 2, number: "4.4", title: "技术许可", policy: "generate" },
      ],
    },
    {
      id: "sec_5",
      level: 1,
      number: "5",
      title: "重大合同",
      policy: "generate",
      children: [
        { id: "sec_5_1", level: 2, number: "5.1", title: "采购合同", policy: "generate" },
        { id: "sec_5_2", level: 2, number: "5.2", title: "销售合同", policy: "generate" },
        { id: "sec_5_3", level: 2, number: "5.3", title: "关联交易", policy: "generate" },
      ],
    },
    {
      id: "sec_6",
      level: 1,
      number: "6",
      title: "人力资源",
      policy: "generate",
      children: [
        { id: "sec_6_1", level: 2, number: "6.1", title: "员工概况", policy: "generate" },
        { id: "sec_6_2", level: 2, number: "6.2", title: "劳动合规", policy: "generate" },
        { id: "sec_6_3", level: 2, number: "6.3", title: "核心团队", policy: "generate" },
      ],
    },
    {
      id: "sec_7",
      level: 1,
      number: "7",
      title: "诉讼与争议",
      policy: "generate",
      children: [
        { id: "sec_7_1", level: 2, number: "7.1", title: "进行中诉讼", policy: "generate" },
        { id: "sec_7_2", level: 2, number: "7.2", title: "潜在风险", policy: "generate" },
      ],
    },
    {
      id: "sec_appendix",
      level: 1,
      number: "",
      title: "附录",
      policy: "generate",
      isFixed: true,
      children: [
        { id: "sec_appendix_1", level: 2, number: "", title: "证据索引", policy: "generate", isFixed: true },
        { id: "sec_appendix_2", level: 2, number: "", title: "文件清单", policy: "generate", isFixed: true },
      ],
    },
  ],

  sectionBlueprints: {
    sec_def: {
      blocks: [{ type: "definitions_table", dataRef: "generated:definitions", styleRef: "tables.default" }],
      format: "same_as_template",
    },
    sec_1_2: {
      blocks: [
        { type: "figure", figureKind: "equity_chart", dataRef: "generated:equity_graph", caption: "股权结构图", styleRef: "figures" },
        { type: "paragraph", style: "body", text: "", evidenceRefs: [] },
      ],
      format: "same_as_template",
    },
  },

  introVariables: [
    { id: "var_target", name: "标的公司名称", value: "", placeholder: "XX有限公司", required: true },
    { id: "var_client", name: "委托方名称", value: "", placeholder: "XX资本", required: true },
    { id: "var_date", name: "报告日期", value: "", placeholder: "2026年1月22日", required: true },
    { id: "var_cutoff", name: "截止日期", value: "", placeholder: "2025年12月31日", required: true },
    { id: "var_firm", name: "律所名称", value: "", placeholder: "XX律师事务所", required: true },
  ],

  introContent: {
    background: `根据{委托方名称}（以下简称"委托方"）的委托，{律所名称}（以下简称"本所"）对{标的公司名称}（以下简称"目标公司"或"标的公司"）进行法律尽职调查。`,
    scope: `本次尽职调查的范围包括但不限于：目标公司的设立与存续、股权结构、公司治理、主要资产、知识产权、重大合同、人力资源、税务、环保、诉讼及其他或有负债等方面。`,
    methodology: `本次尽职调查采用的方法包括：审阅目标公司提供的文件资料、访谈管理层、查询公开信息、现场核查等。本报告基于截至{截止日期}目标公司提供的资料编写。`,
    disclaimer: `本报告仅供委托方内部决策使用，未经本所书面同意，不得向第三方披露或用于其他目的。本报告的结论基于目标公司提供的资料，本所不对资料的真实性、完整性承担责任。`,
  },
};

// =============================================================================
// LAYER 2: KNOWLEDGE GRAPH MOCK DATA
// =============================================================================

const mockEntities: Entity[] = [
  {
    eid: "E001",
    type: "company",
    name: "星辰科技有限公司",
    aliases: ["目标公司", "星辰科技"],
    refs: [
      { docId: "d01", loc: "p1" },
      { docId: "d02", loc: "p1" },
    ],
    metadata: {
      uscc: "91110108MA01XXXXXX",
      establishedDate: "2018-03-15",
      registeredCapital: 50000000,
    },
  },
  {
    eid: "E002",
    type: "shareholder",
    name: "张明",
    aliases: ["大股东", "实控人"],
    refs: [{ docId: "d03", loc: "p1" }],
    metadata: { shareholdingPercent: 35 },
  },
  {
    eid: "E003",
    type: "shareholder",
    name: "李华",
    aliases: ["二股东"],
    refs: [{ docId: "d03", loc: "p1" }],
    metadata: { shareholdingPercent: 25 },
  },
  {
    eid: "E004",
    type: "company",
    name: "深圳创新投资有限合伙企业",
    aliases: ["投资方", "深圳创投"],
    refs: [{ docId: "d03", loc: "p2" }],
    metadata: { shareholdingPercent: 20 },
  },
  {
    eid: "E005",
    type: "company",
    name: "杭州星辰管理咨询合伙企业（有限合伙）",
    aliases: ["员工持股平台"],
    refs: [{ docId: "d03", loc: "p2" }],
    metadata: { shareholdingPercent: 20 },
  },
  {
    eid: "E006",
    type: "company",
    name: "星辰科技（上海）有限公司",
    aliases: ["上海子公司"],
    refs: [{ docId: "d01", loc: "附件" }],
    metadata: { shareholdingPercent: 100, parent: "E001" },
  },
  {
    eid: "E007",
    type: "company",
    name: "星辰数据科技（北京）有限公司",
    aliases: ["北京子公司"],
    refs: [{ docId: "d01", loc: "附件" }],
    metadata: { shareholdingPercent: 100, parent: "E001" },
  },
  {
    eid: "E008",
    type: "institution",
    name: "华创资本管理有限公司",
    aliases: ["委托方", "华创资本"],
    refs: [{ docId: "external", loc: "委托书p1" }],
  },
  {
    eid: "E009",
    type: "institution",
    name: "北京金杜律师事务所",
    aliases: ["本所", "金杜"],
    refs: [{ docId: "external", loc: "委托书p1" }],
  },
  {
    eid: "E010",
    type: "institution",
    name: "清华大学",
    aliases: ["核心技术授权方"],
    refs: [{ docId: "d05", loc: "p1" }],
  },
];

const mockFacts: Fact[] = [
  {
    fid: "F001",
    type: "equity_holding",
    subject: "E002",
    object: "E001",
    value: { percent: 35, shares: 17500000 },
    time: { asOf: "2025-12-31" },
    evidence: [{ docId: "d03", loc: "p1-table1", quote: "张明持有目标公司35%股权，共计1750万股" }],
    confidence: 0.98,
    conflicts: [],
    sectionHint: "sec_1_2",
  },
  {
    fid: "F002",
    type: "equity_holding",
    subject: "E003",
    object: "E001",
    value: { percent: 25, shares: 12500000 },
    time: { asOf: "2025-12-31" },
    evidence: [{ docId: "d03", loc: "p1-table1", quote: "李华持有目标公司25%股权" }],
    confidence: 0.98,
    conflicts: [],
    sectionHint: "sec_1_2",
  },
  {
    fid: "F003",
    type: "equity_holding",
    subject: "E004",
    object: "E001",
    value: { percent: 20, shares: 10000000 },
    time: { asOf: "2025-12-31" },
    evidence: [{ docId: "d03", loc: "p2", quote: "深圳创新投资持有目标公司20%股权，为A轮投资人" }],
    confidence: 0.95,
    conflicts: [],
    sectionHint: "sec_1_2",
  },
  {
    fid: "F004",
    type: "equity_holding",
    subject: "E005",
    object: "E001",
    value: { percent: 20, shares: 10000000 },
    time: { asOf: "2025-12-31" },
    evidence: [{ docId: "d03", loc: "p2", quote: "员工持股平台持有目标公司20%股权" }],
    confidence: 0.95,
    conflicts: [],
    sectionHint: "sec_1_2",
  },
  {
    fid: "F005",
    type: "establishment",
    subject: "E001",
    value: {
      establishedDate: "2018-03-15",
      registeredCapital: 50000000,
      paidInCapital: 50000000,
      uscc: "91110108MA01XXXXXX",
    },
    time: { asOf: "2025-12-31" },
    evidence: [
      { docId: "d01", loc: "p1", quote: "成立日期：2018年3月15日，注册资本：人民币5000万元" },
    ],
    confidence: 0.99,
    conflicts: [],
    sectionHint: "sec_1_1",
  },
  {
    fid: "F006",
    type: "ip_patent",
    subject: "E001",
    value: {
      inventionPatents: 3,
      utilityPatents: 8,
      designPatents: 2,
      totalPatents: 13,
    },
    time: { asOf: "2025-12-31" },
    evidence: [
      { docId: "d06", loc: "p1-26", quote: "共含发明专利3���、实用新型专利8项、外观设计专利2项，均在有效期内" },
    ],
    confidence: 0.99,
    conflicts: [],
    sectionHint: "sec_4_1",
  },
  {
    fid: "F007",
    type: "financial",
    subject: "E001",
    value: {
      year: 2024,
      revenue: 320000000,
      netProfit: 45000000,
      totalAssets: 580000000,
      auditOpinion: "无保留意见",
    },
    time: { asOf: "2024-12-31" },
    evidence: [
      { docId: "d08", loc: "p3-5", quote: "营业收入3.2亿元，净利润4500万元，资产总额5.8亿元" },
    ],
    confidence: 0.94,
    conflicts: [],
    sectionHint: "sec_3_1",
  },
  {
    fid: "F008",
    type: "financial",
    subject: "E001",
    value: {
      year: 2023,
      revenue: 250000000,
      netProfit: 32000000,
      totalAssets: 450000000,
      auditOpinion: "无保留意见",
      yoyGrowth: 0.28,
    },
    time: { asOf: "2023-12-31" },
    evidence: [
      { docId: "d09", loc: "p3-5", quote: "营业收入2.5亿元，净利润3200万元，同比增长28%" },
    ],
    confidence: 0.94,
    conflicts: [],
    sectionHint: "sec_3_1",
  },
  {
    fid: "F009",
    type: "litigation",
    subject: "E001",
    value: {
      pendingCases: 2,
      role: "原告",
      totalAmount: 1200000,
      riskLevel: "low",
    },
    time: { asOf: "2025-12-31" },
    evidence: [
      { docId: "d14", loc: "p1-3", quote: "待完结案件2件，均为原告，涉及金额合计120万元" },
    ],
    confidence: 0.93,
    conflicts: [],
    sectionHint: "sec_7_1",
  },
  {
    fid: "F010",
    type: "contract_material",
    subject: "E001",
    value: {
      contractType: "供应商框架协议",
      counterparties: 5,
      annualAmount: 120000000,
      validUntil: "2026-12-31",
    },
    time: { asOf: "2025-12-31" },
    evidence: [
      { docId: "d10", loc: "多文件", quote: "含前五大供应商框架协议，年采购额约1.2亿元" },
    ],
    confidence: 0.85,
    conflicts: [],
    sectionHint: "sec_5_1",
  },
  {
    fid: "F011",
    type: "risk_flag",
    subject: "E001",
    value: {
      riskType: "tax_compliance",
      description: "未能获取近三年完整的纳税申报记录",
      severity: "medium",
    },
    evidence: [],
    confidence: 0.8,
    conflicts: [],
    sectionHint: "sec_3_3",
  },
  {
    fid: "F012",
    type: "risk_flag",
    subject: "E001",
    value: {
      riskType: "related_party",
      description: "无法确认是否存在未披露的关联交易",
      severity: "medium",
    },
    evidence: [],
    confidence: 0.8,
    conflicts: [],
    sectionHint: "sec_5_3",
  },
];

const mockDocuments: Document[] = [
  { docId: "d01", path: "公司治理/营业执照_2025.pdf", filename: "营业执照_2025.pdf", docType: "business_license", parsed: true, pageCount: 1, entityCount: 1, factCount: 1 },
  { docId: "d02", path: "公司治理/公司章程_修订版.docx", filename: "公司章程_修订版.docx", docType: "charter", parsed: true, pageCount: 28, entityCount: 3, factCount: 5 },
  { docId: "d03", path: "公司治理/股东会决议_2025年度.pdf", filename: "股东会决议_2025年度.pdf", docType: "shareholders_resolution", parsed: true, pageCount: 5, entityCount: 5, factCount: 4 },
  { docId: "d04", path: "公司治理/董事会决议汇编.pdf", filename: "董事会决议汇编.pdf", docType: "board_resolution", parsed: true, pageCount: 48, entityCount: 8, factCount: 12 },
  { docId: "d05", path: "知识产权/核心技术授权协议.pdf", filename: "核心技术授权协议.pdf", docType: "contract", parsed: true, pageCount: 12, entityCount: 2, factCount: 3 },
  { docId: "d06", path: "知识产权/专利证书汇总.pdf", filename: "专利证书汇总.pdf", docType: "patent_cert", parsed: true, pageCount: 26, entityCount: 1, factCount: 13 },
  { docId: "d07", path: "知识产权/软件著作权登记证书.pdf", filename: "软件著作权登记证书.pdf", docType: "software_cert", parsed: true, pageCount: 8, entityCount: 1, factCount: 5 },
  { docId: "d08", path: "财务/2024年度审计报告.pdf", filename: "2024年度审计报告.pdf", docType: "audit_report", parsed: true, pageCount: 45, entityCount: 2, factCount: 8 },
  { docId: "d09", path: "财务/2023年度审计报告.pdf", filename: "2023年度审计报告.pdf", docType: "audit_report", parsed: true, pageCount: 42, entityCount: 2, factCount: 8 },
  { docId: "d10", path: "合同/主要供应商合同.zip", filename: "主要供应商合同.zip", docType: "contract", parsed: true, pageCount: 85, entityCount: 6, factCount: 5 },
  { docId: "d11", path: "合同/客户框架协议.pdf", filename: "客户框架协议.pdf", docType: "contract", parsed: true, pageCount: 18, entityCount: 2, factCount: 3 },
  { docId: "d12", path: "人事/劳动合同模板及补充协议.docx", filename: "劳动合同模板及补充协议.docx", docType: "hr_doc", parsed: true, pageCount: 12, entityCount: 1, factCount: 2 },
  { docId: "d13", path: "人事/核心员工名册.xlsx", filename: "核心员工名册.xlsx", docType: "hr_doc", parsed: true, pageCount: 3, entityCount: 32, factCount: 2 },
  { docId: "d14", path: "诉讼/诉讼案件清单.pdf", filename: "诉讼案件清单.pdf", docType: "litigation_doc", parsed: true, pageCount: 8, entityCount: 4, factCount: 2 },
  { docId: "d15", path: "知识产权/商标注册证.pdf", filename: "商标注册证.pdf", docType: "trademark_cert", parsed: true, pageCount: 3, entityCount: 1, factCount: 2 },
];

export const mockKnowledgeGraph: KnowledgeGraph = {
  kgId: "kg_001",
  projectId: "PRJ-2026-001",
  createdAt: "2026-01-22T08:00:00Z",
  updatedAt: "2026-01-22T14:30:00Z",

  entities: mockEntities,
  facts: mockFacts,
  documents: mockDocuments,

  coverage: {
    bySectionHint: {
      sec_1_1: { facts: ["F005"], docs: ["d01", "d02"], coverageScore: 0.95 },
      sec_1_2: { facts: ["F001", "F002", "F003", "F004"], docs: ["d03"], coverageScore: 0.98 },
      sec_3_1: { facts: ["F007", "F008"], docs: ["d08", "d09"], coverageScore: 0.92 },
      sec_3_3: { facts: ["F011"], docs: [], coverageScore: 0.3, missingItems: ["税务登记证", "近三年增值税申报表", "近三年企业所得税申报表"] },
      sec_4_1: { facts: ["F006"], docs: ["d06"], coverageScore: 0.95 },
      sec_5_1: { facts: ["F010"], docs: ["d10"], coverageScore: 0.85 },
      sec_5_3: { facts: ["F012"], docs: [], coverageScore: 0.2, missingItems: ["关联方清单", "关联交易明细", "关联交易定价政策"] },
      sec_7_1: { facts: ["F009"], docs: ["d14"], coverageScore: 0.9 },
    },
    overallScore: 0.78,
  },

  conflictSummary: {
    total: 0,
    byType: {},
  },
};

// =============================================================================
// LAYER 3: REPORT PLAN MOCK DATA
// =============================================================================

const createContentBlocks = (): ContentBlock[] => {
  return [
    {
      blockId: "blk_001",
      type: "paragraph",
      style: "body",
      text: "根据我们审阅的工商登记资料，目标公司成立于2018年3月15日，注册资本人民币5,000万元，已全额实缴。公司统一社会信用代码为91110108MA01XXXXXX。",
      evidenceRefs: [{ fid: "F005", docId: "d01", loc: "p1" }],
    },
    {
      blockId: "blk_002",
      type: "paragraph",
      style: "body",
      text: "目标公司的经营范围包括：技术开发、技术咨询、技术服务、技术转让；软件开发；数据处理；计算机系统服务。公司经营范围合法合规，未见超范围经营情形。",
      evidenceRefs: [{ fid: "F005", docId: "d02", loc: "p2-3" }],
    },
  ];
};

const createEquityBlocks = (): ContentBlock[] => {
  return [
    {
      blockId: "blk_equity_chart",
      type: "figure",
      figureKind: "equity_chart",
      dataRef: "generated:equity_graph",
      caption: "股权结构图",
      styleRef: "figures",
    },
    {
      blockId: "blk_equity_text",
      type: "paragraph",
      style: "body",
      text: "根据我们审阅的股东会决议及公司章程，截至2025年12月31日，目标公司的股权结构如下：张明持股35%，为公司实际控制人；李华持股25%；深圳创新投资有限合伙企业持股20%，为A轮投资人；员工持股平台持股20%。以上股权均无质押、冻结情况。",
      evidenceRefs: [
        { fid: "F001", docId: "d03", loc: "p1" },
        { fid: "F002", docId: "d03", loc: "p1" },
        { fid: "F003", docId: "d03", loc: "p2" },
        { fid: "F004", docId: "d03", loc: "p2" },
      ],
    },
    {
      blockId: "blk_equity_table",
      type: "table",
      styleRef: "tables.default",
      dataRef: "generated:equity_table",
      columns: [
        { key: "shareholder", label: "股东名称", width: 35 },
        { key: "shares", label: "持股数量（万股）", width: 20 },
        { key: "percent", label: "持股比例", width: 15 },
        { key: "nature", label: "股东性质", width: 15 },
        { key: "notes", label: "备注", width: 15 },
      ],
      data: [
        { shareholder: "张明", shares: 1750, percent: "35%", nature: "自然人", notes: "实控人" },
        { shareholder: "李华", shares: 1250, percent: "25%", nature: "自然人", notes: "-" },
        { shareholder: "深圳创新投资有限合伙企业", shares: 1000, percent: "20%", nature: "企业法人", notes: "A轮投资人" },
        { shareholder: "杭州星辰管理咨询合伙企业（有限合伙）", shares: 1000, percent: "20%", nature: "有限合伙", notes: "员工持股" },
      ],
      caption: "表1：股权结构明细",
    },
  ];
};

const createTaxBlocks = (): ContentBlock[] => {
  return [
    {
      blockId: "blk_tax_missing",
      type: "missing_notice",
      style: "body",
      text: "我们未能获取目标公司近三年完整的纳税申报记录，无法对其税务合规情况进行全面核查。",
      missingItems: ["税务登记证", "近三年增值税申报表", "近三年企业所得税申报表", "税务稽查结论（如有）"],
    },
    {
      blockId: "blk_tax_note",
      type: "paragraph",
      style: "body",
      text: "建议委托方在交割前要求目标公司补充提供上述税务资料，或考虑在交易文件中设置相应的陈述保证及赔偿条款。",
    },
  ];
};

const createRelatedPartyBlocks = (): ContentBlock[] => {
  return [
    {
      blockId: "blk_rp_missing",
      type: "missing_notice",
      style: "body",
      text: "目标公司未提供关联方清单及关联交易明细，我们无法对其关联交易情况进行核查。",
      missingItems: ["关联方清单", "关联交易明细", "关联交易定价政策", "关联交易审批记录"],
    },
    {
      blockId: "blk_rp_issues",
      type: "issues_table",
      styleRef: "tables.default",
      issues: [
        {
          fact: "未提供关联交易相关资料",
          risk: "可能存在未披露的关联交易，影响财务数据真实性",
          suggestion: "要求补充关联方清单及交易明细",
          severity: "medium",
        },
      ],
    },
  ];
};

const mockSections: SectionPlan[] = [
  {
    secId: "sec_1",
    number: "1",
    title: "公司基本情况",
    level: 1,
    policy: "generate",
    contentBlocks: [],
    evidence: ["d01", "d02", "d03", "d04"],
    coverageScore: 0.95,
    children: [
      {
        secId: "sec_1_1",
        number: "1.1",
        title: "公司设立及历史沿革",
        level: 2,
        policy: "generate",
        contentBlocks: createContentBlocks(),
        evidence: ["d01", "d02"],
        coverageScore: 0.95,
      },
      {
        secId: "sec_1_2",
        number: "1.2",
        title: "股权结构",
        level: 2,
        policy: "generate",
        contentBlocks: createEquityBlocks(),
        evidence: ["d03"],
        coverageScore: 0.98,
      },
    ],
  },
  {
    secId: "sec_3",
    number: "3",
    title: "财务状况",
    level: 1,
    policy: "generate",
    contentBlocks: [],
    evidence: ["d08", "d09"],
    coverageScore: 0.7,
    children: [
      {
        secId: "sec_3_3",
        number: "3.3",
        title: "税务合规",
        level: 2,
        policy: "generate",
        contentBlocks: createTaxBlocks(),
        evidence: [],
        coverageScore: 0.3,
      },
    ],
  },
  {
    secId: "sec_5",
    number: "5",
    title: "重大合同",
    level: 1,
    policy: "generate",
    contentBlocks: [],
    evidence: ["d10", "d11"],
    coverageScore: 0.6,
    children: [
      {
        secId: "sec_5_3",
        number: "5.3",
        title: "关联交易",
        level: 2,
        policy: "generate",
        contentBlocks: createRelatedPartyBlocks(),
        evidence: [],
        coverageScore: 0.2,
      },
    ],
  },
];

export const mockReportPlan: ReportPlan = {
  reportId: "rep_001",
  projectId: "PRJ-2026-001",
  templateId: "tpl_2026_01",
  kgId: "kg_001",

  createdAt: "2026-01-22T15:00:00Z",
  updatedAt: "2026-01-22T16:30:00Z",
  status: "draft",

  variables: {
    target_company: "星辰科技有限公司",
    client: "华创资本管理有限公司",
    report_date: "2026年1月22日",
    cutoff_date: "2025年12月31日",
    law_firm: "北京金杜律师事务所",
  },

  sections: mockSections,

  appendix: {
    includeEvidenceIndex: true,
    includeDefinitions: true,
    includeFileList: true,
  },

  metadata: {
    targetCompany: "星辰科技有限公司",
    client: "华创资本管理有限公司",
    reportDate: "2026年1月22日",
    cutoffDate: "2025年12月31日",
    lawFirm: "北京金杜律师事务所",
  },

  statistics: {
    totalSections: 7,
    totalDocuments: 15,
    totalFacts: 12,
    totalIssues: 3,
    highRiskIssues: 0,
    averageCoverage: 0.78,
  },
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/** 根据章节ID获取覆盖率 */
export function getSectionCoverage(sectionId: string): number {
  const coverage = mockKnowledgeGraph.coverage.bySectionHint[sectionId];
  return coverage?.coverageScore || 0;
}

/** 根据章节ID获取缺失项 */
export function getSectionMissingItems(sectionId: string): string[] {
  const coverage = mockKnowledgeGraph.coverage.bySectionHint[sectionId];
  return coverage?.missingItems || [];
}

/** 根据事实ID获取事实 */
export function getFactById(factId: string): Fact | undefined {
  return mockKnowledgeGraph.facts.find(f => f.fid === factId);
}

/** 根据实体ID获取实体 */
export function getEntityById(entityId: string): Entity | undefined {
  return mockKnowledgeGraph.entities.find(e => e.eid === entityId);
}

/** 根据文档ID获取文档 */
export function getDocumentById(docId: string): Document | undefined {
  return mockKnowledgeGraph.documents.find(d => d.docId === docId);
}

/** 获取股权结构数据 (从KG提取) */
export function getEquityStructureFromKG() {
  const equityFacts = mockKnowledgeGraph.facts.filter(f => f.type === "equity_holding");
  const targetCompany = mockKnowledgeGraph.entities.find(e => e.eid === "E001");
  
  return {
    companyName: targetCompany?.name || "目标公司",
    shareholders: equityFacts.map(f => {
      const entity = getEntityById(f.subject);
      return {
        id: f.subject,
        name: entity?.name || "未知",
        percentage: (f.value as { percent: number }).percent,
        type: entity?.type === "individual" || entity?.type === "shareholder" ? "individual" as const : "company" as const,
        notes: entity?.aliases?.[0],
      };
    }),
    subsidiaries: mockKnowledgeGraph.entities
      .filter(e => (e.metadata as { parent?: string })?.parent === "E001")
      .map(e => ({
        id: e.eid,
        name: e.name,
        percentage: (e.metadata as { shareholdingPercent?: number })?.shareholdingPercent || 100,
        type: "subsidiary" as const,
        notes: e.aliases?.[0],
      })),
    notes: [
      "以上股权结构信息来源于公司章程及股东会决���",
      "员工持股平台为有限合伙企业，实际控制人为张明",
      "截至2025年12月31日，股权无质押、冻结情况",
    ],
  };
}

/** 获取定义列表 (从KG提取) */
export function getDefinitionsFromKG() {
  return mockKnowledgeGraph.entities.map(e => ({
    id: e.eid,
    shortName: e.aliases?.[0] || e.name,
    fullName: e.name,
    type: e.type,
    sourceFiles: e.refs.map(r => ({
      id: r.docId,
      name: getDocumentById(r.docId)?.filename || r.docId,
      pageRef: r.loc,
    })),
  }));
}

// =============================================================================
// TEMPLATE STYLES (多模板样式支持)
// =============================================================================

/** 模板样式类型 */
export interface TemplateStyle {
  id: string;
  name: string;
  description: string;
  preview: {
    primaryColor: string;
    accentColor: string;
    fontFamily: string;
    headerStyle: "classic" | "modern" | "minimal";
  };
  styles: typeof mockTemplateFingerprint.styles;
  tables: typeof mockTemplateFingerprint.tables;
  page: typeof mockTemplateFingerprint.page;
}

/** 预设模板样式列表 */
export const templateStyles: TemplateStyle[] = [
  {
    id: "classic-songti",
    name: "经典宋体",
    description: "传统法律文书风格，使用宋体字体，正式规范",
    preview: {
      primaryColor: "#000000",
      accentColor: "#333333",
      fontFamily: "宋体",
      headerStyle: "classic",
    },
    styles: mockTemplateFingerprint.styles,
    tables: mockTemplateFingerprint.tables,
    page: mockTemplateFingerprint.page,
  },
  {
    id: "modern-heiti",
    name: "现代黑体",
    description: "现代商务风格，使用黑体字体，简洁大方",
    preview: {
      primaryColor: "#1a1a2e",
      accentColor: "#16213e",
      fontFamily: "黑体",
      headerStyle: "modern",
    },
    styles: {
      h1: {
        font: "黑体",
        sizePt: 18,
        bold: true,
        spaceBeforePt: 16,
        spaceAfterPt: 8,
        lineSpacing: 1.3,
        color: "#1a1a2e",
      },
      h2: {
        font: "黑体",
        sizePt: 14,
        bold: true,
        spaceBeforePt: 12,
        spaceAfterPt: 6,
        lineSpacing: 1.3,
        color: "#1a1a2e",
      },
      h3: {
        font: "黑体",
        sizePt: 12,
        bold: true,
        spaceBeforePt: 10,
        spaceAfterPt: 4,
        lineSpacing: 1.3,
        color: "#333333",
      },
      body: {
        font: "仿宋",
        sizePt: 11,
        bold: false,
        spaceBeforePt: 0,
        spaceAfterPt: 8,
        lineSpacing: 1.6,
        firstLineIndentCm: 0.85,
        align: "justify",
      },
      quote: {
        font: "仿宋",
        sizePt: 10.5,
        bold: false,
        spaceBeforePt: 6,
        spaceAfterPt: 6,
        lineSpacing: 1.4,
        indentLeftCm: 1,
        borderLeft: true,
      },
      caption: {
        font: "黑体",
        sizePt: 10,
        bold: false,
        spaceBeforePt: 4,
        spaceAfterPt: 8,
        lineSpacing: 1.2,
        align: "center",
      },
      footnote: {
        font: "仿宋",
        sizePt: 8,
      },
    },
    tables: {
      default: {
        border: "single",
        borderSizePt: 0.75,
        headerFill: "#e8e8e8",
        cellPaddingPt: 5,
        headerBold: true,
        align: "center",
        font: "仿宋",
        sizePt: 10,
        borderColor: "#333333",
      },
      threeLines: {
        border: "threeLines",
        borderSizePt: 1.5,
        headerFill: "transparent",
        cellPaddingPt: 5,
        headerBold: true,
        align: "center",
        font: "仿宋",
        sizePt: 10,
        borderColor: "#1a1a2e",
      },
    },
    page: {
      ...mockTemplateFingerprint.page,
      margin: {
        top: 2.54,
        bottom: 2.54,
        left: 3.17,
        right: 3.17,
        unit: "cm",
      },
    },
  },
  {
    id: "elegant-kaiti",
    name: "优雅楷体",
    description: "文雅书卷风格，使用楷体字体，适合高端客户",
    preview: {
      primaryColor: "#2c3e50",
      accentColor: "#34495e",
      fontFamily: "楷体",
      headerStyle: "classic",
    },
    styles: {
      h1: {
        font: "楷体",
        sizePt: 18,
        bold: true,
        spaceBeforePt: 14,
        spaceAfterPt: 8,
        lineSpacing: 1.4,
        color: "#2c3e50",
      },
      h2: {
        font: "楷体",
        sizePt: 15,
        bold: true,
        spaceBeforePt: 12,
        spaceAfterPt: 6,
        lineSpacing: 1.4,
        color: "#2c3e50",
      },
      h3: {
        font: "楷体",
        sizePt: 12,
        bold: true,
        spaceBeforePt: 10,
        spaceAfterPt: 4,
        lineSpacing: 1.4,
        color: "#34495e",
      },
      body: {
        font: "楷体",
        sizePt: 11.5,
        bold: false,
        spaceBeforePt: 0,
        spaceAfterPt: 6,
        lineSpacing: 1.7,
        firstLineIndentCm: 0.74,
        align: "justify",
      },
      quote: {
        font: "楷体",
        sizePt: 10.5,
        bold: false,
        spaceBeforePt: 4,
        spaceAfterPt: 4,
        lineSpacing: 1.5,
        indentLeftCm: 0.8,
        borderLeft: true,
      },
      caption: {
        font: "楷体",
        sizePt: 10,
        bold: false,
        spaceBeforePt: 4,
        spaceAfterPt: 8,
        lineSpacing: 1.3,
        align: "center",
      },
      footnote: {
        font: "楷体",
        sizePt: 9,
      },
    },
    tables: {
      default: {
        border: "single",
        borderSizePt: 0.5,
        headerFill: "#ecf0f1",
        cellPaddingPt: 5,
        headerBold: true,
        align: "center",
        font: "楷体",
        sizePt: 10,
        borderColor: "#2c3e50",
      },
      threeLines: {
        border: "threeLines",
        borderSizePt: 1,
        headerFill: "transparent",
        cellPaddingPt: 5,
        headerBold: true,
        align: "center",
        font: "楷体",
        sizePt: 10,
        borderColor: "#2c3e50",
      },
    },
    page: mockTemplateFingerprint.page,
  },
  {
    id: "minimal-clean",
    name: "简约清新",
    description: "极简设计风格，留白充足，阅读舒适",
    preview: {
      primaryColor: "#2d3436",
      accentColor: "#636e72",
      fontFamily: "微软雅黑",
      headerStyle: "minimal",
    },
    styles: {
      h1: {
        font: "微软雅黑",
        sizePt: 16,
        bold: true,
        spaceBeforePt: 18,
        spaceAfterPt: 10,
        lineSpacing: 1.5,
        color: "#2d3436",
      },
      h2: {
        font: "微软雅黑",
        sizePt: 13,
        bold: true,
        spaceBeforePt: 14,
        spaceAfterPt: 8,
        lineSpacing: 1.5,
        color: "#2d3436",
      },
      h3: {
        font: "微软雅黑",
        sizePt: 11,
        bold: true,
        spaceBeforePt: 10,
        spaceAfterPt: 6,
        lineSpacing: 1.5,
        color: "#636e72",
      },
      body: {
        font: "微软雅黑",
        sizePt: 10.5,
        bold: false,
        spaceBeforePt: 0,
        spaceAfterPt: 8,
        lineSpacing: 1.8,
        firstLineIndentCm: 0,
        align: "left",
      },
      quote: {
        font: "微软雅黑",
        sizePt: 10,
        bold: false,
        spaceBeforePt: 8,
        spaceAfterPt: 8,
        lineSpacing: 1.6,
        indentLeftCm: 1.2,
        borderLeft: true,
      },
      caption: {
        font: "微软雅黑",
        sizePt: 9,
        bold: false,
        spaceBeforePt: 6,
        spaceAfterPt: 10,
        lineSpacing: 1.4,
        align: "center",
      },
      footnote: {
        font: "微软雅黑",
        sizePt: 8,
      },
    },
    tables: {
      default: {
        border: "single",
        borderSizePt: 0.25,
        headerFill: "#f5f6fa",
        cellPaddingPt: 6,
        headerBold: true,
        align: "left",
        font: "微软雅黑",
        sizePt: 9.5,
        borderColor: "#dcdde1",
      },
      threeLines: {
        border: "threeLines",
        borderSizePt: 0.75,
        headerFill: "transparent",
        cellPaddingPt: 6,
        headerBold: true,
        align: "left",
        font: "微软雅黑",
        sizePt: 9.5,
        borderColor: "#2d3436",
      },
    },
    page: {
      ...mockTemplateFingerprint.page,
      margin: {
        top: 3,
        bottom: 3,
        left: 3,
        right: 3,
        unit: "cm",
      },
    },
  },
  {
    id: "professional-times",
    name: "专业英文",
    description: "国际化专业风格，适合涉外法律文书",
    preview: {
      primaryColor: "#1e3a5f",
      accentColor: "#3d5a80",
      fontFamily: "Times New Roman",
      headerStyle: "modern",
    },
    styles: {
      h1: {
        font: "Times New Roman",
        sizePt: 16,
        bold: true,
        spaceBeforePt: 14,
        spaceAfterPt: 8,
        lineSpacing: 1.2,
        color: "#1e3a5f",
      },
      h2: {
        font: "Times New Roman",
        sizePt: 14,
        bold: true,
        spaceBeforePt: 12,
        spaceAfterPt: 6,
        lineSpacing: 1.2,
        color: "#1e3a5f",
      },
      h3: {
        font: "Times New Roman",
        sizePt: 12,
        bold: true,
        spaceBeforePt: 10,
        spaceAfterPt: 4,
        lineSpacing: 1.2,
        color: "#3d5a80",
      },
      body: {
        font: "Times New Roman",
        sizePt: 11,
        bold: false,
        spaceBeforePt: 0,
        spaceAfterPt: 6,
        lineSpacing: 1.5,
        firstLineIndentCm: 1.27,
        align: "justify",
      },
      quote: {
        font: "Times New Roman",
        sizePt: 10,
        bold: false,
        spaceBeforePt: 4,
        spaceAfterPt: 4,
        lineSpacing: 1.3,
        indentLeftCm: 1.27,
        borderLeft: false,
      },
      caption: {
        font: "Times New Roman",
        sizePt: 10,
        bold: false,
        spaceBeforePt: 4,
        spaceAfterPt: 8,
        lineSpacing: 1.2,
        align: "center",
      },
      footnote: {
        font: "Times New Roman",
        sizePt: 9,
      },
    },
    tables: {
      default: {
        border: "single",
        borderSizePt: 0.5,
        headerFill: "#e8f4f8",
        cellPaddingPt: 4,
        headerBold: true,
        align: "center",
        font: "Times New Roman",
        sizePt: 10,
        borderColor: "#1e3a5f",
      },
      threeLines: {
        border: "threeLines",
        borderSizePt: 1,
        headerFill: "transparent",
        cellPaddingPt: 4,
        headerBold: true,
        align: "center",
        font: "Times New Roman",
        sizePt: 10,
        borderColor: "#1e3a5f",
      },
    },
    page: {
      size: "Letter",
      orientation: "portrait",
      margin: {
        top: 2.54,
        bottom: 2.54,
        left: 2.54,
        right: 2.54,
        unit: "cm",
      },
      headerFooter: mockTemplateFingerprint.page.headerFooter,
    },
  },
  // 6. 红金商务风格
  {
    id: "business-redgold",
    name: "红金商务",
    description: "高端商务风格，红金配色，彰显专业与品质",
    preview: {
      primaryColor: "#8B0000",
      accentColor: "#B8860B",
      fontFamily: "宋体",
      headerStyle: "classic",
    },
    styles: {
      h1: {
        font: "宋体",
        sizePt: 18,
        bold: true,
        spaceBeforePt: 16,
        spaceAfterPt: 10,
        lineSpacing: 1.3,
        color: "#8B0000",
      },
      h2: {
        font: "宋体",
        sizePt: 14,
        bold: true,
        spaceBeforePt: 12,
        spaceAfterPt: 6,
        lineSpacing: 1.3,
        color: "#8B0000",
      },
      h3: {
        font: "宋体",
        sizePt: 12,
        bold: true,
        spaceBeforePt: 10,
        spaceAfterPt: 4,
        lineSpacing: 1.3,
        color: "#B8860B",
      },
      body: {
        font: "宋体",
        sizePt: 11,
        bold: false,
        spaceBeforePt: 0,
        spaceAfterPt: 6,
        lineSpacing: 1.6,
        firstLineIndentCm: 0.74,
        align: "justify",
      },
      quote: mockTemplateFingerprint.styles.quote,
      caption: mockTemplateFingerprint.styles.caption,
      footnote: mockTemplateFingerprint.styles.footnote,
    },
    tables: {
      default: {
        border: "single",
        borderSizePt: 0.5,
        headerFill: "#FDF5E6",
        cellPaddingPt: 5,
        headerBold: true,
        align: "center",
        font: "宋体",
        sizePt: 10,
        borderColor: "#8B0000",
      },
      threeLines: {
        border: "threeLines",
        borderSizePt: 1,
        headerFill: "transparent",
        cellPaddingPt: 5,
        headerBold: true,
        align: "center",
        font: "宋体",
        sizePt: 10,
        borderColor: "#8B0000",
      },
    },
    page: mockTemplateFingerprint.page,
  },
  // 7. 蓝灰科技风格
  {
    id: "tech-bluegray",
    name: "科技蓝灰",
    description: "现代科技风格，适合科技行业尽调报告",
    preview: {
      primaryColor: "#0066CC",
      accentColor: "#4A5568",
      fontFamily: "微软雅黑",
      headerStyle: "modern",
    },
    styles: {
      h1: {
        font: "微软雅黑",
        sizePt: 17,
        bold: true,
        spaceBeforePt: 14,
        spaceAfterPt: 8,
        lineSpacing: 1.4,
        color: "#0066CC",
      },
      h2: {
        font: "微软雅黑",
        sizePt: 14,
        bold: true,
        spaceBeforePt: 12,
        spaceAfterPt: 6,
        lineSpacing: 1.4,
        color: "#0066CC",
      },
      h3: {
        font: "微软雅黑",
        sizePt: 12,
        bold: true,
        spaceBeforePt: 10,
        spaceAfterPt: 4,
        lineSpacing: 1.4,
        color: "#4A5568",
      },
      body: {
        font: "微软雅黑",
        sizePt: 10.5,
        bold: false,
        spaceBeforePt: 0,
        spaceAfterPt: 6,
        lineSpacing: 1.7,
        firstLineIndentCm: 0.74,
        align: "justify",
      },
      quote: {
        font: "微软雅黑",
        sizePt: 10,
        bold: false,
        spaceBeforePt: 4,
        spaceAfterPt: 4,
        lineSpacing: 1.4,
        indentLeftCm: 0.8,
        borderLeft: true,
      },
      caption: {
        font: "微软雅黑",
        sizePt: 9,
        bold: false,
        spaceBeforePt: 4,
        spaceAfterPt: 8,
        lineSpacing: 1.2,
        align: "center",
      },
      footnote: {
        font: "微软雅黑",
        sizePt: 8,
      },
    },
    tables: {
      default: {
        border: "single",
        borderSizePt: 0.5,
        headerFill: "#E6F2FF",
        cellPaddingPt: 5,
        headerBold: true,
        align: "center",
        font: "微软雅黑",
        sizePt: 9.5,
        borderColor: "#0066CC",
      },
      threeLines: {
        border: "threeLines",
        borderSizePt: 1,
        headerFill: "transparent",
        cellPaddingPt: 5,
        headerBold: true,
        align: "center",
        font: "微软雅黑",
        sizePt: 9.5,
        borderColor: "#0066CC",
      },
    },
    page: {
      ...mockTemplateFingerprint.page,
      margin: {
        top: 2.5,
        bottom: 2.5,
        left: 2.5,
        right: 2.5,
        unit: "cm",
      },
    },
  },
  // 8. 绿色环保风格
  {
    id: "eco-green",
    name: "生态绿色",
    description: "清新环保风格，适合环保、农业相关项目",
    preview: {
      primaryColor: "#2E7D32",
      accentColor: "#558B2F",
      fontFamily: "仿宋",
      headerStyle: "modern",
    },
    styles: {
      h1: {
        font: "黑体",
        sizePt: 16,
        bold: true,
        spaceBeforePt: 14,
        spaceAfterPt: 8,
        lineSpacing: 1.3,
        color: "#2E7D32",
      },
      h2: {
        font: "黑体",
        sizePt: 14,
        bold: true,
        spaceBeforePt: 12,
        spaceAfterPt: 6,
        lineSpacing: 1.3,
        color: "#2E7D32",
      },
      h3: {
        font: "黑体",
        sizePt: 12,
        bold: true,
        spaceBeforePt: 10,
        spaceAfterPt: 4,
        lineSpacing: 1.3,
        color: "#558B2F",
      },
      body: {
        font: "仿宋",
        sizePt: 11,
        bold: false,
        spaceBeforePt: 0,
        spaceAfterPt: 6,
        lineSpacing: 1.6,
        firstLineIndentCm: 0.74,
        align: "justify",
      },
      quote: mockTemplateFingerprint.styles.quote,
      caption: mockTemplateFingerprint.styles.caption,
      footnote: mockTemplateFingerprint.styles.footnote,
    },
    tables: {
      default: {
        border: "single",
        borderSizePt: 0.5,
        headerFill: "#E8F5E9",
        cellPaddingPt: 5,
        headerBold: true,
        align: "center",
        font: "仿宋",
        sizePt: 10,
        borderColor: "#2E7D32",
      },
      threeLines: {
        border: "threeLines",
        borderSizePt: 1,
        headerFill: "transparent",
        cellPaddingPt: 5,
        headerBold: true,
        align: "center",
        font: "仿宋",
        sizePt: 10,
        borderColor: "#2E7D32",
      },
    },
    page: mockTemplateFingerprint.page,
  },
];

/** 获取模板样式 */
export function getTemplateStyle(styleId: string): TemplateStyle | undefined {
  return templateStyles.find(s => s.id === styleId);
}

/** 获取默认模板样式 */
export function getDefaultTemplateStyle(): TemplateStyle {
  return templateStyles[0];
}
