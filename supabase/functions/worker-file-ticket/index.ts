import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getStorageBucketName } from "../_shared/upload-provider.ts";
import { corsHeaders, jsonResponse, verifyWorkerSignature } from "../_shared/worker-hmac.ts";

interface TicketRequest {
  file_ref?: string;
  task_id?: string;
  job_id?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const workerSecret = Deno.env.get("WORKER_HMAC_SECRET");
    const storageBucket = getStorageBucketName();
    const hmacTolerance = Number(Deno.env.get("HMAC_TOLERANCE_SECONDS") || "300");

    if (!supabaseUrl || !serviceRoleKey || !workerSecret) {
      return jsonResponse({ error: "Server configuration missing" }, 500);
    }

    const body = await req.text();
    const isValid = await verifyWorkerSignature(workerSecret, req, body, hmacTolerance);
    if (!isValid) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const payload = (body ? JSON.parse(body) : {}) as TicketRequest;
    if (!payload.file_ref || !payload.task_id) {
      return jsonResponse({ error: "file_ref and task_id are required" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: file, error } = await admin
      .from("files")
      .select("id, mime_type, original_name, name, storage_path, ocr_task_id")
      .eq("id", payload.file_ref)
      .maybeSingle();

    if (error) {
      return jsonResponse({ error: error.message }, 500);
    }

    if (!file) {
      return jsonResponse({ error: "File not found" }, 404);
    }

    // 校验 task_id：如果数据库有记录则必须匹配，如果为 null 则允许通过并更新
    if (file.ocr_task_id && file.ocr_task_id !== payload.task_id) {
      console.warn("[worker-file-ticket] task mismatch", { fileId: file.id, expected: file.ocr_task_id, received: payload.task_id });
      return jsonResponse({ error: "Task mismatch" }, 403);
    }

    // 如果 ocr_task_id 为空，说明任务提交时没有保存成功，现在补充保存
    if (!file.ocr_task_id && payload.task_id) {
      await admin
        .from("files")
        .update({ ocr_task_id: payload.task_id, ocr_task_status: "processing" })
        .eq("id", file.id);
      console.info("[worker-file-ticket] backfilled ocr_task_id", { fileId: file.id, taskId: payload.task_id });
    }

    const { data: signedUrlData, error: signedUrlError } = await admin.storage
      .from(storageBucket)
      .createSignedUrl(file.storage_path, 900);

    if (signedUrlError || !signedUrlData?.signedUrl) {
      return jsonResponse({ error: signedUrlError?.message || "Failed to create signed URL" }, 500);
    }

    return jsonResponse({
      success: true,
      file_url: signedUrlData.signedUrl,
      mime_type: file.mime_type,
      file_name: file.original_name || file.name,
      storage_path: file.storage_path,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[worker-file-ticket] ERROR", error);
    return jsonResponse({ error: message }, 500);
  }
});
