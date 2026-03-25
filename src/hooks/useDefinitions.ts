import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type EntityType = "company" | "individual" | "institution" | "transaction" | "other";

export interface Definition {
  id: string;
  projectId: string;
  shortName: string;
  fullName: string;
  entityType: EntityType;
  notes: string | null;
  hasConflict: boolean;
  conflictWith: string | null;
  sourceFileId: string | null;
  sourcePageRef: string | null;
  createdAt: string;
  updatedAt: string;
  // Joined data
  sourceFileName?: string;
}

export interface CreateDefinitionData {
  projectId: string;
  shortName: string;
  fullName: string;
  entityType?: EntityType;
  notes?: string;
  sourceFileId?: string;
  sourcePageRef?: string;
}

export interface UpdateDefinitionData {
  id: string;
  shortName?: string;
  fullName?: string;
  entityType?: EntityType;
  notes?: string;
  sourceFileId?: string;
  sourcePageRef?: string;
}

// Transform database row to Definition interface
const transformDefinition = (row: Record<string, unknown>): Definition => ({
  id: row.id as string,
  projectId: row.project_id as string,
  shortName: row.short_name as string,
  fullName: row.full_name as string,
  entityType: row.entity_type as EntityType,
  notes: row.notes as string | null,
  hasConflict: row.has_conflict as boolean,
  conflictWith: row.conflict_with as string | null,
  sourceFileId: row.source_file_id as string | null,
  sourcePageRef: row.source_page_ref as string | null,
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
  sourceFileName: (row.files as Record<string, unknown>)?.original_name as string | undefined,
});

// Hook to fetch all definitions for a project
export function useDefinitions(projectId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["definitions", projectId],
    queryFn: async () => {
      if (!user) throw new Error("User not authenticated");
      if (!projectId) throw new Error("Project ID is required");

      const { data, error } = await supabase
        .from("definitions")
        .select("*, files(original_name)")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return (data || []).map(transformDefinition);
    },
    enabled: !!user && !!projectId,
  });
}

// Hook to create a definition
export function useCreateDefinition() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (data: CreateDefinitionData) => {
      if (!user) throw new Error("User not authenticated");

      // Check for conflicts with existing short names
      const { data: existing } = await supabase
        .from("definitions")
        .select("id, short_name")
        .eq("project_id", data.projectId)
        .eq("short_name", data.shortName);

      const hasConflict = existing && existing.length > 0;

      const { data: definition, error } = await supabase
        .from("definitions")
        .insert({
          project_id: data.projectId,
          short_name: data.shortName,
          full_name: data.fullName,
          entity_type: data.entityType || "other",
          notes: data.notes || null,
          source_file_id: data.sourceFileId || null,
          source_page_ref: data.sourcePageRef || null,
          has_conflict: hasConflict,
          conflict_with: hasConflict ? existing[0].short_name : null,
        })
        .select("*, files(original_name)")
        .single();

      if (error) throw error;

      // If there's a conflict, update the other definition
      if (hasConflict && existing) {
        await supabase
          .from("definitions")
          .update({ has_conflict: true, conflict_with: data.shortName })
          .eq("id", existing[0].id);
      }

      return transformDefinition(definition);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["definitions", variables.projectId] });
    },
  });
}

// Hook to update a definition
export function useUpdateDefinition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateDefinitionData) => {
      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      if (data.shortName !== undefined) updates.short_name = data.shortName;
      if (data.fullName !== undefined) updates.full_name = data.fullName;
      if (data.entityType !== undefined) updates.entity_type = data.entityType;
      if (data.notes !== undefined) updates.notes = data.notes || null;
      if (data.sourceFileId !== undefined) updates.source_file_id = data.sourceFileId || null;
      if (data.sourcePageRef !== undefined) updates.source_page_ref = data.sourcePageRef || null;

      const { data: definition, error } = await supabase
        .from("definitions")
        .update(updates)
        .eq("id", data.id)
        .select("*, files(original_name)")
        .single();

      if (error) throw error;
      return transformDefinition(definition);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["definitions", data.projectId] });
    },
  });
}

// Hook to delete a definition
export function useDeleteDefinition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, projectId }: { id: string; projectId: string }) => {
      const { error } = await supabase
        .from("definitions")
        .delete()
        .eq("id", id);

      if (error) throw error;
      return { id, projectId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["definitions", data.projectId] });
    },
  });
}

