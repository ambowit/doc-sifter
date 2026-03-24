import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface EntityTaskFile {
  fileId: string;
  fileUrl: string;
  fileName: string;
}

export interface EntityTaskResult {
  success: boolean;
  fileId: string;
  taskId: string;
}

/**
 * 发起单个文件的实体识别异步任务
 * Worker 处理完成后通过 entity-callback 回调写入数据库
 */
export function useEntityTask() {
  const { session } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file: EntityTaskFile): Promise<EntityTaskResult> => {
      const { data, error } = await supabase.functions.invoke("entity-task", {
        body: {
          fileId: file.fileId,
          fileUrl: file.fileUrl,
          fileName: file.fileName,
        },
        headers: session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : undefined,
      });

      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || "启动实体识别任务失败");

      return data as EntityTaskResult;
    },
    onSuccess: (result) => {
      // 刷新文件列表以显示最新的 entity_task_status
      queryClient.invalidateQueries({ queryKey: ["files"] });
      console.log("[useEntityTask] Task submitted:", result.taskId);
    },
  });
}

/**
 * 批量发起实体识别任务，串行执行
 */
export function useBatchEntityTask() {
  const { session } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (files: EntityTaskFile[]): Promise<{ success: number; failed: number }> => {
      let success = 0;
      let failed = 0;

      for (const file of files) {
        try {
          const { data, error } = await supabase.functions.invoke("entity-task", {
            body: {
              fileId: file.fileId,
              fileUrl: file.fileUrl,
              fileName: file.fileName,
            },
            headers: session?.access_token
              ? { Authorization: `Bearer ${session.access_token}` }
              : undefined,
          });

          if (error || !data?.success) {
            console.error("[useBatchEntityTask] Failed:", file.fileName, error?.message || data?.error);
            failed++;
          } else {
            success++;
          }
        } catch (e) {
          console.error("[useBatchEntityTask] Error:", file.fileName, e);
          failed++;
        }
      }

      return { success, failed };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["files"] });
    },
  });
}
