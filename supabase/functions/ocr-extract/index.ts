import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ZipReader, BlobReader, TextWriter } from "https://deno.land/x/zipjs@v2.7.32/index.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[ocr-extract] ${step}${detailsStr}`);
};

interface OCRRequest {
  fileId: string;
  fileUrl: string;
  mimeType: string;
  fileName: string;
}

// 图片文件大小限制 (1.5MB，base64 编码后约 2MB，避免 AI Gateway 413 错误)
const MAX_IMAGE_SIZE = 1.5 * 1024 * 1024;

// HMAC 签名函数
async function hmacSign(secret: string, canonical: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(canonical));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// 使用 Worker /extract-text 同步接口提取 PDF 文本（带重试）
async function extractPdfWithWorker(
  fileId: string,
  fileUrl: string,
  fileName: string,
  maxRetries = 2
): Promise<{ text: string; summary: string; pageCount: number; isScanned: boolean }> {
  const workerBase = (Deno.env.get("WORKER_BASE_URL") || "https://pre-safe-scan.oook.cn").replace(/\/$/, "");
  const hmacSecret = Deno.env.get("WORKER_HMAC_SECRET");

  if (!hmacSecret) {
    throw new Error("WORKER_HMAC_SECRET not configured");
  }

  logStep("Extracting PDF with Worker", { fileId, fileName, workerBase });

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      logStep(`Retry attempt ${attempt}/${maxRetries}`);
      await new Promise(r => setTimeout(r, 2000 * attempt)); // 指数退避
    }

    // 每次重试都重新生成签名（因为 timestamp 变了）
    const payload = JSON.stringify({
      file_url: fileUrl,
      max_chars: 120000,
    });

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = crypto.randomUUID();
    const canonical = `${timestamp}.${nonce}.${payload}`;
    const signature = await hmacSign(hmacSecret, canonical);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000); // 2 分钟超时

    try {
      const workerRes = await fetch(`${workerBase}/extract-text`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Timestamp": timestamp,
          "X-Nonce": nonce,
          "X-Signature": signature,
        },
        body: payload,
        signal: controller.signal,
      });

      const responseText = await workerRes.text();
      logStep("Worker response", { status: workerRes.status, bodyLength: responseText.length });

      // 502/503/504 网关错误，可重试
      if (workerRes.status >= 502 && workerRes.status <= 504) {
        lastError = new Error(`Worker 网关错误 (HTTP ${workerRes.status})，请稍后重试`);
        logStep(`Gateway error, will retry`, { status: workerRes.status });
        continue;
      }

      let workerData;
      try {
        workerData = JSON.parse(responseText);
      } catch {
        // 非 JSON 响应（如 HTML 错误页），可能是网关问题，可重试
        if (responseText.includes("<!DOCTYPE") || responseText.includes("<html")) {
          lastError = new Error(`Worker 返回 HTML 错误页 (可能是网关问题)`);
          logStep(`HTML response, will retry`);
          continue;
        }
        throw new Error(`Worker 返回非 JSON: ${responseText.substring(0, 100)}`);
      }

      // 检查错误状态
      if (!workerRes.ok || workerData.status === "error") {
        const errMsg = workerData.error?.message || workerData.message || `HTTP ${workerRes.status}`;
        throw new Error(errMsg);
      }

      // 解析结果
      const result = workerData.result || workerData;
      const text = result.text || "";
      const pageCount = result.page_count || 0;
      const isScanned = result.is_scanned_document || false;

      const summary = text.substring(0, 200).replace(/\s+/g, " ").trim();

      logStep("PDF extraction complete", { 
        textLength: text.length, 
        pageCount, 
        isScanned 
      });

      return { text, summary, pageCount, isScanned };
    } catch (err) {
      clearTimeout(timeout);
      
      if (err instanceof Error && err.name === "AbortError") {
        lastError = new Error("Worker 处理超时，请稍后重试");
      } else {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
      
      // 超时错误不重试
      if (lastError.message.includes("超时")) {
        throw lastError;
      }
      
      logStep(`Attempt ${attempt} failed`, { error: lastError.message });
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error("PDF 提取失败");
}

// Convert ArrayBuffer to base64
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

async function extractTextFromDocxBuffer(buffer: ArrayBuffer): Promise<string> {
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  const zipReader = new ZipReader(new BlobReader(blob));

  try {
    const entries = await zipReader.getEntries();
    const documentEntry = entries.find((entry) => entry.filename === "word/document.xml");
    if (!documentEntry?.getData) {
      return "";
    }

    const xmlContent = await documentEntry.getData(new TextWriter());
    return xmlContent
      .replace(/<w:p[^>]*>/g, "\n\n")
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^\s+|\s+$/gm, "")
      .trim();
  } finally {
    await zipReader.close();
  }
}