// Hook to bulk create definitions
export function useBulkCreateDefinitions() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (definitions: CreateDefinitionData[]) => {
      if (!user) throw new Error("User not authenticated");
      if (definitions.length === 0) return [];

      const projectId = definitions[0].projectId;

      // Get existing short names to check for conflicts
      const { data: existing } = await supabase
        .from("definitions")
        .select("short_name")
        .eq("project_id", projectId);

      const existingNames = new Set((existing || []).map(e => e.short_name));

      // Check for conflicts within the new batch
      const newNames = new Map<string, number>();
      const definitionsToInsert = definitions.map((def, idx) => {
        const count = newNames.get(def.shortName) || 0;
        newNames.set(def.shortName, count + 1);
        
        const hasConflict = existingNames.has(def.shortName) || count > 0;

        return {
          project_id: def.projectId,
          short_name: def.shortName,
          full_name: def.fullName,
          entity_type: def.entityType || "other",
          notes: def.notes || null,
          source_file_id: def.sourceFileId || null,
          source_page_ref: def.sourcePageRef || null,
          has_conflict: hasConflict,
        };
      });

      const { data, error } = await supabase
        .from("definitions")
        .insert(definitionsToInsert)
        .select("*, files(original_name)");

      if (error) throw error;
      return (data || []).map(transformDefinition);
    },
    onSuccess: (_, variables) => {
      if (variables.length > 0) {
        queryClient.invalidateQueries({ queryKey: ["definitions", variables[0].projectId] });
      }
    },
  });
}

