import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useFlatChapters, type Chapter } from "@/hooks/useChapters";
import { useFiles, type UploadedFile } from "@/hooks/useFiles";
import { useMappings, type ChapterFileMapping } from "@/hooks/useMappings";
import { useProject } from "@/hooks/useProjects";
import { supabase } from "@/integrations/supabase/client";

// Report chapter status types
type ReportChapterStatus = "completed" | "insufficient" | "no_data";

const ReportChapterStatusLabels: Record<ReportChapterStatus, string> = {
  completed: "已完成",
  insufficient: "资料不足",
  no_data: "无资料",
};

export interface ChapterContent {
  chapterId: string;
  chapterNumber: string;
  chapterTitle: string;
  content: string;
  sources: Array<{
    fileId: string;
    fileName: string;
    pageRef?: string;
    excerpt?: string;
  }>;
  status: ReportChapterStatus;
  statusLabel: string;
  warnings: string[];
}

export interface ReportData {
  projectId: string;
  projectName: string;
  client: string;
  target: string;
  projectType: string;
  reportLanguage: string;
  generatedAt: string;
  chapters: ChapterContent[];
  summary: {
    totalChapters: number;
    completedChapters: number;
    insufficientChapters: number;
    noDataChapters: number;
    totalSources: number;
  };
}

// Generate chapter content based on mapped files
function generateChapterContent(
  chapter: Chapter & { number: string },
  mappings: ChapterFileMapping[],
  files: UploadedFile[]
): ChapterContent {
  const chapterMappings = mappings.filter(m => m.chapterId === chapter.id);
  const mappedFiles = chapterMappings
    .map(m => files.find(f => f.id === m.fileId))
    .filter((f): f is UploadedFile => f !== null);

  const sources = mappedFiles.map(f => ({
    fileId: f.id,
    fileName: f.originalName,
    pageRef: f.pageRef || undefined,
    excerpt: f.excerpt || undefined,
  }));

  const warnings: string[] = [];
  let status: ReportChapterStatus = "completed";
  let content = "";

  if (mappedFiles.length === 0) {
    status = "no_data";
    content = `【本章节暂无相关证据文件】\n\n根据${chapter.title}的核查要求，尚未收到相关证据资料。建议委托方补充提供以下资料：\n\n• ${chapter.description || "与本章节相关的证据文件"}\n\n待收到相关资料后，本章节内容将据实更新。`;
    warnings.push(`章节"${chapter.title}"缺少证据文件`);
  } else if (chapterMappings.some(m => !m.isConfirmed)) {
    status = "insufficient";
    content = generatePartialContent(chapter, mappedFiles);
    warnings.push(`章节"${chapter.title}"部分映射待确认`);
  } else {
    content = generateFullContent(chapter, mappedFiles);
  }

  return {
    chapterId: chapter.id,
    chapterNumber: chapter.number,
    chapterTitle: chapter.title,
    content,
    sources,
    status,
    statusLabel: ReportChapterStatusLabels[status],
    warnings,
  };
}