async function extractDocumentText(
  fileUrl: string,
  mimeType: string,
  fileName: string,
): Promise<{ text: string; summary: string; entities: string[] }> {
  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`下载失败: HTTP ${response.status}`);
  }

  const lowerMimeType = mimeType.toLowerCase();
  const ext = fileName.split(".").pop()?.toLowerCase() || "";

  let text = "";
  if (lowerMimeType.includes("word") || ext === "docx") {
    const buffer = await response.arrayBuffer();
    text = await extractTextFromDocxBuffer(buffer);
  } else if (lowerMimeType.includes("text/plain") || ext === "txt") {
    text = await response.text();
  } else {
    throw new Error(`暂不支持自动提取文本的文件类型: ${mimeType}`);
  }

  const normalizedText = text.replace(/\s+\n/g, "\n").trim();
  return {
    text: normalizedText,
    summary: normalizedText.substring(0, 200).replace(/\s+/g, " ").trim(),
    entities: [],
  };
}

// Download file with timeout and size check
async function downloadAsBase64(
  url: string, 
  mimeType: string, 
  maxSize: number
): Promise<{ data: string; size: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout
  
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`下载失败: HTTP ${response.status}`);
    }
    
    // Check content length header first
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > maxSize) {
      throw new Error(`文件过大 (${Math.round(parseInt(contentLength) / 1024 / 1024)}MB)，最大支持 ${Math.round(maxSize / 1024 / 1024)}MB`);
    }
    
    const buffer = await response.arrayBuffer();
    
    // Check actual size
    if (buffer.byteLength > maxSize) {
      throw new Error(`文件过大 (${Math.round(buffer.byteLength / 1024 / 1024)}MB)，最大支持 ${Math.round(maxSize / 1024 / 1024)}MB`);
    }
    
    const base64 = arrayBufferToBase64(buffer);
    return { 
      data: `data:${mimeType};base64,${base64}`,
      size: buffer.byteLength 
    };
  } finally {
    clearTimeout(timeout);
  }
}

