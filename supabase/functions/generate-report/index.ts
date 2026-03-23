import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[generate-report] ${step}${detailsStr}`);
};

interface FileInfo {
  id: string;
  name: string;
  type: string;
  category: string;
  ocrText: string | null;
  textSummary: string | null;
}

interface ChapterInfo {
  id: string;
  title: string;
  number: string;
  level: number;
  description: string;
}

interface ChapterContent {
  id: string;
  title: string;
  number: string;
  content: string;
  findings: string[];
  issues: Array<{
    fact: string;
    risk: string;
    suggestion: string;
    severity: "high" | "medium" | "low";
  }>;
  sourceFiles: string[];
}

interface Shareholder {
  name: string;
  percentage: number;
  type: "individual" | "company" | "team";
  notes?: string;
}

interface DefinitionItem {
  name: string;
  shortName: string;
  description?: string;
}

interface ReportMetadata {
  equityStructure: {
    companyName: string;
    shareholders: Shareholder[];
    notes: string[];
  };
  definitions: DefinitionItem[];
}

// Helper function to call AI API with shorter timeout
async function callAI(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  timeoutMs: number = 120000
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
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
        constraints: { maxCost: 0.05 },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI服务错误: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    // Handle OOOK Gateway response format
    return result.result?.choices?.[0]?.message?.content ||
      result.choices?.[0]?.message?.content ||
      result.result?.content ||
      result.content || "";
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error("AI_TIMEOUT");
    }
    throw error;
  }
}

// Parse JSON from AI response
function parseAIResponse(content: string): ChapterContent[] {
  let jsonStr = content.trim();

  // Remove markdown code block if present
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  // Find array boundaries
  const arrayStart = jsonStr.indexOf("[");
  const arrayEnd = jsonStr.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd !== -1) {
    jsonStr = jsonStr.substring(arrayStart, arrayEnd + 1);
  }

  const sections = JSON.parse(jsonStr);

  return sections.map((s: ChapterContent) => ({
    id: s.id || "",
    title: s.title || "",
    number: s.number || "",
    content: s.content || "",
    findings: Array.isArray(s.findings) ? s.findings : [],
    issues: Array.isArray(s.issues) ? s.issues : [],
    sourceFiles: Array.isArray(s.sourceFiles) ? s.sourceFiles : [],
  }));
}

// Categorize file by name for better AI understanding
function categorizeFile(fileName: string): string {
  const name = fileName.toLowerCase();

  if (name.includes("营业执照") || name.includes("工商")) return "公司基本信息";
  if (name.includes("章程")) return "公司治理";
  if (name.includes("股权") || name.includes("股东") || name.includes("出资")) return "股权结构";
  if (name.includes("董事") || name.includes("监事") || name.includes("高管")) return "公司治理";
  if (name.includes("劳动") || name.includes("社保") || name.includes("员工")) return "劳动人事";
  if (name.includes("专利") || name.includes("商标") || name.includes("著作权")) return "知识产权";
  if (name.includes("合同") || name.includes("协议")) return "重大合同";
  if (name.includes("财务") || name.includes("审计") || name.includes("报表")) return "财务";
  if (name.includes("税") || name.includes("发票")) return "税务";
  if (name.includes("房产") || name.includes("土地") || name.includes("租赁")) return "资产";
  if (name.includes("诉讼") || name.includes("仲裁") || name.includes("处罚")) return "诉讼与行政处罚";
  if (name.includes("资质") || name.includes("许可") || name.includes("备案")) return "资质证照";
  if (name.includes("环保") || name.includes("环境")) return "环保";
  if (name.includes("投资") || name.includes("融资")) return "投融资";

  return "其他";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      projectId,
      mode = "batch",  // "batch" | "analyze" | "metadata" | "single"
      batchIndex = 0,
      totalBatches = 1,
      previousSections = [],
      // For single mode retry
      chapterId = "",
      chapterTitle = "",
      chapterNumber = "",
    } = await req.json();

    logStep("Starting report generation", { projectId, mode, batchIndex, totalBatches, chapterId });

    if (!projectId) {
      return new Response(
        JSON.stringify({ error: "Project ID is required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get project info
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .single();

    if (projectError || !project) {
      logStep("Project not found", { projectError });
      return new Response(
        JSON.stringify({ error: "Project not found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 }
      );
    }

    // Get API key
    const apiKey = Deno.env.get("OOOK_AI_GATEWAY_TOKEN");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "OOOK_AI_GATEWAY_TOKEN not configured" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    // ============ FETCH ALL FILES (No mapping required!) ============
    // Get all files for this project with OCR content
    const { data: allFiles } = await supabase
      .from("files")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });

    // Get chapters structure (report template)
    const { data: chapters } = await supabase
      .from("chapters")
      .select("*")
      .eq("project_id", projectId)
      .order("order_index", { ascending: true });

    // Process files into structured format
    const processedFiles: FileInfo[] = (allFiles || []).map(f => ({
      id: f.id,
      name: f.original_name || f.name,
      type: f.file_type,
      category: categorizeFile(f.original_name || ""),
      ocrText: f.extracted_text || null,
      textSummary: f.text_summary || null,
    }));

    // Process chapters
    const processedChapters: ChapterInfo[] = (chapters || []).map(c => ({
      id: c.id,
      title: c.title,
      number: c.number || "",
      level: c.level || 1,
      description: c.description || "",
    }));

    logStep("Data fetched", {
      files: processedFiles.length,
      filesWithOcr: processedFiles.filter(f => f.ocrText).length,
      chapters: processedChapters.length
    });

    // ============ BUILD ALL FILES CONTENT SUMMARY ============
    // This is the key change: we provide ALL files to AI for intelligent matching
    // OPTIMIZED: Reduced content per file to prevent timeout with large file counts
    const buildFilesContentSummary = (maxLength: number = 50000): string => {
      let summary = "";
      let currentLength = 0;

      // Sort files by category for better organization
      const sortedFiles = [...processedFiles].sort((a, b) =>
        a.category.localeCompare(b.category)
      );

      // Dynamically adjust per-file limit based on file count
      // More files = less content per file to stay within timeout
      const fileCount = sortedFiles.filter(f => f.ocrText || f.textSummary).length;
      const perFileLimit = fileCount > 50 ? 1000 : fileCount > 30 ? 1500 : 2500;

      for (const file of sortedFiles) {
        if (currentLength >= maxLength) break;

        const hasContent = file.ocrText || file.textSummary;
        const content = file.textSummary || file.ocrText || "";
        const truncatedContent = content.substring(0, perFileLimit);

        const fileBlock = `