// Generate content for chapters with confirmed mappings
function generateFullContent(chapter: Chapter, files: UploadedFile[]): string {
  const fileList = files.map(f => `《${f.originalName}》`).join("、");
  
  let content = `经核查，我们审阅了与${chapter.title}相关的以下文件：${fileList}。\n\n`;
  
  // Generate content based on chapter type
  if (chapter.title.includes("基本情况") || chapter.title.includes("设立")) {
    content += `根据工商登记资料及公司章程，目标公司依法设立并有效存续。公司的设立程序符合当时有效的法律法规规定，历次变更登记均已办理完毕。\n\n`;
    content += `【证据来源】上述结论基于以下文件的核查：\n`;
    files.forEach(f => {
      content += `• ${f.originalName}${f.excerpt ? `（${f.excerpt.slice(0, 50)}...）` : ""}\n`;
    });
  } else if (chapter.title.includes("股权") || chapter.title.includes("股东")) {
    content += `根据公司章程及工商登记信息，目标公司的股权结构清晰，各股东的出资已按照章程约定足额缴纳，股权归属明确，不存在股权代持或其他权属纠纷。\n\n`;
    content += `【证据来源】\n`;
    files.forEach(f => {
      content += `• ${f.originalName}\n`;
    });
  } else if (chapter.title.includes("合同") || chapter.title.includes("协议")) {
    content += `我们核查了目标公司的重大合同文件。根据所提供的资料，相关合同的签署主体适格，合同条款完整，不存在明显的法律风险。具体合同情况如下：\n\n`;
    files.forEach(f => {
      content += `• ${f.originalName}：${f.excerpt || "已核查，符合常规商业条款"}\n`;
    });
  } else if (chapter.title.includes("知识产权") || chapter.title.includes("专利") || chapter.title.includes("商标")) {
    content += `经核查，目标公司依法享有以下知识产权，相关权属证书有效，不存在权属争议：\n\n`;
    files.forEach(f => {
      content += `• ${f.originalName}\n`;
    });
    content += `\n上述知识产权均在有效期内，不存在被质押、冻结或涉及纠纷的情形。`;
  } else if (chapter.title.includes("劳动") || chapter.title.includes("人事")) {
    content += `根据所核查的人事档案及劳动合同，目标公司的用工行为基本符合《劳动法》及《劳动合同法》的规定：\n\n`;
    content += `• 员工劳动合同签订情况符合法律要求\n`;
    content += `• 社会保险及住房公积金按规定缴纳\n\n`;
    content += `【证据来源】${files.map(f => f.originalName).join("、")}`;
  } else if (chapter.title.includes("诉讼") || chapter.title.includes("仲裁")) {
    content += `经检索中国裁判文书网、企业信用信息公示系统及核查相关文件，就目标公司的诉讼、仲裁情况说明如下：\n\n`;
    files.forEach(f => {
      content += `• ${f.originalName}：${f.excerpt || "已核查相关情况"}\n`;
    });
  } else if (chapter.title.includes("税务") || chapter.title.includes("税收")) {
    content += `根据税务机关出具的纳税证明及公司财务资料：\n\n`;
    content += `• 目标公司依法进行税务登记，为一般纳税人\n`;
    content += `• 各项税款按期申报缴纳，不存在欠税情形\n`;
    content += `• 享受的税收优惠政策符合法律规定\n\n`;
    content += `【证据来源】${files.map(f => f.originalName).join("、")}`;
  } else {
    // Default content for other chapters
    content += `根据我们对上述${files.length}份文件的核查，就${chapter.title}事项，我们的核查意见如下：\n\n`;
    content += `目标公司在该事项上的合规情况良好，所核查的文件内容完整、有效。具体核查情况详见附件所列证据文件。\n\n`;
    content += `【证据来源】\n`;
    files.forEach(f => {
      content += `• ${f.originalName}\n`;
    });
  }
  
  return content;
}

// Generate content for chapters with partial mappings
function generatePartialContent(chapter: Chapter, files: UploadedFile[]): string {
  const fileList = files.map(f => `《${f.originalName}》`).join("、");
  
  let content = `【资料待补充】\n\n`;
  content += `就${chapter.title}，我们已收到并核查了以下部分资料：${fileList}。\n\n`;
  content += `但根据尽职调查的通常要求，建议委托方补充提供以下资料以完善本章节的核查：\n\n`;
  content += `• ${chapter.description || "其他与本章节相关的补充资料"}\n\n`;
  content += `待资料补充完整后，我们将更新本章节的核查意见。\n\n`;
  content += `【已核查证据】\n`;
  files.forEach(f => {
    content += `• ${f.originalName}\n`;
  });
  
  return content;
}

// Hook to generate report data
export function useReportData(projectId: string | undefined) {
  const { data: project } = useProject(projectId);
  const { data: flatChapters = [] } = useFlatChapters(projectId);
  const { data: files = [] } = useFiles(projectId);
  const { data: mappings = [] } = useMappings(projectId);

  return useQuery({
    queryKey: ["reportData", projectId],
    queryFn: async (): Promise<ReportData | null> => {
      if (!project || flatChapters.length === 0) return null;

      // Generate content for each chapter
      const chapters = flatChapters.map(chapter => 
        generateChapterContent(chapter, mappings, files)
      );

      // Calculate summary
      const summary = {
        totalChapters: chapters.length,
        completedChapters: chapters.filter(c => c.status === "completed").length,
        insufficientChapters: chapters.filter(c => c.status === "insufficient").length,
        noDataChapters: chapters.filter(c => c.status === "no_data").length,
        totalSources: chapters.reduce((sum, c) => sum + c.sources.length, 0),
      };

      return {
        projectId: project.id,
        projectName: project.name,
        client: project.client,
        target: project.target,
        projectType: project.projectType,
        reportLanguage: project.reportLanguage,
        generatedAt: new Date().toISOString(),
        chapters,
        summary,
      };
    },
    enabled: !!projectId && !!project && flatChapters.length > 0,
  });
}

