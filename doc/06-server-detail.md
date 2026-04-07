# 服务端详细设计

## 1. 技术栈

| 组件 | 选型 | 说明 |
|------|------|------|
| 运行时 | Node.js 18+ | 与客户端统一技术栈 |
| Web框架 | Fastify | 高性能，原生JSON schema校验 |
| 数据库 | MySQL 8.0 | 按需求指定 |
| ORM | Knex.js | 轻量query builder，支持迁移 |
| 图表 | ECharts + node-canvas (SSR) | 服务端渲染为PNG/SVG |
| 前端 | 静态SPA (Vue3 + ECharts) | 嵌入到Fastify静态资源 |
| 定时任务 | node-cron | 每日聚合、数据清理 |
| 日志 | pino (Fastify内置) | 结构化JSON日志 |

## 2. 服务端包结构

```
agent-tools-server/
├── package.json
├── knexfile.js                    # 数据库配置
├── migrations/                    # 数据库迁移
│   ├── 001_create_events.js
│   ├── 002_create_sessions.js
│   ├── 003_create_daily_stats.js
│   └── 004_create_tool_usage.js
├── src/
│   ├── index.js                   # 入口
│   ├── config.js                  # 服务配置
│   ├── app.js                     # Fastify app初始化
│   ├── routes/
│   │   ├── events.js              # POST /api/v1/events/batch
│   │   ├── stats.js               # GET /api/v1/stats/*
│   │   └── charts.js              # GET /api/v1/charts/*
│   ├── services/
│   │   ├── event-service.js       # 事件写入与去重
│   │   ├── stats-service.js       # 统计查询
│   │   ├── aggregation-service.js # 数据聚合
│   │   └── chart-service.js       # 图表生成
│   ├── jobs/
│   │   ├── daily-aggregation.js   # 每日聚合任务
│   │   ├── session-summarize.js   # 会话汇总任务
│   │   └── data-cleanup.js        # 过期数据清理
│   ├── middleware/
│   │   └── auth.js                # API Key认证
│   └── dashboard/                 # 前端静态文件
│       ├── index.html
│       ├── app.js
│       └── style.css
└── .env.example
```

## 3. API详细设计

### 3.1 数据上报

```
POST /api/v1/events/batch
Authorization: Bearer <api-key>
Content-Type: application/json

Request:
{
  "events": [
    {
      "event_id": "uuid-v4",
      "agent": "claude-code",
      "agent_version": "1.5.0",
      "username": "leon",
      "hostname": "leon-mbp",
      "platform": "darwin",
      "session_id": "sess-xxx",
      "conversation_turn": 5,
      "event_type": "tool_use",
      "event_time": "2026-04-07T10:30:00.123Z",
      "model": "claude-opus-4",
      "token_input": 1500,
      "token_output": 800,
      "tool_name": "Read",
      "files_modified": 0,
      "lines_added": 0,
      "lines_removed": 0
    }
  ]
}

Response 200:
{
  "accepted": 50,
  "duplicates": 2,
  "errors": 0
}

Response 400: { "error": "validation_error", "details": [...] }
Response 401: { "error": "unauthorized" }
```

### 3.2 汇总统计

```
GET /api/v1/stats/summary?period=week&date=2026-04-07&model=claude-opus-4

Response 200:
{
  "period": { "type": "week", "start": "2026-03-31", "end": "2026-04-06" },
  "filters": { "model": "claude-opus-4" },
  "summary": {
    "total_users": 15,
    "total_sessions": 234,
    "total_turns": 4567,
    "token_input": 12500000,
    "token_output": 3400000,
    "token_total": 15900000,
    "files_created": 89,
    "files_modified": 456,
    "lines_added": 12340,
    "lines_removed": 5670,
    "tool_use_count": 3456,
    "tool_distinct_count": 18,
    "skill_use_count": 234,
    "skill_distinct_count": 12
  }
}
```

### 3.3 排名查询

