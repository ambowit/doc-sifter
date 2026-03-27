export async function callAIGateway(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  timeoutMs = 120000,
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const gatewayUrl = (Deno.env.get("OOOK_AI_GATEWAY_URL") || "https://gateway.oook.cn").replace(/\/$/, "");
    const response = await fetch(`${gatewayUrl}/api/ai/execute`, {
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
          temperature: 0.2,
          max_tokens: 8000,
        },
        constraints: { maxCost: 0.05 },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI服务错误: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    return result.result?.choices?.[0]?.message?.content
      || result.choices?.[0]?.message?.content
      || result.result?.content
      || result.content
      || "";
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("AI_TIMEOUT");
    }
    throw error;
  }
}
