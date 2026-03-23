import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useBulkCreateChapters, type CreateChapterData } from "@/hooks/useChapters";
import { useUpdateFileStatus, type FileStatus } from "@/hooks/useFiles";
import JSZip from "jszip";

// Extract text from DOCX file (ArrayBuffer) using JSZip
async function extractDocxText(arrayBuffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const docXml = zip.file("word/document.xml");
  if (!docXml) return "";
  const xmlContent = await docXml.async("text");
  return xmlContent
    .replace(/<w:p[ >]/g, "\n<w:p ")
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+|\s+$/gm, "")
    .trim();
}

// Extract text from file object (DOCX or PDF) before sending to AI
export async function extractFileText(file: File): Promise<string> {
  const isDocx =
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.name.endsWith(".docx");

  if (isDocx) {
    const buffer = await file.arrayBuffer();
    const text = await extractDocxText(buffer);
    console.log("[extractFileText] DOCX extracted", { length: text.length, preview: text.substring(0, 200) });
    return text;
  }

  // PDF: use basic text extraction (readable characters)
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const raw = decoder.decode(bytes);
  const chinese = raw.match(/[\u4E00-\u9FFF\u3000-\u303F]{2,}/g) || [];
  const ascii = raw.match(/[A-Za-z0-9\u0020-\u007E]{4,}/g) || [];
  const combined = [...chinese, ...ascii].join("\n").substring(0, 20000);
  console.log("[extractFileText] PDF extracted", { length: combined.length, chineseCount: chinese.length });
  return combined;
}

export interface ChapterStructure {
  number: string;
  title: string;
  level: number;
  description: string;
  children?: ChapterStructure[];
}

export interface DocumentSummary {
  title: string;
  type: string;
  keyPoints: string[];
  relevantChapters: string[];
  confidence: number;
}

export interface TemplateParseResult {
  chapters: ChapterStructure[];
}

export interface DocumentParseResult {
  summary: DocumentSummary;
}

// Flatten chapter structure to array with parent references
function flattenChapters(
  chapters: ChapterStructure[],
  projectId: string,
  parentId: string | null = null,
  parentNumber: string = ""
): CreateChapterData[] {
  const result: CreateChapterData[] = [];

  chapters.forEach((chapter, index) => {
    const orderIndex = index;

    result.push({
      projectId,
      parentId,
      title: chapter.title,
      number: chapter.number || null,
      level: chapter.level,
      orderIndex,
      description: chapter.description || "",
    });

    if (chapter.children && chapter.children.length > 0) {
      const childChapters = flattenChapters(
        chapter.children,
        projectId,
        null,
        chapter.number
      );
      result.push(...childChapters);
    }
  });

  return result;
}

