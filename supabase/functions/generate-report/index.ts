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
    const gatewayUrl = (Deno.env.get("OOOK_AI_GATEWAY_URL") || "https://gateway.oook.cn").replace(/\/$/, "");
    const response = await fetch(`${gatewayUrl}/api/ai/execute`, {
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
    // 打印完整返回值便于调试
    logStep("AI raw response", result);
    // 兼容 OOOK Gateway 返回格式：data.content
    const content = result.data?.content ||
      result.result?.choices?.[0]?.message?.content ||
      result.choices?.[0]?.message?.content ||
      result.result?.content ||
      result.content || "";
    logStep("AI parsed content length", { length: content.length });
    return content;
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
    const buildFilesContentSummary = (maxLength: number = 50000, filesOverride?: typeof processedFiles): string => {
      let summary = "";
      let currentLength = 0;

      // 支持传入指定文件列表（用于章节关联文件筛选）
      const sortedFiles = [...(filesOverride ?? processedFiles)].sort((a, b) =>
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

      // 查询该章节已关联的文件 ID
      const { data: singleMappingRows, error: singleMappingError } = await supabase
        .from("chapter_file_mappings")
        .select("file_id")
        .eq("chapter_id", chapterId);

      // 数据库查询失败 → 生成失败，不走 AI
      if (singleMappingError) {
        logStep("Single mode: mapping query failed", { error: singleMappingError.message });
        return new Response(JSON.stringify({
          success: false,
          mode: "single",
          error: `无法获取章节关联文件：${singleMappingError.message}`,
          section: {
            id: chapterId,
            title: chapterTitle,
            number: chapterNumber || "",
            content: `【${chapterTitle}】\n\n生成失败：无法获取章节关联文件（${singleMappingError.message}）。`,
            findings: [],
            issues: [{
              fact: `经核查，章节「${chapterTitle}」关联文件查询失败`,
              risk: "报告生成异常",
              suggestion: "建议稍后重新生成该章节",
              severity: "low",
            }],
            sourceFiles: [],
          },
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const singleMappedFileIds = new Set((singleMappingRows || []).map((r: { file_id: string }) => r.file_id));

      // 无关联文件 → 跳过，不走 AI
      if (singleMappedFileIds.size === 0) {
        logStep("Single mode: no mapped files, skipping", { chapter: chapterTitle });
        return new Response(JSON.stringify({
          success: true,
          mode: "single",
          skipped: true,
          skipReason: "no_mapped_files",
          section: {
            id: chapterId,
            title: chapterTitle,
            number: chapterNumber || "",
            content: `【${chapterTitle}】\n\n该章节暂无关联文件，已跳过生成。请在文件映射页面为该章节关联相关文件后重新生成。`,
            findings: [],
            issues: [],
            sourceFiles: [],
          },
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // 只使用已关联的文件构建内容摘要
      const singleRelevantFiles = processedFiles.filter(f => f.id && singleMappedFileIds.has(f.id));
      const filesWithContent = singleRelevantFiles.filter(f => f.ocrText || f.textSummary).length;
      const contentMaxLength = filesWithContent > 50 ? 20000 : filesWithContent > 30 ? 25000 : 30000;
      const allFilesContent = buildFilesContentSummary(contentMaxLength, singleRelevantFiles);

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

    // ============ BATCH MODE - PER-CHAPTER GENERATION ============
    // 改为每次只生成 1 个章节，根据章节主题智能筛选相关文件，避免超时

    const CHAPTERS_PER_BATCH = 1; // 每批只处理 1 个章节，避免 AI 超时
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

    // 当前批次只有一个章节
    const currentChapter = targetChapters[0];

    logStep("Batch mode - Per-chapter generation", {
      batchIndex,
      totalBatches: actualTotalBatches,
      chapterTitle: currentChapter.title,
      totalFiles: processedFiles.length,
    });

    // 从数据库查询该章节已关联的文件 ID
    const { data: mappingRows, error: mappingError } = await supabase
      .from("chapter_file_mappings")
      .select("file_id")
      .eq("chapter_id", currentChapter.id);

    // 数据库查询失败 → 生成失败，不走 AI
    if (mappingError) {
      logStep("Chapter-file mapping query failed", { error: mappingError.message });
      return new Response(JSON.stringify({
        success: false,
        mode: "batch",
        batchIndex,
        sections: [{
          id: currentChapter.id,
          title: currentChapter.title,
          number: currentChapter.number || "",
          content: `【${currentChapter.title}】\n\n生成失败：无法获取章节关联文件（${mappingError.message}）。`,
          findings: [],
          issues: [{
            fact: `经核查，章节「${currentChapter.title}」关联文件查询失败`,
            risk: "报告生成异常",
            suggestion: "建议稍后重新生成该章节",
            severity: "low",
          }],
          sourceFiles: [],
        }],
        error: mappingError.message,
      }), { headers: { "Content-Type": "application/json" } });
    }

    const mappedFileIds = new Set((mappingRows || []).map((r: { file_id: string }) => r.file_id));

    // 无关联文件 → 跳过，不走 AI
    if (mappedFileIds.size === 0) {
      logStep("No mapped files for chapter, skipping", { chapter: currentChapter.title });
      return new Response(JSON.stringify({
        success: true,
        mode: "batch",
        batchIndex,
        skipped: true,
        skipReason: "no_mapped_files",
        sections: [{
          id: currentChapter.id,
          title: currentChapter.title,
          number: currentChapter.number || "",
          content: `【${currentChapter.title}】\n\n该章节暂无关联文件，已跳过生成。请在文件映射页���为该章节关联相关文件后重新生成。`,
          findings: [],
          issues: [],
          sourceFiles: [],
        }],
      }), { headers: { "Content-Type": "application/json" } });
    }

    // 只使用已关联的文件
    const relevantFiles = processedFiles.filter(f => f.id && mappedFileIds.has(f.id));

    logStep("Chapter-file matching via DB", {
      chapter: currentChapter.title,
      mappedFileIds: mappedFileIds.size,
      relevantFilesCount: relevantFiles.length,
      totalFilesCount: processedFiles.length,
    });

    // 构建只包含相关文件的内容摘要
    const buildChapterFilesContent = (files: FileInfo[], maxLength: number = 20000): string => {
      let summary = "";
      let currentLength = 0;
      const perFileLimit = files.length > 20 ? 1200 : files.length > 10 ? 1800 : 2500;

      for (const file of files) {
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

    const chapterFilesContent = buildChapterFilesContent(relevantFiles, 18000);

    // 构建相关文件清单
    const relevantFileList = relevantFiles
      .map(f => `  - ${f.name}${f.ocrText || f.textSummary ? " ✓" : ""}`)
      .join("\n");

    // 精简的单章节 Prompt，减少 token 数量
    const systemPrompt = `你是中国顶级PE/VC投资法律尽调合伙人。为章节「${currentChapter.title}」生成报告内容。

## 核心要求
1. 事实必须来自提供的文件，标注来源
2. 使用正式法律用语："经核查……"
3. 缺失资料标注"尚未获取"
4. 必须生成相关表格（Markdown格式）
5. 必须包含1-3个issues

## 输出JSON（直接输出，无需代码块）
{
  "id": "${currentChapter.id}",
  "title": "${currentChapter.title}",
  "number": "${currentChapter.number || ""}",
  "content": "章节正文（800-1500字，含表格）",
  "findings": ["发现1", "发现2"],
  "issues": [
    {"fact": "经核查，...", "risk": "存在...风险", "suggestion": "建议...", "severity": "medium"}
  ],
  "sourceFiles": ["文件名"]
}

## severity定义
- high: 重大风险，可能终止交易
- medium: 需通过条款解决
- low: 合规瑕疵`;

    const userPrompt = `## 项目：${project.name}
目标公司：${project.target || "待明确"} | 委托方：${project.client || "待明确"}

## 当前章节：${currentChapter.number || ""} ${currentChapter.title}
${currentChapter.description ? `描述：${currentChapter.description}` : ""}

## 相关文件（${relevantFiles.length}份）
${relevantFileList}

## 文件内容
${chapterFilesContent}

请为「${currentChapter.title}」生成报告内容，直接输出JSON：`;

    logStep("Calling AI for single chapter", {
      chapter: currentChapter.title,
      relevantFiles: relevantFiles.length,
      promptLength: systemPrompt.length + userPrompt.length,
    });

    try {
      const aiContent = await callAI(apiKey, systemPrompt, userPrompt, 120000); // 120秒超时
      logStep("AI response received", { length: aiContent.length, preview: aiContent.slice(0, 200) });

      // 解析单章节 JSON 响应
      let section: ChapterContent;
      try {
        let jsonStr = aiContent.trim();
        // 移除 markdown 代码块
        const jsonMatch = aiContent.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) jsonStr = jsonMatch[1].trim();
        // 提取 JSON 对象
        const objStart = jsonStr.indexOf("{");
        const objEnd = jsonStr.lastIndexOf("}");
        if (objStart !== -1 && objEnd !== -1) {
          jsonStr = jsonStr.substring(objStart, objEnd + 1);
        }

        const parsed = JSON.parse(jsonStr);

        // 规范化 issues
        let normalizedIssues = Array.isArray(parsed.issues)
          ? parsed.issues.map((issue: Record<string, unknown>) => ({
            fact: String(issue.fact || issue.事实 || ""),
            risk: String(issue.risk || issue.风险 || ""),
            suggestion: String(issue.suggestion || issue.建议 || ""),
            severity: (issue.severity || "low") as "high" | "medium" | "low",
          })).filter((i: { fact: string; risk: string; suggestion: string }) => i.fact || i.risk)
          : [];

        if (normalizedIssues.length === 0) {
          normalizedIssues = [{
            fact: `经核查，尚未获取到「${currentChapter.title}」相关的完整资料`,
            risk: "存在核查不完整的风险",
            suggestion: "建议补充提供相关资料",
            severity: "low" as const
          }];
        }

        section = {
          id: currentChapter.id,
          title: currentChapter.title,
          number: currentChapter.number || "",
          content: parsed.content || "",
          findings: Array.isArray(parsed.findings) ? parsed.findings : [],
          issues: normalizedIssues,
          sourceFiles: Array.isArray(parsed.sourceFiles) ? parsed.sourceFiles : [],
        };
      } catch (parseErr) {
        logStep("Parse error", { error: String(parseErr), preview: aiContent.slice(0, 300) });
        section = {
          id: currentChapter.id,
          title: currentChapter.title,
          number: currentChapter.number || "",
          content: `【${currentChapter.title}】\n\n${aiContent.slice(0, 1500)}\n\n（解析异常，显示原始内容）`,
          findings: [],
          issues: [{
            fact: "经核查，AI返回格式异常",
            risk: "报告生成异常",
            suggestion: "建议重新生成",
            severity: "low"
          }],
          sourceFiles: [],
        };
      }

      logStep("Chapter generated", { id: section.id, title: section.title });

      return new Response(
        JSON.stringify({
          success: true,
          mode: "batch",
          batchIndex,
          totalBatches: actualTotalBatches,
          sections: [section], // 返回数组保持兼容
          totalChapters: processedChapters.length,
          batchChapters: 1,
          relevantFilesCount: relevantFiles.length,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logStep("AI error", { error: errorMsg });

      const fallbackSection: ChapterContent = {
        id: currentChapter.id,
        title: currentChapter.title,
        number: currentChapter.number || "",
        content: errorMsg.includes("AI_TIMEOUT")
          ? `【${currentChapter.title}】\n\nAI生成超时：章节内容量较大，处理时间超出限制。建议稍后重试。\n\n相关文件：${relevantFiles.length}份`
          : `【${currentChapter.title}】\n\nAI生成失败: ${errorMsg}\n\n请稍后重试。`,
        findings: [],
        issues: [{
          fact: errorMsg.includes("AI_TIMEOUT") ? "经核查，AI生成超时" : "经核查，AI生成失败",
          risk: "报告生成异常",
          suggestion: "建议重新生成该章节",
          severity: "low"
        }],
        sourceFiles: [],
      };

      return new Response(
        JSON.stringify({
          success: true,
          mode: "batch",
          batchIndex,
          sections: [fallbackSection],
          warning: errorMsg.includes("AI_TIMEOUT") ? "AI生成超时" : errorMsg,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
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
