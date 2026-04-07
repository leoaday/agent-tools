# 数据库设计

## 1. ER关系

```
users 1──N events N──1 sessions
  |                      |
  +──N machine_users N───+
```

## 2. 表结构

### 2.1 events（核心事件表）

```sql
CREATE TABLE events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_id VARCHAR(64) NOT NULL COMMENT '客户端生成的UUID，用于去重',
  
  -- 来源信息
  agent VARCHAR(32) NOT NULL COMMENT '编程Agent名称: claude-code/codebuddy/opencode等',
  agent_version VARCHAR(32) DEFAULT NULL COMMENT 'Agent版本号',
  
  -- 用户与机器
  username VARCHAR(128) NOT NULL COMMENT '用户名(os.userInfo().username)',
  hostname VARCHAR(256) NOT NULL COMMENT '机器名(os.hostname())',
  platform VARCHAR(16) NOT NULL COMMENT '平台: darwin/linux/win32',
  
  -- 会话与对话
  session_id VARCHAR(128) NOT NULL COMMENT '会话ID(Agent原生或生成)',
  conversation_turn INT UNSIGNED DEFAULT NULL COMMENT '当前对话轮次序号',
  
  -- 事件信息
  event_type VARCHAR(64) NOT NULL COMMENT '事件类型: session_start/session_end/tool_use/skill_use等',
  event_time DATETIME(3) NOT NULL COMMENT '事件发生时间(客户端时间)',
  received_time DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '服务器接收时间',
  
  -- 模型信息
  model VARCHAR(64) DEFAULT NULL COMMENT '使用的模型: claude-opus-4/gpt-4o等',
  
  -- Token消耗
  token_input INT UNSIGNED DEFAULT 0 COMMENT '输入token数',
  token_output INT UNSIGNED DEFAULT 0 COMMENT '输出token数',
  token_cache_read INT UNSIGNED DEFAULT 0 COMMENT '缓存读取token数',
  token_cache_write INT UNSIGNED DEFAULT 0 COMMENT '缓存写入token数',
  
  -- Tool/Skill使用
  tool_name VARCHAR(128) DEFAULT NULL COMMENT '工具名称',
  skill_name VARCHAR(128) DEFAULT NULL COMMENT 'Skill名称',
  
  -- 文件变更
  files_created INT UNSIGNED DEFAULT 0 COMMENT '创建的文件数',
  files_modified INT UNSIGNED DEFAULT 0 COMMENT '修改的文件数',
  lines_added INT UNSIGNED DEFAULT 0 COMMENT '新增行数',
  lines_removed INT UNSIGNED DEFAULT 0 COMMENT '删除行数',
  
  -- 扩展数据
  extra JSON DEFAULT NULL COMMENT '扩展字段(各Agent特有数据)',
  
  -- 索引
  UNIQUE KEY uk_event_id (event_id),
  KEY idx_time (event_time),
  KEY idx_user_time (username, event_time),
  KEY idx_session (session_id),
  KEY idx_agent_time (agent, event_time),
  KEY idx_hostname (hostname, event_time),
  KEY idx_model (model, event_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='核心事件表';
```

### 2.2 sessions（会话汇总表，定期聚合）

```sql
CREATE TABLE sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(128) NOT NULL,
  
  -- 来源
  agent VARCHAR(32) NOT NULL,
  username VARCHAR(128) NOT NULL,
  hostname VARCHAR(256) NOT NULL,
  platform VARCHAR(16) NOT NULL,
  model VARCHAR(64) DEFAULT NULL COMMENT '主要使用的模型',
  
  -- 时间
  start_time DATETIME(3) NOT NULL,
  end_time DATETIME(3) DEFAULT NULL,
  duration_seconds INT UNSIGNED DEFAULT NULL COMMENT '会话持续秒数',
  
  -- 聚合指标
  conversation_turns INT UNSIGNED DEFAULT 0 COMMENT '对话轮次数',
  token_input_total BIGINT UNSIGNED DEFAULT 0,
  token_output_total BIGINT UNSIGNED DEFAULT 0,
  token_total BIGINT UNSIGNED DEFAULT 0,
  
  tool_use_count INT UNSIGNED DEFAULT 0 COMMENT '工具使用总次数',
  tool_distinct_count INT UNSIGNED DEFAULT 0 COMMENT '使用的不同工具数',
  skill_use_count INT UNSIGNED DEFAULT 0 COMMENT 'Skill使用总次数',
  skill_distinct_count INT UNSIGNED DEFAULT 0 COMMENT '使用的不同Skill数',
  
  files_created_total INT UNSIGNED DEFAULT 0,
  files_modified_total INT UNSIGNED DEFAULT 0,
  lines_added_total INT UNSIGNED DEFAULT 0,
  lines_removed_total INT UNSIGNED DEFAULT 0,
  
  UNIQUE KEY uk_session (session_id),
  KEY idx_user_time (username, start_time),
  KEY idx_agent_time (agent, start_time),
  KEY idx_hostname (hostname, start_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='会话汇总表';
```

