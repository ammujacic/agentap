/**
 * Approvals screen - with filter chips, sort, and rich tool previews
 */

import { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import {
  useSessionsStore,
  useMachinesStore,
  createApiClient,
  type ApprovalRequest,
} from '@agentap-dev/shared';
import { Colors, AgentColors } from '../../constants/Colors';
import { API_URL, API_HEADERS } from '../../constants/Config';
import { useWebSocketContext } from '../../components/WebSocketProvider';

type FilterType = 'all' | 'high' | 'medium' | 'low';
type SortType = 'newest' | 'expiring' | 'risk';

const RISK_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const TOOL_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Bash: 'terminal-outline',
  Write: 'document-text-outline',
  Edit: 'create-outline',
  NotebookEdit: 'book-outline',
  Read: 'eye-outline',
  Glob: 'search-outline',
  Grep: 'search-outline',
  WebFetch: 'globe-outline',
  Task: 'git-branch-outline',
};

export default function ApprovalsScreen() {
  const { pendingApprovals, sessions } = useSessionsStore();
  const { machines, setMachines } = useMachinesStore();
  const { approveToolCall, denyToolCall, refreshAll } = useWebSocketContext();
  const api = createApiClient(API_URL, API_HEADERS);

  const [filter, setFilter] = useState<FilterType>('all');
  const [sort, setSort] = useState<SortType>('newest');
  const [refreshing, setRefreshing] = useState(false);
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const { machines: refreshedMachines } = await api.getMachines();
      setMachines(refreshedMachines);
    } catch (e) {
      console.error('Failed to refresh machines:', e);
    }
    refreshAll();
    setTimeout(() => setRefreshing(false), 1000);
  }, [api, setMachines, refreshAll]);

  const filteredApprovals = useMemo(() => {
    let result = pendingApprovals;

    if (filter !== 'all') {
      result = result.filter((a) => a.riskLevel === filter);
    }

    result = [...result].sort((a, b) => {
      if (sort === 'newest') {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
      if (sort === 'expiring') {
        return new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime();
      }
      return (RISK_ORDER[a.riskLevel] ?? 99) - (RISK_ORDER[b.riskLevel] ?? 99);
    });

    return result;
  }, [pendingApprovals, filter, sort]);

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

  const getSessionInfo = (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return null;
    const machine = machines.find((m) => m.id === session.machineId);
    return { session, machine };
  };

  const handleApprove = (request: ApprovalRequest) => {
    setProcessingIds((prev) => new Set(prev).add(request.id));
    approveToolCall(request.sessionId, request.requestId, request.id);
    // Clear processing state after a timeout in case the resolved event is delayed
    setTimeout(() => {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(request.id);
        return next;
      });
    }, 5000);
  };

  const handleDeny = (request: ApprovalRequest) => {
    setProcessingIds((prev) => new Set(prev).add(request.id));
    denyToolCall(request.sessionId, request.requestId, request.id);
    setTimeout(() => {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(request.id);
        return next;
      });
    }, 5000);
  };

  const filters: { key: FilterType; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'high', label: 'High Risk' },
    { key: 'medium', label: 'Medium' },
    { key: 'low', label: 'Low' },
  ];

  const sorts: { key: SortType; label: string }[] = [
    { key: 'newest', label: 'Newest' },
    { key: 'expiring', label: 'Expiring Soon' },
    { key: 'risk', label: 'Risk Level' },
  ];

  const renderToolPreview = (item: ApprovalRequest) => {
    // Use preview field when available
    if (item.preview) {
      if (item.preview.type === 'command') {
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
              <Text style={styles.commandText}>{item.preview.content}</Text>
            </View>
          </View>
        );
      }
      if (item.preview.type === 'description') {
        return (
          <View style={styles.fileBlock}>
            <Ionicons name="document-text-outline" size={16} color={Colors.primary} />
            <Text style={styles.filePath} numberOfLines={2}>
              {item.preview.content}
            </Text>
          </View>
        );
      }
      if (item.preview.type === 'diff') {
        return (
          <View style={styles.terminalBlock}>
            <View style={styles.terminalBody}>
              <Text style={styles.diffText}>{item.preview.content.slice(0, 500)}</Text>
            </View>
          </View>
        );
      }
    }

    // Fallback: render tool-specific UI from toolInput
    if (item.toolName === 'Bash' && item.toolInput?.command) {
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
            <Text style={styles.commandText}>{String(item.toolInput.command)}</Text>
          </View>
        </View>
      );
    }

    if ((item.toolName === 'Write' || item.toolName === 'Edit') && item.toolInput?.file_path) {
      return (
        <View style={styles.fileBlock}>
          <Ionicons
            name={item.toolName === 'Write' ? 'document-text-outline' : 'create-outline'}
            size={16}
            color={Colors.primary}
          />
          <Text style={styles.filePath} numberOfLines={2}>
            {String(item.toolInput.file_path)}
          </Text>
        </View>
      );
    }

    // Generic fallback: show key-value pairs
    if (item.toolInput && Object.keys(item.toolInput).length > 0) {
      const entries = Object.entries(item.toolInput).slice(0, 3);
      return (
        <View style={styles.kvBlock}>
          {entries.map(([key, value]) => (
            <View key={key} style={styles.kvRow}>
              <Text style={styles.kvKey}>{key}</Text>
              <Text style={styles.kvValue} numberOfLines={2}>
                {typeof value === 'string' ? value : JSON.stringify(value)}
              </Text>
            </View>
          ))}
        </View>
      );
    }

    return null;
  };

  const renderApproval = ({ item }: { item: ApprovalRequest }) => {
    const info = getSessionInfo(item.sessionId);
    const isProcessing = processingIds.has(item.id);
    const toolIcon = TOOL_ICONS[item.toolName] ?? 'build-outline';
    const agentColor = info?.session
      ? (AgentColors[info.session.agent] ?? Colors.primary)
      : Colors.primary;

    return (
      <View style={[styles.approvalCard, isProcessing && styles.cardProcessing]}>
        {/* Context: agent + machine */}
        {info && (
          <View style={styles.contextRow}>
            <View style={[styles.agentDot, { backgroundColor: agentColor }]} />
            <Text style={styles.contextText}>
              {info.session.agent === 'claude-code' ? 'Claude Code' : info.session.agent}
            </Text>
            {info.machine && (
              <>
                <Text style={styles.contextSep}>on</Text>
                <Ionicons name="laptop-outline" size={12} color={Colors.textMuted} />
                <Text style={styles.contextText}>{info.machine.name}</Text>
              </>
            )}
          </View>
        )}

        {/* Header: risk badge + tool name + icon */}
        <View style={styles.approvalHeader}>
          <View style={[styles.riskBadge, { backgroundColor: getRiskColor(item.riskLevel) }]}>
            <Text style={styles.riskText}>{item.riskLevel.toUpperCase()}</Text>
          </View>
          <Ionicons name={toolIcon} size={18} color={Colors.textSecondary} />
          <Text style={styles.toolName}>{item.toolName}</Text>
        </View>

        {/* Description */}
        <Text style={styles.description}>{item.description}</Text>

        {/* Tool preview */}
        {renderToolPreview(item)}

        {/* Expires */}
        <Text style={styles.expiresAt}>
          Expires: {new Date(item.expiresAt).toLocaleTimeString()}
        </Text>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionButton, styles.denyButton]}
            onPress={() => handleDeny(item)}
            disabled={isProcessing}
            activeOpacity={0.7}
          >
            {isProcessing ? (
              <ActivityIndicator size="small" color={Colors.textSecondary} />
            ) : (
              <>
                <Ionicons name="close" size={20} color={Colors.textSecondary} />
                <Text style={[styles.actionText, { color: Colors.textSecondary }]}>Deny</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.approveButtonWrapper}
            onPress={() => handleApprove(item)}
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
              style={styles.approveButton}
            >
              {isProcessing ? (
                <ActivityIndicator size="small" color={Colors.textMuted} />
              ) : (
                <>
                  <Ionicons name="checkmark" size={20} color="#fff" />
                  <Text style={styles.actionText}>Approve</Text>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const ListHeader = () => (
    <View style={styles.headerSection}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
        {filters.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.chip, filter === f.key && styles.chipActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.chipText, filter === f.key && styles.chipTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
        {sorts.map((s) => (
          <TouchableOpacity
            key={s.key}
            style={[styles.sortChip, sort === s.key && styles.sortChipActive]}
            onPress={() => setSort(s.key)}
          >
            <Ionicons
              name="swap-vertical"
              size={14}
              color={sort === s.key ? Colors.primary : Colors.textMuted}
            />
            <Text style={[styles.sortChipText, sort === s.key && styles.sortChipTextActive]}>
              {s.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  const ListEmpty = () => (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name="shield-checkmark-outline" size={48} color={Colors.textMuted} />
      </View>
      <Text style={styles.emptyTitle}>No pending approvals</Text>
      <Text style={styles.emptyText}>
        When an agent needs permission to run a command, it will appear here
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>
      {refreshing && (
        <View style={styles.refreshBar}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={styles.refreshText}>Refreshing…</Text>
        </View>
      )}
      <FlatList
        data={filteredApprovals}
        keyExtractor={(item) => item.id}
        renderItem={renderApproval}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        contentContainerStyle={
          filteredApprovals.length === 0 ? styles.emptyContainer : styles.listContent
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
            colors={[Colors.primary]}
            progressBackgroundColor={Colors.backgroundTertiary}
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  refreshBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: 8,
    gap: 8,
    backgroundColor: Colors.backgroundSecondary,
  },
  refreshText: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  listContent: {
    paddingBottom: 16,
  },
  headerSection: {
    padding: 16,
    gap: 12,
  },
  chipRow: {
    flexDirection: 'row',
    flexGrow: 0,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.backgroundTertiary,
    marginRight: 8,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  chipActive: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    borderColor: Colors.primary,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.textMuted,
  },
  chipTextActive: {
    color: Colors.primary,
  },
  sortChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.backgroundTertiary,
    marginRight: 8,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    gap: 6,
  },
  sortChipActive: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    borderColor: Colors.primary,
  },
  sortChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.textMuted,
  },
  sortChipTextActive: {
    color: Colors.primary,
  },

  // Approval card
  approvalCard: {
    backgroundColor: 'rgba(10, 15, 26, 0.5)',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  cardProcessing: {
    opacity: 0.6,
  },

  // Context row (agent + machine)
  contextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  agentDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  contextText: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.textMuted,
  },
  contextSep: {
    fontSize: 12,
    color: Colors.textMuted,
    marginHorizontal: 2,
  },

  // Header
  approvalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  riskBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  riskText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.5,
  },
  toolName: {
    fontSize: 17,
    fontWeight: '600',
    color: Colors.text,
  },

  description: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: 12,
  },

  // Terminal-style command preview
  terminalBlock: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.borderLight,
    marginBottom: 4,
  },
  terminalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 10,
  },
  terminalDots: {
    flexDirection: 'row',
    gap: 5,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  terminalTitle: {
    fontSize: 11,
    fontWeight: '500',
    color: Colors.textMuted,
  },
  terminalBody: {
    flexDirection: 'row',
    backgroundColor: Colors.background,
    padding: 14,
  },
  promptChar: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: Colors.success,
    fontWeight: '600',
  },
  commandText: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: Colors.text,
    flex: 1,
  },
  diffText: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: Colors.textSecondary,
  },

  // File path preview
  fileBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.background,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    marginBottom: 4,
  },
  filePath: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: Colors.primaryLight,
    flex: 1,
  },

  // Key-value fallback
  kvBlock: {
    backgroundColor: Colors.background,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    gap: 6,
    marginBottom: 4,
  },
  kvRow: {
    flexDirection: 'row',
    gap: 8,
  },
  kvKey: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
    minWidth: 60,
  },
  kvValue: {
    fontSize: 12,
    color: Colors.textSecondary,
    flex: 1,
    fontFamily: 'monospace',
  },

  expiresAt: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 10,
  },

  // Action buttons
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    gap: 8,
  },
  denyButton: {
    backgroundColor: Colors.backgroundTertiary,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  approveButtonWrapper: {
    flex: 1,
  },
  approveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    gap: 8,
  },
  actionText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  emptyContainer: {
    flex: 1,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: Colors.backgroundTertiary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: Colors.text,
  },
  emptyText: {
    fontSize: 15,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 22,
    maxWidth: 280,
  },
});