// Helper function to invoke Edge Function with timeout
async function invokeWithTimeout<T>(
  functionName: string,
  body: Record<string, unknown>,
  timeoutMs: number = 60000
): Promise<{ data: T | null; error: Error | null }> {
  try {
    console.log(`[v0] invokeWithTimeout: Calling ${functionName} with body:`, JSON.stringify(body));
    
    // Use supabase.functions.invoke which handles auth automatically
    const result = await supabase.functions.invoke(functionName, {
      body,
    });
    
    console.log(`[v0] invokeWithTimeout: Raw result:`, JSON.stringify(result));

    if (result.error) {
      console.log(`[v0] invokeWithTimeout: Error from invoke:`, result.error);
      return { data: null, error: new Error(result.error.message || "调用失败") };
    }

    console.log(`[v0] invokeWithTimeout: Success, data type:`, typeof result.data);
    console.log(`[v0] invokeWithTimeout: Success, data:`, JSON.stringify(result.data));
    return { data: result.data as T, error: null };
  } catch (err) {
    console.log(`[v0] invokeWithTimeout: Caught exception:`, err);
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

// Hook to regenerate definitions using AI
export function useRegenerateDefinitions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (projectId: string) => {
      console.log("[useRegenerateDefinitions] Starting extraction for project:", projectId);
      
      // Call the generate-report Edge Function in metadata mode to extract definitions
      // Use custom fetch with timeout instead of supabase.functions.invoke
      const { data, error } = await invokeWithTimeout<{
        success: boolean;
        metadata?: {
          definitions?: Array<{ 
            fullName?: string;  // API 返回 fullName
            name?: string;      // 兼容旧格式
            shortName: string; 
            description?: string;
            type?: string;
          }>;
        };
      }>("generate-report", { projectId, mode: "metadata" }, 60000);

      console.log("[useRegenerateDefinitions] Response:", { data, error });

      if (error) {
        console.error("[useRegenerateDefinitions] Edge Function error:", error);
        throw new Error(error.message || "AI 提取失败");
      }
      
      if (!data?.success) {
        console.error("[useRegenerateDefinitions] Unsuccessful response:", data);
        throw new Error("AI 提取返回失败状态");
      }

      // Extract definitions from response - handle empty/missing gracefully
      const definitions = data.metadata?.definitions || [];
      console.log("[useRegenerateDefinitions] Extracted definitions:", definitions.length);

      // Clear existing definitions for this project
      const { error: deleteError } = await supabase
        .from("definitions")
        .delete()
        .eq("project_id", projectId);
      
      if (deleteError) {
        console.error("[useRegenerateDefinitions] Delete error:", deleteError);
        throw new Error("清除旧定义失败");
      }

      // If no definitions extracted, return empty array
      if (!Array.isArray(definitions) || definitions.length === 0) {
        console.log("[useRegenerateDefinitions] No definitions to insert");
        return [];
      }

      // Validate and transform definitions - 支持 fullName 或 name 字段
      const validDefinitions = definitions.filter(
        (def: { fullName?: string; name?: string; shortName?: string }) => 
          def && 
          (typeof def.fullName === "string" || typeof def.name === "string") && 
          typeof def.shortName === "string"
      );

      if (validDefinitions.length === 0) {
        console.log("[useRegenerateDefinitions] No valid definitions after filtering");
        return [];
      }

      // Helper function to infer entity type from name
      const inferEntityType = (name: string, shortName: string): EntityType => {
        const fullText = (name + " " + shortName).toLowerCase();
        
        // Company keywords
        if (
          fullText.includes("公司") || 
          fullText.includes("企业") || 
          fullText.includes("集团") ||
          fullText.includes("有限") ||
          fullText.includes("股份") ||
          fullText.includes("合伙") ||
          fullText.includes("法人") ||
          fullText.includes("目标公司") ||
          fullText.includes("标的公司") ||
          fullText.includes("投资方") ||
          fullText.includes("收购方") ||
          fullText.includes("被收购方")
        ) {
          return "company";
        }
        
        // Individual keywords
        if (
          fullText.includes("先生") || 
          fullText.includes("女士") || 
          fullText.includes("自然人") ||
          fullText.includes("股东") ||
          fullText.includes("董事") ||
          fullText.includes("监事") ||
          fullText.includes("高管") ||
          fullText.includes("法定代表人") ||
          fullText.includes("实际控制人") ||
          fullText.includes("创始人") ||
          // Check for Chinese names (2-4 characters without company suffixes)
          (/^[\u4e00-\u9fa5]{2,4}$/.test(shortName) && !fullText.includes("公司"))
        ) {
          return "individual";
        }
        
        // Institution keywords
        if (
          fullText.includes("委员会") || 
          fullText.includes("政府") || 
          fullText.includes("监管") ||
          fullText.includes("部门") ||
          fullText.includes("局") ||
          fullText.includes("银行") ||
          fullText.includes("基金") ||
          fullText.includes("协会") ||
          fullText.includes("机构") ||
          fullText.includes("证监会") ||
          fullText.includes("工商局") ||
          fullText.includes("税务局")
        ) {
          return "institution";
        }
        
        // Transaction keywords
        if (
          fullText.includes("交易") || 
          fullText.includes("收购") || 
          fullText.includes("合并") ||
          fullText.includes("投资") ||
          fullText.includes("融资") ||
          fullText.includes("增资") ||
          fullText.includes("股权转让") ||
          fullText.includes("重组") ||
          fullText.includes("项目")
        ) {
          return "transaction";
        }
        
        // Default to other
        return "other";
      };

      const definitionsToInsert = validDefinitions.map((def: {
        name?: string;       // 旧格式: full name
        fullName?: string;   // 新格式: full name (API 实际返回)
        shortName: string;   // short name
        description?: string;
        type?: string;
      }) => {
        // Handle both field name formats from AI
        // AI might return {name: "全称", shortName: "简称"} or {fullName: "全称", shortName: "简称"}
        const fullNameValue = def.fullName || def.name || "";
        const shortNameValue = def.shortName || "";
        
        // Use provided type if valid, otherwise infer from name
        let entityType: EntityType = "other";
        if (def.type && ["company", "individual", "institution", "transaction", "other"].includes(def.type)) {
          entityType = def.type as EntityType;
        } else {
          entityType = inferEntityType(fullNameValue, shortNameValue);
        }
        
        return {
          project_id: projectId,
          short_name: shortNameValue,
          full_name: fullNameValue,
          entity_type: entityType,
          notes: def.description || null,
        };
      });

      console.log("[useRegenerateDefinitions] Inserting definitions:", definitionsToInsert.length);

      const { data: inserted, error: insertError } = await supabase
        .from("definitions")
        .insert(definitionsToInsert)
        .select("*, files(original_name)");

      if (insertError) {
        console.error("[useRegenerateDefinitions] Insert error:", insertError);
        throw new Error("保存定义失败: " + insertError.message);
      }
      
      console.log("[useRegenerateDefinitions] Successfully inserted:", inserted?.length || 0);
      return (inserted || []).map(transformDefinition);
    },
    onSuccess: (result, projectId) => {
      console.log("[useRegenerateDefinitions] onSuccess, count:", result.length);
      queryClient.invalidateQueries({ queryKey: ["definitions", projectId] });
    },
    onError: (error) => {
      console.error("[useRegenerateDefinitions] onError:", error);
    },
  });
}

// Calculate definition statistics
export function calculateDefinitionStats(definitions: Definition[]) {
  const byType: Record<EntityType, number> = {
    company: 0,
    individual: 0,
    institution: 0,
    transaction: 0,
    other: 0,
  };
  
  let conflicts = 0;
  
  definitions.forEach(def => {
    byType[def.entityType]++;
    if (def.hasConflict) conflicts++;
  });
  
  return {
    total: definitions.length,
    byType,
    conflicts,
  };
}
