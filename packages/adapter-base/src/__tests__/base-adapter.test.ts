import { describe, it, expect } from 'vitest';
import { BaseAdapter } from '../base-adapter';
import type {
  ACPSession,
  ACPCapabilities,
  DiscoveredSession,
  SessionDiscoveryEvent,
  StartSessionOptions,
  IntegrationMethod,
  ACPEvent,
  ACPCommand,
} from '@agentap-dev/acp';
import { ACP_VERSION } from '@agentap-dev/acp';

function createMockACPSession(): ACPSession {
  return {
    sessionId: 'test-session',
    capabilities: {} as ACPCapabilities,
    onEvent: () => () => {},
    execute: async () => {},
    getHistory: async () => [],
    detach: async () => {},
  };
}

// Create a concrete implementation for testing
class TestAdapter extends BaseAdapter {
  readonly name = 'claude-code';
  readonly displayName = 'Test Agent';
  readonly icon = 'test-icon';
  readonly integrationMethod: IntegrationMethod = 'sdk';

  async isInstalled(): Promise<boolean> {
    return true;
  }

  async getVersion(): Promise<string | null> {
    return '1.0.0';
  }

  async discoverSessions(): Promise<DiscoveredSession[]> {
    return [];
  }

  watchSessions(_callback: (event: SessionDiscoveryEvent) => void): () => void {
    return () => {};
  }

  async attachToSession(_sessionId: string): Promise<ACPSession> {
    return createMockACPSession();
  }

  async startSession(_options: StartSessionOptions): Promise<ACPSession> {
    return createMockACPSession();
  }

  // Expose protected methods for testing
  public testGenerateId(): string {
    return this.generateId();
  }

  public testAssessRisk(toolName: string, input: unknown) {
    return this.assessRisk(toolName, input);
  }

  public testDescribeToolCall(toolName: string, input: unknown) {
    return this.describeToolCall(toolName, input);
  }

  public testCategorizeTool(toolName: string) {
    return this.categorizeTool(toolName);
  }
}

