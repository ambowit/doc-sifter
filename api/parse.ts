import type { VercelRequest, VercelResponse } from "@vercel/node";

interface ParseRequest {
  type: "template" | "document" | "generate-structure";
  content?: string;
  filename?: string;
  projectType?: string;
  fileData?: string;
  mimeType?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { type, content, filename, projectType } = req.body as ParseRequest;
    console.log("[parse] Received request", { type, filename, contentLength: content?.length, projectType });

    const apiKey = process.env.OOOK_AI_GATEWAY_TOKEN;
    const gatewayUrl = process.env.OOOK_AI_GATEWAY_URL || "https://gateway.oook.cn/";

    console.log("[parse] Environment check", {
      hasApiKey: !!apiKey,
      apiKeyLength: apiKey?.length,
      gatewayUrl,
    });

    if (!apiKey) {
      return res.status(500).json({ 
        error: "OOOK_AI_GATEWAY_TOKEN 未配置，请在 Vercel 项目设置中添加环境变量" 
      });
    }

    let systemPrompt: string;
    let userPrompt: string;
    const actualContent = content || "";

    if (type === "template" || type === "generate-structure") {
      const hasUsefulContent = actualContent && actualContent.length > 50 && 
        !actualContent.includes("无法在浏览器中直接解析") && 
        !actualContent.includes("[文件:");

      if (hasUsefulContent) {
        systemPrompt = `你是一个专业的法律尽调报告分析专家。你的任务是从用户上传的尽调报告中**完整提取目录结构**。

## 重要：识别所有章节层级

### 一级章节（大章）标记模式：
- 中文数字编号："一、"、"二、"、"三、"..."十、" 等
- 阿拉伯数字："1."、"2."、"3." 或 "1、"、"2、"
- 第X章格式："第一章"、"第二章"
- 无编号的独立标题：如 "引言"、"定义"、"报告正文"、"股权结构图" 等

### 二级章节（子项）标记模式：
- "(一)"、"(二)"、"(三)" 等括号中文编号
- "1.1"、"1.2"、"2.1" 等层级编号
- "(1)"、"(2)"、"(3)" 等括号阿拉伯数字

## 输出要求
- **必须完整提取所有一级章节**，不要遗漏任何大章
- 如果文档有10个一级章节，输出必须有10个
- 保持原文档的编号和标题
- 如果章节有页码，忽略页码只提取标题

## JSON返回格式（必须是完整有效的JSON）
{
  "chapters": [
    {"number": "引言", "title": "引言", "level": 1, "description": "章节描述", "children": []},
    {"number": "一", "title": "主要法律问题总结", "level": 1, "description": "概述", "children": [
      {"number": "(一)", "title": "子章节", "level": 2, "description": "描述"}
    ]}
  ]
}

**重要**：description字段请保持简短（10字以内），确保JSON完整不被截断。`;
        userPrompt = `请**完整提取**以下法律尽调报告的目录结构${filename ? `（文件名：${filename}）` : ""}：

---
${actualContent.substring(0, 20000)}
---

${actualContent.length > 20000 ? "\n[内容已截断，共" + actualContent.length + "字符]" : ""}

## 要求
1. 找出文档中**所有的一级章节**（如：引言、定义、一、二、三...十 等）
2. 每个一级章节下找出其子章节
3. 保持原文档的编号格式
4. 不要遗漏任何章节

请以JSON格式返回完整的章节结构。`;
      } else {
        systemPrompt = `你是一个专业的法律尽调报告专家，具有丰富的并购、投融资项目经验。

你需要根据提供的信息，生成一份专业、完整的法律尽职调查报告章节结构。

## 专业参考标准
法律尽调报告通常包含以下核心模块：
1. 公司基本情况（设立、沿革、股权结构、组织架构）
2. 公司治理（章程、三会运作、高管）
3. 重大资产（房产、土地、知识产权、设备）
4. 重大合同（投资协议、借款担保、业务合同）
5. 劳动人事（劳动合同、社保公积金、劳动争议）
6. 税务合规（税务登记、各税种、优惠政策）
7. 诉讼/仲裁/行政处罚
8. 合规经营（行业资质、环保、其他合规）

## 返回格式
{
  "chapters": [
    {
      "number": "1",
      "title": "章节标题",
      "level": 1,
      "description": "该章节需要核查的具体内容和要点",
      "children": [
        {
          "number": "1.1",
          "title": "子章节标题",
          "level": 2,
          "description": "子章节核查要点"
        }
      ]
    }
  ]
}

## 要求
- 生成8-10个一级章节
- 每个一级章节包含2-4个子章节
- description 必须具体说明该章节需要核查的内容要点
- 结构应专业、完整、符合行业标准`;
        const contextInfo = [];
        if (filename) contextInfo.push(`文件名: ${filename}`);
        if (projectType) contextInfo.push(`项目类型: ${projectType}`);
        userPrompt = `请生成一份专业的法律尽职调查报告章节结构。

${contextInfo.length > 0 ? `## 项目背景\n${contextInfo.join("\n")}\n\n` : ""}请以JSON格式返回完整的章节结构，确保覆盖所有法律尽调核心领域。`;
      }
    } else {
      systemPrompt = `你是一个专业的法律尽调文件分析专家。你的任务是分析尽调文件内容，提取关键信息摘要。

返回格式：
{
  "summary": {
    "title": "文件标题",
    "type": "文件类型（合同/公司治理/财务/知识产权/人事/诉讼/其他）",
    "keyPoints": ["关键点1", "关键点2", "关键点3"],
    "relevantChapters": ["相关章节"],
    "confidence": 85
  }
}`;
      userPrompt = `请分析以下尽调文件${filename ? `（文件名：${filename}）` : ""}：

${actualContent || `[仅有文件名: ${filename}]`}

请以JSON格式返回分析结果。`;
    }

