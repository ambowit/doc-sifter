import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[ai-mapping] ${step}${detailsStr}`);
};

interface FileInfo {
  id: string;
  name: string;
  fileType: string;
  storagePath: string;
  downloadUrl?: string;
  content?: string;
}

interface ChapterInfo {
  id: string;
  title: string;
  level: number;
  description: string;
  number?: string;
}

interface MappingRequest {
  projectId: string;
  files: FileInfo[];
  chapters: ChapterInfo[];
}

interface MappingSuggestion {
  fileId: string;
  fileName: string;
  chapterId: string;
  chapterTitle: string;
  confidence: number;
  reason: string;
  excerpt: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 200 });
  }

  try {
    const { projectId, files, chapters } = await req.json() as MappingRequest;
    logStep("Received mapping request", { 
      projectId, 
      fileCount: files?.length, 
      chapterCount: chapters?.length 
    });

    if (!files?.length || !chapters?.length) {
      throw new Error("Files and chapters are required");
    }

    const apiKey = Deno.env.get("OOOK_AI_GATEWAY_TOKEN");
    if (!apiKey) {
      throw new Error("OOOK_AI_GATEWAY_TOKEN is not configured");
    }

    // Build chapter list for AI context with more detail
    const chapterList = chapters.map(ch => 
      `- ID: "${ch.id}" | 编号: ${ch.number || "无"} | 标题: ${ch.title} | 描述: ${ch.description || "无描述"}`
    ).join("\n");

    // Build detailed file list for AI context
    const fileList = files.map(f => {
      const hasContent = f.content && f.content.length > 50;
      return `- ID: "${f.id}" | 文件名: ${f.name} | 类型: ${f.fileType}${hasContent ? ` | 内容摘要: ${f.content!.substring(0, 300)}...` : ""}`;
    }).join("\n");

    const systemPrompt = `你是一个专业的法律尽调文件分析专家。你的任务是根据文件名称和类型，将尽调文件智能映射到对应的报告章节。

## 重要说明
由于技术限制，你只能获取文件名和类型信息，无法读取文件内容。请根据文件名中的关键词进行智能匹配。

## 文件名关键词映射规则（非常重要！）

### 公司基本情况/公司设立
- 营业执照、工商登记、企业信息、公司章程、设立文件、股东出资、验资报告

### 股权结构/股东
- 股权、股东、出资、持股、股权转让、股东名册、股权结构

### 公司治理/董事会
- 章程、董事会、股东会、监事会、决议、议事规则、高管任命

### 重大资产/房产土地
- 房产证、不动产、土地、租赁合同、房屋、产权

### 知识产权
- 专利、商标、著作权、软著、版权、知识产权、专有技术、域名

### 重大合同
- 合同、协议、订单、采购、销售、服务协议、合作协议

### 劳动人事
- 劳动合同、员工、人事、社保、公积金、薪酬、考勤、入职

### 税务
- 税务、纳税、完税、税收、发票、税务登记

### 诉讼仲裁
- 诉讼、仲裁、判决、裁定、起诉、纠纷、案件

### 行政处罚/合规
- 处罚、罚款、整改、合规、监管、许可证、资质、备案

### 财务
- 财务报表、审计报告、资产负债、利润表、现金流、会计

## 返回格式要求
返回纯JSON数组，不要包含任何其他文字或markdown标记：
[
  {
    "fileId": "文件的ID（必须使用提供的原始ID）",
    "fileName": "文件名",
    "chapterId": "章节的ID（必须使用提供的原始ID）", 
    "chapterTitle": "章节标题",
    "confidence": 75,
    "reason": "基于文件名中的XX关键词匹配到该章节",
    "excerpt": "文件名分析"
  }
]

## 匹配要求
1. 每个文件至少尝试匹配一个章节（除非文件名完全无法判断类型）
2. 置信度：关键词完全匹配80-95分，部分匹配60-80分，推测匹配40-60分
3. 一个文件可以匹配多个章节
4. 必须使用提供的原始ID，不要自己生成ID`;

    const userPrompt = `请分析以下尽调文件名称，并将它们映射到对应的报告章节。

## 报告章节列表
${chapterList}

## 待映射文件列表
${fileList}

请仔细分析每个文件名中的关键词，返回映射建议的JSON数组。务必为尽可能多的文件找到匹配的章节。`;

    logStep("Calling OOOK AI Gateway for mapping", { capability: "ai.general_user_defined" });

    const response = await fetch("https://gateway.oook.cn/api/ai/execute", {
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
          temperature: 0.3,
          max_tokens: 8000,
        },
        constraints: { maxCost: 0.03 },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logStep("OOOK AI Gateway error", { status: response.status, error: errorText });
      throw new Error(`AI服务错误: ${response.status}`);
    }

    const aiResponse = await response.json();
    logStep("OOOK AI Gateway response received");

    // Handle OOOK Gateway response format
    const messageContent = aiResponse.result?.choices?.[0]?.message?.content || 
                          aiResponse.choices?.[0]?.message?.content ||
                          aiResponse.result?.content ||
                          aiResponse.content;
    if (!messageContent) {
      throw new Error("No content in AI response");
    }

    logStep("AI raw response", { contentLength: messageContent.length });

    // Extract JSON from the response - try multiple patterns
    let jsonStr = messageContent.trim();
    
    // Remove markdown code blocks if present
    const jsonMatch = messageContent.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }
    
    // Remove any leading/trailing text before/after the JSON array
    const arrayStart = jsonStr.indexOf("[");
    const arrayEnd = jsonStr.lastIndexOf("]");
    if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart) {
      jsonStr = jsonStr.substring(arrayStart, arrayEnd + 1);
    }

    // Try to parse as array
    let mappings: MappingSuggestion[] = [];
    try {
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed)) {
        mappings = parsed;
      } else if (parsed.mappings && Array.isArray(parsed.mappings)) {
        mappings = parsed.mappings;
      } else if (parsed.suggestions && Array.isArray(parsed.suggestions)) {
        mappings = parsed.suggestions;
      }
    } catch (parseError) {
      logStep("JSON parse error", { error: String(parseError), jsonStr: jsonStr.substring(0, 500) });
      
      // Try to fix common JSON issues
      try {
        // Remove trailing commas
        const fixedJson = jsonStr.replace(/,\s*]/g, "]").replace(/,\s*}/g, "}");
        const parsed = JSON.parse(fixedJson);
        mappings = Array.isArray(parsed) ? parsed : [];
      } catch {
        logStep("Failed to parse even with fixes");
      }
    }

    // Validate mappings - ensure IDs exist
    const validFileIds = new Set(files.map(f => f.id));
    const validChapterIds = new Set(chapters.map(c => c.id));
    
    const validatedMappings = mappings.filter(m => {
      const fileValid = validFileIds.has(m.fileId);
      const chapterValid = validChapterIds.has(m.chapterId);
      if (!fileValid || !chapterValid) {
        logStep("Invalid mapping filtered out", { 
          fileId: m.fileId, 
          chapterId: m.chapterId,
          fileValid,
          chapterValid 
        });
      }
      return fileValid && chapterValid;
    });

    logStep("Mapping complete", { 
      totalMappings: mappings.length,
      validMappings: validatedMappings.length 
    });

    return new Response(JSON.stringify({ 
      success: true,
      mappings: validatedMappings,
      processedFiles: files.length,
      processedChapters: chapters.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(JSON.stringify({ 
      success: false,
      error: errorMessage,
      mappings: [],
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
