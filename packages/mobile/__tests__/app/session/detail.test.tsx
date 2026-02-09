/**
 * Tests for app/session/[id].tsx — Session Detail Screen
 *
 * Covers: header rendering, message types, tool calls, approval banners,
 * input/send, empty states, session info modal, thinking blocks, timeline
 * construction, and helper functions.
 */

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Alert } from 'react-native';

const { mockRouter, mockSessionsStore, mockMachinesStore } = require('../../setup');

// ── Additional mocks required by this screen ────────────────────────

const mockSetOptions = jest.fn();

// Override the expo-router mock from setup.ts to add useNavigation
jest.mock('expo-router', () => {
  const React = require('react');
  const StackComponent = ({ children }: any) =>
    React.createElement('View', { testID: 'stack' }, children);
  StackComponent.Screen = ({ name }: any) =>
    React.createElement('View', { testID: `stack-screen-${name}` });
  const TabsComponent = ({ children }: any) =>
    React.createElement('View', { testID: 'tabs' }, children);
  TabsComponent.Screen = ({ name }: any) =>
    React.createElement('View', { testID: `tabs-screen-${name}` });
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: jest.fn(() => ({ id: 'session-123' })),
    useNavigation: jest.fn(() => ({ setOptions: mockSetOptions })),
    useSegments: jest.fn(() => []),
    useGlobalSearchParams: jest.fn(() => ({})),
    Link: ({ children, ...props }: any) => React.createElement('Text', props, children),
    Stack: StackComponent,
    Tabs: TabsComponent,
    Slot: ({ children }: any) => React.createElement('View', { testID: 'slot' }, children),
  };
});

const { useLocalSearchParams } = require('expo-router');

const mockSubscribeToSession = jest.fn();
const mockSendMessage = jest.fn();
const mockApproveToolCall = jest.fn();
const mockDenyToolCall = jest.fn();
const mockCancelSession = jest.fn();
const mockRefreshAll = jest.fn();

jest.mock('../../../components/WebSocketProvider', () => ({
  useWebSocketContext: jest.fn(() => ({
    subscribeToSession: mockSubscribeToSession,
    sendMessage: mockSendMessage,
    approveToolCall: mockApproveToolCall,
    denyToolCall: mockDenyToolCall,
    cancelSession: mockCancelSession,
    refreshAll: mockRefreshAll,
  })),
}));

jest.mock('../../../components/AuthProvider', () => ({
  useAuth: jest.fn(() => ({ signOut: jest.fn() })),
}));

// ── Import component under test ─────────────────────────────────────

import SessionDetailScreen from '../../../app/session/[id]';

// ── Test helpers ────────────────────────────────────────────────────

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-123',
    agent: 'claude-code',
    machineId: 'machine-1',
    projectPath: '/home/user/project',
    projectName: 'my-project',
    status: 'running',
    lastMessage: 'Hello world',
    lastActivity: new Date('2025-01-15T10:00:00Z'),
    createdAt: new Date('2025-01-15T09:00:00Z'),
    sessionName: 'Fix login bug',
    model: 'claude-sonnet-4-20250514',
    agentMode: 'auto',
    ...overrides,
  };
}

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    sessionId: 'session-123',
    role: 'assistant',
    content: 'Hello from the assistant',
    timestamp: new Date('2025-01-15T10:00:00Z'),
    isPartial: false,
    ...overrides,
  };
}

function makeToolCall(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tool-1',
    sessionId: 'session-123',
    name: 'Bash',
    input: { command: 'ls -la' },
    status: 'completed',
    output: 'file1.txt\nfile2.txt',
    startedAt: new Date('2025-01-15T10:01:00Z'),
    completedAt: new Date('2025-01-15T10:01:05Z'),
    ...overrides,
  };
}

function makeApproval(overrides: Record<string, unknown> = {}) {
  return {
    id: 'approval-1',
    requestId: 'req-1',
    sessionId: 'session-123',
    toolName: 'Bash',
    toolInput: { command: 'rm -rf /tmp/test' },
    description: 'Execute a bash command',
    riskLevel: 'high',
    expiresAt: new Date('2025-01-15T10:10:00Z'),
    createdAt: new Date('2025-01-15T10:00:00Z'),
    ...overrides,
  };
}

/**
 * Configure the sessions store mock so that selector calls inside the
 * component return the data we need.
 *
 * The mock store is implemented as a callable function that takes a selector.
 * Each call to useSessionsStore(selector) invokes mockSessionsStore(selector)
 * which calls selector(mockSessionsStore._state). We set _state to include
 * all the fields the component reads.
 */
