import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, jsonResponse, verifyWorkerSignature } from "../_shared/worker-hmac.ts";

const log = (msg: string, data?: unknown) =>
  console.log(`[ocr-callback] ${msg}${data !== undefined ? " " + JSON.stringify(data) : ""}`);

interface CallbackPayload {
  task_id?: string;
  job_id?: string;
  file_id?: string;
  status?: string;
  text?: string;
  summary?: string;
  error?: string;
  page_count?: number;
  file_type?: string;
  extraction_source?: string;
  is_scanned_document?: boolean;
  ocr_fallback_used?: boolean;
  text_quality?: Record<string, unknown>;
  low_text_reason?: string | null;
  extraction_attempts?: Array<Record<string, unknown>>;
  trace_id?: string;
}

async function triggerAutoClassification(
  supabaseUrl: string,
  serviceRoleKey: string,
  db: ReturnType<typeof createClient>,
  fileRow: { id: string; project_id: string; chapter_id: string | null; original_name: string | null; name: string },
  extractedText: string,
  textSummary: string,
) {
  if (fileRow.chapter_id) return;
  if (!extractedText && !textSummary) return;

  const { data: chapters, error: chaptersError } = await db
    .from("chapters")
    .select("id, number, title, level")
    .eq("project_id", fileRow.project_id)
    .order("order_index", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (chaptersError) {
    log("Failed to load chapters for auto classification", { fileId: fileRow.id, error: chaptersError.message });
    return;
  }

  if (!chapters || chapters.length === 0) {
    return;
  }

  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/classify-single`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
    },
    body: JSON.stringify({
      projectId: fileRow.project_id,
      file: {
        id: fileRow.id,
        name: fileRow.original_name || fileRow.name,
        extractedText,
        textSummary,
      },
      chapters,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    log("Auto classification failed", { fileId: fileRow.id, status: response.status, body: body.slice(0, 200) });
    return;
  }

  log("Auto classification completed", { fileId: fileRow.id });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const hmacSecret = Deno.env.get("WORKER_HMAC_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const hmacTolerance = Number(Deno.env.get("HMAC_TOLERANCE_SECONDS") || "300");

    if (!hmacSecret || !supabaseUrl || !supabaseServiceKey) {
      log("ERROR: Missing required env vars");
      return jsonResponse({ error: "Config error" }, 500);
    }

    const bodyStr = await req.text();
    const hasSignature = !!(req.headers.get("X-Timestamp") && req.headers.get("X-Nonce") && req.headers.get("X-Signature"));
    if (hasSignature) {
      const valid = await verifyWorkerSignature(hmacSecret, req, bodyStr, hmacTolerance);
      if (!valid) {
        log("Invalid signature");
        return jsonResponse({ error: "Unauthorized" }, 401);
      }
    } else {
      log("Missing signature headers, skipping verification");
    }

    const data = JSON.parse(bodyStr) as CallbackPayload;
    log("OCR Callback received", { taskId: data.task_id, status: data.status, fileId: data.file_id });

    // Worker 回调可能用 file_id 或 job_id（两者都是 file.id）
    const fileId = data.file_id || data.job_id;
    if (!fileId) {
      log("Missing file_id and job_id", { data });
      return jsonResponse({ error: "Missing file_id" }, 400);
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const now = new Date().toISOString();
    const status = String(data.status || "processing");

    const { data: currentFile, error: fileLookupError } = await supabaseAdmin
      .from("files")
      .select("id, project_id, chapter_id, original_name, name")
      .eq("id", fileId)
      .maybeSingle();

    if (fileLookupError || !currentFile) {
      log("File lookup error", { fileId, error: fileLookupError?.message });
      return jsonResponse({ error: "File not found" }, 404);
    }

    if (status === "completed") {
      const extractedText = (data.text || "").slice(0, 50000);
      const summary = (data.summary || extractedText.substring(0, 200)).slice(0, 500);

      const { error: updateError } = await supabaseAdmin
        .from("files")
        .update({
          ocr_task_id: data.task_id || null,
          ocr_task_status: "completed",
          ocr_task_completed_at: now,
          extracted_text: extractedText,
          text_summary: summary,
          extracted_entities: [],
          ocr_processed: true,
          ocr_processed_at: now,
        })
        .eq("id", fileId);

      if (updateError) {
        log("DB update error", { error: updateError.message });
        return jsonResponse({ error: "DB error" }, 500);
      }

      await triggerAutoClassification(supabaseUrl, supabaseServiceKey, supabaseAdmin, currentFile, extractedText, summary);
      log("OCR completed and saved", { fileId, textLength: extractedText.length });
      return jsonResponse({ received: true });
    }

    if (status === "failed" || status === "cancelled") {
      const errorMessage = status === "cancelled" ? "任务已取消" : data.error || "未知错误";
      await supabaseAdmin
        .from("files")
        .update({
          ocr_task_id: data.task_id || null,
          ocr_task_status: "failed",
          ocr_task_completed_at: now,
          extracted_text: null,
          text_summary: null,
          extracted_entities: [],
          ocr_processed: false,
          ocr_processed_at: null,
        })
        .eq("id", fileId);

      log("OCR task failed", { fileId, error: errorMessage });
      return jsonResponse({ received: true });
    }

    const normalizedStatus = status === "queued" || status === "claimed" || status === "running"
      ? "processing"
      : status;

    await supabaseAdmin
      .from("files")
      .update({
        ocr_task_id: data.task_id || null,
        ocr_task_status: normalizedStatus,
        ocr_task_started_at: now,
      })
      .eq("id", fileId);

    return jsonResponse({ received: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log("ERROR", { message: msg });
    return jsonResponse({ error: msg }, 500);
  }
});
