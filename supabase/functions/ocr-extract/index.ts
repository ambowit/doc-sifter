import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildSignedHeaders, corsHeaders, getBearerToken, jsonResponse } from "../_shared/worker-hmac.ts";

interface SingleTaskRequest {
  fileId: string;
  mimeType?: string;
  fileName?: string;
  fileUrl?: string;
}

interface TaskRequestBody {
  files?: SingleTaskRequest[];
  fileId?: string;
  mimeType?: string;
  fileName?: string;
  fileUrl?: string;
  force?: boolean; // 强制重新入队，跳过 pending/processing 状态检查
}

interface FileRow {
  id: string;
  project_id: string;
  name: string;
  original_name: string | null;
  mime_type: string | null;
  storage_path: string;
  ocr_task_id: string | null;
  ocr_task_status: string | null;
}

interface ProjectRow {
  id: string;
  user_id: string;
}

const WORKER_TASK_TYPE = "text_extraction";
const WORKER_RESOLVER_TYPE = "signed_url_ticket";
const WORKER_APP_ID = "doc-sifter";
const DEFAULT_BATCH_SUBMIT_LIMIT = 20;
const DEFAULT_MAX_TOTAL_FILES_PER_REQUEST = 200;

function normalizeTasks(payload: TaskRequestBody): SingleTaskRequest[] {
  if (Array.isArray(payload.files)) {
    return payload.files.filter((item) => typeof item?.fileId === "string" && item.fileId.trim().length > 0);
  }

  if (typeof payload.fileId === "string" && payload.fileId.trim().length > 0) {
    return [{
      fileId: payload.fileId,
      mimeType: payload.mimeType,
      fileName: payload.fileName,
      fileUrl: payload.fileUrl,
    }];
  }

  return [];
}

function isSupportedTextExtraction(mimeType: string, fileName: string): boolean {
  const normalizedMimeType = mimeType.toLowerCase();
  const ext = fileName.split(".").pop()?.toLowerCase() || "";

  if (normalizedMimeType.includes("pdf") || ext === "pdf") return true;
  if (normalizedMimeType.startsWith("image/")) return true;
  if (normalizedMimeType.includes("word") || ext === "docx") return true;
  if (normalizedMimeType.includes("text/plain") || ext === "txt") return true;

  return false;
}

async function updateFileForSkippedExtraction(
  admin: ReturnType<typeof createClient>,
  fileId: string,
  message: string,
) {
  const now = new Date().toISOString();
  await admin
    .from("files")
    .update({
      text_summary: message,
      extracted_text: null,
      extracted_entities: [],
      ocr_processed: true,
      ocr_processed_at: now,
      ocr_task_status: null,
      ocr_task_completed_at: now,
      extraction_status: "skipped",
      extraction_method: null,
      extraction_error: message,
      extraction_completed_at: now,
    })
    .eq("id", fileId);
}

interface SubmitContext {
  admin: ReturnType<typeof createClient>;
  workerBase: string;
  workerSecret: string;
  resolverUrl: string;
  callbackUrl: string;
  force: boolean;
}

interface SubmitResult {
  fileId: string;
  status: "queued" | "skipped" | "already_processing" | "failed";
  taskId?: string;
  message?: string;
  error?: string;
}

