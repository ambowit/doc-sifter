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
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ success: false, error: "Server configuration missing" }, 500);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const token = getBearerToken(req);
    if (!token) {
      return jsonResponse({ success: false, error: "Missing access token" }, 401);
    }

    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) {
      return jsonResponse({ success: false, error: "Invalid access token" }, 401);
    }

    const userId = userData.user.id;
    const payload = await req.json().catch(() => ({}));
    const jobId = typeof payload?.jobId === "string" ? payload.jobId : "";

    if (!jobId) {
      return jsonResponse({ success: false, error: "Missing jobId" }, 400);
    }

    // Get job status
    const { data: job, error: jobError } = await admin
      .from("report_generation_jobs")
      .select("*")
      .eq("id", jobId)
      .eq("user_id", userId)
      .maybeSingle();

    if (jobError) {
      return jsonResponse({ success: false, error: jobError.message }, 500);
    }

    if (!job) {
      return jsonResponse({ success: false, error: "Job not found" }, 404);
    }

    return jsonResponse({
      success: true,
      job: {
        id: job.id,
        status: job.status,
        progress: job.progress,
        currentStage: job.current_stage,
        progressMessage: job.progress_message,
        totalChapters: job.total_chapters,
        processedChapters: job.processed_chapters,
        issuesFound: job.issues_found,
        reportId: job.report_id,
        errorCode: job.error_code,
        errorMessage: job.error_message,
        createdAt: job.created_at,
        startedAt: job.started_at,
        completedAt: job.completed_at,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ success: false, error: message }, 500);
  }
});
