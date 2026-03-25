import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import type { JobStatus } from "@/hooks/useReportJob";

export interface ActiveReportJob {
  id: string;
  status: JobStatus;
  progress: number;
  currentStep: string;
  progressMessage: string;
  processedChapters: number;
  totalChapters: number;
  issuesFound: number;
  errorMessage?: string;
  createdAt: string;
  startedAt?: string;
}

const ACTIVE_JOB_QUERY_STALE_TIME = 1000 * 2; // 2 秒刷新一次

export function useActiveReportJob(projectId: string | undefined) {
  const { user } = useAuth();
  const [isPolling, setIsPolling] = useState(false);

  const query = useQuery({
    queryKey: ["activeReportJob", projectId, user?.id],
    enabled: !!projectId && !!user,
    staleTime: ACTIVE_JOB_QUERY_STALE_TIME,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => {
      // 如果任务正在运行，每 2 秒刷新一次
      const job = query.state.data;
      if (job && (job.status === "queued" || job.status === "running")) {
        return 2000;
      }
      return false;
    },
    queryFn: async (): Promise<ActiveReportJob | null> => {
      if (!projectId || !user) {
        return null;
      }

      // 查询最新的任务（包括刚完成的）
      const { data, error } = await supabase
        .from("report_generation_jobs")
        .select(`
          id, 
          status, 
          progress,
          current_stage,
          progress_message,
          processed_chapters,
          total_chapters,
          issues_found,
          error_message,
          created_at,
          started_at
        `)
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (!data) {
        return null;
      }

      // 只返回活跃任务（排队中、运行中、或最近 5 分钟内完成/失败的任务）
      const isActive = data.status === "queued" || data.status === "running";
      const isRecentlyFinished = 
        (data.status === "succeeded" || data.status === "failed") &&
        new Date(data.created_at).getTime() > Date.now() - 5 * 60 * 1000;

      if (!isActive && !isRecentlyFinished) {
        return null;
      }

      return {
        id: data.id as string,
        status: data.status as JobStatus,
        progress: Number(data.progress || 0),
        currentStep: String(data.current_stage || "queued"),
        progressMessage: String(data.progress_message || ""),
        processedChapters: Number(data.processed_chapters || 0),
        totalChapters: Number(data.total_chapters || 0),
        issuesFound: Number(data.issues_found || 0),
        errorMessage: data.error_message ? String(data.error_message) : undefined,
        createdAt: String(data.created_at),
        startedAt: data.started_at ? String(data.started_at) : undefined,
      };
    },
  });

  // 更新 polling 状态
  useEffect(() => {
    const job = query.data;
    setIsPolling(!!job && (job.status === "queued" || job.status === "running"));
  }, [query.data]);

  return {
    job: query.data,
    isPolling,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
