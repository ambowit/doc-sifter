import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const log = (msg: string, data?: unknown) =>
  console.log(`[classify-files] ${msg}${data !== undefined ? " " + JSON.stringify(data) : ""}`);

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
  parentId?: string | null;
}

interface ClassifyRequest {
  projectId: string;
  files: FileInput[];
  chapters: ChapterInput[];
}

interface ClassifyResult {
  fileId: string;
  chapterId: string | null;
  summary: string;
  confidence: number;
}

async function classifyBatch(
  files: FileInput[],
  chapters: ChapterInput[],
  token: string,
  gatewayBase: string
): Promise<ClassifyResult[]> {
  const level1 = chapters.filter((c) => c.level === 1);

  const chapterList = level1
    .map((c) => {
      const label = c.number && c.number !== c.title ? `${c.number}、${c.title}` : c.title;
      return `  {"id":"${c.id}","title":"${label}"}`;
    })
    .join(",\n");

  const fileList = files
    .map((f, i) => {
      const hint = (f.extractedText || f.textSummary || "").substring(0, 200);
      return `  [${i}] id:"${f.id}" 文件名:"${f.name}"${hint ? ` 内容:"${hint}"` : ""}`;
    })
    .join("\n");

  const systemPrompt = `你是法律尽职调查专家。根据文件名和内容片段，将每个文件分类到尽调报告章节。

文件名语义匹配规则：
- 营业执照、工商登记、公司章程、工商居登记、股权结构、股东名册 → 基本情况
- 章程、议事记录、节记、和解协议、决议 → 公司治理
- 检验报告、审计、财务报表、资产负债表 → 财务
- 税务登记、纳税记录、增值税、所得税、完税证明 → 税务
- 劳动合同、社保、公积金、员工花名册、花名册 → 劳动人事
- 专利、商标、著作权、软著登记证书 → 知识产权
- 客户合同、采购合同、供应商协议、服务合同、借款合同、担保合同 → 重大合同
- 诉讼、仲裁、判决书、行政处罚、强制执行 → 诉讼与行政处罚
- 房产证、土地证、不动产、源代码、设备清单 → 资产
- 关联方、关联交易、同业竞争、关联公司 → 关联交易和同业竞争
- 资质证、许可证、批准、备案证明 → 合规经营(如有)
- 业务合同、客户合同、销售合同、采购合同 → 业务经营(如有)

要求：
1. 为每个文件生成≤20字摘要（直接说明文件是什么）
2. 从章节列表匹配最相关的 id（实在无法匹配则填null）
3. 置信度 0-100，凭文件名匹配把握70+，不确定则5-40

只返回合法JSON数组：
[{"fileId":"xxx","chapterId":"yyy或null","summary":"摘要","confidence":85}]`;

  const userPrompt = `章节列表：
[
${chapterList}
]

文件列表：
${fileList}

请逐一匹配，只返回JSON数组。`;

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
      },
      constraints: { maxCost: 2.0 },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AI error ${res.status}: ${err.substring(0, 200)}`);
  }

  const aiData = await res.json();
  const raw: string = aiData.data?.content || aiData.content || "";

  let jsonStr = raw.trim();
  const codeBlock = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock?.[1]) jsonStr = codeBlock[1].trim();
  else {
    const s = jsonStr.indexOf("[");
    const e = jsonStr.lastIndexOf("]");
    if (s !== -1 && e > s) jsonStr = jsonStr.substring(s, e + 1);
  }

  const parsed = JSON.parse(jsonStr) as ClassifyResult[];
  return parsed.map((r) => ({
    ...r,
    chapterId: !r.chapterId || r.chapterId === "null" || r.chapterId === "" ? null : r.chapterId,
  }));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as ClassifyRequest;
    const { projectId, files, chapters } = body;

    if (!projectId || !files?.length || !chapters?.length) {
      return new Response(
        JSON.stringify({ error: "projectId, files, chapters 不能为空" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = Deno.env.get("OOOK_AI_GATEWAY_TOKEN");
    const gatewayBase = (Deno.env.get("OOOK_AI_GATEWAY_URL") || "https://gateway.oook.cn").replace(/\/$/, "");
    if (!token) throw new Error("OOOK_AI_GATEWAY_TOKEN 未配置");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, supabaseKey);

    log("Start", { projectId, fileCount: files.length, chapterCount: chapters.length });

    const BATCH_SIZE = 15;
    const allResults: ClassifyResult[] = [];

    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}`, { count: batch.length });
      try {
        const results = await classifyBatch(batch, chapters, token, gatewayBase);
        allResults.push(...results);
      } catch (err) {
        log("Batch error", { error: String(err) });
        batch.forEach((f) =>
          allResults.push({ fileId: f.id, chapterId: null, summary: "", confidence: 0 })
        );
      }
    }

    log("AI done", { total: allResults.length });

    const now = new Date().toISOString();
    await Promise.all(
      allResults.map((r) =>
        db
          .from("files")
          .update({
            chapter_id: r.chapterId,
            ai_summary: r.summary || null,
            classification_confidence: r.confidence,
            ai_classified_at: now,
          })
          .eq("id", r.fileId)
          .eq("project_id", projectId)
      )
    );

    log("DB updated");

    return new Response(
      JSON.stringify({ success: true, classified: allResults.length, results: allResults }),
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
