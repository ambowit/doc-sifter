import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildSignedHeaders, corsHeaders, getBearerToken, jsonResponse } from "../_shared/worker-hmac.ts";
import {
  extractTextByMethod,
  generateTextSummary,
  getLocalExtractionMethod,
  needsWorkerOcr,
} from "../_shared/office-extract.ts";
import { getStorageBucketName } from "../_shared/upload-provider.ts";

interface SingleTaskRequest {
  fileId: string;
  mimeType?: string;
  fileName?: string;
}

interface TaskRequestBody {
  files?: SingleTaskRequest[];
  fileId?: string;
  mimeType?: string;
  fileName?: string;
  force?: boolean;
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

function normalizeTasks(payload: TaskRequestBody): SingleTaskRequest[] {
  if (Array.isArray(payload.files)) {
    return payload.files.filter((item) => typeof item?.fileId === "string" && item.fileId.trim().length > 0);
  }
  if (typeof payload.fileId === "string" && payload.fileId.trim().length > 0) {
    return [{ fileId: payload.fileId, mimeType: payload.mimeType, fileName: payload.fileName }];
  }
  return [];
}

// 下载文件
async function downloadFile(
  admin: ReturnType<typeof createClient>,
  storagePath: string,
): Promise<ArrayBuffer> {
  const bucket = getStorageBucketName();
  const { data, error } = await admin.storage.from(bucket).download(storagePath);
  if (error || !data) {
    throw new Error(`下载文件失败: ${error?.message || "未知错误"}`);
  }
  return data.arrayBuffer();
}

// 处理单个文件
async function processFile(
  admin: ReturnType<typeof createClient>,
  file: FileRow,
  mimeType: string,
  fileName: string,
  workerBase: string,
  workerSecret: string,
  resolverUrl: string,
  callbackUrl: string,
  force: boolean,
): Promise<void> {
  const now = () => new Date().toISOString();

  // 1. 检查是否可以本地提取
  const localMethod = getLocalExtractionMethod(mimeType, fileName);
  if (localMethod) {
    try {
      const buffer = await downloadFile(admin, file.storage_path);
      const extractedText = await extractTextByMethod(localMethod, buffer);
      const summary = generateTextSummary(extractedText);

      await admin.from("files").update({
        extracted_text: extractedText,
        text_summary: summary,
        ocr_processed: true,
        ocr_processed_at: now(),
        ocr_task_status: "completed",
        ocr_task_completed_at: now(),
        extraction_method: localMethod,
      }).eq("id", file.id);
      return;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await admin.from("files").update({
        ocr_task_status: "failed",
        ocr_task_completed_at: now(),
        text_summary: `提取失败: ${errorMsg}`,
      }).eq("id", file.id);
      return;
    }
  }

  // 2. PDF/图片走 Worker OCR
  if (needsWorkerOcr(mimeType, fileName)) {
    if ((file.ocr_task_status === "pending" || file.ocr_task_status === "processing") && !force) {
      return; // 已在处理中
    }

    const taskId = crypto.randomUUID();
    const taskPayload = {
      task_type: WORKER_TASK_TYPE,
      task_id: taskId,
      job_id: file.id,
      file_ref: file.id,
      mime_type: mimeType,
      file_name: fileName,
      requested_at: now(),
      trace_id: crypto.randomUUID(),
      app_id: WORKER_APP_ID,
      resolver: { type: WORKER_RESOLVER_TYPE, url: resolverUrl, auth: { type: "hmac" } },
      callback: { url: callbackUrl, auth: { type: "hmac" } },
      max_chars: 120000,
      is_external: true,
      ...(force ? { force: true } : {}),
    };

    const taskBody = JSON.stringify(taskPayload);
    const signedHeaders = await buildSignedHeaders(workerSecret, taskBody);

    const workerResponse = await fetch(`${workerBase}/tasks/ocr`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...signedHeaders },
      body: taskBody,
    });

