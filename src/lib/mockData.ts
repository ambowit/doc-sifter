// Mock Data for DD Organizer
// 尽职调查文档整理系统 - 模拟数据

export interface Project {
  id: string;
  name: string;
  client: string;
  target: string;
  type: '并购' | '投资' | '合规' | '自定义';
  status: '未上传' | '解析中' | '可生成' | '已生成';
  progress: number;
  updatedAt: string;
  filesCount: number;
  chaptersCount: number;
}

export interface UploadedFile {
  id: string;
  name: string;
  type: '合同' | '公司治理' | '财务' | '知识产权' | '人事' | '诉讼' | '其他';
  size: string;
  uploadedAt: string;
  status: '已解析' | '解析中' | '待解析';
  excerpt?: string;
  pageRef?: string;
  confidence?: number;
}

export interface Chapter {
  id: string;
  number: string;
  title: string;
  level: 1 | 2 | 3;
  status: '已匹配' | '资料不足' | '未匹配';
  matchedFiles: string[];
  children?: Chapter[];
}

export interface MappedEvidence {
  fileId: string;
  fileName: string;
  fileType: string;
  excerpt: string;
  confidence: number;
  pageRef: string;
}

export interface ChapterSummary {
  chapterId: string;
  title: string;
  status: '已匹配' | '资料不足' | '未匹配';
  evidenceFiles: MappedEvidence[];
  summary: string;
  risks: string[];
  missingItems: string[];
}

// 项目列表 Mock 数据
export const mockProjects: Project[] = [
  {
    id: 'PRJ-2026-001',
    name: '星辰科技并购尽调',
    client: '华创资本',
    target: '星辰科技有限公司',
    type: '并购',
    status: '已生成',
    progress: 100,
    updatedAt: '2026-01-21 14:30',
    filesCount: 156,
    chaptersCount: 8,
  },
  {
    id: 'PRJ-2026-002',
    name: '云海数据A轮投资尽调',
    client: '红杉中国',
    target: '云海数据科技',
    type: '投资',
    status: '可生成',
    progress: 85,
    updatedAt: '2026-01-21 10:15',
    filesCount: 89,
    chaptersCount: 6,
  },
  {
    id: 'PRJ-2026-003',
    name: '博远医疗合规审查',
    client: '博远医疗集团',
    target: '博远医疗集团',
    type: '合规',
    status: '解析中',
    progress: 45,
    updatedAt: '2026-01-20 16:42',
    filesCount: 234,
    chaptersCount: 12,
  },
  {
    id: 'PRJ-2026-004',
    name: '智联物流战略投资',
    client: '京东物流',
    target: '智联物流科技',
    type: '投资',
    status: '未上传',
    progress: 0,
    updatedAt: '2026-01-19 09:00',
    filesCount: 0,
    chaptersCount: 0,
  },
  {
    id: 'PRJ-2026-005',
    name: '新能源汽车供应链尽调',
    client: '比亚迪',
    target: '锂电新能源',
    type: '并购',
    status: '可生成',
    progress: 92,
    updatedAt: '2026-01-18 11:20',
    filesCount: 178,
    chaptersCount: 10,
  },
];

