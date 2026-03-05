/**
 * Enum Constants for Database Fields
 * 
 * This file contains all enum values used in the database.
 * Use these constants instead of hardcoding strings to ensure consistency.
 */

// =====================================================
// Chapter Status
// =====================================================
export const ChapterStatus = {
  UNMATCHED: 'unmatched',
  INSUFFICIENT_DATA: 'insufficient_data',
  MATCHED: 'matched',
} as const;

export type ChapterStatusType = typeof ChapterStatus[keyof typeof ChapterStatus];

export const ChapterStatusLabels: Record<ChapterStatusType, string> = {
  [ChapterStatus.UNMATCHED]: '未匹配',
  [ChapterStatus.INSUFFICIENT_DATA]: '资料不足',
  [ChapterStatus.MATCHED]: '已匹配',
};

// =====================================================
// Project Status
// =====================================================
export const ProjectStatus = {
  NOT_UPLOADED: 'not_uploaded',
  PARSING: 'parsing',
  MAPPING: 'mapping',
  PENDING_REVIEW: 'pending_review',
  COMPLETED: 'completed',
} as const;

export type ProjectStatusType = typeof ProjectStatus[keyof typeof ProjectStatus];

export const ProjectStatusLabels: Record<ProjectStatusType, string> = {
  [ProjectStatus.NOT_UPLOADED]: '未上传',
  [ProjectStatus.PARSING]: '解析中',
  [ProjectStatus.MAPPING]: '映射中',
  [ProjectStatus.PENDING_REVIEW]: '待审阅',
  [ProjectStatus.COMPLETED]: '已完成',
};

// =====================================================
// Report Language
// =====================================================
export const ReportLanguage = {
  ZH: 'zh',
  EN: 'en',
  ZH_EN: 'zh_en',
} as const;

export type ReportLanguageType = typeof ReportLanguage[keyof typeof ReportLanguage];

export const ReportLanguageLabels: Record<ReportLanguageType, string> = {
  [ReportLanguage.ZH]: '中文',
  [ReportLanguage.EN]: '英文',
  [ReportLanguage.ZH_EN]: '中英双语',
};

// =====================================================
// Project Type
// =====================================================
export const ProjectType = {
  EQUITY_ACQUISITION: 'equity_acquisition',
  ASSET_ACQUISITION: 'asset_acquisition',
  IPO: 'ipo',
  BOND_ISSUANCE: 'bond_issuance',
  FINANCING: 'financing',
  OTHER: 'other',
} as const;

export type ProjectTypeType = typeof ProjectType[keyof typeof ProjectType];

export const ProjectTypeLabels: Record<ProjectTypeType, string> = {
  [ProjectType.EQUITY_ACQUISITION]: '股权收购',
  [ProjectType.ASSET_ACQUISITION]: '资产收购',
  [ProjectType.IPO]: 'IPO',
  [ProjectType.BOND_ISSUANCE]: '债券发行',
  [ProjectType.FINANCING]: '融资',
  [ProjectType.OTHER]: '其他',
};

// =====================================================
// Helper Functions
// =====================================================

/**
 * Get display label for chapter status
 */
export function getChapterStatusLabel(status: string): string {
  return ChapterStatusLabels[status as ChapterStatusType] || status;
}

/**
 * Get display label for project status
 */
export function getProjectStatusLabel(status: string): string {
  return ProjectStatusLabels[status as ProjectStatusType] || status;
}

/**
 * Get display label for report language
 */
export function getReportLanguageLabel(language: string): string {
  return ReportLanguageLabels[language as ReportLanguageType] || language;
}

/**
 * Get display label for project type
 */
export function getProjectTypeLabel(type: string): string {
  return ProjectTypeLabels[type as ProjectTypeType] || type;
}
