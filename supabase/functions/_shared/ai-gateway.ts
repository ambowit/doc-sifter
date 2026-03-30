export async function callAIGateway(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  timeoutMs = 120000,
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const startTime = Date.now();

  // 构建请求体
  const gatewayUrl = (Deno.env.get("OOOK_AI_GATEWAY_URL") || "https://gateway.oook.cn").replace(/\/$/, "");
  const requestBody = {
    capability: "ai.general_user_defined",
    input: {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: 8000,
    },
    constraints: { maxCost: 0.05 },
  };

  // 完整打印请求参数，方便外部测试
  console.log(`[AI-Gateway] === FULL REQUEST ===`);
  console.log(`[AI-Gateway] URL: ${gatewayUrl}/api/ai/execute`);
  console.log(`[AI-Gateway] Method: POST`);
  console.log(`[AI-Gateway] Headers: ${JSON.stringify({ "Authorization": "Bearer ***", "Content-Type": "application/json" })}`);
  console.log(`[AI-Gateway] Body: ${JSON.stringify(requestBody)}`);

  try {
    const response = await fetch(`${gatewayUrl}/api/ai/execute`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const elapsed = Date.now() - startTime;

    // 响应状态
    console.log(`[AI-Gateway] === RESPONSE === Status: ${response.status} | Elapsed: ${elapsed}ms`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[AI-Gateway] Error Body: ${errorText.slice(0, 1000)}`);
      throw new Error(`AI服务错误: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    
    // 打印完整 AI 返回值，方便调试
    console.log(`[AI-Gateway] === RAW RESPONSE ===`);
    console.log(`[AI-Gateway] ${JSON.stringify(result)}`);
    
    // 兼容多种返回格式：data.content (OOOK Gateway) / result.choices / choices
    const content = result.data?.content
      || result.result?.choices?.[0]?.message?.content
      || result.choices?.[0]?.message?.content
      || result.result?.content
      || result.content
      || "";
    
    const model = result.data?.model || result.meta?.model || result.result?.model || result.model || "unknown";
    console.log(`[AI-Gateway] Content Length: ${content.length} | Model: ${model}`);

    return content;
  } catch (error) {
    clearTimeout(timeoutId);
    const elapsed = Date.now() - startTime;
    
    console.error(`[AI-Gateway] === ERROR ===`);
    console.error(`[AI-Gateway] Elapsed before error: ${elapsed}ms`);
    console.error(`[AI-Gateway] Error Type: ${error instanceof Error ? error.name : typeof error}`);
    console.error(`[AI-Gateway] Error Message: ${error instanceof Error ? error.message : String(error)}`);
    
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("AI_TIMEOUT");
    }
    throw error;
  }
}
