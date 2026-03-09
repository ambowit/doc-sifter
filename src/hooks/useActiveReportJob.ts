import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import type { JobStatus } from "@/hooks/useReportJob";

export interface ActiveReportJob {
  id: string;
  status: JobStatus;
}

const ACTIVE_JOB_QUERY_STALE_TIME = 1000 * 30;

export function useActiveReportJob(projectId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["activeReportJob", projectId, user?.id],
    enabled: !!projectId && !!user,
    staleTime: ACTIVE_JOB_QUERY_STALE_TIME,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<ActiveReportJob | null> => {
      if (!projectId || !user) {
        return null;
      }

      const { data, error } = await supabase
        .from("report_generation_jobs")
        .select("id, status")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .in("status", ["queued", "running"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (!data) {
        return null;
      }

      return {
        id: data.id as string,
        status: data.status as JobStatus,
      };
    },
  });
}
