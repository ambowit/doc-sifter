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

    const { fileId, projectId, storagePath } = await req.json();
    if (!fileId || typeof fileId !== "string") {
      return jsonResponse({ error: "fileId is required" }, 400);
    }
    if (!projectId || typeof projectId !== "string") {
      return jsonResponse({ error: "projectId is required" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    await requireProjectAccess(req, admin, projectId);

    const { data: file, error: fileError } = await admin
      .from("files")
      .select("id, project_id, storage_path")
      .eq("id", fileId)
      .eq("project_id", projectId)
      .maybeSingle();

    if (fileError) {
      return jsonResponse({ error: fileError.message }, 500);
    }

    if (!file) {
      return jsonResponse({ error: "File not found" }, 404);
    }

    const targetPath = file.storage_path || storagePath;
    if (targetPath) {
      const { error: removeError } = await admin.storage.from(storageBucket).remove([targetPath]);
      if (removeError) {
        console.error("[delete-file] storage remove failed", { bucket: storageBucket, targetPath, removeError });
        return jsonResponse({ error: removeError.message }, 500);
      }
    }

    const { error: deleteError } = await admin
      .from("files")
      .delete()
      .eq("id", fileId)
      .eq("project_id", projectId);

    if (deleteError) {
      return jsonResponse({ error: deleteError.message }, 500);
    }

    return jsonResponse({
      success: true,
      fileId,
      projectId,
      storagePath: targetPath || null,
      bucket: storageBucket,
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
