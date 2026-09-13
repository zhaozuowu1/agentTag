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

各 app 的 `dev` 脚本用 Node 22 的 `--env-file=../../.env` 加载仓库根目录 `.env`（管理台、网关、Worker 都如此）。请先复制 `.env.example` 再启动。

管理台默认端口 3001：`pnpm --filter @agenttag/admin-web dev`，用 `ADMIN_TOKEN` Bearer 登录。网关默认 3000：`pnpm --filter @agenttag/feishu-gateway dev`。

开发环境（`pnpm --filter @agenttag/feishu-gateway dev` 会设 `NODE_ENV=development`）默认用飞书 Node SDK **长连接**收事件（`im.message.receive_v1`、进群/出群），与开放平台「使用长连接接收事件」对齐，可不配 `FEISHU_ENCRYPT_KEY`。此时 HTTP `POST /feishu/events` 不再收明文事件。生产请设 `NODE_ENV=production`，仍走加密 webhook，并配置 Encrypt Key。可用 `FEISHU_EVENT_MODE=websocket|http` 覆盖默认。

国内网络请同时配置 `ANTHROPIC_BASE_URL` 与 npm registry。