// Parse template content to extract chapter structure (fallback parser)
function parseTemplateContent(content: string): ChapterStructure[] {
  const chapters: ChapterStructure[] = [];
  const lines = content.split("\n");

  let currentChapter: ChapterStructure | null = null;
  let chapterIndex = 0;
  let subChapterIndex = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detect chapter headers
    // Pattern: ## 第X章 or # 章节 or 1. or 一、
    const level1Match = trimmed.match(/^(?:##?\s*)?(?:第[一二三四五六七八九十\d]+章|[一二三四五六七八九十]+[、.])\s*(.+)/);
    const level2Match = trimmed.match(/^(?:###\s*)?(?:\d+\.\d+|[（(][一二三四五六七八九十\d]+[)）])\s*(.+)/);

    if (level1Match) {
      chapterIndex++;
      subChapterIndex = 0;
      currentChapter = {
        number: String(chapterIndex), // Use simple numbering
        title: level1Match[1] || trimmed,
        level: 1,
        description: "",
        children: [],
      };
      chapters.push(currentChapter);
    } else if (level2Match && currentChapter) {
      subChapterIndex++;
      currentChapter.children = currentChapter.children || [];
      currentChapter.children.push({
        number: `${chapterIndex}.${subChapterIndex}`,
        title: level2Match[1] || trimmed,
        level: 2,
        description: "",
      });
    } else if (currentChapter && currentChapter.children && currentChapter.children.length > 0) {
      // Add as description to last sub-chapter
      const lastChild = currentChapter.children[currentChapter.children.length - 1];
      if (!lastChild.description) {
        lastChild.description = trimmed;
      }
    } else if (currentChapter && !currentChapter.description) {
      currentChapter.description = trimmed;
    }
  }

  return chapters;
}

// Hook to parse template and extract chapter structure
// Convert file to base64
export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove the data URL prefix (e.g., "data:application/pdf;base64,")
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function useParseTemplate() {
  const { user } = useAuth();
  const bulkCreateChapters = useBulkCreateChapters();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      projectId,
      content,
      filename,
      fileData,
      mimeType,
    }: {
      projectId: string;
      content: string;
      filename?: string;
      fileData?: string;
      mimeType?: string;
    }) => {
      if (!user) throw new Error("User not authenticated");

      console.log("[ParseTemplate] Starting AI parsing", {
        filename,
        contentLength: content?.length,
        projectId,
        hasFileData: !!fileData,
        fileDataLength: fileData?.length,
        mimeType,
      });

      // Use fetch with timeout for better control
      const TIMEOUT_MS = 90000; // 90 seconds
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        console.log("[ParseTemplate] Request timeout, aborting...");
        controller.abort();
      }, TIMEOUT_MS);

      try {
        const requestBody: Record<string, unknown> = {
          type: "template",
          content,
          filename,
        };

        // Include file data if provided (for server-side parsing)
        if (fileData) {
          requestBody.fileData = fileData;
          requestBody.mimeType = mimeType;
          console.log("[ParseTemplate] Including file data for server-side parsing", {
            fileDataLength: fileData.length,
            mimeType,
          });
        }

        // Call OOOK AI Gateway directly from browser (works in both dev and prod)
        const oookToken = import.meta.env.VITE_OOOK_AI_GATEWAY_TOKEN;
        const oookUrl = (import.meta.env.VITE_OOOK_AI_GATEWAY_URL || "https://gateway.oook.cn/").replace(/\/$/, "");

        if (!oookToken) {
          throw new Error("VITE_OOOK_AI_GATEWAY_TOKEN 未配置，请在项目环境变量中添加");
        }

        // Build prompts based on whether we have real file content
        const hasContent = requestBody.content && typeof requestBody.content === "string" && (requestBody.content as string).trim().length > 50;

        let systemPrompt: string;
        let userPrompt: string;

        if (hasContent) {
          systemPrompt = `你是一个专业的法律尽调报告分析专家。你的任务是从用户上传的尽调报告中完整提取目录结构。

## 识别所有章节层级

### 一级章节标记模式：
- 中文数字编号："一、"、"二、"、"三、"..."十、" 等
- 阿拉伯数字："1."、"2."、"3." 或 "1、"、"2、"
- 第X章格式："第一章"、"第二章"
- 无编号的独立标题：如 "引言"、"定义"、"报告正文"、"股权结构图" 等

### 二级章节标记模式：
- "(一)"、"(二)"、"(三)" 等括号中文编号
- "1.1"、"1.2"、"2.1" 等层级编号
- "(1)"、"(2)"、"(3)" 等括号阿拉伯数字

## 输出要求
- 必须完整提取所有一级章节，不要遗漏任何大章
- 保持原文档的编号和标题
- 如果章节有页码，忽略页码只提取标题

必须仅返回合法的JSON，不要加任何说明文字：
{"chapters":[{"number":"一","title":"章节标题","level":1,"description":"简短描述","children":[{"number":"(一)","title":"子章节","level":2,"description":"简短描述"}]}]}`;
          userPrompt = `请完整提取以下法律尽调报告的目录结构${requestBody.filename ? `（文件名：${requestBody.filename}）` : ""}：

---
${(requestBody.content as string).substring(0, 15000)}
---
${(requestBody.content as string).length > 15000 ? `\n[内容已截断，共${(requestBody.content as string).length}字符]` : ""}

要求：
1. 找出文档中所有的一级章节
2. 每个一级章节下找出其子章节
3. 保持原文档的编号格式
4. description字段保持10字以内

仅返回JSON，不要其他内容。`;
        } else {
          systemPrompt = `你是一个专业的法律尽调报告专家，具有丰富的并购、投融资项目经验。

你需要生成一份专业、完整的法律尽职调查报告章节结构。

必须仅返回合法的JSON，不要加任何说明文字：
{"chapters":[{"number":"1","title":"章节标题","level":1,"description":"核查要点说明","children":[{"number":"1.1","title":"子章节","level":2,"description":"核查要点"}]}]}

要求：
- 生成8-10个一级章节
- 每个一级章节包含2-4个子章节
- description说明该章节需要核查的具体要点
- 结构应专业、完整、符合行业标准
- 仅返回JSON，不要其他内容`;
          const contextInfo = [];
          if (requestBody.filename) contextInfo.push(`文件名: ${requestBody.filename}`);
          userPrompt = `请生成一份专业的法律尽职调查报告章节结构。${contextInfo.length > 0 ? `\n\n项目背景：\n${contextInfo.join("\n")}` : ""}\n\n仅返回JSON，不要其他内容。`;
        }

        const gatewayResponse = await fetch(`${oookUrl}/api/ai/execute`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${oookToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            capability: "ai.general_user_defined",
            input: {
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
              ],
            },
            constraints: { maxCost: 0.1 },
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!gatewayResponse.ok) {
          const errText = await gatewayResponse.text();
          if (gatewayResponse.status === 401) throw new Error("AI服务认证失败，请检查 VITE_OOOK_AI_GATEWAY_TOKEN 配置");
          if (gatewayResponse.status === 402) throw new Error("AI服务额度不足，请联系管理员充值");
          if (gatewayResponse.status === 429) throw new Error("AI请求过于频繁，请稍后重试");
          throw new Error(`AI服务错误(${gatewayResponse.status}): ${errText.substring(0, 200)}`);
        }

        const gatewayData = await gatewayResponse.json();
        const rawContent: string = gatewayData.data?.content || gatewayData.content || "";

        if (!rawContent) {
          throw new Error("AI返回内容为空，请重试");
        }

        // Extract JSON from AI response
        let jsonStr = rawContent.trim();
        const jsonCodeMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonCodeMatch?.[1]) {
          jsonStr = jsonCodeMatch[1].trim();
        } else {
          const start = jsonStr.indexOf("{");
          const end = jsonStr.lastIndexOf("}");
          if (start !== -1 && end !== -1) jsonStr = jsonStr.substring(start, end + 1);
        }

        let parsed: TemplateParseResult;
        try {
          parsed = JSON.parse(jsonStr);
        } catch {
          // Attempt repair
          jsonStr = jsonStr.replace(/,\s*([\]\}])/g, "$1");
          const ob = (jsonStr.match(/\{/g) || []).length;
          const cb = (jsonStr.match(/\}/g) || []).length;
          const oq = (jsonStr.match(/\[/g) || []).length;
          const cq = (jsonStr.match(/\]/g) || []).length;
          const lastClose = jsonStr.lastIndexOf("}");
          if (lastClose > 0) {
            jsonStr = jsonStr.substring(0, lastClose + 1);
            for (let i = 0; i < oq - cq; i++) jsonStr += "]";
            for (let i = 0; i < ob - cb; i++) jsonStr += "}";
          }
          parsed = JSON.parse(jsonStr);
        }

        const result = parsed as TemplateParseResult;
        console.log("[ParseTemplate] AI result:", {
          chaptersCount: result.chapters?.length
        });

        if (!result.chapters || result.chapters.length === 0) {
          throw new Error("AI未能生成报告结构");
        }

        // Flatten and create chapters in database
        console.log("[ParseTemplate] Creating chapters in database...");
        const chaptersToCreate = flattenChapters(result.chapters, projectId);
        await bulkCreateChapters.mutateAsync({ projectId, chapters: chaptersToCreate });
        console.log("[ParseTemplate] Chapters created successfully");

        return result;
      } catch (fetchError) {
        clearTimeout(timeoutId);
        console.error("[ParseTemplate] Fetch error:", fetchError);

        if (fetchError instanceof Error) {
          if (fetchError.name === "AbortError") {
            throw new Error("AI解析超时（90秒），请重试");
          }
          throw fetchError;
        }
        throw new Error("AI解析失败: 未知错误");
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["chapters", variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ["flatChapters", variables.projectId] });
    },
  });
}

