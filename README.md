# agentTag

飞书版 Claude Tag：把 Claude 做成飞书群里的异步队友。管理员把企业自建应用机器人拉进指定群，成员 `@` 委派任务后可以去做别的；Agent 记住群相关约定，并只使用团队选择的工具与数据。

这不是 Slack 应用，也不对接官方 Claude Tag（仅 Slack、且需 Team / Enterprise）。聊天表面只做飞书（中国区 `open.feishu.cn`）。群内工作走组织持有的 Anthropic API Key。

## 本地开发

需要 Node.js 22 与 pnpm。Postgres 16 与 Redis 7 由 Compose 提供：

```bash
pnpm install
cp .env.example .env
docker compose up -d
pnpm db:migrate
pnpm test
pnpm dev
```

管理台默认端口 3001：`pnpm --filter @agenttag/admin-web dev`，用 `ADMIN_TOKEN` Bearer 登录。网关默认 3000：`pnpm --filter @agenttag/feishu-gateway dev`。

国内网络请同时配置 `ANTHROPIC_BASE_URL` 与 npm registry。
