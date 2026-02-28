import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  WidthType,
  convertInchesToTwip,
  PageOrientation,
  Header,
  Footer,
  PageNumber,
  NumberFormat,
} from "https://esm.sh/docx@8.5.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[generate-docx] ${step}${detailsStr}`);
};

// =============================================================================
// TYPE DEFINITIONS (Subset of reportTypes.ts for Edge Function)
// =============================================================================

interface HeadingStyleToken {
  font: string;
  sizePt: number;
  bold: boolean;
  spaceBeforePt: number;
  spaceAfterPt: number;
  lineSpacing: number;
  color?: string;
}

interface BodyStyleToken extends HeadingStyleToken {
  firstLineIndentCm: number;
  align?: "left" | "justify" | "center" | "right";
}

interface TableStyleConfig {
  border: "single" | "double" | "none" | "threeLines";
  borderSizePt: number;
  headerFill: string;
  cellPaddingPt: number;
  headerBold: boolean;
  align: "left" | "center" | "right";
  font: string;
  sizePt: number;
  borderColor?: string;
}

interface PageConfig {
  size: "A4" | "Letter" | "Legal";
  orientation: "portrait" | "landscape";
  margin: {
    top: number;
    bottom: number;
    left: number;
    right: number;
    unit: "cm" | "pt" | "in";
  };
  headerFooter: {
    hasHeader: boolean;
    hasFooter: boolean;
    footerHasPageNumber: boolean;
    pageNumberStyle: "center" | "right" | "left";
  };
}

interface TemplateFingerprint {
  templateId: string;
  name: string;
  version: string;
  locale: string;
  page: PageConfig;
  styles: {
    h1: HeadingStyleToken;
    h2: HeadingStyleToken;
    h3: HeadingStyleToken;
    h4?: HeadingStyleToken;
    body: BodyStyleToken;
  };
  tables: {
    default: TableStyleConfig;
  };
}

interface ContentBlock {
  blockId: string;
  type: string;
  // Different block types have different properties
  text?: string;
  style?: string;
  styleRef?: string;
  dataRef?: string;
  caption?: string;
  columns?: Array<{ key: string; label: string; width?: number }>;
  data?: Array<Record<string, unknown>>;
  definitions?: Array<{ shortName: string; fullName: string; notes?: string }>;
  items?: Array<{ text: string }>;
  listType?: "bullet" | "ordered";
  issues?: Array<{
    fact: string;
    risk: string;
    suggestion: string;
    severity: "high" | "medium" | "low";
  }>;
  missingItems?: string[];
  source?: string;
  content?: string;
}

interface SectionPlan {
  secId: string;
  number: string;
  title: string;
  level: 1 | 2 | 3 | 4;
  contentBlocks: ContentBlock[];
  children?: SectionPlan[];
}

interface ReportPlan {
  reportId: string;
  projectId: string;
  templateId: string;
  sections: SectionPlan[];
  metadata: {
    targetCompany: string;
    client: string;
    reportDate: string;
    cutoffDate: string;
    lawFirm: string;
  };
  variables: Record<string, string>;
  appendix: {
    includeEvidenceIndex: boolean;
    includeDefinitions: boolean;
    includeFileList: boolean;
  };
}

// =============================================================================
// DOCX GENERATION HELPERS
// =============================================================================

/** Convert cm to twip (1 cm = 567 twips) */
function cmToTwip(cm: number): number {
  return Math.round(cm * 567);
}

/** Convert pt to half-points (for font size) */
function ptToHalfPoints(pt: number): number {
  return pt * 2;
}

/** Get alignment type from string */
function getAlignment(align?: string): (typeof AlignmentType)[keyof typeof AlignmentType] {
  switch (align) {
    case "center": return AlignmentType.CENTER;
    case "right": return AlignmentType.RIGHT;
    case "justify": return AlignmentType.JUSTIFIED;
    default: return AlignmentType.LEFT;
  }
}

/** Get heading level from number */
function getHeadingLevel(level: number): (typeof HeadingLevel)[keyof typeof HeadingLevel] | undefined {
  switch (level) {
    case 1: return HeadingLevel.HEADING_1;
    case 2: return HeadingLevel.HEADING_2;
    case 3: return HeadingLevel.HEADING_3;
    case 4: return HeadingLevel.HEADING_4;
    default: return undefined;
  }
}