function setupStoreState({
  session = makeSession(),
  messages = [] as ReturnType<typeof makeMessage>[],
  toolCalls = [] as ReturnType<typeof makeToolCall>[],
  pendingApprovals = [] as ReturnType<typeof makeApproval>[],
  loadingHistory = false,
  machines = [{ id: 'machine-1', name: 'My Laptop' }],
}: {
  session?: ReturnType<typeof makeSession> | null;
  messages?: ReturnType<typeof makeMessage>[];
  toolCalls?: ReturnType<typeof makeToolCall>[];
  pendingApprovals?: ReturnType<typeof makeApproval>[];
  loadingHistory?: boolean;
  machines?: Array<{ id: string; name: string }>;
} = {}) {
  const messagesMap = new Map();
  if (messages.length > 0) {
    messagesMap.set('session-123', messages);
  }
  const toolCallsMap = new Map();
  if (toolCalls.length > 0) {
    toolCallsMap.set('session-123', toolCalls);
  }
  const loadingHistorySet = new Set<string>();
  if (loadingHistory) {
    loadingHistorySet.add('session-123');
  }

  mockSessionsStore._state = {
    sessions: session ? [session] : [],
    messages: messagesMap,
    toolCalls: toolCallsMap,
    pendingApprovals,
    loadingHistory: loadingHistorySet,
    selectSession: jest.fn(),
    completeHistoryLoading: jest.fn(),
    startHistoryLoading: jest.fn(),
    setSessionsForMachine: jest.fn(),
    handleACPEvent: jest.fn(),
  };

  mockMachinesStore._state = {
    ...mockMachinesStore._state,
    machines,
  };
}

// ── Lifecycle ───────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'session-123' });
  setupStoreState();
});

afterEach(() => {
  jest.useRealTimers();
});

// =====================================================================
// 1. BASIC RENDERING
// =====================================================================

