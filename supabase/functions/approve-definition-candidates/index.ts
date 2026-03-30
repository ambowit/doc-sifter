import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireProjectAccess } from "../_shared/auth.ts";
import { inferEntityType, normalizeLookupKey, normalizeWhitespace } from "../_shared/definitions.ts";
import { corsHeaders, jsonResponse } from "../_shared/worker-hmac.ts";

interface ApproveRequest {
  projectId?: string;
  candidateIds?: string[];
}

interface CandidateRow {
  id: string;
  project_id: string;
  short_name: string | null;
  full_name: string | null;
  entity_type: string | null;
  notes: string | null;
  confidence: number | null;
  source_file_id: string | null;
  source_page_ref: string | null;
  source_excerpt: string | null;
  source_trace: unknown;
  merged_definition_id: string | null;
  status: string;
}

interface DefinitionRow {
  id: string;
  short_name: string;
  full_name: string;
  is_locked: boolean;
  origin: string | null;
}

function respondFromError(error: Error) {
  const message = error.message || "Unknown error";
  if (message.startsWith("UNAUTHORIZED:")) return jsonResponse({ error: message.replace("UNAUTHORIZED: ", "") }, 401);
  if (message.startsWith("FORBIDDEN:")) return jsonResponse({ error: message.replace("FORBIDDEN: ", "") }, 403);
  if (message.startsWith("NOT_FOUND:")) return jsonResponse({ error: message.replace("NOT_FOUND: ", "") }, 404);
  return jsonResponse({ error: message }, 500);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Server configuration missing" }, 500);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = (await req.json().catch(() => ({}))) as ApproveRequest;
    const projectId = body.projectId?.trim();
    const candidateIds = [...new Set((body.candidateIds || []).filter((id): id is string => typeof id === "string" && id.trim().length > 0))];
    if (!projectId || candidateIds.length === 0) {
      return jsonResponse({ error: "projectId and candidateIds are required" }, 400);
    }

    await requireProjectAccess(req, admin, projectId);

    const { data: candidateRows, error: candidateError } = await admin
      .from("definition_candidates")
      .select("id, project_id, short_name, full_name, entity_type, notes, confidence, source_file_id, source_page_ref, source_excerpt, source_trace, merged_definition_id, status")
      .eq("project_id", projectId)
      .in("id", candidateIds);

    if (candidateError) {
      return jsonResponse({ error: candidateError.message }, 500);
    }

    const candidates = ((candidateRows || []) as CandidateRow[]).filter((item) => item.status !== "approved");
    if (candidates.length === 0) {
      return jsonResponse({ success: true, approved: 0, skipped: candidateIds.length, updated: 0, inserted: 0 });
    }

    const { data: definitionRows, error: definitionError } = await admin
      .from("definitions")
      .select("id, short_name, full_name, is_locked, origin")
      .eq("project_id", projectId);

    if (definitionError) {
      return jsonResponse({ error: definitionError.message }, 500);
    }

    const definitions = (definitionRows || []) as DefinitionRow[];
    const byId = new Map(definitions.map((definition) => [definition.id, definition]));
    const byShort = new Map(definitions.map((definition) => [normalizeLookupKey(definition.short_name), definition]));
    const byFull = new Map(definitions.map((definition) => [normalizeLookupKey(definition.full_name), definition]));

    let approved = 0;
    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const candidate of candidates) {
      const shortName = normalizeWhitespace(candidate.short_name);
      const fullName = normalizeWhitespace(candidate.full_name);
      if (!shortName || !fullName) {
        skipped += 1;
        continue;
      }

      let targetDefinition = candidate.merged_definition_id ? byId.get(candidate.merged_definition_id) : undefined;
      if (!targetDefinition) {
        const matchedByShort = byShort.get(normalizeLookupKey(shortName));
        const matchedByFull = byFull.get(normalizeLookupKey(fullName));
        if (matchedByShort && matchedByFull && matchedByShort.id === matchedByFull.id) {
          targetDefinition = matchedByShort;
        }
      }

      const payload = {
        project_id: projectId,
        short_name: shortName,
        full_name: fullName,
        entity_type: candidate.entity_type || inferEntityType(fullName, shortName),
        notes: candidate.notes,
        source_file_id: candidate.source_file_id,
        source_page_ref: candidate.source_page_ref,
        source_excerpt: candidate.source_excerpt,
        source_trace: candidate.source_trace || [],
        origin: targetDefinition?.origin === "manual" ? "manual" : "ai",
        is_locked: targetDefinition?.is_locked ?? false,
        last_synced_candidate_id: candidate.id,
        updated_at: new Date().toISOString(),
      };

      let definitionId = targetDefinition?.id;
      if (definitionId) {
        const { error: updateError } = await admin
          .from("definitions")
          .update(payload)
          .eq("id", definitionId);

        if (updateError) {
          throw new Error(updateError.message);
        }
        updated += 1;
      } else {
        const { data: insertedDefinition, error: insertError } = await admin
          .from("definitions")
          .insert({ ...payload, created_at: new Date().toISOString() })
          .select("id, short_name, full_name, is_locked, origin")
          .single();

        if (insertError || !insertedDefinition) {
          throw new Error(insertError?.message || "定义写入失败");
        }
        definitionId = insertedDefinition.id;
        const row = insertedDefinition as DefinitionRow;
        byId.set(row.id, row);
        byShort.set(normalizeLookupKey(row.short_name), row);
        byFull.set(normalizeLookupKey(row.full_name), row);
        inserted += 1;
      }

      const { error: candidateUpdateError } = await admin
        .from("definition_candidates")
        .update({
          status: "approved",
          merged_definition_id: definitionId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", candidate.id);

      if (candidateUpdateError) {
        throw new Error(candidateUpdateError.message);
      }

      approved += 1;
    }

    return jsonResponse({ success: true, approved, inserted, updated, skipped });
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    console.error("[approve-definition-candidates] ERROR", normalized);
    return respondFromError(normalized);
  }
});