// Hook to parse document and extract summary
export function useParseDocument() {
  const { user } = useAuth();
  const updateFileStatus = useUpdateFileStatus();

  return useMutation({
    mutationFn: async ({
      fileId,
      content,
      filename
    }: {
      fileId: string;
      content: string;
      filename?: string;
    }) => {
      if (!user) throw new Error("User not authenticated");

      // Update file status to parsing
      await updateFileStatus.mutateAsync({
        fileId,
        status: "解析中" as FileStatus,
      });

      try {
        // Call the parse Edge Function
        const { data, error } = await supabase.functions.invoke("parse", {
          body: {
            type: "document",
            content,
            filename,
          },
        });

        if (error) {
          throw new Error(`Document parsing failed: ${error.message}`);
        }

        const result = data as DocumentParseResult;

        // Update file with parsed content
        await updateFileStatus.mutateAsync({
          fileId,
          status: "已解析" as FileStatus,
          excerpt: result.summary.keyPoints.join("\n"),
          confidence: result.summary.confidence,
          parsedContent: result.summary as unknown as Record<string, unknown>,
        });

        return result;
      } catch (error) {
        // Update file status to failed
        await updateFileStatus.mutateAsync({
          fileId,
          status: "解析失败" as FileStatus,
        });
        throw error;
      }
    },
  });
}

