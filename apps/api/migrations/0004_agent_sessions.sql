-- Agent sessions table
-- Tracks AI coding agent sessions reported by daemons
-- Migration: 0004_agent_sessions

CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  agent TEXT NOT NULL,           -- 'claude-code', 'codex', 'aider', etc.
  project_path TEXT,
  project_name TEXT,
  status TEXT NOT NULL DEFAULT 'running',  -- 'running', 'idle', 'waiting_for_approval', 'completed', 'error'
  last_message TEXT,
  last_activity_at INTEGER DEFAULT (unixepoch()),
  started_at INTEGER DEFAULT (unixepoch()),
  ended_at INTEGER,
  FOREIGN KEY (machine_id) REFERENCES machines(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_user ON agent_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_machine ON agent_sessions(machine_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_status ON agent_sessions(status);
