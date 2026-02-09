import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { assessRisk } from '../helpers/assess-risk';
import { categorizeTool } from '../helpers/categorize-tool';
import { createEvent, resetSequence, resetAllSequences } from '../helpers/create-event';
import { describeToolCall } from '../helpers/describe-tool';
import { ACP_VERSION, ACP_MIN_VERSION } from '../version';

// ---------------------------------------------------------------------------
// assessRisk
// ---------------------------------------------------------------------------
describe('assessRisk', () => {
  it('returns "high" for Bash with dangerous commands', () => {
    const dangerous = ['rm', 'sudo', 'chmod', 'chown', 'kill', 'mkfs', 'dd'];
    for (const cmd of dangerous) {
      expect(assessRisk('Bash', { command: `${cmd} -rf /tmp/foo` })).toBe('high');
    }
  });

  it('returns "high" when a dangerous command appears mid-string', () => {
    expect(assessRisk('Bash', { command: 'cd /tmp && rm -rf *' })).toBe('high');
    expect(assessRisk('Bash', { command: 'echo hello | sudo tee /x' })).toBe('high');
  });

  it('returns "medium" for Bash with install commands', () => {
    const install = ['npm', 'pip', 'brew', 'apt', 'yarn', 'pnpm', 'cargo'];
    for (const cmd of install) {
      expect(assessRisk('Bash', { command: `${cmd} install foo` })).toBe('medium');
    }
  });

  it('returns "low" for Bash with safe commands', () => {
    expect(assessRisk('Bash', { command: 'echo hello' })).toBe('low');
    expect(assessRisk('Bash', { command: 'ls -la' })).toBe('low');
    expect(assessRisk('Bash', { command: 'git status' })).toBe('low');
  });

  it('returns "medium" for Write tool', () => {
    expect(assessRisk('Write', { file_path: '/tmp/foo.ts' })).toBe('medium');
  });

  it('returns "medium" for Edit tool', () => {
    expect(assessRisk('Edit', { file_path: '/tmp/foo.ts' })).toBe('medium');
  });

  it('returns "low" for other tools', () => {
    expect(assessRisk('Read', { file_path: '/tmp/foo.ts' })).toBe('low');
    expect(assessRisk('Glob', { pattern: '**/*.ts' })).toBe('low');
    expect(assessRisk('Grep', { pattern: 'foo' })).toBe('low');
    expect(assessRisk('Task', { description: 'do stuff' })).toBe('low');
    expect(assessRisk('WebSearch', { query: 'hello' })).toBe('low');
    expect(assessRisk('WebFetch', { url: 'https://example.com' })).toBe('low');
  });

  it('handles Bash with no command gracefully', () => {
    expect(assessRisk('Bash', {})).toBe('low');
    expect(assessRisk('Bash', null)).toBe('low');
    expect(assessRisk('Bash', undefined)).toBe('low');
  });

  it('prefers dangerous over install when both match', () => {
    // "sudo npm install" has both sudo (dangerous) and npm (install)
    // dangerous check comes first so should return 'high'
    expect(assessRisk('Bash', { command: 'sudo npm install foo' })).toBe('high');
  });
});

// ---------------------------------------------------------------------------
// categorizeTool
// ---------------------------------------------------------------------------
describe('categorizeTool', () => {
  it('returns "file_read" for read tools', () => {
    expect(categorizeTool('Read')).toBe('file_read');
    expect(categorizeTool('Glob')).toBe('file_read');
    expect(categorizeTool('Grep')).toBe('file_read');
  });

  it('returns "file_write" for write tools', () => {
    expect(categorizeTool('Write')).toBe('file_write');
    expect(categorizeTool('NotebookEdit')).toBe('file_write');
  });

  it('returns "file_edit" for Edit', () => {
    expect(categorizeTool('Edit')).toBe('file_edit');
  });

  it('returns "terminal" for Bash', () => {
    expect(categorizeTool('Bash')).toBe('terminal');
  });

  it('returns "web" for WebSearch', () => {
    expect(categorizeTool('WebSearch')).toBe('web');
  });

  it('returns "web" for WebFetch', () => {
    expect(categorizeTool('WebFetch')).toBe('web');
  });

  it('returns "agent" for Task', () => {
    expect(categorizeTool('Task')).toBe('agent');
  });

  // Heuristic fallbacks
  it('returns "git" for tool names containing "git"', () => {
    expect(categorizeTool('GitCommit')).toBe('git');
    expect(categorizeTool('mygithelper')).toBe('git');
  });

  it('returns "mcp" for tool names containing "mcp"', () => {
    expect(categorizeTool('McpServer')).toBe('mcp');
    expect(categorizeTool('some_mcp_tool')).toBe('mcp');
  });

  it('returns "search" for tool names containing "search"', () => {
    expect(categorizeTool('CodeSearch')).toBe('search');
    expect(categorizeTool('fullsearchindex')).toBe('search');
  });

  it('returns "other" for unknown tools', () => {
    expect(categorizeTool('RandomTool')).toBe('other');
    expect(categorizeTool('FooBar')).toBe('other');
    expect(categorizeTool('')).toBe('other');
  });
});

