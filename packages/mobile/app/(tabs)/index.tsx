/**
 * Machines list screen (default tab) - with search, filter, and tappable cards
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Alert,
  ScrollView,
  Clipboard,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useMachinesStore, createApiClient, type Machine } from '@agentap-dev/shared';
import { Colors } from '../../constants/Colors';
import { API_URL, API_HEADERS } from '../../constants/Config';

type FilterType = 'all' | 'online' | 'offline';
type SortType = 'online_first' | 'name' | 'last_seen';

function getTimeAgo(date: Date): string {
  const now = Date.now();
  const seconds = Math.floor((now - date.getTime()) / 1000);

  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

export default function MachinesScreen() {
  const router = useRouter();
  const { machines, setMachines, removeMachine } = useMachinesStore();
  const api = createApiClient(API_URL, API_HEADERS);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [sort] = useState<SortType>('online_first');
  const [refreshing, setRefreshing] = useState(false);
  const isRefreshing = useRef(false);

  const loadMachines = async () => {
    if (isRefreshing.current) return;
    isRefreshing.current = true;
    setRefreshing(true);
    try {
      const { machines } = await api.getMachines();
      setMachines(machines);
    } catch (error) {
      console.error('Failed to load machines:', error);
    }
    setTimeout(() => {
      setRefreshing(false);
      isRefreshing.current = false;
    }, 1000);
  };

  useEffect(() => {
    loadMachines();
  }, []);

  const filteredMachines = useMemo(() => {
    let result = machines;

    // Search
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.agentsDetected?.some((a) => a.toLowerCase().includes(q))
      );
    }

    // Filter
    if (filter === 'online') result = result.filter((m) => m.isOnline);
    if (filter === 'offline') result = result.filter((m) => !m.isOnline);

    // Sort
    result = [...result].sort((a, b) => {
      if (sort === 'online_first') {
        if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
        return (
          (b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0) -
          (a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0)
        );
      }
      if (sort === 'name') return a.name.localeCompare(b.name);
      // last_seen
      return (
        (b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0) -
        (a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0)
      );
    });

    return result;
  }, [machines, search, filter, sort]);

  const handleDelete = (machine: Machine) => {
    Alert.alert('Unlink Machine', `Are you sure you want to unlink "${machine.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unlink',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteMachine(machine.id);
            removeMachine(machine.id);
          } catch {
            Alert.alert('Error', 'Failed to unlink machine');
          }
        },
      },
    ]);
  };

  const renderMachine = ({ item }: { item: Machine }) => (
    <TouchableOpacity
      style={styles.machineCard}
      onPress={() => router.push(`/machine/${item.id}`)}
      activeOpacity={0.7}
    >
      <View style={styles.machineHeader}>
        <View style={styles.machineIconContainer}>
          <Ionicons
            name={item.os === 'darwin' ? 'laptop' : 'desktop'}
            size={24}
            color={Colors.textSecondary}
          />
        </View>
        <View style={styles.machineInfo}>
          <Text style={styles.machineName}>{item.name}</Text>
          <Text style={styles.machineDetails}>
            {item.agentsDetected?.join(', ') || 'No agents detected'}
          </Text>
          {item.activeSessionCount > 0 && (
            <View style={styles.sessionCountRow}>
              <Ionicons name="terminal" size={12} color={Colors.primary} />
              <Text style={styles.sessionCountText}>
                {item.activeSessionCount} active session{item.activeSessionCount !== 1 ? 's' : ''}
              </Text>
            </View>
          )}
        </View>
        <View
          style={[
            styles.statusBadge,
            { backgroundColor: item.isOnline ? Colors.success : Colors.textMuted },
          ]}
        >
          <Text style={styles.statusText}>{item.isOnline ? 'Online' : 'Offline'}</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={Colors.textMuted} />
      </View>

      <View style={styles.machineFooter}>
        <Text style={styles.lastSeen}>
          {item.lastSeenAt
            ? `Last seen: ${getTimeAgo(new Date(item.lastSeenAt))}`
            : 'Never connected'}
        </Text>
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={(e) => {
            e?.stopPropagation?.();
            handleDelete(item);
          }}
        >
          <Ionicons name="trash-outline" size={18} color={Colors.error} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );

  const filters: { key: FilterType; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'online', label: 'Online' },
    { key: 'offline', label: 'Offline' },
  ];

  const ListHeader = () => (
    <View style={styles.headerSection}>
      {/* Search */}
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={18} color={Colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search machines..."
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
    </View>
  );

  const ListEmpty = () => (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name="laptop-outline" size={48} color={Colors.textMuted} />
      </View>
      <Text style={styles.emptyTitle}>No machines linked</Text>
      <Text style={styles.emptyText}>Get started in 3 steps:</Text>

      <View style={styles.steps}>
        <View style={styles.step}>
          <Text style={styles.stepNumber}>1</Text>
          <View style={styles.stepContent}>
            <Text style={styles.stepText}>Install the daemon on your computer:</Text>
            <TouchableOpacity
              style={styles.codeBlock}
              onPress={() => Clipboard.setString('npx agentap')}
              activeOpacity={0.7}
            >
              <Text style={styles.codeText}>npx agentap</Text>
              <Ionicons name="copy-outline" size={14} color={Colors.textMuted} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.step}>
          <Text style={styles.stepNumber}>2</Text>
          <View style={styles.stepContent}>
            <Text style={styles.stepText}>Run the link command:</Text>
            <TouchableOpacity
              style={styles.codeBlock}
              onPress={() => Clipboard.setString('agentap link')}
              activeOpacity={0.7}
            >
              <Text style={styles.codeText}>agentap link</Text>
              <Ionicons name="copy-outline" size={14} color={Colors.textMuted} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.step}>
          <Text style={styles.stepNumber}>3</Text>
          <View style={styles.stepContent}>
            <Text style={styles.stepText}>Scan the QR code or enter the pairing code:</Text>
          </View>
        </View>
      </View>

      <TouchableOpacity
        style={styles.emptyButtonWrapper}
        onPress={() => router.push('/scan')}
        activeOpacity={0.8}
      >
        <LinearGradient
          colors={[Colors.primary, Colors.secondary]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.emptyButton}
        >
          <Ionicons name="link" size={20} color="#fff" />
          <Text style={styles.emptyButtonText}>Link a Machine</Text>
        </LinearGradient>
      </TouchableOpacity>
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
        data={filteredMachines}
        keyExtractor={(item) => item.id}
        renderItem={renderMachine}
        ListHeaderComponent={machines.length > 0 ? ListHeader : null}
        ListEmptyComponent={machines.length === 0 ? ListEmpty : null}
        contentContainerStyle={machines.length === 0 ? styles.emptyContainer : styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={loadMachines}
            tintColor={Colors.primary}
            colors={[Colors.primary]}
            progressBackgroundColor={Colors.backgroundTertiary}
          />
        }
      />
      {machines.length > 0 && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => router.push('/scan')}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={[Colors.primary, Colors.secondary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.fabGradient}
          >
            <Ionicons name="add" size={28} color="#fff" />
          </LinearGradient>
        </TouchableOpacity>
      )}
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
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    borderRadius: 28,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  fabGradient: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  machineCard: {
    backgroundColor: 'rgba(10, 15, 26, 0.5)',
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  machineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  machineIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: Colors.backgroundTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  machineInfo: {
    flex: 1,
  },
  machineName: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
  },
  machineDetails: {
    fontSize: 13,
    color: Colors.textMuted,
    marginTop: 4,
  },
  sessionCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  sessionCountText: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.primary,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#fff',
  },
  machineFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  lastSeen: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  deleteButton: {
    padding: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  emptyContainer: {
    flex: 1,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
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
  steps: {
    width: '100%',
    marginTop: 20,
    gap: 16,
  },
  step: {
    flexDirection: 'row',
    gap: 12,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 28,
    overflow: 'hidden',
  },
  stepContent: {
    flex: 1,
    gap: 8,
  },
  stepText: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  codeBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.backgroundTertiary,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  codeText: {
    fontFamily: 'monospace',
    fontSize: 14,
    color: Colors.primary,
  },
  emptyButtonWrapper: {
    marginTop: 24,
  },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 16,
    gap: 10,
  },
  emptyButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});
