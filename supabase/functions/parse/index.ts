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
  
  // Check for placeholder messages
  if (content.includes("无法在浏览器中直接解析") || 
      content.includes("[文件:") ||
      content.trim().length < 50) {
    return false;
  }
  
  return true;
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

    const apiKey = Deno.env.get("SUPERUN_API_KEY");
    if (!apiKey) {
      throw new Error("SUPERUN_API_KEY is not configured");
    }

    let systemPrompt: string;
    let userPrompt: string;
    let actualContent = content || "";

    // If we have file data, try to extract text from it
    if (fileData && fileData.length > 0) {
      logStep("Processing file data", { mimeType, dataLength: fileData.length });
      
      if (mimeType?.includes("word") || filename?.endsWith(".docx")) {
        actualContent = await extractTextFromDocx(fileData);
      } else if (mimeType?.includes("pdf") || filename?.endsWith(".pdf")) {
        actualContent = await extractTextFromPdf(fileData);
      }
      
      logStep("File content extracted", { extractedLength: actualContent.length });
    }

    if (type === "template" || type === "generate-structure") {
      const hasUsefulContent = isContentUseful(actualContent);
      logStep("Content analysis", { 
        hasUsefulContent, 
        contentLength: actualContent?.length,
      });

      if (hasUsefulContent && actualContent && actualContent.length > 100) {
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
        systemPrompt = `你是一个专业的法律尽调报告专家，具有丰富的并购、投融资项目经验。

你需要根据提供的信息，生成一份专业、完整的法律尽职调查报告章节结构。

## 专业参考标准
法律尽调报告通常包含以下核心模块：
1. 公司基本情况（设立、沿革、股权结构、组织架构）
2. 公司治理（章程、三会运作、高管）
3. 重大资产（房产、土地、知识产权、设备）
4. 重大合同（投资协议、借款担保、业务合同）
5. 劳动人事（劳动合同、社保公积金、劳动争议）
6. 税务合规（税务登记、各税种、优惠政策）
7. 诉讼/仲裁/行政处罚
8. 合规经营（行业资质、环保、其他合规）

## 返回格式
{
  "chapters": [
    {
      "number": "1",
      "title": "章节标题",
      "level": 1,
      "description": "该章节需要核查的具体内容和要点",
      "children": [
        {
          "number": "1.1",
          "title": "子章节标题",
          "level": 2,
          "description": "子章节核查要点"
        }
      ]
    }
  ]
}

## 要求
- 生成8-10个一级章节
- 每个一级章节包含2-4个子章节
- description 必须具体说明该章节需要核查的内容要点
- 结构应专业、完整、符合行业标准`;

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

    logStep("Calling SuperunAI", { model: "gemini-2.5-flash" });

    const response = await fetch("https://gateway.superun.ai/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 16000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logStep("SuperunAI error", { status: response.status, error: errorText });
      throw new Error(`SuperunAI API error: ${response.status}`);
    }

    const aiResponse = await response.json();
    logStep("SuperunAI response received");

    const messageContent = aiResponse.choices?.[0]?.message?.content;
    if (!messageContent) {
      throw new Error("No content in AI response");
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
      
      // Check if JSON is truncated (missing closing brackets)
      const openBraces = (repairedJson.match(/\{/g) || []).length;
      const closeBraces = (repairedJson.match(/\}/g) || []).length;
      const openBrackets = (repairedJson.match(/\[/g) || []).length;
      const closeBrackets = (repairedJson.match(/\]/g) || []).length;
      
      // Add missing closing brackets
      if (openBrackets > closeBrackets || openBraces > closeBraces) {
        logStep("JSON appears truncated, attempting to close", {
          openBraces, closeBraces, openBrackets, closeBrackets
        });
        
        // Try to find a valid cutoff point (last complete object)
        // Look for the last complete chapter object
        const lastCompleteChapter = repairedJson.lastIndexOf('}');
        if (lastCompleteChapter > 0) {
          repairedJson = repairedJson.substring(0, lastCompleteChapter + 1);
          // Add closing brackets as needed
          const newOpenBrackets = (repairedJson.match(/\[/g) || []).length;
          const newCloseBrackets = (repairedJson.match(/\]/g) || []).length;
          const newOpenBraces = (repairedJson.match(/\{/g) || []).length;
          const newCloseBraces = (repairedJson.match(/\}/g) || []).length;
          
          for (let i = 0; i < newOpenBrackets - newCloseBrackets; i++) {
            repairedJson += ']';
          }
          for (let i = 0; i < newOpenBraces - newCloseBraces; i++) {
            repairedJson += '}';
          }
        }
      }
      
      try {
        parsedResult = JSON.parse(repairedJson);
        logStep("JSON repaired successfully");
      } catch (repairError) {
        logStep("JSON repair failed", { error: String(repairError) });
        throw parseError; // Throw original error
      }
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