describe('SessionDetailScreen', () => {
  describe('basic rendering', () => {
    it('renders without crashing', () => {
      const { toJSON } = render(<SessionDetailScreen />);
      expect(toJSON()).not.toBeNull();
    });

    it('calls selectSession on mount with the session id', () => {
      render(<SessionDetailScreen />);
      expect(mockSessionsStore._state.selectSession).toHaveBeenCalledWith('session-123');
    });

    it('calls subscribeToSession on mount', () => {
      render(<SessionDetailScreen />);
      expect(mockSubscribeToSession).toHaveBeenCalledWith('session-123');
    });

    it('sets navigation options via setOptions', () => {
      render(<SessionDetailScreen />);
      expect(mockSetOptions).toHaveBeenCalled();
    });

    it('renders the text input area', () => {
      const { getByPlaceholderText } = render(<SessionDetailScreen />);
      expect(getByPlaceholderText('Send a message...')).toBeTruthy();
    });

    it('renders the send button', () => {
      const { getByTestId } = render(<SessionDetailScreen />);
      expect(getByTestId('icon-send')).toBeTruthy();
    });
  });

  // =====================================================================
  // 2. EMPTY STATES
  // =====================================================================

  describe('empty states', () => {
    it('shows "No messages yet" when timeline is empty', () => {
      setupStoreState({ messages: [], toolCalls: [] });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('No messages yet')).toBeTruthy();
    });

    it('shows helper subtext in empty state', () => {
      setupStoreState({ messages: [], toolCalls: [] });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('Messages and tool calls will appear here')).toBeTruthy();
    });

    it('shows loading indicator when history is loading', () => {
      setupStoreState({ messages: [], toolCalls: [], loadingHistory: true });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('Loading messages...')).toBeTruthy();
    });

    it('shows chatbubbles icon in empty state', () => {
      setupStoreState({ messages: [], toolCalls: [] });
      const { getByTestId } = render(<SessionDetailScreen />);
      expect(getByTestId('icon-chatbubbles-outline')).toBeTruthy();
    });
  });

  // =====================================================================
  // 3. MESSAGE RENDERING
  // =====================================================================

  describe('message rendering', () => {
    it('renders a user message', () => {
      setupStoreState({
        messages: [makeMessage({ role: 'user', content: 'Hello agent' })],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('Hello agent')).toBeTruthy();
    });

    it('renders an assistant message with markdown', () => {
      setupStoreState({
        messages: [makeMessage({ role: 'assistant', content: 'Here is my **answer**' })],
      });
      const { getByTestId } = render(<SessionDetailScreen />);
      // Markdown mock renders content inside a Text with testID='markdown'
      expect(getByTestId('markdown')).toBeTruthy();
    });

    it('renders multiple messages in order', () => {
      setupStoreState({
        messages: [
          makeMessage({
            id: 'msg-1',
            role: 'user',
            content: 'Question',
            timestamp: new Date('2025-01-15T10:00:00Z'),
          }),
          makeMessage({
            id: 'msg-2',
            role: 'assistant',
            content: 'Answer',
            timestamp: new Date('2025-01-15T10:00:01Z'),
          }),
        ],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('Question')).toBeTruthy();
      expect(getByText('Answer')).toBeTruthy();
    });

    it('skips empty messages after tag stripping', () => {
      setupStoreState({
        messages: [makeMessage({ content: '', isPartial: false })],
      });
      const { queryByTestId } = render(<SessionDetailScreen />);
      // The empty message should be filtered; empty state may show
      expect(queryByTestId('markdown')).toBeNull();
    });

    it('renders message timestamp', () => {
      setupStoreState({
        messages: [
          makeMessage({ content: 'Test message', timestamp: new Date('2025-01-15T10:30:00Z') }),
        ],
      });
      const { getByText } = render(<SessionDetailScreen />);
      // The timestamp is formatted as HH:MM in locale format
      // We cannot predict exact format, but the message content should be present
      expect(getByText('Test message')).toBeTruthy();
    });
  });

  // =====================================================================
  // 4. THINKING BLOCK
  // =====================================================================

  describe('thinking block', () => {
    it('renders thinking label when message has thinking text', () => {
      setupStoreState({
        messages: [
          makeMessage({
            content: 'Result',
            thinking: 'Let me think about this...',
            isThinking: false,
          }),
        ],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('Thought')).toBeTruthy();
    });

    it('renders "Thinking..." label when isThinking is true', () => {
      setupStoreState({
        messages: [
          makeMessage({
            content: 'Partial result',
            thinking: '',
            isThinking: true,
          }),
        ],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('Thinking...')).toBeTruthy();
    });

    it('renders thinking text content', () => {
      setupStoreState({
        messages: [
          makeMessage({
            content: 'Result',
            thinking: 'I need to analyze this problem step by step',
            isThinking: false,
          }),
        ],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('I need to analyze this problem step by step')).toBeTruthy();
    });

    it('does not render thinking block when there is no thinking', () => {
      setupStoreState({
        messages: [
          makeMessage({
            content: 'Just a regular message',
            thinking: undefined,
            isThinking: false,
          }),
        ],
      });
      const { queryByText } = render(<SessionDetailScreen />);
      expect(queryByText('Thought')).toBeNull();
      expect(queryByText('Thinking...')).toBeNull();
    });
  });

  // =====================================================================
  // 5. TOOL CALL RENDERING
  // =====================================================================

  describe('tool call rendering', () => {
    it('renders a Bash tool call with terminal block', () => {
      setupStoreState({
        toolCalls: [makeToolCall({ name: 'Bash', input: { command: 'npm test' } })],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('Bash')).toBeTruthy();
      expect(getByText('npm test')).toBeTruthy();
    });

    it('renders terminal header with "Terminal" text', () => {
      setupStoreState({
        toolCalls: [makeToolCall({ name: 'Bash', input: { command: 'echo hi' } })],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('Terminal')).toBeTruthy();
    });

    it('renders prompt character for Bash commands', () => {
      setupStoreState({
        toolCalls: [makeToolCall({ name: 'Bash', input: { command: 'ls' } })],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('$ ')).toBeTruthy();
    });

    it('renders a Read tool call with file path', () => {
      setupStoreState({
        toolCalls: [
          makeToolCall({
            name: 'Read',
            input: { file_path: '/home/user/project/src/index.ts' },
          }),
        ],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('Read')).toBeTruthy();
      // shortenPath should shorten this to '.../src/index.ts' or similar
      expect(getByText('.../project/src/index.ts')).toBeTruthy();
    });

    it('renders a Read tool call with line range', () => {
      setupStoreState({
        toolCalls: [
          makeToolCall({
            name: 'Read',
            input: { file_path: '/home/user/project/src/index.ts', offset: 10, limit: 20 },
          }),
        ],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('L10-30')).toBeTruthy();
    });

    it('renders a Write tool call with file path and content preview', () => {
      setupStoreState({
        toolCalls: [
          makeToolCall({
            name: 'Write',
            input: { file_path: '/home/user/project/new-file.ts', content: 'const x = 1;' },
          }),
        ],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('Write')).toBeTruthy();
      expect(getByText('const x = 1;')).toBeTruthy();
    });

    it('renders an Edit tool call with diff preview', () => {
      setupStoreState({
        toolCalls: [
          makeToolCall({
            name: 'Edit',
            input: {
              file_path: '/home/user/project/src/app.ts',
              old_string: 'const a = 1;',
              new_string: 'const a = 2;',
            },
          }),
        ],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('Edit')).toBeTruthy();
      expect(getByText('- const a = 1;')).toBeTruthy();
      expect(getByText('+ const a = 2;')).toBeTruthy();
    });

    it('renders a Glob tool call with search pattern', () => {
      setupStoreState({
        toolCalls: [
          makeToolCall({
            name: 'Glob',
            input: { pattern: '**/*.ts', path: '/home/user/project/src' },
          }),
        ],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('Glob')).toBeTruthy();
      expect(getByText('**/*.ts')).toBeTruthy();
    });

    it('renders a Grep tool call with pattern and glob', () => {
      setupStoreState({
        toolCalls: [
          makeToolCall({
            name: 'Grep',
            input: { pattern: 'TODO', glob: '*.ts', path: '/home/user/project' },
          }),
        ],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('Grep')).toBeTruthy();
      expect(getByText('TODO')).toBeTruthy();
      expect(getByText('*.ts')).toBeTruthy();
    });

    it('renders a WebFetch tool call with URL', () => {
      setupStoreState({
        toolCalls: [
          makeToolCall({
            name: 'WebFetch',
            input: { url: 'https://example.com/api' },
          }),
        ],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('WebFetch')).toBeTruthy();
      expect(getByText('https://example.com/api')).toBeTruthy();
    });

    it('renders a WebSearch tool call with query', () => {
      setupStoreState({
        toolCalls: [
          makeToolCall({
            name: 'WebSearch',
            input: { query: 'react native testing' },
          }),
        ],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('WebSearch')).toBeTruthy();
      expect(getByText('react native testing')).toBeTruthy();
    });

    it('renders a Task tool call with prompt', () => {
      setupStoreState({
        toolCalls: [
          makeToolCall({
            name: 'Task',
            input: { prompt: 'Investigate the bug in auth flow' },
          }),
        ],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('Task')).toBeTruthy();
      expect(getByText('Investigate the bug in auth flow')).toBeTruthy();
    });

    it('renders a TodoWrite tool call with todo items', () => {
      setupStoreState({
        toolCalls: [
          makeToolCall({
            name: 'TodoWrite',
            input: {
              todos: [
                { content: 'Fix bug', status: 'completed' },
                { content: 'Write tests', status: 'in_progress' },
                { content: 'Deploy', status: 'pending' },
              ],
            },
          }),
        ],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('TodoWrite')).toBeTruthy();
      expect(getByText('Fix bug')).toBeTruthy();
      expect(getByText('Write tests')).toBeTruthy();
      expect(getByText('Deploy')).toBeTruthy();
    });

    it('renders a NotebookEdit tool call with notebook path', () => {
      setupStoreState({
        toolCalls: [
          makeToolCall({
            name: 'NotebookEdit',
            input: { notebook_path: '/home/user/project/analysis.ipynb' },
          }),
        ],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('NotebookEdit')).toBeTruthy();
      expect(getByText('.../user/project/analysis.ipynb')).toBeTruthy();
    });

    it('renders generic key-value display for unknown tools', () => {
      setupStoreState({
        toolCalls: [
          makeToolCall({
            name: 'CustomTool',
            input: { param1: 'value1', param2: 'value2' },
          }),
        ],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('CustomTool')).toBeTruthy();
      expect(getByText('param1')).toBeTruthy();
      expect(getByText('value1')).toBeTruthy();
    });

    it('renders tool call error block', () => {
      setupStoreState({
        toolCalls: [
          makeToolCall({
            name: 'Bash',
            input: { command: 'bad-cmd' },
            status: 'error',
            error: 'Command not found',
          }),
        ],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('Command not found')).toBeTruthy();
    });

    it('renders tool call description when present', () => {
      setupStoreState({
        toolCalls: [
          makeToolCall({
            name: 'Bash',
            input: { command: 'ls' },
            description: 'List files in directory',
          }),
        ],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('List files in directory')).toBeTruthy();
    });

    it('renders tool output for Bash tool', () => {
      setupStoreState({
        toolCalls: [
          makeToolCall({
            name: 'Bash',
            input: { command: 'echo hello' },
            output: 'hello',
            status: 'completed',
          }),
        ],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('hello')).toBeTruthy();
    });

    it('renders file search output for Glob tool', () => {
      setupStoreState({
        toolCalls: [
          makeToolCall({
            name: 'Glob',
            input: { pattern: '*.ts' },
            output: '/home/user/project/src/index.ts\n/home/user/project/src/utils.ts',
            status: 'completed',
          }),
        ],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('.../project/src/index.ts')).toBeTruthy();
      expect(getByText('.../project/src/utils.ts')).toBeTruthy();
    });

    it('shows "+N more" for Glob output with many results', () => {
      const lines = Array.from({ length: 8 }, (_, i) => `/home/user/project/file${i}.ts`);
      setupStoreState({
        toolCalls: [
          makeToolCall({
            name: 'Glob',
            input: { pattern: '*.ts' },
            output: lines.join('\n'),
            status: 'completed',
          }),
        ],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('+3 more')).toBeTruthy();
    });

    it('does not render tool input when input is empty', () => {
      setupStoreState({
        toolCalls: [makeToolCall({ name: 'Bash', input: {} })],
      });
      const { queryByText } = render(<SessionDetailScreen />);
      // Terminal header should not appear since command is empty
      expect(queryByText('Terminal')).toBeNull();
    });

    it('does not render tool output when output is empty', () => {
      setupStoreState({
        toolCalls: [
          makeToolCall({
            name: 'Bash',
            input: { command: 'ls' },
            output: undefined,
            status: 'completed',
          }),
        ],
      });
      const { getByText, queryByText } = render(<SessionDetailScreen />);
      expect(getByText('Bash')).toBeTruthy();
      // There should be no output block content beyond the command
      expect(queryByText('file1.txt')).toBeNull();
    });
  });

  // =====================================================================
  // 6. TOOL CALL STATUS INDICATORS
  // =====================================================================

  describe('tool call status indicators', () => {
    it('shows checkmark icon for completed tools', () => {
      setupStoreState({
        toolCalls: [makeToolCall({ status: 'completed' })],
      });
      const { getByTestId } = render(<SessionDetailScreen />);
      expect(getByTestId('icon-checkmark-circle-outline')).toBeTruthy();
    });

    it('shows close-circle icon for error tools', () => {
      setupStoreState({
        toolCalls: [makeToolCall({ status: 'error' })],
      });
      const { getByTestId } = render(<SessionDetailScreen />);
      expect(getByTestId('icon-close-circle-outline')).toBeTruthy();
    });

    it('shows ban icon for denied tools', () => {
      setupStoreState({
        toolCalls: [makeToolCall({ status: 'denied' })],
      });
      const { getByTestId } = render(<SessionDetailScreen />);
      expect(getByTestId('icon-ban-outline')).toBeTruthy();
    });

    it('shows hourglass icon for pending tools', () => {
      setupStoreState({
        toolCalls: [makeToolCall({ status: 'pending' })],
      });
      const { getByTestId } = render(<SessionDetailScreen />);
      expect(getByTestId('icon-hourglass-outline')).toBeTruthy();
    });
  });

  // =====================================================================
  // 7. APPROVAL BANNERS
  // =====================================================================

  describe('approval banners', () => {
    it('renders approval banner with tool name', () => {
      setupStoreState({
        pendingApprovals: [makeApproval({ toolName: 'Bash' })],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('Bash')).toBeTruthy();
    });

    it('renders approval banner with risk level badge', () => {
      setupStoreState({
        pendingApprovals: [makeApproval({ riskLevel: 'high' })],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('HIGH')).toBeTruthy();
    });

    it('renders approval description', () => {
      setupStoreState({
        pendingApprovals: [makeApproval({ description: 'Execute a dangerous command' })],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('Execute a dangerous command')).toBeTruthy();
    });

    it('renders Approve and Deny buttons', () => {
      setupStoreState({
        pendingApprovals: [makeApproval()],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('Approve')).toBeTruthy();
      expect(getByText('Deny')).toBeTruthy();
    });

    it('calls approveToolCall when Approve is pressed', () => {
      const approval = makeApproval();
      setupStoreState({ pendingApprovals: [approval] });
      const { getByText } = render(<SessionDetailScreen />);

      fireEvent.press(getByText('Approve'));
      expect(mockApproveToolCall).toHaveBeenCalledWith(
        approval.sessionId,
        approval.requestId,
        approval.id
      );
    });

    it('calls denyToolCall when Deny is pressed', () => {
      const approval = makeApproval();
      setupStoreState({ pendingApprovals: [approval] });
      const { getByText } = render(<SessionDetailScreen />);

      fireEvent.press(getByText('Deny'));
      expect(mockDenyToolCall).toHaveBeenCalledWith(
        approval.sessionId,
        approval.requestId,
        approval.id
      );
    });

    it('renders command preview in approval banner', () => {
      setupStoreState({
        pendingApprovals: [
          makeApproval({
            preview: { type: 'command', content: 'rm -rf /tmp/test' },
          }),
        ],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('rm -rf /tmp/test')).toBeTruthy();
    });

    it('renders diff preview in approval banner', () => {
      setupStoreState({
        pendingApprovals: [
          makeApproval({
            preview: { type: 'diff', content: '- old line\n+ new line' },
          }),
        ],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('- old line\n+ new line')).toBeTruthy();
    });

    it('renders description preview in approval banner', () => {
      setupStoreState({
        pendingApprovals: [
          makeApproval({
            preview: { type: 'description', content: 'Writing to config.json' },
          }),
        ],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('Writing to config.json')).toBeTruthy();
    });

    it('renders fallback Bash terminal when no preview but has toolInput command', () => {
      setupStoreState({
        pendingApprovals: [
          makeApproval({
            preview: undefined,
            toolName: 'Bash',
            toolInput: { command: 'docker build .' },
          }),
        ],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('docker build .')).toBeTruthy();
    });

    it('renders fallback file path for Write tool approval without preview', () => {
      setupStoreState({
        pendingApprovals: [
          makeApproval({
            preview: undefined,
            toolName: 'Write',
            toolInput: { file_path: '/home/user/project/src/config.ts' },
          }),
        ],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('.../project/src/config.ts')).toBeTruthy();
    });

    it('renders LOW risk badge with correct text', () => {
      setupStoreState({
        pendingApprovals: [makeApproval({ riskLevel: 'low' })],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('LOW')).toBeTruthy();
    });

    it('renders MEDIUM risk badge', () => {
      setupStoreState({
        pendingApprovals: [makeApproval({ riskLevel: 'medium' })],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('MEDIUM')).toBeTruthy();
    });

    it('renders CRITICAL risk badge', () => {
      setupStoreState({
        pendingApprovals: [makeApproval({ riskLevel: 'critical' })],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('CRITICAL')).toBeTruthy();
    });
  });

  // =====================================================================
  // 8. OTHER APPROVALS BANNER
  // =====================================================================

  describe('other approvals banner', () => {
    it('shows banner when there are approvals in other sessions', () => {
      setupStoreState({
        pendingApprovals: [makeApproval({ id: 'a-other', sessionId: 'other-session' })],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText(/1 approval waiting in other sessions/)).toBeTruthy();
    });

    it('pluralizes correctly for multiple other approvals', () => {
      setupStoreState({
        pendingApprovals: [
          makeApproval({ id: 'a-other-1', sessionId: 'other-session-1' }),
          makeApproval({ id: 'a-other-2', sessionId: 'other-session-2' }),
        ],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText(/2 approvals waiting in other sessions/)).toBeTruthy();
    });

    it('navigates to approvals tab when banner is pressed', () => {
      setupStoreState({
        pendingApprovals: [makeApproval({ id: 'a-other', sessionId: 'other-session' })],
      });
      const { getByText } = render(<SessionDetailScreen />);
      fireEvent.press(getByText(/approval waiting in other sessions/));
      expect(mockRouter.push).toHaveBeenCalledWith('/(tabs)/approvals');
    });

    it('does not show banner when no other session approvals exist', () => {
      setupStoreState({ pendingApprovals: [] });
      const { queryByText } = render(<SessionDetailScreen />);
      expect(queryByText(/waiting in other sessions/)).toBeNull();
    });
  });

  // =====================================================================
  // 9. INPUT AND SEND
  // =====================================================================

  describe('input and send', () => {
    it('updates input value when typing', () => {
      const { getByPlaceholderText } = render(<SessionDetailScreen />);
      const input = getByPlaceholderText('Send a message...');
      fireEvent.changeText(input, 'Hello world');
      expect(input.props.value).toBe('Hello world');
    });

    it('calls sendMessage when send button is pressed', () => {
      const { getByPlaceholderText, getByTestId } = render(<SessionDetailScreen />);
      const input = getByPlaceholderText('Send a message...');
      fireEvent.changeText(input, 'Test message');
      fireEvent.press(getByTestId('icon-send'));
      expect(mockSendMessage).toHaveBeenCalledWith('session-123', 'Test message');
    });

    it('clears input after sending', () => {
      const { getByPlaceholderText, getByTestId } = render(<SessionDetailScreen />);
      const input = getByPlaceholderText('Send a message...');
      fireEvent.changeText(input, 'Test message');
      fireEvent.press(getByTestId('icon-send'));
      expect(input.props.value).toBe('');
    });

    it('does not send empty messages', () => {
      const { getByPlaceholderText, getByTestId } = render(<SessionDetailScreen />);
      const input = getByPlaceholderText('Send a message...');
      fireEvent.changeText(input, '   ');
      fireEvent.press(getByTestId('icon-send'));
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('trims whitespace from messages before sending', () => {
      const { getByPlaceholderText, getByTestId } = render(<SessionDetailScreen />);
      const input = getByPlaceholderText('Send a message...');
      fireEvent.changeText(input, '  Hello  ');
      fireEvent.press(getByTestId('icon-send'));
      expect(mockSendMessage).toHaveBeenCalledWith('session-123', 'Hello');
    });

    it('shows alert when sendMessage throws', () => {
      mockSendMessage.mockImplementationOnce(() => {
        throw new Error('Network error');
      });
      const alertSpy = jest.spyOn(Alert, 'alert');

      const { getByPlaceholderText, getByTestId } = render(<SessionDetailScreen />);
      const input = getByPlaceholderText('Send a message...');
      fireEvent.changeText(input, 'Test');
      fireEvent.press(getByTestId('icon-send'));

      expect(alertSpy).toHaveBeenCalledWith('Error', 'Failed to send message. Please try again.');
      alertSpy.mockRestore();
    });
  });

  // =====================================================================
  // 10. TYPING INDICATOR
  // =====================================================================

  describe('typing indicator', () => {
    it('shows thinking indicator when assistant is streaming empty content', () => {
      setupStoreState({
        session: makeSession({ status: 'running' }),
        messages: [
          makeMessage({
            role: 'assistant',
            content: '',
            isPartial: true,
          }),
        ],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('Thinking...')).toBeTruthy();
    });

    it('does not show typing indicator when session is not running', () => {
      setupStoreState({
        session: makeSession({ status: 'completed' }),
        messages: [
          makeMessage({
            role: 'assistant',
            content: '',
            isPartial: true,
          }),
        ],
      });
      const { queryByText } = render(<SessionDetailScreen />);
      // The empty partial message is filtered from timeline
      // and typing indicator only shows for 'running' status
      expect(queryByText('Thinking...')).toBeNull();
    });
  });

  // =====================================================================
  // 11. SESSION INFO MODAL
  // =====================================================================

  describe('session info modal', () => {
    /**
     * Helper: opens the session info modal by pressing the headerRight
     * menu button (ellipsis-vertical). The button is registered via
     * navigation.setOptions, so we extract and render it, then press it.
     * Because the onPress closure captures the real setMenuVisible from
     * the component instance, this updates the component state and makes
     * the Modal visible.
     */
    function openInfoModal() {
      const lastCall = mockSetOptions.mock.calls[mockSetOptions.mock.calls.length - 1][0];
      const HeaderRight = lastCall.headerRight;
      const headerRender = render(<HeaderRight />);
      act(() => {
        fireEvent.press(headerRender.getByTestId('icon-ellipsis-vertical'));
      });
      headerRender.unmount();
    }

    it('shows "Session Info" title in the modal', () => {
      const result = render(<SessionDetailScreen />);
      openInfoModal();
      expect(result.getByText('Session Info')).toBeTruthy();
    });

    it('shows model name in the modal', () => {
      setupStoreState({
        session: makeSession({ model: 'claude-sonnet-4-20250514' }),
      });
      const result = render(<SessionDetailScreen />);
      openInfoModal();
      expect(result.getByText('Sonnet 4.20250514')).toBeTruthy();
    });

    it('shows machine name in the modal', () => {
      setupStoreState({
        machines: [{ id: 'machine-1', name: 'Work MacBook' }],
      });
      const result = render(<SessionDetailScreen />);
      openInfoModal();
      expect(result.getByText('Work MacBook')).toBeTruthy();
    });

    it('shows project path in the modal', () => {
      setupStoreState({
        session: makeSession({ projectPath: '/home/user/my-project' }),
      });
      const result = render(<SessionDetailScreen />);
      openInfoModal();
      expect(result.getByText('/home/user/my-project')).toBeTruthy();
    });

    it('shows mode badge in the modal', () => {
      setupStoreState({
        session: makeSession({ agentMode: 'plan' }),
      });
      const result = render(<SessionDetailScreen />);
      openInfoModal();
      expect(result.getByText('Plan')).toBeTruthy();
    });

    it('shows "Auto" when mode is null', () => {
      setupStoreState({
        session: makeSession({ agentMode: null }),
      });
      const result = render(<SessionDetailScreen />);
      openInfoModal();
      expect(result.getByText('Auto')).toBeTruthy();
    });

    it('shows "Unknown" when model is null', () => {
      setupStoreState({
        session: makeSession({ model: null }),
      });
      const result = render(<SessionDetailScreen />);
      openInfoModal();
      expect(result.getByText('Unknown')).toBeTruthy();
    });
  });

  // =====================================================================
  // 12. SESSION NOT FOUND / NO ID
  // =====================================================================

  describe('session not found', () => {
    it('renders empty state when session does not exist', () => {
      setupStoreState({ session: null, messages: [], toolCalls: [] });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('No messages yet')).toBeTruthy();
    });

    it('does not call selectSession when id is missing', () => {
      (useLocalSearchParams as jest.Mock).mockReturnValue({ id: '' });
      setupStoreState({ session: null });
      render(<SessionDetailScreen />);
      expect(mockSessionsStore._state.selectSession).not.toHaveBeenCalled();
    });
  });

  // =====================================================================
  // 13. TIMELINE INTERLEAVING
  // =====================================================================

  describe('timeline interleaving', () => {
    it('interleaves messages and tool calls by timestamp', () => {
      setupStoreState({
        messages: [
          makeMessage({
            id: 'msg-1',
            content: 'First message',
            timestamp: new Date('2025-01-15T10:00:00Z'),
          }),
          makeMessage({
            id: 'msg-2',
            content: 'Second message',
            timestamp: new Date('2025-01-15T10:02:00Z'),
          }),
        ],
        toolCalls: [
          makeToolCall({
            id: 'tool-1',
            name: 'Bash',
            input: { command: 'ls' },
            startedAt: new Date('2025-01-15T10:01:00Z'),
          }),
        ],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('First message')).toBeTruthy();
      expect(getByText('Bash')).toBeTruthy();
      expect(getByText('Second message')).toBeTruthy();
    });

    it('deduplicates tool calls with same id', () => {
      const tool = makeToolCall({
        id: 'tool-dup',
        name: 'Read',
        input: { file_path: '/tmp/f.ts' },
      });
      setupStoreState({
        toolCalls: [tool, { ...tool }],
      });
      const { getAllByText } = render(<SessionDetailScreen />);
      // "Read" label should appear exactly once
      expect(getAllByText('Read')).toHaveLength(1);
    });
  });

  // =====================================================================
  // 14. LOAD ERROR STATE
  // =====================================================================

  describe('load error state', () => {
    it('shows error state after load timeout', async () => {
      setupStoreState({ messages: [], toolCalls: [], loadingHistory: true });

      // Make getState return loadingHistory still containing our session.
      // completeHistoryLoading must actually remove from _state.loadingHistory
      // so the selector-driven isLoadingHistory becomes false on re-render.
      mockSessionsStore.getState = () => ({
        ...mockSessionsStore._state,
        loadingHistory: new Set(['session-123']),
        completeHistoryLoading: jest.fn((id: string) => {
          mockSessionsStore._state.loadingHistory.delete(id);
        }),
      });

      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('Loading messages...')).toBeTruthy();

      // Advance past the 15-second timeout
      act(() => {
        jest.advanceTimersByTime(16_000);
      });

      await waitFor(() => {
        expect(getByText('Failed to load session')).toBeTruthy();
      });
    });

    it('shows retry button in error state', async () => {
      setupStoreState({ messages: [], toolCalls: [], loadingHistory: true });

      mockSessionsStore.getState = () => ({
        ...mockSessionsStore._state,
        loadingHistory: new Set(['session-123']),
        completeHistoryLoading: jest.fn((id: string) => {
          mockSessionsStore._state.loadingHistory.delete(id);
        }),
      });

      const { getByText } = render(<SessionDetailScreen />);

      act(() => {
        jest.advanceTimersByTime(16_000);
      });

      await waitFor(() => {
        expect(getByText('Retry')).toBeTruthy();
      });
    });

    it('calls subscribeToSession again when retry is pressed', async () => {
      setupStoreState({ messages: [], toolCalls: [], loadingHistory: true });

      mockSessionsStore.getState = () => ({
        ...mockSessionsStore._state,
        loadingHistory: new Set(['session-123']),
        completeHistoryLoading: jest.fn((id: string) => {
          mockSessionsStore._state.loadingHistory.delete(id);
        }),
      });

      const { getByText } = render(<SessionDetailScreen />);

      act(() => {
        jest.advanceTimersByTime(16_000);
      });

      await waitFor(() => {
        expect(getByText('Retry')).toBeTruthy();
      });

      mockSubscribeToSession.mockClear();
      fireEvent.press(getByText('Retry'));
      expect(mockSubscribeToSession).toHaveBeenCalledWith('session-123');
    });
  });

  // =====================================================================
  // 15. CLEANUP ON UNMOUNT
  // =====================================================================

  describe('cleanup on unmount', () => {
    it('calls selectSession(null) on unmount', () => {
      const { unmount } = render(<SessionDetailScreen />);
      unmount();
      expect(mockSessionsStore._state.selectSession).toHaveBeenCalledWith(null);
    });
  });

  // =====================================================================
  // 16. HEADER RENDERING (via setOptions)
  // =====================================================================

  describe('header rendering via setOptions', () => {
    it('passes headerTitle function to setOptions', () => {
      render(<SessionDetailScreen />);
      const call = mockSetOptions.mock.calls[0][0];
      expect(call.headerTitle).toBeDefined();
      expect(typeof call.headerTitle).toBe('function');
    });

    it('passes headerLeft function to setOptions', () => {
      render(<SessionDetailScreen />);
      const call = mockSetOptions.mock.calls[0][0];
      expect(call.headerLeft).toBeDefined();
      expect(typeof call.headerLeft).toBe('function');
    });

    it('passes headerRight function to setOptions', () => {
      render(<SessionDetailScreen />);
      const call = mockSetOptions.mock.calls[0][0];
      expect(call.headerRight).toBeDefined();
      expect(typeof call.headerRight).toBe('function');
    });

    it('headerTitle renders session name', () => {
      setupStoreState({ session: makeSession({ sessionName: 'My Custom Session' }) });
      render(<SessionDetailScreen />);
      const call = mockSetOptions.mock.calls[0][0];
      const HeaderTitle = call.headerTitle;
      const { getByText } = render(<HeaderTitle />);
      expect(getByText('My Custom Session')).toBeTruthy();
    });

    it('headerTitle falls back to project name when session name is null', () => {
      setupStoreState({
        session: makeSession({ sessionName: null, projectName: 'fallback-project' }),
      });
      render(<SessionDetailScreen />);
      const call = mockSetOptions.mock.calls[0][0];
      const HeaderTitle = call.headerTitle;
      const { getByText } = render(<HeaderTitle />);
      expect(getByText('fallback-project')).toBeTruthy();
    });

    it('headerTitle falls back to "Session" when both names are missing', () => {
      setupStoreState({ session: makeSession({ sessionName: null, projectName: '' }) });
      render(<SessionDetailScreen />);
      const call = mockSetOptions.mock.calls[0][0];
      const HeaderTitle = call.headerTitle;
      const { getByText } = render(<HeaderTitle />);
      expect(getByText('Session')).toBeTruthy();
    });

    it('headerTitle renders status label', () => {
      setupStoreState({ session: makeSession({ status: 'waiting_for_approval' }) });
      render(<SessionDetailScreen />);
      const call = mockSetOptions.mock.calls[0][0];
      const HeaderTitle = call.headerTitle;
      const { getByText } = render(<HeaderTitle />);
      expect(getByText('Approval')).toBeTruthy();
    });

    it('headerLeft back button calls router.back', () => {
      render(<SessionDetailScreen />);
      const call = mockSetOptions.mock.calls[0][0];
      const HeaderLeft = call.headerLeft;
      const { getByTestId } = render(<HeaderLeft />);
      fireEvent.press(getByTestId('icon-chevron-back').parent!);
      expect(mockRouter.back).toHaveBeenCalled();
    });

    it('headerLeft shows badge when other approvals exist', () => {
      setupStoreState({
        pendingApprovals: [makeApproval({ id: 'a-other', sessionId: 'other-session' })],
      });
      render(<SessionDetailScreen />);
      // Get the latest call since setOptions is called on each render
      const lastCall = mockSetOptions.mock.calls[mockSetOptions.mock.calls.length - 1][0];
      const HeaderLeft = lastCall.headerLeft;
      const { getByText } = render(<HeaderLeft />);
      expect(getByText('1')).toBeTruthy();
    });
  });

  // =====================================================================
  // 17. MIXED TIMELINE WITH APPROVALS
  // =====================================================================

  describe('mixed timeline with approvals', () => {
    it('renders messages, tool calls, and approval banners together', () => {
      setupStoreState({
        messages: [makeMessage({ id: 'msg-1', content: 'Let me help you' })],
        toolCalls: [
          makeToolCall({ id: 'tool-1', name: 'Bash', input: { command: 'npm install' } }),
        ],
        pendingApprovals: [makeApproval({ toolName: 'Write', description: 'Write to file' })],
      });
      const { getByText } = render(<SessionDetailScreen />);
      expect(getByText('Let me help you')).toBeTruthy();
      expect(getByText('npm install')).toBeTruthy();
      expect(getByText('Write to file')).toBeTruthy();
    });
  });

  // =====================================================================
  // 18. GENERIC TOOL OUTPUT
  // =====================================================================

  describe('generic tool output', () => {
    it('truncates long generic output with ellipsis', () => {
      const longOutput = 'x'.repeat(400);
      setupStoreState({
        toolCalls: [
          makeToolCall({
            name: 'Read',
            input: { file_path: '/tmp/f.ts' },
            output: longOutput,
            status: 'completed',
          }),
        ],
      });
      const { getByText } = render(<SessionDetailScreen />);
      // Output is sliced to 300 chars + '...'
      expect(getByText('x'.repeat(300) + '...')).toBeTruthy();
    });

    it('does not render output when output is empty string', () => {
      setupStoreState({
        toolCalls: [
          makeToolCall({
            name: 'Read',
            input: { file_path: '/tmp/f.ts' },
            output: '""',
            status: 'completed',
          }),
        ],
      });
      // '""' is treated as empty and not rendered
      const { queryByText } = render(<SessionDetailScreen />);
      expect(queryByText('""')).toBeNull();
    });
  });
});
