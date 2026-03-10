import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Reduced to 1 chapter per batch to prevent Edge Function timeout
const CHAPTERS_PER_BATCH = 1;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function classifyErrorCode(message: string): string {
  const text = message.toLowerCase();
  if (text.includes("timeout") || text.includes("504") || text.includes("502")) return "AI_TIMEOUT";
  if (text.includes("auth") || text.includes("jwt") || text.includes("401")) return "AUTH_FAILED";
  if (text.includes("project")) return "PROJECT_NOT_FOUND";
  return "PROCESS_FAILED";
}

async function invokeGenerateReport(
  supabaseUrl: string,
  serviceRoleKey: string,
  payload: Record<string, unknown>,
) {
  const response = await fetch(`${supabaseUrl}/functions/v1/generate-report`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let data: Record<string, unknown> = {};

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }

  if (!response.ok) {
    const errMsg = typeof data.error === "string" ? data.error : `Generate report failed: ${response.status}`;
    throw new Error(errMsg);
  }

  return data;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ success: false, error: "Server configuration missing" }, 500);
    }

    const internalSecret = req.headers.get("x-internal-secret");
    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
    const bearerToken = authHeader?.toLowerCase().startsWith("bearer ") ? authHeader.slice(7) : "";

    if (internalSecret !== serviceRoleKey && bearerToken !== serviceRoleKey) {
      return jsonResponse({ success: false, error: "Unauthorized" }, 401);
    }

    const payload = await req.json().catch(() => ({}));
    const jobId = typeof payload?.jobId === "string" ? payload.jobId : "";
    if (!jobId) {
      return jsonResponse({ success: false, error: "Missing jobId" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const runJob = async () => {
      const updateJob = async (patch: Record<string, unknown>) => {
        const { error } = await admin
          .from("report_generation_jobs")
          .update(patch)
          .eq("id", jobId);

        if (error) {
          console.error("[process-report-job] Failed to update job", error.message);
        }
      };

      const startResult = await admin
        .from("report_generation_jobs")
        .update({
          status: "running",
          current_stage: "metadata",
          progress: 2,
          progress_message: "任务已开始",
          started_at: new Date().toISOString(),
          error_code: null,
          error_message: null,
        })
        .eq("id", jobId)
        .eq("status", "queued")
        .select("id, project_id, user_id, total_chapters")
        .maybeSingle();

      let job = startResult.data as {
        id: string;
        project_id: string;
        user_id: string;
        total_chapters: number;
      } | null;

      if (!job) {
        const existing = await admin
          .from("report_generation_jobs")
          .select("id, project_id, user_id, status, total_chapters")
          .eq("id", jobId)
          .maybeSingle();

        if (!existing.data) {
          return;
        }

        if (existing.data.status !== "running") {
          return;
        }

        job = {
          id: existing.data.id,
          project_id: existing.data.project_id,
          user_id: existing.data.user_id,
          total_chapters: existing.data.total_chapters || 0,
        };
      }

      const projectId = job.project_id;
      const userId = job.user_id;

      try {
        const { data: chapterRows, error: chapterError } = await admin
          .from("chapters")
          .select("id, order_index")
          .eq("project_id", projectId)
          .order("order_index", { ascending: true });

        if (chapterError) {
          throw new Error(chapterError.message);
        }

        const totalChapters = chapterRows?.length || job.total_chapters || 0;

        await updateJob({
          total_chapters: totalChapters,
          current_stage: "metadata",
          progress: 5,
          progress_message: "正在提取元数据...",
        });

        const metadataResponse = await invokeGenerateReport(supabaseUrl, serviceRoleKey, {
          projectId,
          mode: "metadata",
        });

        const metadata = metadataResponse.metadata || null;

        await updateJob({
          current_stage: "extract",
          progress: 15,
          progress_message: "正在生成章节内容...",
        });

        const totalBatches = Math.max(1, Math.ceil(totalChapters / CHAPTERS_PER_BATCH));
        const sectionMap = new Map<string, Record<string, unknown>>();

        for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
          let batchData: Record<string, unknown> | null = null;
          let lastError: Error | null = null;

          for (let attempt = 0; attempt <= 2; attempt++) {
            try {
              batchData = await invokeGenerateReport(supabaseUrl, serviceRoleKey, {
                projectId,
                mode: "batch",
                batchIndex,
                totalBatches,
              });
              break;
            } catch (error) {
              lastError = error instanceof Error ? error : new Error(String(error));
              if (attempt < 2) {
                await delay(1200 * (attempt + 1));
              }
            }
          }

          if (!batchData) {
            throw lastError || new Error(`第 ${batchIndex + 1} 批生成失败`);
          }

          const sections = Array.isArray(batchData.sections)
            ? batchData.sections as Array<Record<string, unknown>>
            : [];

          for (const section of sections) {
            const sectionId = typeof section.id === "string" ? section.id : "";
            if (sectionId) {
              sectionMap.set(sectionId, section);
            }
          }

          const processedChapters = Math.min(totalChapters, (batchIndex + 1) * CHAPTERS_PER_BATCH);
          const progress = 15 + Math.round(((batchIndex + 1) / totalBatches) * 70);

          await updateJob({
            current_stage: "extract",
            progress,
            processed_chapters: processedChapters,
            progress_message: `正在生成章节 (${batchIndex + 1}/${totalBatches})...`,
          });
        }

        const chapterOrderMap = new Map<string, number>();
        (chapterRows || []).forEach((row, idx) => chapterOrderMap.set(row.id, idx));

        const sections = Array.from(sectionMap.values()).sort((a, b) => {
          const aId = typeof a.id === "string" ? a.id : "";
          const bId = typeof b.id === "string" ? b.id : "";
          const orderA = chapterOrderMap.get(aId) ?? Number.MAX_SAFE_INTEGER;
          const orderB = chapterOrderMap.get(bId) ?? Number.MAX_SAFE_INTEGER;
          return orderA - orderB;
        });

        if (sections.length === 0) {
          throw new Error("未生成任何章节内容");
        }

        await updateJob({
          current_stage: "analyze",
          progress: 90,
          progress_message: "正在汇总分析...",
        });

        const analyzeResponse = await invokeGenerateReport(supabaseUrl, serviceRoleKey, {
          projectId,
          mode: "analyze",
          previousSections: sections,
        });

        const summary = (analyzeResponse.summary || {}) as Record<string, unknown>;
        const totalIssues = typeof summary.totalIssues === "number"
          ? summary.totalIssues
          : sections.reduce((acc, section) => {
              const issues = Array.isArray(section.issues) ? section.issues : [];
              return acc + issues.length;
            }, 0);

        const sectionsWithEvidence = sections.filter((section) => {
          const sourceFiles = Array.isArray(section.sourceFiles) ? section.sourceFiles : [];
          return sourceFiles.length > 0;
        }).length;

        const evidenceFileCount = sections.reduce((acc, section) => {
          const sourceFiles = Array.isArray(section.sourceFiles) ? section.sourceFiles : [];
          return acc + sourceFiles.length;
        }, 0);

        const citationCoverage = sections.length > 0
          ? Number((sectionsWithEvidence / sections.length).toFixed(4))
          : 0;

        const { count: totalFiles } = await admin
          .from("files")
          .select("id", { count: "exact", head: true })
          .eq("project_id", projectId);

        const reportJson = {
          projectId,
          generatedAt: new Date().toISOString(),
          sections,
          metadata,
        };

        const upsertPayload = {
          project_id: projectId,
          user_id: userId,
          created_by: userId,
          status: "final",
          version: 1,
          report_json: reportJson,
          summary_json: summary,
          total_chapters: sections.length,
          total_files: totalFiles || 0,
          issues_found: totalIssues,
          evidence_file_count: evidenceFileCount,
          citation_coverage: citationCoverage,
        };

        let { data: reportRow, error: reportError } = await admin
          .from("generated_reports")
          .upsert(upsertPayload, { onConflict: "project_id,user_id" })
          .select("id")
          .single();

        if (reportError?.message?.includes('column "created_by" of relation "generated_reports" does not exist')) {
          const fallbackPayload = { ...upsertPayload } as Record<string, unknown>;
          delete fallbackPayload.created_by;

          const fallbackResult = await admin
            .from("generated_reports")
            .upsert(fallbackPayload, { onConflict: "project_id,user_id" })
            .select("id")
            .single();

          reportRow = fallbackResult.data;
          reportError = fallbackResult.error;
        }

        if (reportError || !reportRow) {
          throw new Error(reportError?.message || "报告保存失败");
        }

        await updateJob({
          status: "succeeded",
          current_stage: "completed",
          progress: 100,
          progress_message: "报告生成完成",
          report_id: reportRow.id,
          issues_found: totalIssues,
          completed_at: new Date().toISOString(),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await updateJob({
          status: "failed",
          current_stage: "failed",
          progress_message: "任务执行失败",
          error_code: classifyErrorCode(message),
          error_message: message,
          completed_at: new Date().toISOString(),
        });
      }
    };

    const runner = runJob();
    const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime;

    if (edgeRuntime?.waitUntil) {
      edgeRuntime.waitUntil(runner);
      return jsonResponse({ success: true, accepted: true, jobId });
    }

    await runner;
    return jsonResponse({ success: true, accepted: true, jobId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ success: false, error: message }, 500);
  }
});
