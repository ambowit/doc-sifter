export function normalizeSupabaseError(error: unknown, fallback = "操作失败"): string {
  if (!error) return fallback;

  if (typeof error === "string") return error;

  if (error instanceof Error) {
    return error.message || fallback;
  }

  if (typeof error === "object") {
    const maybe = error as { message?: string; error_description?: string; details?: string };
    return maybe.message || maybe.error_description || maybe.details || fallback;
  }

  return fallback;
}
