import { describe, it, expect } from 'vitest';

// Import types to verify they compile correctly
import type { User, Machine, AgentSession } from '../types';

describe('Shared Types', () => {
  it('should define User type correctly', () => {
    const user: User = {
      id: 'user-123',
      email: 'test@example.com',
      name: 'Test User',
      avatarUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    expect(user.id).toBe('user-123');
    expect(user.email).toBe('test@example.com');
  });

  it('should define Machine type correctly', () => {
    const machine: Machine = {
      id: 'machine-123',
      userId: 'user-123',
      name: 'Test Machine',
      tunnelId: 'tunnel-123',
      tunnelUrl: 'https://t-machine-123.tunnel.agentap.dev',
      os: 'darwin',
      arch: 'arm64',
      agentsDetected: ['claude-code'],
      isOnline: true,
      activeSessionCount: 0,
      lastSeenAt: new Date(),
      createdAt: new Date(),
    };

    expect(machine.id).toBe('machine-123');
    expect(machine.isOnline).toBe(true);
  });

  it('should accept any agent string', () => {
    const agents: string[] = ['claude-code', 'codex', 'aider', 'opencode', 'custom-agent'];

    expect(agents).toContain('claude-code');
  });

  it('should define AgentSession type correctly', () => {
    const session: AgentSession = {
      id: 'session-123',
      agent: 'claude-code',
      machineId: 'machine-123',
      projectPath: '/path/to/project',
      projectName: 'my-project',
      status: 'running',
      lastMessage: 'Working on it...',
      lastActivity: new Date(),
      createdAt: new Date(),
      sessionName: 'Fix the login bug',
      model: 'claude-opus-4-6',
      agentMode: 'auto',
    };

    expect(session.agent).toBe('claude-code');
    expect(session.status).toBe('running');
  });
});
