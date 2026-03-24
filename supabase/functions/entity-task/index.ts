import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { decode } from "https://deno.land/x/djwt@v3.0.1/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const log = (msg: string, data?: unknown) =>
  console.log(`[entity-task] ${msg}${data !== undefined ? " " + JSON.stringify(data) : ""}`);

async function hmacSign(secret: string, canonical: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(canonical));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

/** 从 Authorization header 提取用户 ID，不需要网络请求 */
function extractUserIdFromJwt(authHeader: string): string | null {
  try {
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const [, payload] = decode(token);
    const sub = (payload as Record<string, unknown>).sub;
    return typeof sub === "string" ? sub : null;
  } catch (e) {
    log("JWT decode error", { error: String(e) });
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const workerBase = (Deno.env.get("WORKER_BASE_URL") || "https://pre-safe-scan.oook.cn").replace(/\/$/, "");
    const hmacSecret = Deno.env.get("WORKER_HMAC_SECRET");

    if (!hmacSecret) {
      log("ERROR: WORKER_HMAC_SECRET not set");
      return new Response(
        JSON.stringify({ error: "WORKER_HMAC_SECRET not configured" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    const authHeader = req.headers.get("Authorization") || "";
    log("Auth header prefix", { prefix: authHeader.substring(0, 20) });

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      log("Missing or invalid Authorization header");
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }

    // 直接解码 JWT 提取 user_id，不需要网络请求验证
    const userId = extractUserIdFromJwt(authHeader);
    if (!userId) {
      log("Cannot extract user_id from JWT");
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }

    log("User identified", { userId });

    const reqBody = await req.json();
    const { fileId, fileUrl, fileName } = reqBody;

    if (!fileId || !fileUrl) {
      return new Response(
        JSON.stringify({ error: "fileId and fileUrl are required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // 验证文件所有权
    const { data: file, error: fileError } = await supabaseAdmin
      .from("files")
      .select("id, projects!inner(user_id)")
      .eq("id", fileId)
      .single();

    if (fileError || !file) {
      log("File not found", { fileId, error: fileError?.message });
      return new Response(
        JSON.stringify({ error: "File not found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 }
      );
    }
    if ((file.projects as { user_id: string }).user_id !== userId) {
      log("Access denied", { fileUserId: (file.projects as { user_id: string }).user_id, requestUserId: userId });
      return new Response(
        JSON.stringify({ error: "Access denied" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 403 }
      );
    }

    // callback_url 指向 entity-callback 函数
    const callbackUrl = `${supabaseUrl}/functions/v1/entity-callback`;

    // 构造请求体，包含 file_id 供回调时关联
    const payload = JSON.stringify({
      file_url: fileUrl,
      file_id: fileId,
      is_external: true,
      callback_url: callbackUrl,
    });

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = crypto.randomUUID();
    const canonical = `${timestamp}.${nonce}.${payload}`;
    const signature = await hmacSign(hmacSecret, canonical);

    log("Submitting task", { fileId, fileName, callbackUrl, timestamp });

    const workerRes = await fetch(`${workerBase}/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Timestamp": timestamp,
        "X-Nonce": nonce,
        "X-Signature": signature,
      },
      body: payload,
    });

    const responseText = await workerRes.text();
    log("Worker raw response", { status: workerRes.status, bodyPrefix: responseText.substring(0, 200) });

    let workerData;
    try {
      workerData = JSON.parse(responseText);
    } catch {
      throw new Error(`Worker returned non-JSON: ${responseText.substring(0, 100)}`);
    }

    if (!workerRes.ok || workerData.status === "error") {
      const errMsg = workerData.error?.message || workerData.message || `HTTP ${workerRes.status}`;
      throw new Error(`Worker task submit error: ${errMsg}`);
    }

    const taskId = workerData.task_id || workerData.id;

    // 将 task_id 和状态写入数据库
    const { error: updateError } = await supabaseAdmin
      .from("files")
      .update({
        entity_task_id: taskId,
        entity_task_status: "pending",
        entity_task_started_at: new Date().toISOString(),
      })
      .eq("id", fileId);

    if (updateError) {
      log("DB update error", { error: updateError.message });
    }

    return new Response(
      JSON.stringify({ success: true, fileId, taskId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log("ERROR", { message: msg });
    return new Response(
      JSON.stringify({ error: msg }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
