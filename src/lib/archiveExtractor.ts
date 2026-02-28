import JSZip from "jszip";

export interface ExtractedFile {
  name: string;
  path: string;
  file: File;
  size: number;
  isDirectory: boolean;
}

export interface ExtractionResult {
  success: boolean;
  files: ExtractedFile[];
  totalFiles: number;
  error?: string;
}

export type ExtractionProgressCallback = (progress: number, currentFile: string) => void;

// Check if file is an archive by MIME type or extension
export function isArchiveFile(file: File): boolean {
  const archiveTypes = [
    "application/zip",
    "application/x-zip-compressed",
    "application/x-compressed",
    "application/x-rar-compressed",
    "application/vnd.rar",
    "application/x-7z-compressed",
    "application/octet-stream", // Some browsers report this for archives
  ];
  
  const archiveExtensions = [".zip", ".rar", ".7z"];
  const fileName = file.name.toLowerCase();
  
  // Check by MIME type
  if (archiveTypes.includes(file.type)) {
    return true;
  }
  
  // Check by extension
  if (archiveExtensions.some(ext => fileName.endsWith(ext))) {
    return true;
  }
  
  return false;
}

// Async check for archive by reading file header (magic bytes)
export async function detectArchiveType(file: File): Promise<"zip" | "rar" | "7z" | null> {
  try {
    const headerBytes = await readFileHeader(file, 8);
    
    // ZIP: starts with PK (0x50 0x4B)
    if (headerBytes[0] === 0x50 && headerBytes[1] === 0x4B) {
      console.log("[Archive] Detected ZIP by magic bytes");
      return "zip";
    }
    
    // RAR: starts with Rar! (0x52 0x61 0x72 0x21)
    if (headerBytes[0] === 0x52 && headerBytes[1] === 0x61 && 
        headerBytes[2] === 0x72 && headerBytes[3] === 0x21) {
      console.log("[Archive] Detected RAR by magic bytes");
      return "rar";
    }
    
    // 7z: starts with 7z¼¯' (0x37 0x7A 0xBC 0xAF 0x27 0x1C)
    if (headerBytes[0] === 0x37 && headerBytes[1] === 0x7A && 
        headerBytes[2] === 0xBC && headerBytes[3] === 0xAF) {
      console.log("[Archive] Detected 7z by magic bytes");
      return "7z";
    }
    
    return null;
  } catch (error) {
    console.error("[Archive] Error detecting archive type:", error);
    return null;
  }
}

// Read first N bytes of a file
async function readFileHeader(file: File, bytes: number): Promise<Uint8Array> {
  const slice = file.slice(0, bytes);
  const arrayBuffer = await slice.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

// Check if file is a ZIP archive
export function isZipFile(file: File): boolean {
  const zipTypes = [
    "application/zip",
    "application/x-zip-compressed",
    "application/x-compressed",
  ];
  
  const fileName = file.name.toLowerCase();
  return zipTypes.includes(file.type) || fileName.endsWith(".zip");
}

// Check if file is a RAR archive
export function isRarFile(file: File): boolean {
  const rarTypes = [
    "application/x-rar-compressed",
    "application/vnd.rar",
  ];
  
  const fileName = file.name.toLowerCase();
  return rarTypes.includes(file.type) || fileName.endsWith(".rar");
}

// Check if file is a 7z archive
export function is7zFile(file: File): boolean {
  const fileName = file.name.toLowerCase();
  return file.type === "application/x-7z-compressed" || fileName.endsWith(".7z");
}

// Get file extension
function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  return lastDot > 0 ? filename.substring(lastDot).toLowerCase() : "";
}

// Supported file extensions for due diligence
const SUPPORTED_EXTENSIONS = [
  // Documents
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".txt", ".csv", ".rtf", ".odt", ".ods",
  // Images
  ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tiff", ".tif",
  // Other common
  ".html", ".htm", ".xml", ".json",
];

// Check if file should be extracted (skip hidden files, system files, etc.)
function shouldExtractFile(filename: string): boolean {
  const baseName = filename.split("/").pop()?.split("\\").pop() || filename;
  
  // Skip hidden files and directories
  if (baseName.startsWith(".")) return false;
  
  // Skip macOS system files
  if (baseName === "__MACOSX" || filename.includes("__MACOSX/") || filename.includes("__MACOSX\\")) return false;
  if (baseName === ".DS_Store") return false;
  
  // Skip Windows system files
  if (baseName === "Thumbs.db" || baseName === "desktop.ini") return false;
  
  // Check if file extension is supported
  const ext = getFileExtension(baseName);
  if (ext && !SUPPORTED_EXTENSIONS.includes(ext)) {
    console.log(`[Archive] Skipping unsupported file type: ${baseName} (${ext})`);
    return false;
  }
  
  return true;
}

