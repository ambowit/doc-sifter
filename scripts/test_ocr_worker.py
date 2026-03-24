"""
测试 OCR Worker /extract-text 接口
"""
import hmac
import hashlib
import json
import os
import sys
import time
import uuid
import urllib.request
import urllib.error

SUPABASE_URL = (os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL", "")).rstrip("/")
SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
WORKER_BASE_URL = (os.environ.get("WORKER_BASE_URL") or "https://pre-safe-scan.oook.cn").rstrip("/")
HMAC_SECRET = os.environ.get("WORKER_HMAC_SECRET", "")

print("=== 环境检查 ===")
print(f"WORKER_BASE_URL  : {WORKER_BASE_URL}")
print(f"SUPABASE_URL     : {SUPABASE_URL}")
print(f"HMAC_SECRET set  : {bool(HMAC_SECRET)}")
print(f"SERVICE_ROLE_KEY : {'set' if SERVICE_ROLE_KEY else 'MISSING'}")

if not HMAC_SECRET:
    print("[ERROR] 缺少 WORKER_HMAC_SECRET")
    sys.exit(1)

def hmac_sign(secret: str, canonical: str) -> str:
    return hmac.new(secret.encode(), canonical.encode(), hashlib.sha256).hexdigest()

def get_signed_url(bucket: str, path: str, expires_in: int = 3600) -> str:
    url = f"{SUPABASE_URL}/storage/v1/object/sign/{bucket}/{path}"
    payload = json.dumps({"expiresIn": expires_in}).encode()
    req = urllib.request.Request(
        url, data=payload, method="POST",
        headers={
            "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
            "apikey": SERVICE_ROLE_KEY,
            "Content-Type": "application/json",
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raise Exception(f"Supabase Storage HTTP {e.code}: {e.read().decode()[:200]}")
    
    signed = data.get("signedURL") or data.get("signedUrl")
    if not signed:
        raise Exception(f"未获取到 signedURL，响应: {json.dumps(data)[:200]}")
    # signedURL 已经包含完整路径（/storage/v1/object/sign/...?token=...）
    return f"{SUPABASE_URL}/storage/v1{signed}"

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
        err_body = e.read().decode()
        return {"ok": False, "status": e.code, "elapsed": elapsed, "error": err_body}
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        return {"ok": False, "status": 0, "elapsed": elapsed, "error": str(e)}

def test_file(label: str, storage_path: str, bucket: str = "dd-files"):
    print(f"\n--- {label} ---")
    print(f"  storage_path: {storage_path}")

    try:
        signed_url = get_signed_url(bucket, storage_path)
        print(f"  [OK] 签名 URL: {signed_url[:80]}...")
    except Exception as e:
        print(f"  [FAIL] 签名 URL 错误: {e}")
        return

    print(f"  正在调用 Worker...")
    result = call_worker(signed_url)
    print(f"  HTTP {result['status']} ({result['elapsed']}ms)")

    if not result["ok"]:
        print(f"  [FAIL] {result.get('error', '')[:400]}")
        return

    data = result["data"]
    if data.get("status") == "error":
        err = data.get("error", data)
        print(f"  [FAIL] Worker error: {json.dumps(err, ensure_ascii=False)[:300]}")
        return

    r = data.get("result", {})
    text = r.get("text", "")
    print(f"  [OK] extraction_source : {r.get('extraction_source')}")
    print(f"       file_type         : {r.get('file_type')}")
    print(f"       page_count        : {r.get('page_count')}")
    print(f"       ocr_fallback      : {r.get('ocr_fallback_used')}")
    print(f"       text_length       : {len(text)} 字符")
    preview = text[:200].replace("\n", " ")
    print(f"       preview           : {preview}")

# 从 DB 查到的真实文件
test_file("PDF",  "e894040d-fbd7-4b3a-ab45-39abfc5525bd/2026-03-23/7pzunb4c.pdf")
test_file("PNG",  "e894040d-fbd7-4b3a-ab45-39abfc5525bd/2026-03-23/c8wrmwv0.png")
test_file("DOCX", "e894040d-fbd7-4b3a-ab45-39abfc5525bd/2026-03-23/75m1ky3d.docx")

print("\n=== 测试完成 ===")
