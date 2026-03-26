import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface MatchRequest {
  projectId: string;
  fileId?: string; // 可选，如果指定则只匹配该文件的章节
}

interface Chapter {
  id: string;
  number: string | null;
  title: string;
  level: number;
}

interface FileSection {
  id: string;
  file_id: string;
  title: string;
  level: number;
  content: string;
}

interface MatchResult {
  sectionId: string;
  chapterId: string | null;
  confidence: number;
}

interface AIResponse {
  matches: Array<{
    sectionId: string;
    chapterId: string | null;
    confidence: number;
    reason?: string;
  }>;
}

function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// 使用 AI 进行章节匹配
async function matchSectionsWithAI(
  sections: FileSection[],
  chapters: Chapter[],
  gatewayUrl: string,
  gatewayToken: string
): Promise<MatchResult[]> {
  if (sections.length === 0 || chapters.length === 0) {
    return [];
  }

  const systemPrompt = `你是一个专业的文档章节匹配助手。你的任务是将文档中的章节与模板章节进行匹配。

请严格按照以下JSON格式输出：
{
  "matches": [
    {
      "sectionId": "文档章节ID",
      "chapterId": "匹配的模板章节ID或null",
      "confidence": 85,
      "reason": "匹配原因简述"
    }
  ]
}

匹配规则：
1. 根据章节标题的语义相似性进行匹配
2. 考虑章节层级关系
3. 如果无法找到合适的匹配，chapterId设为null
4. confidence为0-100的置信度分数
5. 每个文档章节只能匹配一个模板章节
6. 优先匹配标题相似度高的章节
7. 只输出JSON，不要有其他文字`;

  const sectionsInfo = sections.map(s => ({
    id: s.id,
    title: s.title,
    level: s.level,
    contentPreview: s.content?.slice(0, 200) || "",
  }));

  const chaptersInfo = chapters.map(c => ({
    id: c.id,
    number: c.number,
    title: c.title,
    level: c.level,
  }));

  const userPrompt = `请将以下文档章节与模板章节进行匹配：

【文档章节】
${JSON.stringify(sectionsInfo, null, 2)}

【模板章节】
${JSON.stringify(chaptersInfo, null, 2)}

请为每个文档章节找到最匹配的模板章节。`;

  const response = await fetch(gatewayUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${gatewayToken}`,
    },
    body: JSON.stringify({
      model: "anthropic/claude-sonnet-4",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 8000,
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";

  // 解析 JSON 响应
  let jsonStr = content;
  const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  } else {
    const plainMatch = content.match(/\{[\s\S]*\}/);
    if (plainMatch) {
      jsonStr = plainMatch[0];
    }
  }

  let parsed: AIResponse;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    console.error("[match-sections-to-chapters] Failed to parse AI response:", e);
    throw new Error("Failed to parse AI response as JSON");
  }

  if (!Array.isArray(parsed.matches)) {
    throw new Error("Invalid AI response structure: missing matches array");
  }

  return parsed.matches.map(m => ({
    sectionId: m.sectionId,
    chapterId: m.chapterId,
    confidence: m.confidence || 0,
  }));
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const gatewayUrl = Deno.env.get("OOOK_AI_GATEWAY_URL");
    const gatewayToken = Deno.env.get("OOOK_AI_GATEWAY_TOKEN");

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ success: false, error: "Server configuration missing" }, 500);
    }

    if (!gatewayUrl || !gatewayToken) {
      return jsonResponse({ success: false, error: "AI Gateway configuration missing" }, 500);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 验证用户身份
    const token = getBearerToken(req);
    if (!token) {
      return jsonResponse({ success: false, error: "Missing access token" }, 401);
    }

    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) {
      return jsonResponse({ success: false, error: "Invalid access token" }, 401);
    }

    const payload: MatchRequest = await req.json();
    const { projectId, fileId } = payload;

    if (!projectId) {
      return jsonResponse({ success: false, error: "Missing required field: projectId" }, 400);
    }

    console.log(`[match-sections-to-chapters] Processing project: ${projectId}, fileId: ${fileId || "all"}`);

    // 获取模板章节
    const { data: chapters, error: chaptersError } = await admin
      .from("chapters")
      .select("id, number, title, level")
      .eq("project_id", projectId)
      .order("order_index", { ascending: true });

    if (chaptersError) {
      console.error("[match-sections-to-chapters] Chapters query error:", chaptersError);
      return jsonResponse({ success: false, error: "Failed to fetch chapters" }, 500);
    }

    if (!chapters || chapters.length === 0) {
      return jsonResponse({ 
        success: false, 
        error: "No template chapters found for this project" 
      }, 400);
    }

    // 获取文件章节
    let sectionsQuery = admin
      .from("file_sections")
      .select("id, file_id, title, level, content")
      .eq("project_id", projectId)
      .is("matched_chapter_id", null) // 只匹配未匹配的章节
      .order("order_index", { ascending: true });

    if (fileId) {
      sectionsQuery = sectionsQuery.eq("file_id", fileId);
    }

    const { data: sections, error: sectionsError } = await sectionsQuery;

    if (sectionsError) {
      console.error("[match-sections-to-chapters] Sections query error:", sectionsError);
      return jsonResponse({ success: false, error: "Failed to fetch file sections" }, 500);
    }

    if (!sections || sections.length === 0) {
      return jsonResponse({
        success: true,
        message: "No unmatched sections found",
        matchedCount: 0,
      });
    }

    console.log(`[match-sections-to-chapters] Found ${sections.length} sections to match with ${chapters.length} chapters`);

    // 调用 AI 进行匹配
    const matches = await matchSectionsWithAI(
      sections as FileSection[],
      chapters as Chapter[],
      gatewayUrl,
      gatewayToken
    );

    console.log(`[match-sections-to-chapters] AI returned ${matches.length} matches`);

    // 更新数据库
    let successCount = 0;
    let failCount = 0;

    for (const match of matches) {
      if (match.chapterId) {
        const { error: updateError } = await admin
          .from("file_sections")
          .update({
            matched_chapter_id: match.chapterId,
            match_confidence: match.confidence,
            match_method: "auto",
          })
          .eq("id", match.sectionId);

        if (updateError) {
          console.error(`[match-sections-to-chapters] Update error for section ${match.sectionId}:`, updateError);
          failCount++;
        } else {
          successCount++;
        }
      }
    }

    return jsonResponse({
      success: true,
      totalSections: sections.length,
      matchedCount: successCount,
      failedCount: failCount,
      matches: matches.map(m => ({
        sectionId: m.sectionId,
        chapterId: m.chapterId,
        confidence: m.confidence,
      })),
    });

  } catch (error) {
    console.error("[match-sections-to-chapters] Error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ success: false, error: message }, 500);
  }
});