/** Convert hex color to DOCX color format (remove #) */
function formatColor(hex?: string): string {
  if (!hex) return "000000";
  return hex.replace("#", "");
}

/** Get page size dimensions */
function getPageSize(size: string): { width: number; height: number } {
  switch (size) {
    case "Letter":
      return { width: convertInchesToTwip(8.5), height: convertInchesToTwip(11) };
    case "Legal":
      return { width: convertInchesToTwip(8.5), height: convertInchesToTwip(14) };
    case "A4":
    default:
      return { width: convertInchesToTwip(8.27), height: convertInchesToTwip(11.69) };
  }
}

// =============================================================================
// CONTENT BLOCK RENDERERS
// =============================================================================

/** Render a paragraph block */
function renderParagraph(block: ContentBlock, bodyStyle: BodyStyleToken): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text: block.text || "",
        font: bodyStyle.font,
        size: ptToHalfPoints(bodyStyle.sizePt),
        bold: bodyStyle.bold,
        color: formatColor(bodyStyle.color),
      }),
    ],
    spacing: {
      before: bodyStyle.spaceBeforePt * 20,
      after: bodyStyle.spaceAfterPt * 20,
      line: bodyStyle.lineSpacing * 240,
    },
    indent: {
      firstLine: cmToTwip(bodyStyle.firstLineIndentCm),
    },
    alignment: getAlignment(bodyStyle.align),
  });
}

/** Render a template text block */
function renderTemplateTextBlock(block: ContentBlock, bodyStyle: BodyStyleToken): Paragraph[] {
  const content = block.content || "";
  const paragraphs = content.split("\n").filter((p) => p.trim());

  return paragraphs.map(
    (text) =>
      new Paragraph({
        children: [
          new TextRun({
            text: text.trim(),
            font: bodyStyle.font,
            size: ptToHalfPoints(bodyStyle.sizePt),
          }),
        ],
        spacing: {
          before: bodyStyle.spaceBeforePt * 20,
          after: bodyStyle.spaceAfterPt * 20,
          line: bodyStyle.lineSpacing * 240,
        },
        indent: {
          firstLine: cmToTwip(bodyStyle.firstLineIndentCm),
        },
        alignment: getAlignment(bodyStyle.align),
      })
  );
}

/** Render a definitions table */
function renderDefinitionsTable(
  block: ContentBlock,
  tableStyle: TableStyleConfig
): Table {
  const definitions = block.definitions || [];
  const borderStyle = tableStyle.border === "none" ? BorderStyle.NONE : BorderStyle.SINGLE;
  const borderColor = formatColor(tableStyle.borderColor);

  const headerRow = new TableRow({
    children: [
      new TableCell({
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: "简称",
                bold: tableStyle.headerBold,
                font: tableStyle.font,
                size: ptToHalfPoints(tableStyle.sizePt),
              }),
            ],
            alignment: getAlignment(tableStyle.align),
          }),
        ],
        shading: { fill: formatColor(tableStyle.headerFill) },
        width: { size: 30, type: WidthType.PERCENTAGE },
      }),
      new TableCell({
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: "全称",
                bold: tableStyle.headerBold,
                font: tableStyle.font,
                size: ptToHalfPoints(tableStyle.sizePt),
              }),
            ],
            alignment: getAlignment(tableStyle.align),
          }),
        ],
        shading: { fill: formatColor(tableStyle.headerFill) },
        width: { size: 50, type: WidthType.PERCENTAGE },
      }),
      new TableCell({
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: "备注",
                bold: tableStyle.headerBold,
                font: tableStyle.font,
                size: ptToHalfPoints(tableStyle.sizePt),
              }),
            ],
            alignment: getAlignment(tableStyle.align),
          }),
        ],
        shading: { fill: formatColor(tableStyle.headerFill) },
        width: { size: 20, type: WidthType.PERCENTAGE },
      }),
    ],
  });

  const dataRows = definitions.map(
    (def) =>
      new TableRow({
        children: [
          new TableCell({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: def.shortName,
                    font: tableStyle.font,
                    size: ptToHalfPoints(tableStyle.sizePt),
                  }),
                ],
              }),
            ],
          }),
          new TableCell({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: def.fullName,
                    font: tableStyle.font,
                    size: ptToHalfPoints(tableStyle.sizePt),
                  }),
                ],
              }),
            ],
          }),
          new TableCell({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: def.notes || "",
                    font: tableStyle.font,
                    size: ptToHalfPoints(tableStyle.sizePt),
                  }),
                ],
              }),
            ],
          }),
        ],
      })
  );

  return new Table({
    rows: [headerRow, ...dataRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: borderStyle, size: tableStyle.borderSizePt * 8, color: borderColor },
      bottom: { style: borderStyle, size: tableStyle.borderSizePt * 8, color: borderColor },
      left: { style: borderStyle, size: tableStyle.borderSizePt * 8, color: borderColor },
      right: { style: borderStyle, size: tableStyle.borderSizePt * 8, color: borderColor },
      insideHorizontal: { style: borderStyle, size: tableStyle.borderSizePt * 8, color: borderColor },
      insideVertical: { style: borderStyle, size: tableStyle.borderSizePt * 8, color: borderColor },
    },
  });
}

