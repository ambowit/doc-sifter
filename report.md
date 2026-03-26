# 项目问题与风险清单（doc-sifter）

生成时间：2026-03-24
范围：仅基于当前仓库代码静态分析（未运行服务、未连接实际环境）。

## 摘要
- 发现多处与生产安全和可用性相关的高风险点（测试账号硬编码、公开 AI 解析接口缺少身份校验）。
- 多处中文文本出现乱码，可能直接影响 UI/报告输出质量。
- AI 生成链路对大文件和高并发存在稳定性风险（超时与内容截断），虽有回退但体验可能不稳定。

## 风险清单

1. 高：生产环境暴露测试账号与初始化入口
证据：`D:\project\github\doc-sifter\src\pages\desktop\Login.tsx`
- `isProduction = false` 且“测试账号”在界面中始终可见。
- 账号邮箱与密码硬编码在前端，并支持调用 `init-test-users` Edge Function 初始化账号。
影响：若部署到生产环境，可能被任何访问者直接登录或初始化测试账号，造成权限滥用和数据泄露。
建议：
- 将 `isProduction` 切回环境判断并移除测试账号展示。
- 生产环境禁止调用 `init-test-users`（或在函数端加严格鉴权）。

2. 高：公开 AI 解析接口缺少身份鉴别与限流
证据：`D:\project\github\doc-sifter\api\parse.ts`
- 仅依赖环境变量中的 `OOOK_AI_GATEWAY_TOKEN` 访问 AI 网关。
- CORS 允许任意来源，且无用户身份校验或速率限制。
影响：若该 Vercel Function 对公网开放，可能被滥用导致成本失控或被用作公开代理。
建议：
- 增加鉴权（例如 JWT、API key、Supabase session）和速率限制。
- 若已迁移到 Supabase Edge Functions，考虑下线此入口。

3. 中：中文文本出现乱码，影响 UI 与报告质量
证据：
- `D:\project\github\doc-sifter\src\hooks\useReportGeneration.ts`
- `D:\project\github\doc-sifter\api\parse.ts`
- `D:\project\github\doc-sifter\supabase\functions\generate-report\index.ts`
现象：多处中文字符串呈现“乱码/错码”。
影响：UI、导出报告和 AI 提示词可能出现不可读内容，影响用户体验与生成质量。
建议：
- 全仓统一 UTF-8 编码保存。
- 检查编辑器与 Git 配置（含 `core.autocrlf`、文件编码）。

4. 中：AI 报告生成对超时与内容规模敏感
证据：`D:\project\github\doc-sifter\supabase\functions\generate-report\index.ts`
- AI 调用有超时处理与截断策略，但大文件仍可能触发超时回退。
影响：高并发或大体量项目可能出现生成失败、内容缺失或反复重试。
建议：
- 进一步拆分批次或引入异步队列（已有 report jobs，可继续加强）。
- 前端增加可见的“分批/重试”提示与部分结果合并策略。

5. 中：报告生成使用“全文件输入”可能造成相关性噪音
证据：`D:\project\github\doc-sifter\supabase\functions\generate-report\index.ts`
- 明确“ALL files”策略，将所有文件内容摘要输入 AI。
影响：章节内容可能混入无关文件，降低报告准确度。
建议：
- 优先使用映射文件作为输入，或按章节动态筛选文件集。

6. 低：CORS 全开放与错误信息外露
证据：`D:\project\github\doc-sifter\api\parse.ts`、部分 Edge Functions
影响：对攻击者更友好，易被探测滥用。
建议：
- 限制允许来源或仅对可信域名开放。
- 统一错误返回格式，减少敏感细节泄露。

## 备注
- 本报告仅做静态分析，未运行服务或调用真实环境。
- 如需更深入的“表结构/接口”层面风险评估，请提供 Supabase 实际配置与部署信息。
