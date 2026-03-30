import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type EntityType = "company" | "individual" | "institution" | "transaction" | "other";
export type DefinitionOrigin = "manual" | "ai" | "imported";
export type CandidateStatus = "pending_review" | "approved" | "rejected" | "archived";

export interface DefinitionSourceTraceItem {
  sourceFileId: string | null;
  sourceFileName: string | null;
  sourcePageRef: string | null;
  sourceExcerpt: string | null;
  confidence: number | null;
  reviewReason?: string | null;
  raw?: Record<string, unknown>;
}

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
  sourceExcerpt: string | null;
  sourceTrace: DefinitionSourceTraceItem[];
  origin: DefinitionOrigin;
  isLocked: boolean;
  lastSyncedCandidateId: string | null;
  createdAt: string;
  updatedAt: string;
  sourceFileName?: string;
}

export interface DefinitionCandidate {
  id: string;
  projectId: string;
  shortName: string | null;
  fullName: string | null;
  entityType: EntityType;
  notes: string | null;
  confidence: number | null;
  status: CandidateStatus;
  origin: DefinitionOrigin;
  sourceFileId: string | null;
  sourcePageRef: string | null;
  sourceExcerpt: string | null;
  sourceTrace: DefinitionSourceTraceItem[];
  extractionBatchId: string;
  mergedDefinitionId: string | null;
  hasConflict: boolean;
  conflictWith: string | null;
  reviewReason: string | null;
  createdAt: string;
  updatedAt: string;
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
  sourceExcerpt?: string;
}

export interface UpdateDefinitionData {
  id: string;
  shortName?: string;
  fullName?: string;
  entityType?: EntityType;
  notes?: string;
  sourceFileId?: string;
  sourcePageRef?: string;
  sourceExcerpt?: string;
}

export interface ExtractDefinitionsResult {
  success: boolean;
  batchId: string;
  inserted: number;
  updated: number;
  pendingReview: number;
  archived: number;
  skipped: number;
  conflicts: number;
  sourceFiles?: number;
  snippets?: number;
  rawItems?: number;
  message?: string;
}

function safeTrace(value: unknown): DefinitionSourceTraceItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    sourceFileId: typeof item?.sourceFileId === "string" ? item.sourceFileId : null,
    sourceFileName: typeof item?.sourceFileName === "string" ? item.sourceFileName : null,
    sourcePageRef: typeof item?.sourcePageRef === "string" ? item.sourcePageRef : null,
    sourceExcerpt: typeof item?.sourceExcerpt === "string" ? item.sourceExcerpt : null,
    confidence: typeof item?.confidence === "number" ? item.confidence : null,
    reviewReason: typeof item?.reviewReason === "string" ? item.reviewReason : null,
    raw: typeof item?.raw === "object" && item?.raw !== null ? item.raw as Record<string, unknown> : undefined,
  }));
}

