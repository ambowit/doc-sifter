import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  // Handle CORS preflight - must return 200 with proper headers
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 200 });
  }

  try {
    const { key, contentType } = await req.json();

    if (!key) {
      return new Response(
        JSON.stringify({ error: "Object key is required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const bucket = Deno.env.get("SUPERUN_STORAGE_BUCKET");
    if (!bucket) {
      return new Response(
        JSON.stringify({ error: "SUPERUN_STORAGE_BUCKET is not set" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    // Call Superun's internal pre-sign service
    const response = await fetch("https://superun.ai/web-api/upload/s3/preSignUrl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket,
        key,
        expiresIn: 3600,
        contentType: contentType || "application/octet-stream",
      }),
    });

    const result = await response.json();
    const { data } = result || {};
    const { uploadUrl, contentType: returnedContentType, downloadUrl } = data || {};

    if (!uploadUrl) {
      console.error("Pre-sign response:", result);
      return new Response(
        JSON.stringify({ error: "Failed to get pre-signed URL" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    return new Response(
      JSON.stringify({ uploadUrl, contentType: returnedContentType, downloadUrl }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    console.error("Pre-sign error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
