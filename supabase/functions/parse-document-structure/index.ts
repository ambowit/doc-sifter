import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ParseDocumentStructureRequest {
  fileId: string;
  projectId: string;
  extractedText: string;
  fileName: string;
}

interface DocumentSection {
  title: string;
  level: number;
  orderIndex: number;
  content: string;
  startPosition: number;
  endPosition: number;
}

interface AIResponse {
  sections: Array<{
    title: string;
    level: number;
    content: string;
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

// 使用 AI 解析文档结构
async function parseDocumentWithAI(
  text: string,
  fileName: string,
  gatewayUrl: string,
  gatewayToken: string
): Promise<DocumentSection[]> {
  const systemPrompt = `你是一个专业的文档结构解析助手。你的任务是分析文档内容，识别其章节结构，并按章节切分内容。

请严格按照以下JSON格式输出：
{
  "sections": [
    {
      "title": "章节标题",
      "level": 1,
      "content": "该章节的完整内容文本"
    }
  ]
}

规则：
1. level=1 表示一级标题（如"一、"、"第一章"、"1."等）
2. level=2 表示二级标题（如"(一)"、"1.1"、"（1）"等）
3. level=3 表示三级标题
4. 每个章节的content应包含该章节标题下的所有正文内容，直到下一个同级或更高级标题
5. 如果文档没有明显的章节结构，尝试按段落主题进行合理切分
6. 保持原文内容的完整性，不要省略或修改
7. 只输出JSON，不要有其他文字`;

  const userPrompt = `请分析以下文档（文件名：${fileName}）的结构，识别章节并切分内容：

${text.slice(0, 50000)}`;

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
      max_tokens: 16000,
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
    console.error("[parse-document-structure] Failed to parse AI response:", e);
    throw new Error("Failed to parse AI response as JSON");
  }

  if (!Array.isArray(parsed.sections)) {
    throw new Error("Invalid AI response structure: missing sections array");
  }

  // 转换为 DocumentSection 格式，计算位置
  const sections: DocumentSection[] = [];
  let currentPosition = 0;

  for (let i = 0; i < parsed.sections.length; i++) {
    const section = parsed.sections[i];
    const content = section.content || "";
    
    // 尝试在原文中找到该章节的位置
    let startPosition = text.indexOf(section.title, currentPosition);
    if (startPosition === -1) {
      startPosition = currentPosition;
    }
    
    // 计算结束位置
    let endPosition = startPosition + content.length;
    if (i < parsed.sections.length - 1) {
      const nextTitle = parsed.sections[i + 1].title;
      const nextPos = text.indexOf(nextTitle, startPosition + 1);
      if (nextPos > startPosition) {
        endPosition = nextPos;
      }
    }

    sections.push({
      title: section.title,
      level: section.level || 1,
      orderIndex: i,
      content: content,
      startPosition: startPosition,
      endPosition: endPosition,
    });

    currentPosition = endPosition;
  }

  return sections;
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

    const payload: ParseDocumentStructureRequest = await req.json();
    const { fileId, projectId, extractedText, fileName } = payload;

    if (!fileId || !projectId || !extractedText) {
      return jsonResponse({ 
        success: false, 
        error: "Missing required fields: fileId, projectId, extractedText" 
      }, 400);
    }

    console.log(`[parse-document-structure] Processing file: ${fileName} (${fileId})`);
    console.log(`[parse-document-structure] Text length: ${extractedText.length}`);

    // 调用 AI 解析文档结构
    const sections = await parseDocumentWithAI(
      extractedText,
      fileName,
      gatewayUrl,
      gatewayToken
    );

    console.log(`[parse-document-structure] Parsed ${sections.length} sections`);

    // 删除该文件的旧章节数据
    await admin
      .from("file_sections")
      .delete()
      .eq("file_id", fileId);

    // 插入新的章节数据
    if (sections.length > 0) {
      const insertData = sections.map((section) => ({
        file_id: fileId,
        project_id: projectId,
        title: section.title,
        level: section.level,
        order_index: section.orderIndex,
        content: section.content,
        start_position: section.startPosition,
        end_position: section.endPosition,
      }));

      const { error: insertError } = await admin
        .from("file_sections")
        .insert(insertData);

      if (insertError) {
        console.error("[parse-document-structure] Insert error:", insertError);
        return jsonResponse({ 
          success: false, 
          error: `Failed to save sections: ${insertError.message}` 
        }, 500);
      }
    }

    return jsonResponse({
      success: true,
      fileId,
      sectionsCount: sections.length,
      sections: sections.map(s => ({
        title: s.title,
        level: s.level,
        contentLength: s.content.length,
      })),
    });

  } catch (error) {
    console.error("[parse-document-structure] Error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ success: false, error: message }, 500);
  }
});
