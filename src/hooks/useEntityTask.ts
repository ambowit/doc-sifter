import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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

// 在 mutationFn 内部获取最新 token，避免时序问题
async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("用户未登录，请刷新页面后重试");
  return { Authorization: `Bearer ${session.access_token}` };
}

/**
 * 发起单个文件的实体识别异步任务
 * Worker 处理完成后通过 entity-callback 回调写入数据库
 */
export function useEntityTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file: EntityTaskFile): Promise<EntityTaskResult> => {
      const headers = await getAuthHeaders();
      const { data, error } = await supabase.functions.invoke("entity-task", {
        body: { fileId: file.fileId, fileUrl: file.fileUrl, fileName: file.fileName },
        headers,
      });

      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || "启动实体识别任务失败");

      return data as EntityTaskResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["files"] });
    },
  });
}

/**
 * 批量发起实体识别任务，串行执行
 */
export function useBatchEntityTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (files: EntityTaskFile[]): Promise<{ success: number; failed: number }> => {
      // 一次性获取 token，所有请求复用
      const headers = await getAuthHeaders();
      let success = 0;
      let failed = 0;

      for (const file of files) {
        try {
          const { data, error } = await supabase.functions.invoke("entity-task", {
            body: { fileId: file.fileId, fileUrl: file.fileUrl, fileName: file.fileName },
            headers,
          });

          if (error || !data?.success) {
            failed++;
          } else {
            success++;
          }
        } catch {
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
