import { jsPDF } from "jspdf";
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
  BorderStyle,
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

// Export to PDF using jsPDF with Chinese font support
export async function exportToPDF(
  project: Project,
  sections: ReportSection[],
  metadata: ReportMetadata | null,
  definitions: Definition[],
  fileCount: number
): Promise<void> {
  // Create PDF with A4 size
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  // Add Chinese font - use built-in support
  // jsPDF 2.x has better Unicode support
  pdf.setFont("helvetica");
  
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - 2 * margin;
  let yPosition = margin;

  // Helper function to add new page if needed
  const checkPageBreak = (requiredHeight: number) => {
    if (yPosition + requiredHeight > pageHeight - margin) {
      pdf.addPage();
      yPosition = margin;
      return true;
    }
    return false;
  };

  // Helper to add text with word wrap
  const addText = (text: string, fontSize: number, isBold = false, indent = 0) => {
    pdf.setFontSize(fontSize);
    if (isBold) {
      pdf.setFont("helvetica", "bold");
    } else {
      pdf.setFont("helvetica", "normal");
    }
    
    const lines = pdf.splitTextToSize(text, contentWidth - indent);
    const lineHeight = fontSize * 0.5;
    
    for (const line of lines) {
      checkPageBreak(lineHeight);
      pdf.text(line, margin + indent, yPosition);
      yPosition += lineHeight;
    }
    return lines.length * lineHeight;
  };

  // Title Page
  pdf.setFontSize(24);
  pdf.setFont("helvetica", "bold");
  const title = "Legal Due Diligence Report";
  const titleWidth = pdf.getStringUnitWidth(title) * 24 / pdf.internal.scaleFactor;
  pdf.text(title, (pageWidth - titleWidth) / 2, 60);
  
  // Chinese title below
  pdf.setFontSize(16);
  const chineseTitle = "法律尽职调查报告";
  pdf.text(chineseTitle, pageWidth / 2, 75, { align: "center" });

  pdf.setFontSize(14);
  pdf.setFont("helvetica", "normal");
  const targetName = project.target || project.name;
  pdf.text(`Target: ${targetName}`, pageWidth / 2, 100, { align: "center" });
  
  const today = new Date().toLocaleDateString("zh-CN");
  pdf.text(`Date: ${today}`, pageWidth / 2, 115, { align: "center" });
  pdf.text(`Files Reviewed: ${fileCount}`, pageWidth / 2, 130, { align: "center" });

  // Add content pages
  pdf.addPage();
  yPosition = margin;

  // Table of Contents
  addText("Table of Contents", 16, true);
  yPosition += 5;
  
  sections.forEach((section, idx) => {
    addText(`${idx + 1}. ${section.title}`, 11, false, 5);
  });

  pdf.addPage();
  yPosition = margin;

  // Sections
  for (const section of sections) {
    checkPageBreak(20);
    
    // Section header
    addText(`${section.number} ${section.title}`, 14, true);
    yPosition += 3;
    
    // Content
    if (section.content) {
      addText(section.content, 10, false, 0);
      yPosition += 3;
    }
    
    // Findings
    if (section.findings && section.findings.length > 0) {
      checkPageBreak(15);
      addText("Key Findings:", 11, true);
      section.findings.forEach((finding, idx) => {
        addText(`• ${finding}`, 10, false, 5);
      });
      yPosition += 3;
    }
    
    // Issues
    if (section.issues && section.issues.length > 0) {
      checkPageBreak(15);
      addText("Issues Identified:", 11, true);
      section.issues.forEach((issue, idx) => {
        addText(`${idx + 1}. [${severityToChinese(issue.severity)}] ${issue.fact}`, 10, false, 5);
        addText(`   Risk: ${issue.risk}`, 9, false, 10);
        addText(`   Suggestion: ${issue.suggestion}`, 9, false, 10);
      });
      yPosition += 3;
    }
    
    // Source files
    if (section.sourceFiles && section.sourceFiles.length > 0) {
      checkPageBreak(10);
      addText(`Evidence Files: ${section.sourceFiles.join(", ")}`, 9, false);
    }
    
    yPosition += 10;
  }

  // Save the PDF
  const fileName = `${targetName}_Due_Diligence_Report.pdf`;
  pdf.save(fileName);
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
  sections.forEach((section, idx) => {
    docChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `${section.number || idx + 1}. ${section.title}`,
            size: 24,
          }),
        ],
        spacing: { after: 100 },
      })
    );
  });

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