describe('BaseAdapter', () => {
  it('should create an adapter instance', () => {
    const adapter = new TestAdapter();
    expect(adapter).toBeInstanceOf(BaseAdapter);
  });

  it('should have correct agent type', () => {
    const adapter = new TestAdapter();
    expect(adapter.name).toBe('claude-code');
    expect(adapter.displayName).toBe('Test Agent');
  });

  it('should check if installed', async () => {
    const adapter = new TestAdapter();
    const installed = await adapter.isInstalled();
    expect(installed).toBe(true);
  });

  it('should discover sessions', async () => {
    const adapter = new TestAdapter();
    const sessions = await adapter.discoverSessions();
    expect(sessions).toEqual([]);
  });

  it('should return structured capabilities', () => {
    const adapter = new TestAdapter();
    const caps = adapter.getCapabilities();

    expect(caps.protocolVersion).toBe(ACP_VERSION);
    expect(caps.agent.name).toBe('claude-code');
    expect(caps.agent.displayName).toBe('Test Agent');
    expect(caps.features.streaming.messages).toBe(true);
    expect(caps.features.approval.toolCalls).toBe(false);
    expect(caps.features.sessionControl.cancel).toBe(false);
    expect(caps.features.thinking).toBe(false);
  });

  it('should attach to session returning ACPSession', async () => {
    const adapter = new TestAdapter();
    const session = await adapter.attachToSession('test-session');
    expect(session.sessionId).toBe('test-session');
    expect(typeof session.onEvent).toBe('function');
    expect(typeof session.execute).toBe('function');
    expect(typeof session.getHistory).toBe('function');
    expect(typeof session.detach).toBe('function');
  });

  it('should return empty object from getDataPaths() by default', () => {
    const adapter = new TestAdapter();
    const paths = adapter.getDataPaths();
    expect(paths).toEqual({});
  });

  it('should have accessible icon property', () => {
    const adapter = new TestAdapter();
    expect(adapter.icon).toBe('test-icon');
    expect(typeof adapter.icon).toBe('string');
  });

  it('should have accessible integrationMethod property', () => {
    const adapter = new TestAdapter();
    expect(adapter.integrationMethod).toBe('sdk');
    expect(typeof adapter.integrationMethod).toBe('string');
  });

  it('should return version from getVersion()', async () => {
    const adapter = new TestAdapter();
    const version = await adapter.getVersion();
    expect(version).toBe('1.0.0');
    expect(typeof version).toBe('string');
  });

  it('should return cleanup function from watchSessions()', () => {
    const adapter = new TestAdapter();
    const cleanup = adapter.watchSessions(() => {});
    expect(typeof cleanup).toBe('function');
    // Calling cleanup should not throw
    expect(() => cleanup()).not.toThrow();
  });

  it('should return ACPSession from startSession()', async () => {
    const adapter = new TestAdapter();
    const session = await adapter.startSession({
      agent: 'claude-code',
      projectPath: '/tmp/test',
      prompt: 'test prompt',
    } as StartSessionOptions);
    expect(session).toBeDefined();
    expect(session.sessionId).toBe('test-session');
    expect(typeof session.onEvent).toBe('function');
    expect(typeof session.execute).toBe('function');
    expect(typeof session.getHistory).toBe('function');
    expect(typeof session.detach).toBe('function');
  });

  it('should generate IDs of sufficient length', () => {
    const adapter = new TestAdapter();
    const id = adapter.testGenerateId();
    expect(typeof id).toBe('string');
    // generateId concatenates two random().toString(36).substring(2,15) values
    // Each produces up to 13 chars, so combined should be at least 16
    expect(id.length).toBeGreaterThanOrEqual(16);
  });

  it('should generate unique IDs on successive calls', () => {
    const adapter = new TestAdapter();
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(adapter.testGenerateId());
    }
    // All 100 IDs should be unique
    expect(ids.size).toBe(100);
  });

  describe('protected helpers accessible from subclass', () => {
    it('should expose assessRisk that returns a risk level', () => {
      const adapter = new TestAdapter();
      const risk = adapter.testAssessRisk('Bash', { command: 'rm -rf /' });
      expect(risk).toBe('high');
    });

    it('should expose assessRisk with low risk for read tools', () => {
      const adapter = new TestAdapter();
      const risk = adapter.testAssessRisk('Read', { file_path: '/tmp/test.ts' });
      expect(risk).toBe('low');
    });

    it('should expose assessRisk with medium risk for write tools', () => {
      const adapter = new TestAdapter();
      const risk = adapter.testAssessRisk('Write', { file_path: '/tmp/test.ts' });
      expect(risk).toBe('medium');
    });

    it('should expose describeToolCall that returns a description string', () => {
      const adapter = new TestAdapter();
      const desc = adapter.testDescribeToolCall('Bash', { command: 'ls -la' });
      expect(desc).toBe('Run: ls -la');
      expect(typeof desc).toBe('string');
    });

    it('should expose describeToolCall for Read tool', () => {
      const adapter = new TestAdapter();
      const desc = adapter.testDescribeToolCall('Read', { file_path: '/tmp/test.ts' });
      expect(desc).toBe('Read: /tmp/test.ts');
    });

    it('should expose categorizeTool that returns a tool category', () => {
      const adapter = new TestAdapter();
      const cat = adapter.testCategorizeTool('Bash');
      expect(cat).toBe('terminal');
    });

    it('should expose categorizeTool for file read tools', () => {
      const adapter = new TestAdapter();
      expect(adapter.testCategorizeTool('Read')).toBe('file_read');
      expect(adapter.testCategorizeTool('Glob')).toBe('file_read');
      expect(adapter.testCategorizeTool('Grep')).toBe('file_read');
    });

    it('should expose categorizeTool for file write tools', () => {
      const adapter = new TestAdapter();
      expect(adapter.testCategorizeTool('Write')).toBe('file_write');
      expect(adapter.testCategorizeTool('Edit')).toBe('file_edit');
    });
  });

  describe('getCapabilities() default feature flags', () => {
    it('should return all default feature flags correctly', () => {
      const adapter = new TestAdapter();
      const caps = adapter.getCapabilities();

      // Agent info
      expect(caps.agent.name).toBe('claude-code');
      expect(caps.agent.displayName).toBe('Test Agent');
      expect(caps.agent.icon).toBe('test-icon');
      expect(caps.agent.version).toBeNull();
      expect(caps.agent.integrationMethod).toBe('sdk');

      // Streaming
      expect(caps.features.streaming.messages).toBe(true);
      expect(caps.features.streaming.toolArgs).toBe(false);
      expect(caps.features.streaming.thinking).toBe(false);

      // Approval
      expect(caps.features.approval.toolCalls).toBe(false);
      expect(caps.features.approval.preview).toBe(false);

      // Session control
      expect(caps.features.sessionControl.pause).toBe(false);
      expect(caps.features.sessionControl.resume).toBe(false);
      expect(caps.features.sessionControl.cancel).toBe(false);

      // Sub agents
      expect(caps.features.subAgents).toBe(false);

      // Planning
      expect(caps.features.planning.todos).toBe(false);
      expect(caps.features.planning.planMode).toBe(false);

      // Resources
      expect(caps.features.resources.tokenUsage).toBe(false);
      expect(caps.features.resources.costTracking).toBe(false);
      expect(caps.features.resources.contextWindow).toBe(false);

      // File operations
      expect(caps.features.fileOperations.diffs).toBe(false);
      expect(caps.features.fileOperations.batchedChanges).toBe(false);

      // Other flags
      expect(caps.features.git).toBe(false);
      expect(caps.features.webSearch).toBe(false);
      expect(caps.features.multimodal).toBe(false);

      // User interaction
      expect(caps.features.userInteraction.questions).toBe(false);
      expect(caps.features.userInteraction.notifications).toBe(false);

      // Thinking
      expect(caps.features.thinking).toBe(false);

      // Custom events
      expect(caps.features.customEvents).toEqual([]);
    });
  });
});
