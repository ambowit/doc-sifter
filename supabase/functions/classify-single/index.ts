import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const log = (msg: string, data?: unknown) =>
  console.log(`[classify-single] ${msg}${data !== undefined ? " " + JSON.stringify(data) : ""}`);

interface FileInput {
  id: string;
  name: string;
  extractedText?: string | null;
  textSummary?: string | null;
}

interface ChapterInput {
  id: string;
  number: string;
  title: string;
  level: number;
}

interface ClassifyRequest {
  projectId: string;
  file: FileInput;
  chapters: ChapterInput[];
}

interface ClassifyResult {
  fileId: string;
  chapterId: string | null;
  summary: string;
  confidence: number;
}

async function classifySingleFile(
  file: FileInput,
  chapters: ChapterInput[],
  token: string,
  gatewayBase: string
): Promise<ClassifyResult> {
  const level1 = chapters.filter((c) => c.level === 1);

  const chapterList = level1
    .map((c) => {
      const label = c.number && c.number !== c.title ? `${c.number}、${c.title}` : c.title;
      return `{"id":"${c.id}","title":"${label}"}`;
    })
    .join(", ");

  const hint = (file.extractedText || file.textSummary || "").substring(0, 500);

  const systemPrompt = `你是法律尽职调查专家。根据文件名和内容，将文件分类到尽调报告章节。

文件名语义匹配规则：
- 营业执照、工商登记、公司章程、股权结构、股东名册 → 基本情况
- 章程、议事记录、决议、股东会决议 → 公司治理
- 检验报告、审计、财务报表、资产负债表 → 财务
- 税务登记、纳税记录、完税证明 → 税务
- 劳动合同、社保、公积金、员工花名册 → 劳动人事
- 专利、商标、著作权、软著登记证书 → 知识产权
- 客户合同、采购合同、服务合同、借款合同 → 重大合同
- 诉讼、仲裁、判决书、行政处罚 → 诉讼与行政处罚
- 房产证、土地证、不动产、设备清单 → 资产
- 关联方、关联交易、同业竞争 → 关联交易和同业竞争
- 资质证、许可证、批准、备案 → 合规经营
- 业务合同、销售合同 → 业务经营

只返回一个JSON对象：{"chapterId":"章节id或null","summary":"≤20字摘要","confidence":0-100}`;

  const userPrompt = `章节：[${chapterList}]

文件名：${file.name}
${hint ? `内容片段：${hint}` : ""}

请分类此文件。`;

  const res = await fetch(`${gatewayBase}/api/ai/execute`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      capability: "ai.general_user_defined",
      input: {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 200,
      },
      constraints: { maxCost: 0.1 },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AI error ${res.status}: ${err.substring(0, 100)}`);
  }

  const aiData = await res.json();
  const raw: string = aiData.data?.content || aiData.content || "";

  let jsonStr = raw.trim();
  const codeBlock = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock?.[1]) jsonStr = codeBlock[1].trim();
  else {
    const s = jsonStr.indexOf("{");
    const e = jsonStr.lastIndexOf("}");
    if (s !== -1 && e > s) jsonStr = jsonStr.substring(s, e + 1);
  }

  const parsed = JSON.parse(jsonStr);
  return {
    fileId: file.id,
    chapterId: !parsed.chapterId || parsed.chapterId === "null" || parsed.chapterId === "" ? null : parsed.chapterId,
    summary: parsed.summary || "",
    confidence: parsed.confidence || 0,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as ClassifyRequest;
    const { projectId, file, chapters } = body;

    if (!projectId || !file?.id || !chapters?.length) {
      return new Response(
        JSON.stringify({ error: "projectId, file, chapters 不能为空" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = Deno.env.get("OOOK_AI_GATEWAY_TOKEN");
    const gatewayBase = (Deno.env.get("OOOK_AI_GATEWAY_URL") || "https://gateway.oook.cn").replace(/\/$/, "");
    if (!token) throw new Error("OOOK_AI_GATEWAY_TOKEN 未配置");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, supabaseKey);

    log("Classifying", { fileId: file.id, fileName: file.name });

    const result = await classifySingleFile(file, chapters, token, gatewayBase);

    // 写入 chapter_file_mappings（不再写 files.chapter_id）
    const now = new Date().toISOString();

    if (result.chapterId) {
      const { error: mappingError } = await db
        .from("chapter_file_mappings")
        .upsert(
          {
            chapter_id: result.chapterId,
            file_id: file.id,
            is_confirmed: false,
            is_ai_suggested: true,
            confidence: result.confidence,
          },
          { onConflict: "chapter_id,file_id" }
        );
      if (mappingError) log("Mapping error", { error: mappingError.message });
    }

    // 更新文件分类统计信息（不写 chapter_id）
    await db
      .from("files")
      .update({
        ai_summary: result.summary || null,
        classification_confidence: result.confidence,
        ai_classified_at: now,
      })
      .eq("id", file.id)
      .eq("project_id", projectId);

    log("Done", { fileId: file.id, chapterId: result.chapterId, confidence: result.confidence });

    return new Response(
      JSON.stringify({ success: true, result }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log("ERROR", { message: msg });
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
