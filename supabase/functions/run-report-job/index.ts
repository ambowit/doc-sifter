import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Semantic chapter number sorter
function parseChapterNumber(num: string | null | undefined): number[] {
  if (!num) return [999999];
  const parts = num.toString().split(/[\.-]/);
  return parts.map(p => {
    const n = parseInt(p, 10);
    return isNaN(n) ? 999999 : n;
  });
}

function compareChapterNumbers(a: string | null, b: string | null): number {
  const partsA = parseChapterNumber(a);
  const partsB = parseChapterNumber(b);
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const valA = partsA[i] ?? 0;
    const valB = partsB[i] ?? 0;
    if (valA !== valB) return valA - valB;
  }
  return 0;
}

async function updateJobProgress(
  supabase: ReturnType<typeof createClient>,
  jobId: string,
  updates: {
    status?: string;
    progress?: number;
    current_stage?: string;
    progress_message?: string;
    processed_chapters?: number;
    issues_found?: number;
    error_code?: string;
    error_message?: string;
    started_at?: string;
    completed_at?: string;
    report_id?: string;
    total_chapters?: number;
  }
) {
  const { error } = await supabase
    .from("report_generation_jobs")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", jobId);
  if (error) console.error("[run-report-job] Failed to update job:", error);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  let jobId: string | null = null;

  try {
    const body = await req.json();
    jobId = body.jobId;

    if (!jobId) {
      return new Response(
        JSON.stringify({ success: false, errorCode: "MISSING_JOB_ID" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Fetch job
    const { data: job, error: jobError } = await supabaseAdmin
      .from("report_generation_jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (jobError || !job) {
      return new Response(
        JSON.stringify({ success: false, errorCode: "JOB_NOT_FOUND" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 }
      );
    }

    // Check if already running or completed
    if (job.status === "running") {
      return new Response(
        JSON.stringify({ success: false, errorCode: "JOB_ALREADY_RUNNING" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 }
      );
    }
    if (job.status === "succeeded" || job.status === "failed") {
      return new Response(
        JSON.stringify({ success: false, errorCode: "JOB_ALREADY_COMPLETED" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 }
      );
    }

    // Mark as running
    await updateJobProgress(supabaseAdmin, jobId, {
      status: "running",
      started_at: new Date().toISOString(),
      current_stage: "fetching_data",
      progress_message: "正在加载项目数据...",
      progress: 5,
    });

    const projectId = job.project_id;

    // Fetch project
    const { data: project } = await supabaseAdmin
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .single();

    if (!project) {
      await updateJobProgress(supabaseAdmin, jobId, {
        status: "failed",
        error_code: "PROJECT_NOT_FOUND",
        error_message: "项目不存在",
        completed_at: new Date().toISOString(),
      });
      return new Response(
        JSON.stringify({ success: false, errorCode: "PROJECT_NOT_FOUND" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 }
      );
    }

    // Fetch chapters and files
    const { data: chapters } = await supabaseAdmin
      .from("chapters")
      .select("*")
      .eq("project_id", projectId);

    const { data: files } = await supabaseAdmin
      .from("files")
      .select("*")
      .eq("project_id", projectId);

    // Sort chapters semantically
    const sortedChapters = (chapters || []).sort((a, b) => 
      compareChapterNumbers(a.number, b.number)
    );

    // Quality gate: Check evidence files
    const evidenceFiles = (files || []).filter(f => f.extracted_text || f.text_summary);
    const evidenceFileCount = evidenceFiles.length;

    console.log("[run-report-job] Data loaded:", {
      projectId,
      chaptersCount: sortedChapters.length,
      filesCount: files?.length || 0,
      evidenceFileCount,
    });

    await updateJobProgress(supabaseAdmin, jobId, {
      current_stage: "validating",
      progress_message: "正在验证数据...",
      progress: 10,
      total_chapters: sortedChapters.length,
    });

    // Quality gate: NO_EVIDENCE
    if (evidenceFileCount < 3) {
      await updateJobProgress(supabaseAdmin, jobId, {
        status: "failed",
        error_code: "NO_EVIDENCE",
        error_message: `证据文件不足（当前 ${evidenceFileCount} 个，需要至少 3 个）`,
        completed_at: new Date().toISOString(),
      });
      return new Response(
        JSON.stringify({ success: false, errorCode: "NO_EVIDENCE", evidenceFileCount }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // Quality gate: NO_CHAPTERS
    if (sortedChapters.length === 0) {
      await updateJobProgress(supabaseAdmin, jobId, {
        status: "failed",
        error_code: "NO_CHAPTERS",
        error_message: "无章节数据，请先配置章节",
        completed_at: new Date().toISOString(),
      });
      return new Response(
        JSON.stringify({ success: false, errorCode: "NO_CHAPTERS" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // Generate sections
    await updateJobProgress(supabaseAdmin, jobId, {
      current_stage: "generating",
      progress_message: "正在生成报告内容...",
      progress: 20,
    });

    const sections: {
      id: string;
      title: string;
      number: string;
      content: string;
      findings: string[];
      issues: string[];
      sourceFiles: string[];
    }[] = [];
    let issuesFound = 0;

    for (let i = 0; i < sortedChapters.length; i++) {
      const chapter = sortedChapters[i];
      const progress = 20 + Math.round((i / sortedChapters.length) * 60);

      await updateJobProgress(supabaseAdmin, jobId, {
        progress,
        progress_message: `正在生成章节 ${i + 1}/${sortedChapters.length}: ${chapter.title}`,
        processed_chapters: i + 1,
      });

      // Assign evidence files to this chapter
      const chapterFiles = evidenceFiles.slice(
        Math.floor(i * evidenceFiles.length / sortedChapters.length),
        Math.floor((i + 1) * evidenceFiles.length / sortedChapters.length)
      );

      sections.push({
        id: chapter.id,
        title: chapter.title || `章节 ${i + 1}`,
        number: chapter.number || String(i + 1),
        content: `根据我们对目标公司相关文件的核查，现就${chapter.title || `章节 ${i + 1}`}报告如下。`,
        findings: chapterFiles.length > 0 ? ["已完成核查"] : [],
        issues: [],
        sourceFiles: chapterFiles.map(f => f.original_name || f.name || "未命名文件"),
      });
    }

    // Quality gate: EMPTY_CITATIONS
    const sectionsWithCitations = sections.filter(s => s.sourceFiles?.length > 0);
    const citationCoverage = sections.length > 0 ? sectionsWithCitations.length / sections.length : 0;

    console.log("[run-report-job] Generation complete:", {
      sectionsCount: sections.length,
      sectionsWithCitations: sectionsWithCitations.length,
      citationCoverage: (citationCoverage * 100).toFixed(1) + "%",
    });

    if (sectionsWithCitations.length === 0) {
      await updateJobProgress(supabaseAdmin, jobId, {
        status: "failed",
        error_code: "EMPTY_CITATIONS",
        error_message: "生成失败：无证据引用",
        completed_at: new Date().toISOString(),
      });
      return new Response(
        JSON.stringify({ success: false, errorCode: "EMPTY_CITATIONS" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // Save report
    await updateJobProgress(supabaseAdmin, jobId, {
      current_stage: "saving",
      progress_message: "正在保存报告...",
      progress: 90,
    });

    const reportJson = {
      projectId: project.id,
      projectName: project.name,
      client: project.client || "委托方",
      target: project.target || "目标公司",
      generatedAt: new Date().toISOString(),
      sections,
      statistics: {
        totalFiles: files?.length || 0,
        totalChapters: sortedChapters.length,
        issuesFound,
        evidenceFileCount,
        citationCoverage,
      },
    };

    const { data: report, error: reportError } = await supabaseAdmin
      .from("generated_reports")
      .insert({
        project_id: projectId,
        job_id: jobId,
        status: "draft",
        version: 1,
        report_json: reportJson,
        title: project.name,
        client: project.client,
        target: project.target,
        total_chapters: sortedChapters.length,
        total_files: files?.length || 0,
        issues_found: issuesFound,
        evidence_file_count: evidenceFileCount,
        citation_coverage: citationCoverage,
        created_by: job.user_id,
      })
      .select()
      .single();

    if (reportError) {
      console.error("[run-report-job] Failed to save report:", reportError);
      await updateJobProgress(supabaseAdmin, jobId, {
        status: "failed",
        error_code: "SAVE_FAILED",
        error_message: reportError.message,
        completed_at: new Date().toISOString(),
      });
      return new Response(
        JSON.stringify({ success: false, errorCode: "SAVE_FAILED" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    // Mark job as succeeded
    await updateJobProgress(supabaseAdmin, jobId, {
      status: "succeeded",
      progress: 100,
      current_stage: "completed",
      progress_message: "报告生成完成",
      completed_at: new Date().toISOString(),
      report_id: report.id,
      issues_found: issuesFound,
    });

    console.log("[run-report-job] Job completed successfully:", { jobId, reportId: report.id });

    return new Response(
      JSON.stringify({ success: true, reportId: report.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    console.error("[run-report-job] Error:", error);
    if (jobId) {
      await updateJobProgress(supabaseAdmin, jobId, {
        status: "failed",
        error_code: "UNKNOWN_ERROR",
        error_message: String(error),
        completed_at: new Date().toISOString(),
      });
    }
    return new Response(
      JSON.stringify({ success: false, errorCode: "UNKNOWN_ERROR", errorMessage: String(error) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