// 上传文件 Mock 数据
export const mockUploadedFiles: UploadedFile[] = [
  { id: 'FILE-001', name: '营业执照_2025.pdf', type: '公司治理', size: '2.3 MB', uploadedAt: '2026-01-21 09:15', status: '已解析', excerpt: '统一社会信用代码：91110108MA01XXXXXX，成立日期：2018年3月15日，注册资本：人民币5000万元', pageRef: 'P.1', confidence: 98 },
  { id: 'FILE-002', name: '公司章程_修订版.docx', type: '公司治理', size: '856 KB', uploadedAt: '2026-01-21 09:15', status: '已解析', excerpt: '公司经营范围包括：技术开发、技术咨询、技术服务、技术转让；软件开发；数据处理...', pageRef: 'P.2-3', confidence: 95 },
  { id: 'FILE-003', name: '股东会决议_2025年度.pdf', type: '公司治理', size: '1.2 MB', uploadedAt: '2026-01-21 09:16', status: '已解析', excerpt: '审议通过2024年度利润分配方案，同意向全体股东分配现金股利人民币500万元', pageRef: 'P.1-2', confidence: 92 },
  { id: 'FILE-004', name: '董事会决议汇编.pdf', type: '公司治理', size: '3.4 MB', uploadedAt: '2026-01-21 09:16', status: '已解析', excerpt: '共含2023-2025年度董事会决议12份，涉及重大投资、人事任免、财务审批等事项', pageRef: 'P.1-48', confidence: 88 },
  { id: 'FILE-005', name: '核心技术授权协议.pdf', type: '知识产权', size: '1.8 MB', uploadedAt: '2026-01-21 09:17', status: '已解析', excerpt: '授权方：XX大学，被授权方：星辰科技，授权范围：专利号ZL202010XXXXXX.X的独占实施许可', pageRef: 'P.1-5', confidence: 96 },
  { id: 'FILE-006', name: '专利证书汇总.pdf', type: '知识产权', size: '5.2 MB', uploadedAt: '2026-01-21 09:17', status: '已解析', excerpt: '共含发明专划3项、实用新型专划8项、外观设计专划2项，均在有效期内', pageRef: 'P.1-26', confidence: 99 },
  { id: 'FILE-007', name: '软件著作权登记证书.pdf', type: '知识产权', size: '890 KB', uploadedAt: '2026-01-21 09:18', status: '已解析', excerpt: '软著登字第2024SRXXXXXX号，登记日期2024年6月15日，权利取得方式：原始取得', pageRef: 'P.1', confidence: 97 },
  { id: 'FILE-008', name: '2024年度审计报告.pdf', type: '财务', size: '8.9 MB', uploadedAt: '2026-01-21 09:18', status: '已解析', excerpt: '审计意见：无保留意见。营业收入3.2亿元，净利润4500万元，资产总额5.8亿元', pageRef: 'P.3-5', confidence: 94 },
  { id: 'FILE-009', name: '2023年度审计报告.pdf', type: '财务', size: '7.6 MB', uploadedAt: '2026-01-21 09:19', status: '已解析', excerpt: '审计意见：无保留意见。营业收入2.5亿元，净利润3200万元，同比增长28%', pageRef: 'P.3-5', confidence: 94 },
  { id: 'FILE-010', name: '主要供应商合同.zip', type: '合同', size: '12.3 MB', uploadedAt: '2026-01-21 09:19', status: '已解析', excerpt: '含前五大供应商框架协议，年采购额约1.2亿元，合同期限均至2026年', pageRef: '多文件', confidence: 85 },
  { id: 'FILE-011', name: '客户框架协议.pdf', type: '合同', size: '2.1 MB', uploadedAt: '2026-01-21 09:20', status: '已解析', excerpt: '与核心客户A签订的三年期框架协议，年度最低采购额8000万元', pageRef: 'P.1-8', confidence: 91 },
  { id: 'FILE-012', name: '劳动合同模板及补充协议.docx', type: '人事', size: '456 KB', uploadedAt: '2026-01-21 09:20', status: '已解析', excerpt: '标准劳动合同模板，符合《劳动合同法》要求，含竞业限制、保密协议条款', pageRef: 'P.1-12', confidence: 89 },
  { id: 'FILE-013', name: '核心员工名册.xlsx', type: '人事', size: '234 KB', uploadedAt: '2026-01-21 09:21', status: '已解析', excerpt: '核心团队32人，包括研发总监、技术骨干等15名，平均司龄4.2年', pageRef: '全表格', confidence: 86 },
  { id: 'FILE-014', name: '诉讼案件清单.pdf', type: '诉讼', size: '1.5 MB', uploadedAt: '2026-01-21 09:21', status: '已解析', excerpt: '待完结案件2件，均为原告，涉及金额合计120万元，预计不会产生重大不利影响', pageRef: 'P.1-3', confidence: 93 },
  { id: 'FILE-015', name: '商标注册证.pdf', type: '知识产权', size: '678 KB', uploadedAt: '2026-01-21 09:22', status: '已解析', excerpt: '注册号第12345678号，核定使用商品第9类、第42类，有效期至2034年', pageRef: 'P.1', confidence: 98 },
];

