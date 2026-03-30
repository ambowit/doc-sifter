/**
 * Office 文件文本提取工具
 * 支持 docx, xlsx, pptx, txt 等格式
 * 使用 JSZip 解压 Office 文件（本质是 ZIP 包）
 */

import JSZip from "https://esm.sh/jszip@3.10.1";

export type ExtractionMethod = "docx" | "xlsx" | "pptx" | "txt" | "worker_ocr" | null;

/**
 * 判断文件是否需要走 Worker OCR（仅 PDF 和图片）
 */
export function needsWorkerOcr(mimeType: string, fileName: string): boolean {
  const m = mimeType.toLowerCase();
  const ext = fileName.split(".").pop()?.toLowerCase() || "";

  // PDF
  if (m.includes("pdf") || ext === "pdf") return true;

  // 图片
  if (m.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff", "tif"].includes(ext)) {
    return true;
  }

  return false;
}

/**
 * 判断文件是否可以在 Edge Function 内直接提取文本
 * 仅支持新版 Office 格式 (.docx/.xlsx/.pptx)，不支持老版本 (.doc/.xls/.ppt)
 */
export function getLocalExtractionMethod(mimeType: string, fileName: string): ExtractionMethod {
  const m = mimeType.toLowerCase();
  const ext = fileName.split(".").pop()?.toLowerCase() || "";

  // 老版本 Office 格式不支持
  if (["doc", "xls", "ppt"].includes(ext)) {
    return null;
  }

  // Word (仅 .docx)
  if (m.includes("wordprocessingml") || ext === "docx") {
    return "docx";
  }

  // Excel (仅 .xlsx)
  if (m.includes("spreadsheetml") || ext === "xlsx") {
    return "xlsx";
  }

  // PowerPoint (仅 .pptx)
  if (m.includes("presentationml") || ext === "pptx") {
    return "pptx";
  }

  // 纯文本
  if (m.includes("text/plain") || ext === "txt") {
    return "txt";
  }

  return null;
}

/**
 * 从 XML 内容中提取指定标签的文本
 */
function extractTextFromXml(xml: string, tagName: string): string[] {
  const results: string[] = [];
  // 简单正则匹配，适用于 Office XML 结构
  const regex = new RegExp(`<${tagName}[^>]*>([^<]*)</${tagName}>`, "gi");
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const text = match[1].trim();
    if (text) results.push(text);
  }
  return results;
}

/**
 * 提取 DOCX 文件文本
 * 解析 word/document.xml 中的 <w:t> 标签
 */
export async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = zip.file("word/document.xml");

  if (!documentXml) {
    throw new Error("无效的 DOCX 文件：缺少 word/document.xml");
  }

  const content = await documentXml.async("text");
  const texts = extractTextFromXml(content, "w:t");

  return texts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * 提取 XLSX 文件文本
 * 解析 xl/sharedStrings.xml 中的 <t> 标签
 */
export async function extractXlsxText(buffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const sharedStrings = zip.file("xl/sharedStrings.xml");

  if (!sharedStrings) {
    // 某些 Excel 文件可能没有 sharedStrings（全是数字/公式）
    return "";
  }

  const content = await sharedStrings.async("text");
  const texts = extractTextFromXml(content, "t");

  return texts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * 提取 PPTX 文件文本
 * 遍历 ppt/slides/slide*.xml 中的 <a:t> 标签
 */
export async function extractPptxText(buffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const allTexts: string[] = [];

  // 遍历所有 slide 文件
  const slideFiles = Object.keys(zip.files).filter(
    (name) => name.startsWith("ppt/slides/slide") && name.endsWith(".xml")
  );

  // 按文件名排序确保顺序
  slideFiles.sort((a, b) => {
    const numA = parseInt(a.match(/slide(\d+)\.xml/)?.[1] || "0", 10);
    const numB = parseInt(b.match(/slide(\d+)\.xml/)?.[1] || "0", 10);
    return numA - numB;
  });

  for (const slidePath of slideFiles) {
    const slideFile = zip.file(slidePath);
    if (slideFile) {
      const content = await slideFile.async("text");
      const texts = extractTextFromXml(content, "a:t");
      allTexts.push(...texts);
    }
  }

  return allTexts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * 提取纯文本文件
 */
export async function extractTxtText(buffer: ArrayBuffer): Promise<string> {
  const decoder = new TextDecoder("utf-8");
  return decoder.decode(buffer).trim();
}

/**
 * 检查文件是否为有效的 ZIP 格式（Office 2007+ 文件本质是 ZIP）
 */
function isValidZipFile(buffer: ArrayBuffer): boolean {
  const arr = new Uint8Array(buffer);
  // ZIP 文件魔数：PK (0x50, 0x4B)
  return arr.length > 4 && arr[0] === 0x50 && arr[1] === 0x4B;
}

/**
 * 根据提取方法执行文本提取
 */
export async function extractTextByMethod(
  method: ExtractionMethod,
  buffer: ArrayBuffer
): Promise<string> {
  // 对于 Office 格式，先检查是否为有效 ZIP（Office 2007+ 格式）
  if (method === "docx" || method === "xlsx" || method === "pptx") {
    if (!isValidZipFile(buffer)) {
      const formatMap = { docx: "Word (.doc)", xlsx: "Excel (.xls)", pptx: "PowerPoint (.ppt)" };
      throw new Error(`文件是老版本 ${formatMap[method]} 格式，暂不支持自动提取。请转换为新格式 (.${method}) 后重试`);
    }
  }

  switch (method) {
    case "docx":
      return extractDocxText(buffer);
    case "xlsx":
      return extractXlsxText(buffer);
    case "pptx":
      return extractPptxText(buffer);
    case "txt":
      return extractTxtText(buffer);
    default:
      throw new Error(`不支持的提取方法: ${method}`);
  }
}

/**
 * 生成文本摘要（取前 500 字符）
 */
export function generateTextSummary(text: string, maxLength = 500): string {
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}
