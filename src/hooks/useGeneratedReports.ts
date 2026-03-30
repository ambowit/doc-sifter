import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { normalizeSupabaseError } from "@/lib/errorUtils";

export interface GeneratedReportRecord {
  id: string;
  projectId: string;
  userId: string;
  status: string;
  version: number;
  reportJson: Record<string, unknown>;
  summaryJson: Record<string, unknown>;
  totalChapters: number;
  totalFiles: number;
  issuesFound: number;
  evidenceFileCount: number;
  citationCoverage: number;
  createdAt: string;
  updatedAt: string;
}

const transformGeneratedReport = (row: Record<string, unknown>): GeneratedReportRecord => ({
  id: row.id as string,
  projectId: row.project_id as string,
  userId: row.user_id as string,
  status: row.status as string,
  version: (row.version as number) || 1,
  reportJson: (row.report_json as Record<string, unknown>) || {},
  summaryJson: (row.summary_json as Record<string, unknown>) || {},
  totalChapters: (row.total_chapters as number) || 0,
  totalFiles: (row.total_files as number) || 0,
  issuesFound: (row.issues_found as number) || 0,
  evidenceFileCount: (row.evidence_file_count as number) || 0,
  citationCoverage: Number(row.citation_coverage || 0),
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
});

interface PersistReportPayload {
  reportId: string;
  projectId: string;
  reportJson: Record<string, unknown>;
  summaryJson?: Record<string, unknown>;
}

export function useLatestGeneratedReport(projectId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["generatedReport", projectId],
    enabled: !!projectId && !!user,
    queryFn: async () => {
      if (!projectId || !user) {
        return null;
      }

      const { data, error } = await supabase
        .from("generated_reports")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw new Error(normalizeSupabaseError(error, "获取报告失败"));
      }

      return data ? transformGeneratedReport(data as Record<string, unknown>) : null;
    },
  });
}

export function usePersistGeneratedReport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ reportId, projectId, reportJson, summaryJson = {} }: PersistReportPayload) => {
      const sections = Array.isArray(reportJson.sections) ? reportJson.sections as Array<Record<string, unknown>> : [];
      const issuesFound = sections.reduce((count, section) => {
        const issues = Array.isArray(section.issues) ? section.issues : [];
        const validIssues = issues.filter((issue) => {
          if (!issue || typeof issue !== "object") return false;
          const issueObj = issue as Record<string, unknown>;
          return Boolean(issueObj.fact || issueObj.risk || issueObj.suggestion);
        });
        return count + validIssues.length;
      }, 0);
      const evidenceFileCount = sections.reduce((count, section) => {
        const sourceFiles = Array.isArray(section.sourceFiles) ? section.sourceFiles : [];
        return count + sourceFiles.length;
      }, 0);
      const sectionsWithEvidence = sections.filter((section) => {
        const sourceFiles = Array.isArray(section.sourceFiles) ? section.sourceFiles : [];
        return sourceFiles.length > 0;
      }).length;
      const citationCoverage = sections.length > 0 ? Number((sectionsWithEvidence / sections.length).toFixed(4)) : 0;

      const { data, error } = await supabase
        .from("generated_reports")
        .update({
          report_json: reportJson,
          summary_json: summaryJson,
          total_chapters: sections.length,
          issues_found: issuesFound,
          evidence_file_count: evidenceFileCount,
          citation_coverage: citationCoverage,
          updated_at: new Date().toISOString(),
        })
        .eq("id", reportId)
        .select("*")
        .single();

      if (error) {
        throw new Error(normalizeSupabaseError(error, "保存报告失败"));
      }

      return {
        projectId,
        report: transformGeneratedReport(data as Record<string, unknown>),
      };
    },
    onSuccess: ({ projectId }) => {
      queryClient.invalidateQueries({ queryKey: ["generatedReport", projectId] });
    },
  });
}
