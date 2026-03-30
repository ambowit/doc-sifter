import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { decode as decodeBase64 } from "https://deno.land/std@0.190.0/encoding/base64.ts";
import { ZipReader, BlobReader, TextWriter } from "https://deno.land/x/zipjs@v2.7.32/index.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[parse] ${step}${detailsStr}`);
};

interface ParseRequest {
  type: "template" | "document" | "generate-structure";
  content?: string;
  filename?: string;
  projectType?: string;
  fileData?: string; // base64 encoded file data
  mimeType?: string;
}

interface ChapterStructure {
  number: string;
  title: string;
  level: number;
  description: string;
  children?: ChapterStructure[];
}

interface TocItem {
  number?: string;
  title?: string;
}

function isLikelyIncompleteStructuredContent(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return true;

  const withoutFence = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let braceDepth = 0;
  let bracketDepth = 0;
  let inString = false;
  let escaped = false;

  for (const char of withoutFence) {
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") braceDepth += 1;
    if (char === "}") braceDepth -= 1;
    if (char === "[") bracketDepth += 1;
    if (char === "]") bracketDepth -= 1;
  }

  return inString || braceDepth !== 0 || bracketDepth !== 0;
}

function decodeJsonString(value: string): string {
  return value
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\");
}

function extractStringField(source: string, key: string): string {
  const match = source.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "i"));
  return match ? decodeJsonString(match[1]) : "";
}

function extractNumberField(source: string, key: string): number | null {
  const match = source.match(new RegExp(`"${key}"\\s*:\\s*(\\d+)`, "i"));
  return match ? Number(match[1]) : null;
}

function findArraySegment(source: string, keys: string[]): string | null {
  for (const key of keys) {
    const match = new RegExp(`"${key}"\\s*:\\s*\\[`, "i").exec(source);
    if (!match) continue;

    const bracketStart = source.indexOf("[", match.index);
    if (bracketStart === -1) continue;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = bracketStart; index < source.length; index += 1) {
      const char = source[index];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (char === "[") depth += 1;
      if (char === "]") {
        depth -= 1;
        if (depth === 0) {
          return source.slice(bracketStart, index + 1);
        }
      }
    }

    return source.slice(bracketStart);
  }

  return null;
}

function extractTopLevelObjectSnippets(arraySegment: string): string[] {
  const snippets: string[] = [];
  let braceDepth = 0;
  let inString = false;
  let escaped = false;
  let objectStart = -1;

  for (let index = 0; index < arraySegment.length; index += 1) {
    const char = arraySegment[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") {
      if (braceDepth === 0) objectStart = index;
      braceDepth += 1;
    } else if (char === "}") {
      braceDepth -= 1;
      if (braceDepth === 0 && objectStart !== -1) {
        snippets.push(arraySegment.slice(objectStart, index + 1));
        objectStart = -1;
      }
    }
  }

  return snippets;
}

function normalizeChapterNode(input: unknown, fallbackLevel = 1): ChapterStructure | null {
  if (!input || typeof input !== "object") return null;

  const node = input as Record<string, unknown>;
  const title = typeof node.title === "string" ? node.title : "";
  const number = typeof node.number === "string" ? node.number : "";

  if (!title && !number) return null;

  const level = typeof node.level === "number" ? node.level : fallbackLevel;
  const description = typeof node.description === "string" ? node.description : "";
  const children = normalizeChapters(node.children, level + 1);

  return {
    number,
    title,
    level,
    description,
    children,
  };
}

function normalizeChapters(input: unknown, fallbackLevel = 1): ChapterStructure[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => normalizeChapterNode(item, fallbackLevel))
    .filter((item): item is ChapterStructure => Boolean(item));
}

function parseChapterSnippet(snippet: string, fallbackLevel = 1): ChapterStructure | null {
  const title = extractStringField(snippet, "title");
  const number = extractStringField(snippet, "number");

  if (!title && !number) return null;

  const level = extractNumberField(snippet, "level") ?? fallbackLevel;
  const description = extractStringField(snippet, "description");
  const childrenSegment = findArraySegment(snippet, ["children"]);
  const children = childrenSegment
    ? extractTopLevelObjectSnippets(childrenSegment)
        .map((childSnippet) => parseChapterSnippet(childSnippet, level + 1))
        .filter((item): item is ChapterStructure => Boolean(item))
    : [];

  return {
    number,
    title,
    level,
    description,
    children,
  };
}

