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

  // 详细日志：请求参数
  console.log(`[AI-Gateway] === REQUEST ===`);
  console.log(`[AI-Gateway] URL: ${gatewayUrl}/api/ai/execute`);
  console.log(`[AI-Gateway] Capability: ${requestBody.capability}`);
  console.log(`[AI-Gateway] System Prompt Length: ${systemPrompt.length} chars`);
  console.log(`[AI-Gateway] User Prompt Length: ${userPrompt.length} chars`);
  console.log(`[AI-Gateway] Total Input: ${systemPrompt.length + userPrompt.length} chars`);
  console.log(`[AI-Gateway] Timeout: ${timeoutMs}ms`);
  console.log(`[AI-Gateway] User Prompt Preview (first 500 chars): ${userPrompt.slice(0, 500)}...`);

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

    // 详细日志：响应状态
    console.log(`[AI-Gateway] === RESPONSE ===`);
    console.log(`[AI-Gateway] Status: ${response.status} ${response.statusText}`);
    console.log(`[AI-Gateway] Elapsed: ${elapsed}ms`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[AI-Gateway] Error Body: ${errorText.slice(0, 1000)}`);
      throw new Error(`AI服务错误: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    
    // 详细日志：响应内容
    const content = result.result?.choices?.[0]?.message?.content
      || result.choices?.[0]?.message?.content
      || result.result?.content
      || result.content
      || "";
    
    console.log(`[AI-Gateway] Response Content Length: ${content.length} chars`);
    console.log(`[AI-Gateway] Response Preview (first 300 chars): ${content.slice(0, 300)}...`);
    console.log(`[AI-Gateway] Model Used: ${result.result?.model || result.model || "unknown"}`);
    console.log(`[AI-Gateway] Usage: ${JSON.stringify(result.result?.usage || result.usage || {})}`);

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