```
GET /api/v1/stats/ranking?period=week&date=2026-04-07&metric=token_total&limit=10

Response 200:
{
  "period": { ... },
  "metric": "token_total",
  "rankings": [
    {
      "rank": 1,
      "username": "leon",
      "token_total": 1250000,
      "token_input": 980000,
      "token_output": 270000,
      "session_count": 45,
      "conversation_turns": 320
    },
    ...
  ]
}
```

### 3.4 下钻查询

```
GET /api/v1/stats/drilldown?period=week&date=2026-04-07&username=leon&drilldown=hostname

Response 200:
{
  "period": { ... },
  "drilldown_by": "hostname",
  "parent": { "username": "leon" },
  "items": [
    {
      "hostname": "leon-mbp",
      "token_total": 800000,
      "session_count": 30,
      "agent_breakdown": {
        "claude-code": { "token_total": 600000, "session_count": 22 },
        "copilot-cli": { "token_total": 200000, "session_count": 8 }
      }
    },
    {
      "hostname": "leon-linux",
      "token_total": 450000,
      "session_count": 15
    }
  ]
}
```

### 3.5 趋势数据

```
GET /api/v1/stats/trend?period=month&date=2026-04&metric=token_total&granularity=day

Response 200:
{
  "period": { ... },
  "metric": "token_total",
  "granularity": "day",
  "data": [
    { "date": "2026-04-01", "value": 450000 },
    { "date": "2026-04-02", "value": 520000 },
    ...
  ]
}
```

### 3.6 图表API

```
GET /api/v1/charts/token-trend?period=month&date=2026-04&format=png
GET /api/v1/charts/user-ranking?period=week&metric=token_total&format=svg
GET /api/v1/charts/agent-distribution?period=month&format=png
GET /api/v1/charts/tool-ranking?period=week&limit=20&format=png
```

## 4. 聚合任务

### 4.1 每日聚合（每天凌晨2:00）

```javascript
// jobs/daily-aggregation.js
async function aggregateDaily(date) {
  const db = getDb();
  
  // 1. 按 (username, hostname, agent, model) 维度聚合
  await db.raw(`
    INSERT INTO daily_stats 
      (stat_date, username, hostname, agent, model,
       session_count, conversation_turns,
       token_input, token_output, token_total,
       tool_use_count, tool_distinct_count,
       skill_use_count, skill_distinct_count,
       files_created, files_modified, lines_added, lines_removed)
    SELECT 
      DATE(event_time) as stat_date,
      username, hostname, agent, COALESCE(model, '__unknown__'),
      COUNT(DISTINCT session_id),
      MAX(conversation_turn),
      SUM(token_input), SUM(token_output), SUM(token_input + token_output),
      SUM(CASE WHEN tool_name IS NOT NULL THEN 1 ELSE 0 END),
      COUNT(DISTINCT tool_name),
      SUM(CASE WHEN skill_name IS NOT NULL THEN 1 ELSE 0 END),
      COUNT(DISTINCT skill_name),
      SUM(files_created), SUM(files_modified),
      SUM(lines_added), SUM(lines_removed)
    FROM events
    WHERE DATE(event_time) = ?
    GROUP BY DATE(event_time), username, hostname, agent, COALESCE(model, '__unknown__')
    ON DUPLICATE KEY UPDATE
      session_count = VALUES(session_count),
      conversation_turns = VALUES(conversation_turns),
      token_input = VALUES(token_input),
      token_output = VALUES(token_output),
      token_total = VALUES(token_total),
      tool_use_count = VALUES(tool_use_count),
      tool_distinct_count = VALUES(tool_distinct_count),
      skill_use_count = VALUES(skill_use_count),
      skill_distinct_count = VALUES(skill_distinct_count),
      files_created = VALUES(files_created),
      files_modified = VALUES(files_modified),
      lines_added = VALUES(lines_added),
      lines_removed = VALUES(lines_removed)
  `, [date]);
  
  // 2. 生成不区分模型的汇总行 (model = '__all__')
  await db.raw(`
    INSERT INTO daily_stats 
      (stat_date, username, hostname, agent, model,
       session_count, conversation_turns,
       token_input, token_output, token_total,
       tool_use_count, tool_distinct_count,
       skill_use_count, skill_distinct_count,
       files_created, files_modified, lines_added, lines_removed)
    SELECT 
      stat_date, username, hostname, agent, '__all__',
      SUM(session_count), SUM(conversation_turns),
      SUM(token_input), SUM(token_output), SUM(token_total),
      SUM(tool_use_count), MAX(tool_distinct_count),
      SUM(skill_use_count), MAX(skill_distinct_count),
      SUM(files_created), SUM(files_modified),
      SUM(lines_added), SUM(lines_removed)
    FROM daily_stats
    WHERE stat_date = ? AND model != '__all__'
    GROUP BY stat_date, username, hostname, agent
    ON DUPLICATE KEY UPDATE
      session_count = VALUES(session_count),
      token_total = VALUES(token_total)
      /* ... 其他字段同理 */
  `, [date]);
}
```