=== 文件：${file.name} ===
分类：${file.category}
${hasContent ? `内容：\n${truncatedContent}${content.length > perFileLimit ? "\n[内容已截断...]" : ""}` : "（无提取内容）"}
---
`;

        if (currentLength + fileBlock.length <= maxLength) {
          summary += fileBlock;
          currentLength += fileBlock.length;
        }
      }

      return summary;
    };

    // ============ METADATA MODE ============
    if (mode === "metadata") {
      logStep("Metadata mode: extracting equity and definitions from all files");

      const systemPrompt = `你是中国顶级PE/VC投资法律尽职调查合伙人。
你的任务是从数据室文件中精确提取股权结构和定义表信息，用于生成专业的投资尽调报告。

=====================================================
一、股权结构提取规则（投资视角）
=====================================================

1. **数据来源优先级**：
   - 工商登记信息/企业信用报告（最高优先）
   - 营业执照
   - 公司章程（注意区分认缴与实缴）
   - 股权转让协议、增资协议
   - 验资报告、出资证明

2. **必须提取的字段**：
   - 股东名称：完整法定名称
   - 持股比例：精确到小数点后两位
   - 股东类型：individual/company/team
   - 认缴出资额（万元）
   - 实缴出资额（万元）
   - 出资方式：货币/实物/知识产权
   - 备注：代持关系、实际出资方、身份信息

3. **投资风险点标注**：
   - 未实缴注册资本：在notes中标注「注册XX万元未实缴，影响运营资金/股东绑定/未来股改」
   - 代持关系：明确名义股东和实际出资方，标注是否已签署代持协议
   - 股权变更历史：如有多次变更，在notes中简要说明

=====================================================
二、定义表（释义）提取规则
=====================================================

1. **报告类定义**（必含）：
   - 本法律尽职调查报告 → 本报告
   - 本次法律尽职调查 → 本次尽调

2. **主体类定义**（从文件提取）：
   - 目标公司全称 → 目标公司或公司
   - 委托方/投资方全称 → 委托方/投资方
   - 各股东全称 → 简称
   - 关联公司全称 → 简称
   - 子公司/参股公司 → 简称

3. **法规类定义**（常用）：
   - 《中华人民共和国公司法》 → 《公司法》
   - 《中华人民共和国劳动合同法》 → 《劳动合同法》

=====================================================
三、输出JSON格式
=====================================================

