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
  convertInchesToTwip,
} from "docx";
import { saveAs } from "file-saver";

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
  sourceFiles: string[];
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

// Generate HTML content for PDF
function generatePDFHTML(
  project: Project,
  sections: ReportSection[],
  metadata: ReportMetadata | null,
  definitions: Definition[],
  fileCount: number
): string {
  const today = new Date().toLocaleDateString("zh-CN");
  const targetName = project.target || project.name;
  
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

    let sourceFilesHTML = "";
    if (section.sourceFiles && section.sourceFiles.length > 0) {
      sourceFilesHTML = `
        <div style="margin-top: 16px; padding: 8px 12px; background: #f9fafb; border-radius: 4px; font-size: 12px; color: #6b7280;">
          <strong>证据来源：</strong>${section.sourceFiles.join("、")}
        </div>
      `;
    }

    sectionsHTML += `
      <div style="page-break-inside: avoid; margin-bottom: 32px;">
        <h2 style="font-size: 18px; font-weight: 700; color: #111827; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb;">
          ${section.number} ${section.title}
        </h2>
        <div style="font-size: 13px; line-height: 1.8; color: #374151; text-align: justify;">
          ${markdownToHTMLForPDF(section.content)}
        </div>
        ${findingsHTML}
        ${issuesHTML}
        ${sourceFilesHTML}
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
            <strong>注：</strong>
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
          font-family: "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif;
          margin: 0;
          padding: 40px;
          background: white;
          color: #111827;
          line-height: 1.6;
        }
        @page {
          size: A4;
          margin: 20mm;
        }
      </style>
    </head>
    <body>
      <!-- Title Page -->
      <div style="text-align: center; padding: 80px 0 60px 0; page-break-after: always;">
        <h1 style="font-size: 32px; font-weight: 700; margin-bottom: 20px; color: #111827;">
          法律尽职调查报告
        </h1>
        <div style="font-size: 16px; color: #6b7280; margin-bottom: 60px;">
          Legal Due Diligence Report
        </div>
        <div style="font-size: 18px; margin-bottom: 16px;">
          <strong>目标公司：</strong>${targetName}
        </div>
        ${project.client ? `<div style="font-size: 16px; margin-bottom: 16px; color: #4b5563;"><strong>委托方：</strong>${project.client}</div>` : ""}
        <div style="font-size: 14px; color: #6b7280; margin-top: 40px;">
          报告日期：${today}
        </div>
        <div style="font-size: 14px; color: #6b7280; margin-top: 8px;">
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
              <span>${section.number} ${section.title}</span>
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

// Export to PDF using html2canvas + jsPDF for Chinese support
export async function exportToPDF(
  project: Project,
  sections: ReportSection[],
  metadata: ReportMetadata | null,
  definitions: Definition[],
  fileCount: number
): Promise<void> {
  const targetName = project.target || project.name;
  
  // Create a hidden container for rendering
  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "-9999px";
  container.style.top = "0";
  container.style.width = "794px"; // A4 width at 96 DPI
  container.style.background = "white";
  document.body.appendChild(container);

  // Generate HTML content
  const html = generatePDFHTML(project, sections, metadata, definitions, fileCount);
  container.innerHTML = html;

  // Wait for fonts to load
  await document.fonts.ready;
  await new Promise((resolve) => setTimeout(resolve, 500));

  try {
    // Capture with html2canvas
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: "#ffffff",
    });

    // Calculate dimensions with margins
    const margin = 15; // 15mm margin on each side
    const pageWidth = 210; // A4 width in mm
    const pageHeight = 297; // A4 height in mm
    const contentWidth = pageWidth - (margin * 2); // Available content width
    const imgHeight = (canvas.height * contentWidth) / canvas.width;
    const contentHeight = pageHeight - (margin * 2); // Available content height per page
    
    // Create PDF
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });

    let heightLeft = imgHeight;
    let position = 0;

    // Add first page with margins
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", margin, margin, contentWidth, imgHeight);
    heightLeft -= contentHeight;

    // Add additional pages if needed
    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", margin, position + margin, contentWidth, imgHeight);
      heightLeft -= contentHeight;
    }

    // Save the PDF
    pdf.save(`${targetName}_法律尽职调查报告.pdf`);
  } finally {
    // Clean up
    document.body.removeChild(container);
  }
}

// Export to Word using docx library
export async function exportToWord(
  project: Project,
  sections: ReportSection[],
  metadata: ReportMetadata | null,
  definitions: Definition[],
  fileCount: number
): Promise<void> {
  const today = new Date().toLocaleDateString("zh-CN");
  const targetName = project.target || project.name;

  // Create document sections
  const docChildren: (Paragraph | Table)[] = [];

  // Title
  docChildren.push(
    new Paragraph({
      children: [
        new TextRun({
          text: "法律尽职调查报告",
          bold: true,
          size: 48, // 24pt
        }),
      ],
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    })
  );

  // Subtitle
  docChildren.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `目标公司：${targetName}`,
          size: 28, // 14pt
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
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 600 },
    })
  );

  // Page break before content
  docChildren.push(
    new Paragraph({
      children: [],
      pageBreakBefore: true,
    })
  );

  // Table of Contents header
  docChildren.push(
    new Paragraph({
      children: [
        new TextRun({
          text: "目 录",
          bold: true,
          size: 32,
        }),
      ],
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    })
  );

  // TOC entries
  sections.forEach((section) => {
    docChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `${section.number} ${section.title}`,
            size: 24,
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

    // Section title
    docChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `${section.number} ${section.title}`,
            bold: true,
            size: 28,
          }),
        ],
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 300 },
      })
    );

    // Content paragraphs
    if (section.content) {
      const paragraphs = section.content.split("\n\n");
      for (const para of paragraphs) {
        if (para.trim()) {
          docChildren.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: para.trim(),
                  size: 22, // 11pt
                }),
              ],
              spacing: { after: 200 },
              alignment: AlignmentType.JUSTIFIED,
            })
          );
        }
      }
    }

    // Findings
    if (section.findings && section.findings.length > 0) {
      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: "核查发现：",
              bold: true,
              size: 24,
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
                size: 22,
              }),
            ],
            spacing: { after: 100 },
            indent: { left: convertInchesToTwip(0.25) },
          })
        );
      }
    }

    // Issues table
    if (section.issues && section.issues.length > 0) {
      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: "发现的问题与风险：",
              bold: true,
              size: 24,
            }),
          ],
          spacing: { before: 300, after: 200 },
        })
      );

      const tableRows: TableRow[] = [
        // Header row
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: "序号", bold: true, size: 20 })] })],
              width: { size: 8, type: WidthType.PERCENTAGE },
            }),
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: "事实", bold: true, size: 20 })] })],
              width: { size: 30, type: WidthType.PERCENTAGE },
            }),
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: "问题/风险", bold: true, size: 20 })] })],
              width: { size: 25, type: WidthType.PERCENTAGE },
            }),
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: "建议", bold: true, size: 20 })] })],
              width: { size: 27, type: WidthType.PERCENTAGE },
            }),
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: "级别", bold: true, size: 20 })] })],
              width: { size: 10, type: WidthType.PERCENTAGE },
            }),
          ],
        }),
      ];

      section.issues.forEach((issue, idx) => {
        tableRows.push(
          new TableRow({
            children: [
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: String(idx + 1), size: 20 })] })],
              }),
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: issue.fact, size: 20 })] })],
              }),
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: issue.risk, size: 20 })] })],
              }),
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: issue.suggestion, size: 20 })] })],
              }),
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: severityToChinese(issue.severity), size: 20 })] })],
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

    // Source files
    if (section.sourceFiles && section.sourceFiles.length > 0) {
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
              text: section.sourceFiles.join("、"),
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
