import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

    // 验证用户身份
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
    const jobId = typeof payload?.jobId === "string" ? payload.jobId : "";

    if (!jobId) {
      return jsonResponse({ success: false, errorMessage: "缺少任务ID", errorCode: "MISSING_JOB_ID" }, 400);
    }

    // 检查任务是否存在且属于当前用户
    const { data: job, error: jobError } = await admin
      .from("report_generation_jobs")
      .select("id, status, user_id")
      .eq("id", jobId)
      .maybeSingle();

    if (jobError || !job) {
      return jsonResponse({ success: false, errorMessage: "任务不存在", errorCode: "JOB_NOT_FOUND" }, 404);
    }

    if (job.user_id !== userId) {
      return jsonResponse({ success: false, errorMessage: "无权取消此任务", errorCode: "FORBIDDEN" }, 403);
    }

    // 检查任务是否可以被取消
    if (job.status !== "queued" && job.status !== "running") {
      return jsonResponse({ 
        success: false, 
        errorMessage: `任务状态为 ${job.status}，无法取消`, 
        errorCode: "INVALID_STATUS" 
      }, 400);
    }

    // 更新任务状态为已取消
    const { error: updateError } = await admin
      .from("report_generation_jobs")
      .update({
        status: "cancelled",
        current_stage: "cancelled",
        progress_message: "任务已被用户取消",
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    if (updateError) {
      return jsonResponse({ 
        success: false, 
        errorMessage: updateError.message, 
        errorCode: "UPDATE_FAILED" 
      }, 500);
    }

    return jsonResponse({
      success: true,
      message: "任务已取消",
      jobId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ success: false, errorMessage: message, errorCode: "UNKNOWN_ERROR" }, 500);
  }
});