// 报告章节结构 Mock 数据
export const mockChapters: Chapter[] = [
  {
    id: 'CH-1',
    number: '1',
    title: '公司基本情况',
    level: 1,
    status: '已匹配',
    matchedFiles: ['FILE-001', 'FILE-002'],
    children: [
      { id: 'CH-1-1', number: '1.1', title: '公司设立及历史沿革', level: 2, status: '已匹配', matchedFiles: ['FILE-001'] },
      { id: 'CH-1-2', number: '1.2', title: '股权结构', level: 2, status: '已匹配', matchedFiles: ['FILE-002', 'FILE-003'] },
      { id: 'CH-1-3', number: '1.3', title: '公司治理结构', level: 2, status: '已匹配', matchedFiles: ['FILE-004'] },
    ],
  },
  {
    id: 'CH-2',
    number: '2',
    title: '知识产权',
    level: 1,
    status: '已匹配',
    matchedFiles: ['FILE-005', 'FILE-006', 'FILE-007', 'FILE-015'],
    children: [
      { id: 'CH-2-1', number: '2.1', title: '专利情况', level: 2, status: '已匹配', matchedFiles: ['FILE-006'] },
      { id: 'CH-2-2', number: '2.2', title: '商标情况', level: 2, status: '已匹配', matchedFiles: ['FILE-015'] },
      { id: 'CH-2-3', number: '2.3', title: '软件著作权', level: 2, status: '已匹配', matchedFiles: ['FILE-007'] },
      { id: 'CH-2-4', number: '2.4', title: '技术许可协议', level: 2, status: '已匹配', matchedFiles: ['FILE-005'] },
    ],
  },
  {
    id: 'CH-3',
    number: '3',
    title: '财务状况',
    level: 1,
    status: '已匹配',
    matchedFiles: ['FILE-008', 'FILE-009'],
    children: [
      { id: 'CH-3-1', number: '3.1', title: '历年审计报告分析', level: 2, status: '已匹配', matchedFiles: ['FILE-008', 'FILE-009'] },
      { id: 'CH-3-2', number: '3.2', title: '税务合规情况', level: 2, status: '资料不足', matchedFiles: [] },
    ],
  },
  {
    id: 'CH-4',
    number: '4',
    title: '重大合同',
    level: 1,
    status: '已匹配',
    matchedFiles: ['FILE-010', 'FILE-011'],
    children: [
      { id: 'CH-4-1', number: '4.1', title: '供应商合同', level: 2, status: '已匹配', matchedFiles: ['FILE-010'] },
      { id: 'CH-4-2', number: '4.2', title: '客户合同', level: 2, status: '已匹配', matchedFiles: ['FILE-011'] },
      { id: 'CH-4-3', number: '4.3', title: '关联交易', level: 2, status: '未匹配', matchedFiles: [] },
    ],
  },
  {
    id: 'CH-5',
    number: '5',
    title: '人力资源',
    level: 1,
    status: '资料不足',
    matchedFiles: ['FILE-012', 'FILE-013'],
    children: [
      { id: 'CH-5-1', number: '5.1', title: '劳动合同合规性', level: 2, status: '已匹配', matchedFiles: ['FILE-012'] },
      { id: 'CH-5-2', number: '5.2', title: '核心团队情况', level: 2, status: '已匹配', matchedFiles: ['FILE-013'] },
      { id: 'CH-5-3', number: '5.3', title: '社保公积金缴纳情况', level: 2, status: '未匹配', matchedFiles: [] },
    ],
  },
  {
    id: 'CH-6',
    number: '6',
    title: '诉讼与争议',
    level: 1,
    status: '已匹配',
    matchedFiles: ['FILE-014'],
    children: [
      { id: 'CH-6-1', number: '6.1', title: '进行中的诉讼', level: 2, status: '已匹配', matchedFiles: ['FILE-014'] },
      { id: 'CH-6-2', number: '6.2', title: '潜在法律风险', level: 2, status: '资料不足', matchedFiles: [] },
    ],
  },
];

