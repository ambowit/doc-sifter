import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

type JsonRecord = Record<string, unknown>;

function jsonResponse(body: JsonRecord, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, errorMessage: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ success: false, errorMessage: "Server configuration missing" }, 500);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const token = getBearerToken(req);
    if (!token) {
      return jsonResponse({ success: false, errorMessage: "Missing access token", errorCode: "AUTH_FAILED" }, 401);
    }

    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) {
      return jsonResponse({ success: false, errorMessage: "Invalid access token", errorCode: "AUTH_FAILED" }, 401);
    }

    const userId = userData.user.id;
    const payload = await req.json().catch(() => ({}));
    const projectId = typeof payload?.projectId === "string" ? payload.projectId : "";
    const forceRegenerate = payload?.forceRegenerate === true;

    if (!projectId) {
      return jsonResponse({ success: false, errorMessage: "缺少项目ID", errorCode: "MISSING_PROJECT_ID" }, 400);
    }

    const { data: project, error: projectError } = await admin
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("user_id", userId)
      .maybeSingle();

    if (projectError || !project) {
      return jsonResponse({ success: false, errorMessage: "项目不存在或无权限", errorCode: "PROJECT_NOT_FOUND" }, 404);
    }

    const { data: existingJob, error: existingJobError } = await admin
      .from("report_generation_jobs")
      .select("id, status")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingJobError) {
      return jsonResponse({ success: false, errorMessage: existingJobError.message, errorCode: "QUERY_FAILED" }, 500);
    }

    if (existingJob?.id) {
      // If force regenerate is requested, cancel the existing job first
      if (forceRegenerate) {
        await admin
          .from("report_generation_jobs")
          .update({
            status: "cancelled",
            current_stage: "cancelled",
            progress_message: "任务已被取消（强制重新生成）",
            completed_at: new Date().toISOString(),
          })
          .eq("id", existingJob.id);
      } else {
        return jsonResponse({
          success: false,
          errorMessage: "已有正在执行的任务",
          errorCode: "JOB_EXISTS",
          existingJobId: existingJob.id,
        });
      }
    }

    const { count: totalChapters, error: countError } = await admin
      .from("chapters")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId);

    if (countError) {
      return jsonResponse({ success: false, errorMessage: countError.message, errorCode: "COUNT_FAILED" }, 500);
    }

    const { data: insertedJob, error: insertError } = await admin
      .from("report_generation_jobs")
      .insert({
        project_id: projectId,
        user_id: userId,
        status: "queued",
        progress: 0,
        current_stage: "queued",
        progress_message: "任务已创建，等待处理...",
        total_chapters: totalChapters || 0,
        processed_chapters: 0,
        issues_found: 0,
      })
      .select("id")
      .single();

    if (insertError || !insertedJob) {
      return jsonResponse({ success: false, errorMessage: insertError?.message || "创建任务失败", errorCode: "CREATE_FAILED" }, 500);
    }

    const processResponse = await fetch(`${supabaseUrl}/functions/v1/process-report-job`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRoleKey,
        "x-internal-secret": serviceRoleKey,
      },
      body: JSON.stringify({ jobId: insertedJob.id }),
    });

    if (!processResponse.ok) {
      const processText = await processResponse.text();

      await admin
        .from("report_generation_jobs")
        .update({
          status: "failed",
          current_stage: "failed",
          progress_message: "任务调度失败",
          error_code: "PROCESS_TRIGGER_FAILED",
          error_message: processText || `HTTP ${processResponse.status}`,
          completed_at: new Date().toISOString(),
        })
        .eq("id", insertedJob.id);

      return jsonResponse({
        success: false,
        errorMessage: "任务调度失败，请重试",
        errorCode: "PROCESS_TRIGGER_FAILED",
      }, 500);
    }

    return jsonResponse({
      success: true,
      jobId: insertedJob.id,
      totalChapters: totalChapters || 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ success: false, errorMessage: message, errorCode: "UNKNOWN_ERROR" }, 500);
  }
});