function normalizeKey(value: string | null | undefined): string {
  return (value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[“”"'《》()（）\[\]【】,，。.；;:：·]/g, "")
    .replace(/\s+/g, "");
}

function withConflictMetadata(definitions: Definition[]): Definition[] {
  const counts = new Map<string, number>();
  definitions.forEach((definition) => {
    const key = normalizeKey(definition.shortName);
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  return definitions.map((definition) => {
    const key = normalizeKey(definition.shortName);
    if (!key || (counts.get(key) || 0) <= 1) {
      return { ...definition, hasConflict: false, conflictWith: null };
    }

    const conflictWith = definitions
      .filter((item) => item.id !== definition.id && normalizeKey(item.shortName) === key)
      .map((item) => item.fullName)
      .filter(Boolean)
      .join(" / ");

    return {
      ...definition,
      hasConflict: true,
      conflictWith: conflictWith || definition.conflictWith,
    };
  });
}

const transformDefinition = (row: Record<string, unknown>): Definition => ({
  id: row.id as string,
  projectId: row.project_id as string,
  shortName: row.short_name as string,
  fullName: row.full_name as string,
  entityType: (row.entity_type as EntityType) || "other",
  notes: (row.notes as string | null) ?? null,
  hasConflict: Boolean(row.has_conflict),
  conflictWith: (row.conflict_with as string | null) ?? null,
  sourceFileId: (row.source_file_id as string | null) ?? null,
  sourcePageRef: (row.source_page_ref as string | null) ?? null,
  sourceExcerpt: (row.source_excerpt as string | null) ?? null,
  sourceTrace: safeTrace(row.source_trace),
  origin: ((row.origin as DefinitionOrigin | null) ?? "manual"),
  isLocked: Boolean(row.is_locked),
  lastSyncedCandidateId: (row.last_synced_candidate_id as string | null) ?? null,
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
  sourceFileName: (row.files as Record<string, unknown> | undefined)?.original_name as string | undefined,
});

const transformCandidate = (row: Record<string, unknown>): DefinitionCandidate => ({
  id: row.id as string,
  projectId: row.project_id as string,
  shortName: (row.short_name as string | null) ?? null,
  fullName: (row.full_name as string | null) ?? null,
  entityType: (row.entity_type as EntityType) || "other",
  notes: (row.notes as string | null) ?? null,
  confidence: typeof row.confidence === "number" ? row.confidence : null,
  status: (row.status as CandidateStatus) || "pending_review",
  origin: ((row.origin as DefinitionOrigin | null) ?? "ai"),
  sourceFileId: (row.source_file_id as string | null) ?? null,
  sourcePageRef: (row.source_page_ref as string | null) ?? null,
  sourceExcerpt: (row.source_excerpt as string | null) ?? null,
  sourceTrace: safeTrace(row.source_trace),
  extractionBatchId: (row.extraction_batch_id as string) || "",
  mergedDefinitionId: (row.merged_definition_id as string | null) ?? null,
  hasConflict: Boolean(row.has_conflict),
  conflictWith: (row.conflict_with as string | null) ?? null,
  reviewReason: (row.review_reason as string | null) ?? null,
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
  sourceFileName: (row.files as Record<string, unknown> | undefined)?.original_name as string | undefined,
});

async function invokeWithTimeout<T>(functionName: string, body: Record<string, unknown>, timeoutMs = 90000) {
  const promise = supabase.functions.invoke(functionName, { body });
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("请求超时，请稍后重试")), timeoutMs);
  });

  const result = await Promise.race([promise, timeoutPromise]);
  if ((result as { error?: { message?: string } }).error) {
    const errorMessage = (result as { error?: { message?: string } }).error?.message || "调用失败";
    throw new Error(errorMessage);
  }
  return (result as { data: T }).data;
}

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
      console.log("[v0] definitions raw data:", data);
      const result = withConflictMetadata((data || []).map((row) => transformDefinition(row as Record<string, unknown>)));
      console.log("[v0] definitions transformed:", result);
      return result;
    },
    enabled: !!user && !!projectId,
  });
}

export function useDefinitionCandidates(projectId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["definition-candidates", projectId],
    queryFn: async () => {
      if (!user) throw new Error("User not authenticated");
      if (!projectId) throw new Error("Project ID is required");

      const { data, error } = await supabase
        .from("definition_candidates")
        .select("*, files(original_name)")
        .eq("project_id", projectId)
        .neq("status", "archived")
        .order("created_at", { ascending: false });

      if (error) throw error;
      console.log("[v0] definition_candidates raw data:", data);
      const transformed = (data || []).map((row) => transformCandidate(row as Record<string, unknown>));
      console.log("[v0] definition_candidates transformed:", transformed);
      return transformed;
    },
    enabled: !!user && !!projectId,
  });
}

export function useCreateDefinition() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (data: CreateDefinitionData) => {
      if (!user) throw new Error("User not authenticated");

      const sourceTrace = data.sourceFileId || data.sourcePageRef || data.sourceExcerpt ? [{
        sourceFileId: data.sourceFileId || null,
        sourceFileName: null,
        sourcePageRef: data.sourcePageRef || null,
        sourceExcerpt: data.sourceExcerpt || null,
        confidence: null,
        reviewReason: "manual_entry",
      }] : [];

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
          source_excerpt: data.sourceExcerpt || null,
          source_trace: sourceTrace,
          origin: "manual",
          is_locked: true,
        })
        .select("*, files(original_name)")
        .single();

      if (error) throw error;
      return transformDefinition(definition as Record<string, unknown>);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["definitions", variables.projectId] });
    },
  });
}