// 章节摘要 Mock 数据
export const mockChapterSummaries: ChapterSummary[] = [
  {
    chapterId: 'CH-1',
    title: '公司基本情况',
    status: '已匹配',
    evidenceFiles: [
      {
        fileId: 'FILE-001',
        fileName: '营业执照_2025.pdf',
        fileType: '公司治理',
        excerpt: '统一社会信用代码：91110108MA01XXXXXX，成立日期：2018年3月15日，注册资本：人民币5000万元',
        confidence: 98,
        pageRef: 'P.1',
      },
      {
        fileId: 'FILE-002',
        fileName: '公司章程_修订版.docx',
        fileType: '公司治理',
        excerpt: '公司经营范围包括：技术开发、技术咨询、技术服务、技术转让；软件开发；数据处理...',
        confidence: 95,
        pageRef: 'P.2-3',
      },
    ],
    summary: '目标公司成立于2018年3月15日，注册资本人民币5000万元。根据营业执照及公司章程显示，公司主要从事技术开发、软件开发及数据处理等业务。公司治理结构完善，设有股东会、董事会及监事会。',
    risks: [],
    missingItems: [],
  },
  {
    chapterId: 'CH-3-2',
    title: '税务合规情况',
    status: '资料不足',
    evidenceFiles: [],
    summary: '',
    risks: ['未能获取近三年完整的纳税申报记录'],
    missingItems: ['税务登记证', '近三年增值税申报表', '近三年企业所得税申报表', '税务稽查结论（如有）'],
  },
  {
    chapterId: 'CH-4-3',
    title: '关联交易',
    status: '未匹配',
    evidenceFiles: [],
    summary: '',
    risks: ['无法确认是否存在未披露的关联交易'],
    missingItems: ['关联方清单', '关联交易明细', '关联交易定价政策'],
  },
];

// 文件类型统计
export const getFileTypeStats = (files: UploadedFile[]) => {
  const stats: Record<string, number> = {};
  files.forEach((file) => {
    stats[file.type] = (stats[file.type] || 0) + 1;
  });
  return Object.entries(stats).map(([type, count]) => ({ type, count }));
};

// 获取章节统计
export const getChapterStats = (chapters: Chapter[]) => {
  let matched = 0;
  let insufficient = 0;
  let unmatched = 0;

  const countStatus = (ch: Chapter) => {
    if (ch.status === '已匹配') matched++;
    else if (ch.status === '资料不足') insufficient++;
    else unmatched++;
    ch.children?.forEach(countStatus);
  };

  chapters.forEach(countStatus);
  return { matched, insufficient, unmatched, total: matched + insufficient + unmatched };
};

// 股权结构 Mock 数据
export interface EquityShareholder {
  id: string;
  name: string;
  percentage: number | null;
  type: 'individual' | 'company' | 'team';
  notes?: string;
}

export interface EquitySubsidiary {
  id: string;
  name: string;
  type: 'company' | 'subsidiary';
  percentage?: number | null;
  notes?: string;
}

export interface EquityStructureData {
  companyName: string;
  shareholders: EquityShareholder[];
  subsidiaries?: EquitySubsidiary[];
  notes: string[];
}

export const mockEquityStructure: EquityStructureData = {
  companyName: '星辰科技有限公司',
  shareholders: [
    { id: 'sh-1', name: '张明', percentage: 35, type: 'individual', notes: '实控人' },
    { id: 'sh-2', name: '李华', percentage: 25, type: 'individual' },
    { id: 'sh-3', name: '深圳创新投资', percentage: 20, type: 'company', notes: 'A轮投资人' },
    { id: 'sh-4', name: '星辰员工持股平台', percentage: 20, type: 'team', notes: '核心员工持股' },
  ],
  subsidiaries: [
    { id: 'sub-1', name: '星辰科技（上海）有限公司', type: 'subsidiary', percentage: 100, notes: '全资子公司' },
    { id: 'sub-2', name: '星辰数据科技（北京）有限公司', type: 'subsidiary', percentage: 100, notes: '全资子公司' },
  ],
  notes: [
    '以上股权结构信息来源于公司章程及股东会决议',
    '员工持股平台为有限合伙企业，实际控制人为张明',
    '截至2025年12月31日，股权无质押、冻结情况',
  ],
};

