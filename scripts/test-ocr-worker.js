/**
 * 测试 OCR Worker /extract-text 接口
 * 用法：node scripts/test-ocr-worker.js
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WORKER_BASE_URL = process.env.WORKER_BASE_URL || "https://pre-safe-scan.oook.cn";
const HMAC_SECRET = process.env.WORKER_HMAC_SECRET;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("[ERROR] 缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY 环境变量");
  process.exit(1);
}
if (!HMAC_SECRET) {
  console.error("[ERROR] 缺少 WORKER_HMAC_SECRET 环境变量");
  process.exit(1);
}

// HMAC-SHA256 签名
async function hmacSign(secret, canonical) {
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

// 生成 Supabase Storage 签名 URL（用 REST API，不引入 npm 包）
async function getSignedUrl(bucket, path, expiresIn = 3600) {
  const url = `${SUPABASE_URL}/storage/v1/object/sign/${bucket}/${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      "apikey": SERVICE_ROLE_KEY,
    },
    body: JSON.stringify({ expiresIn }),
  });
  const data = await res.json();
  if (!res.ok || !data.signedURL) {
    throw new Error(`生成签名 URL 失败: ${JSON.stringify(data)}`);
  }
  return `${SUPABASE_URL}/storage/v1${data.signedURL}`;
}

async function testFile(label, storagePath, bucket = "dd-files") {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`[TEST] ${label}`);
  console.log(`  storage: ${storagePath}`);

  // 1. 生成签名 URL
  let signedUrl;
  try {
    signedUrl = await getSignedUrl(bucket, storagePath);
    console.log(`  [OK] 签名 URL 生成成功`);
  } catch (err) {
    console.error(`  [FAIL] 签名 URL 生成失败:`, err.message);
    return;
  }

  // 2. 调用 Worker /extract-text
  const body = JSON.stringify({ file_url: signedUrl, max_chars: 3000 });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID();
  const canonical = `${timestamp}.${nonce}.${body}`;
  const signature = await hmacSign(HMAC_SECRET, canonical);

  const start = Date.now();
  let res, data;
  try {
    res = await fetch(`${WORKER_BASE_URL.replace(/\/$/, "")}/extract-text`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Timestamp": timestamp,
        "X-Nonce": nonce,
        "X-Signature": signature,
      },
      body,
    });
    data = await res.json();
  } catch (err) {
    console.error(`  [FAIL] 网络请求失败:`, err.message);
    return;
  }

  const elapsed = Date.now() - start;
  console.log(`  HTTP ${res.status} (${elapsed}ms)`);

  if (!res.ok || data.status === "error") {
    console.error(`  [FAIL] Worker 返回错误:`, JSON.stringify(data.error || data, null, 2));
    return;
  }

  const r = data.result;
  console.log(`  [OK] 提取成功`);
  console.log(`    extraction_source : ${r.extraction_source}`);
  console.log(`    file_type         : ${r.file_type}`);
  console.log(`    page_count        : ${r.page_count}`);
  console.log(`    ocr_fallback      : ${r.ocr_fallback_used}`);
  console.log(`    text_length       : ${(r.text || "").length} 字符`);
  console.log(`    text_preview      : ${(r.text || "").substring(0, 150).replace(/\n/g, " ")}...`);
}

async function main() {
  console.log(`Worker  : ${WORKER_BASE_URL}`);
  console.log(`Supabase: ${SUPABASE_URL}`);

  // 测试 PDF
  await testFile(
    "PDF",
    "e894040d-fbd7-4b3a-ab45-39abfc5525bd/2026-03-23/7pzunb4c.pdf"
  );

  // 测试图片 PNG
  await testFile(
    "PNG (image)",
    "e894040d-fbd7-4b3a-ab45-39abfc5525bd/2026-03-23/c8wrmwv0.png"
  );

  // 测试 DOCX
  await testFile(
    "DOCX",
    "e894040d-fbd7-4b3a-ab45-39abfc5525bd/2026-03-23/75m1ky3d.docx"
  );

  console.log(`\n${"=".repeat(60)}`);
  console.log("[DONE] 测试完成");
}

main().catch(err => {
  console.error("[FATAL]", err);
  process.exit(1);
});
