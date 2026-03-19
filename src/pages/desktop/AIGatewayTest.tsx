import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, Play, CheckCircle2, XCircle } from "lucide-react";

export default function AIGatewayTest() {
  const [gatewayUrl, setGatewayUrl] = useState("https://gateway.oook.cn/");
  const [token, setToken] = useState("");
  const [capability, setCapability] = useState("ai.general_user_defined");
  const [testPrompt, setTestPrompt] = useState("请用一句话介绍法律尽调报告的作用。");
  const [result, setResult] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [requestInfo, setRequestInfo] = useState<string>("");

  const testAIGateway = async () => {
    if (!token) {
      setResult("错误: 请输入 OOOK_AI_GATEWAY_TOKEN");
      setStatus("error");
      return;
    }

    setLoading(true);
    setStatus("idle");
    setResult("");
    setRequestInfo("");

    const fullUrl = gatewayUrl.endsWith('/') 
      ? `${gatewayUrl}api/ai/execute` 
      : `${gatewayUrl}/api/ai/execute`;

    const requestBody = {
      capability: capability,
      input: {
        messages: [
          { role: "system", content: "你是一个专业的法律顾问助手。" },
          { role: "user", content: testPrompt },
        ],
      },
      constraints: { maxCost: 0.05 },
    };

    setRequestInfo(`
请求信息:
---------
URL: ${fullUrl}
Method: POST
Headers:
  - Authorization: Bearer ${token.substring(0, 8)}...
  - Content-Type: application/json

Body:
${JSON.stringify(requestBody, null, 2)}
    `.trim());

    try {
      const startTime = Date.now();
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(fullUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const elapsed = Date.now() - startTime;

      const responseText = await response.text();
      
      let resultText = `
响应信息:
---------
状态码: ${response.status} ${response.statusText}
耗时: ${elapsed}ms
响应头:
${Array.from(response.headers.entries()).map(([k, v]) => `  ${k}: ${v}`).join('\n')}

响应体:
${responseText}
      `.trim();

      if (response.ok) {
        try {
          const json = JSON.parse(responseText);
          const content = json.result?.choices?.[0]?.message?.content || 
                         json.choices?.[0]?.message?.content ||
                         json.result?.content ||
                         json.content;
          if (content) {
            resultText += `\n\n提取的内容:\n---------\n${content}`;
          }
          setStatus("success");
        } catch {
          setStatus("success");
        }
      } else {
        setStatus("error");
        
        // 提供错误诊断
        let diagnosis = "\n\n诊断建议:\n---------\n";
        if (response.status === 401) {
          diagnosis += "- Token 无效或已过期，请检查 OOOK_AI_GATEWAY_TOKEN 是否正确";
        } else if (response.status === 402) {
          diagnosis += "- 账户余额不足，请联系管理员充值";
        } else if (response.status === 403) {
          diagnosis += "- 没有访问权限，请检查 Token 的权限配置";
        } else if (response.status === 404) {
          diagnosis += "- API 端点不存在，请检查 Gateway URL 是否正确";
        } else if (response.status === 429) {
          diagnosis += "- 请求频率过高，请稍后重试";
        } else if (response.status >= 500) {
          diagnosis += "- 服务器内部错误，请稍后重试或联系管理员";
        }
        resultText += diagnosis;
      }

      setResult(resultText);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      setStatus("error");
      
      let diagnosis = "";
      if (errMsg.includes("abort") || errMsg.includes("timeout")) {
        diagnosis = "请求超时（30秒），可能是网络问题或服务器响应慢";
      } else if (errMsg.includes("NetworkError") || errMsg.includes("Failed to fetch")) {
        diagnosis = "网络错误，可能是 CORS 问题或无法连接到服务器";
      } else {
        diagnosis = `未知错误: ${errMsg}`;
      }

      setResult(`
错误:
---------
${errMsg}

诊断:
---------
${diagnosis}

建议:
- 检查网络连接
- 确认 Gateway URL 是否正确
- 确认 Token 是否有效
- 如果是 CORS 错误，需要在 Edge Function 中调用（浏览器直接调用可能受限）
      `.trim());
    } finally {
      setLoading(false);
    }
  };

  const testEdgeFunction = async () => {
    setLoading(true);
    setStatus("idle");
    setResult("");
    setRequestInfo("");

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "https://osxehjupsoqqmunxdrgj.supabase.co";
    const edgeFunctionUrl = `${supabaseUrl}/functions/v1/parse`;

    const requestBody = {
      type: "generate-structure",
      projectType: "法律尽调",
    };

    setRequestInfo(`
请求信息 (通过 Edge Function):
---------
URL: ${edgeFunctionUrl}
Method: POST
Body:
${JSON.stringify(requestBody, null, 2)}
    `.trim());

    try {
      const startTime = Date.now();

      const response = await fetch(edgeFunctionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      const elapsed = Date.now() - startTime;
      const responseText = await response.text();

      let resultText = `
响应信息:
---------
状态码: ${response.status} ${response.statusText}
耗时: ${elapsed}ms

响应体:
${responseText}
      `.trim();

      if (response.ok) {
        try {
          const json = JSON.parse(responseText);
          if (json.chapters) {
            resultText += `\n\n成功! 生成了 ${json.chapters.length} 个章节`;
          }
          setStatus("success");
        } catch {
          setStatus("success");
        }
      } else {
        setStatus("error");
      }

      setResult(resultText);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      setStatus("error");
      setResult(`错误: ${errMsg}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">OOOK AI Gateway 测试工具</h1>
          <p className="text-muted-foreground mt-1">
            用于测试 AI Gateway 连接和诊断问题
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>配置</CardTitle>
            <CardDescription>输入 Gateway URL 和 Token 进行测试</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="gatewayUrl">Gateway URL</Label>
                <Input
                  id="gatewayUrl"
                  value={gatewayUrl}
                  onChange={(e) => setGatewayUrl(e.target.value)}
                  placeholder="https://gateway.oook.cn/"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="capability">Capability</Label>
                <Input
                  id="capability"
                  value={capability}
                  onChange={(e) => setCapability(e.target.value)}
                  placeholder="ai.general_user_defined"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="token">OOOK_AI_GATEWAY_TOKEN</Label>
              <Input
                id="token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="输入你的 Token"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="prompt">测试 Prompt</Label>
              <Textarea
                id="prompt"
                value={testPrompt}
                onChange={(e) => setTestPrompt(e.target.value)}
                placeholder="输入测试内容"
                rows={3}
              />
            </div>

            <div className="flex gap-2">
              <Button onClick={testAIGateway} disabled={loading}>
                {loading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 mr-2" />
                )}
                直接测试 AI Gateway
              </Button>
              <Button onClick={testEdgeFunction} disabled={loading} variant="outline">
                {loading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 mr-2" />
                )}
                测试 Edge Function (parse)
              </Button>
            </div>
          </CardContent>
        </Card>

        {requestInfo && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">请求详情</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-xs bg-muted p-4 rounded-lg overflow-auto max-h-64 whitespace-pre-wrap">
                {requestInfo}
              </pre>
            </CardContent>
          </Card>
        )}

        {result && (
          <Card className={status === "error" ? "border-destructive" : status === "success" ? "border-green-500" : ""}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                {status === "success" && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                {status === "error" && <XCircle className="w-4 h-4 text-destructive" />}
                响应结果
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-xs bg-muted p-4 rounded-lg overflow-auto max-h-96 whitespace-pre-wrap">
                {result}
              </pre>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