/** Render a data table */
function renderDataTable(
  block: ContentBlock,
  tableStyle: TableStyleConfig
): Table {
  const columns = block.columns || [];
  const data = block.data || [];
  const borderStyle = tableStyle.border === "none" ? BorderStyle.NONE : BorderStyle.SINGLE;
  const borderColor = formatColor(tableStyle.borderColor);

  const headerRow = new TableRow({
    children: columns.map(
      (col) =>
        new TableCell({
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: col.label,
                  bold: tableStyle.headerBold,
                  font: tableStyle.font,
                  size: ptToHalfPoints(tableStyle.sizePt),
                }),
              ],
              alignment: getAlignment(tableStyle.align),
            }),
          ],
          shading: { fill: formatColor(tableStyle.headerFill) },
          width: col.width ? { size: col.width, type: WidthType.PERCENTAGE } : undefined,
        })
    ),
  });

  const dataRows = data.map(
    (row) =>
      new TableRow({
        children: columns.map(
          (col) =>
            new TableCell({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: String(row[col.key] ?? ""),
                      font: tableStyle.font,
                      size: ptToHalfPoints(tableStyle.sizePt),
                    }),
                  ],
                }),
              ],
            })
        ),
      })
  );

  return new Table({
    rows: [headerRow, ...dataRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: borderStyle, size: tableStyle.borderSizePt * 8, color: borderColor },
      bottom: { style: borderStyle, size: tableStyle.borderSizePt * 8, color: borderColor },
      left: { style: borderStyle, size: tableStyle.borderSizePt * 8, color: borderColor },
      right: { style: borderStyle, size: tableStyle.borderSizePt * 8, color: borderColor },
      insideHorizontal: { style: borderStyle, size: tableStyle.borderSizePt * 8, color: borderColor },
      insideVertical: { style: borderStyle, size: tableStyle.borderSizePt * 8, color: borderColor },
    },
  });
}

/** Render a list block */
function renderList(block: ContentBlock, bodyStyle: BodyStyleToken): Paragraph[] {
  const items = block.items || [];
  const isBullet = block.listType !== "ordered";

  return items.map(
    (item, index) =>
      new Paragraph({
        children: [
          new TextRun({
            text: isBullet ? `• ${item.text}` : `${index + 1}. ${item.text}`,
            font: bodyStyle.font,
            size: ptToHalfPoints(bodyStyle.sizePt),
          }),
        ],
        spacing: {
          before: bodyStyle.spaceBeforePt * 10,
          after: bodyStyle.spaceAfterPt * 10,
        },
        indent: {
          left: cmToTwip(0.76),
          hanging: cmToTwip(0.38),
        },
      })
  );
}

