import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface UploadTicket {
  provider: "supabase_storage";
  bucket: string;
  key: string;
  uploadUrl: string;
  contentType: string;
}

export interface UploadProviderContext {
  supabaseUrl: string;
  serviceRoleKey: string;
  bucket: string;
}

export function getStorageBucketName(): string {
  // 同时兼容 VITE_STORAGE_BUCKET 和 STORAGE_BUCKET，默认 dd-files
  const bucket = Deno.env.get("VITE_STORAGE_BUCKET") || Deno.env.get("STORAGE_BUCKET") || "dd-files";
  return bucket;
}

export function getUploadProviderContext(): UploadProviderContext {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const bucket = getStorageBucketName();

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set");
  }

  return { supabaseUrl, serviceRoleKey, bucket };
}

export async function createUploadTicket(
  ctx: UploadProviderContext,
  key: string,
  contentType: string,
): Promise<UploadTicket> {
  const admin = createClient(ctx.supabaseUrl, ctx.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const normalizedContentType = contentType || "application/octet-stream";

  const { data: uploadData, error: uploadError } = await admin.storage
    .from(ctx.bucket)
    .createSignedUploadUrl(key);

  if (uploadError || !uploadData?.signedUrl) {
    throw new Error(`Failed to create signed upload URL: ${uploadError?.message || "unknown error"}`);
  }

  return {
    provider: "supabase_storage",
    bucket: ctx.bucket,
    key,
    uploadUrl: uploadData.signedUrl,
    contentType: normalizedContentType,
  };
}

export async function createDownloadUrl(
  ctx: UploadProviderContext,
  key: string,
  expiresIn = 3600,
): Promise<string> {
  const admin = createClient(ctx.supabaseUrl, ctx.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await admin.storage
    .from(ctx.bucket)
    .createSignedUrl(key, expiresIn);

  if (error || !data?.signedUrl) {
    throw new Error(`Failed to create signed download URL: ${error?.message || "unknown error"}`);
  }

  return data.signedUrl;
}

export async function uploadBytesToSignedUrl(
  uploadUrl: string,
  data: Uint8Array,
  contentType: string,
): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": contentType || "application/octet-stream",
    },
    body: data,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Upload failed: ${response.status}${body ? ` ${body.slice(0, 120)}` : ""}`);
  }
}