### 2.3 daily_stats（每日统计快照，定时任务生成）

```sql
CREATE TABLE daily_stats (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  stat_date DATE NOT NULL,
  
  -- 维度
  username VARCHAR(128) NOT NULL,
  hostname VARCHAR(256) NOT NULL,
  agent VARCHAR(32) NOT NULL,
  model VARCHAR(64) DEFAULT '__all__' COMMENT '模型，__all__表示不区分模型',
  
  -- 指标
  session_count INT UNSIGNED DEFAULT 0,
  conversation_turns INT UNSIGNED DEFAULT 0,
  token_input BIGINT UNSIGNED DEFAULT 0,
  token_output BIGINT UNSIGNED DEFAULT 0,
  token_total BIGINT UNSIGNED DEFAULT 0,
  
  tool_use_count INT UNSIGNED DEFAULT 0,
  tool_distinct_count INT UNSIGNED DEFAULT 0,
  skill_use_count INT UNSIGNED DEFAULT 0,
  skill_distinct_count INT UNSIGNED DEFAULT 0,
  
  files_created INT UNSIGNED DEFAULT 0,
  files_modified INT UNSIGNED DEFAULT 0,
  lines_added INT UNSIGNED DEFAULT 0,
  lines_removed INT UNSIGNED DEFAULT 0,
  
  UNIQUE KEY uk_daily (stat_date, username, hostname, agent, model),
  KEY idx_date (stat_date),
  KEY idx_user_date (username, stat_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='每日统计快照';
```

### 2.4 tool_usage_detail（工具/Skill使用明细，支持聚合和不聚合查询）

```sql
CREATE TABLE tool_usage_detail (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  stat_date DATE NOT NULL,
  username VARCHAR(128) NOT NULL,
  hostname VARCHAR(256) NOT NULL,
  agent VARCHAR(32) NOT NULL,
  session_id VARCHAR(128) NOT NULL,
  
  usage_type ENUM('tool', 'skill') NOT NULL,
  name VARCHAR(128) NOT NULL COMMENT '工具或Skill名称',
  use_count INT UNSIGNED DEFAULT 0 COMMENT '使用次数',
  
  KEY idx_date_user (stat_date, username),
  KEY idx_session (session_id),
  KEY idx_name (name, stat_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='工具/Skill使用明细';
```

## 3. 查询示例

### 3.1 按日统计排名（Token消耗Top10）

```sql
SELECT username, 
       SUM(token_total) AS total_tokens,
       SUM(token_input) AS input_tokens,
       SUM(token_output) AS output_tokens,
       SUM(session_count) AS sessions,
       SUM(conversation_turns) AS turns
FROM daily_stats
WHERE stat_date = '2026-04-07'
  AND model = '__all__'
GROUP BY username
ORDER BY total_tokens DESC
LIMIT 10;
```

### 3.2 按周统计（指定模型过滤）

```sql
SELECT username,
       SUM(token_total) AS total_tokens,
       SUM(session_count) AS sessions
FROM daily_stats
WHERE stat_date BETWEEN '2026-03-31' AND '2026-04-06'
  AND model = 'claude-opus-4'
GROUP BY username
ORDER BY total_tokens DESC;
```

### 3.3 下钻到机器维度

```sql
SELECT hostname, agent,
       SUM(token_total) AS total_tokens,
       SUM(session_count) AS sessions
FROM daily_stats
WHERE stat_date BETWEEN '2026-04-01' AND '2026-04-07'
  AND username = 'leon'
  AND model = '__all__'
GROUP BY hostname, agent
ORDER BY total_tokens DESC;
```

### 3.4 单会话Skill使用统计

```sql
-- 不聚合（列出每次使用）
SELECT session_id, name, use_count
FROM tool_usage_detail
WHERE usage_type = 'skill'
  AND session_id = 'xxx';

-- 按Skill名称聚合
SELECT name, SUM(use_count) AS total_uses
FROM tool_usage_detail
WHERE usage_type = 'skill'
  AND stat_date BETWEEN '2026-04-01' AND '2026-04-07'
GROUP BY name
ORDER BY total_uses DESC;
```

## 4. 数据生命周期

| 数据层 | 保留策略 | 用途 |
|--------|---------|------|
| events | 90天（可配置） | 原始事件，支持任意维度回溯 |
| sessions | 180天 | 会话级聚合，快速查询 |
| daily_stats | 永久 | 每日快照，报表和趋势 |
| tool_usage_detail | 90天 | 工具使用明细 |