/** Render an issues table */
function renderIssuesTable(
  block: ContentBlock,
  tableStyle: TableStyleConfig
): Table {
  const issues = block.issues || [];
  const borderStyle = tableStyle.border === "none" ? BorderStyle.NONE : BorderStyle.SINGLE;
  const borderColor = formatColor(tableStyle.borderColor);

  const headerRow = new TableRow({
    children: [
      new TableCell({
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: "序号",
                bold: tableStyle.headerBold,
                font: tableStyle.font,
                size: ptToHalfPoints(tableStyle.sizePt),
              }),
            ],
            alignment: AlignmentType.CENTER,
          }),
        ],
        shading: { fill: formatColor(tableStyle.headerFill) },
        width: { size: 8, type: WidthType.PERCENTAGE },
      }),
      new TableCell({
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: "事实描述",
                bold: tableStyle.headerBold,
                font: tableStyle.font,
                size: ptToHalfPoints(tableStyle.sizePt),
              }),
            ],
            alignment: AlignmentType.CENTER,
          }),
        ],
        shading: { fill: formatColor(tableStyle.headerFill) },
        width: { size: 32, type: WidthType.PERCENTAGE },
      }),
      new TableCell({
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: "风险评估",
                bold: tableStyle.headerBold,
                font: tableStyle.font,
                size: ptToHalfPoints(tableStyle.sizePt),
              }),
            ],
            alignment: AlignmentType.CENTER,
          }),
        ],
        shading: { fill: formatColor(tableStyle.headerFill) },
        width: { size: 30, type: WidthType.PERCENTAGE },
      }),
      new TableCell({
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: "建议",
                bold: tableStyle.headerBold,
                font: tableStyle.font,
                size: ptToHalfPoints(tableStyle.sizePt),
              }),
            ],
            alignment: AlignmentType.CENTER,
          }),
        ],
        shading: { fill: formatColor(tableStyle.headerFill) },
        width: { size: 22, type: WidthType.PERCENTAGE },
      }),
      new TableCell({
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: "等级",
                bold: tableStyle.headerBold,
                font: tableStyle.font,
                size: ptToHalfPoints(tableStyle.sizePt),
              }),
            ],
            alignment: AlignmentType.CENTER,
          }),
        ],
        shading: { fill: formatColor(tableStyle.headerFill) },
        width: { size: 8, type: WidthType.PERCENTAGE },
      }),
    ],
  });

  const dataRows = issues.map(
    (issue, index) =>
      new TableRow({
        children: [
          new TableCell({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: String(index + 1),
                    font: tableStyle.font,
                    size: ptToHalfPoints(tableStyle.sizePt),
                  }),
                ],
                alignment: AlignmentType.CENTER,
              }),
            ],
          }),
          new TableCell({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: issue.fact,
                    font: tableStyle.font,
                    size: ptToHalfPoints(tableStyle.sizePt),
                  }),
                ],
              }),
            ],
          }),
          new TableCell({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: issue.risk,
                    font: tableStyle.font,
                    size: ptToHalfPoints(tableStyle.sizePt),
                  }),
                ],
              }),
            ],
          }),
          new TableCell({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: issue.suggestion,
                    font: tableStyle.font,
                    size: ptToHalfPoints(tableStyle.sizePt),
                  }),
                ],
              }),
            ],
          }),
          new TableCell({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: issue.severity === "high" ? "高" : issue.severity === "medium" ? "中" : "低",
                    font: tableStyle.font,
                    size: ptToHalfPoints(tableStyle.sizePt),
                    color: issue.severity === "high" ? "CC0000" : issue.severity === "medium" ? "CC6600" : "006600",
                    bold: issue.severity === "high",
                  }),
                ],
                alignment: AlignmentType.CENTER,
              }),
            ],
          }),
        ],
      })
  );

  return new Table({
    rows: [headerRow, ...dataRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: borderStyle, size: tableStyle.borderSizePt * 8, color: borderColor },
      bottom: { style: borderStyle, size: tableStyle.borderSizePt * 8, color: borderColor },
      left: { style: borderStyle, size: tableStyle.borderSizePt * 8, color: borderColor },
      right: { style: borderStyle, size: tableStyle.borderSizePt * 8, color: borderColor },
      insideHorizontal: { style: borderStyle, size: tableStyle.borderSizePt * 8, color: borderColor },
      insideVertical: { style: borderStyle, size: tableStyle.borderSizePt * 8, color: borderColor },
    },
  });
}