{
  "equityStructure": {
    "companyName": "目标公司工商登记全称",
    "registeredCapital": "注册资本XX万元",
    "paidInCapital": "实缴XX万元",
    "shareholders": [
      {
        "name": "股东全称",
        "percentage": 60.00,
        "type": "individual",
        "subscribedCapital": 300,
        "paidInCapital": 300,
        "contributionMethod": "货币",
        "notes": "创始人、执行董事，已实缴"
      },
      {
        "name": "某持股平台（有限合伙）",
        "percentage": 10.00,
        "type": "team",
        "subscribedCapital": 50,
        "paidInCapital": 0,
        "contributionMethod": "货币",
        "notes": "员工持股平台，代持生产管理团队/技术团队，未签署代持协议"
      }
    ],
    "notes": [
      "1. 上述股权结构根据[文件名]核查确认",
      "2. 截至XXXX年XX月XX日工商登记信息",
      "3. 注册资本XX万元中，已实缴XX万元，未实缴XX万元",
      "4. 存在代持关系：XX代持XX，已签署/未签署代持协议"
    ]
  },
  "definitions": [
    {"name": "本法律尽职调查报告", "shortName": "本报告"},
    {"name": "[目标公司全称]", "shortName": "目标公司或公司"},
    {"name": "[委托方/投资方全称]", "shortName": "委托方或投资方"},
    {"name": "[股东1全称]", "shortName": "[简称]"}
  ]
}

直接输出JSON，禁止输出任何说明文字。`;

      // Build content from all files
      const allFilesContent = buildFilesContentSummary(30000);

      const fileListByCategory = processedFiles.reduce((acc, f) => {
        if (!acc[f.category]) acc[f.category] = [];
        acc[f.category].push(f.name);
        return acc;
      }, {} as Record<string, string[]>);

      const fileListSummary = Object.entries(fileListByCategory)
        .map(([cat, files]) => `【${cat}】\n${files.map(f => `  - ${f}`).join("\n")}`)
        .join("\n\n");

      const userPrompt = `## 项目信息
- 项目名称：${project.name}
- 目标公司：${project.target || "未提供"}
- 委托方：${project.client || "未提供"}

## 数据室文件清单（共${processedFiles.length}份文件）

${fileListSummary}

## 文件内容（OCR提取）

${allFilesContent}

## 任务

请从以上所有文件内容中提取：
1. **股权结构图数据** - 从文件中找出股东名称和持股比例
2. **定义表数据** - 提取项目涉及的公司、人员的全称和简称

直接输出JSON，无需其他说明。`;

      try {
        const aiContent = await callAI(apiKey, systemPrompt, userPrompt, 30000);
        logStep("Metadata AI response", { length: aiContent.length });

        // Parse response
        let metadata: ReportMetadata;
        try {
          let jsonStr = aiContent.trim();
          const jsonMatch = aiContent.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (jsonMatch) jsonStr = jsonMatch[1].trim();

          const jsonStart = jsonStr.indexOf("{");
          const jsonEnd = jsonStr.lastIndexOf("}");
          if (jsonStart !== -1 && jsonEnd !== -1) {
            jsonStr = jsonStr.substring(jsonStart, jsonEnd + 1);
          }

          metadata = JSON.parse(jsonStr);
        } catch {
          // Generate fallback metadata
          metadata = {
            equityStructure: {
              companyName: project.target || project.name || "目标公司",
              shareholders: [],
              notes: ["股权结构信息待从文件中提取"]
            },
            definitions: [
              { name: "本法律尽职调查报告", shortName: "本报告" },
              { name: project.target || "目标公司", shortName: "目标公司或公司" },
              { name: project.client || "委托方", shortName: "委托方" }
            ]
          };
        }

        return new Response(
          JSON.stringify({ success: true, mode: "metadata", metadata }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      } catch (error) {
        logStep("Metadata extraction error", { error: String(error) });
        return new Response(
          JSON.stringify({
            success: true,
            mode: "metadata",
            metadata: {
              equityStructure: {
                companyName: project.target || project.name || "目标公司",
                shareholders: [],
                notes: ["股权信息待核实"]
              },
              definitions: []
            }
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }
    }

    // ============ ANALYZE MODE ============
    if (mode === "analyze") {
      logStep("Analyze mode: consolidating", { sectionsCount: previousSections.length });

      const totalIssues = previousSections.reduce((acc: number, s: ChapterContent) => acc + (s.issues?.length || 0), 0);
      const highRiskCount = previousSections.reduce((acc: number, s: ChapterContent) =>
        acc + (s.issues?.filter((i: { severity: string }) => i.severity === "high").length || 0), 0);
      const mediumRiskCount = previousSections.reduce((acc: number, s: ChapterContent) =>
        acc + (s.issues?.filter((i: { severity: string }) => i.severity === "medium").length || 0), 0);
      const lowRiskCount = previousSections.reduce((acc: number, s: ChapterContent) =>
        acc + (s.issues?.filter((i: { severity: string }) => i.severity === "low").length || 0), 0);

      return new Response(
        JSON.stringify({
          success: true,
          mode: "analyze",
          summary: {
            totalIssues,
            highRiskCount,
            mediumRiskCount,
            lowRiskCount,
            keyFindings: [`共生成${previousSections.length}个章节`, `发现${totalIssues}个法律问题`]
          },
          sections: previousSections
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // ============ SINGLE MODE - RETRY ONE CHAPTER ============
    if (mode === "single") {
      logStep("Single mode: regenerating one chapter", { chapterId, chapterTitle });

      if (!chapterTitle) {
        return new Response(
          JSON.stringify({ error: "Chapter title is required for single mode" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
        );
      }

      // Build file content summary (with smaller limit for single chapter)
      const filesWithContent = processedFiles.filter(f => f.ocrText || f.textSummary).length;
      const contentMaxLength = filesWithContent > 50 ? 20000 : filesWithContent > 30 ? 25000 : 30000;
      const allFilesContent = buildFilesContentSummary(contentMaxLength);

      const singleChapterPrompt = `你是中国顶级PE/VC投资法律尽职调查合伙人。