    if (workerResponse.ok || workerResponse.status === 409) {
      await admin.from("files").update({
        ocr_task_id: taskId,
        ocr_task_status: "pending",
        ocr_task_started_at: now(),
        ocr_task_completed_at: null,
        ocr_processed: false,
      }).eq("id", file.id);
    } else {
      const workerError = (await workerResponse.text()).slice(0, 200);
      await admin.from("files").update({
        ocr_task_id: taskId,
        ocr_task_status: "failed",
        ocr_task_completed_at: now(),
        text_summary: `Worker 入队失败: ${workerError}`,
      }).eq("id", file.id);
    }
    return;
  }

  // 3. 不支持的类型
  await admin.from("files").update({
    text_summary: `暂不支持自动提取: ${mimeType}`,
    ocr_processed: true,
    ocr_processed_at: now(),
    ocr_task_status: null,
  }).eq("id", file.id);
}

// 后台批量处理
async function processFilesInBackground(
  admin: ReturnType<typeof createClient>,
  candidates: Array<{ file: FileRow; mimeType: string; fileName: string }>,
  workerBase: string,
  workerSecret: string,
  resolverUrl: string,
  callbackUrl: string,
  force: boolean,
): Promise<void> {
  for (const { file, mimeType, fileName } of candidates) {
    try {
      await processFile(admin, file, mimeType, fileName, workerBase, workerSecret, resolverUrl, callbackUrl, force);
    } catch (error) {
      console.error(`[ocr-extract] Process file ${file.id} error:`, error);
    }
  }
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
    const force = payload.force === true;
    const requestedFiles = normalizeTasks(payload);

    if (requestedFiles.length === 0) {
      return jsonResponse({ error: "至少需要一个 fileId" }, 400);
    }
    if (requestedFiles.length > 200) {
      return jsonResponse({ error: "单次最多提交 200 个文件" }, 400);
    }

    // 查询文件和项目
    const fileIds = [...new Set(requestedFiles.map((f) => f.fileId))];
    const { data: fileRows, error: fileError } = await admin
      .from("files")
      .select("id, project_id, name, original_name, mime_type, storage_path, ocr_task_id, ocr_task_status")
      .in("id", fileIds);

    if (fileError) {
      return jsonResponse({ error: fileError.message }, 500);
    }

    const rows = (fileRows || []) as FileRow[];
    const projectIds = [...new Set(rows.map((r) => r.project_id))];
    const { data: projectRows } = await admin.from("projects").select("id, user_id").in("id", projectIds);
    const projectMap = new Map(((projectRows || []) as ProjectRow[]).map((r) => [r.id, r]));
    const fileMap = new Map(rows.map((r) => [r.id, r]));

    // 筛选有权限的文件
    const candidates: Array<{ file: FileRow; mimeType: string; fileName: string }> = [];
    for (const req of requestedFiles) {
      const file = fileMap.get(req.fileId);
      if (!file) continue;
      const project = projectMap.get(file.project_id);
      if (!project || project.user_id !== userData.user.id) continue;

      const mimeType = (req.mimeType || file.mime_type || "application/octet-stream").trim();
      const fileName = (req.fileName || file.original_name || file.name || "").trim();
      candidates.push({ file, mimeType, fileName });
    }

    if (candidates.length === 0) {
      return jsonResponse({ error: "没有可处理的文件" }, 400);
    }

    // 立即将文件状态设为 processing
    const candidateIds = candidates.map((c) => c.file.id);
    await admin.from("files").update({
      ocr_task_status: "processing",
      ocr_task_started_at: new Date().toISOString(),
    }).in("id", candidateIds);

    // 构建后台处理上下文
    const resolverUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/worker-file-ticket`;
    const callbackUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/ocr-callback`;

    // 使用 EdgeRuntime.waitUntil 在后台异步处理
    // @ts-ignore Deno EdgeRuntime API
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(
        processFilesInBackground(admin, candidates, workerBase, workerSecret, resolverUrl, callbackUrl, force)
      );
    } else {
      // Fallback: 同步处理（本地测试时）
      await processFilesInBackground(admin, candidates, workerBase, workerSecret, resolverUrl, callbackUrl, force);
    }

    // 立即返回，不等待处理完成
    return jsonResponse({
      success: true,
      message: "任务已提交，正在后台处理",
      accepted: candidates.length,
      fileIds: candidateIds,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ocr-extract] ERROR", error);
    return jsonResponse({ error: message }, 500);
  }
});