function extractChaptersFromRawText(source: string): ChapterStructure[] {
  const arraySegment = findArraySegment(source, [
    "chapters",
    "table_of_contents",
    "tableOfContents",
    "outline",
    "sections",
  ]);

  if (!arraySegment) return [];

  return extractTopLevelObjectSnippets(arraySegment)
    .map((snippet) => parseChapterSnippet(snippet))
    .filter((item): item is ChapterStructure => Boolean(item));
}

function coerceChapters(parsedResult: Record<string, unknown>, rawSource?: string): ChapterStructure[] | null {
  const direct = normalizeChapters(parsedResult.chapters);
  if (direct.length > 0) return direct;

  const candidates = [
    parsedResult.table_of_contents,
    parsedResult.tableOfContents,
    parsedResult.outline,
    parsedResult.sections,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeChapters(candidate);
    if (normalized.length > 0) return normalized;
  }

  if (rawSource) {
    const extracted = extractChaptersFromRawText(rawSource);
    if (extracted.length > 0) return extracted;
  }

  return null;
}

// Extract text from DOCX file (which is a ZIP containing XML)
async function extractTextFromDocx(base64Data: string): Promise<string> {
  try {
    logStep("Extracting text from DOCX");
    
    // Decode base64 to bytes
    const bytes = decodeBase64(base64Data);
    const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    
    // Open as ZIP
    const zipReader = new ZipReader(new BlobReader(blob));
    const entries = await zipReader.getEntries();
    
    logStep("DOCX ZIP entries", { count: entries.length });
    
    // Find document.xml (main content)
    const documentEntry = entries.find(e => e.filename === "word/document.xml");
    if (!documentEntry) {
      logStep("document.xml not found in DOCX");
      await zipReader.close();
      return "";
    }
    
    // Extract text content
    const xmlContent = await documentEntry.getData!(new TextWriter());
    await zipReader.close();
    
    // Parse XML and extract text with better structure preservation
    let text = xmlContent
      // Add double newlines before paragraph tags to separate paragraphs clearly
      .replace(/<w:p[^>]*>/g, "\n\n")
      // Preserve tabs/indentation hints
      .replace(/<w:tab\/>/g, "\t")
      // Extract text content
      .replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, "$1")
      // Remove remaining XML tags
      .replace(/<[^>]+>/g, "")
      // Decode common XML entities
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      // Clean up excessive whitespace but preserve paragraph structure
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^\s+|\s+$/gm, "")
      .trim();
    
    logStep("DOCX text extracted", { length: text.length, preview: text.substring(0, 200) });
    return text;
  } catch (error) {
    logStep("DOCX extraction error", { error: String(error) });
    return "";
  }
}

// Extract text from PDF (basic approach - look for text streams)
async function extractTextFromPdf(base64Data: string): Promise<string> {
  try {
    logStep("Extracting text from PDF");
    
    // Decode base64 to string
    const bytes = decodeBase64(base64Data);
    const decoder = new TextDecoder("utf-8", { fatal: false });
    const pdfContent = decoder.decode(bytes);
    
    // PDF text extraction is complex - try to find text between BT/ET markers
    const textParts: string[] = [];
    
    // Look for text objects (between BT and ET)
    const btEtRegex = /BT\s*([\s\S]*?)\s*ET/g;
    let match;
    while ((match = btEtRegex.exec(pdfContent)) !== null) {
      const textBlock = match[1];
      // Extract text from Tj and TJ operators
      const tjRegex = /\(([^)]*)\)\s*Tj/g;
      let tjMatch;
      while ((tjMatch = tjRegex.exec(textBlock)) !== null) {
        textParts.push(tjMatch[1]);
      }
    }
    
    // Also try to find readable text directly
    const readableText = pdfContent
      .replace(/[^\x20-\x7E\u4E00-\u9FFF\u3000-\u303F\uFF00-\uFFEF\n\r]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    
    // Extract any Chinese text or chapter-like patterns
    const chinesePatterns = readableText.match(/[\u4E00-\u9FFF\u3000-\u303F]{2,}/g) || [];
    
    const extractedText = textParts.join(" ") + "\n" + chinesePatterns.join("\n");
    logStep("PDF text extracted", { length: extractedText.length, patterns: chinesePatterns.length });
    
    return extractedText.substring(0, 20000); // Limit length
  } catch (error) {
    logStep("PDF extraction error", { error: String(error) });
    return "";
  }
}