### 4.2 会话汇总（每小时）

```javascript
async function summarizeSessions() {
  // 找出有session_end但尚未汇总的会话
  // 或者超过2小时无新事件的会话（视为结束）
  // 聚合events表写入sessions表
}
```

### 4.3 数据清理（每天凌晨3:00）

```javascript
async function cleanup() {
  const db = getDb();
  const retentionDays = config.get('retention.events', 90);
  
  await db('events')
    .where('event_time', '<', db.raw(`DATE_SUB(NOW(), INTERVAL ${retentionDays} DAY)`))
    .del();
  
  await db('tool_usage_detail')
    .where('stat_date', '<', db.raw(`DATE_SUB(CURDATE(), INTERVAL ${retentionDays} DAY)`))
    .del();
}
```

## 5. Dashboard设计

### 5.1 页面结构

```
Dashboard (SPA)
├── 概览页
│   ├── 时间段选择器 (日/周/月/自定义/全部)
│   ├── 模型过滤器 (下拉多选)
│   ├── KPI卡片 (用户数/会话数/Token总量/文件变更)
│   ├── Token消耗趋势图
│   └── Agent分布饼图
├── 排名页
│   ├── 排名指标选择器
│   ├── 用户排名柱状图
│   └── 排名明细表格 (可展开下钻)
├── 用户详情页 (点击排名条目进入)
│   ├── 用户KPI卡片
│   ├── 机器分布
│   ├── Agent使用趋势
│   ├── Tool/Skill使用排名
│   └── 会话列表
└── Tool/Skill分析页
    ├── Tool使用频率排名
    ├── Skill使用频率排名
    └── 使用趋势
```

### 5.2 图表服务端渲染

对于需要在非浏览器环境展示的场景（如CLI、邮件报告），使用node-canvas + ECharts进行SSR：

```javascript
const { createCanvas } = require('canvas');
const echarts = require('echarts');

function renderChart(option, width = 800, height = 400) {
  const canvas = createCanvas(width, height);
  const chart = echarts.init(canvas);
  chart.setOption(option);
  
  return canvas.toBuffer('image/png');
}
```

## 6. 安全设计

### 6.1 API认证

- 客户端上报使用API Key认证（`X-API-Key` header）
- Dashboard可选Basic Auth或OAuth
- API Key存储为bcrypt hash

### 6.2 数据校验

- 所有API入参使用JSON Schema校验（Fastify原生支持）
- event_id去重防止重复写入
- 限制单次batch大小（最大500条）
- 限制请求频率（每个API Key 100次/分钟）

### 6.3 数据隐私

- 不采集代码内容，仅采集元数据（工具名、文件数、行数等）
- 不采集用户输入的prompt内容
- 提供数据导出和删除API（GDPR合规）