async function submitTextExtractionTask(
  ctx: SubmitContext,
  file: FileRow,
  requestFile: SingleTaskRequest,
): Promise<SubmitResult> {
  const mimeType = (requestFile.mimeType || file.mime_type || "application/octet-stream").trim();
  const fileName = (requestFile.fileName || file.original_name || file.name || "").trim();

  if (!isSupportedTextExtraction(mimeType, fileName)) {
    const message = `暂不支持自动提取文本的文件类型: ${mimeType}`;
    await updateFileForSkippedExtraction(ctx.admin, file.id, message);
    return { fileId: file.id, status: "skipped", message };
  }

  if ((file.ocr_task_status === "pending" || file.ocr_task_status === "processing") && !ctx.force) {
    return {
      fileId: file.id,
      status: "already_processing",
      taskId: file.ocr_task_id || undefined,
      message: "文件已在后台处理中",
    };
  }

  // force 模式：先将状态重置，再重新入队
  if (ctx.force && (file.ocr_task_status === "pending" || file.ocr_task_status === "processing")) {
    await ctx.admin
      .from("files")
      .update({ ocr_task_status: "failed", ocr_task_completed_at: new Date().toISOString() })
      .eq("id", file.id);
  }

  const taskId = crypto.randomUUID();
  const requestedAt = new Date().toISOString();
  const taskPayload = {
    task_type: WORKER_TASK_TYPE,
    task_id: taskId,
    job_id: file.id,
    file_ref: file.id,
    mime_type: mimeType,
    file_name: fileName,
    requested_at: requestedAt,
    trace_id: crypto.randomUUID(),
    app_id: WORKER_APP_ID,
    resolver: {
      type: WORKER_RESOLVER_TYPE,
      url: ctx.resolverUrl,
      auth: { type: "hmac" },
    },
    callback: {
      url: ctx.callbackUrl,
      auth: { type: "hmac" },
    },
    max_chars: 120000,
    is_external: true,
  };

  const taskBody = JSON.stringify(taskPayload);
  const signedHeaders = await buildSignedHeaders(ctx.workerSecret, taskBody);
  const startedAt = Date.now();

  const workerResponse = await fetch(`${ctx.workerBase}/tasks/ocr`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...signedHeaders,
    },
    body: taskBody,
  });

  if (!workerResponse.ok) {
    const workerError = (await workerResponse.text()).slice(0, 300);
    const errorMessage = `Worker 入队失败(${workerResponse.status}): ${workerError}`;
    const now = new Date().toISOString();
    await ctx.admin
      .from("files")
      .update({
        ocr_task_id: taskId,
        ocr_task_status: "failed",
        ocr_task_completed_at: now,
        extraction_status: "failed",
        extraction_error: errorMessage,
        extraction_completed_at: now,
      })
      .eq("id", file.id);

    console.warn("[ocr-extract] worker enqueue failed", {
      fileId: file.id,
      taskId,
      status: workerResponse.status,
      elapsedMs: Date.now() - startedAt,
    });
    return { fileId: file.id, status: "failed", error: errorMessage, taskId };
  }

  const now = new Date().toISOString();
  const { error: updateError } = await ctx.admin
    .from("files")
    .update({
      ocr_task_id: taskId,
      ocr_task_status: "pending",
      ocr_task_started_at: now,
      ocr_task_completed_at: null,
      ocr_processed: false,
      ocr_processed_at: null,
      extracted_text: null,
      text_summary: null,
      extracted_entities: [],
      extraction_status: "processing",
      extraction_method: null,
      extraction_error: null,
      extraction_completed_at: null,
    })
    .eq("id", file.id);

  if (updateError) {
    return { fileId: file.id, status: "failed", error: updateError.message, taskId };
  }

  console.info("[ocr-extract] worker enqueue ok", {
    fileId: file.id,
    taskId,
    elapsedMs: Date.now() - startedAt,
  });
  return { fileId: file.id, status: "queued", taskId };
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
    const workerBase = (Deno.env.get("WORKER_BASE_URL") || "https://pre-safe-scan.oook.cn").replace(/\/$/, "");
    const workerSecret = Deno.env.get("WORKER_HMAC_SECRET");
    const batchSubmitLimit = Math.max(1, Number(Deno.env.get("OCR_BATCH_SUBMIT_LIMIT") || `${DEFAULT_BATCH_SUBMIT_LIMIT}`));
    const maxFilesPerRequest = Math.max(batchSubmitLimit, Number(Deno.env.get("MAX_TOTAL_FILES_PER_REQUEST") || `${DEFAULT_MAX_TOTAL_FILES_PER_REQUEST}`));

    if (!supabaseUrl || !serviceRoleKey || !workerSecret) {
      return jsonResponse({ error: "Server configuration missing" }, 500);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const token = getBearerToken(req);
    if (!token) {
      return jsonResponse({ error: "Missing access token" }, 401);
    }

    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) {
      return jsonResponse({ error: "Invalid access token" }, 401);
    }

    const payload = (await req.json().catch(() => ({}))) as TaskRequestBody;
    const forceRequeue = payload.force === true;
    const requestedFiles = normalizeTasks(payload);
    if (requestedFiles.length === 0) {
      return jsonResponse({ error: "至少需要一个 fileId" }, 400);
    }
    if (requestedFiles.length > maxFilesPerRequest) {
      return jsonResponse({
        error: `单次最多提交 ${maxFilesPerRequest} 个文件，请拆分后重试`,
        requested: requestedFiles.length,
        maxTotalFilesPerRequest: maxFilesPerRequest,
      }, 400);
    }

    const fileIds = [...new Set(requestedFiles.map((item) => item.fileId))];
    const { data: fileRows, error: fileError } = await admin
      .from("files")
      .select("id, project_id, name, original_name, mime_type, storage_path, ocr_task_id, ocr_task_status")
      .in("id", fileIds);

    if (fileError) {
      return jsonResponse({ error: fileError.message }, 500);
    }

    const rows = (fileRows || []) as FileRow[];
    const projectIds = [...new Set(rows.map((row) => row.project_id))];
    const { data: projectRows, error: projectError } = await admin
      .from("projects")
      .select("id, user_id")
      .in("id", projectIds);

    if (projectError) {
      return jsonResponse({ error: projectError.message }, 500);
    }

    const fileMap = new Map(rows.map((row) => [row.id, row]));
    const projectMap = new Map(((projectRows || []) as ProjectRow[]).map((row) => [row.id, row]));

    const resolverUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/worker-file-ticket`;
    const callbackUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/ocr-callback`;

    const results: Array<Record<string, unknown>> = [];
    const errors: string[] = [];
    let submitted = 0;
    let skipped = 0;
    let failed = 0;
    let alreadyProcessing = 0;
    const candidates: Array<{ file: FileRow; requestFile: SingleTaskRequest }> = [];

    for (const requestFile of requestedFiles) {
      const file = fileMap.get(requestFile.fileId);
      if (!file) {
        const errorMessage = `文件不存在: ${requestFile.fileId}`;
        failed += 1;
        errors.push(errorMessage);
        results.push({ fileId: requestFile.fileId, status: "failed", error: errorMessage });
        continue;
      }

      const project = projectMap.get(file.project_id);
      if (!project || project.user_id !== userData.user.id) {
        const errorMessage = `无权处理文件: ${file.id}`;
        failed += 1;
        errors.push(errorMessage);
        results.push({ fileId: file.id, status: "failed", error: errorMessage });
        continue;
      }

      candidates.push({ file, requestFile });
    }

    const submitContext: SubmitContext = {
      admin,
      workerBase,
      workerSecret,
      resolverUrl,
      callbackUrl,
      force: forceRequeue,
    };

    const requested = requestedFiles.length;
    const eligible = candidates.length;
    const batchCount = eligible === 0 ? 0 : Math.ceil(eligible / batchSubmitLimit);

    for (let index = 0; index < candidates.length; index += batchSubmitLimit) {
      const batch = candidates.slice(index, index + batchSubmitLimit);
      const batchStart = Date.now();
      const batchResults = await Promise.all(
        batch.map(({ file, requestFile }) => submitTextExtractionTask(submitContext, file, requestFile)),
      );

      for (const item of batchResults) {
        if (item.status === "queued") {
          submitted += 1;
        } else if (item.status === "skipped") {
          skipped += 1;
        } else if (item.status === "already_processing") {
          alreadyProcessing += 1;
        } else if (item.status === "failed") {
          failed += 1;
          if (item.error) errors.push(item.error);
        }
        results.push(item);
      }

      console.info("[ocr-extract] batch submitted", {
        batchIndex: Math.floor(index / batchSubmitLimit) + 1,
        batchSize: batch.length,
        elapsedMs: Date.now() - batchStart,
      });
    }

    return jsonResponse({
      success: true,
      requested,
      eligible,
      submitted,
      queued: submitted,
      skipped,
      failed,
      alreadyProcessing,
      alreadyQueued: alreadyProcessing,
      batchCount,
      batchSize: batchSubmitLimit,
      results,
      errors,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ocr-extract] ERROR", error);
    return jsonResponse({ error: message }, 500);
  }
});
