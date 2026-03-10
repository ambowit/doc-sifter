import { useState, useCallback, useRef, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

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
  job: ReportJob | null;
  report: GeneratedReport | null;
  isCreating: boolean;
  isPolling: boolean;
  error: string | null;
  errorCode: string | null;
  createJob: () => Promise<string | null>;
  startMonitoring: (jobId: string) => void;
  cancelJob: () => void;
  reset: () => void;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const POLLING_INTERVAL = 2000;
const MAX_POLL_ATTEMPTS = 300;

const toReportJob = (row: Record<string, unknown>): ReportJob => ({
  id: String(row.id || ""),
  status: (row.status as JobStatus) || "queued",
  progress: Number(row.progress || 0),
  currentStage: String(row.currentStage || row.current_stage || "queued"),
  progressMessage: String(row.progressMessage || row.progress_message || ""),
  processedChapters: Number(row.processedChapters || row.processed_chapters || 0),
  totalChapters: Number(row.totalChapters || row.total_chapters || 0),
  issuesFound: Number(row.issuesFound || row.issues_found || 0),
  errorCode: row.errorCode ? String(row.errorCode) : row.error_code ? String(row.error_code) : undefined,
  errorMessage: row.errorMessage ? String(row.errorMessage) : row.error_message ? String(row.error_message) : undefined,
  reportId: row.reportId ? String(row.reportId) : row.report_id ? String(row.report_id) : undefined,
  createdAt: String(row.createdAt || row.created_at || new Date().toISOString()),
  startedAt: row.startedAt ? String(row.startedAt) : row.started_at ? String(row.started_at) : undefined,
  completedAt: row.completedAt ? String(row.completedAt) : row.completed_at ? String(row.completed_at) : undefined,
});

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
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const isPollingRef = useRef(false);
  const fallbackTimerRef = useRef<NodeJS.Timeout | null>(null);
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  const onProgressRef = useRef(onProgress);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);

  const setPollingState = useCallback((value: boolean) => {
    isPollingRef.current = value;
    setIsPolling(value);
  }, []);

  const getAuthHeaders = useCallback(() => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY,
    };

    if (session?.access_token) {
      headers.Authorization = `Bearer ${session.access_token}`;
    }

    return headers;
  }, [session]);

  const clearRealtime = useCallback(() => {
    if (channelRef.current) {
      void supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }, []);

  const clearPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setPollingState(false);
  }, [setPollingState]);

  const stopMonitoring = useCallback(() => {
    clearPolling();
    clearRealtime();
  }, [clearPolling, clearRealtime]);

  const applyTerminalState = useCallback((jobData: ReportJob) => {
    if (jobData.status === "failed") {
      const message = jobData.errorMessage || "任务执行失败";
      setError(message);
      setErrorCode(jobData.errorCode || "UNKNOWN_ERROR");
      onErrorRef.current?.(message, jobData.errorCode);
    }

    if (jobData.status === "cancelled") {
      setError("任务已取消");
      setErrorCode("CANCELLED");
    }

    stopMonitoring();
  }, [stopMonitoring]);

  const pollJobStatus = useCallback(async (jobId: string): Promise<boolean> => {
    console.log("[v0] pollJobStatus called for jobId:", jobId);
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/get-report-job`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ jobId }),
        signal: abortControllerRef.current?.signal,
      });

      const data = await response.json();
      console.log("[v0] pollJobStatus response:", data);

      if (!data.success) {
        throw new Error(data.errorMessage || "获取任务状态失败");
      }

      const jobData = toReportJob(data.job as Record<string, unknown>);
      console.log("[v0] jobData status:", jobData.status, "stage:", jobData.currentStage, "progress:", jobData.progress);
      setJob(jobData);
      onProgressRef.current?.(jobData);

      if (jobData.status === "succeeded" && data.report) {
        console.log("[v0] Job succeeded, report available");
        const reportData = data.report as GeneratedReport;
        setReport(reportData);
        onSuccessRef.current?.(reportData);
        stopMonitoring();
        return true;
      }

      if (jobData.status === "failed" || jobData.status === "cancelled") {
        console.log("[v0] Job failed or cancelled:", jobData.errorMessage);
        applyTerminalState(jobData);
        return true;
      }

      return false;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return true;
      }

      console.error("[v0] Poll error:", err);
      return false;
    }
  }, [applyTerminalState, getAuthHeaders, stopMonitoring]);

  const startFallbackPolling = useCallback((jobId: string) => {
    console.log("[v0] startFallbackPolling called for jobId:", jobId);
    if (pollIntervalRef.current) {
      console.log("[v0] Polling already active, skipping");
      return;
    }

    setPollingState(true);
    pollCountRef.current = 0;
    abortControllerRef.current = new AbortController();

    const poll = async () => {
      pollCountRef.current += 1;
      console.log("[v0] Polling attempt:", pollCountRef.current);

      if (pollCountRef.current > MAX_POLL_ATTEMPTS) {
        setError("轮询超时，请刷新页面查看结果");
        setErrorCode("POLL_TIMEOUT");
        onErrorRef.current?.("轮询超时", "POLL_TIMEOUT");
        stopMonitoring();
        return;
      }

      const shouldStop = await pollJobStatus(jobId);
      if (shouldStop) {
        console.log("[v0] Polling stopped");
        stopMonitoring();
      }
    };

    void poll();
    pollIntervalRef.current = setInterval(poll, pollingInterval);
  }, [pollJobStatus, pollingInterval, setPollingState, stopMonitoring]);

  const subscribeRealtime = useCallback((jobId: string) => {
    clearRealtime();

    const channel = supabase
      .channel(`report-job-${jobId}-${Date.now()}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "report_generation_jobs",
          filter: `id=eq.${jobId}`,
        },
        (payload) => {
          const newRow = payload.new as Record<string, unknown>;
          const jobData = toReportJob(newRow);
          setJob(jobData);
          onProgressRef.current?.(jobData);

          if (jobData.status === "succeeded") {
            void pollJobStatus(jobId);
            return;
          }

          if (jobData.status === "failed" || jobData.status === "cancelled") {
            applyTerminalState(jobData);
          }
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && fallbackTimerRef.current) {
          clearTimeout(fallbackTimerRef.current);
          fallbackTimerRef.current = null;
        }

        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          startFallbackPolling(jobId);
        }
      });

    channelRef.current = channel;

    fallbackTimerRef.current = setTimeout(() => {
      if (!isPollingRef.current) {
        startFallbackPolling(jobId);
      }
    }, 5000);
  }, [applyTerminalState, clearRealtime, pollJobStatus, startFallbackPolling]);

  const startMonitoring = useCallback((jobId: string) => {
    stopMonitoring();
    setError(null);
    setErrorCode(null);
    pollCountRef.current = 0;
    subscribeRealtime(jobId);
    void pollJobStatus(jobId);
  }, [pollJobStatus, stopMonitoring, subscribeRealtime]);

  const createJob = useCallback(async (): Promise<string | null> => {
    if (!projectId) {
      setError("缺少项目ID");
      setErrorCode("MISSING_PROJECT_ID");
      return null;
    }

    setIsCreating(true);
    setError(null);
    setErrorCode(null);
    setReport(null);

    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/create-report-job`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ projectId }),
      });

      const data = await response.json();

      if (!data.success) {
        if (data.errorCode === "JOB_EXISTS" && data.existingJobId) {
          const existingId = data.existingJobId as string;
          startMonitoring(existingId);
          return existingId;
        }

        const errMsg = (data.errorMessage as string) || "创建任务失败";
        setError(errMsg);
        setErrorCode((data.errorCode as string) || "CREATE_FAILED");
        onErrorRef.current?.(errMsg, data.errorCode as string | undefined);
        return null;
      }

      const jobId = data.jobId as string;
      setJob({
        id: jobId,
        status: "queued",
        progress: 0,
        currentStage: "queued",
        progressMessage: "任务已创建，等待处理...",
        processedChapters: 0,
        totalChapters: Number(data.totalChapters || 0),
        issuesFound: 0,
        createdAt: new Date().toISOString(),
      });

      startMonitoring(jobId);
      return jobId;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "创建任务失败";
      setError(errMsg);
      setErrorCode("NETWORK_ERROR");
      onErrorRef.current?.(errMsg, "NETWORK_ERROR");
      return null;
    } finally {
      setIsCreating(false);
    }
  }, [getAuthHeaders, projectId, startMonitoring]);

  const cancelJob = useCallback(() => {
    stopMonitoring();
  }, [stopMonitoring]);

  const reset = useCallback(() => {
    stopMonitoring();
    setJob(null);
    setReport(null);
    setError(null);
    setErrorCode(null);
    setIsCreating(false);
    setIsPolling(false);
    pollCountRef.current = 0;
  }, [stopMonitoring]);

  useEffect(() => () => {
    stopMonitoring();
  }, [stopMonitoring]);

  return {
    job,
    report,
    isCreating,
    isPolling,
    error,
    errorCode,
    createJob,
    startMonitoring,
    cancelJob,
    reset,
  };
}



