/**
 * Sessions list screen - cross-machine overview with search, filter, and sort
 */

import { useState, useCallback, useMemo, type ComponentProps } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  useSessionsStore,
  useMachinesStore,
  createApiClient,
  stripSystemTags,
} from '@agentap-dev/shared';
import type { AgentSession } from '@agentap-dev/shared';
import { Colors } from '../../constants/Colors';
import { API_URL, API_HEADERS } from '../../constants/Config';
import { useWebSocketContext } from '../../components/WebSocketProvider';
import { ClaudeCodeIcon } from '../../components/icons/ClaudeCodeIcon';
import { timeAgo } from '../../utils/timeAgo';

type FilterType = 'all' | 'running' | 'waiting' | 'completed' | 'error';
type SortType = 'recent' | 'newest' | 'oldest';

export default function SessionsScreen() {
  const router = useRouter();
  const { sessions, pendingApprovals } = useSessionsStore();
  const { machines, setMachines } = useMachinesStore();
  const { refreshAll } = useWebSocketContext();
  const api = createApiClient(API_URL, API_HEADERS);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [sort, setSort] = useState<SortType>('recent');
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const { machines } = await api.getMachines();
      setMachines(machines);
    } catch (e) {
      console.error('Failed to refresh machines:', e);
    }
    refreshAll();
    setTimeout(() => setRefreshing(false), 1000);
  }, [api, setMachines, refreshAll]);

  const filteredSessions = useMemo(() => {
    let result = sessions;

    // Search
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (s) =>
          s.projectName.toLowerCase().includes(q) ||
          s.agent.toLowerCase().includes(q) ||
          s.lastMessage?.toLowerCase().includes(q) ||
          machines
            .find((m) => m.id === s.machineId)
            ?.name.toLowerCase()
            .includes(q)
      );
    }

    // Filter
    if (filter === 'running') {
      result = result.filter((s) => s.status === 'running');
    } else if (filter === 'waiting') {
      result = result.filter(
        (s) => s.status === 'waiting_for_approval' || s.status === 'waiting_for_input'
      );
    } else if (filter === 'completed') {
      result = result.filter(
        (s) => s.status === 'completed' || s.status === 'idle' || s.status === 'paused'
      );
    } else if (filter === 'error') {
      result = result.filter((s) => s.status === 'error');
    }

    // Sort
    result = [...result].sort((a, b) => {
      if (sort === 'recent') {
        return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
      }
      if (sort === 'newest') {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
      // oldest
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    return result;
  }, [sessions, search, filter, sort, machines]);

  const getStatusIcon = (sessionStatus: AgentSession['status']) => {
    switch (sessionStatus) {
      case 'running':
      case 'starting':
      case 'thinking':
        return { name: 'ellipse', color: Colors.success };
      case 'waiting_for_approval':
        return { name: 'alert-circle', color: Colors.warning };
      case 'waiting_for_input':
        return { name: 'chatbubble-ellipses', color: Colors.primary };
      case 'completed':
      case 'idle':
      case 'paused':
        return { name: 'ellipse', color: Colors.textMuted };
      case 'error':
        return { name: 'close-circle', color: Colors.error };
      default:
        return { name: 'ellipse', color: Colors.textMuted };
    }
  };

  const renderAgentIcon = (agent: string) => {
    switch (agent) {
      case 'claude-code':
        return <ClaudeCodeIcon size={26} />;
      case 'codex':
        return <Text style={styles.agentIcon}>🔷</Text>;
      case 'aider':
        return <Text style={styles.agentIcon}>🟣</Text>;
      case 'opencode':
        return <Text style={styles.agentIcon}>🟢</Text>;
      default:
        return <Text style={styles.agentIcon}>⚪</Text>;
    }
  };

  const renderSession = ({ item }: { item: AgentSession }) => {
    const statusInfo = getStatusIcon(item.status);
    const machine = machines.find((m) => m.id === item.machineId);

    return (
      <TouchableOpacity
        style={styles.sessionCard}
        onPress={() => router.push(`/session/${item.id}`)}
        activeOpacity={0.7}
      >
        <View style={styles.sessionHeader}>
          <View style={styles.agentIconContainer}>{renderAgentIcon(item.agent)}</View>
          <View style={styles.sessionInfo}>
            <Text style={styles.sessionTitle} numberOfLines={1}>
              {(item.sessionName && stripSystemTags(item.sessionName)) || item.projectName}
            </Text>
            <Text style={styles.sessionSubtitle} numberOfLines={1}>
              {item.projectName} · {item.agent}
            </Text>
          </View>
          <Ionicons
            name={statusInfo.name as ComponentProps<typeof Ionicons>['name']}
            size={22}
            color={statusInfo.color}
          />
        </View>
        {item.lastMessage && (
          <Text style={styles.lastMessage} numberOfLines={2}>
            {item.lastMessage}
          </Text>
        )}
        <View style={styles.sessionFooter}>
          {machine && (
            <View style={styles.machineBadge}>
              <Ionicons name="laptop-outline" size={11} color={Colors.textMuted} />
              <Text style={styles.machineNameText}>{machine.name}</Text>
            </View>
          )}
          <Text style={styles.timestamp}>{timeAgo(item.lastActivity)}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const filters: { key: FilterType; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'running', label: 'Running' },
    { key: 'waiting', label: 'Waiting' },
    { key: 'completed', label: 'Completed' },
    { key: 'error', label: 'Error' },
  ];

  const sorts: { key: SortType; label: string }[] = [
    { key: 'recent', label: 'Recent Activity' },
    { key: 'newest', label: 'Newest' },
    { key: 'oldest', label: 'Oldest' },
  ];

  const ListHeader = () => (
    <View style={styles.headerSection}>
      {/* Pending approvals banner */}
      {pendingApprovals.length > 0 && (
        <TouchableOpacity
          style={styles.approvalBanner}
          onPress={() => router.push('/(tabs)/approvals')}
          activeOpacity={0.7}
        >
          <View style={styles.approvalIconWrapper}>
            <Ionicons name="alert-circle" size={18} color={Colors.warning} />
          </View>
          <Text style={styles.approvalText}>
            {pendingApprovals.length} pending approval{pendingApprovals.length > 1 ? 's' : ''}
          </Text>
          <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
        </TouchableOpacity>
      )}

      {/* Search */}
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={18} color={Colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search sessions..."
          placeholderTextColor={Colors.textMuted}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {search ? (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Filter chips */}
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

      {/* Sort chips */}
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
        <Ionicons name="terminal-outline" size={48} color={Colors.textMuted} />
      </View>
      <Text style={styles.emptyTitle}>No active sessions</Text>
      <Text style={styles.emptyText}>Start a coding agent on your machine to see it here</Text>
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
        data={filteredSessions}
        keyExtractor={(item) => item.id}
        renderItem={renderSession}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        contentContainerStyle={
          filteredSessions.length === 0 ? styles.emptyContainer : styles.listContent
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
  approvalBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(10, 15, 26, 0.5)',
    padding: 14,
    borderRadius: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.2)',
  },
  approvalIconWrapper: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  approvalText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: Colors.warning,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 14,
    paddingHorizontal: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.text,
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
  sessionCard: {
    backgroundColor: 'rgba(10, 15, 26, 0.5)',
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  sessionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  agentIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: Colors.backgroundTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  agentIcon: {
    fontSize: 22,
  },
  sessionInfo: {
    flex: 1,
  },
  sessionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
  },
  sessionSubtitle: {
    fontSize: 13,
    color: Colors.textMuted,
    marginTop: 2,
  },
  machineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.backgroundTertiary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  machineNameText: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '500',
  },
  lastMessage: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 12,
    lineHeight: 20,
  },
  sessionFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 8,
  },
  timestamp: {
    fontSize: 12,
    color: Colors.textMuted,
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
  },
});