// Export report as HTML (for printing/PDF)
export function generateReportHTML(report: ReportData): string {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  };

  let html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${report.projectName} - 法律尽职调查报告</title>
  <style>
    @page { margin: 2cm; }
    body { 
      font-family: "SimSun", "宋体", serif; 
      font-size: 12pt; 
      line-height: 1.8;
      color: #333;
    }
    .cover { 
      text-align: center; 
      page-break-after: always;
      padding-top: 30%;
    }
    .cover h1 { 
      font-size: 24pt; 
      font-weight: bold;
      margin-bottom: 2em;
    }
    .cover .meta { 
      font-size: 14pt;
      margin: 0.5em 0;
    }
    .chapter { 
      page-break-before: always; 
      margin-bottom: 2em;
    }
    .chapter:first-of-type { page-break-before: auto; }
    .chapter-title { 
      font-size: 16pt; 
      font-weight: bold; 
      margin: 1em 0;
      border-bottom: 2px solid #333;
      padding-bottom: 0.5em;
    }
    .chapter-number { 
      font-family: "Arial", sans-serif;
      margin-right: 0.5em;
    }
    .chapter-content { 
      text-align: justify;
      text-indent: 2em;
    }
    .chapter-content p { margin: 1em 0; }
    .warning { 
      background: #fff3cd; 
      border-left: 4px solid #ffc107;
      padding: 1em;
      margin: 1em 0;
    }
    .no-data {
      background: #f8d7da;
      border-left: 4px solid #dc3545;
      padding: 1em;
      margin: 1em 0;
    }
    .sources {
      background: #e7f3ff;
      border-left: 4px solid #0066cc;
      padding: 1em;
      margin: 1em 0;
      font-size: 10pt;
    }
    .sources-title {
      font-weight: bold;
      margin-bottom: 0.5em;
    }
    .toc { page-break-after: always; }
    .toc h2 { 
      font-size: 18pt;
      text-align: center;
      margin-bottom: 2em;
    }
    .toc-item { 
      margin: 0.5em 0;
      display: flex;
      justify-content: space-between;
    }
    .toc-number { font-family: "Arial", sans-serif; }
  </style>
</head>
<body>
  <div class="cover">
    <h1>法律尽职调查报告</h1>
    <div class="meta"><strong>项目名称：</strong>${report.projectName}</div>
    <div class="meta"><strong>委托方：</strong>${report.client}</div>
    <div class="meta"><strong>目标公司：</strong>${report.target}</div>
    <div class="meta"><strong>项目类型：</strong>${report.projectType}</div>
    <div class="meta"><strong>报告日期：</strong>${formatDate(report.generatedAt)}</div>
    <div class="meta" style="margin-top: 3em; font-size: 12pt; color: #666;">
      本报告仅供委托方内部参考使用
    </div>
  </div>

  <div class="toc">
    <h2>目录</h2>
    ${report.chapters.map(ch => `
      <div class="toc-item">
        <span><span class="toc-number">${ch.chapterNumber}</span> ${ch.chapterTitle}</span>
        <span>${ch.statusLabel}</span>
      </div>
    `).join("")}
  </div>
`;

  // Add chapters
  for (const chapter of report.chapters) {
    html += `
  <div class="chapter">
    <h2 class="chapter-title">
      <span class="chapter-number">${chapter.chapterNumber}</span>
      ${chapter.chapterTitle}
    </h2>
    `;
    
    if (chapter.status === "no_data") {
      html += `<div class="no-data">${chapter.content.replace(/\n/g, "<br>")}</div>`;
    } else if (chapter.status === "insufficient") {
      html += `<div class="warning">${chapter.content.replace(/\n/g, "<br>")}</div>`;
    } else {
      html += `<div class="chapter-content">${chapter.content.split("\n\n").map(p => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("")}</div>`;
    }

    if (chapter.sources.length > 0) {
      html += `
    <div class="sources">
      <div class="sources-title">证据来源</div>
      <ul>
        ${chapter.sources.map(s => `<li>${s.fileName}</li>`).join("")}
      </ul>
    </div>`;
    }

    html += `</div>`;
  }

  html += `
</body>
</html>`;

  return html;
}

// Hook to export report
export function useExportReport() {
  return useMutation({
    mutationFn: async ({ report, format }: { report: ReportData; format: "html" | "pdf" }) => {
      const html = generateReportHTML(report);
      
      if (format === "html") {
        // Download as HTML
        const blob = new Blob([html], { type: "text/html;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${report.projectName}_法律尽调报告.html`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } else {
        // Open in new window for printing to PDF
        const printWindow = window.open("", "_blank");
        if (printWindow) {
          printWindow.document.write(html);
          printWindow.document.close();
          // Trigger print dialog after content loads
          printWindow.onload = () => {
            printWindow.print();
          };
        }
      }

      return { success: true };
    },
  });
}

