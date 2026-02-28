import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { ZipReader, BlobReader, BlobWriter } from "https://deno.land/x/zipjs@v2.7.32/index.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ExtractedFileInfo {
  name: string;
  path: string;
  size: number;
  mimeType: string;
  downloadUrl: string;
  storagePath: string;
}

interface ExtractionResult {
  success: boolean;
  files: ExtractedFileInfo[];
  totalFiles: number;
  error?: string;
}

// Check if file should be extracted (skip hidden files, system files, etc.)
function shouldExtractFile(filename: string): boolean {
  const baseName = filename.split("/").pop() || filename;
  
  // Skip hidden files and directories
  if (baseName.startsWith(".")) return false;
  
  // Skip macOS system files
  if (baseName === "__MACOSX" || filename.includes("__MACOSX/")) return false;
  if (baseName === ".DS_Store") return false;
  
  // Skip Windows system files
  if (baseName === "Thumbs.db" || baseName === "desktop.ini") return false;
  
  return true;
}

// Get MIME type based on file extension
function getMimeType(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() || "";
  const mimeTypes: Record<string, string> = {
    "pdf": "application/pdf",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xls": "application/vnd.ms-excel",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "ppt": "application/vnd.ms-powerpoint",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "txt": "text/plain",
    "csv": "text/csv",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "gif": "image/gif",
    "bmp": "image/bmp",
    "webp": "image/webp",
    "svg": "image/svg+xml",
    "mp4": "video/mp4",
    "mp3": "audio/mpeg",
    "zip": "application/zip",
    "rar": "application/x-rar-compressed",
    "7z": "application/x-7z-compressed",
  };
  
  return mimeTypes[ext] || "application/octet-stream";
}

// Check if file type is supported for due diligence
function isSupportedFileType(filename: string): boolean {
  const ext = filename.toLowerCase().split(".").pop() || "";
  const supportedExtensions = [
    // Documents
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "rtf",
    // Images
    "jpg", "jpeg", "png", "gif", "bmp", "webp", "tiff", "tif",
    // Other common
    "html", "htm", "xml", "json",
  ];
  
  return supportedExtensions.includes(ext);
}

// Get pre-signed upload URL
async function getPresignedUrl(key: string, contentType: string): Promise<{ uploadUrl: string; downloadUrl: string }> {
  const bucket = Deno.env.get("SUPERUN_STORAGE_BUCKET");
  if (!bucket) {
    throw new Error("SUPERUN_STORAGE_BUCKET is not set");
  }
  
  const response = await fetch("https://superun.ai/web-api/upload/s3/preSignUrl", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket,
      key,
      expiresIn: 3600,
      contentType,
    }),
  });
  
  const { data } = await response.json();
  return {
    uploadUrl: data?.uploadUrl,
    downloadUrl: data?.downloadUrl,
  };
}

// Upload file to S3
async function uploadToS3(url: string, data: Uint8Array, contentType: string): Promise<void> {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: data,
  });
  
  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status}`);
  }
}

// Download archive from URL
async function downloadArchive(url: string): Promise<Uint8Array> {
  console.log("[extract-archive] Downloading archive from:", url.substring(0, 100));
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download archive: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  console.log("[extract-archive] Downloaded archive, size:", arrayBuffer.byteLength);
  return new Uint8Array(arrayBuffer);
}

// Extract ZIP file
async function extractZipFile(
  archiveData: Uint8Array,
  projectId: string,
  dateFolder: string
): Promise<ExtractedFileInfo[]> {
  const extractedFiles: ExtractedFileInfo[] = [];
  
  const blob = new Blob([archiveData]);
  const zipReader = new ZipReader(new BlobReader(blob));
  const entries = await zipReader.getEntries();
  
  console.log("[extract-archive] ZIP contains", entries.length, "entries");
  
  for (const entry of entries) {
    // Skip directories
    if (entry.directory) continue;
    
    const filename = entry.filename;
    
    // Skip hidden/system files
    if (!shouldExtractFile(filename)) {
      console.log("[extract-archive] Skipping system file:", filename);
      continue;
    }
    
    // Check if file type is supported
    if (!isSupportedFileType(filename)) {
      console.log("[extract-archive] Skipping unsupported file type:", filename);
      continue;
    }
    
    const baseName = filename.split("/").pop() || filename;
    const mimeType = getMimeType(baseName);
    
    try {
      // Extract file content
      const writer = new BlobWriter();
      const content = await entry.getData!(writer);
      const arrayBuffer = await content.arrayBuffer();
      const fileData = new Uint8Array(arrayBuffer);
      
      // Generate storage path
      const randomId = Math.random().toString(36).substring(2, 10);
      const extension = baseName.split(".").pop() || "bin";
      const storagePath = `${projectId}/${dateFolder}/${randomId}.${extension}`;
      
      // Get pre-signed URL and upload
      const { uploadUrl, downloadUrl } = await getPresignedUrl(storagePath, mimeType);
      await uploadToS3(uploadUrl, fileData, mimeType);
      
      extractedFiles.push({
        name: baseName,
        path: filename,
        size: fileData.length,
        mimeType,
        downloadUrl,
        storagePath,
      });
      
      console.log("[extract-archive] Extracted:", baseName, "->", storagePath);
    } catch (entryError) {
      console.error("[extract-archive] Failed to extract:", filename, entryError);
    }
  }
  
  await zipReader.close();
  return extractedFiles;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { archiveUrl, projectId, archiveType } = await req.json();
    
    if (!archiveUrl || !projectId) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing archiveUrl or projectId" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }
    
    console.log("[extract-archive] Processing archive:", archiveType, "for project:", projectId);
    
    // Download the archive
    const archiveData = await downloadArchive(archiveUrl);
    
    // Generate date folder
    const date = new Date();
    const dateFolder = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    
    let extractedFiles: ExtractedFileInfo[] = [];
    
    if (archiveType === "zip" || archiveUrl.toLowerCase().endsWith(".zip")) {
      extractedFiles = await extractZipFile(archiveData, projectId, dateFolder);
    } else if (archiveType === "rar" || archiveUrl.toLowerCase().endsWith(".rar")) {
      // RAR extraction requires native code
      // For now, return an error with instructions
      return new Response(
        JSON.stringify({
          success: false,
          files: [],
          totalFiles: 0,
          error: "RAR格式暂不支持服务端解压。建议：1) 使用WinRAR/7-Zip将RAR转换为ZIP格式后上传；2) 或者在本地解压后直接上传文件。",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    } else if (archiveType === "7z" || archiveUrl.toLowerCase().endsWith(".7z")) {
      return new Response(
        JSON.stringify({
          success: false,
          files: [],
          totalFiles: 0,
          error: "7Z格式暂不支持服务端解压。建议：1) 使用7-Zip将7Z转换为ZIP格式后上传；2) 或者在本地解压后直接上传文件。",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    } else {
      return new Response(
        JSON.stringify({ success: false, error: "Unsupported archive format" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }
    
    console.log("[extract-archive] Extraction complete:", extractedFiles.length, "files");
    
    const result: ExtractionResult = {
      success: true,
      files: extractedFiles,
      totalFiles: extractedFiles.length,
    };
    
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("[extract-archive] Error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ success: false, files: [], totalFiles: 0, error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
