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

// Process 2 chapters per batch - smaller batches for reliability
const CHAPTERS_PER_BATCH = 2;

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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 55000); // 55s timeout

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/generate-report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
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
  } finally {
    clearTimeout(timeoutId);
  }
}

// Self-invoke to continue processing the next step
async function continueProcessing(supabaseUrl: string, serviceRoleKey: string, jobId: string) {
  try {
    await fetch(`${supabaseUrl}/functions/v1/process-report-job`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ jobId }),
    });
  } catch (err) {
    console.error("[process-report-job] Failed to continue processing:", err);
  }
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

    const updateJob = async (patch: Record<string, unknown>) => {
      const { error } = await admin
        .from("report_generation_jobs")
        .update(patch)
        .eq("id", jobId);

      if (error) {
        console.error("[process-report-job] Failed to update job", error.message);
      }
    };

    // Get current job state
    const { data: jobData, error: jobError } = await admin
      .from("report_generation_jobs")
      .select("*")
      .eq("id", jobId)
      .maybeSingle();

    if (jobError || !jobData) {
      return jsonResponse({ success: false, error: "Job not found" }, 404);
    }

    // If job is already completed, failed, or cancelled, don't process
    if (["succeeded", "failed", "cancelled"].includes(jobData.status)) {
      return jsonResponse({ success: true, message: "Job already completed or cancelled" });
    }

    // Helper function to check if job was cancelled
    const checkIfCancelled = async (): Promise<boolean> => {
      const { data: currentJob } = await admin
        .from("report_generation_jobs")
        .select("status")
        .eq("id", jobId)
        .maybeSingle();
      return currentJob?.status === "cancelled";
    };

    const projectId = jobData.project_id;
    const userId = jobData.user_id;

    // If job is queued, start it
    if (jobData.status === "queued") {
      await updateJob({
        status: "running",
        current_stage: "metadata",
        progress: 2,
        progress_message: "任务已开始",
        started_at: new Date().toISOString(),
        error_code: null,
        error_message: null,
      });
    }

    try {
      // Get chapter count
      const { data: chapterRows, error: chapterError } = await admin
        .from("chapters")
        .select("id, order_index")
        .eq("project_id", projectId)
        .order("order_index", { ascending: true });

      if (chapterError) {
        throw new Error(chapterError.message);
      }

      const totalChapters = chapterRows?.length || 0;
      const totalBatches = Math.max(1, Math.ceil(totalChapters / CHAPTERS_PER_BATCH));

      // Determine current step based on job state
      const currentStage = jobData.current_stage || "metadata";
      const processedChapters = jobData.processed_chapters || 0;
      const currentBatchIndex = Math.floor(processedChapters / CHAPTERS_PER_BATCH);

      // Get existing partial results
      let partialSections: Array<Record<string, unknown>> = [];
      if (jobData.partial_results) {
        try {
          const parsed = typeof jobData.partial_results === "string"
            ? JSON.parse(jobData.partial_results)
            : jobData.partial_results;
          partialSections = Array.isArray(parsed.sections) ? parsed.sections : [];
        } catch {
          partialSections = [];
        }
      }

      // STEP 1: Metadata extraction
      if (currentStage === "metadata") {
        // Check if cancelled before starting
        if (await checkIfCancelled()) {
          return jsonResponse({ success: true, message: "Job was cancelled" });
        }

        await updateJob({
          total_chapters: totalChapters,
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
          progress: 10,
          progress_message: "元数据提取完成，开始生成章节...",
          partial_results: JSON.stringify({ metadata, sections: [] }),
        });

        // Continue to next step
        const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime;
        if (edgeRuntime?.waitUntil) {
          edgeRuntime.waitUntil(continueProcessing(supabaseUrl, serviceRoleKey, jobId));
        }

        return jsonResponse({ success: true, stage: "metadata", next: "extract" });
      }

      // STEP 2: Batch chapter generation
      if (currentStage === "extract" && currentBatchIndex < totalBatches) {
        // Check if cancelled before each batch
        if (await checkIfCancelled()) {
          return jsonResponse({ success: true, message: "Job was cancelled" });
        }

        const progress = 10 + Math.round(((currentBatchIndex + 1) / totalBatches) * 75);

        await updateJob({
          progress,
          progress_message: `正在生成章节 (${currentBatchIndex + 1}/${totalBatches})...`,
        });

        let batchData: Record<string, unknown> | null = null;
        let lastError: Error | null = null;

        // Try up to 2 times
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            batchData = await invokeGenerateReport(supabaseUrl, serviceRoleKey, {
              projectId,
              mode: "batch",
              batchIndex: currentBatchIndex,
              totalBatches,
            });
            break;
          } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            if (attempt === 0) {
              await new Promise(r => setTimeout(r, 2000));
            }
          }
        }

        if (!batchData) {
          throw lastError || new Error(`第 ${currentBatchIndex + 1} 批生成失败`);
        }

        // Merge new sections with existing ones
        const newSections = Array.isArray(batchData.sections) ? batchData.sections as Array<Record<string, unknown>> : [];
        const sectionMap = new Map<string, Record<string, unknown>>();

        for (const section of partialSections) {
          const id = typeof section.id === "string" ? section.id : "";
          if (id) sectionMap.set(id, section);
        }
        for (const section of newSections) {
          const id = typeof section.id === "string" ? section.id : "";
          if (id) sectionMap.set(id, section);
        }

        const allSections = Array.from(sectionMap.values());
        const newProcessedChapters = Math.min(totalChapters, (currentBatchIndex + 1) * CHAPTERS_PER_BATCH);

        // Get existing metadata
        let metadata = null;
        if (jobData.partial_results) {
          try {
            const parsed = typeof jobData.partial_results === "string"
              ? JSON.parse(jobData.partial_results)
              : jobData.partial_results;
            metadata = parsed.metadata || null;
          } catch {
            // ignore
          }
        }

        await updateJob({
          progress,
          processed_chapters: newProcessedChapters,
          partial_results: JSON.stringify({ metadata, sections: allSections }),
          current_stage: newProcessedChapters >= totalChapters ? "analyze" : "extract",
        });

        // Continue to next step
        const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime;
        if (edgeRuntime?.waitUntil) {
          edgeRuntime.waitUntil(continueProcessing(supabaseUrl, serviceRoleKey, jobId));
        }

        return jsonResponse({
          success: true,
          stage: "extract",
          batch: currentBatchIndex + 1,
          totalBatches,
          next: newProcessedChapters >= totalChapters ? "analyze" : "extract"
        });
      }

      // STEP 3: Analysis and finalization
      if (currentStage === "analyze" || (currentStage === "extract" && currentBatchIndex >= totalBatches)) {
        // Check if cancelled before analysis
        if (await checkIfCancelled()) {
          return jsonResponse({ success: true, message: "Job was cancelled" });
        }

        await updateJob({
          current_stage: "analyze",
          progress: 90,
          progress_message: "正在汇总分析...",
        });

        // Get metadata from partial results
        let metadata = null;
        if (jobData.partial_results) {
          try {
            const parsed = typeof jobData.partial_results === "string"
              ? JSON.parse(jobData.partial_results)
              : jobData.partial_results;
            metadata = parsed.metadata || null;
          } catch {
            // ignore
          }
        }

        // Sort sections by chapter order
        const chapterOrderMap = new Map<string, number>();
        (chapterRows || []).forEach((row, idx) => chapterOrderMap.set(row.id, idx));

        const sections = partialSections.sort((a, b) => {
          const aId = typeof a.id === "string" ? a.id : "";
          const bId = typeof b.id === "string" ? b.id : "";
          const orderA = chapterOrderMap.get(aId) ?? Number.MAX_SAFE_INTEGER;
          const orderB = chapterOrderMap.get(bId) ?? Number.MAX_SAFE_INTEGER;
          return orderA - orderB;
        });

        if (sections.length === 0) {
          throw new Error("未生成任何章节内容");
        }

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

        // 证据统计改为基于 chapter_file_mappings 映射表计算
        // 获取所有章节的映射文件数
        const sectionIds = sections.map(s => String(s.id || "")).filter(Boolean);
        let evidenceFileCount = 0;
        let sectionsWithMapping = 0;

        if (sectionIds.length > 0) {
          // 从映射表获取每个章节关联的文件数
          const { data: mappingCounts, error: mappingError } = await admin
            .from("chapter_file_mappings")
            .select("chapter_id")
            .in("chapter_id", sectionIds);

          if (!mappingError && mappingCounts) {
            // 按章节统计映射数量
            const mappingCountMap = new Map<string, number>();
            for (const row of mappingCounts) {
              const chapterId = String(row.chapter_id);
              mappingCountMap.set(chapterId, (mappingCountMap.get(chapterId) || 0) + 1);
            }
            evidenceFileCount = mappingCounts.length;
            sectionsWithMapping = mappingCountMap.size;
          }
        }

        const citationCoverage = sections.length > 0
          ? Number((sectionsWithMapping / sections.length).toFixed(4))
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

        return jsonResponse({ success: true, stage: "completed", reportId: reportRow.id });
      }

      return jsonResponse({ success: true, message: "No action needed" });

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
      return jsonResponse({ success: false, error: message }, 500);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ success: false, error: message }, 500);
  }
});
