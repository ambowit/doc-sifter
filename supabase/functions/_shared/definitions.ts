export type EntityType = "company" | "individual" | "institution" | "transaction" | "other";

export interface DefinitionSourceTraceItem {
  sourceFileId: string | null;
  sourceFileName: string | null;
  sourcePageRef: string | null;
  sourceExcerpt: string | null;
  confidence: number | null;
  reviewReason?: string | null;
  raw?: Record<string, unknown>;
}

export interface ExtractedDefinitionItem {
  shortName?: string | null;
  fullName?: string | null;
  entityType?: EntityType | string | null;
  description?: string | null;
  sourceFileName?: string | null;
  sourcePageRef?: string | null;
  sourceExcerpt?: string | null;
  confidence?: number | null;
}

export interface SourceFileLike {
  id: string;
  name: string;
  category: string;
  extractedText: string | null;
  textSummary: string | null;
}

export interface SnippetItem {
  fileId: string;
  fileName: string;
  category: string;
  excerpt: string;
}

const WINDOW_RADIUS = 180; // 缩小窗口减少 token
const MAX_SNIPPETS_PER_FILE = 3; // 减少每文件片段数
const MAX_TOTAL_SNIPPETS = 60;
const FILES_PER_BATCH = 8; // 减少每批文件数，避免 AI Gateway 超时
const KEYWORD_REGEX = /(定义|释义|以下简称|以下称|系指|指为|简称|本协议|本公司|目标公司|投资方)/g;

export { FILES_PER_BATCH };

export function normalizeWhitespace(value: string | null | undefined): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

export function normalizeLookupKey(value: string | null | undefined): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[“”"'《》()（）\[\]【】,，。.；;:：·]/g, "")
    .replace(/\s+/g, "");
}

export function inferEntityType(fullName: string, shortName: string): EntityType {
  const text = `${fullName} ${shortName}`.toLowerCase();

  if (["公司", "企业", "集团", "有限", "股份", "合伙", "投资方", "目标公司", "标的公司"].some((k) => text.includes(k))) {
    return "company";
  }
  if (["先生", "女士", "自然人", "股东", "董事", "监事", "高管", "法定代表人", "实际控制人", "创始人"].some((k) => text.includes(k))) {
    return "individual";
  }
  if (["委员会", "政府", "监管", "银行", "协会", "机构", "证监会", "工商局", "税务局"].some((k) => text.includes(k))) {
    return "institution";
  }
  if (["交易", "收购", "合并", "投资", "融资", "增资", "股权转让", "重组", "项目"].some((k) => text.includes(k))) {
    return "transaction";
  }
  return "other";
}

export function categorizeFile(fileName: string): string {
  const name = fileName.toLowerCase();
  if (name.includes("章程")) return "章程与治理";
  if (name.includes("合同") || name.includes("协议")) return "合同协议";
  if (name.includes("制度") || name.includes("手册") || name.includes("规则")) return "制度规则";
  if (name.includes("营业执照") || name.includes("工商")) return "公司基本信息";
  if (name.includes("股权") || name.includes("股东") || name.includes("出资")) return "股权结构";
  if (name.includes("法律意见") || name.includes("尽调") || name.includes("说明书")) return "法律文件";
  return "其他";
}

function getPriorityScore(fileName: string, category: string): number {
  const text = `${fileName} ${category}`;
  if (/章程|合同|协议|制度|规则|法律意见|说明书/i.test(text)) return 3;
  if (/股权|工商|营业执照|投资/i.test(text)) return 2;
  return 1;
}

// 从单个文件提取 snippets（内部函数）
function extractSnippetsFromFile(file: SourceFileLike): SnippetItem[] {
  const text = normalizeWhitespace(file.extractedText || file.textSummary || "");
  if (!text) return [];

  const localSnippets: SnippetItem[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(KEYWORD_REGEX)) {
    if (localSnippets.length >= MAX_SNIPPETS_PER_FILE) break;
    const index = match.index ?? 0;
    const start = Math.max(0, index - WINDOW_RADIUS);
    const end = Math.min(text.length, index + WINDOW_RADIUS);
    const excerpt = text.slice(start, end).trim();
    const key = normalizeLookupKey(excerpt);
    if (!excerpt || seen.has(key)) continue;
    seen.add(key);
    localSnippets.push({
      fileId: file.id,
      fileName: file.name,
      category: file.category,
      excerpt,
    });
  }

  // 高优先级文件如果没找到关键词，取前 800 字符
  if (localSnippets.length === 0 && getPriorityScore(file.name, file.category) >= 3) {
    localSnippets.push({
      fileId: file.id,
      fileName: file.name,
      category: file.category,
      excerpt: text.slice(0, 800),
    });
  }

  return localSnippets;
}

