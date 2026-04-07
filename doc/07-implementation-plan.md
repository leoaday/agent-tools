# 实施计划

## 阶段划分

### Phase 1：核心骨架（MVP）

**目标：** 跑通 Claude Code 单Agent的完整数据链路

| 任务 | 说明 |
|------|------|
| 客户端CLI骨架 | `agent-tools setup / stats / sync` 命令框架 |
| Claude Code检测器 | 检测安装、读写settings.json |
| Claude Code Hook适配器 | SessionStart/End + PostToolUse事件采集 |
| 事件标准化 | NormalizedEvent格式定义与转换 |
| 本地SQLite存储 | 写入、查询、标记已同步 |
| 服务端骨架 | Fastify + MySQL + events表 |
| 数据上报API | POST /api/v1/events/batch |
| 基础统计API | GET /api/v1/stats/summary (按日) |

### Phase 2：多Agent支持

**目标：** 覆盖主流Agent的hook注入

| 任务 | 说明 |
|------|------|
| CodeBuddy适配器 | 配置格式与Claude Code高度相似 |
| Copilot CLI适配器 | .github/hooks/hooks.json格式 |
| OpenCode适配器 | JS插件方式 |
| Cursor适配器 | .cursor/hooks.json格式 |
| Continue适配器 | YAML config修改 |
| Amazon Q适配器 | .amazonq/配置 |
| Aider包装器 | 命令包装 + 历史文件解析 |
| postinstall脚本 | 自动检测提示 |

### Phase 3：完整统计与排名

**目标：** 实现所有统计维度和排名功能

| 任务 | 说明 |
|------|------|
| 时间维度查询 | 日/周/月/自定义/全部 |
| 模型过滤 | 按模型或不区分模型 |
| 排名API | 多指标排名 |
| 下钻API | 用户→机器→Agent→模型→会话 |
| 每日聚合任务 | daily_stats + tool_usage_detail |
| 会话汇总任务 | sessions表聚合 |
| 数据清理任务 | 过期数据删除 |

### Phase 4：可视化Dashboard

**目标：** Web仪表板和图表

| 任务 | 说明 |
|------|------|
| Dashboard前端 | Vue3/React SPA |
| 概览页 | KPI + 趋势 + 分布 |
| 排名页 | 交互式排名 + 下钻 |
| 图表SSR | node-canvas渲染PNG/SVG |
| 图表API | 供CLI和邮件使用 |

### Phase 5：MCP Server与增强

**目标：** MCP交互查询 + 生产加固

| 任务 | 说明 |
|------|------|
| MCP Server | 暴露stats查询工具 |
| MCP自动配置 | setup时写入各Agent的MCP配置 |
| Windows兼容性测试 | PowerShell hook脚本 |
| 性能优化 | 批量写入、查询缓存 |
| 监控告警 | 服务健康检查 |

## 技术依赖

### 客户端 (agent-tools)

```json
{
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "commander": "^12.0.0",
    "chalk": "^5.0.0",
    "uuid": "^10.0.0"
  }
}
```

### 服务端 (agent-tools-server)

```json
{
  "dependencies": {
    "fastify": "^5.0.0",
    "@fastify/static": "^8.0.0",
    "@fastify/cors": "^10.0.0",
    "knex": "^3.0.0",
    "mysql2": "^3.0.0",
    "echarts": "^5.0.0",
    "canvas": "^3.0.0",
    "node-cron": "^3.0.0",
    "pino": "^9.0.0"
  }
}
```

### MCP Server

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.0.0"
  }
}
```
