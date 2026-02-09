/**
 * Session detail screen - shows messages, tool calls, and allows interaction
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Modal,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter, useNavigation } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import {
  useSessionsStore,
  useMachinesStore,
  stripSystemTags,
  type AgentMessage,
  type ToolCall,
  type ApprovalRequest,
} from '@agentap-dev/shared';
import Markdown from 'react-native-markdown-display';
import { useWebSocketContext } from '../../components/WebSocketProvider';
import { Colors } from '../../constants/Colors';

const EMPTY_MESSAGES: AgentMessage[] = [];
const EMPTY_TOOL_CALLS: ToolCall[] = [];

const TOOL_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Bash: 'terminal-outline',
  Write: 'document-text-outline',
  Edit: 'create-outline',
  NotebookEdit: 'book-outline',
  Read: 'eye-outline',
  Glob: 'search-outline',
  Grep: 'search-outline',
  WebFetch: 'globe-outline',
  WebSearch: 'globe-outline',
  Task: 'git-branch-outline',
  TodoWrite: 'list-outline',
  Skill: 'flash-outline',
  AskUserQuestion: 'help-circle-outline',
  EnterPlanMode: 'map-outline',
  ExitPlanMode: 'checkmark-done-outline',
};

function formatModelName(modelId: string | null | undefined): string {
  if (!modelId) return 'Unknown';
  const match = modelId.match(/claude-(\w+)-(\d+)-(\d+)/);
  if (match) {
    const name = match[1].charAt(0).toUpperCase() + match[1].slice(1);
    return `${name} ${match[2]}.${match[3]}`;
  }
  return modelId;
}

function formatMode(mode: string | null | undefined): string {
  if (!mode) return 'Auto';
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

const STATUS_LABELS: Record<string, string> = {
  starting: 'Starting',
  running: 'Running',
  thinking: 'Thinking',
  waiting_for_input: 'Waiting',
  waiting_for_approval: 'Approval',
  paused: 'Paused',
  idle: 'Idle',
  completed: 'Completed',
  error: 'Error',
};

function shortenPath(path: string): string {
  const parts = path.split('/');
  if (parts.length <= 3) return path;
  return '.../' + parts.slice(-3).join('/');
}

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const listRef = useRef<FlatList>(null);
  const isNearBottomRef = useRef(true);
  const [inputText, setInputText] = useState('');
  const [menuVisible, setMenuVisible] = useState(false);
  const [approvalProcessing, setApprovalProcessing] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState(false);
  const { sendMessage, subscribeToSession, approveToolCall, denyToolCall } = useWebSocketContext();

  const sessionId = id || '';
  const session = useSessionsStore(
    useCallback((s) => s.sessions.find((sess) => sess.id === sessionId), [sessionId])
  );
  const selectSession = useSessionsStore((s) => s.selectSession);
  const messages =
    useSessionsStore(useCallback((s) => s.messages.get(sessionId), [sessionId])) ?? EMPTY_MESSAGES;
  const toolCalls =
    useSessionsStore(useCallback((s) => s.toolCalls.get(sessionId), [sessionId])) ??
    EMPTY_TOOL_CALLS;
  const isLoadingHistory = useSessionsStore(
    useCallback((s) => s.loadingHistory.has(sessionId), [sessionId])
  );
  const allApprovals = useSessionsStore((s) => s.pendingApprovals);
  const pendingApprovals = useMemo(
    () => allApprovals.filter((a) => a.sessionId === sessionId),
    [allApprovals, sessionId]
  );
  const otherApprovalCount = useMemo(
    () => allApprovals.filter((a) => a.sessionId !== sessionId).length,
    [allApprovals, sessionId]
  );

  const machine = useMachinesStore(
    useCallback((s) => s.machines.find((m) => m.id === session?.machineId), [session?.machineId])
  );

  // Set active session on mount and subscribe to get history
  useEffect(() => {
    if (!id) return;

    selectSession(id);
    setLoadError(false);
    subscribeToSession(id);

    // Timeout: if history hasn't loaded within 15 seconds, show error
    const timeout = setTimeout(() => {
      const stillLoading = useSessionsStore.getState().loadingHistory.has(id);
      if (stillLoading) {
        useSessionsStore.getState().completeHistoryLoading(id);
        setLoadError(true);
      }
    }, 15_000);

    return () => {
      clearTimeout(timeout);
      selectSession(null);
      setApprovalProcessing(new Set());
    };
  }, [id, selectSession, subscribeToSession]);

  // Set dynamic header options
  useLayoutEffect(() => {
    const statusColor = (() => {
      switch (session?.status) {
        case 'running':
          return Colors.success;
        case 'waiting_for_approval':
          return Colors.warning;
        case 'error':
          return Colors.error;
        default:
          return Colors.textMuted;
      }
    })();

    const cleanedName = session?.sessionName ? stripSystemTags(session.sessionName) : '';
    const displayTitle = cleanedName || session?.projectName || 'Session';

    navigation.setOptions({
      headerTitle: () => (
        <View style={styles.headerTitle}>
          <Text style={styles.headerTitleText} numberOfLines={1}>
            {displayTitle}
          </Text>
          <View style={styles.headerSubtitle}>
            <Text style={styles.headerSubtitleText} numberOfLines={1}>
              {session?.projectName} · {session?.agent}
            </Text>
            <View style={styles.statusBadge}>
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <Text style={styles.statusText}>
                {STATUS_LABELS[session?.status || ''] || 'Unknown'}
              </Text>
            </View>
          </View>
        </View>
      ),
      headerLeft: () => (
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBack}>
          <Ionicons name="chevron-back" size={24} color={Colors.textSecondary} />
          {otherApprovalCount > 0 && (
            <View style={styles.backBadge}>
              <Text style={styles.backBadgeText}>{otherApprovalCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      ),
      headerRight: () => (
        <TouchableOpacity onPress={() => setMenuVisible(true)} style={styles.headerMenuButton}>
          <Ionicons name="ellipsis-vertical" size={20} color={Colors.textSecondary} />
        </TouchableOpacity>
      ),
    });
  }, [
    navigation,
    session?.sessionName,
    session?.projectName,
    session?.status,
    machine?.name,
    router,
    otherApprovalCount,
  ]);

  // Track whether user has scrolled away from bottom
  const handleScroll = useCallback(
    (e: {
      nativeEvent: {
        contentOffset: { y: number };
        layoutMeasurement: { height: number };
        contentSize: { height: number };
      };
    }) => {
      const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
      const distanceFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
      isNearBottomRef.current = distanceFromBottom < 80;
    },
    []
  );

  // Auto-scroll to bottom only when user is already near bottom
  const handleContentSizeChange = useCallback(() => {
    if (isNearBottomRef.current) {
      listRef.current?.scrollToEnd({ animated: false });
    }
  }, []);

  const handleRetryLoad = useCallback(() => {
    if (!id) return;
    setLoadError(false);
    subscribeToSession(id);
  }, [id, subscribeToSession]);

  const handleSend = () => {
    if (!inputText.trim() || !id) return;
    const message = inputText.trim();
    setInputText('');
    try {
      sendMessage(id, message);
    } catch {
      Alert.alert('Error', 'Failed to send message. Please try again.');
    }
  };

  const handleApprove = (request: ApprovalRequest) => {
    setApprovalProcessing((prev) => new Set(prev).add(request.id));
    approveToolCall(request.sessionId, request.requestId, request.id);
    setTimeout(() => {
      setApprovalProcessing((prev) => {
        const next = new Set(prev);
        next.delete(request.id);
        return next;
      });
    }, 5000);
  };

  const handleDeny = (request: ApprovalRequest) => {
    setApprovalProcessing((prev) => new Set(prev).add(request.id));
    denyToolCall(request.sessionId, request.requestId, request.id);
    setTimeout(() => {
      setApprovalProcessing((prev) => {
        const next = new Set(prev);
        next.delete(request.id);
        return next;
      });
    }, 5000);
  };

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'critical':
      case 'high':
        return Colors.error;
      case 'medium':
        return Colors.warning;
      case 'low':
        return Colors.success;
      default:
        return Colors.textMuted;
    }
  };

  // --- Tool-specific renderers ---

  const renderToolInput = (tool: ToolCall) => {
    const input = tool.input;
    if (!input || Object.keys(input).length === 0) return null;

    switch (tool.name) {
      case 'Bash': {
        const command = String(input.command || '');
        if (!command) return null;
        return (
          <View style={styles.terminalBlock}>
            <View style={styles.terminalHeader}>
              <View style={styles.terminalDots}>
                <View style={[styles.dot, { backgroundColor: '#ff5f57' }]} />
                <View style={[styles.dot, { backgroundColor: '#febc2e' }]} />
                <View style={[styles.dot, { backgroundColor: '#28c840' }]} />
              </View>
              <Text style={styles.terminalTitle}>Terminal</Text>
            </View>
            <View style={styles.terminalBody}>
              <Text style={styles.promptChar}>$ </Text>
              <Text style={styles.commandText} numberOfLines={6}>
                {command}
              </Text>
            </View>
          </View>
        );
      }

      case 'Read': {
        const filePath = String(input.file_path || '');
        const offset = input.offset ? Number(input.offset) : 0;
        const limit = input.limit ? Number(input.limit) : 0;
        return (
          <View style={styles.filePathBlock}>
            <Ionicons name="eye-outline" size={14} color={Colors.primaryLight} />
            <Text style={styles.filePathText} numberOfLines={1}>
              {shortenPath(filePath)}
            </Text>
            {offset > 0 && (
              <Text style={styles.fileRangeText}>
                L{offset}
                {limit ? `-${offset + limit}` : ''}
              </Text>
            )}
          </View>
        );
      }

      case 'Write': {
        const filePath = String(input.file_path || '');
        const content = String(input.content || '');
        return (
          <View>
            <View style={styles.filePathBlock}>
              <Ionicons name="document-text-outline" size={14} color={Colors.primaryLight} />
              <Text style={styles.filePathText} numberOfLines={1}>
                {shortenPath(filePath)}
              </Text>
            </View>
            {content && (
              <View style={styles.codePreview}>
                <Text style={styles.codePreviewText} numberOfLines={4}>
                  {content.slice(0, 300)}
                </Text>
              </View>
            )}
          </View>
        );
      }

      case 'Edit': {
        const filePath = String(input.file_path || '');
        const oldStr = String(input.old_string || '');
        const newStr = String(input.new_string || '');
        return (
          <View>
            <View style={styles.filePathBlock}>
              <Ionicons name="create-outline" size={14} color={Colors.primaryLight} />
              <Text style={styles.filePathText} numberOfLines={1}>
                {shortenPath(filePath)}
              </Text>
            </View>
            {(oldStr || newStr) && (
              <View style={styles.diffBlock}>
                {oldStr ? (
                  <Text style={styles.diffRemoved} numberOfLines={3}>
                    - {oldStr.slice(0, 200)}
                  </Text>
                ) : null}
                {newStr ? (
                  <Text style={styles.diffAdded} numberOfLines={3}>
                    + {newStr.slice(0, 200)}
                  </Text>
                ) : null}
              </View>
            )}
          </View>
        );
      }

      case 'Glob': {
        const pattern = String(input.pattern || '');
        const path = input.path ? String(input.path) : '';
        return (
          <View style={styles.searchBlock}>
            <Ionicons name="search-outline" size={14} color={Colors.primaryLight} />
            <Text style={styles.searchPattern}>{pattern}</Text>
            {path ? <Text style={styles.searchPath}>in {shortenPath(path)}</Text> : null}
          </View>
        );
      }

      case 'Grep': {
        const pattern = String(input.pattern || '');
        const path = input.path ? String(input.path) : '';
        const glob = input.glob ? String(input.glob) : '';
        return (
          <View style={styles.searchBlock}>
            <Ionicons name="search-outline" size={14} color={Colors.primaryLight} />
            <Text style={styles.searchPattern}>{pattern}</Text>
            {glob ? <Text style={styles.searchPath}>{glob}</Text> : null}
            {path ? <Text style={styles.searchPath}>in {shortenPath(path)}</Text> : null}
          </View>
        );
      }

      case 'WebFetch': {
        const url = String(input.url || '');
        return (
          <View style={styles.searchBlock}>
            <Ionicons name="globe-outline" size={14} color={Colors.primaryLight} />
            <Text style={styles.searchPattern} numberOfLines={1}>
              {url}
            </Text>
          </View>
        );
      }

      case 'WebSearch': {
        const query = String(input.query || '');
        return (
          <View style={styles.searchBlock}>
            <Ionicons name="globe-outline" size={14} color={Colors.primaryLight} />
            <Text style={styles.searchPattern} numberOfLines={1}>
              {query}
            </Text>
          </View>
        );
      }

      case 'Task': {
        const prompt = String(input.prompt || input.description || '');
        return prompt ? (
          <View style={styles.taskBlock}>
            <Ionicons name="git-branch-outline" size={14} color={Colors.primaryLight} />
            <Text style={styles.taskText} numberOfLines={2}>
              {prompt.slice(0, 200)}
            </Text>
          </View>
        ) : null;
      }

      case 'TodoWrite': {
        const todos = input.todos;
        if (!Array.isArray(todos)) return null;
        return (
          <View style={styles.todoBlock}>
            {(todos as Array<{ content?: string; status?: string }>).slice(0, 5).map((todo, i) => (
              <View key={i} style={styles.todoRow}>
                <Ionicons
                  name={
                    todo.status === 'completed'
                      ? 'checkmark-circle'
                      : todo.status === 'in_progress'
                        ? 'ellipse'
                        : 'ellipse-outline'
                  }
                  size={14}
                  color={
                    todo.status === 'completed'
                      ? Colors.success
                      : todo.status === 'in_progress'
                        ? Colors.primary
                        : Colors.textMuted
                  }
                />
                <Text style={styles.todoText} numberOfLines={1}>
                  {String(todo.content || '')}
                </Text>
              </View>
            ))}
          </View>
        );
      }

      case 'NotebookEdit': {
        const notebookPath = String(input.notebook_path || '');
        return (
          <View style={styles.filePathBlock}>
            <Ionicons name="book-outline" size={14} color={Colors.primaryLight} />
            <Text style={styles.filePathText} numberOfLines={1}>
              {shortenPath(notebookPath)}
            </Text>
          </View>
        );
      }

      default: {
        // Generic key-value display
        const entries = Object.entries(input).slice(0, 3);
        return (
          <View style={styles.kvBlock}>
            {entries.map(([key, value]) => (
              <View key={key} style={styles.kvRow}>
                <Text style={styles.kvKey}>{key}</Text>
                <Text style={styles.kvValue} numberOfLines={2}>
                  {typeof value === 'string'
                    ? value.slice(0, 150)
                    : JSON.stringify(value).slice(0, 150)}
                </Text>
              </View>
            ))}
          </View>
        );
      }
    }
  };

  const renderToolOutput = (tool: ToolCall) => {
    if (!tool.output) return null;
    const output = typeof tool.output === 'string' ? tool.output : JSON.stringify(tool.output);
    if (!output || output === '""') return null;

    // For Bash, show terminal-style output
    if (tool.name === 'Bash') {
      return (
        <View style={styles.outputBlock}>
          <Text style={styles.outputText} numberOfLines={6}>
            {output.slice(0, 500)}
            {output.length > 500 ? '...' : ''}
          </Text>
        </View>
      );
    }

    // For file searches, show results
    if (tool.name === 'Glob' || tool.name === 'Grep') {
      const lines = output.split('\n').filter(Boolean).slice(0, 5);
      return (
        <View style={styles.outputBlock}>
          {lines.map((line, i) => (
            <Text key={i} style={styles.outputFileLine} numberOfLines={1}>
              {shortenPath(line)}
            </Text>
          ))}
          {output.split('\n').filter(Boolean).length > 5 && (
            <Text style={styles.outputMore}>
              +{output.split('\n').filter(Boolean).length - 5} more
            </Text>
          )}
        </View>
      );
    }

    // Generic output
    return (
      <View style={styles.outputBlock}>
        <Text style={styles.outputText} numberOfLines={4}>
          {output.slice(0, 300)}
          {output.length > 300 ? '...' : ''}
        </Text>
      </View>
    );
  };

  const renderThinking = (message: AgentMessage) => {
    if (!message.thinking && !message.isThinking) return null;

    return (
      <View style={styles.thinkingBlock}>
        <View style={styles.thinkingHeader}>
          {message.isThinking ? (
            <ActivityIndicator size="small" color={Colors.secondary} />
          ) : (
            <Ionicons name="bulb-outline" size={14} color={Colors.secondary} />
          )}
          <Text style={styles.thinkingLabel}>{message.isThinking ? 'Thinking...' : 'Thought'}</Text>
        </View>
        {message.thinking ? (
          <Text style={styles.thinkingText} numberOfLines={8}>
            {message.thinking.slice(0, 500)}
            {(message.thinking.length || 0) > 500 ? '...' : ''}
          </Text>
        ) : null}
      </View>
    );
  };

  const renderMessage = (message: AgentMessage) => {
    const isUser = message.role === 'user';
    const displayContent = stripSystemTags(message.content);
    const hasThinking = !!(message.thinking || message.isThinking);

    // Skip messages that are empty after stripping system tags (unless still streaming or has thinking)
    if (!displayContent && !message.isPartial && !hasThinking) return null;

    return (
      <View
        key={`msg-${message.id}`}
        style={[styles.messageContainer, isUser ? styles.userMessage : styles.assistantMessage]}
      >
        {!isUser && renderThinking(message)}
        <View style={[styles.messageBubble, isUser && styles.userBubble]}>
          {displayContent ? (
            isUser ? (
              <Text style={[styles.messageText, styles.userMessageText]}>{displayContent}</Text>
            ) : (
              <Markdown style={mdStyles}>{displayContent}</Markdown>
            )
          ) : null}
        </View>
        <Text style={styles.messageTime}>
          {new Date(message.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </Text>
      </View>
    );
  };

  const renderToolCall = (tool: ToolCall) => {
    const statusIcon = {
      pending: 'hourglass-outline',
      running: 'sync-outline',
      completed: 'checkmark-circle-outline',
      error: 'close-circle-outline',
      denied: 'ban-outline',
    }[tool.status] as keyof typeof Ionicons.glyphMap;

    const statusColor = {
      pending: Colors.warning,
      running: Colors.primary,
      completed: Colors.success,
      error: Colors.error,
      denied: Colors.textMuted,
    }[tool.status];

    const toolIcon = TOOL_ICONS[tool.name] ?? 'code-slash';

    return (
      <View
        key={`tool-${tool.id}`}
        style={[styles.toolCallContainer, { borderLeftColor: statusColor }]}
      >
        <View style={styles.toolCallHeader}>
          <Ionicons name={toolIcon} size={14} color={Colors.textMuted} />
          <Text style={styles.toolCallName}>{tool.name}</Text>
          {tool.description && (
            <Text style={styles.toolDescription} numberOfLines={1}>
              {tool.description}
            </Text>
          )}
          {tool.status === 'running' && !tool.completedAt ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : (
            <Ionicons name={statusIcon} size={16} color={statusColor} />
          )}
        </View>

        {renderToolInput(tool)}
        {renderToolOutput(tool)}

        {tool.error && (
          <View style={styles.errorBlock}>
            <Ionicons name="close-circle" size={14} color={Colors.error} />
            <Text style={styles.errorText} numberOfLines={3}>
              {tool.error}
            </Text>
          </View>
        )}
      </View>
    );
  };

  const renderApprovalBanner = (approval: ApprovalRequest) => {
    const isProcessing = approvalProcessing.has(approval.id);
    const riskColor = getRiskColor(approval.riskLevel);

    return (
      <View key={`approval-${approval.id}`} style={styles.approvalBanner}>
        <View style={styles.approvalBannerHeader}>
          <View style={[styles.riskBadge, { backgroundColor: riskColor }]}>
            <Text style={styles.riskText}>{approval.riskLevel.toUpperCase()}</Text>
          </View>
          <Ionicons
            name={TOOL_ICONS[approval.toolName] ?? 'build-outline'}
            size={16}
            color={Colors.textSecondary}
          />
          <Text style={styles.approvalToolName}>{approval.toolName}</Text>
        </View>

        <Text style={styles.approvalDescription}>{approval.description}</Text>

        {/* Preview */}
        {approval.preview?.type === 'command' && (
          <View style={styles.terminalBlock}>
            <View style={styles.terminalHeader}>
              <View style={styles.terminalDots}>
                <View style={[styles.dot, { backgroundColor: '#ff5f57' }]} />
                <View style={[styles.dot, { backgroundColor: '#febc2e' }]} />
                <View style={[styles.dot, { backgroundColor: '#28c840' }]} />
              </View>
              <Text style={styles.terminalTitle}>Terminal</Text>
            </View>
            <View style={styles.terminalBody}>
              <Text style={styles.promptChar}>$ </Text>
              <Text style={styles.commandText}>{approval.preview.content}</Text>
            </View>
          </View>
        )}
        {approval.preview?.type === 'diff' && (
          <View style={styles.diffBlock}>
            <Text style={styles.diffPreviewText} numberOfLines={6}>
              {approval.preview.content.slice(0, 500)}
            </Text>
          </View>
        )}
        {approval.preview?.type === 'description' && (
          <View style={styles.filePathBlock}>
            <Ionicons name="document-text-outline" size={14} color={Colors.primaryLight} />
            <Text style={styles.filePathText} numberOfLines={2}>
              {approval.preview.content}
            </Text>
          </View>
        )}
        {!approval.preview &&
          approval.toolInput &&
          Object.keys(approval.toolInput).length > 0 &&
          (() => {
            if (approval.toolName === 'Bash' && approval.toolInput.command) {
              return (
                <View style={styles.terminalBlock}>
                  <View style={styles.terminalHeader}>
                    <View style={styles.terminalDots}>
                      <View style={[styles.dot, { backgroundColor: '#ff5f57' }]} />
                      <View style={[styles.dot, { backgroundColor: '#febc2e' }]} />
                      <View style={[styles.dot, { backgroundColor: '#28c840' }]} />
                    </View>
                    <Text style={styles.terminalTitle}>Terminal</Text>
                  </View>
                  <View style={styles.terminalBody}>
                    <Text style={styles.promptChar}>$ </Text>
                    <Text style={styles.commandText}>{String(approval.toolInput.command)}</Text>
                  </View>
                </View>
              );
            }
            if (
              (approval.toolName === 'Write' || approval.toolName === 'Edit') &&
              approval.toolInput.file_path
            ) {
              return (
                <View style={styles.filePathBlock}>
                  <Ionicons
                    name={
                      approval.toolName === 'Write' ? 'document-text-outline' : 'create-outline'
                    }
                    size={14}
                    color={Colors.primaryLight}
                  />
                  <Text style={styles.filePathText} numberOfLines={1}>
                    {shortenPath(String(approval.toolInput.file_path))}
                  </Text>
                </View>
              );
            }
            return null;
          })()}

        {/* Action buttons */}
        <View style={styles.approvalActions}>
          <TouchableOpacity
            style={styles.denyBtn}
            onPress={() => handleDeny(approval)}
            disabled={isProcessing}
            activeOpacity={0.7}
          >
            {isProcessing ? (
              <ActivityIndicator size="small" color={Colors.textSecondary} />
            ) : (
              <>
                <Ionicons name="close" size={18} color={Colors.textSecondary} />
                <Text style={styles.denyBtnText}>Deny</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.approveBtnWrapper}
            onPress={() => handleApprove(approval)}
            disabled={isProcessing}
            activeOpacity={0.7}
          >
            <LinearGradient
              colors={
                isProcessing
                  ? [Colors.backgroundTertiary, Colors.backgroundTertiary]
                  : [Colors.primary, Colors.secondary]
              }
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.approveBtn}
            >
              {isProcessing ? (
                <ActivityIndicator size="small" color={Colors.textMuted} />
              ) : (
                <>
                  <Ionicons name="checkmark" size={18} color="#fff" />
                  <Text style={styles.approveBtnText}>Approve</Text>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // Interleave messages and tool calls by timestamp, deduplicate tool calls
  const timeline = useMemo(() => {
    const seenTools = new Set<string>();
    const uniqueToolCalls = toolCalls.filter((t) => {
      if (seenTools.has(t.id)) return false;
      seenTools.add(t.id);
      return true;
    });

    // Filter out empty messages (assistant turns with only tool calls produce no text)
    // Also filter out messages that are only system tags with no real user content
    // Only keep isPartial messages if they have actual streamed content (not just placeholders)
    const filteredMessages = messages.filter((m) => stripSystemTags(m.content) !== '');

    return [...filteredMessages, ...uniqueToolCalls].sort((a, b) => {
      const aTime = 'timestamp' in a ? new Date(a.timestamp) : new Date(a.startedAt);
      const bTime = 'timestamp' in b ? new Date(b.timestamp) : new Date(b.startedAt);
      return aTime.getTime() - bTime.getTime();
    });
  }, [messages, toolCalls]);

  // Show a typing indicator when the assistant is streaming (only for active sessions)
  const isAssistantTyping = useMemo(
    () =>
      session?.status === 'running' &&
      messages.some((m) => m.role === 'assistant' && m.isPartial && m.content.trim() === ''),
    [messages, session?.status]
  );

  // Build a flat data array for FlatList with discriminated item types
  type TimelineItem =
    | { _type: 'message'; _key: string; data: AgentMessage }
    | { _type: 'tool'; _key: string; data: ToolCall }
    | { _type: 'typing'; _key: string }
    | { _type: 'approval'; _key: string; data: ApprovalRequest };

  const flatListData = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = timeline.map((item) =>
      'content' in item
        ? {
            _type: 'message' as const,
            _key: `msg-${(item as AgentMessage).id}`,
            data: item as AgentMessage,
          }
        : { _type: 'tool' as const, _key: `tool-${(item as ToolCall).id}`, data: item as ToolCall }
    );
    if (isAssistantTyping) {
      items.push({ _type: 'typing' as const, _key: 'typing-indicator' });
    }
    for (const approval of pendingApprovals) {
      items.push({ _type: 'approval' as const, _key: `approval-${approval.id}`, data: approval });
    }
    return items;
  }, [timeline, isAssistantTyping, pendingApprovals]);

  const renderTimelineItem = useCallback(({ item }: { item: TimelineItem }) => {
    switch (item._type) {
      case 'message':
        return renderMessage(item.data);
      case 'tool':
        return renderToolCall(item.data);
      case 'typing':
        return (
          <View style={styles.typingRow}>
            <ActivityIndicator size="small" color={Colors.primary} />
            <Text style={styles.typingText}>Thinking...</Text>
          </View>
        );
      case 'approval':
        return renderApprovalBanner(item.data);
      default:
        return null;
    }
  }, []);

  const timelineKeyExtractor = useCallback((item: TimelineItem) => item._key, []);

  const ListHeaderComponent = useMemo(() => {
    if (otherApprovalCount <= 0) return null;
    return (
      <TouchableOpacity
        style={styles.otherApprovalsBanner}
        onPress={() => router.push('/(tabs)/approvals')}
        activeOpacity={0.7}
      >
        <Ionicons name="shield-checkmark" size={16} color={Colors.warning} />
        <Text style={styles.otherApprovalsText}>
          {otherApprovalCount} approval{otherApprovalCount !== 1 ? 's' : ''} waiting in other
          sessions
        </Text>
        <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
      </TouchableOpacity>
    );
  }, [otherApprovalCount, router]);

  const ListEmptyComponent = useMemo(() => {
    if (isLoadingHistory) {
      return (
        <View style={styles.emptyState}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.emptySubtext}>Loading messages...</Text>
        </View>
      );
    }
    if (loadError) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="cloud-offline-outline" size={48} color={Colors.error} />
          <Text style={styles.emptyText}>Failed to load session</Text>
          <Text style={styles.emptySubtext}>Could not load message history</Text>
          <TouchableOpacity onPress={handleRetryLoad} style={styles.retryButton}>
            <Ionicons name="refresh" size={18} color={Colors.primary} />
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={styles.emptyState}>
        <Ionicons name="chatbubbles-outline" size={48} color={Colors.textMuted} />
        <Text style={styles.emptyText}>No messages yet</Text>
        <Text style={styles.emptySubtext}>Messages and tool calls will appear here</Text>
      </View>
    );
  }, [isLoadingHistory, loadError, handleRetryLoad]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={100}
    >
      <FlatList
        ref={listRef}
        data={flatListData}
        renderItem={renderTimelineItem}
        keyExtractor={timelineKeyExtractor}
        style={styles.messagesContainer}
        contentContainerStyle={
          flatListData.length === 0 ? styles.messagesContentEmpty : styles.messagesContent
        }
        onContentSizeChange={handleContentSizeChange}
        onScroll={handleScroll}
        scrollEventThrottle={100}
        ListHeaderComponent={ListHeaderComponent}
        ListEmptyComponent={ListEmptyComponent}
        maxToRenderPerBatch={15}
        initialNumToRender={20}
        windowSize={7}
      />

      {/* Input area */}
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Send a message..."
          placeholderTextColor={Colors.textMuted}
          multiline
          maxLength={4000}
        />
        <TouchableOpacity
          style={[styles.sendButton, !inputText.trim() && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={!inputText.trim()}
        >
          <Ionicons name="send" size={20} color={inputText.trim() ? '#fff' : Colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Session info menu */}
      <Modal
        visible={menuVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setMenuVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setMenuVisible(false)}
        >
          <View style={styles.menuSheet} onStartShouldSetResponder={() => true}>
            <View style={styles.menuHandle} />
            <Text style={styles.menuTitle}>Session Info</Text>

            <View style={styles.menuRow}>
              <Ionicons name="cube-outline" size={18} color={Colors.textSecondary} />
              <Text style={styles.menuLabel}>Model</Text>
              <Text style={styles.menuValue}>{formatModelName(session?.model)}</Text>
            </View>

            <View style={styles.menuRow}>
              <Ionicons name="options-outline" size={18} color={Colors.textSecondary} />
              <Text style={styles.menuLabel}>Mode</Text>
              <View style={styles.modeBadge}>
                <Text style={styles.modeBadgeText}>{formatMode(session?.agentMode)}</Text>
              </View>
            </View>

            <View style={styles.menuRow}>
              <Ionicons name="laptop-outline" size={18} color={Colors.textSecondary} />
              <Text style={styles.menuLabel}>Machine</Text>
              <Text style={styles.menuValue}>{machine?.name || 'Unknown'}</Text>
            </View>

            <View style={styles.menuRow}>
              <Ionicons name="folder-outline" size={18} color={Colors.textSecondary} />
              <Text style={styles.menuLabel}>Project</Text>
              <Text style={styles.menuValue} numberOfLines={1}>
                {session?.projectPath || 'Unknown'}
              </Text>
            </View>

            <View style={[styles.menuRow, styles.menuRowLast]}>
              <Ionicons name="time-outline" size={18} color={Colors.textSecondary} />
              <Text style={styles.menuLabel}>Started</Text>
              <Text style={styles.menuValue}>
                {session?.createdAt
                  ? new Date(session.createdAt).toLocaleString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : 'Unknown'}
              </Text>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const monoFont = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

const mdStyles: StyleSheet.NamedStyles<Record<string, unknown>> = {
  body: {
    color: Colors.text,
    fontSize: 16,
    lineHeight: 22,
  },
  paragraph: {
    marginTop: 0,
    marginBottom: 8,
  },
  heading1: {
    color: Colors.text,
    fontSize: 22,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 6,
  },
  heading2: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: '700',
    marginTop: 10,
    marginBottom: 4,
  },
  heading3: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '600',
    marginTop: 8,
    marginBottom: 4,
  },
  strong: {
    fontWeight: '700',
    color: Colors.text,
  },
  em: {
    fontStyle: 'italic',
    color: Colors.text,
  },
  link: {
    color: Colors.primaryLight,
    textDecorationLine: 'underline',
  },
  blockquote: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginVertical: 6,
  },
  code_inline: {
    fontFamily: monoFont,
    fontSize: 14,
    color: Colors.primaryLight,
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  code_block: {
    fontFamily: monoFont,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.textSecondary,
    backgroundColor: Colors.background,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    marginVertical: 6,
  },
  fence: {
    fontFamily: monoFont,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.textSecondary,
    backgroundColor: Colors.background,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    marginVertical: 6,
  },
  bullet_list: {
    marginVertical: 4,
  },
  ordered_list: {
    marginVertical: 4,
  },
  list_item: {
    flexDirection: 'row',
    marginVertical: 2,
  },
  bullet_list_icon: {
    color: Colors.textMuted,
    fontSize: 16,
    lineHeight: 22,
    marginRight: 8,
  },
  ordered_list_icon: {
    color: Colors.textMuted,
    fontSize: 16,
    lineHeight: 22,
    marginRight: 8,
  },
  hr: {
    backgroundColor: Colors.border,
    height: 1,
    marginVertical: 10,
  },
  table: {
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: 6,
    marginVertical: 6,
  },
  thead: {
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  th: {
    padding: 8,
    borderBottomWidth: 1,
    borderColor: Colors.borderLight,
    color: Colors.text,
    fontWeight: '600',
    fontSize: 13,
  },
  td: {
    padding: 8,
    borderBottomWidth: 1,
    borderColor: Colors.borderLight,
    color: Colors.textSecondary,
    fontSize: 13,
  },
  tr: {
    borderBottomWidth: 1,
    borderColor: Colors.borderLight,
  },
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  headerTitle: {
    alignItems: 'center',
  },
  headerTitleText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
    maxWidth: 220,
  },
  headerSubtitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  headerSubtitleText: {
    fontSize: 12,
    color: Colors.textMuted,
    maxWidth: 140,
  },
  headerMachineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  headerMachineText: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '500',
  },
  headerBack: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.backgroundTertiary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  backBadge: {
    position: 'absolute' as const,
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.error,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingHorizontal: 4,
  },
  backBadgeText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: '#fff',
  },
  headerMenuButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.backgroundTertiary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  otherApprovalsBanner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.25)',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 4,
  },
  otherApprovalsText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500' as const,
    color: Colors.warning,
  },
  messagesContainer: {
    flex: 1,
  },
  messagesContent: {
    padding: 16,
    gap: 12,
  },
  messagesContentEmpty: {
    padding: 16,
    flexGrow: 1,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.text,
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: Colors.textMuted,
    marginTop: 4,
  },
  retryButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginTop: 16,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: Colors.backgroundTertiary,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  messageContainer: {
    maxWidth: '85%',
  },
  userMessage: {
    alignSelf: 'flex-end',
  },
  assistantMessage: {
    alignSelf: 'flex-start',
  },
  messageBubble: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    paddingHorizontal: 16,
  },
  userBubble: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  messageText: {
    fontSize: 16,
    color: Colors.text,
    lineHeight: 22,
  },
  userMessageText: {
    color: '#fff',
  },
  messageTime: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 4,
    marginHorizontal: 4,
  },

  // Tool call container — left accent bar indicates status
  toolCallContainer: {
    backgroundColor: 'rgba(17, 24, 39, 0.5)',
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
    borderTopLeftRadius: 2,
    borderBottomLeftRadius: 2,
    borderLeftWidth: 3,
    borderLeftColor: Colors.textMuted,
    padding: 10,
    paddingLeft: 12,
    alignSelf: 'stretch',
    gap: 6,
  },
  toolCallHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  toolCallName: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
    fontFamily: monoFont,
  },
  toolDescription: {
    flex: 1,
    fontSize: 12,
    color: Colors.textMuted,
  },

  // Terminal block (Bash)
  terminalBlock: {
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  terminalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 8,
  },
  terminalDots: {
    flexDirection: 'row',
    gap: 4,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  terminalTitle: {
    fontSize: 10,
    fontWeight: '500',
    color: Colors.textMuted,
  },
  terminalBody: {
    flexDirection: 'row',
    backgroundColor: Colors.background,
    padding: 10,
  },
  promptChar: {
    fontFamily: monoFont,
    fontSize: 12,
    color: Colors.success,
    fontWeight: '600',
  },
  commandText: {
    fontFamily: monoFont,
    fontSize: 12,
    color: Colors.text,
    flex: 1,
  },

  // File path block
  filePathBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.backgroundTertiary,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  filePathText: {
    fontFamily: monoFont,
    fontSize: 12,
    color: Colors.primaryLight,
    flex: 1,
  },
  fileRangeText: {
    fontFamily: monoFont,
    fontSize: 11,
    color: Colors.textMuted,
  },

  // Code preview
  codePreview: {
    backgroundColor: Colors.background,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    marginTop: 4,
  },
  codePreviewText: {
    fontFamily: monoFont,
    fontSize: 11,
    color: Colors.textSecondary,
    lineHeight: 16,
  },

  // Diff block
  diffBlock: {
    backgroundColor: Colors.background,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    marginTop: 4,
    gap: 2,
  },
  diffRemoved: {
    fontFamily: monoFont,
    fontSize: 11,
    color: '#f87171',
    lineHeight: 16,
  },
  diffAdded: {
    fontFamily: monoFont,
    fontSize: 11,
    color: '#4ade80',
    lineHeight: 16,
  },
  diffPreviewText: {
    fontFamily: monoFont,
    fontSize: 11,
    color: Colors.textSecondary,
    lineHeight: 16,
  },

  // Search block (Glob/Grep)
  searchBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.backgroundTertiary,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    flexWrap: 'wrap',
  },
  searchPattern: {
    fontFamily: monoFont,
    fontSize: 12,
    color: Colors.primaryLight,
    fontWeight: '500',
  },
  searchPath: {
    fontSize: 11,
    color: Colors.textMuted,
  },

  // Task block
  taskBlock: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: Colors.backgroundTertiary,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  taskText: {
    fontSize: 12,
    color: Colors.textSecondary,
    flex: 1,
    lineHeight: 17,
  },

  // Todo block
  todoBlock: {
    backgroundColor: Colors.backgroundTertiary,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    gap: 6,
  },
  todoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  todoText: {
    fontSize: 12,
    color: Colors.textSecondary,
    flex: 1,
  },

  // KV block (generic fallback)
  kvBlock: {
    backgroundColor: Colors.backgroundTertiary,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    gap: 4,
  },
  kvRow: {
    flexDirection: 'row',
    gap: 8,
  },
  kvKey: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textMuted,
    minWidth: 50,
    fontFamily: monoFont,
  },
  kvValue: {
    fontSize: 11,
    color: Colors.textSecondary,
    flex: 1,
    fontFamily: monoFont,
  },

  // Output block
  outputBlock: {
    backgroundColor: Colors.background,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  outputText: {
    fontFamily: monoFont,
    fontSize: 11,
    color: Colors.textMuted,
    lineHeight: 16,
  },
  outputFileLine: {
    fontFamily: monoFont,
    fontSize: 11,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  outputMore: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 4,
    fontStyle: 'italic',
  },

  // Error block
  errorBlock: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  errorText: {
    fontSize: 12,
    color: Colors.error,
    flex: 1,
    fontFamily: monoFont,
    lineHeight: 17,
  },

  // Approval banner (inline in chat)
  approvalBanner: {
    backgroundColor: 'rgba(10, 15, 26, 0.5)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    padding: 16,
    alignSelf: 'stretch',
    gap: 10,
  },
  approvalBannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  riskBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
  },
  riskText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.5,
  },
  approvalToolName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  approvalDescription: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  approvalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  denyBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.backgroundTertiary,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    gap: 6,
  },
  denyBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  approveBtnWrapper: {
    flex: 1,
  },
  approveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    gap: 6,
  },
  approveBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },

  // Input area
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 16,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.background,
    gap: 12,
  },
  input: {
    flex: 1,
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: Colors.text,
    maxHeight: 120,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: Colors.backgroundTertiary,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },

  // Info menu modal
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'flex-end',
  },
  menuSheet: {
    backgroundColor: Colors.backgroundSecondary,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  menuHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: 16,
  },
  menuTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 16,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12,
  },
  menuRowLast: {
    borderBottomWidth: 0,
  },
  menuLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
    width: 70,
  },
  menuValue: {
    flex: 1,
    fontSize: 14,
    color: Colors.text,
    textAlign: 'right',
  },
  modeBadge: {
    flex: 1,
    alignItems: 'flex-end',
  },
  modeBadgeText: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.primary,
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: 'hidden',
  },

  // Thinking block
  thinkingBlock: {
    backgroundColor: 'rgba(168, 85, 247, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.2)',
    borderRadius: 12,
    padding: 10,
    marginBottom: 6,
    gap: 6,
  },
  thinkingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  thinkingLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.secondary,
  },
  thinkingText: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
    fontStyle: 'italic',
  },

  // Typing indicator
  typingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  typingText: {
    fontSize: 13,
    color: Colors.textMuted,
    fontStyle: 'italic',
  },
});
