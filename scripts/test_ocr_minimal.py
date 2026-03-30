import os
import sys

print("Python version:", sys.version)
print("WORKER_BASE_URL:", os.environ.get("WORKER_BASE_URL", "(not set)"))
print("WORKER_HMAC_SECRET set:", bool(os.environ.get("WORKER_HMAC_SECRET")))
print("SUPABASE_URL:", os.environ.get("NEXT_PUBLIC_SUPABASE_URL", os.environ.get("SUPABASE_URL", "(not set)"))[:40])
print("OK")
