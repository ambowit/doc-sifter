"""
测试 OCR Worker /extract-text 接口
验证 HMAC 签名认证和文本提取是否正常
"""
import hmac
import hashlib
import json
import os
import time
import uuid
import urllib.request
import urllib.error

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL", "")
SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
WORKER_BASE_URL = (os.environ.get("WORKER_BASE_URL") or "https://pre-safe-scan.oook.cn").rstrip("/")
HMAC_SECRET = os.environ.get("WORKER_HMAC_SECRET", "")

def check_env():
    missing = []
    if not SUPABASE_URL:
        missing.append("SUPABASE_URL")
    if not SERVICE_ROLE_KEY:
        missing.append("SUPABASE_SERVICE_ROLE_KEY")
    if not HMAC_SECRET:
        missing.append("WORKER_HMAC_SECRET")
    if missing:
        print(f"[ERROR] 缺少环境变量: {', '.join(missing)}")
        exit(1)

def hmac_sign(secret: str, canonical: str) -> str:
    return hmac.new(secret.encode(), canonical.encode(), hashlib.sha256).hexdigest()

def get_signed_url(bucket: str, path: str, expires_in: int = 3600) -> str:
    url = f"{SUPABASE_URL}/storage/v1/object/sign/{bucket}/{path}"
    payload = json.dumps({"expiresIn": expires_in}).encode()
    req = urllib.request.Request(
        url,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
            "apikey": SERVICE_ROLE_KEY,
            "Content-Type": "application/json",
        }
    )
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read())
    if "signedURL" not in data:
        raise Exception(f"签名 URL 失败: {data}")
    return f"{SUPABASE_URL}/storage/v1{data['signedURL']}"

def call_worker(file_url: str, max_chars: int = 3000) -> dict:
    body = json.dumps({"file_url": file_url, "max_chars": max_chars})
    timestamp = str(int(time.time()))
    nonce = str(uuid.uuid4())
    canonical = f"{timestamp}.{nonce}.{body}"
    signature = hmac_sign(HMAC_SECRET, canonical)

    req = urllib.request.Request(
        f"{WORKER_BASE_URL}/extract-text",
        data=body.encode(),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Timestamp": timestamp,
            "X-Nonce": nonce,
            "X-Signature": signature,
        }
    )
    start = time.time()
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            elapsed = int((time.time() - start) * 1000)
            data = json.loads(resp.read())
            return {"ok": True, "data": data, "status": resp.status, "elapsed": elapsed}
    except urllib.error.HTTPError as e:
        elapsed = int((time.time() - start) * 1000)
        body_err = e.read().decode()
        return {"ok": False, "status": e.code, "elapsed": elapsed, "error": body_err}

def test_file(label: str, storage_path: str, bucket: str = "dd-files"):
    print(f"\n{'='*60}")
    print(f"[TEST] {label}")
    print(f"  path: {storage_path}")

    # 1. 生成签名 URL
    try:
        signed_url = get_signed_url(bucket, storage_path)
        print(f"  [OK] 签名 URL 已生成")
    except Exception as e:
        print(f"  [FAIL] 签名 URL 失败: {e}")
        return

    # 2. 调用 Worker
    result = call_worker(signed_url)
    print(f"  HTTP {result['status']} ({result['elapsed']}ms)")

    if not result["ok"]:
        print(f"  [FAIL] Worker 错误: {result.get('error', '')[:300]}")
        return

    data = result["data"]
    if data.get("status") == "error":
        print(f"  [FAIL] Worker 返回 error: {json.dumps(data.get('error', data), ensure_ascii=False)}")
        return

    r = data.get("result", {})
    text = r.get("text", "")
    print(f"  [OK] 提取成功")
    print(f"    extraction_source : {r.get('extraction_source')}")
    print(f"    file_type         : {r.get('file_type')}")
    print(f"    page_count        : {r.get('page_count')}")
    print(f"    ocr_fallback      : {r.get('ocr_fallback_used')}")
    print(f"    text_length       : {len(text)} 字符")
    preview = text[:150].replace("\n", " ")
    print(f"    text_preview      : {preview}...")

def main():
    check_env()
    print(f"Worker  : {WORKER_BASE_URL}")
    print(f"Supabase: {SUPABASE_URL}")

    # 测试 PDF
    test_file("PDF", "e894040d-fbd7-4b3a-ab45-39abfc5525bd/2026-03-23/7pzunb4c.pdf")
    # 测试图片 PNG
    test_file("PNG (image)", "e894040d-fbd7-4b3a-ab45-39abfc5525bd/2026-03-23/c8wrmwv0.png")
    # 测试 DOCX
    test_file("DOCX", "e894040d-fbd7-4b3a-ab45-39abfc5525bd/2026-03-23/75m1ky3d.docx")

    print(f"\n{'='*60}")
    print("[DONE] 测试完成")

if __name__ == "__main__":
    main()
