# WechatSync MCP Server

MCP Server for WechatSync - 连接 Claude Code 和 Chrome Extension。

## 架构

```
┌─────────────┐      stdio       ┌─────────────────┐     WebSocket     ┌─────────────┐
│ Claude Code │ <──────────────> │ MCP Server      │ <───────────────> │  Extension  │
│             │                  │ (Node.js)       │                   │ (Background)│
└─────────────┘                  └─────────────────┘                   └─────────────┘
```

## 安装

```bash
# 在项目根目录
yarn install
yarn build:mcp
```

## 配置 Claude Code

在 `~/.claude.json` 中添加：

```json
{
  "mcpServers": {
    "wechatsync": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/Wechatsync/packages/mcp-server/dist/index.js"],
      "env": {
        "MCP_TOKEN": "your-secret-token-here"
      }
    }
  }
}
```

**重要**: `MCP_TOKEN` 必须与 Chrome 扩展中设置的 token 一致，否则请求会被拒绝。

或者在项目的 `.mcp.json` 中配置。

## 可用 Tools

### list_platforms

列出所有支持的平台及其登录状态。

```
参数:
- forceRefresh: boolean (可选) - 是否强制刷新登录状态
```

### check_auth

检查指定平台的登录状态。

```
参数:
- platform: string (必需) - 平台 ID，如 zhihu, juejin, toutiao
```

### sync_article

同步文章到指定平台（保存为草稿）。

```
参数:
- platforms: string[] (必需) - 目标平台 ID 列表
- title: string (必需) - 文章标题（纯文本，不含 # 号）
- markdown: string (必需) - 文章正文内容（Markdown 格式，推荐）
- content: string (可选) - 文章内容（HTML 格式，如提供 markdown 则可忽略）
- cover: string (可选) - 封面图 URL 或 base64 data URI
```

### extract_article

从当前浏览器页面提取文章内容。

## 环境变量

- `MCP_TOKEN`: 安全验证 token（必需，需与 Chrome 扩展中设置的 token 一致）
- `SYNC_WS_PORT`: WebSocket 端口（默认 9527）
- `SYNC_HTTP_PORT`: HTTP 端口（默认 9528，仅 SSE 模式）

## 开发

```bash
# 监听模式
yarn workspace @wechatsync/mcp-server dev

# 构建
yarn build:mcp

# 运行
yarn mcp
```