// 对一批文件构建 snippets（用于分批处理）
export function buildSnippetsForFiles(files: SourceFileLike[]): SnippetItem[] {
  const snippets: SnippetItem[] = [];
  for (const file of files) {
    snippets.push(...extractSnippetsFromFile(file));
  }
  return snippets;
}

// 原有函数：对所有文件构建 snippets（带全局上限）
export function buildDefinitionSnippets(files: SourceFileLike[]): SnippetItem[] {
  const rankedFiles = [...files].sort((a, b) => {
    const scoreDiff = getPriorityScore(b.name, b.category) - getPriorityScore(a.name, a.category);
    if (scoreDiff !== 0) return scoreDiff;
    return a.name.localeCompare(b.name, "zh-CN");
  });

  const snippets: SnippetItem[] = [];

  for (const file of rankedFiles) {
    if (snippets.length >= MAX_TOTAL_SNIPPETS) break;
    const localSnippets = extractSnippetsFromFile(file);
    const remaining = MAX_TOTAL_SNIPPETS - snippets.length;
    snippets.push(...localSnippets.slice(0, remaining));
  }

  return snippets;
}

export function parseDefinitionResponse(content: string): ExtractedDefinitionItem[] {
  let jsonStr = content.trim();
  const blockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (blockMatch) {
    jsonStr = blockMatch[1].trim();
  }

  const arrayStart = jsonStr.indexOf("[");
  const arrayEnd = jsonStr.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd !== -1) {
    jsonStr = jsonStr.slice(arrayStart, arrayEnd + 1);
  }

  const parsed = JSON.parse(jsonStr);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.map((item) => ({
    shortName: normalizeWhitespace(item.shortName ?? item.short_name ?? item.alias),
    fullName: normalizeWhitespace(item.fullName ?? item.full_name ?? item.name),
    entityType: item.entityType ?? item.entity_type ?? item.type ?? null,
    description: normalizeWhitespace(item.description ?? item.notes),
    sourceFileName: normalizeWhitespace(item.sourceFileName ?? item.source_file_name ?? item.fileName),
    sourcePageRef: normalizeWhitespace(item.sourcePageRef ?? item.source_page_ref ?? item.pageRef),
    sourceExcerpt: normalizeWhitespace(item.sourceExcerpt ?? item.source_excerpt ?? item.evidence),
    confidence: typeof item.confidence === "number" ? item.confidence : null,
  }));
}

export function dedupeExtractedItems(items: ExtractedDefinitionItem[]): ExtractedDefinitionItem[] {
  const bestByKey = new Map<string, ExtractedDefinitionItem>();

  for (const item of items) {
    const shortKey = normalizeLookupKey(item.shortName);
    const fullKey = normalizeLookupKey(item.fullName);
    if (shortKey && fullKey && shortKey === fullKey) {
      // 无效定义：简称与全称一致
      continue;
    }
    const key = `${shortKey}|${fullKey}`;
    if (!shortKey && !fullKey) continue;

    const previous = bestByKey.get(key);
    const currentScore = (item.confidence ?? 0) + (item.sourceExcerpt ? 0.2 : 0) + (item.sourceFileName ? 0.1 : 0);
    const previousScore = previous ? ((previous.confidence ?? 0) + (previous.sourceExcerpt ? 0.2 : 0) + (previous.sourceFileName ? 0.1 : 0)) : -1;
    if (!previous || currentScore >= previousScore) {
      bestByKey.set(key, item);
    }
  }

  return [...bestByKey.values()];
}

export function buildDefinitionPrompts(
  project: { name: string | null; target: string | null; client: string | null },
  snippets: SnippetItem[],
) {
  // 精简 prompt 减少 token，加快 AI 响应
  const systemPrompt = `从法律文件提取"定义与简称"。识别：以下简称、系指、定义、释义条款；公司/股东/关联方主体简称。
输出JSON数组，字段：fullName,shortName,entityType,sourceFileName,sourceExcerpt,confidence(0-1)。禁止解释文字。`;

  const snippetText = snippets.map((s, i) => `[${i + 1}]${s.fileName}:${s.excerpt}`).join("\n");

  const userPrompt = `项目:${project.name || ""}|目标:${project.target || ""}\n\n${snippetText}`;

  return { systemPrompt, userPrompt };
}

export function clampConfidence(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}