// Hook to parse multiple documents in batch
export function useBatchParseDocuments() {
  const parseDocument = useParseDocument();

  return useMutation({
    mutationFn: async (documents: Array<{ fileId: string; content: string; filename?: string }>) => {
      const results: Array<{ fileId: string; result?: DocumentParseResult; error?: string }> = [];

      // Process documents sequentially to avoid rate limits
      for (const doc of documents) {
        try {
          const result = await parseDocument.mutateAsync(doc);
          results.push({ fileId: doc.fileId, result });
        } catch (error) {
          results.push({
            fileId: doc.fileId,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }

        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      return results;
    },
  });
}

// Utility to extract text content from file (for PDF, Word, etc.)
// This is a simplified version - in production, you'd use proper parsers
export async function extractTextFromFile(file: File): Promise<string> {
  // For text files, read directly
  if (file.type === "text/plain") {
    return await file.text();
  }

  // For PDF and Word files, we'll use a simplified approach
  // In production, you'd use PDF.js or mammoth.js for proper parsing

  // Try to read as text (works for some file types)
  try {
    const text = await file.text();
    // Check if it looks like valid text content
    if (text && text.length > 0 && !text.includes("\u0000")) {
      // Filter out binary content
      const cleanText = text.replace(/[^\x20-\x7E\u4E00-\u9FFF\u3000-\u303F\uFF00-\uFFEF\n\r\t]/g, " ");
      if (cleanText.trim().length > 100) {
        return cleanText;
      }
    }
  } catch {
    // Ignore errors
  }

  // Return a placeholder for files we can't parse client-side
  return `[文件: ${file.name}]\n\n无法在浏览器中直接解析此文件格式。请上传文本文件或 PDF 文件以进行 AI 解析。`;
}

// Demo chapter structure for fallback
const DEMO_CHAPTERS: ChapterStructure[] = [
  {
    number: "1",
    title: "公司基本情况",
    level: 1,
    description: "对目标公司的设立情况、历次股权变更、注册资本变化等进行核查",
    children: [
      { number: "1.1", title: "公司设立及历史沿革", level: 2, description: "历次股权变更、注册资本变化" },
      { number: "1.2", title: "股权结构", level: 2, description: "现有股权结构、股东情况及实际控制人" },
      { number: "1.3", title: "组织架构", level: 2, description: "组织架构、分支机构及关联企业" },
    ],
  },
  {
    number: "2",
    title: "公司治理",
    level: 1,
    description: "核查公司治理结构的合法性和有效性",
    children: [
      { number: "2.1", title: "公司章程", level: 2, description: "公司章程的合法性、有效性及主要条款" },
      { number: "2.2", title: "股东会/董事会决议", level: 2, description: "历次股东会、董事会决议的合法性" },
      { number: "2.3", title: "高级管理人员", level: 2, description: "高管人员的任职资格、竞业限制等" },
    ],
  },
  {
    number: "3",
    title: "重大资产",
    level: 1,
    description: "核查目标公司的重大资产状况",
    children: [
      { number: "3.1", title: "房产及土地", level: 2, description: "不动产权属、租赁情况" },
      { number: "3.2", title: "知识产权", level: 2, description: "专利、商标、著作权等知识产权状况" },
      { number: "3.3", title: "其他重大资产", level: 2, description: "车辆、设备等其他重大资产" },
    ],
  },
  {
    number: "4",
    title: "重大合同",
    level: 1,
    description: "核查重大合同的合法性和风险",
    children: [
      { number: "4.1", title: "股权投资/收购协议", level: 2, description: "重大投资或收购协议" },
      { number: "4.2", title: "借款及担保合同", level: 2, description: "借款、担保合同及风险" },
      { number: "4.3", title: "重大业务合同", level: 2, description: "与主营业务相关的重大合同" },
    ],
  },
  {
    number: "5",
    title: "劳动人事",
    level: 1,
    description: "核查劳动人事合规情况",
    children: [
      { number: "5.1", title: "劳动合同", level: 2, description: "劳动合同签订及执行情况" },
      { number: "5.2", title: "社会保险及公积金", level: 2, description: "社保及公积金缴纳情况" },
      { number: "5.3", title: "劳动争议", level: 2, description: "现有及潜在劳动争议" },
    ],
  },
  {
    number: "6",
    title: "税务合规",
    level: 1,
    description: "核查税务合规情况",
    children: [
      { number: "6.1", title: "税务登记", level: 2, description: "税务登记及纳税主体资格" },
      { number: "6.2", title: "各项税种", level: 2, description: "各项税种的申报及缴纳情况" },
      { number: "6.3", title: "税收优惠", level: 2, description: "享受的税收优惠政策" },
    ],
  },
  {
    number: "第二章",
    title: "公司治理",
    level: 1,
    description: "核查公司治理结构的合法性和有效性",
    children: [
      { number: "2.1", title: "公司章程", level: 2, description: "公司章程的合法性、有效性及主要条款" },
      { number: "2.2", title: "股东会/董事会决议", level: 2, description: "历次股东会、董事会决议的合法性" },
      { number: "2.3", title: "高级管理人员", level: 2, description: "高管人员的任职资格、竞业限制等" },
    ],
  },
  {
    number: "第三章",
    title: "重大资产",
    level: 1,
    description: "核查目标公���的重大资产状况",
    children: [
      { number: "3.1", title: "房产及土地", level: 2, description: "不动产权属、租赁情况" },
      { number: "3.2", title: "知识产权", level: 2, description: "专利、商标、���作权等知识产权状况" },
      { number: "3.3", title: "其他重大资产", level: 2, description: "车辆、设备等其他重大资产" },
    ],
  },
  {
    number: "第四章",
    title: "重大合同",
    level: 1,
    description: "核查重大合同的合法性和风险",
    children: [
      { number: "4.1", title: "股权投资/收购协议", level: 2, description: "重大投资或收购协议" },
      { number: "4.2", title: "借款及担保合同", level: 2, description: "借款、担保合同及风险" },
      { number: "4.3", title: "重大业务合同", level: 2, description: "与主营业务相关的重大合同" },
    ],
  },
  {
    number: "第五章",
    title: "劳动人事",
    level: 1,
    description: "核查劳动人事合规情况",
    children: [
      { number: "5.1", title: "劳动合同", level: 2, description: "劳动合同签订及执行情况" },
      { number: "5.2", title: "社会保险及公积金", level: 2, description: "社保及公积金缴纳情况" },
      { number: "5.3", title: "劳动争议", level: 2, description: "现有及潜在劳动争议" },
    ],
  },
  {
    number: "7",
    title: "诉讼、仲裁及行政处罚",
    level: 1,
    description: "核查诉讼、仲裁及行政处罚情况",
    children: [
      { number: "7.1", title: "诉讼及仲裁", level: 2, description: "现有及潜在诉讼、仲裁案件" },
      { number: "7.2", title: "行政处罚", level: 2, description: "行政处罚情况" },
    ],
  },
  {
    number: "8",
    title: "合规经营",
    level: 1,
    description: "核查合规经营情况",
    children: [
      { number: "8.1", title: "行业资质", level: 2, description: "经营所需的各类资质许可" },
      { number: "8.2", title: "环境保护", level: 2, description: "环保合规情况" },
      { number: "8.3", title: "其他合规事项", level: 2, description: "其他法律法规合规情况" },
    ],
  },
];

// Interface for AI mapping
export interface MappingSuggestion {
  fileId: string;
  fileName: string;
  chapterId: string;
  chapterTitle: string;
  confidence: number;
  reason: string;
  excerpt: string;
}

export interface AIMappingResult {
  success: boolean;
  mappings: MappingSuggestion[];
  processedFiles: number;
  processedChapters: number;
  error?: string;
}

// Hook to run AI mapping analysis
export function useAIMapping() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      projectId,
      files,
      chapters,
    }: {
      projectId: string;
      files: Array<{
        id: string;
        name: string;
        fileType: string;
        storagePath: string;
        content?: string;
      }>;
      chapters: Array<{
        id: string;
        title: string;
        level: number;
        description: string;
        number?: string;
      }>;
    }) => {
      console.log("[AI Mapping] Starting mapping analysis", {
        fileCount: files.length,
        chapterCount: chapters.length
      });

      const { data, error } = await supabase.functions.invoke("ai-mapping", {
        body: { projectId, files, chapters },
      });

      if (error) {
        console.error("[AI Mapping] Error:", error);
        throw new Error(`AI映射失败: ${error.message}`);
      }

      console.log("[AI Mapping] Result:", data);
      return data as AIMappingResult;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["mappings", variables.projectId] });
    },
  });
}

