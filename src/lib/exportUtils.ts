import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  convertInchesToTwip,
} from "docx";
import { saveAs } from "file-saver";
import type { TemplateStyle } from "@/lib/templateStyles";

// Types
interface ReportSection {
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
  // sourceFiles 移除：证据来源由 chapter_file_mappings 驱动
  // 导出时需从外部传入关联文件列表
  mappedFiles?: Array<{ name: string; id: string }>;
}

interface ReportMetadata {
  equityStructure?: {
    companyName: string;
    shareholders: Array<{
      name: string;
      percentage: number;
      type: string;
      notes?: string;
    }>;
    notes: string[];
  };
  definitions?: Array<{
    name: string;
    shortName: string;
    description?: string;
  }>;
}

interface Definition {
  id: string;
  shortName: string;
  fullName: string;
  entityType: string;
}

interface Project {
  name: string;
  target?: string;
  client?: string;
}

function resolveTemplateColors(templateStyle?: TemplateStyle) {
  const primaryColor =
    templateStyle?.preview?.primaryColor ||
    templateStyle?.styles?.h1?.color ||
    "#111827";
  const accentColor =
    templateStyle?.preview?.accentColor ||
    templateStyle?.styles?.h2?.color ||
    "#374151";
  const fontFamily = templateStyle?.styles?.body?.font || "宋体";
  const headerFill = templateStyle?.tables?.default?.headerFill || "#f3f4f6";
  const borderColor = templateStyle?.tables?.default?.borderColor || "#d1d5db";
  return { primaryColor, accentColor, fontFamily, headerFill, borderColor };
}

// Helper to convert severity to Chinese
function severityToChinese(severity: string): string {
  switch (severity) {
    case "high":
      return "高";
    case "medium":
      return "中";
    case "low":
      return "低";
    default:
      return severity;
  }
}

function getSeverityColor(severity: string): string {
  switch (severity) {
    case "high":
      return "#ef4444";
    case "medium":
      return "#f59e0b";
    case "low":
      return "#22c55e";
    default:
      return "#6b7280";
  }
}

// Convert Markdown to HTML for PDF export
// 生成章节标题显示文本，避免无编号章节（number="" 或 number===title）重复显示
function sectionLabel(number: string | null | undefined, title: string): string {
  const n = (number || "").trim();
  return n && n !== title ? `${n} ${title}` : title;
}

