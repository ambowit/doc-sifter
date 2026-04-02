import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireProjectAccess } from "../_shared/auth.ts";
import { getStorageBucketName } from "../_shared/upload-provider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 200 });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const storageBucket = getStorageBucketName();

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Server configuration missing" }, 500);
    }

    const { projectId, storagePath } = await req.json();
    if (!projectId || typeof projectId !== "string") {
      return jsonResponse({ error: "projectId is required" }, 400);
    }
    if (!storagePath || typeof storagePath !== "string") {
      return jsonResponse({ error: "storagePath is required" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    await requireProjectAccess(req, admin, projectId);

    if (!storagePath.startsWith(`${projectId}/`)) {
      return jsonResponse({ error: "storagePath does not belong to project" }, 403);
    }

    const { data, error } = await admin.storage
      .from(storageBucket)
      .createSignedUrl(storagePath, 3600);

    if (error || !data?.signedUrl) {
      console.error("[file-download-url] failed", { bucket: storageBucket, storagePath, error });
      return jsonResponse({ error: error?.message || "Failed to create signed URL" }, 500);
    }

    return jsonResponse({
      signedUrl: data.signedUrl,
      storagePath,
      bucket: storageBucket,
      provider: "supabase_storage",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.startsWith("UNAUTHORIZED:")
      ? 401
      : message.startsWith("FORBIDDEN:")
        ? 403
        : message.startsWith("NOT_FOUND:")
          ? 404
          : 500;
    return jsonResponse({ error: message.replace(/^[A-Z_]+:\s*/, "") }, status);
  }
});
