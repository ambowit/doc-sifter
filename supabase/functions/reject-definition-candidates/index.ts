import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireProjectAccess } from "../_shared/auth.ts";
import { corsHeaders, jsonResponse } from "../_shared/worker-hmac.ts";

interface RejectRequest {
  projectId?: string;
  candidateIds?: string[];
}

function respondFromError(error: Error) {
  const message = error.message || "Unknown error";
  if (message.startsWith("UNAUTHORIZED:")) return jsonResponse({ error: message.replace("UNAUTHORIZED: ", "") }, 401);
  if (message.startsWith("FORBIDDEN:")) return jsonResponse({ error: message.replace("FORBIDDEN: ", "") }, 403);
  if (message.startsWith("NOT_FOUND:")) return jsonResponse({ error: message.replace("NOT_FOUND: ", "") }, 404);
  return jsonResponse({ error: message }, 500);
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
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Server configuration missing" }, 500);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = (await req.json().catch(() => ({}))) as RejectRequest;
    const projectId = body.projectId?.trim();
    const candidateIds = [...new Set((body.candidateIds || []).filter((id): id is string => typeof id === "string" && id.trim().length > 0))];
    if (!projectId || candidateIds.length === 0) {
      return jsonResponse({ error: "projectId and candidateIds are required" }, 400);
    }

    await requireProjectAccess(req, admin, projectId);

    const { data, error } = await admin
      .from("definition_candidates")
      .update({ status: "rejected", updated_at: new Date().toISOString() })
      .eq("project_id", projectId)
      .in("id", candidateIds)
      .neq("status", "approved")
      .select("id");

    if (error) {
      return jsonResponse({ error: error.message }, 500);
    }

    return jsonResponse({ success: true, rejected: data?.length || 0 });
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    console.error("[reject-definition-candidates] ERROR", normalized);
    return respondFromError(normalized);
  }
});