export function useUpdateDefinition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateDefinitionData) => {
      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
        origin: "manual",
        is_locked: true,
      };

      if (data.shortName !== undefined) updates.short_name = data.shortName;
      if (data.fullName !== undefined) updates.full_name = data.fullName;
      if (data.entityType !== undefined) updates.entity_type = data.entityType;
      if (data.notes !== undefined) updates.notes = data.notes || null;
      if (data.sourceFileId !== undefined) updates.source_file_id = data.sourceFileId || null;
      if (data.sourcePageRef !== undefined) updates.source_page_ref = data.sourcePageRef || null;
      if (data.sourceExcerpt !== undefined) updates.source_excerpt = data.sourceExcerpt || null;

      const sourceTrace = data.sourceFileId || data.sourcePageRef || data.sourceExcerpt ? [{
        sourceFileId: data.sourceFileId || null,
        sourceFileName: null,
        sourcePageRef: data.sourcePageRef || null,
        sourceExcerpt: data.sourceExcerpt || null,
        confidence: null,
        reviewReason: "manual_edit",
      }] : undefined;
      if (sourceTrace !== undefined) updates.source_trace = sourceTrace;

      const { data: definition, error } = await supabase
        .from("definitions")
        .update(updates)
        .eq("id", data.id)
        .select("*, files(original_name)")
        .single();

      if (error) throw error;
      return transformDefinition(definition as Record<string, unknown>);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["definitions", data.projectId] });
    },
  });
}

export function useDeleteDefinition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, projectId }: { id: string; projectId: string }) => {
      const { error } = await supabase.from("definitions").delete().eq("id", id);
      if (error) throw error;
      return { id, projectId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["definitions", data.projectId] });
    },
  });
}

export function useToggleDefinitionLock() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, projectId, isLocked }: { id: string; projectId: string; isLocked: boolean }) => {
      const { data, error } = await supabase
        .from("definitions")
        .update({ is_locked: isLocked, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select("*, files(original_name)")
        .single();

      if (error) throw error;
      return transformDefinition(data as Record<string, unknown>);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["definitions", data.projectId] });
    },
  });
}

export function useExtractDefinitions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ projectId, mode = "refresh" }: { projectId: string; mode?: "refresh" | "incremental" }) => {
      const data = await invokeWithTimeout<ExtractDefinitionsResult>("extract-definitions", { projectId, mode }, 90000);
      if (!data?.success) {
        throw new Error(data?.message || "AI 提取失败");
      }
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["definitions", variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ["definition-candidates", variables.projectId] });
    },
  });
}

export function useApproveDefinitionCandidates() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ projectId, candidateIds }: { projectId: string; candidateIds: string[] }) => {
      return invokeWithTimeout<{ success: boolean; approved: number; inserted: number; updated: number; skipped: number }>(
        "approve-definition-candidates",
        { projectId, candidateIds },
        60000,
      );
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["definitions", variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ["definition-candidates", variables.projectId] });
    },
  });
}

export function useRejectDefinitionCandidates() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ projectId, candidateIds }: { projectId: string; candidateIds: string[] }) => {
      return invokeWithTimeout<{ success: boolean; rejected: number }>(
        "reject-definition-candidates",
        { projectId, candidateIds },
        60000,
      );
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["definition-candidates", variables.projectId] });
    },
  });
}

export const useRegenerateDefinitions = useExtractDefinitions;

export function calculateDefinitionStats(definitions: Definition[]) {
  const byType: Record<EntityType, number> = {
    company: 0,
    individual: 0,
    institution: 0,
    transaction: 0,
    other: 0,
  };

  let conflicts = 0;
  let locked = 0;
  let manual = 0;
  let ai = 0;

  definitions.forEach((definition) => {
    byType[definition.entityType] += 1;
    if (definition.hasConflict) conflicts += 1;
    if (definition.isLocked) locked += 1;
    if (definition.origin === "manual") manual += 1;
    if (definition.origin === "ai") ai += 1;
  });

  return {
    total: definitions.length,
    byType,
    conflicts,
    locked,
    manual,
    ai,
  };
}

export function calculateCandidateStats(candidates: DefinitionCandidate[]) {
  let pending = 0;
  let conflicts = 0;
  let missingSource = 0;
  let lowConfidence = 0;

  candidates.forEach((candidate) => {
    if (candidate.status === "pending_review") pending += 1;
    if (candidate.hasConflict) conflicts += 1;
    if (!candidate.sourceFileId && !candidate.sourceExcerpt) missingSource += 1;
    if ((candidate.confidence ?? 0) > 0 && (candidate.confidence ?? 0) < 0.6) lowConfidence += 1;
  });

  return {
    total: candidates.length,
    pending,
    conflicts,
    missingSource,
    lowConfidence,
  };
}