// 使用 AI Gateway 处理图片 OCR（仅图片，PDF 走 Worker）
async function extractImageTextWithAI(
  apiKey: string,
  fileUrl: string,
  mimeType: string,
  fileName: string,
  retries = 2
): Promise<{ text: string; summary: string; entities: string[] }> {
  
  // 直接使用图片 URL，不转 base64（避免 413 请求体过大）
  logStep("Processing image via URL", { fileUrl: fileUrl.substring(0, 100) + "..." });
  
  // Build message content with image URL
  const messageContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
  
  // Add the image/document (直接使用原始 URL)
  messageContent.push({
    type: "image_url",
    image_url: { url: fileUrl }
  });
  
  // Add the prompt
  messageContent.push({
    type: "text",
    text: `请仔细阅读这份文件（${fileName}），提取所有文字内容。

请按以下JSON格式返回：
{
  "text": "文件的完整文字内容（保持原文格式和结构）",
  "summary": "文件内容摘要（100字以内）",
  "entities": ["提取的关键实体，如公司名称、人名、日期、金额、百分比等"]
}

要求：
1. 完整提取所有可见文字，包括表格、列表、标题等
2. 保持原文的段落结构
3. 如果有数字、百分比、金额等，请准确提取
4. 如果是扫描件或图片，尽可能识别所有文字
5. 直接输出JSON，不要添加其他说明`
  });

  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        logStep(`Retry attempt ${attempt}/${retries}`);
        // Wait before retry (exponential backoff)
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
      
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 55000); // 55s timeout for AI call
      
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
              messages: [{ role: "user", content: messageContent }],
              temperature: 0.1,
              max_tokens: 16000,
            },
            constraints: { maxCost: 0.05 },
          }),
          signal: controller.signal,
        });
        
        clearTimeout(timeout);

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`AI服务错误: ${response.status} - ${errorText.substring(0, 100)}`);
        }

        const result = await response.json();
        // Handle OOOK Gateway response format
        const content = result.result?.choices?.[0]?.message?.content || 
                       result.choices?.[0]?.message?.content ||
                       result.result?.content ||
                       result.content || "";
        
        // Parse JSON response
        try {
          let jsonStr = content.trim();
          const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (jsonMatch) jsonStr = jsonMatch[1].trim();
          
          const jsonStart = jsonStr.indexOf("{");
          const jsonEnd = jsonStr.lastIndexOf("}");
          if (jsonStart !== -1 && jsonEnd !== -1) {
            jsonStr = jsonStr.substring(jsonStart, jsonEnd + 1);
          }
          
          const parsed = JSON.parse(jsonStr);
          return {
            text: parsed.text || content,
            summary: parsed.summary || "",
            entities: Array.isArray(parsed.entities) ? parsed.entities : []
          };
        } catch {
          // If JSON parsing fails, return raw content
          return {
            text: content,
            summary: content.substring(0, 100),
            entities: []
          };
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Don't retry on certain errors
      if (lastError.message.includes("文件过大") || 
          lastError.message.includes("下载失败")) {
        throw lastError;
      }
      
      // Check if it's an abort error (timeout)
      if (lastError.name === "AbortError") {
        lastError = new Error("AI 处理超时，请稍后重试");
      }
      
      logStep(`Attempt ${attempt} failed`, { error: lastError.message });
    }
  }
  
  throw lastError || new Error("OCR 处理失败");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { fileId, fileUrl, mimeType, fileName } = await req.json() as OCRRequest;
    
    logStep("OCR request received", { fileId, fileName, mimeType });

    if (!fileId || !fileUrl) {
      return new Response(
        JSON.stringify({ error: "fileId and fileUrl are required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
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

    // 判断文件类型
    const supportedImageTypes = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
    const isPdf = mimeType === "application/pdf" || mimeType.includes("pdf");
    const isImage = supportedImageTypes.some(t => mimeType.includes(t.split("/")[1]) || mimeType === t);
    const isDocx = mimeType.includes("word") || fileName.toLowerCase().endsWith(".docx");
    const isTxt = mimeType.includes("text/plain") || fileName.toLowerCase().endsWith(".txt");

    if (!isPdf && !isImage && !isDocx && !isTxt) {
      logStep("Unsupported file type", { mimeType });
      
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      
      await supabase
        .from("files")
        .update({
          text_summary: `暂不支持自动提取文本的文件类型: ${mimeType}`,
          ocr_processed: true,
          ocr_processed_at: new Date().toISOString()
        })
        .eq("id", fileId);
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          text: "", 
          summary: `暂不支持自动提取文本的文件类型: ${mimeType}`,
          entities: [],
          skipped: true
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // 初始化 Supabase 客户端
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let extractedText = "";
    let textSummary = "";
    let extractedEntities: string[] = [];

    // PDF 文件使用 Worker /extract-text 同步处理
    if (isPdf) {
      logStep("PDF detected, extracting with Worker");
      try {
        const pdfResult = await extractPdfWithWorker(fileId, fileUrl, fileName);
        extractedText = pdfResult.text;
        textSummary = pdfResult.summary;
        // Worker 不返回实体，留空
        extractedEntities = [];
        
        logStep("PDF OCR complete", { 
          textLength: extractedText.length, 
          pageCount: pdfResult.pageCount,
          isScanned: pdfResult.isScanned
        });
      } catch (workerError) {
        const errMsg = workerError instanceof Error ? workerError.message : String(workerError);
        logStep("Worker extraction failed", { error: errMsg });
        return new Response(
          JSON.stringify({ error: `PDF 处理失败: ${errMsg}` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
        );
      }
    } else if (isImage) {
      // 图片文件使用 AI Gateway 同步处理
      logStep("Image detected, processing with AI Gateway");
      const imageResult = await extractImageTextWithAI(apiKey, fileUrl, mimeType, fileName);
      extractedText = imageResult.text;
      textSummary = imageResult.summary;
      extractedEntities = imageResult.entities;
      
      logStep("Image OCR complete", { 
        textLength: extractedText.length, 
        entitiesCount: extractedEntities.length 
      });
    } else {
      logStep("Document detected, extracting text directly", { mimeType, fileName });
      const documentResult = await extractDocumentText(fileUrl, mimeType, fileName);
      extractedText = documentResult.text;
      textSummary = documentResult.summary;
      extractedEntities = documentResult.entities;

      logStep("Document text extraction complete", {
        textLength: extractedText.length,
      });
    }

    // Update file record with extracted text
    const { error: updateError } = await supabase
      .from("files")
      .update({
        extracted_text: extractedText.substring(0, 50000), // Limit to 50K chars
        text_summary: textSummary,
        extracted_entities: extractedEntities,
        ocr_processed: true,
        ocr_processed_at: new Date().toISOString()
      })
      .eq("id", fileId);

    if (updateError) {
      logStep("Failed to update file record", { error: updateError });
      return new Response(
        JSON.stringify({ 
          error: `保存结果失败: ${updateError.message}`,
          text: extractedText,
          summary: textSummary,
          entities: extractedEntities
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    logStep("Database updated successfully", { fileId });

    return new Response(
      JSON.stringify({ 
        success: true, 
        text: extractedText,
        summary: textSummary,
        entities: extractedEntities
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