    const fullUrl = gatewayUrl.endsWith("/")
      ? `${gatewayUrl}api/ai/execute`
      : `${gatewayUrl}/api/ai/execute`;

    console.log("[parse] Calling OOOK AI Gateway", {
      fullUrl,
      capability: "ai.general_user_defined",
    });

    const response = await fetch(fullUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
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
        constraints: { maxCost: 0.05 },
      }),
    });

    console.log("[parse] Response received", { status: response.status, ok: response.ok });

    if (!response.ok) {
      const errorText = await response.text();
      console.log("[parse] OOOK AI Gateway error", { status: response.status, error: errorText });
      
      if (response.status === 402) {
        return res.status(500).json({ error: "AI服务额度不足，请联系管理员充值或稍后重试" });
      } else if (response.status === 401) {
        return res.status(500).json({ error: "AI服务认证失败，请检查API密钥配置" });
      } else if (response.status === 429) {
        return res.status(500).json({ error: "AI服务请求过于频繁，请稍后重试" });
      } else if (response.status >= 500) {
        return res.status(500).json({ error: `AI服务暂时不可用(${response.status})，请稍后重试` });
      }
      return res.status(500).json({ error: `AI服务错误: ${response.status} - ${errorText.substring(0, 200)}` });
    }

    const aiResponse = await response.json();
    console.log("[parse] OOOK AI Gateway response received", {
      success: aiResponse.success,
      hasData: !!aiResponse.data,
    });

    // Handle OOOK Gateway response format: { success: true, data: { content: "..." } }
    const messageContent =
      aiResponse.data?.content ||
      aiResponse.result?.choices?.[0]?.message?.content ||
      aiResponse.choices?.[0]?.message?.content ||
      aiResponse.content;

    if (!messageContent) {
      console.log("[parse] No content found in response", { responseKeys: Object.keys(aiResponse) });
      return res.status(500).json({ error: "AI响应中没有内容" });
    }

    // Extract JSON from response
    let jsonStr = messageContent.trim();
    let jsonMatch = jsonStr.match(/```json\s*([\s\S]*?)```/);
    if (jsonMatch && jsonMatch[1]) {
      jsonStr = jsonMatch[1].trim();
    } else {
      jsonMatch = jsonStr.match(/```\s*([\s\S]*?)```/);
      if (jsonMatch && jsonMatch[1]) {
        jsonStr = jsonMatch[1].trim();
      } else {
        const jsonStartIndex = jsonStr.indexOf("{");
        const jsonEndIndex = jsonStr.lastIndexOf("}");
        if (jsonStartIndex !== -1 && jsonEndIndex !== -1 && jsonEndIndex > jsonStartIndex) {
          jsonStr = jsonStr.substring(jsonStartIndex, jsonEndIndex + 1);
        }
      }
    }

    console.log("[parse] Extracted JSON", { length: jsonStr.length });

    let parsedResult;
    try {
      parsedResult = JSON.parse(jsonStr);
    } catch (parseError) {
      console.log("[parse] JSON parse failed, attempting repair");
      // Try to repair truncated JSON
      let repairedJson = jsonStr.replace(/,\s*([\]\}])/g, "$1");
      const openBraces = (repairedJson.match(/\{/g) || []).length;
      const closeBraces = (repairedJson.match(/\}/g) || []).length;
      const openBrackets = (repairedJson.match(/\[/g) || []).length;
      const closeBrackets = (repairedJson.match(/\]/g) || []).length;

      for (let i = 0; i < openBrackets - closeBrackets; i++) {
        repairedJson += "]";
      }
      for (let i = 0; i < openBraces - closeBraces; i++) {
        repairedJson += "}";
      }

      try {
        parsedResult = JSON.parse(repairedJson);
        console.log("[parse] JSON repaired successfully");
      } catch {
        return res.status(500).json({ error: "AI响应格式解析失败" });
      }
    }

    console.log("[parse] Parsing complete", { chaptersCount: parsedResult.chapters?.length });
    return res.status(200).json(parsedResult);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log("[parse] ERROR", { message: errorMessage });
    return res.status(500).json({ error: errorMessage });
  }
}