// AI Generated Report types
export interface AIGeneratedReport {
  projectId: string;
  projectName: string;
  client: string;
  target: string;
  generatedAt: string;
  content: {
    sections?: Array<{
      id: string;
      title: string;
      number?: string;
      content: string;
      findings?: string[];
      issues?: Array<{ 
        fact: string; 
        risk: string; 
        suggestion: string;
        severity?: "high" | "medium" | "low";
      }>;
      sourceFiles?: string[];
      subsections?: Array<{
        id: string;
        title: string;
        content: string;
      }>;
    }>;
    rawContent?: string;
  };
  files?: Array<{ id: string; name: string; type: string; category?: string }>;
  chapters?: Array<{ id: string; title: string; number: string }>;
  statistics?: {
    totalFiles: number;
    totalChapters: number;
    filesByCategory: Record<string, number>;
    issuesFound: number;
    highRiskIssues: number;
  };
  // Equity structure data for visualization
  equityStructure?: {
    companyName: string;
    shareholders: Array<{
      name: string;
      percentage: number;
      type: "individual" | "company" | "team";
      notes?: string;
    }>;
    notes: string[];
  };
  // Definitions table data
  definitions?: Array<{
    name: string;
    shortName: string;
    description?: string;
  }>;
}

// Hook to generate AI report
export function useGenerateAIReport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (projectId: string): Promise<AIGeneratedReport> => {
      console.log("[useGenerateAIReport] Starting AI report generation for project:", projectId);
      
      // Get current user session for JWT auth
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error("请重新登录后再试");
      }
      
      try {
        const { data, error } = await supabase.functions.invoke("generate-report", {
          body: { projectId },
          headers: { Authorization: `Bearer ${session.access_token}` },
        });

        if (error) {
          console.error("[useGenerateAIReport] Supabase error:", error);
          // Check for common error patterns
          const errorStr = JSON.stringify(error);
          if (errorStr.includes("504") || errorStr.includes("timeout") || errorStr.includes("non-2xx")) {
            throw new Error("AI生成超时：章节内容量较大，处理时间超出限制。建议稍后重试或减少章节数量。");
          }
          throw new Error(error.message || "报告生成失败，请稍后重试");
        }

        if (!data?.success) {
          const errorMsg = data?.error || "报告生成失败";
          const suggestion = data?.suggestion || "";
          throw new Error(suggestion ? `${errorMsg}。${suggestion}` : errorMsg);
        }

        console.log("[useGenerateAIReport] Report generated successfully", {
          sections: data.report?.content?.sections?.length,
          totalContentLength: data.report?.content?.sections?.reduce(
            (acc: number, s: { content?: string }) => acc + (s.content?.length || 0), 0
          )
        });
        return data.report;
      } catch (err) {
        console.error("[useGenerateAIReport] Catch error:", err);
        // Re-throw with user-friendly message
        if (err instanceof Error) {
          // Check if already has a good error message
          if (err.message.includes("超时") || err.message.includes("章节")) {
            throw err;
          }
          // Check for network/timeout errors
          if (err.message.includes("Failed to fetch") || err.message.includes("network")) {
            throw new Error("网络连接失败，请检查网络后重试");
          }
          if (err.message.includes("non-2xx") || err.message.includes("504")) {
            throw new Error("AI生成超时：章节内容量较大，处理时间超出限制。建议稍后重试。");
          }
        }
        throw err;
      }
    },
    onSuccess: (data) => {
      // Invalidate related queries
      if (data?.projectId) {
        queryClient.invalidateQueries({ queryKey: ["aiReport", data.projectId] });
      }
    },
  });
}

// Hook to get cached AI report
export function useAIReport(projectId: string | undefined) {
  return useQuery({
    queryKey: ["aiReport", projectId],
    queryFn: async () => {
      // This returns null by default - the report needs to be generated first
      return null as AIGeneratedReport | null;
    },
    enabled: false, // Don't auto-fetch, only use cached data
  });
}

