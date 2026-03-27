import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createUploadTicket, getUploadProviderContext } from "../_shared/upload-provider.ts";

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { key, contentType } = await req.json();

    if (!key || typeof key !== "string") {
      return jsonResponse({ error: "Object key is required" }, 400);
    }

    const ctx = getUploadProviderContext();
    console.log("[fileupload] creating upload ticket", {
      provider: "supabase_storage",
      bucket: ctx.bucket,
      key,
    });

    const ticket = await createUploadTicket(ctx, key, contentType || "application/octet-stream");

    return jsonResponse({
      uploadUrl: ticket.uploadUrl,
      contentType: ticket.contentType,
      storagePath: ticket.key,
      bucket: ticket.bucket,
      provider: ticket.provider,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[fileupload] error", error);
    return jsonResponse({ error: message, provider: "supabase_storage" }, 500);
  }
});
