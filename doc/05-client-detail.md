# 客户端详细设计

## 1. CLI命令设计

### 1.1 命令总览

```bash
# 安装
npm install -g agent-tools

# 自动检测并配置（安装后自动运行一次，也可手动执行）
agent-tools setup [--force] [--agent=claude-code,codebuddy]

# 查看检测到的Agent
agent-tools agents

# 本地统计（离线可用）
agent-tools stats [--period=day|week|month] [--model=xxx] [--date=2026-04-07]

# 手动触发上报
agent-tools sync

# 配置服务器地址等
agent-tools config set server.url https://your-server.com
agent-tools config set server.apiKey xxx
agent-tools config get server.url

# 查看当前状态
agent-tools status
```

### 1.2 setup命令流程

```
agent-tools setup
  │
  ├─ 1. 检测平台 (darwin/linux/win32)
  │
  ├─ 2. 扫描已安装的编程Agent
  │     ├─ 检查CLI命令 (which/where)
  │     ├─ 检查配置目录是否存在
  │     └─ 输出检测结果列表
  │
  ├─ 3. 对每个检测到的Agent:
  │     ├─ 读取现有配置文件
  │     ├─ 检查是否已配置agent-tools hooks
  │     ├─ 生成hook配置(使用模板)
  │     ├─ 合并到现有配置(不覆盖用户已有hooks)
  │     └─ 写入配置文件
  │
  ├─ 4. 配置MCP Server(对支持MCP的Agent)
  │
  └─ 5. 输出配置摘要
       ├─ 已配置的Agent列表
       ├─ 需要手动配置的Agent(如Aider)
       └─ 服务器连接状态
```

### 1.3 配置合并策略

**核心原则：不破坏用户现有配置**

```javascript
function mergeHooksConfig(existingConfig, agentToolsHooks) {
  const config = JSON.parse(JSON.stringify(existingConfig));
  
  for (const [event, hooks] of Object.entries(agentToolsHooks)) {
    if (!config.hooks) config.hooks = {};
    if (!config.hooks[event]) config.hooks[event] = [];
    
    // 检查是否已存在agent-tools的hook
    const hasAgentTools = config.hooks[event].some(h => 
      h.command && h.command.includes('agent-tools')
    );
    
    if (!hasAgentTools) {
      // 追加到末尾，不影响已有hooks
      config.hooks[event].push(...hooks);
    } else {
      // 更新已有的agent-tools hook（版本更新场景）
      config.hooks[event] = config.hooks[event].map(h => {
        if (h.command && h.command.includes('agent-tools')) {
          return hooks[0]; // 替换为新版
        }
        return h;
      });
    }
  }
  
  return config;
}
```

## 2. 通用Hook脚本设计

### 2.1 universal-hook.js

所有Agent的hook最终都调用此脚本，它负责：
1. 从stdin读取Agent传入的事件JSON
2. 通过适配器转换为统一格式
3. 写入本地缓存
4. 触发异步上报（如有必要）

```javascript
#!/usr/bin/env node

const { stdin, argv } = process;
const { normalize } = require('./adapters');
const { LocalStore } = require('../collector/local-store');
const { Uploader } = require('../collector/uploader');

async function main() {
  const agent = argv.find(a => a.startsWith('--agent='))?.split('=')[1];
  const event = argv.find(a => a.startsWith('--event='))?.split('=')[1];
  
  // 读取stdin
  let input = '';
  for await (const chunk of stdin) input += chunk;
  
  const rawEvent = input ? JSON.parse(input) : {};
  
  // 适配为统一格式
  const normalized = normalize(agent, event, rawEvent);
  
  // 写入本地缓存
  const store = new LocalStore();
  await store.insert(normalized);
  
  // 检查是否需要上报
  const uploader = new Uploader();
  await uploader.checkAndSync();
}

main().catch(() => process.exit(0)); // hook不应阻塞Agent运行
```

### 2.2 事件标准化格式

```typescript
interface NormalizedEvent {
  event_id: string;           // UUID v4
  
  // 来源
  agent: string;              // claude-code | codebuddy | opencode | ...
  agent_version?: string;
  
  // 用户与机器
  username: string;           // os.userInfo().username
  hostname: string;           // os.hostname()
  platform: string;           // os.platform()
  
  // 会话
  session_id: string;
  conversation_turn?: number;
  
  // 事件
  event_type: string;         // session_start | session_end | tool_use | skill_use | message | ...
  event_time: string;         // ISO 8601
  
  // 模型
  model?: string;
  
  // Token
  token_input?: number;
  token_output?: number;
  token_cache_read?: number;
  token_cache_write?: number;
  
  // Tool/Skill
  tool_name?: string;
  skill_name?: string;
  
  // 文件变更
  files_created?: number;
  files_modified?: number;
  lines_added?: number;
  lines_removed?: number;
  
  // 扩展
  extra?: Record<string, unknown>;
}
```

### 2.3 各Agent适配器示例

**Claude Code适配器：**

