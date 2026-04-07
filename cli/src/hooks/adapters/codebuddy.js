function normalize(eventType, rawData) {
  const base = {
    agent: 'codebuddy',
    session_id: rawData.session_id || rawData.sessionId || 'unknown',
    event_type: mapEventType(eventType),
  };
  if (rawData.tool_name) base.tool_name = rawData.tool_name;
  if (rawData.tool) base.tool_name = rawData.tool;
  if (rawData.model) base.model = rawData.model;
  if (rawData.usage) {
    base.token_input = rawData.usage.input_tokens || 0;
    base.token_output = rawData.usage.output_tokens || 0;
  }
  if (rawData.skill_name) base.skill_name = rawData.skill_name;

  // Detect user-typed slash commands via UserPromptSubmit hook.
  // CodeBuddy (fork of Claude Code) passes the raw prompt before skill expansion.
  if (eventType === 'UserPromptSubmit' && typeof rawData.prompt === 'string') {
    const trimmed = rawData.prompt.trim();
    if (trimmed.startsWith('/')) {
      const skillName = trimmed.split(/\s+/)[0].slice(1);
      if (skillName) {
        base.skill_name = skillName;
        base.event_type = 'skill_use';
      }
    }
  }

  // Detect model-initiated Skill tool invocations (PostToolUse with tool_name="Skill").
  if (eventType === 'PostToolUse' && base.tool_name === 'Skill') {
    const skillInput = rawData.tool_input || rawData.input || {};
    if (typeof skillInput.skill === 'string' && skillInput.skill) {
      base.skill_name = skillInput.skill;
    }
    base.event_type = 'skill_use';
  }

  return base;
}

function mapEventType(event) {
  const map = {
    'SessionStart': 'session_start', 'SessionEnd': 'session_end',
    'PreToolUse': 'tool_pre', 'PostToolUse': 'tool_use',
    'PostToolUseFailure': 'tool_failure', 'UserPromptSubmit': 'user_message',
    'Stop': 'assistant_stop',
  };
  return map[event] || event.toLowerCase();
}

module.exports = { normalize };
