import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
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

function mapJobRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    status: row.status,
    progress: row.progress,
    currentStage: row.current_stage,
    progressMessage: row.progress_message,
    processedChapters: row.processed_chapters,
    totalChapters: row.total_chapters,
    issuesFound: row.issues_found,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    reportId: row.report_id,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function mapReportRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    reportJson: row.report_json,
    status: row.status,
    version: row.version,
    totalChapters: row.total_chapters,
    totalFiles: row.total_files,
    issuesFound: row.issues_found,
    evidenceFileCount: row.evidence_file_count,
    citationCoverage: row.citation_coverage,
  };
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
    const jobId = typeof payload?.jobId === "string" ? payload.jobId : "";

    if (!jobId) {
      return jsonResponse({ success: false, errorMessage: "缺少任务ID", errorCode: "MISSING_JOB_ID" }, 400);
    }

    const { data: jobRow, error: jobError } = await admin
      .from("report_generation_jobs")
      .select("*")
      .eq("id", jobId)
      .eq("user_id", userId)
      .maybeSingle();

    if (jobError || !jobRow) {
      return jsonResponse({ success: false, errorMessage: "任务不存在或无权限", errorCode: "JOB_NOT_FOUND" }, 404);
    }

    let report = null as Record<string, unknown> | null;

    if (jobRow.status === "succeeded") {
      if (jobRow.report_id) {
        const { data: reportById } = await admin
          .from("generated_reports")
          .select("*")
          .eq("id", jobRow.report_id)
          .eq("user_id", userId)
          .maybeSingle();

        if (reportById) {
          report = mapReportRow(reportById as Record<string, unknown>);
        }
      }

      if (!report) {
        const { data: latestReport } = await admin
          .from("generated_reports")
          .select("*")
          .eq("project_id", jobRow.project_id)
          .eq("user_id", userId)
          .maybeSingle();

        if (latestReport) {
          report = mapReportRow(latestReport as Record<string, unknown>);
        }
      }
    }

    return jsonResponse({
      success: true,
      job: mapJobRow(jobRow as Record<string, unknown>),
      report,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ success: false, errorMessage: message, errorCode: "UNKNOWN_ERROR" }, 500);
  }
});
