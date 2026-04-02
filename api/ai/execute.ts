import type { VercelRequest, VercelResponse } from "@vercel/node";

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
    const { capability, input, constraints } = req.body;
    const apiKey = process.env.OOOK_AI_GATEWAY_TOKEN;
    const gatewayUrl = process.env.OOOK_AI_GATEWAY_URL || "https://gateway.oook.cn/";

    if (!apiKey) {
      return res.status(500).json({ 
        error: "OOOK_AI_GATEWAY_TOKEN 未配置" 
      });
    }

    const fullUrl = gatewayUrl.endsWith("/")
      ? `${gatewayUrl}api/ai/execute`
      : `${gatewayUrl}/api/ai/execute`;

    const response = await fetch(fullUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        capability: capability || "ai.general_user_defined",
        input: input || {},
        constraints: constraints || { maxCost: 0.05 },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: errorMessage });
  }
}
