import { useState, useCallback, useRef, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

// Job status types
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface ReportJob {
  id: string;
  status: JobStatus;
  progress: number;
  currentStage: string;
  progressMessage: string;
  processedChapters: number;
  totalChapters: number;
  issuesFound: number;
  errorCode?: string;
  errorMessage?: string;
  reportId?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface GeneratedReport {
  id: string;
  reportJson: any;
  status: string;
  version: number;
  totalChapters: number;
  totalFiles: number;
  issuesFound: number;
  evidenceFileCount: number;
  citationCoverage: number;
}

interface UseReportJobOptions {
  projectId: string;
  onSuccess?: (report: GeneratedReport) => void;
  onError?: (error: string, errorCode?: string) => void;
  onProgress?: (job: ReportJob) => void;
  pollingInterval?: number;
}

interface UseReportJobReturn {
  // State
  job: ReportJob | null;
  report: GeneratedReport | null;
  isCreating: boolean;
  isPolling: boolean;
  error: string | null;
  errorCode: string | null;
  
  // Actions
  createJob: () => Promise<string | null>;
  cancelJob: () => void;
  reset: () => void;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const POLLING_INTERVAL = 2000; // 2 seconds
const MAX_POLL_ATTEMPTS = 300; // 10 minutes max

export function useReportJob(options: UseReportJobOptions): UseReportJobReturn {
  const { projectId, onSuccess, onError, onProgress, pollingInterval = POLLING_INTERVAL } = options;
  const { session } = useAuth();
  
  const [job, setJob] = useState<ReportJob | null>(null);
  const [report, setReport] = useState<GeneratedReport | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  
  const pollCountRef = useRef(0);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const getAuthHeaders = useCallback(() => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    };
    if (session?.access_token) {
      headers["Authorization"] = `Bearer ${session.access_token}`;
    }
    return headers;
  }, [session]);

  const pollJobStatus = useCallback(async (jobId: string): Promise<boolean> => {
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/get-report-job`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ jobId }),
        signal: abortControllerRef.current?.signal,
      });

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.errorMessage || "获取任务状态失败");
      }

      const jobData = data.job as ReportJob;
      setJob(jobData);
      onProgress?.(jobData);

      if (jobData.status === "succeeded" && data.report) {
        setReport(data.report);
        onSuccess?.(data.report);
        return true; // Stop polling
      }

      if (jobData.status === "failed") {
        setError(jobData.errorMessage || "任务执行失败");
        setErrorCode(jobData.errorCode || "UNKNOWN_ERROR");
        onError?.(jobData.errorMessage || "任务执行失败", jobData.errorCode);
        return true; // Stop polling
      }

      if (jobData.status === "cancelled") {
        setError("任务已取消");
        setErrorCode("CANCELLED");
        return true; // Stop polling
      }

      return false; // Continue polling
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return true; // Stop polling on abort
      }
      console.error("[useReportJob] Poll error:", err);
      // Don't stop polling on transient errors
      return false;
    }
  }, [getAuthHeaders, onSuccess, onError, onProgress]);

  const startPolling = useCallback((jobId: string) => {
    setIsPolling(true);
    pollCountRef.current = 0;
    abortControllerRef.current = new AbortController();

    const poll = async () => {
      pollCountRef.current++;
      
      if (pollCountRef.current > MAX_POLL_ATTEMPTS) {
        setIsPolling(false);
        setError("轮询超时，请刷新页面查看结果");
        setErrorCode("POLL_TIMEOUT");
        onError?.("轮询超时", "POLL_TIMEOUT");
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
        }
        return;
      }

      const shouldStop = await pollJobStatus(jobId);
      if (shouldStop) {
        setIsPolling(false);
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
        }
      }
    };

    // Initial poll
    poll();
    
    // Start interval
    pollIntervalRef.current = setInterval(poll, pollingInterval);
  }, [pollJobStatus, pollingInterval, onError]);

  const createJob = useCallback(async (): Promise<string | null> => {
    if (!projectId) {
      setError("缺少项目ID");
      setErrorCode("MISSING_PROJECT_ID");
      return null;
    }

    setIsCreating(true);
    setError(null);
    setErrorCode(null);
    setJob(null);
    setReport(null);

    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/create-report-job`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ projectId }),
      });

      const data = await response.json();

      if (!data.success) {
        // Handle specific error codes
        if (data.errorCode === "JOB_EXISTS") {
          setError("已有正在运行的任务");
          setErrorCode("JOB_EXISTS");
          // Start polling the existing job
          if (data.existingJobId) {
            startPolling(data.existingJobId);
            return data.existingJobId;
          }
        } else {
          setError(data.errorMessage || "创建任务失败");
          setErrorCode(data.errorCode || "CREATE_FAILED");
          onError?.(data.errorMessage || "创建任务失败", data.errorCode);
        }
        return null;
      }

      const jobId = data.jobId;
      setJob({
        id: jobId,
        status: "queued",
        progress: 0,
        currentStage: "queued",
        progressMessage: "任务已创建，等待处理...",
        processedChapters: 0,
        totalChapters: data.totalChapters || 0,
        issuesFound: 0,
        createdAt: new Date().toISOString(),
      });

      // Start polling for job status
      startPolling(jobId);

      return jobId;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "创建任务失败";
      setError(errMsg);
      setErrorCode("NETWORK_ERROR");
      onError?.(errMsg, "NETWORK_ERROR");
      return null;
    } finally {
      setIsCreating(false);
    }
  }, [projectId, getAuthHeaders, startPolling, onError]);

  const cancelJob = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsPolling(false);
    // Note: We don't actually cancel the backend job here,
    // just stop polling. Backend job will continue to completion.
  }, []);

  const reset = useCallback(() => {
    cancelJob();
    setJob(null);
    setReport(null);
    setError(null);
    setErrorCode(null);
    setIsCreating(false);
    setIsPolling(false);
    pollCountRef.current = 0;
  }, [cancelJob]);

  return {
    job,
    report,
    isCreating,
    isPolling,
    error,
    errorCode,
    createJob,
    cancelJob,
    reset,
  };
}
