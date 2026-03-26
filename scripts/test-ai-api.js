/**
 * Test script for api/ai/execute
 * This script demonstrates how to call the AI execution endpoint with real prompts
 * calculated based on the logic in api/parse.ts
 */

const API_URL = "http://localhost:3000/api/ai/execute"; // Update this to your local or deployed URL
const API_KEY = process.env.OOOK_AI_GATEWAY_TOKEN; // Ensure this is set in your environment

async function testAiExecute() {
  console.log("Starting AI execute test...");

  // Example 1: Template extraction (from api/parse.ts)
  const filename = "example_due_diligence.txt";
  const content = "一、引言\n二、公司基本情况\n三、重大资产\n四、重大合同\n..."; // Simplified content
  const projectType = "并购尽调";

  // Prompt calculation logic extracted from api/parse.ts
  const systemPrompt = `你是一个专业的法律尽调报告分析专家。你的任务是从用户上传的尽调报告中**完整提取目录结构**。

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

  const userPrompt = `请**完整提取**以下法律尽调报告的目录结构（文件名：${filename}）：

---
${content.substring(0, 20000)}
---

请以JSON格式返回完整的章节结构。`;

  console.log("Calculated Prompts:");
  console.log("- System:", systemPrompt.substring(0, 50) + "...");
  console.log("- User:", userPrompt.substring(0, 50) + "...");

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Authorization: `Bearer ${API_KEY}` // Only needed if you added auth to your proxy
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

    console.log("Response Status:", response.status);
    const result = await response.json();
    console.log("Result:", JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("Error calling AI execute:", error);
  }
}

testAiExecute();