/** Render missing notice block */
function renderMissingNotice(block: ContentBlock, bodyStyle: BodyStyleToken): Paragraph {
  const missingItems = block.missingItems || [];
  const text = block.text || "以下资料缺失：";

  return new Paragraph({
    children: [
      new TextRun({
        text: `${text}\n${missingItems.map((item, i) => `${i + 1}. ${item}`).join("\n")}`,
        font: bodyStyle.font,
        size: ptToHalfPoints(bodyStyle.sizePt),
        color: "CC6600",
        italics: true,
      }),
    ],
    spacing: {
      before: bodyStyle.spaceBeforePt * 20,
      after: bodyStyle.spaceAfterPt * 20,
    },
    shading: { fill: "FFF8E1" },
    indent: { left: cmToTwip(0.5), right: cmToTwip(0.5) },
  });
}

// =============================================================================
// SECTION RENDERER
// =============================================================================

/** Render a section and its content blocks */
function renderSection(
  section: SectionPlan,
  fingerprint: TemplateFingerprint,
  docChildren: (Paragraph | Table)[]
): void {
  const { styles, tables } = fingerprint;
  const headingStyle = styles[`h${section.level}` as keyof typeof styles] as HeadingStyleToken;
  const bodyStyle = styles.body;
  const tableStyle = tables.default;

  // Add section heading
  const headingText = section.number ? `${section.number} ${section.title}` : section.title;
  docChildren.push(
    new Paragraph({
      text: headingText,
      heading: getHeadingLevel(section.level),
      spacing: {
        before: headingStyle.spaceBeforePt * 20,
        after: headingStyle.spaceAfterPt * 20,
      },
    })
  );

  // Render content blocks
  for (const block of section.contentBlocks) {
    switch (block.type) {
      case "paragraph":
        docChildren.push(renderParagraph(block, bodyStyle));
        break;

      case "template_text_block":
        docChildren.push(...renderTemplateTextBlock(block, bodyStyle));
        break;

      case "definitions_table":
        docChildren.push(renderDefinitionsTable(block, tableStyle));
        break;

      case "table":
        docChildren.push(renderDataTable(block, tableStyle));
        break;

      case "list":
        docChildren.push(...renderList(block, bodyStyle));
        break;

      case "issues_table":
        docChildren.push(renderIssuesTable(block, tableStyle));
        break;

      case "missing_notice":
        docChildren.push(renderMissingNotice(block, bodyStyle));
        break;

      case "figure":
        // Figures are rendered as placeholder paragraphs (image insertion requires additional handling)
        docChildren.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `[图表: ${block.caption || "未命名"}]`,
                font: bodyStyle.font,
                size: ptToHalfPoints(bodyStyle.sizePt),
                italics: true,
                color: "666666",
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { before: 200, after: 200 },
          })
        );
        break;

      default:
        // Unknown block type - skip
        logStep("Unknown block type", { type: block.type });
    }
  }

  // Render child sections recursively
  if (section.children && section.children.length > 0) {
    for (const child of section.children) {
      renderSection(child, fingerprint, docChildren);
    }
  }
}

// =============================================================================
// MAIN DOCUMENT GENERATOR
// =============================================================================