// Mock template content for demo
export const DEMO_TEMPLATE_CONTENT = `
# 法律尽职调查报告

## 第一章 公司基本情况
### 1.1 公司设立及历史沿革
对目标公司的设立情况、历次股权变更、注册资本变化等进行核查

### 1.2 股权结构
核查目标公司现有股权结构、股东情况及实际控制人

### 1.3 组织架构
核查目标公司的组织架构、分支机构及关联企业

## 第二章 公司治理
### 2.1 公司章程
核查公司章程的合法性、有效性及主要条款

### 2.2 股东会/董事会决议
核查历次股东会、董事会决议的合法性

### 2.3 高级管理人员
核查高管人员的任职资格、竞业限制等

## 第三章 重大资产
### 3.1 房产及土地
核查不动产权属、租赁情况

### 3.2 知识产权
核查专利、商标、著作权等知识产权状况

### 3.3 其他重大资产
核查车辆、设备等其他重大资产

## 第四章 重大合同
### 4.1 股权投资/收购协议
核查重大投资或收购协议

### 4.2 借款及担保合同
核查借款、担保合同及风险

### 4.3 重大业务合同
核查与主营业务相关的重大合同

## 第五章 劳动人事
### 5.1 劳动合同
核查劳动合同签订及执行情况

### 5.2 社会保险及公积金
核查社保及公积金缴纳情况

### 5.3 劳动争议
核查现有及潜在劳动争议

## 第六章 税务合规
### 6.1 税务登记
核查税务登记及纳税主体资格

### 6.2 各项税种
核查各项税种的申报及缴纳情况

### 6.3 税收优惠
核查享受的税收优惠政策

## 第七章 诉讼、仲裁及行政处罚
### 7.1 诉讼及仲裁
核查现有及潜在诉讼、仲裁案件

### 7.2 行政处罚
核查行政处罚情况

## 第八章 合规经营
### 8.1 行业资质
核查经营所需的各类资质许可

### 8.2 环境保护
核查环保合规情况

### 8.3 其他合规事项
核查其他法律法规合规情况
`;