// Get MIME type based on file extension
function getMimeType(filename: string): string {
  const ext = getFileExtension(filename);
  const mimeTypes: Record<string, string> = {
    // Documents
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".rtf": "application/rtf",
    ".odt": "application/vnd.oasis.opendocument.text",
    ".ods": "application/vnd.oasis.opendocument.spreadsheet",
    // Images
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".webp": "image/webp",
    ".tiff": "image/tiff",
    ".tif": "image/tiff",
    ".svg": "image/svg+xml",
    // Archives
    ".zip": "application/zip",
    ".rar": "application/x-rar-compressed",
    ".7z": "application/x-7z-compressed",
    // Other
    ".html": "text/html",
    ".htm": "text/html",
    ".xml": "application/xml",
    ".json": "application/json",
  };
  
  return mimeTypes[ext] || "application/octet-stream";
}

// Extract ZIP file
export async function extractZipFile(
  file: File,
  onProgress?: ExtractionProgressCallback
): Promise<ExtractionResult> {
  try {
    console.log("[Archive] Extracting ZIP file:", file.name);
    onProgress?.(0, "正在读取压缩包...");
    
    const zip = new JSZip();
    const zipContent = await zip.loadAsync(file);
    
    const extractedFiles: ExtractedFile[] = [];
    const entries = Object.entries(zipContent.files);
    const totalEntries = entries.length;
    let processedEntries = 0;
    
    for (const [relativePath, zipEntry] of entries) {
      processedEntries++;
      const progress = Math.round((processedEntries / totalEntries) * 100);
      
      // Skip directories and hidden/system files
      if (zipEntry.dir || !shouldExtractFile(relativePath)) {
        continue;
      }
      
      const fileName = relativePath.split("/").pop() || relativePath;
      onProgress?.(progress, `正在解压: ${fileName}`);
      
      try {
        const content = await zipEntry.async("blob");
        const mimeType = getMimeType(fileName);
        const extractedFile = new File([content], fileName, { type: mimeType });
        
        extractedFiles.push({
          name: fileName,
          path: relativePath,
          file: extractedFile,
          size: extractedFile.size,
          isDirectory: false,
        });
        
        console.log(`[Archive] Extracted: ${fileName} (${extractedFile.size} bytes)`);
      } catch (entryError) {
        console.error(`[Archive] Failed to extract ${relativePath}:`, entryError);
      }
    }
    
    onProgress?.(100, "解压完成");
    
    console.log(`[Archive] Extraction complete: ${extractedFiles.length} files extracted out of ${totalEntries} total entries`);
    
    return {
      success: true,
      files: extractedFiles,
      totalFiles: extractedFiles.length,
    };
  } catch (error) {
    console.error("[Archive] ZIP extraction error:", error);
    return {
      success: false,
      files: [],
      totalFiles: 0,
      error: error instanceof Error ? error.message : "解压失败",
    };
  }
}

// RAR file extraction is not supported in browser due to WASM complexity
// Users should convert RAR to ZIP or extract locally
export async function extractRarFile(
  file: File,
  onProgress?: ExtractionProgressCallback
): Promise<ExtractionResult> {
  console.log("[Archive] RAR file detected:", file.name);
  onProgress?.(100, "RAR 格式不支持在线解压");
  
  return {
    success: false,
    files: [],
    totalFiles: 0,
    error: "RAR 格式暂不支持在线解压\n\n建议：\n1. 使用 WinRAR 或 7-Zip 将 RAR 转换为 ZIP 格式后上传\n2. 或者在本地解压后直接上传文件",
  };
}

// Main extraction function
export async function extractArchive(
  file: File,
  onProgress?: ExtractionProgressCallback
): Promise<ExtractionResult> {
  console.log("[Archive] Starting extraction for:", file.name, file.type);
  
  if (isZipFile(file)) {
    return extractZipFile(file, onProgress);
  }
  
  if (isRarFile(file)) {
    // RAR requires WASM which doesn't work reliably in all browsers
    // Return helpful error message instead
    return {
      success: false,
      files: [],
      totalFiles: 0,
      error: "RAR 格式暂不支持在线解压\n\n建议：\n1. 使用 WinRAR 或 7-Zip 将 RAR 转换为 ZIP 格式后上传\n2. 或者在本地解压后直接上传文件",
    };
  }
  
  if (is7zFile(file)) {
    // 7z requires native code for proper extraction
    return {
      success: false,
      files: [],
      totalFiles: 0,
      error: "7Z 格式暂不支持在线解压。建议：1) 使用 7-Zip 将 7Z 转换为 ZIP 格式后上传；2) 或者在本地解压后直接上传文件",
    };
  }
  
  return {
    success: false,
    files: [],
    totalFiles: 0,
    error: "不支持的压缩格式",
  };
}

// Utility to check if we can extract this archive type
export function canExtractArchive(file: File): { canExtract: boolean; reason?: string } {
  if (isZipFile(file)) {
    return { canExtract: true };
  }
  
  if (isRarFile(file)) {
    return { 
      canExtract: false, 
      reason: "RAR 格式暂不支持在线解压。建议：使用 WinRAR/7-Zip 转换为 ZIP 格式，或在本地解压后上传" 
    };
  }
  
  if (is7zFile(file)) {
    return { 
      canExtract: false, 
      reason: "7Z 格式不支持在线解压。建议：使用 7-Zip 转换为 ZIP 格式，或在本地解压后上传" 
    };
  }
  
  return { canExtract: false, reason: "不支持的压缩格式" };
}