```javascript
function adaptClaudeCode(eventType, raw) {
  // Claude Code hook通过stdin传入的JSON结构
  // SessionStart: { session_id, cwd, ... }
  // PostToolUse: { session_id, tool_name, tool_input, tool_output, ... }
  
  const base = {
    agent: 'claude-code',
    session_id: raw.session_id,
    event_type: mapEventType(eventType),
  };
  
  if (eventType === 'PostToolUse') {
    base.tool_name = raw.tool_name;
    // 从tool_output中提取token信息（如果有）
    if (raw.usage) {
      base.token_input = raw.usage.input_tokens;
      base.token_output = raw.usage.output_tokens;
    }
  }
  
  return base;
}

function mapEventType(claudeEvent) {
  const map = {
    'SessionStart': 'session_start',
    'SessionEnd': 'session_end',
    'PreToolUse': 'tool_pre',
    'PostToolUse': 'tool_use',
    'UserPromptSubmit': 'user_message',
    'Stop': 'assistant_stop',
  };
  return map[claudeEvent] || claudeEvent.toLowerCase();
}
```

**Copilot CLI适配器：**

```javascript
function adaptCopilot(eventType, raw) {
  return {
    agent: 'copilot-cli',
    session_id: raw.sessionId || raw.session_id,
    event_type: mapEventType(eventType),
    tool_name: raw.toolName || raw.tool_name,
  };
}
```

## 3. 本地存储设计

### 3.1 SQLite Schema

```sql
-- 客户端本地SQLite，用于离线缓存和本地查询
CREATE TABLE local_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT UNIQUE NOT NULL,
  data TEXT NOT NULL,          -- JSON序列化的NormalizedEvent
  created_at TEXT NOT NULL,    -- ISO 8601
  synced INTEGER DEFAULT 0,   -- 0=未同步, 1=已同步
  synced_at TEXT DEFAULT NULL
);

CREATE INDEX idx_synced ON local_events(synced, created_at);
CREATE INDEX idx_created ON local_events(created_at);
```

### 3.2 上报策略

```javascript
class Uploader {
  constructor(config) {
    this.batchSize = 100;        // 每批最大条数
    this.syncInterval = 5 * 60;  // 5分钟
    this.serverUrl = config.serverUrl;
    this.apiKey = config.apiKey;
  }

  async checkAndSync() {
    const store = new LocalStore();
    const unsyncedCount = await store.getUnsyncedCount();
    const lastSync = await store.getLastSyncTime();
    const elapsed = (Date.now() - lastSync) / 1000;
    
    if (unsyncedCount >= this.batchSize || elapsed >= this.syncInterval) {
      await this.sync();
    }
  }

  async sync() {
    const store = new LocalStore();
    const events = await store.getUnsynced(this.batchSize);
    if (events.length === 0) return;
    
    try {
      const response = await fetch(`${this.serverUrl}/api/v1/events/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
        },
        body: JSON.stringify({ events }),
      });
      
      if (response.ok) {
        const ids = events.map(e => e.event_id);
        await store.markSynced(ids);
      }
    } catch (err) {
      // 网络失败不阻塞，下次再试
    }
  }
}
```

## 4. 跨平台处理

### 4.1 路径处理

```javascript
const os = require('os');
const path = require('path');

function getAgentConfigPath(agent) {
  const home = os.homedir();
  
  const paths = {
    'claude-code': path.join(home, '.claude', 'settings.json'),
    'codebuddy': path.join(home, '.codebuddy', 'settings.json'),
    'opencode': path.join(home, '.config', 'opencode', 'opencode.json'),
    'copilot-cli': null, // 项目级配置，无全局
    'cursor': path.join(home, '.cursor', 'hooks.json'),
    'continue': path.join(home, '.continue', 'config.yaml'),
    'amazon-q': path.join(home, '.aws', 'amazonq', 'default.json'),
  };
  
  return paths[agent];
}
```

### 4.2 用户信息获取

```javascript
const os = require('os');

function getUserInfo() {
  return {
    username: os.userInfo().username,   // 跨平台统一
    hostname: os.hostname(),
    platform: os.platform(),            // darwin | linux | win32
    homeDir: os.homedir(),
    shell: process.env.SHELL || process.env.COMSPEC || 'unknown',
  };
}
```

## 5. postinstall脚本

```javascript
#!/usr/bin/env node
// scripts/postinstall.js
// 轻量级：仅检测和提示，不修改配置

const { execSync } = require('child_process');
const os = require('os');

const agents = [
  { name: 'Claude Code', cmd: 'claude' },
  { name: 'CodeBuddy', cmd: 'codebuddy' },
  { name: 'OpenCode', cmd: 'opencode' },
  { name: 'GitHub Copilot CLI', cmd: 'gh' },
  { name: 'Cursor', cmd: 'cursor' },
  { name: 'Amazon Q', cmd: 'amazon-q' },
  { name: 'Aider', cmd: 'aider' },
];

function isInstalled(cmd) {
  try {
    const check = os.platform() === 'win32' ? 'where' : 'which';
    execSync(`${check} ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

console.log('\n[agent-tools] Scanning for installed AI coding agents...\n');

const detected = agents.filter(a => isInstalled(a.cmd));

if (detected.length > 0) {
  console.log('  Detected:');
  detected.forEach(a => console.log(`    + ${a.name}`));
  console.log('\n  Run "agent-tools setup" to configure hooks automatically.\n');
} else {
  console.log('  No AI coding agents detected in PATH.');
  console.log('  Install one and run "agent-tools setup" when ready.\n');
}
```