function markdownToHTMLForPDF(markdown: string): string {
  let html = markdown;
  
  // Convert Markdown tables to HTML tables with styling
  const tableRegex = /\|(.+)\|\n\|[-:| ]+\|\n((?:\|.+\|\n?)+)/g;
  html = html.replace(tableRegex, (_, headerRow, bodyRows) => {
    const headers = headerRow.split("|").map((h: string) => h.trim()).filter(Boolean);
    const rows = bodyRows.trim().split("\n").map((row: string) => 
      row.split("|").map((c: string) => c.trim()).filter(Boolean)
    );
    
    return `<table style="width: 100%; border-collapse: collapse; font-size: 12px; margin: 16px 0;">
      <thead>
        <tr style="background: #f3f4f6;">
          ${headers.map((h: string) => `<th style="padding: 8px 12px; border: 1px solid #d1d5db; text-align: left; font-weight: 600;">${h}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${rows.map((cells: string[]) => `<tr>${cells.map((c: string) => `<td style="padding: 8px 12px; border: 1px solid #d1d5db;">${c}</td>`).join("")}</tr>`).join("")}
      </tbody>
    </table>`;
  });
  
  // Convert bold **text** to <strong>
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  
  // Convert italic *text* to <em>
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  
  // Convert headers
  html = html.replace(/^### (.+)$/gm, '<h4 style="font-size: 14px; font-weight: 600; margin: 16px 0 8px; color: #374151;">$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3 style="font-size: 15px; font-weight: 600; margin: 20px 0 10px; color: #1f2937;">$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2 style="font-size: 16px; font-weight: 700; margin: 24px 0 12px; color: #111827;">$1</h2>');
  
  // Convert unordered lists
  html = html.replace(/^- (.+)$/gm, '<li style="margin-bottom: 4px;">$1</li>');
  html = html.replace(/(<li.*<\/li>\n?)+/g, '<ul style="margin: 8px 0; padding-left: 20px;">$&</ul>');
  
  // Convert numbered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li style="margin-bottom: 4px;">$1</li>');
  
  // Convert paragraphs (lines not already converted)
  const lines = html.split("\n");
  html = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("<")) return line; // Already HTML
    return `<p style="margin-bottom: 12px;">${trimmed}</p>`;
  }).join("\n");
  
  return html;
}

// Generate HTML content for PDF with template style support
function generatePDFHTML(
  project: Project,
  sections: ReportSection[],
  metadata: ReportMetadata | null,
  definitions: Definition[],
  fileCount: number,
  templateStyle?: TemplateStyle
): string {
  const today = new Date().toLocaleDateString("zh-CN");
  const targetName = project.target || project.name;
  
  // Get style values from template or use defaults
  const { primaryColor, accentColor, fontFamily, headerFill, borderColor } =
    resolveTemplateColors(templateStyle);
  
  // Font family mapping
  const fontFamilyMap: Record<string, string> = {
    "宋体": '"SimSun", "宋体", serif',
    "黑体": '"SimHei", "黑体", sans-serif',
    "仿宋": '"FangSong", "仿宋", serif',
    "楷体": '"KaiTi", "楷体", serif',
    "微软雅黑": '"Microsoft YaHei", "微软雅黑", sans-serif',
    "Times New Roman": '"Times New Roman", Georgia, serif',
    "Arial": 'Arial, Helvetica, sans-serif',
  };
  const fontStack = fontFamilyMap[fontFamily] || fontFamilyMap["宋体"];
  
  let sectionsHTML = "";
  
  for (const section of sections) {
    let issuesHTML = "";
    if (section.issues && section.issues.length > 0) {
      issuesHTML = `
        <div style="margin-top: 16px;">
          <h4 style="font-size: 14px; font-weight: 600; margin-bottom: 8px; color: #374151;">发现的问题与风险</h4>
          <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
            <thead>
              <tr style="background: #f3f4f6;">
                <th style="padding: 8px; border: 1px solid #d1d5db; text-align: left; width: 5%;">序号</th>
                <th style="padding: 8px; border: 1px solid #d1d5db; text-align: left; width: 30%;">事实</th>
                <th style="padding: 8px; border: 1px solid #d1d5db; text-align: left; width: 25%;">问题/风险</th>
                <th style="padding: 8px; border: 1px solid #d1d5db; text-align: left; width: 30%;">建议</th>
                <th style="padding: 8px; border: 1px solid #d1d5db; text-align: center; width: 10%;">级别</th>
              </tr>
            </thead>
            <tbody>
              ${section.issues
                .map(
                  (issue, idx) => `
                <tr>
                  <td style="padding: 8px; border: 1px solid #d1d5db; vertical-align: top;">${idx + 1}</td>
                  <td style="padding: 8px; border: 1px solid #d1d5db; vertical-align: top;">${issue.fact}</td>
                  <td style="padding: 8px; border: 1px solid #d1d5db; vertical-align: top;">${issue.risk}</td>
                  <td style="padding: 8px; border: 1px solid #d1d5db; vertical-align: top;">${issue.suggestion}</td>
                  <td style="padding: 8px; border: 1px solid #d1d5db; text-align: center; vertical-align: top;">
                    <span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; color: white; background: ${getSeverityColor(issue.severity)};">
                      ${severityToChinese(issue.severity)}
                    </span>
                  </td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      `;
    }

    let findingsHTML = "";
    if (section.findings && section.findings.length > 0) {
      findingsHTML = `
        <div style="margin-top: 16px;">
          <h4 style="font-size: 14px; font-weight: 600; margin-bottom: 8px; color: #374151;">核查发现</h4>
          <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #4b5563;">
            ${section.findings.map((f) => `<li style="margin-bottom: 4px;">${f}</li>`).join("")}
          </ul>
        </div>
      `;
    }

    // 证据来源：从 mappedFiles 获取（由 chapter_file_mappings 驱动，外部传入）
    let mappedFilesHTML = "";
    if (section.mappedFiles && section.mappedFiles.length > 0) {
      mappedFilesHTML = `
        <div style="margin-top: 16px; padding: 8px 12px; background: #f9fafb; border-radius: 4px; font-size: 12px; color: #6b7280;">
          <strong>证据来源：</strong>${section.mappedFiles.map(f => f.name).join("、")}
        </div>
      `;
    }

    sectionsHTML += `
      <div style="page-break-inside: avoid; margin-bottom: 32px;">
        <h2 style="font-size: 18px; font-weight: 700; color: #111827; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb;">
          ${sectionLabel(section.number, section.title)}
        </h2>
        <div style="font-size: 13px; line-height: 1.8; color: #374151; text-align: justify;">
          ${markdownToHTMLForPDF(section.content)}
        </div>
        ${findingsHTML}
        ${issuesHTML}
        ${mappedFilesHTML}
      </div>
    `;
  }

  // Build equity structure section if available
  let equityStructureHTML = "";
  if (metadata?.equityStructure && metadata.equityStructure.shareholders && metadata.equityStructure.shareholders.length > 0) {
    const equity = metadata.equityStructure;
    const typeLabels: Record<string, string> = {
      individual: "自然人",
      company: "法人",
      team: "持股平台",
    };
    const typeColors: Record<string, string> = {
      individual: "#fef3c7",
      company: "#dbeafe",
      team: "#fce7f3",
    };
    
    // Generate visual equity chart HTML
    const shareholderBoxes = equity.shareholders.map((sh: { name: string; type: string; percentage: number | null; notes?: string }) => `
      <div style="display: flex; flex-direction: column; align-items: center; min-width: 100px;">
        <div style="border: 2px solid #374151; padding: 12px 16px; background: ${typeColors[sh.type] || "#f3f4f6"}; text-align: center; min-width: 100px; max-width: 150px;">
          <div style="font-size: 11px; color: #6b7280; margin-bottom: 2px;">${typeLabels[sh.type] || sh.type}</div>
          <div style="font-size: 13px; font-weight: 600; color: #111827;">${sh.name}</div>
          ${sh.notes ? `<div style="font-size: 10px; color: #6b7280; margin-top: 2px;">${sh.notes}</div>` : ""}
        </div>
        <div style="width: 2px; height: 30px; background: #374151; position: relative;">
          <span style="position: absolute; left: 8px; top: 50%; transform: translateY(-50%); font-size: 12px; font-weight: 600; white-space: nowrap;">
            ${sh.percentage !== null && sh.percentage !== undefined ? sh.percentage + "%" : "比例未披露"}
          </span>
        </div>
      </div>
    `).join("");

    const equityChartHTML = `
      <div style="margin-bottom: 24px; padding: 24px; border: 1px solid #e5e7eb; border-radius: 8px; background: #fafafa;">
        <h4 style="font-size: 14px; font-weight: 600; color: #374151; margin-bottom: 20px; text-align: center;">股权结构图</h4>
        
        <!-- Shareholders Row -->
        <div style="display: flex; justify-content: center; align-items: flex-end; gap: 24px; flex-wrap: wrap; margin-bottom: 8px;">
          ${shareholderBoxes}
        </div>
        
        <!-- Connecting Line -->
        <div style="display: flex; justify-content: center; margin-bottom: 8px;">
          <div style="width: ${Math.min(equity.shareholders.length * 140, 600)}px; height: 2px; background: #374151;"></div>
        </div>
        
        <!-- Arrow Down -->
        <div style="display: flex; justify-content: center; margin-bottom: 8px;">
          <div style="width: 2px; height: 20px; background: #374151; position: relative;">
            <div style="position: absolute; bottom: -6px; left: 50%; transform: translateX(-50%); width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; border-top: 8px solid #374151;"></div>
          </div>
        </div>
        
        <!-- Target Company -->
        <div style="display: flex; justify-content: center;">
          <div style="border: 3px solid #2563eb; padding: 16px 32px; background: #eff6ff; text-align: center;">
            <div style="font-size: 10px; color: #2563eb; margin-bottom: 2px;">目标公司</div>
            <div style="font-size: 16px; font-weight: 700; color: #1e40af;">${equity.companyName}</div>
          </div>
        </div>
      </div>
    `;
    
    equityStructureHTML = `
      <div style="margin-bottom: 32px; page-break-inside: avoid;">
        <h3 style="font-size: 16px; font-weight: 600; color: #111827; margin-bottom: 16px;">股权结构</h3>
        
        <!-- Visual Chart -->
        ${equityChartHTML}
        
        <!-- Data Table -->
        <div style="margin-bottom: 12px; font-size: 13px; color: #374151;">
          <strong>股东信息明细：</strong>
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 12px;">
          <thead>
            <tr style="background: #f3f4f6;">
              <th style="padding: 8px 12px; border: 1px solid #d1d5db; text-align: left; width: 10%;">序号</th>
              <th style="padding: 8px 12px; border: 1px solid #d1d5db; text-align: left; width: 35%;">股东名称</th>
              <th style="padding: 8px 12px; border: 1px solid #d1d5db; text-align: left; width: 15%;">类型</th>
              <th style="padding: 8px 12px; border: 1px solid #d1d5db; text-align: right; width: 20%;">持股比例</th>
              <th style="padding: 8px 12px; border: 1px solid #d1d5db; text-align: left; width: 20%;">备注</th>
            </tr>
          </thead>
          <tbody>
            ${equity.shareholders
              .map(
                (sh: { name: string; type: string; percentage: number | null; notes?: string }, idx: number) => `
              <tr>
                <td style="padding: 8px 12px; border: 1px solid #d1d5db;">${idx + 1}</td>
                <td style="padding: 8px 12px; border: 1px solid #d1d5db;">${sh.name}</td>
                <td style="padding: 8px 12px; border: 1px solid #d1d5db;">${typeLabels[sh.type] || sh.type}</td>
                <td style="padding: 8px 12px; border: 1px solid #d1d5db; text-align: right;">${sh.percentage !== null && sh.percentage !== undefined ? sh.percentage + "%" : "未披露"}</td>
                <td style="padding: 8px 12px; border: 1px solid #d1d5db;">${sh.notes || "-"}</td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>
        ${equity.notes && equity.notes.length > 0 ? `
          <div style="font-size: 11px; color: #6b7280; padding: 8px; background: #f9fafb; border-radius: 4px;">
            <strong>注�����</strong>
            <ol style="margin: 4px 0 0 0; padding-left: 16px;">
              ${equity.notes.map((note: string) => `<li>${note}</li>`).join("")}
            </ol>
          </div>
        ` : ""}
      </div>
    `;
  }

  // Build definitions section if available
  let definitionsHTML = "";
  if (definitions && definitions.length > 0) {
    definitionsHTML = `
      <div style="page-break-before: always; margin-bottom: 32px;">
        <h2 style="font-size: 18px; font-weight: 700; color: #111827; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb;">
          释义
        </h2>
        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
          <thead>
            <tr style="background: #f3f4f6;">
              <th style="padding: 8px 12px; border: 1px solid #d1d5db; text-align: left; width: 25%;">简称</th>
              <th style="padding: 8px 12px; border: 1px solid #d1d5db; text-align: left; width: 50%;">全称</th>
              <th style="padding: 8px 12px; border: 1px solid #d1d5db; text-align: left; width: 25%;">类型</th>
            </tr>
          </thead>
          <tbody>
            ${definitions
              .map(
                (def) => `
              <tr>
                <td style="padding: 8px 12px; border: 1px solid #d1d5db;">${def.shortName}</td>
                <td style="padding: 8px 12px; border: 1px solid #d1d5db;">${def.fullName}</td>
                <td style="padding: 8px 12px; border: 1px solid #d1d5db;">${def.entityType}</td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <style>
        * { box-sizing: border-box; }
        body {
          font-family: ${fontStack};
          margin: 0;
          padding: 40px;
          background: white;
          color: ${primaryColor};
          line-height: 1.6;
        }
        @page {
          size: A4;
          margin: 20mm;
        }
      </style>
    </head>
    <body>
      <!-- Template Badge -->
      <div style="position: fixed; top: 10px; right: 10px; padding: 4px 12px; background: ${primaryColor}; color: white; font-size: 10px; border-radius: 4px; z-index: 1000;">
        模板：${templateStyle?.name || "标准"}
      </div>
      
      <!-- Title Page -->
      <div style="text-align: center; padding: 80px 0 60px 0; page-break-after: always;">
        <h1 style="font-size: 32px; font-weight: 700; margin-bottom: 20px; color: ${primaryColor};">
          法律尽职调查报告
        </h1>
        <div style="font-size: 16px; color: ${accentColor}; margin-bottom: 60px;">
          Legal Due Diligence Report
        </div>
        <div style="font-size: 18px; margin-bottom: 16px; color: ${primaryColor};">
          <strong>目标公司：</strong>${targetName}
        </div>
        ${project.client ? `<div style="font-size: 16px; margin-bottom: 16px; color: ${accentColor};"><strong>委托方：</strong>${project.client}</div>` : ""}
        <div style="font-size: 14px; color: ${accentColor}; margin-top: 40px;">
          报告日期：${today}
        </div>
        <div style="font-size: 14px; color: ${accentColor}; margin-top: 8px;">
          审阅文件数量：${fileCount} 份
        </div>
      </div>

      <!-- Table of Contents -->
      <div style="page-break-after: always;">
        <h2 style="font-size: 20px; font-weight: 700; text-align: center; margin-bottom: 32px; color: #111827;">
          目 录
        </h2>
        <div style="font-size: 14px;">
          ${sections
            .map(
              (section, idx) => `
            <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px dotted #d1d5db;">
              <span>${sectionLabel(section.number, section.title)}</span>
            </div>
          `
            )
            .join("")}
        </div>
      </div>

      <!-- Definitions -->
      ${definitionsHTML}

      <!-- Equity Structure -->
      ${equityStructureHTML}

      <!-- Main Content -->
      ${sectionsHTML}
    </body>
    </html>
  `;
}

// Helper function to render HTML to canvas and add to PDF
// 使用整页渲染方式，不在页面中间切割内容
async function renderSectionToPDF(
  pdf: jsPDF,
  html: string,
  isFirstPage: boolean,
  containerWidth: string = "794px"
): Promise<void> {
  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "-9999px";
  container.style.top = "0";
  container.style.width = containerWidth;
  container.style.background = "white";
  container.style.padding = "40px";
  document.body.appendChild(container);
  container.innerHTML = html;

  await document.fonts.ready;
  await new Promise((resolve) => setTimeout(resolve, 200));

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: "#ffffff",
    });

    const margin = 15;
    const pageWidth = 210;
    const pageHeight = 297;
    const contentWidth = pageWidth - margin * 2;
    const imgWidth = contentWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    if (!isFirstPage) {
      pdf.addPage();
    }

    // 直接将整个内容添加到页面，让jsPDF自动处理溢出
    // 对于较长内容，缩放以适应页面宽度，高度按比例
    pdf.addImage(
      canvas.toDataURL("image/png", 1.0),
      "PNG",
      margin,
      margin,
      imgWidth,
      imgHeight
    );
  } finally {
    document.body.removeChild(container);
  }
}

// 分块渲染内容，每个章节单独渲染避免切断
async function renderContentByChunks(
  pdf: jsPDF,
  sections: ReportSection[],
  metadata: ReportMetadata | null,
  definitions: Definition[],
  templateStyle?: TemplateStyle
): Promise<void> {
  const { fontFamily } = resolveTemplateColors(templateStyle);
  const fontFamilyMap: Record<string, string> = {
    "宋体": '"SimSun", "宋体", serif',
    "黑体": '"SimHei", "黑体", sans-serif',
    "仿宋": '"FangSong", "仿宋", serif',
    "楷体": '"KaiTi", "楷体", serif',
    "微软雅黑": '"Microsoft YaHei", "微软雅黑", sans-serif',
    "Times New Roman": '"Times New Roman", Georgia, serif',
    "Arial": 'Arial, Helvetica, sans-serif',
  };
  const fontStack = fontFamilyMap[fontFamily] || fontFamilyMap["宋体"];
  
  const margin = 15;
  const pageWidth = 210;
  const pageHeight = 297;
  const contentWidth = pageWidth - margin * 2;
  const contentHeight = pageHeight - margin * 2;
  
  let currentY = margin;
  let isFirstChunk = true;

  // 渲染单个HTML块并添加到PDF，支持超长内容自动分页
  async function renderChunk(html: string): Promise<void> {
    const container = document.createElement("div");
    container.style.position = "absolute";
    container.style.left = "-9999px";
    container.style.top = "0";
    container.style.width = "714px"; // 794 - 80 (padding)
    container.style.background = "white";
    container.style.fontFamily = fontStack;
    document.body.appendChild(container);
    container.innerHTML = html;

    await document.fonts.ready;
    await new Promise((resolve) => setTimeout(resolve, 100));

    try {
      const canvas = await html2canvas(container, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: "#ffffff",
      });

      const imgWidth = contentWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      const availableHeight = contentHeight;

      // 检查是否需要新页面
      if (!isFirstChunk && currentY + Math.min(imgHeight, 20) > pageHeight - margin) {
        pdf.addPage();
        currentY = margin;
      }
      isFirstChunk = false;

      // 如果内容高度小于等于剩余空间，直接添加
      const remainingHeight = pageHeight - margin - currentY;
      
      if (imgHeight <= remainingHeight) {
        pdf.addImage(
          canvas.toDataURL("image/png", 1.0),
          "PNG",
          margin,
          currentY,
          imgWidth,
          imgHeight
        );
        currentY += imgHeight + 5;
      } else {
        // 内容超出当前页面，需要分页处理
        let sourceY = 0;
        const scale = canvas.width / imgWidth;
        
        while (sourceY < canvas.height) {
          const currentRemainingHeight = pageHeight - margin - currentY;
          const sourceHeightForPage = Math.min(
            currentRemainingHeight * scale,
            canvas.height - sourceY
          );
          const destHeight = sourceHeightForPage / scale;

          // 创建当前页面的画布切片
          const pageCanvas = document.createElement("canvas");
          pageCanvas.width = canvas.width;
          pageCanvas.height = sourceHeightForPage;
          const ctx = pageCanvas.getContext("2d");
          
          if (ctx) {
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
            ctx.drawImage(
              canvas,
              0, sourceY,
              canvas.width, sourceHeightForPage,
              0, 0,
              canvas.width, sourceHeightForPage
            );

            pdf.addImage(
              pageCanvas.toDataURL("image/png", 1.0),
              "PNG",
              margin,
              currentY,
              imgWidth,
              destHeight
            );
          }

          sourceY += sourceHeightForPage;
          
          // 如果还有剩余内容，添加新页面
          if (sourceY < canvas.height) {
            pdf.addPage();
            currentY = margin;
          } else {
            currentY += destHeight + 5;
          }
        }
      }
    } finally {
      document.body.removeChild(container);
    }
  }

  // 添加新页面开始正文
  pdf.addPage();

  // 1. 渲染释义表（如果有）
  if (definitions && definitions.length > 0) {
    const definitionsHTML = `
      <div style="margin-bottom: 20px;">
        <h2 style="font-size: 18px; font-weight: 700; color: #111827; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb;">
          释义
        </h2>
        <table style="width: 100%; border-collapse: collapse; font-size: 12px; table-layout: fixed;">
          <thead>
            <tr style="background: #f3f4f6;">
              <th style="padding: 8px 12px; border: 1px solid #d1d5db; text-align: left; width: 25%;">简称</th>
              <th style="padding: 8px 12px; border: 1px solid #d1d5db; text-align: left; width: 50%;">全称</th>
              <th style="padding: 8px 12px; border: 1px solid #d1d5db; text-align: left; width: 25%;">类型</th>
            </tr>
          </thead>
          <tbody>
            ${definitions
              .map(
                (def) => `
              <tr>
                <td style="padding: 8px 12px; border: 1px solid #d1d5db;">${def.shortName}</td>
                <td style="padding: 8px 12px; border: 1px solid #d1d5db;">${def.fullName}</td>
                <td style="padding: 8px 12px; border: 1px solid #d1d5db;">${def.entityType}</td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
    await renderChunk(definitionsHTML);
  }

  // 2. 逐个渲染章节
  for (const section of sections) {
    // 章节标题和内容
    let sectionHTML = `
      <div style="margin-bottom: 16px;">
        <h2 style="font-size: 18px; font-weight: 700; color: #111827; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb;">
          ${sectionLabel(section.number, section.title)}
        </h2>
        <div style="font-size: 13px; line-height: 1.8; color: #374151; text-align: justify;">
          ${markdownToHTMLForPDF(section.content)}
        </div>
      </div>
    `;
    await renderChunk(sectionHTML);

    // 核查发现（如果有）
    if (section.findings && section.findings.length > 0) {
      const findingsHTML = `
        <div style="margin-bottom: 16px;">
          <h4 style="font-size: 14px; font-weight: 600; margin-bottom: 8px; color: #374151;">核查发现</h4>
          <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #4b5563;">
            ${section.findings.map((f) => `<li style="margin-bottom: 4px;">${f}</li>`).join("")}
          </ul>
        </div>
      `;
      await renderChunk(findingsHTML);
    }

    // 发现的问题与风险（如果有）
    if (section.issues && section.issues.length > 0) {
      const issuesHTML = `
        <div style="margin-bottom: 16px;">
          <h4 style="font-size: 14px; font-weight: 600; margin-bottom: 8px; color: #374151;">发现的问题与风险</h4>
          <table style="width: 100%; border-collapse: collapse; font-size: 12px; table-layout: fixed;">
            <thead>
              <tr style="background: #f3f4f6;">
                <th style="padding: 8px; border: 1px solid #d1d5db; text-align: center; width: 6%;">序号</th>
                <th style="padding: 8px; border: 1px solid #d1d5db; text-align: left; width: 26%;">事实</th>
                <th style="padding: 8px; border: 1px solid #d1d5db; text-align: left; width: 22%;">问题/风险</th>
                <th style="padding: 8px; border: 1px solid #d1d5db; text-align: left; width: 26%;">建议</th>
                <th style="padding: 8px; border: 1px solid #d1d5db; text-align: center; width: 20%;">级别</th>
              </tr>
            </thead>
            <tbody>
              ${section.issues
                .map(
                  (issue, idx) => `
                <tr>
                  <td style="padding: 8px; border: 1px solid #d1d5db; vertical-align: top; text-align: center;">${idx + 1}</td>
                  <td style="padding: 8px; border: 1px solid #d1d5db; vertical-align: top; word-wrap: break-word;">${issue.fact}</td>
                  <td style="padding: 8px; border: 1px solid #d1d5db; vertical-align: top; word-wrap: break-word;">${issue.risk}</td>
                  <td style="padding: 8px; border: 1px solid #d1d5db; vertical-align: top; word-wrap: break-word;">${issue.suggestion}</td>
                  <td style="padding: 8px; border: 1px solid #d1d5db; text-align: center; vertical-align: middle; background-color: ${getSeverityColor(issue.severity)}; color: #ffffff; font-weight: 600;">${severityToChinese(issue.severity)}</td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      `;
      await renderChunk(issuesHTML);
    }

    // 证据来源（如果有）
    if (section.mappedFiles && section.mappedFiles.length > 0) {
      const mappedFilesHTML = `
        <div style="margin-bottom: 16px; padding: 8px 12px; background: #f9fafb; border-radius: 4px; font-size: 12px; color: #6b7280;">
          <strong>证据来源：</strong>${section.mappedFiles.map(f => f.name).join("、")}
        </div>
      `;
      await renderChunk(mappedFilesHTML);
    }
  }
}

// Generate Cover Page HTML
function generateCoverPageHTML(
  project: Project,
  fileCount: number,
  templateStyle?: TemplateStyle
): string {
  const today = new Date().toLocaleDateString("zh-CN");
  const targetName = project.target || project.name;
  const { primaryColor, accentColor, fontFamily } = resolveTemplateColors(templateStyle);
  const fontFamilyMap: Record<string, string> = {
    "宋体": '"SimSun", "宋体", serif',
    "黑体": '"SimHei", "黑体", sans-serif',
    "仿宋": '"FangSong", "仿宋", serif',
    "楷体": '"KaiTi", "楷体", serif',
    "微软雅黑": '"Microsoft YaHei", "微软雅黑", sans-serif',
    "Times New Roman": '"Times New Roman", Georgia, serif',
    "Arial": 'Arial, Helvetica, sans-serif',
  };
  const fontStack = fontFamilyMap[fontFamily] || fontFamilyMap["宋体"];

  return `
    <div style="font-family: ${fontStack}; text-align: center; padding: 100px 40px; min-height: 800px; display: flex; flex-direction: column; justify-content: center; align-items: center;">
      <h1 style="font-size: 42px; font-weight: 700; margin-bottom: 60px; color: ${primaryColor}; letter-spacing: 8px;">
        法律尽职调查报告
      </h1>
      <div style="width: 120px; height: 2px; background: ${primaryColor}; margin-bottom: 60px;"></div>
      <div style="font-size: 22px; margin-bottom: 24px; color: ${primaryColor};">
        <strong>目标公司</strong>
      </div>
      <div style="font-size: 26px; margin-bottom: 40px; color: #111827; font-weight: 600;">
        ${targetName}
      </div>
      ${project.client ? `
      <div style="font-size: 18px; margin-bottom: 12px; color: ${accentColor};">
        <strong>委托方</strong>
      </div>
      <div style="font-size: 20px; margin-bottom: 40px; color: #374151;">
        ${project.client}
      </div>
      ` : ""}
      <div style="margin-top: 60px; padding-top: 40px; border-top: 1px solid #e5e7eb;">
        <div style="font-size: 15px; color: ${accentColor}; margin-bottom: 10px;">
          报告日期：${today}
        </div>
        <div style="font-size: 15px; color: ${accentColor};">
          审阅文件数量：${fileCount} 份
        </div>
      </div>
    </div>
  `;
}

// Generate TOC Page HTML
function generateTOCPageHTML(
  sections: ReportSection[],
  templateStyle?: TemplateStyle
): string {
  const { fontFamily } = resolveTemplateColors(templateStyle);
  const fontFamilyMap: Record<string, string> = {
    "宋体": '"SimSun", "宋体", serif',
    "黑体": '"SimHei", "黑体", sans-serif',
    "仿宋": '"FangSong", "仿宋", serif',
    "楷体": '"KaiTi", "楷体", serif',
    "微软雅黑": '"Microsoft YaHei", "微软雅黑", sans-serif',
    "Times New Roman": '"Times New Roman", Georgia, serif',
    "Arial": 'Arial, Helvetica, sans-serif',
  };
  const fontStack = fontFamilyMap[fontFamily] || fontFamilyMap["宋体"];

  return `
    <div style="font-family: ${fontStack}; padding: 40px;">
      <h2 style="font-size: 24px; font-weight: 700; text-align: center; margin-bottom: 40px; color: #111827;">
        目 录
      </h2>
      <div style="font-size: 14px;">
        ${sections
          .map(
            (section) => `
          <div style="display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px dotted #d1d5db;">
            <span style="color: #374151;">${sectionLabel(section.number, section.title)}</span>
          </div>
        `
          )
          .join("")}
      </div>
    </div>
  `;
}

// Generate Content Pages HTML (sections + metadata)
function generateContentPagesHTML(
  sections: ReportSection[],
  metadata: ReportMetadata | null,
  definitions: Definition[],
  templateStyle?: TemplateStyle
): string {
  const { primaryColor, accentColor, fontFamily } = resolveTemplateColors(templateStyle);
  const fontFamilyMap: Record<string, string> = {
    "宋体": '"SimSun", "宋体", serif',
    "黑体": '"SimHei", "黑体", sans-serif',
    "仿宋": '"FangSong", "仿宋", serif',
    "楷体": '"KaiTi", "楷体", serif',
    "微软雅黑": '"Microsoft YaHei", "微软雅黑", sans-serif',
    "Times New Roman": '"Times New Roman", Georgia, serif',
    "Arial": 'Arial, Helvetica, sans-serif',
  };
  const fontStack = fontFamilyMap[fontFamily] || fontFamilyMap["宋体"];

  let sectionsHTML = "";
  for (const section of sections) {
    let issuesHTML = "";
    if (section.issues && section.issues.length > 0) {
      issuesHTML = `
        <div style="margin-top: 16px; page-break-inside: avoid;">
          <h4 style="font-size: 14px; font-weight: 600; margin-bottom: 8px; color: #374151;">发现的问题与风险</h4>
          <table style="width: 100%; border-collapse: collapse; font-size: 12px; table-layout: fixed;">
            <thead>
              <tr style="background: #f3f4f6;">
                <th style="padding: 8px; border: 1px solid #d1d5db; text-align: center; width: 6%;">序号</th>
                <th style="padding: 8px; border: 1px solid #d1d5db; text-align: left; width: 26%;">事实</th>
                <th style="padding: 8px; border: 1px solid #d1d5db; text-align: left; width: 22%;">问题/风险</th>
                <th style="padding: 8px; border: 1px solid #d1d5db; text-align: left; width: 26%;">建议</th>
                <th style="padding: 8px; border: 1px solid #d1d5db; text-align: center; width: 20%;">级别</th>
              </tr>
            </thead>
            <tbody>
              ${section.issues
                .map(
                  (issue, idx) => `
                <tr style="page-break-inside: avoid;">
                  <td style="padding: 8px; border: 1px solid #d1d5db; vertical-align: top; text-align: center;">${idx + 1}</td>
                  <td style="padding: 8px; border: 1px solid #d1d5db; vertical-align: top; word-wrap: break-word; overflow-wrap: break-word;">${issue.fact}</td>
                  <td style="padding: 8px; border: 1px solid #d1d5db; vertical-align: top; word-wrap: break-word; overflow-wrap: break-word;">${issue.risk}</td>
                  <td style="padding: 8px; border: 1px solid #d1d5db; vertical-align: top; word-wrap: break-word; overflow-wrap: break-word;">${issue.suggestion}</td>
                  <td style="padding: 8px; border: 1px solid #d1d5db; text-align: center; vertical-align: middle; background-color: ${getSeverityColor(issue.severity)}; color: #ffffff; font-weight: 600;">${severityToChinese(issue.severity)}</td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      `;
    }

    let findingsHTML = "";
    if (section.findings && section.findings.length > 0) {
      findingsHTML = `
        <div style="margin-top: 16px; page-break-inside: avoid;">
          <h4 style="font-size: 14px; font-weight: 600; margin-bottom: 8px; color: #374151;">核查发现</h4>
          <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #4b5563;">
            ${section.findings.map((f) => `<li style="margin-bottom: 4px;">${f}</li>`).join("")}
          </ul>
        </div>
      `;
    }

    let mappedFilesHTML = "";
    if (section.mappedFiles && section.mappedFiles.length > 0) {
      mappedFilesHTML = `
        <div style="margin-top: 16px; padding: 8px 12px; background: #f9fafb; border-radius: 4px; font-size: 12px; color: #6b7280;">
          <strong>证据来源：</strong>${section.mappedFiles.map(f => f.name).join("、")}
        </div>
      `;
    }

    sectionsHTML += `
      <div style="margin-bottom: 32px; page-break-inside: avoid;">
        <h2 style="font-size: 18px; font-weight: 700; color: #111827; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb; page-break-after: avoid;">
          ${sectionLabel(section.number, section.title)}
        </h2>
        <div style="font-size: 13px; line-height: 1.8; color: #374151; text-align: justify;">
          ${markdownToHTMLForPDF(section.content)}
        </div>
        ${findingsHTML}
        ${issuesHTML}
        ${mappedFilesHTML}
      </div>
    `;
  }

  // Definitions section
  let definitionsHTML = "";
  if (definitions && definitions.length > 0) {
    definitionsHTML = `
      <div style="margin-bottom: 32px;">
        <h2 style="font-size: 18px; font-weight: 700; color: #111827; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb;">
          释义
        </h2>
        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
          <thead>
            <tr style="background: #f3f4f6;">
              <th style="padding: 8px 12px; border: 1px solid #d1d5db; text-align: left; width: 25%;">简称</th>
              <th style="padding: 8px 12px; border: 1px solid #d1d5db; text-align: left; width: 50%;">全称</th>
              <th style="padding: 8px 12px; border: 1px solid #d1d5db; text-align: left; width: 25%;">类型</th>
            </tr>
          </thead>
          <tbody>
            ${definitions
              .map(
                (def) => `
              <tr>
                <td style="padding: 8px 12px; border: 1px solid #d1d5db;">${def.shortName}</td>
                <td style="padding: 8px 12px; border: 1px solid #d1d5db;">${def.fullName}</td>
                <td style="padding: 8px 12px; border: 1px solid #d1d5db;">${def.entityType}</td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  return `
    <div style="font-family: ${fontStack};">
      ${definitionsHTML}
      ${sectionsHTML}
    </div>
  `;
}

// Export to PDF using html2canvas + jsPDF for Chinese support
// 分离封面、目录、正文到不同页面
export async function exportToPDF(
  project: Project,
  sections: ReportSection[],
  metadata: ReportMetadata | null,
  definitions: Definition[],
  fileCount: number,
  templateStyle?: TemplateStyle
): Promise<void> {
  const targetName = project.target || project.name;

  // Create PDF
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  // 1. Render Cover Page (first page)
  const coverHTML = generateCoverPageHTML(project, fileCount, templateStyle);
  await renderSectionToPDF(pdf, coverHTML, true);

  // 2. Render TOC Page (new page)
  const tocHTML = generateTOCPageHTML(sections, templateStyle);
  await renderSectionToPDF(pdf, tocHTML, false);

  // 3. Render Content Pages (逐块渲染，避免文字被切断)
  await renderContentByChunks(pdf, sections, metadata, definitions, templateStyle);

  // Save the PDF
  pdf.save(`${targetName}_法律尽职调查报告.pdf`);
}

// Export to Word using docx library
export async function exportToWord(
  project: Project,
  sections: ReportSection[],
  metadata: ReportMetadata | null,
  definitions: Definition[],
  fileCount: number,
  templateStyle?: TemplateStyle
): Promise<void> {
  const today = new Date().toLocaleDateString("zh-CN");
  const targetName = project.target || project.name;
  
  // Get style values from template
  const templateName = templateStyle?.name || "标准模板";
  const { primaryColor, accentColor, fontFamily, headerFill } =
    resolveTemplateColors(templateStyle);
  const primaryColorHex = primaryColor.replace("#", "");
  const accentColorHex = accentColor.replace("#", "");
  const h1Size = (templateStyle?.styles?.h1?.sizePt || 18) * 2; // Convert pt to half-pt
  const h2Size = (templateStyle?.styles?.h2?.sizePt || 14) * 2;
  const bodySize = (templateStyle?.styles?.body?.sizePt || 11) * 2;
  const headerFillColor = headerFill.replace("#", "") || "f3f4f6";

  // Create document sections
  const docChildren: (Paragraph | Table)[] = [];

  // Title - using template primary color
  docChildren.push(
    new Paragraph({
      children: [
        new TextRun({
          text: "法律尽职调查报告",
          bold: true,
          size: 56, // 28pt
          color: primaryColorHex,
          font: fontFamily,
        }),
      ],
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    })
  );

  // Subtitle - using template accent color
  docChildren.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `目标公司：${targetName}`,
          size: 32, // 16pt
          color: primaryColorHex,
          font: fontFamily,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    })
  );

  docChildren.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `报告日期：${today}`,
          size: 24,
          color: accentColorHex,
          font: fontFamily,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    })
  );

  docChildren.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `审阅文件数量：${fileCount} 份`,
          size: 24,
          color: accentColorHex,
          font: fontFamily,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    })
  );

  // Add template info badge
  docChildren.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `【 报告模板：${templateName} 】`,
          size: 22,
          color: primaryColorHex,
          font: fontFamily,
          bold: true,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 600 },
      border: {
        top: { style: BorderStyle.SINGLE, size: 1, color: primaryColorHex },
        bottom: { style: BorderStyle.SINGLE, size: 1, color: primaryColorHex },
      },
    })
  );

  // Page break before content
  docChildren.push(
    new Paragraph({
      children: [],
      pageBreakBefore: true,
    })
  );

  // Table of Contents header - using template style
  docChildren.push(
    new Paragraph({
      children: [
        new TextRun({
          text: "目 录",
          bold: true,
          size: h1Size,
          color: primaryColorHex,
          font: fontFamily,
        }),
      ],
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 6, color: primaryColorHex },
      },
    })
  );

  // TOC entries - using template style
  sections.forEach((section) => {
    docChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: sectionLabel(section.number, section.title),
            size: bodySize,
            font: fontFamily,
          }),
        ],
        spacing: { after: 100 },
      })
    );
  });

  // Equity Structure section if available
  if (metadata?.equityStructure && metadata.equityStructure.shareholders && metadata.equityStructure.shareholders.length > 0) {
    const equity = metadata.equityStructure;
    const typeLabels: Record<string, string> = {
      individual: "自然人",
      company: "法人",
      team: "持股平台",
    };

    docChildren.push(
      new Paragraph({
        children: [],
        pageBreakBefore: true,
      })
    );

    docChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "股权结构",
            bold: true,
            size: 28,
          }),
        ],
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 300 },
      })
    );

    docChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `目标公司：${equity.companyName}`,
            size: 24,
          }),
        ],
        spacing: { after: 200 },
      })
    );

    // Equity table
    const equityTableRows: TableRow[] = [
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: "序号", bold: true, size: 20 })] })],
            width: { size: 10, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: "股东名称", bold: true, size: 20 })] })],
            width: { size: 35, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: "类型", bold: true, size: 20 })] })],
            width: { size: 15, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: "持股比例", bold: true, size: 20 })] })],
            width: { size: 20, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: "备注", bold: true, size: 20 })] })],
            width: { size: 20, type: WidthType.PERCENTAGE },
          }),
        ],
      }),
    ];

    equity.shareholders.forEach((sh: { name: string; type: string; percentage: number | null; notes?: string }, idx: number) => {
      equityTableRows.push(
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: String(idx + 1), size: 20 })] })],
            }),
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: sh.name, size: 20 })] })],
            }),
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: typeLabels[sh.type] || sh.type, size: 20 })] })],
            }),
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: sh.percentage !== null && sh.percentage !== undefined ? sh.percentage + "%" : "未披露", size: 20 })] })],
            }),
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: sh.notes || "-", size: 20 })] })],
            }),
          ],
        })
      );
    });

    docChildren.push(
      new Table({
        rows: equityTableRows,
        width: { size: 100, type: WidthType.PERCENTAGE },
      })
    );

    // Notes
    if (equity.notes && equity.notes.length > 0) {
      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: "注：",
              bold: true,
              size: 20,
            }),
          ],
          spacing: { before: 200, after: 100 },
        })
      );

      equity.notes.forEach((note: string, idx: number) => {
        docChildren.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `${idx + 1}. ${note}`,
                size: 20,
              }),
            ],
            spacing: { after: 50 },
            indent: { left: convertInchesToTwip(0.25) },
          })
        );
      });
    }
  }

  // Sections
  for (const section of sections) {
    // Page break before each major section
    docChildren.push(
      new Paragraph({
        children: [],
        pageBreakBefore: true,
      })
    );

    // Section title - using template style
    docChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: sectionLabel(section.number, section.title),
            bold: true,
            size: h1Size,
            color: primaryColorHex,
            font: fontFamily,
          }),
        ],
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 300 },
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 6, color: primaryColorHex },
        },
      })
    );

    // Content paragraphs - using template body style
    if (section.content) {
      const paragraphs = section.content.split("\n\n");
      for (const para of paragraphs) {
        if (para.trim()) {
          docChildren.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: para.trim(),
                  size: bodySize,
                  font: fontFamily,
                }),
              ],
              spacing: { after: 200 },
              alignment: AlignmentType.JUSTIFIED,
            })
          );
        }
      }
    }

    // Findings - using template h2 style
    if (section.findings && section.findings.length > 0) {
      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: "核查发现：",
              bold: true,
              size: h2Size,
              color: primaryColorHex,
              font: fontFamily,
            }),
          ],
          spacing: { before: 200, after: 100 },
        })
      );

      for (const finding of section.findings) {
        docChildren.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `• ${finding}`,
                size: bodySize,
                font: fontFamily,
              }),
            ],
            spacing: { after: 100 },
            indent: { left: convertInchesToTwip(0.25) },
          })
        );
      }
    }

    // Issues table - using template style
    if (section.issues && section.issues.length > 0) {
      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: "发现的问题与风险：",
              bold: true,
              size: h2Size,
              color: primaryColorHex,
              font: fontFamily,
            }),
          ],
          spacing: { before: 300, after: 200 },
        })
      );

      const tableRows: TableRow[] = [
        // Header row - using template header fill color
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: "序号", bold: true, size: 20, font: fontFamily })] })],
              width: { size: 8, type: WidthType.PERCENTAGE },
              shading: { fill: headerFillColor },
            }),
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: "事实", bold: true, size: 20, font: fontFamily })] })],
              width: { size: 30, type: WidthType.PERCENTAGE },
              shading: { fill: headerFillColor },
            }),
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: "问题/风险", bold: true, size: 20, font: fontFamily })] })],
              width: { size: 25, type: WidthType.PERCENTAGE },
              shading: { fill: headerFillColor },
            }),
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: "建议", bold: true, size: 20, font: fontFamily })] })],
              width: { size: 27, type: WidthType.PERCENTAGE },
              shading: { fill: headerFillColor },
            }),
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: "级别", bold: true, size: 20, font: fontFamily })] })],
              width: { size: 10, type: WidthType.PERCENTAGE },
              shading: { fill: headerFillColor },
            }),
          ],
        }),
      ];

      section.issues.forEach((issue, idx) => {
        tableRows.push(
          new TableRow({
            children: [
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: String(idx + 1), size: 20, font: fontFamily })] })],
              }),
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: issue.fact, size: 20, font: fontFamily })] })],
              }),
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: issue.risk, size: 20, font: fontFamily })] })],
              }),
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: issue.suggestion, size: 20, font: fontFamily })] })],
              }),
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: severityToChinese(issue.severity), size: 20, font: fontFamily })] })],
              }),
            ],
          })
        );
      });

      docChildren.push(
        new Table({
          rows: tableRows,
          width: { size: 100, type: WidthType.PERCENTAGE },
        })
      );
    }

    // Source files (从 mappedFiles 获取)
    if (section.mappedFiles && section.mappedFiles.length > 0) {
      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: "证据来源：",
              bold: true,
              size: 20,
              italics: true,
            }),
            new TextRun({
              text: section.mappedFiles.map(f => f.name).join("、"),
              size: 20,
              italics: true,
            }),
          ],
          spacing: { before: 200, after: 100 },
        })
      );
    }
  }

  // Create document
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1),
            },
          },
        },
        children: docChildren,
      },
    ],
  });

  // Generate and save
  const blob = await Packer.toBlob(doc);
  const fileName = `${targetName}_法律尽职调查报告.docx`;
  saveAs(blob, fileName);
}