/** Generate DOCX document from ReportPlan and TemplateFingerprint */
async function generateDocument(
  reportPlan: ReportPlan,
  fingerprint: TemplateFingerprint
): Promise<Uint8Array> {
  const { page, styles } = fingerprint;
  const pageSize = getPageSize(page.size);

  // Prepare document children
  const docChildren: (Paragraph | Table)[] = [];

  // Add title page
  docChildren.push(
    new Paragraph({
      children: [
        new TextRun({
          text: "法律尽职调查报告",
          bold: true,
          size: ptToHalfPoints(24),
          font: styles.h1.font,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 2000, after: 400 },
    })
  );

  docChildren.push(
    new Paragraph({
      children: [
        new TextRun({
          text: reportPlan.metadata.targetCompany,
          bold: true,
          size: ptToHalfPoints(18),
          font: styles.h1.font,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 1000 },
    })
  );

  // Add metadata info
  const metadataInfo = [
    `委托方：${reportPlan.metadata.client}`,
    `报告日期：${reportPlan.metadata.reportDate}`,
    `截止日期：${reportPlan.metadata.cutoffDate}`,
    `出具单位：${reportPlan.metadata.lawFirm}`,
  ];

  for (const info of metadataInfo) {
    docChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: info,
            size: ptToHalfPoints(12),
            font: styles.body.font,
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
      })
    );
  }

  // Add page break after title
  docChildren.push(
    new Paragraph({
      children: [],
      pageBreakBefore: true,
    })
  );

  // Render all sections
  for (const section of reportPlan.sections) {
    renderSection(section, fingerprint, docChildren);
  }

  // Create footer with page numbers if configured
  const footerChildren: Paragraph[] = [];
  if (page.headerFooter.footerHasPageNumber) {
    footerChildren.push(
      new Paragraph({
        children: [
          new TextRun({ text: "第 " }),
          new TextRun({
            children: [PageNumber.CURRENT],
          }),
          new TextRun({ text: " 页" }),
        ],
        alignment: getAlignment(page.headerFooter.pageNumberStyle),
      })
    );
  }

  // Build the document
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              width: page.orientation === "landscape" ? pageSize.height : pageSize.width,
              height: page.orientation === "landscape" ? pageSize.width : pageSize.height,
              orientation: page.orientation === "landscape" ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
            },
            margin: {
              top: cmToTwip(page.margin.top),
              bottom: cmToTwip(page.margin.bottom),
              left: cmToTwip(page.margin.left),
              right: cmToTwip(page.margin.right),
            },
          },
        },
        headers: page.headerFooter.hasHeader
          ? {
              default: new Header({
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: `${reportPlan.metadata.targetCompany} - 法律尽职调查报告`,
                        size: ptToHalfPoints(9),
                        color: "666666",
                      }),
                    ],
                    alignment: AlignmentType.RIGHT,
                  }),
                ],
              }),
            }
          : undefined,
        footers: page.headerFooter.hasFooter
          ? {
              default: new Footer({
                children: footerChildren,
              }),
            }
          : undefined,
        children: docChildren,
      },
    ],
    styles: {
      default: {
        heading1: {
          run: {
            font: styles.h1.font,
            size: ptToHalfPoints(styles.h1.sizePt),
            bold: styles.h1.bold,
            color: formatColor(styles.h1.color),
          },
          paragraph: {
            spacing: {
              before: styles.h1.spaceBeforePt * 20,
              after: styles.h1.spaceAfterPt * 20,
            },
          },
        },
        heading2: {
          run: {
            font: styles.h2.font,
            size: ptToHalfPoints(styles.h2.sizePt),
            bold: styles.h2.bold,
            color: formatColor(styles.h2.color),
          },
          paragraph: {
            spacing: {
              before: styles.h2.spaceBeforePt * 20,
              after: styles.h2.spaceAfterPt * 20,
            },
          },
        },
        heading3: {
          run: {
            font: styles.h3.font,
            size: ptToHalfPoints(styles.h3.sizePt),
            bold: styles.h3.bold,
            color: formatColor(styles.h3.color),
          },
          paragraph: {
            spacing: {
              before: styles.h3.spaceBeforePt * 20,
              after: styles.h3.spaceAfterPt * 20,
            },
          },
        },
        document: {
          run: {
            font: styles.body.font,
            size: ptToHalfPoints(styles.body.sizePt),
          },
        },
      },
    },
  });

  // Generate buffer
  const buffer = await Packer.toBuffer(doc);
  return new Uint8Array(buffer);
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { reportPlan, templateFingerprint } = await req.json();

    logStep("Starting DOCX generation", {
      reportId: reportPlan?.reportId,
      templateId: templateFingerprint?.templateId,
      sectionsCount: reportPlan?.sections?.length,
    });

    // Validate input
    if (!reportPlan || !templateFingerprint) {
      return new Response(
        JSON.stringify({ error: "Missing reportPlan or templateFingerprint" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Generate document
    const docxBuffer = await generateDocument(reportPlan, templateFingerprint);

    logStep("DOCX generated successfully", { size: docxBuffer.length });

    // Return as base64 encoded string
    const base64 = btoa(String.fromCharCode(...docxBuffer));

    return new Response(
      JSON.stringify({
        success: true,
        docx: base64,
        filename: `${reportPlan.metadata.targetCompany}_尽调报告_${reportPlan.metadata.reportDate}.docx`,
        size: docxBuffer.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