## 任务
根据数据室文件，为章节「${chapterTitle}」生成报告内容。

## 章节信息
- 标题：${chapterTitle}
- 编号：${chapterNumber || ""}

## 核心要求

1. **内容要求**：
   - 财务章节：必须生成「资产负债表」「利润表」，包含具体数字
   - 公司治理章节：必须生成「组织架构表」「董事监事高管信息表」
   - 股权章节：必须生成「股权结构表」含认缴/实缴
   - 劳动人事章节：必须生成「核心人员信息表」
   - 合同章节：必须生成「重大合同清单表」
   - 知识产权章节：必须生成「专利/商标清单表」

2. **表格格式**：使用Markdown表格，示例：
| 项目 | 金额（万元） | 占比 |
|------|----------|------|
| 总资产 | 1,234.56 | 100% |

3. **文件引用**：sourceFiles必须列出引用的数据室文件名称

## 数据室文件
${allFilesContent}

## 输出格式
请直接输出纯 JSON，不要包含\`\`\`json标记。

**重要：issues数组必须包含完整内容，每个issue的fact/risk/suggestion字段必须有实际内容！**

示例格式：
{
  "title": "${chapterTitle}",
  "number": "${chapterNumber || ""}",
  "content": "报告正文内容（使用Markdown表格展示数据）",
  "findings": ["核查发现的事实1", "核查发现的事实2"],
  "issues": [
    {
      "fact": "经核查，目标公司注册资本1000万元，实缴资本仅100万元",
      "risk": "存在注册资本未实缴风险，影响公司运营资金及股东责任认定",
      "suggestion": "建议在交割前要求股东完成实缴，或在投资协议中设置实缴安排条款",
      "severity": "medium"
    },
    {
      "fact": "经核查，公司高管信息未在工商登记中更新",
      "risk": "存在工商登记与实际管理层不符的合规风险",
      "suggestion": "建议在交割前完成工商变更登记",
      "severity": "low"
    }
  ],
  "sourceFiles": ["营业执照.pdf", "公司章程.pdf"]
}

## 重要提醒（必须遵守）
1. **必须至少输出1-3个issues**，分析该章节可能存在的法律风险
2. issues中每个问题的fact、risk、suggestion字段都必须填写具体内容，**严禁留空**
3. fact必须以"经核查，"开头，描述具体发现的事实
4. risk必须描述该事实带来的法律风险和潜在影响
5. suggestion必须给出具体的投资保障建议
6. 如果文件内容不足，应在issues中标注"建议补充XX资料以进一步核查"
7. 如无相关文件，在content中说明"尚未获取相关资料"，但仍需在issues中提示需要补充哪些资料`;

      try {
        const aiResponse = await callAI(apiKey, singleChapterPrompt, "请生成章节内容，必须包含表格", 90000); // 90秒超时
        logStep("Single chapter AI response", { length: aiResponse.length });

        // Parse response - improved to handle nested JSON
        let section: ChapterContent;
        try {
          let jsonStr = aiResponse.trim();

          // Remove markdown code blocks if present
          const jsonMatch = aiResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (jsonMatch) jsonStr = jsonMatch[1].trim();

          // Extract JSON object
          const objStart = jsonStr.indexOf("{");
          const objEnd = jsonStr.lastIndexOf("}");
          if (objStart !== -1 && objEnd !== -1) {
            jsonStr = jsonStr.substring(objStart, objEnd + 1);
          }

          let parsed = JSON.parse(jsonStr);

          // Handle nested JSON case: if content itself is JSON string
          if (typeof parsed.content === "string" && parsed.content.startsWith("{")) {
            try {
              const nested = JSON.parse(parsed.content);
              if (nested.content) parsed = nested;
            } catch {
              // Not nested JSON, use as is
            }
          }

          // Normalize issues to ensure all fields exist
          let normalizedIssues = Array.isArray(parsed.issues)
            ? parsed.issues.map((issue: Record<string, unknown>) => ({
              fact: String(issue.fact || issue.事实 || issue.description || ""),
              risk: String(issue.risk || issue.风险 || issue.问题 || issue.problem || ""),
              suggestion: String(issue.suggestion || issue.建议 || issue.advice || issue.recommendation || ""),
              severity: (issue.severity || issue.级别 || issue.level || "low") as "high" | "medium" | "low",
            })).filter((issue: { fact: string; risk: string; suggestion: string }) =>
              issue.fact || issue.risk || issue.suggestion
            )
            : [];

          // Add default issue if none found
          if (normalizedIssues.length === 0) {
            normalizedIssues = [{
              fact: `经核查，尚未获取到「${chapterTitle}」相关的完整资料`,
              risk: "存在核查不完整的风险，可能遗漏重要法律问题",
              suggestion: "建议补充提供相关资料以便进一步核查",
              severity: "low" as const
            }];
          }

          section = {
            id: chapterId,
            title: parsed.title || chapterTitle,
            number: parsed.number || chapterNumber,
            content: parsed.content || `【${chapterTitle}】内容待生成`,
            findings: Array.isArray(parsed.findings) ? parsed.findings : [],
            issues: normalizedIssues,
            sourceFiles: Array.isArray(parsed.sourceFiles) ? parsed.sourceFiles : [],
          };

          // Try to extract sourceFiles from content if empty
          if (section.sourceFiles.length === 0) {
            const fileMatches = allFilesContent.match(/=== 文件：(.+?) ===/g);
            if (fileMatches) {
              const availableFiles = fileMatches.map(m => m.replace(/=== 文件：(.+?) ===/, "$1"));
              // Find files mentioned in content
              section.sourceFiles = availableFiles.filter(f =>
                section.content.toLowerCase().includes(f.toLowerCase().replace(/\.[^.]+$/, ""))
              ).slice(0, 5);
            }
          }
        } catch (parseErr) {
          logStep("Failed to parse single chapter response", { parseErr, responsePreview: aiResponse.substring(0, 500) });
          // Return successfully parsed section even on parse error
          section = {
            id: chapterId,
            title: chapterTitle,
            number: chapterNumber,
            content: `【${chapterTitle}】\n\n${aiResponse.substring(0, 2000)}\n\n（AI返回格式异常，已显示原始内容）`,
            findings: [],
            issues: [{
              fact: "经核查，AI返回格式异常，无法解析报告内容",
              risk: "存在报告生成异常的风险",
              suggestion: "建议重新生成该章节",
              severity: "low"
            }],
            sourceFiles: [],
          };
        }

        return new Response(
          JSON.stringify({ success: true, mode: "single", section }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      } catch (aiError) {
        const errorMsg = aiError instanceof Error ? aiError.message : String(aiError);
        logStep("Single chapter AI error", { errorMsg });

        // Even on error, return a section with error message so UI can display it
        const errorSection: ChapterContent = {
          id: chapterId,
          title: chapterTitle,
          number: chapterNumber,
          content: errorMsg.includes("AI_TIMEOUT")
            ? `【${chapterTitle}】\n\nAI生成超时，请重试。\n\n数据室共有${processedFiles.length}份文件可供分析。`
            : `【${chapterTitle}】\n\nAI生成失败: ${errorMsg}\n\n请稍后重试。`,
          findings: [],
          issues: [{
            fact: `经核查，${errorMsg.includes("AI_TIMEOUT") ? "AI生成超时" : "AI生成失败"}`,
            risk: "存在报告生成异常的风险",
            suggestion: "建议重新生成该章节",
            severity: "low"
          }],
          sourceFiles: [],
        };

        return new Response(
          JSON.stringify({
            success: true, // Return success so frontend can update UI
            mode: "single",
            section: errorSection,
            warning: errorMsg.includes("AI_TIMEOUT") ? "生成超时" : errorMsg,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }
    }

    // ============ BATCH MODE - AUTO INTELLIGENT MATCHING ============
    // The key change: AI reads ALL files and intelligently decides which to use for each chapter

    const CHAPTERS_PER_BATCH = 4; // Increased for faster generation
    const calculatedTotalBatches = Math.ceil(processedChapters.length / CHAPTERS_PER_BATCH);
    const actualTotalBatches = totalBatches || calculatedTotalBatches;

    // Get chapters for this batch
    const startIdx = batchIndex * CHAPTERS_PER_BATCH;
    const endIdx = Math.min(startIdx + CHAPTERS_PER_BATCH, processedChapters.length);
    const targetChapters = processedChapters.slice(startIdx, endIdx);

    if (targetChapters.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          mode: "batch",
          batchIndex,
          sections: [],
          totalChapters: processedChapters.length,
          batchChapters: 0,
          message: "No chapters in this batch"
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    logStep("Batch mode - Auto matching", {
      batchIndex,
      totalBatches: actualTotalBatches,
      chaptersInBatch: targetChapters.length,
      totalFiles: processedFiles.length,
      filesWithContent: processedFiles.filter(f => f.ocrText).length
    });

    // Build comprehensive file content for AI to analyze
    // OPTIMIZED: Reduced max length for large file counts to prevent timeout
    const filesWithContent = processedFiles.filter(f => f.ocrText || f.textSummary).length;
    const contentMaxLength = filesWithContent > 50 ? 25000 : filesWithContent > 30 ? 32000 : 40000;
    const allFilesContent = buildFilesContentSummary(contentMaxLength);

    logStep("Content optimization", {
      filesWithContent,
      contentMaxLength,
      actualContentLength: allFilesContent.length
    });

    // Build file list summary by category
    const fileListByCategory = processedFiles.reduce((acc, f) => {
      if (!acc[f.category]) acc[f.category] = [];
      acc[f.category].push({ name: f.name, hasContent: !!(f.ocrText || f.textSummary) });
      return acc;
    }, {} as Record<string, Array<{ name: string, hasContent: boolean }>>);

    const fileListSummary = Object.entries(fileListByCategory)
      .map(([cat, files]) =>
        `【${cat}】（${files.length}份）\n${files.map(f => `  - ${f.name}${f.hasContent ? " ✓" : ""}`).join("\n")}`
      )
      .join("\n\n");

    // Build chapter list for this batch with IDs
    const chapterList = targetChapters.map(c =>
      `- ID:${c.id} | ${c.number || ""} ${c.title}${c.description ? `（${c.description}）` : ""}`
    ).join("\n");

    // Professional Investment-Oriented Legal DD Report Generation Prompt
    const systemPrompt = `你是一名中国顶级PE/VC投资法律尽职调查合伙人，专为投资方出具正式《法律尽职调查报告》。

=====================================================
一、报告定位与核心原则
=====================================================

1. **投资场景导向**：报告为投资方决策服务，重点揭示投资风险、交易条款设计建议及投后管理要点
2. **事实来源封闭**：所有事实必须来自数据室文件，严禁推测或编造
3. **法律语言规范**：使用正式法律用语，如“经核查……”、“根据……我们注意到……”
4. **缺失数据处理**：明确标注“尚未获取相关资料”或“建议在交割前补充检索”
5. **引用规范**：每项核查必须标注来源文件名称

=====================================================
二、深度风险挖掘要求（必须覆盖）
=====================================================

**资本与股权类**：
- 注册资本实缴情况：检查是否存在未实缴或抽逃，分析对运营资金、股东绑定及未来股改上市的影响
- 代持关系清理：检查是否存在未签署协议的代持，提示IPO前必须清理的合规要求
- 股权变更历史：检查历次股权变更的定价依据、税务处理是否合规

**关键人员类**（重点核查）：
- 兼职审批：如关键人员为高校/国企在职人员，是否取得校外兼职审批
- 禁止兼任：检查监事是��兼任董事/高管或实际经营管理者（违反《公司法》）
- 体外持股/任职：详细排查关键人员在关联公司或竞争对手的持股、任职情况，评估精力分散及利益输送风险
- 同业竞争：排查关键人员是否涉及竞争业务

**知识产权类**：
- 核心专利/商标权属：检查是否由目标公司直接持有，还是��关联方/个人持有
- 转让/授权安排：如由外部持有，是否已签署转让/授权协议，费用如何
- 职务发明：如依赖高校/研究所设备，检查发明权属风险

**业务资质类**：
- 必要资质清单：根据业务列明所需资质（如医疗器械注册证、康复辅具资质等）
- 资质缺失风险：无资质经营的行政处罚风险、申请周期影响

**重大合同类**：
- 合同履行情况：检查是否存在未履约、违约风险
- 重大合同清单：列明合同方、金额、履约状态
- 关联交易：检查关联交易的公允性和合规性

**内部治理类**：
- 制度完备性：检查财务制度、关联交易制度、股东会议事规则等是否完备
- ESOP情况：检查是否已搭建员工持股平台、激励计划

**财务与税务类**：
- 具体财务数据：如有财务文件，提取资产、负债、净利润等关键指标
- 税务合规：检查纳税申报、税收优惠合规性

**其他重要事项**：
- 历史融资情况：检查历史融资轮次、估值、投资方权利安排
- 对外投资情况：检查子公司、参股公司
- 实际经营场所：检查是否有自有/租赁办公场所，是否依赖外部资源

=====================================================
三、投资保障建议格式（核心差异化）
=====================================================

所有问题的建议必须关联交易文件设计，包括：

1. **交割条件**：将知识产权转移、资质申请、代持清理等设为交割前置条件
2. **业务里程碑**：设定团队组建、产品研发进度等里程碑，未达标触发收购权利
3. **交割后义务**：要求关键人员注销体外公司、取得高校兼职审批
4. **投资方特殊权利**：对大额关联交易的一票否决权、信息知情权、财务监督权
5. **退出保障**：回购条款、拖带权、反稀释条款

=====================================================
四、内容详实度要求（极重要）
=====================================================

**必须生成的表格**（根据章节主题）：

1. **财务类章节**：必须生成：
   - 「资产负债表」：总资产、流动资产、固定资产、总负债、所有者权益
   - 「利润表」：营业收入、营业成本、毛利、净利润

2. **公司治理章节**：必须生成：
   - 「组织架构表」：部门设置、职能
   - 「董事监事高管信息表」：姓名、职务、任期、其他任职

3. **股权类章节**：必须生成：
   - 「股权结构表」：股东名称、持股比例、认缴额、实缴额、出资方式

4. **劳动人事章节**：必须生成：
   - 「核心人员信息表」：姓名、职务、入职日期、体外持股/任职
   - 「社保缴纳情况表」：年份、缴纳人数、缴纳情况

5. **合同章节**：必须生成：
   - 「重大合同清单」：合同名称、合同方、金额、签署日期、履约状态

6. **知识产权章节**：必须生成：
   - 「专利清单」：专利号、名称、类型、申请日、授权日、状态
   - 「商标清单」：商标号、名称、类别、有效期

**表格格式**：使用Markdown表格，示例：
| 项目 | 金额（万元） | 占比 |
|------|----------|------|
| 总资产 | 1,234.56 | 100% |
| 流动资产 | 800.00 | 64.8% |

**内容长度**：每章节1000-2000字，具体事实与分析并重

=====================================================
五、输出JSON格式
=====================================================

[
  {
    "id": "使用章节清单中提供的精确ID",
    "title": "章节标题",
    "number": "章节编号",
    "content": "详细章节正文（800-1500字，包含具体数据和表格）",
    "findings": ["核查发现1", "核查发现2", "核查发现3"],
    "issues": [
      {
        "fact": "经核查，目标公司注册资本1000万元，截至2024年12月31日实缴资本仅300万元",
        "risk": "存在注册资本未足额实缴的法律风险，根据《公司法》规定，股东应按期足额缴纳出资，未实缴部分可能影响公司运营资金及后续融资估值",
        "suggestion": "建议在交割前将实缴安排作为前置条件，或在投资协议中设置股东补缴义务及违约责任条款",
        "severity": "medium"
      },
      {
        "fact": "经核查，公司监事王某同时担任公司总经理职务",
        "risk": "根据《公司法》第五十一条规定，监事不得兼任公司的董事、高级管理人员，存在公司治理合规风险",
        "suggestion": "建议交割前完成监事变更登记，由非高管人员担任监事职务",
        "severity": "high"
      }
    ],
    "sourceFiles": ["引用的文件名称"]
  }
]

## 风险等级定义
- **high**：可能导致交易终止或重大不利影响（如核心资产权属缺陷、重大违法违规）
- **medium**：需通过交易条款解决（如代持清理、资质申请）
- **low**：合规缺陷，需完善但不影响交易（如制度不完善）

## 重要提醒（必须遵守）
1. **每个章节必须至少包含1-3个issues**，除非该章节确实没有任何法律风险
2. **issues中的fact、risk、suggestion字段必须填写完整具体的内容**，严禁留空
3. fact必须以"经核查，"开头，描述具体发现的事实
4. risk必须描述该事实带来的法律风险和潜在影响
5. suggestion必须给出具体的投资保障建议
6. 如果文件内容不足以分析风险，应在issues中标注"建议补充XX资料以进一步核查"

直接输出JSON数组，禁止输出任何说明文字。`;

    const userPrompt = `## 项目信息
- 项目名称：${project.name}
- 目标公司：${project.target || "（待明确）"}
- 委托方：${project.client || "（待明确）"}
- 报告日期：${new Date().toISOString().split('T')[0]}

## 本批次章节（共${targetChapters.length}个）
${chapterList}

## 数据室文件清单（共${processedFiles.length}份）
${fileListSummary}

## 文件内容
${allFilesContent}

## 任务
为上述${targetChapters.length}个章节生成法律尽调报告。智能匹配相关文件，使用专业法律表述，识别风险并评级。直接输出JSON数组：`;

    logStep("Calling AI API for auto-matching...", {
      chapters: targetChapters.length,
      totalFilesProvided: processedFiles.length
    });

    try {
      const aiContent = await callAI(apiKey, systemPrompt, userPrompt, 50000); // 50s timeout to stay within Edge Function limits
      logStep("AI response received", { length: aiContent.length });

      let sections: ChapterContent[] = [];
      try {
        const rawSections = parseAIResponse(aiContent);

        // Build flexible matching: exact title, normalized title, or contains
        const findMatchingChapter = (rawTitle: string) => {
          const normalizedRaw = rawTitle?.trim().replace(/\s+/g, "").toLowerCase() || "";

          for (const chapter of targetChapters) {
            const normalizedDb = chapter.title.trim().replace(/\s+/g, "").toLowerCase();
            // Exact match or normalized match or contains
            if (chapter.title.trim() === rawTitle?.trim() ||
              normalizedDb === normalizedRaw ||
              normalizedRaw.includes(normalizedDb) ||
              normalizedDb.includes(normalizedRaw)) {
              return chapter;
            }
          }
          return null;
        };

        const processedIds = new Set<string>();

        for (const rawSection of rawSections) {
          const matchedChapter = findMatchingChapter(rawSection.title || "");
          if (matchedChapter && !processedIds.has(matchedChapter.id)) {
            processedIds.add(matchedChapter.id);

            // Normalize issues to ensure all fields exist
            let normalizedIssues = Array.isArray(rawSection.issues)
              ? rawSection.issues.map((issue: Record<string, unknown>) => ({
                fact: String(issue.fact || issue.事实 || issue.description || ""),
                risk: String(issue.risk || issue.风险 || issue.问题 || issue.problem || ""),
                suggestion: String(issue.suggestion || issue.建议 || issue.advice || issue.recommendation || ""),
                severity: (issue.severity || issue.级别 || issue.level || "low") as "high" | "medium" | "low",
              })).filter((issue: { fact: string; risk: string; suggestion: string }) =>
                issue.fact || issue.risk || issue.suggestion
              )
              : [];

            // Add default issue if none found
            if (normalizedIssues.length === 0) {
              normalizedIssues = [{
                fact: `经核查，尚未获取到「${matchedChapter.title}」相关的完整资料`,
                risk: "存在核查不完整的风险，可能遗漏重要法律问题",
                suggestion: "建议补充提供相关资料以便进一步核查",
                severity: "low" as const
              }];
            }

            // Use database title and number, keep AI-generated content
            sections.push({
              id: matchedChapter.id,
              title: matchedChapter.title,  // Use DB title, not AI title
              number: matchedChapter.number || "",
              content: rawSection.content || "",
              findings: rawSection.findings || [],
              issues: normalizedIssues,
              sourceFiles: rawSection.sourceFiles || [],
            });
          }
        }

        // Add fallback for missing chapters
        for (const chapter of targetChapters) {
          if (!processedIds.has(chapter.id)) {
            sections.push({
              id: chapter.id,
              title: chapter.title,
              number: chapter.number || "",
              content: `【${chapter.title}】\n\nAI未能生成此章节内容，请检查是否有相关文件。`,
              findings: ["待核查"],
              issues: [{
                fact: `经核查，尚未获取到「${chapter.title}」相关的完整资料`,
                risk: "存在核查不完整的风险",
                suggestion: "建议补充提供相关资料",
                severity: "low"
              }],
              sourceFiles: [],
            });
          }
        }
      } catch (parseErr) {
        logStep("Parse error, creating fallback", { error: String(parseErr) });
        // Fallback: create basic sections
        sections = targetChapters.map(c => ({
          id: c.id,
          title: c.title,
          number: c.number || "",
          content: `【${c.title}】\n\nAI生成失败，请重试。\n\n数据室共有${processedFiles.length}份文件可供分析。`,
          findings: ["生成失败，待重试"],
          issues: [{
            fact: "经核查，AI生成失败",
            risk: "存在报告生成异常的风险",
            suggestion: "建议重新生成该章节",
            severity: "low"
          }],
          sourceFiles: [],
        }));
      }

      logStep("Batch complete", { count: sections.length });

      return new Response(
        JSON.stringify({
          success: true,
          mode: "batch",
          batchIndex,
          totalBatches: actualTotalBatches,
          sections,
          totalChapters: processedChapters.length,
          batchChapters: targetChapters.length,
          totalFilesAnalyzed: processedFiles.length
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );

    } catch (error) {
      if (error instanceof Error && error.message === "AI_TIMEOUT") {
        logStep("AI timeout, returning partial");
        const fallbackSections = targetChapters.map(c => ({
          id: c.id,
          title: c.title,
          number: c.number || "",
          content: `【${c.title}】\n\nAI生成超时，请重试。\n\n数据室共有${processedFiles.length}份文件可供分析。`,
          findings: ["生成超时"],
          issues: [{
            fact: "经核查，AI生成超时",
            risk: "存在报告生成异常的风险",
            suggestion: "建议重新生成该章节",
            severity: "low"
          }],
          sourceFiles: [],
        }));

        return new Response(
          JSON.stringify({
            success: true,
            mode: "batch",
            batchIndex,
            sections: fallbackSections,
            warning: "AI生成超时，请重试"
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }
      throw error;
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
