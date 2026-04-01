import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAIGateway } from "../_shared/ai-gateway.ts";
import { requireProjectAccess } from "../_shared/auth.ts";
import {
  buildDefinitionPrompts,
  buildSnippetsForFiles,
  categorizeFile,
  clampConfidence,
  dedupeExtractedItems,
  FILES_PER_BATCH,
  inferEntityType,
  normalizeLookupKey,
  normalizeWhitespace,
  parseDefinitionResponse,
  type DefinitionSourceTraceItem,
  type ExtractedDefinitionItem,
  type SourceFileLike,
} from "../_shared/definitions.ts";
import { corsHeaders, jsonResponse } from "../_shared/worker-hmac.ts";

interface ExtractDefinitionsRequest {
  projectId?: string;
  mode?: "refresh" | "incremental";
}

interface FileRow {
  id: string;
  name: string;
  original_name: string | null;
  extracted_text: string | null;
  text_summary: string | null;
}

interface ExistingDefinition {
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
    const apiKey = Deno.env.get("OOOK_AI_GATEWAY_TOKEN");

    if (!supabaseUrl || !serviceRoleKey || !apiKey) {
      return jsonResponse({ error: "Server configuration missing" }, 500);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = (await req.json().catch(() => ({}))) as ExtractDefinitionsRequest;
    const projectId = body.projectId?.trim();
    const mode = body.mode === "incremental" ? "incremental" : "refresh";
    if (!projectId) {
      return jsonResponse({ error: "projectId is required" }, 400);
    }

    const { project } = await requireProjectAccess(req, admin, projectId);

    const { data: files, error: fileError } = await admin
      .from("files")
      .select("id, name, original_name, extracted_text, text_summary")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });

    if (fileError) {
      return jsonResponse({ error: fileError.message }, 500);
    }

    const processedFiles: SourceFileLike[] = ((files || []) as FileRow[]).map((file) => ({
      id: file.id,
      name: file.original_name || file.name,
      category: categorizeFile(file.original_name || file.name || ""),
      extractedText: file.extracted_text,
      textSummary: file.text_summary,
    })).filter((file) => normalizeWhitespace(file.extractedText || file.textSummary));

    const batchId = crypto.randomUUID();

    let archived = 0;
    if (mode === "refresh") {
      // 仅清除未处理的候选（pending_review）
      const { data: archivedRows, error: archiveError } = await admin
        .from("definition_candidates")
        .update({ status: "archived", updated_at: new Date().toISOString() })
        .eq("project_id", projectId)
        .eq("status", "pending_review")
        .select("id");

      if (archiveError) {
        return jsonResponse({ error: archiveError.message }, 500);
      }
      archived = archivedRows?.length || 0;
    }

    if (processedFiles.length === 0) {
      return jsonResponse({
        success: true,
        batchId,
        inserted: 0,
        updated: 0,
        pendingReview: 0,
        archived,
        skipped: 0,
        conflicts: 0,
        message: "当前项目暂无可用于提取定义的 OCR 内容",
      });
    }

    // 按文件分批处理，确保所有文件都被 AI 分析
    const fileBatches: SourceFileLike[][] = [];
    for (let i = 0; i < processedFiles.length; i += FILES_PER_BATCH) {
      fileBatches.push(processedFiles.slice(i, i + FILES_PER_BATCH));
    }

    console.log(`[extract-definitions] Processing ${processedFiles.length} files in ${fileBatches.length} batches`);

    const allExtracted: ExtractedDefinitionItem[] = [];
    let totalSnippets = 0;
    let batchErrors: string[] = [];

    for (let batchIndex = 0; batchIndex < fileBatches.length; batchIndex++) {
      const fileBatch = fileBatches[batchIndex];
      const snippets = buildSnippetsForFiles(fileBatch);

      if (snippets.length === 0) {
        console.log(`[extract-definitions] Batch ${batchIndex + 1}/${fileBatches.length}: no snippets found, skipping`);
        continue;
      }

      totalSnippets += snippets.length;
      console.log(`[extract-definitions] Batch ${batchIndex + 1}/${fileBatches.length}: ${fileBatch.length} files, ${snippets.length} snippets`);

      try {
        const { systemPrompt, userPrompt } = buildDefinitionPrompts(project, snippets);
        const aiResponse = await callAIGateway(apiKey, systemPrompt, userPrompt, 60000);
        const batchExtracted = parseDefinitionResponse(aiResponse);
        allExtracted.push(...batchExtracted);
        console.log(`[extract-definitions] Batch ${batchIndex + 1}/${fileBatches.length}: extracted ${batchExtracted.length} items`);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(`[extract-definitions] Batch ${batchIndex + 1}/${fileBatches.length} failed: ${errMsg}`);
        batchErrors.push(`批次${batchIndex + 1}失败: ${errMsg}`);
        // 继续处理其他批次，不中断
      }
    }

    if (totalSnippets === 0) {
      return jsonResponse({
        success: true,
        batchId,
        inserted: 0,
        updated: 0,
        pendingReview: 0,
        archived,
        skipped: 0,
        conflicts: 0,
        message: "未在文件中找到与定义管理高度相关的文本片段",
      });
    }

    const extracted = dedupeExtractedItems(allExtracted);
    console.log(`[extract-definitions] Total extracted after dedup: ${extracted.length} items from ${allExtracted.length} raw items`);

    const { data: existingDefinitions, error: definitionsError } = await admin
      .from("definitions")
      .select("id, short_name, full_name, is_locked, origin")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });

    if (definitionsError) {
      return jsonResponse({ error: definitionsError.message }, 500);
    }

    const finalDefinitions = (existingDefinitions || []) as ExistingDefinition[];
    const shortNameMap = new Map<string, ExistingDefinition>();
    const fullNameMap = new Map<string, ExistingDefinition>();
    finalDefinitions.forEach((definition) => {
      const shortKey = normalizeLookupKey(definition.short_name);
      const fullKey = normalizeLookupKey(definition.full_name);
      if (shortKey && !shortNameMap.has(shortKey)) shortNameMap.set(shortKey, definition);
      if (fullKey && !fullNameMap.has(fullKey)) fullNameMap.set(fullKey, definition);
    });

    const fileNameMap = new Map<string, { id: string; name: string }>();
    processedFiles.forEach((file) => {
      const key = normalizeLookupKey(file.name);
      if (key && !fileNameMap.has(key)) fileNameMap.set(key, { id: file.id, name: file.name });
    });

    const candidateRows: Array<Record<string, unknown>> = [];
    let skipped = 0;
    let conflicts = 0;

    for (const item of extracted) {
      const shortName = normalizeWhitespace(item.shortName);
      const fullName = normalizeWhitespace(item.fullName);
      if (!shortName && !fullName) {
        skipped += 1;
        continue;
      }
      if (shortName && fullName && normalizeLookupKey(shortName) === normalizeLookupKey(fullName)) {
        // 无效定义：简称与全称一致
        skipped += 1;
        continue;
      }

      const sourceFileName = normalizeWhitespace(item.sourceFileName);
      const sourceExcerpt = normalizeWhitespace(item.sourceExcerpt);
      const sourcePageRef = normalizeWhitespace(item.sourcePageRef);
      const confidence = clampConfidence(item.confidence);
      const mappedFile = sourceFileName ? fileNameMap.get(normalizeLookupKey(sourceFileName)) : undefined;
      const matchedByShort = shortName ? shortNameMap.get(normalizeLookupKey(shortName)) : undefined;
      const matchedByFull = fullName ? fullNameMap.get(normalizeLookupKey(fullName)) : undefined;

      let hasConflict = false;
      let conflictWith: string | null = null;
      let reviewReason: string | null = null;
      let mergedDefinitionId: string | null = null;

      if (matchedByShort && matchedByFull && matchedByShort.id === matchedByFull.id) {
        mergedDefinitionId = matchedByShort.id;
        reviewReason = matchedByShort.is_locked ? "matched_locked_definition" : "matched_existing_definition";
      } else if (matchedByShort && fullName && normalizeLookupKey(matchedByShort.full_name) !== normalizeLookupKey(fullName)) {
        hasConflict = true;
        conflictWith = matchedByShort.full_name;
        reviewReason = "short_name_conflict";
      } else if (matchedByFull && shortName && normalizeLookupKey(matchedByFull.short_name) !== normalizeLookupKey(shortName)) {
        hasConflict = true;
        conflictWith = matchedByFull.short_name;
        reviewReason = "full_name_alias";
      } else if (!shortName || !fullName) {
        reviewReason = "incomplete_definition";
      } else if (!mappedFile && !sourceExcerpt) {
        reviewReason = "missing_source";
      }

      if (hasConflict) {
        conflicts += 1;
      }

      const entityType = (["company", "individual", "institution", "transaction", "other"].includes(String(item.entityType || ""))
        ? item.entityType
        : inferEntityType(fullName, shortName)) as string;

      const sourceTrace: DefinitionSourceTraceItem[] = [{
        sourceFileId: mappedFile?.id || null,
        sourceFileName: mappedFile?.name || sourceFileName || null,
        sourcePageRef: sourcePageRef || null,
        sourceExcerpt: sourceExcerpt || null,
        confidence,
        reviewReason,
        raw: {
          shortName,
          fullName,
          entityType,
        },
      }];

      candidateRows.push({
        project_id: projectId,
        short_name: shortName || null,
        full_name: fullName || null,
        entity_type: entityType,
        notes: item.description || null,
        confidence,
        status: "pending_review",
        origin: "ai",
        source_file_id: mappedFile?.id || null,
        source_page_ref: sourcePageRef || null,
        source_excerpt: sourceExcerpt || null,
        source_trace: sourceTrace,
        extraction_batch_id: batchId,
        merged_definition_id: mergedDefinitionId,
        has_conflict: hasConflict,
        conflict_with: conflictWith,
        review_reason: reviewReason,
      });
    }

    if (candidateRows.length === 0) {
      return jsonResponse({
        success: true,
        batchId,
        inserted: 0,
        updated: 0,
        pendingReview: 0,
        archived,
        skipped,
        conflicts,
        message: "AI 未识别到可用的定义候选",
      });
    }

    const { data: insertedRows, error: insertError } = await admin
      .from("definition_candidates")
      .insert(candidateRows)
      .select("id");

    if (insertError) {
      return jsonResponse({ error: insertError.message }, 500);
    }

    return jsonResponse({
      success: true,
      batchId,
      inserted: insertedRows?.length || 0,
      updated: 0,
      pendingReview: insertedRows?.length || 0,
      archived,
      skipped,
      conflicts,
      sourceFiles: processedFiles.length,
      snippets: totalSnippets,
      rawItems: allExtracted.length,
      batches: fileBatches.length,
      batchErrors: batchErrors.length > 0 ? batchErrors : undefined,
    });
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    console.error("[extract-definitions] ERROR", normalized);
    return respondFromError(normalized);
  }
});
