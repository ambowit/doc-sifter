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

// Max file size for OCR processing (10MB for PDF, 5MB for images)
const MAX_PDF_SIZE = 10 * 1024 * 1024;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

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

// Call SuperunAI with image/document for OCR with retry
async function extractTextWithAI(
  apiKey: string,
  fileUrl: string,
  mimeType: string,
  fileName: string,
  retries = 2
): Promise<{ text: string; summary: string; entities: string[] }> {
  
  const isImage = mimeType.startsWith("image/");
  const isPdf = mimeType === "application/pdf";
  const maxSize = isPdf ? MAX_PDF_SIZE : MAX_IMAGE_SIZE;
  
  // For PDF files, we need to download and convert to base64
  let imageUrl = fileUrl;
  let fileSize = 0;
  
  if (isPdf) {
    logStep("Downloading PDF for base64 conversion");
    const result = await downloadAsBase64(fileUrl, mimeType, maxSize);
    imageUrl = result.data;
    fileSize = result.size;
    logStep("PDF converted to base64", { sizeMB: Math.round(fileSize / 1024 / 1024 * 10) / 10 });
  } else if (isImage) {
    // For images, check size first
    logStep("Downloading image for size check");
    const result = await downloadAsBase64(fileUrl, mimeType, maxSize);
    imageUrl = result.data;
    fileSize = result.size;
    logStep("Image loaded", { sizeMB: Math.round(fileSize / 1024 / 1024 * 10) / 10 });
  }
  
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
        const response = await fetch("https://gateway.superun.ai/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gemini-2.5-flash",
            messages: [{ role: "user", content: messageContent }],
            temperature: 0.1,
            max_tokens: 16000,
          }),
          signal: controller.signal,
        });
        
        clearTimeout(timeout);

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`AI 服务错误: ${response.status} - ${errorText.substring(0, 100)}`);
        }

        const result = await response.json();
        const content = result.choices?.[0]?.message?.content || "";
        
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
    const apiKey = Deno.env.get("SUPERUN_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "AI API key not configured" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    // Check if mime type is supported
    const supportedImageTypes = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
    const supportedDocTypes = ["application/pdf"];
    const allSupportedTypes = [...supportedImageTypes, ...supportedDocTypes];
    
    const isSupported = allSupportedTypes.some(t => 
      mimeType.includes(t.split("/")[1]) || mimeType === t
    );
    
    if (!isSupported) {
      logStep("Unsupported file type", { mimeType });
      
      // Update database to mark as processed (but skipped)
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

    // Extract text using AI vision
    logStep("Starting OCR extraction");
    const result = await extractTextWithAI(apiKey, fileUrl, mimeType, fileName);
    
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