// Check if content is useful for parsing
function isContentUseful(content: string | undefined): boolean {
  if (!content) return false;
  
  const trimmed = content.trim();
  
  // Check for placeholder messages
  if (trimmed.includes("无法在浏览器中直接解析") || 
      trimmed.includes("[文件:")) {
    return false;
  }
  
  // Check minimum length (reduced from 50 to 20 to catch more content)
  if (trimmed.length < 20) {
    return false;
  }
  
  // Check if content has meaningful text (Chinese or alphanumeric)
  const hasChineseText = /[\u4E00-\u9FFF]/.test(trimmed);
  const hasAlphanumeric = /[a-zA-Z0-9]/.test(trimmed);
  
  return hasChineseText || hasAlphanumeric;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 200 });
  }

  try {
    const { type, content, filename, projectType, fileData, mimeType } = await req.json() as ParseRequest;
    logStep("Received request", { 
      type, 
      filename, 
      contentLength: content?.length, 
      projectType,
      hasFileData: !!fileData,
      fileDataLength: fileData?.length,
      mimeType,
    });

    const apiKey = Deno.env.get("OOOK_AI_GATEWAY_TOKEN");
    const gatewayUrl = Deno.env.get("OOOK_AI_GATEWAY_URL") || "https://gateway.oook.cn/";
    
    logStep("Environment check", { 
      hasApiKey: !!apiKey, 
      apiKeyLength: apiKey?.length,
      gatewayUrl,
      allEnvKeys: Object.keys(Deno.env.toObject()).filter(k => k.includes("OOOK") || k.includes("AI"))
    });
    
    if (!apiKey) {
      throw new Error("OOOK_AI_GATEWAY_TOKEN 未配置，请在 Supabase Dashboard > Edge Functions > Manage secrets 中添加");
    }

    let systemPrompt: string;
    let userPrompt: string;
    let actualContent = content || "";

    // If we have file data, try to extract text from it
    if (fileData && fileData.length > 0) {
      logStep("Processing file data", { 
        mimeType, 
        dataLength: fileData.length,
        filenameExt: filename?.split('.').pop(),
      });
      
      if (mimeType?.includes("word") || filename?.endsWith(".docx")) {
        logStep("Attempting DOCX extraction");
        actualContent = await extractTextFromDocx(fileData);
      } else if (mimeType?.includes("pdf") || filename?.endsWith(".pdf")) {
        logStep("Attempting PDF extraction");
        actualContent = await extractTextFromPdf(fileData);
      } else {
        logStep("Unknown file type, skipping extraction", { mimeType, filename });
      }
      
      logStep("File content extracted", { 
        extractedLength: actualContent.length,
        hasContent: actualContent.length > 0,
        contentPreview: actualContent.substring(0, 200),
      });
    } else {
      logStep("No file data provided, using content directly", { contentLength: content?.length });
    }

    if (type === "template" || type === "generate-structure") {
      const hasUsefulContent = isContentUseful(actualContent);
      logStep("Content analysis", { 
        hasUsefulContent, 
        contentLength: actualContent?.length,
        contentPreview: actualContent?.substring(0, 100),
      });

      // Lowered threshold from 100 to 50 to catch more extracted content
      if (hasUsefulContent && actualContent && actualContent.length > 50) {
        // Parse actual content from file
        systemPrompt = `你是一个专业的法律尽调报告分析专家。你的任务是从用户上传的尽调报告中**完整提取目录结构**。

## 重要：识别所有章节层级

### 一级章节（大章）标记模式：
- 中文数字编号："一、"、"二、"、"三、"..."十、" 等
- 阿拉伯数字："1."、"2."、"3." 或 "1、"、"2、"
- 第X章格式："第一章"、"第二章"
- 无编号的独立标题：如 "引言"、"定义"、"报告正文"、"股权结构图" 等

### 二级章节（子项）标记模式：
- "(一)"、"(二)"、"(三)" 等括号中文编号
- "1.1"、"1.2"、"2.1" 等层级编号
- "(1)"、"(2)"、"(3)" 等括号阿拉伯数字

## 输出要求
- **必须完整提取所有一级章节**，不要遗漏任何大章
- 如果文档有10个一级章节，输出必须有10个
- 保持原文档的编号和标题
- 如果章节有页码，忽略页码只提取标题

## JSON返回格式（必须是完整有效的JSON）
{
  "chapters": [
    {"number": "引言", "title": "引言", "level": 1, "description": "章节描述", "children": []},
    {"number": "一", "title": "主要法律问题总结", "level": 1, "description": "概述", "children": [
      {"number": "(一)", "title": "子章节", "level": 2, "description": "描述"}
    ]}
  ]
}

**重要**：description字段请保持简短（10字以内），确保JSON完整不被截断。`;

        userPrompt = `请**完整提取**以下法律尽调报告的目录结构${filename ? `（文件名：${filename}）` : ""}：

---
${actualContent.substring(0, 20000)}
---

${actualContent.length > 20000 ? "\n[内容已截断，共" + actualContent.length + "字符]" : ""}

## 要求
1. 找出文档中**所有的一级章节**（如：引言、定义、一、二、三...十 等）
2. 每个一级章节下找出其子章节
3. 保持原文档的编号格式
4. 不要遗漏任何章节

请以JSON格式返回完整的章节结构。`;
      } else {
        // Generate professional DD structure based on filename
        systemPrompt = `你是法律尽调报告专家。根据项目信息生成标准法律尽调报告章节结构，直接返回JSON，不要解释。

返回格式：{"chapters":[{"number":"1","title":"标题","level":1,"description":"核查要点","children":[{"number":"1.1","title":"子标题","level":2,"description":"要点"}]}]}

标准模块：公司基本情况、公司治理、重大资产、重大合同、劳动人事、税务合规、诉讼仲裁、合规经营。生成8个一级章节，每章2-3个子章节，description不超过20字。`;

        const contextInfo = [];
        if (filename) contextInfo.push(`文件名: ${filename}`);
        if (projectType) contextInfo.push(`项目类型: ${projectType}`);

        userPrompt = `请生成一份专业的法律尽职调查报告章节结构。

${contextInfo.length > 0 ? `## 项目背景\n${contextInfo.join("\n")}\n\n` : ""}请以JSON格式返回完整的章节结构，确保覆盖所有法律尽调核心领域。`;
      }
    } else {
      // Document parsing
      systemPrompt = `你是一个专业的法律尽调文件分析专家。你的任务是分析尽调文件内容，提取关键信息摘要。

返回格式：
{
  "summary": {
    "title": "文件标题",
    "type": "文件类型（合同/公司治理/财务/知识产权/人事/诉讼/其他）",
    "keyPoints": ["关键点1", "关键点2", "关键点3"],
    "relevantChapters": ["相关章节"],
    "confidence": 85
  }
}`;

      userPrompt = `请分析以下尽调文件${filename ? `（文件名：${filename}）` : ""}：

${actualContent || `[仅有文件名: ${filename}]`}

请以JSON格式返回分析结果。`;
    }

    // Build full URL - ensure no double slashes
    const fullUrl = gatewayUrl.endsWith('/') 
      ? `${gatewayUrl}api/ai/execute` 
      : `${gatewayUrl}/api/ai/execute`;
    
    logStep("Calling OOOK AI Gateway", { 
      fullUrl, 
      capability: "ai.general_user_defined",
      hasToken: !!apiKey,
      tokenPrefix: apiKey?.substring(0, 8) + "..."
    });

    // Add timeout controller - Supabase Edge Functions support up to 150s
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    let response;
    try {
      response = await fetch(fullUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
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
          constraints: { maxCost: 0.05 },
        }),
        signal: controller.signal,
      });
    } catch (fetchError) {
      clearTimeout(timeoutId);
      const errMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
      logStep("Fetch error", { error: errMsg });
      if (errMsg.includes("abort")) {
        throw new Error("AI服务请求超时，请稍后重试");
      }
      throw new Error(`AI服务网络错误: ${errMsg}`);
    }
    clearTimeout(timeoutId);

    logStep("Response received", { status: response.status, ok: response.ok });

    if (!response.ok) {
      const errorText = await response.text();
      logStep("OOOK AI Gateway error", { status: response.status, error: errorText });
      
      // Provide user-friendly error messages based on status code
      if (response.status === 402) {
        throw new Error("AI服务额度不足，请联系管理员充值或稍后重试");
      } else if (response.status === 401) {
        throw new Error("AI服务认证失败，请检查API密钥配置");
      } else if (response.status === 429) {
        throw new Error("AI服务请求过于频繁，请稍后重试");
      } else if (response.status >= 500) {
        throw new Error(`AI服务暂时不可用(${response.status})，请稍后重试`);
      }
      throw new Error(`AI服务错误: ${response.status} - ${errorText.substring(0, 200)}`);
    }

    const aiResponse = await response.json();
    logStep("OOOK AI Gateway full response", {
      response: aiResponse,
    });

    // Handle OOOK Gateway response format: { success: true, data: { content: "..." } }
    const messageContent = aiResponse.data?.content ||
                          aiResponse.result?.choices?.[0]?.message?.content || 
                          aiResponse.choices?.[0]?.message?.content ||
                          aiResponse.content;
    if (!messageContent) {
      logStep("No content found in response", { responseKeys: Object.keys(aiResponse) });
      throw new Error("No content in AI response");
    }

    if ((type === "template" || type === "generate-structure") && isLikelyIncompleteStructuredContent(messageContent)) {
      logStep("AI content appears incomplete", {
        contentLength: messageContent.length,
        contentTail: messageContent.slice(-500),
      });
      throw new Error("AI 返回的模板结构内容不完整，可能已被截断。请重试；如多次出现，请联系 AI Gateway 排查截断问题。");
    }

    // Extract JSON from the response (handle markdown code blocks)
    let jsonStr = messageContent.trim();
    
    // Try multiple patterns to extract JSON
    // Pattern 1: ```json ... ```
    let jsonMatch = jsonStr.match(/```json\s*([\s\S]*?)```/);
    if (jsonMatch && jsonMatch[1]) {
      jsonStr = jsonMatch[1].trim();
    } else {
      // Pattern 2: ``` ... ```
      jsonMatch = jsonStr.match(/```\s*([\s\S]*?)```/);
      if (jsonMatch && jsonMatch[1]) {
        jsonStr = jsonMatch[1].trim();
      } else {
        // Pattern 3: Find JSON object directly
        const jsonStartIndex = jsonStr.indexOf('{');
        const jsonEndIndex = jsonStr.lastIndexOf('}');
        if (jsonStartIndex !== -1 && jsonEndIndex !== -1 && jsonEndIndex > jsonStartIndex) {
          jsonStr = jsonStr.substring(jsonStartIndex, jsonEndIndex + 1);
        }
      }
    }
    
    logStep("Extracted JSON", { length: jsonStr.length, preview: jsonStr.substring(0, 100) });

    // Try to parse JSON, with repair attempts if it fails
    let parsedResult;
    try {
      parsedResult = JSON.parse(jsonStr);
    } catch (parseError) {
      logStep("JSON parse failed, attempting repair", { error: String(parseError) });
      
      // Try to repair common JSON issues
      let repairedJson = jsonStr;
      
      // Remove trailing commas before ] or }
      repairedJson = repairedJson.replace(/,\s*([\]\}])/g, '$1');
      // Add missing commas between adjacent objects
      repairedJson = repairedJson.replace(/\}\s*\{/g, "},{");
      
      // Check if JSON is truncated (missing closing brackets)
      const openBraces = (repairedJson.match(/\{/g) || []).length;
      const closeBraces = (repairedJson.match(/\}/g) || []).length;
      const openBrackets = (repairedJson.match(/\[/g) || []).length;
      const closeBrackets = (repairedJson.match(/\]/g) || []).length;

      if (openBrackets > closeBrackets || openBraces > closeBraces) {
        logStep("JSON appears truncated, attempting to close", {
          openBraces, closeBraces, openBrackets, closeBrackets
        });

        const lastArrayEnd = repairedJson.lastIndexOf("]");
        const lastObjectEnd = repairedJson.lastIndexOf("}");
        const cutIndex = Math.max(lastArrayEnd, lastObjectEnd);
        if (cutIndex > 0) {
          repairedJson = repairedJson.substring(0, cutIndex + 1);
        }

        const newOpenBrackets = (repairedJson.match(/\[/g) || []).length;
        const newCloseBrackets = (repairedJson.match(/\]/g) || []).length;
        const newOpenBraces = (repairedJson.match(/\{/g) || []).length;
        const newCloseBraces = (repairedJson.match(/\}/g) || []).length;

        for (let i = 0; i < newOpenBrackets - newCloseBrackets; i++) {
          repairedJson += "]";
        }
        for (let i = 0; i < newOpenBraces - newCloseBraces; i++) {
          repairedJson += "}";
        }
      }
      
      try {
        parsedResult = JSON.parse(repairedJson);
        logStep("JSON repaired successfully");
      } catch (repairError) {
        logStep("JSON repair failed", { error: String(repairError) });

        if (type === "template" || type === "generate-structure") {
          const extractedChapters = extractChaptersFromRawText(repairedJson);
          if (extractedChapters.length > 0) {
            parsedResult = { chapters: extractedChapters };
            logStep("Recovered chapters from raw text", { count: extractedChapters.length });
          } else {
            throw parseError;
          }
        } else {
          throw parseError; // Throw original error
        }
      }
    }
    
    const coercedChapters = coerceChapters(parsedResult as Record<string, unknown>, jsonStr);
    if (coercedChapters && coercedChapters.length > 0) {
      parsedResult.chapters = coercedChapters;
      logStep("Normalized chapters", { count: coercedChapters.length });
    }

    logStep("Parsing complete", { type, chaptersCount: parsedResult.chapters?.length });

    return new Response(JSON.stringify(parsedResult), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
