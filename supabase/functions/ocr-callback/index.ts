import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const log = (msg: string, data?: unknown) =>
  console.log(`[ocr-callback] ${msg}${data !== undefined ? " " + JSON.stringify(data) : ""}`);

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

/** 验证 Worker 回调的 HMAC 签名 */
async function verifySignature(
  secret: string,
  timestamp: string,
  nonce: string,
  bodyStr: string,
  signature: string
): Promise<boolean> {
  const canonical = `${timestamp}.${nonce}.${bodyStr}`;
  const expected = await hmacSign(secret, canonical);
  return expected === signature;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const hmacSecret = Deno.env.get("WORKER_HMAC_SECRET");
    if (!hmacSecret) {
      log("ERROR: WORKER_HMAC_SECRET not set");
      return new Response("Config error", { status: 500 });
    }

    const bodyStr = await req.text();

    // 验证签名（防止伪造回调）
    const timestamp = req.headers.get("X-Timestamp") || "";
    const nonce = req.headers.get("X-Nonce") || "";
    const signature = req.headers.get("X-Signature") || "";

    if (timestamp && nonce && signature) {
      const valid = await verifySignature(hmacSecret, timestamp, nonce, bodyStr, signature);
      if (!valid) {
        log("Invalid signature");
        return new Response("Unauthorized", { status: 401 });
      }
    } else {
      log("Missing signature headers, skipping verification");
    }

    const data = JSON.parse(bodyStr);
    log("OCR Callback received", { taskId: data.task_id, status: data.status, fileId: data.file_id });

    const fileId = data.file_id;
    if (!fileId) {
      log("Missing file_id in callback");
      return new Response("Missing file_id", { status: 400 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    if (data.status === "completed") {
      // Worker 返回的 OCR 结果
      const extractedText = data.text || data.extracted_text || "";
      const summary = data.summary || data.text_summary || extractedText.substring(0, 200);
      const entities = data.entities || [];

      const { error: updateError } = await supabaseAdmin
        .from("files")
        .update({
          ocr_task_status: "completed",
          ocr_task_completed_at: new Date().toISOString(),
          extracted_text: extractedText.substring(0, 50000),  // 限制长度
          text_summary: summary.substring(0, 500),
          extracted_entities: entities,
          ocr_processed: true,
          ocr_processed_at: new Date().toISOString(),
        })
        .eq("id", fileId);

      if (updateError) {
        log("DB update error", { error: updateError.message });
        return new Response("DB error", { status: 500 });
      }

      log("OCR completed and saved", {
        fileId,
        textLength: extractedText.length,
        entityCount: entities.length,
      });
    } else if (data.status === "failed") {
      await supabaseAdmin
        .from("files")
        .update({
          ocr_task_status: "failed",
          ocr_task_completed_at: new Date().toISOString(),
          text_summary: `OCR 处理失败: ${data.error || "未知错误"}`,
          ocr_processed: true,
          ocr_processed_at: new Date().toISOString(),
        })
        .eq("id", fileId);

      log("OCR task failed", { fileId, error: data.error });
    } else {
      // processing 等中间状态只更新 status
      await supabaseAdmin
        .from("files")
        .update({ ocr_task_status: data.status })
        .eq("id", fileId);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log("ERROR", { message: msg });
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