// 定义与简称 Mock 数据
export interface DefinitionItem {
  id: string;
  shortName: string;
  fullName: string;
  type: 'company' | 'individual' | 'institution' | 'transaction' | 'other';
  sourceFiles: Array<{ id: string; name: string; pageRef?: string }>;
  notes?: string;
}

export const mockDefinitions: DefinitionItem[] = [
  {
    id: 'def-001',
    shortName: '目标公司',
    fullName: '星辰科技有限公司',
    type: 'company',
    sourceFiles: [
      { id: 'FILE-001', name: '营业执照_2025.pdf', pageRef: 'P.1' },
      { id: 'FILE-002', name: '公司章程_修订版.docx', pageRef: 'P.1' },
    ],
  },
  {
    id: 'def-002',
    shortName: '委托方',
    fullName: '华创资本管理有限公司',
    type: 'company',
    sourceFiles: [{ id: 'EXTERNAL', name: '委托书', pageRef: 'P.1' }],
  },
  {
    id: 'def-003',
    shortName: '大股东',
    fullName: '张明',
    type: 'individual',
    sourceFiles: [{ id: 'FILE-003', name: '股东会决议_2025年度.pdf', pageRef: 'P.1' }],
    notes: '持股35%，为实际控制人',
  },
  {
    id: 'def-004',
    shortName: '二股东',
    fullName: '李华',
    type: 'individual',
    sourceFiles: [{ id: 'FILE-003', name: '股东会决议_2025年度.pdf', pageRef: 'P.1' }],
    notes: '持股25%',
  },
  {
    id: 'def-005',
    shortName: '投资方',
    fullName: '深圳创新投资有限合伙企业',
    type: 'company',
    sourceFiles: [{ id: 'FILE-003', name: '股东会决议_2025年度.pdf', pageRef: 'P.2' }],
    notes: '持股20%，A轮投资人',
  },
  {
    id: 'def-006',
    shortName: '员工持股平台',
    fullName: '杭州星辰管理咨询合伙企业（有限合伙）',
    type: 'company',
    sourceFiles: [{ id: 'FILE-003', name: '股东会决议_2025年度.pdf', pageRef: 'P.2' }],
    notes: '持股20%，核心员工持股',
  },
  {
    id: 'def-007',
    shortName: '上海子公司',
    fullName: '星辰科技（上海）有限公司',
    type: 'company',
    sourceFiles: [{ id: 'FILE-001', name: '营业执照_2025.pdf', pageRef: '附件' }],
    notes: '全资子公司',
  },
  {
    id: 'def-008',
    shortName: '北京子公司',
    fullName: '星辰数据科技（北京）有限公司',
    type: 'company',
    sourceFiles: [{ id: 'FILE-001', name: '营业执照_2025.pdf', pageRef: '附件' }],
    notes: '全资子公司',
  },
  {
    id: 'def-009',
    shortName: '本所',
    fullName: '北京金杜律师事务所',
    type: 'institution',
    sourceFiles: [{ id: 'EXTERNAL', name: '委托书', pageRef: 'P.1' }],
  },
  {
    id: 'def-010',
    shortName: '核心技术授权方',
    fullName: '清华大学',
    type: 'institution',
    sourceFiles: [{ id: 'FILE-005', name: '核心技术授权协议.pdf', pageRef: 'P.1' }],
  },
  {
    id: 'def-011',
    shortName: '本次交易',
    fullName: '华创资本对星辰科技的股权投资交易',
    type: 'transaction',
    sourceFiles: [{ id: 'EXTERNAL', name: '委托书', pageRef: 'P.1' }],
  },
  {
    id: 'def-012',
    shortName: '截止日',
    fullName: '2025年12月31日',
    type: 'other',
    sourceFiles: [{ id: 'EXTERNAL', name: '委托书', pageRef: 'P.2' }],
  },
];
