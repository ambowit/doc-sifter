import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

// 图片文件大小限制 (3MB)
const MAX_IMAGE_SIZE = 3 * 1024 * 1024;

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

// 提交 PDF 到 Worker 异步处理
async function submitPdfToWorker(
  fileId: string,
  fileUrl: string,
  fileName: string,
  mimeType: string
): Promise<{ taskId: string }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const workerBase = (Deno.env.get("WORKER_BASE_URL") || "https://pre-safe-scan.oook.cn").replace(/\/$/, "");
  const hmacSecret = Deno.env.get("WORKER_HMAC_SECRET");

  if (!hmacSecret) {
    throw new Error("WORKER_HMAC_SECRET not configured");
  }

  const callbackUrl = `${supabaseUrl}/functions/v1/ocr-callback`;

  // task_type=ocr 表示只需要文本提取，不需要脱敏
  const payload = JSON.stringify({
    file_url: fileUrl,
    file_id: fileId,
    file_name: fileName || "document.pdf",
    mime_type: mimeType || "application/pdf",
    task_type: "ocr",
    callback_url: callbackUrl,
  });

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID();
  const canonical = `${timestamp}.${nonce}.${payload}`;
  const signature = await hmacSign(hmacSecret, canonical);

  logStep("Submitting PDF to Worker", { fileId, fileName, callbackUrl });

  const workerRes = await fetch(`${workerBase}/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Timestamp": timestamp,
      "X-Nonce": nonce,
      "X-Signature": signature,
    },
    body: payload,
  });

  const responseText = await workerRes.text();
  logStep("Worker response", { status: workerRes.status, bodyPrefix: responseText.substring(0, 200) });

  let workerData;
  try {
    workerData = JSON.parse(responseText);
  } catch {
    throw new Error(`Worker returned non-JSON: ${responseText.substring(0, 100)}`);
  }

  if (!workerRes.ok || workerData.status === "error") {
    const errMsg = workerData.error?.message || workerData.message || `HTTP ${workerRes.status}`;
    throw new Error(`Worker error: ${errMsg}`);
  }

  const taskId = workerData.task_id || workerData.id;

  // 更新数据库状态
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  await supabase
    .from("files")
    .update({
      ocr_task_id: taskId,
      ocr_task_status: "pending",
      ocr_task_started_at: new Date().toISOString(),
    })
    .eq("id", fileId);

  return { taskId };
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
  
  // 下载图片并转 base64
  logStep("Downloading image for OCR");
  const result = await downloadAsBase64(fileUrl, mimeType, MAX_IMAGE_SIZE);
  const imageUrl = result.data;
  logStep("Image loaded", { sizeMB: Math.round(result.size / 1024 / 1024 * 10) / 10 });
  
  // Build message content with image
  const messageContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
  
  // Add the image/document
  messageContent.push({
    type: "image_url",
    image_url: { url: imageUrl }
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
    
    if (!isPdf && !isImage) {
      logStep("Unsupported file type", { mimeType });
      
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      
      await supabase
        .from("files")
        .update({
          text_summary: `不支持的文件类型: ${mimeType}`,
          ocr_processed: true,
          ocr_processed_at: new Date().toISOString()
        })
        .eq("id", fileId);
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          text: "", 
          summary: `不支持的文件类型: ${mimeType}`,
          entities: [],
          skipped: true
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // PDF 文件走 Worker 异步处理（无大小限制）
    if (isPdf) {
      logStep("PDF detected, submitting to Worker for async processing");
      try {
        const { taskId } = await submitPdfToWorker(fileId, fileUrl, fileName, mimeType);
        return new Response(
          JSON.stringify({ 
            success: true, 
            async: true,
            taskId,
            message: "PDF 已提交异步处理，结果将通过回调更新"
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 202 }
        );
      } catch (workerError) {
        const errMsg = workerError instanceof Error ? workerError.message : String(workerError);
        logStep("Worker submission failed", { error: errMsg });
        return new Response(
          JSON.stringify({ error: `PDF 处理失败: ${errMsg}` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
        );
      }
    }

    // 图片文件使用 AI Gateway 同步处理
    logStep("Image detected, processing with AI Gateway");
    const result = await extractImageTextWithAI(apiKey, fileUrl, mimeType, fileName);
    
    logStep("OCR complete", { 
      textLength: result.text.length, 
      entitiesCount: result.entities.length 
    });

    // Initialize Supabase client to update file record
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Update file record with extracted text
    const { error: updateError } = await supabase
      .from("files")
      .update({
        extracted_text: result.text.substring(0, 50000), // Limit to 50K chars
        text_summary: result.summary,
        extracted_entities: result.entities,
        ocr_processed: true,
        ocr_processed_at: new Date().toISOString()
      })
      .eq("id", fileId);

    if (updateError) {
      logStep("Failed to update file record", { error: updateError });
      return new Response(
        JSON.stringify({ 
          error: `保存结果失败: ${updateError.message}`,
          text: result.text,
          summary: result.summary,
          entities: result.entities
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    logStep("Database updated successfully", { fileId });

    return new Response(
      JSON.stringify({ 
        success: true, 
        text: result.text,
        summary: result.summary,
        entities: result.entities
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