// ---------------------------------------------------------------------------
// createEvent / resetSequence / resetAllSequences
// ---------------------------------------------------------------------------
describe('createEvent', () => {
  beforeEach(() => {
    resetAllSequences();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('auto-increments sequence numbers per session', () => {
    vi.setSystemTime(new Date('2025-01-15T10:00:00.000Z'));

    const e1 = createEvent('sess-1', { type: 'session:started' });
    const e2 = createEvent('sess-1', { type: 'message:start' });
    const e3 = createEvent('sess-1', { type: 'message:complete' });

    expect(e1.seq).toBe(1);
    expect(e2.seq).toBe(2);
    expect(e3.seq).toBe(3);
  });

  it('tracks sequence numbers independently per session', () => {
    const a1 = createEvent('sess-a', { type: 'session:started' });
    const b1 = createEvent('sess-b', { type: 'session:started' });
    const a2 = createEvent('sess-a', { type: 'message:start' });

    expect(a1.seq).toBe(1);
    expect(b1.seq).toBe(1);
    expect(a2.seq).toBe(2);
  });

  it('includes sessionId and timestamp', () => {
    const fakeDate = new Date('2025-06-01T12:30:00.000Z');
    vi.setSystemTime(fakeDate);

    const event = createEvent('my-session', { type: 'session:started' });

    expect(event.sessionId).toBe('my-session');
    expect(event.timestamp).toBe('2025-06-01T12:30:00.000Z');
  });

  it('spreads event-specific fields onto the result', () => {
    const event = createEvent('sess-1', {
      type: 'tool:start',
      toolCallId: 'tc-1',
      name: 'Bash',
      category: 'terminal',
    });

    expect(event.type).toBe('tool:start');
    expect((event as unknown as Record<string, unknown>).toolCallId).toBe('tc-1');
    expect((event as unknown as Record<string, unknown>).name).toBe('Bash');
    expect((event as unknown as Record<string, unknown>).category).toBe('terminal');
  });
});

describe('resetSequence', () => {
  beforeEach(() => {
    resetAllSequences();
  });

  it('resets the counter for a specific session', () => {
    createEvent('sess-1', { type: 'session:started' });
    createEvent('sess-1', { type: 'message:start' });
    expect(createEvent('sess-1', { type: 'message:complete' }).seq).toBe(3);

    resetSequence('sess-1');

    expect(createEvent('sess-1', { type: 'session:started' }).seq).toBe(1);
  });

  it('does not affect other sessions', () => {
    createEvent('sess-a', { type: 'session:started' });
    createEvent('sess-b', { type: 'session:started' });

    resetSequence('sess-a');

    expect(createEvent('sess-a', { type: 'session:started' }).seq).toBe(1);
    expect(createEvent('sess-b', { type: 'message:start' }).seq).toBe(2);
  });
});

describe('resetAllSequences', () => {
  it('resets all session counters', () => {
    createEvent('sess-a', { type: 'session:started' });
    createEvent('sess-b', { type: 'session:started' });

    resetAllSequences();

    expect(createEvent('sess-a', { type: 'session:started' }).seq).toBe(1);
    expect(createEvent('sess-b', { type: 'session:started' }).seq).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// describeToolCall
// ---------------------------------------------------------------------------
describe('describeToolCall', () => {
  it('describes Bash commands (truncated to 100 chars)', () => {
    expect(describeToolCall('Bash', { command: 'ls -la' })).toBe('Run: ls -la');

    const longCmd = 'a'.repeat(200);
    const result = describeToolCall('Bash', { command: longCmd });
    expect(result).toBe(`Run: ${'a'.repeat(100)}`);
    expect(result.length).toBe(5 + 100); // "Run: " + 100 chars
  });

  it('describes Read', () => {
    expect(describeToolCall('Read', { file_path: '/foo/bar.ts' })).toBe('Read: /foo/bar.ts');
  });

  it('describes Write', () => {
    expect(describeToolCall('Write', { file_path: '/foo/bar.ts' })).toBe('Write: /foo/bar.ts');
  });

  it('describes Edit', () => {
    expect(describeToolCall('Edit', { file_path: '/foo/bar.ts' })).toBe('Edit: /foo/bar.ts');
  });

  it('describes Glob', () => {
    expect(describeToolCall('Glob', { pattern: '**/*.ts' })).toBe('Search: **/*.ts');
  });

  it('describes Grep', () => {
    expect(describeToolCall('Grep', { pattern: 'TODO' })).toBe('Grep: TODO');
  });

  it('describes Task (truncated to 50 chars)', () => {
    expect(describeToolCall('Task', { description: 'Run the build' })).toBe('Task: Run the build');

    const longDesc = 'x'.repeat(100);
    const result = describeToolCall('Task', { description: longDesc });
    expect(result).toBe(`Task: ${'x'.repeat(50)}`);
  });

  it('describes WebSearch', () => {
    expect(describeToolCall('WebSearch', { query: 'vitest docs' })).toBe('Search: vitest docs');
  });

  it('describes WebFetch', () => {
    expect(describeToolCall('WebFetch', { url: 'https://example.com' })).toBe(
      'Fetch: https://example.com'
    );
  });

  it('returns tool name for unknown tools (default case)', () => {
    expect(describeToolCall('MyCustomTool', { foo: 'bar' })).toBe('MyCustomTool');
    expect(describeToolCall('RandomThing', {})).toBe('RandomThing');
  });
});

// ---------------------------------------------------------------------------
// version.ts
// ---------------------------------------------------------------------------
describe('version', () => {
  it('exports ACP_VERSION', () => {
    expect(ACP_VERSION).toBe('1.0.0');
  });

  it('exports ACP_MIN_VERSION', () => {
    expect(ACP_MIN_VERSION).toBe('1.0.0');
  });
});