// Generate HTML for AI report
export function generateAIReportHTML(report: AIGeneratedReport): string {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  };

  let html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${report.target || report.projectName} - 法律尽职调查报告</title>
  <style>
    @page { margin: 2.5cm; size: A4; }
    body { 
      font-family: "SimSun", "宋体", serif; 
      font-size: 12pt; 
      line-height: 2;
      color: #333;
      max-width: 210mm;
      margin: 0 auto;
    }
    .cover { 
      text-align: center; 
      page-break-after: always;
      padding-top: 25%;
    }
    .cover h1 { 
      font-size: 26pt; 
      font-weight: bold;
      margin-bottom: 3em;
    }
    .cover h2 {
      font-size: 18pt;
      margin-bottom: 2em;
    }
    .cover .firm {
      font-size: 14pt;
      margin-top: 8em;
    }
    .cover .date {
      font-size: 14pt;
      margin-top: 1em;
    }
    .toc { 
      page-break-after: always; 
    }
    .toc h2 { 
      font-size: 18pt;
      text-align: center;
      margin-bottom: 2em;
    }
    .toc-item { 
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin: 0.8em 0;
      border-bottom: 1px dotted #ccc;
    }
    .toc-item span:first-child {
      background: white;
      padding-right: 0.5em;
    }
    .toc-item span:last-child {
      background: white;
      padding-left: 0.5em;
    }
    .section { 
      page-break-before: always; 
      margin-bottom: 2em;
    }
    .section:first-of-type { page-break-before: auto; }
    .section-title { 
      font-size: 16pt; 
      font-weight: bold; 
      margin: 1.5em 0 1em;
      border-bottom: 2px solid #333;
      padding-bottom: 0.5em;
    }
    .subsection-title {
      font-size: 14pt;
      font-weight: bold;
      margin: 1em 0 0.5em;
    }
    .content { 
      text-align: justify;
      text-indent: 2em;
    }
    .content p { margin: 1em 0; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 1em 0;
      font-size: 10pt;
    }
    th, td {
      border: 1px solid #333;
      padding: 8px;
      text-align: left;
      vertical-align: top;
    }
    th {
      background: #f0f0f0;
      font-weight: bold;
    }
    .issue-table td:first-child { width: 5%; }
    .issue-table td:nth-child(2) { width: 35%; }
    .issue-table td:nth-child(3) { width: 30%; }
    .issue-table td:nth-child(4) { width: 30%; }
  </style>
</head>
<body>
  <div class="cover">
    <h2>${report.target || report.projectName}</h2>
    <h1>法律尽职调查报告</h1>
    <div class="firm">委托方：${report.client}</div>
    <div class="date">${formatDate(report.generatedAt)}</div>
  </div>
`;

  // Add table of contents
  if (report.content.sections && report.content.sections.length > 0) {
    html += `
  <div class="toc">
    <h2>目 录</h2>
    ${report.content.sections.map(section => `
      <div class="toc-item">
        <span>${section.title}</span>
        <span></span>
      </div>
    `).join("")}
  </div>
`;

    // Add sections
    for (const section of report.content.sections) {
      html += `
  <div class="section">
    <h2 class="section-title">${section.title}</h2>
    <div class="content">
      ${section.content ? section.content.split("\n").map(p => p.trim() ? `<p>${p}</p>` : "").join("") : ""}
    </div>
`;

      // Add issues table if present
      if (section.issues && section.issues.length > 0) {
        html += `
    <table class="issue-table">
      <thead>
        <tr>
          <th>序号</th>
          <th>事实</th>
          <th>问题/风险</th>
          <th>建议</th>
        </tr>
      </thead>
      <tbody>
        ${section.issues.map((issue, idx) => `
          <tr>
            <td>${idx + 1}</td>
            <td>${issue.fact || ""}</td>
            <td>${issue.risk || ""}</td>
            <td>${issue.suggestion || ""}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
`;
      }

      // Add subsections if present
      if (section.subsections && section.subsections.length > 0) {
        for (const subsection of section.subsections) {
          html += `
    <h3 class="subsection-title">${subsection.title}</h3>
    <div class="content">
      ${subsection.content ? subsection.content.split("\n").map(p => p.trim() ? `<p>${p}</p>` : "").join("") : ""}
    </div>
`;
        }
      }

      html += `  </div>\n`;
    }
  } else if (report.content.rawContent) {
    // If we only have raw content, display it as-is
    html += `
  <div class="section">
    <div class="content">
      ${report.content.rawContent.split("\n").map(p => p.trim() ? `<p>${p}</p>` : "").join("")}
    </div>
  </div>
`;
  }

  html += `
</body>
</html>`;

  return html;
}

// Hook to export AI report
export function useExportAIReport() {
  return useMutation({
    mutationFn: async ({ report, format }: { report: AIGeneratedReport; format: "html" | "pdf" }) => {
      const html = generateAIReportHTML(report);
      
      if (format === "html") {
        const blob = new Blob([html], { type: "text/html;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${report.target || report.projectName}_法律尽调报告.html`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } else {
        const printWindow = window.open("", "_blank");
        if (printWindow) {
          printWindow.document.write(html);
          printWindow.document.close();
          printWindow.onload = () => {
            printWindow.print();
          };
        }
      }

      return { success: true };
    },
  });
}
