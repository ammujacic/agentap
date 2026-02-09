/**
 * Session management screen - view and revoke active auth sessions
 */

import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { createApiClient } from '@agentap-dev/shared';
import type { SessionInfo } from '@agentap-dev/shared';
import { API_URL, API_HEADERS } from '../../constants/Config';
import { Colors } from '../../constants/Colors';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseUserAgent(ua: string | null): {
  browser: string;
  os: string;
  type: 'web' | 'mobile';
} {
  if (!ua) return { browser: 'Unknown', os: 'Unknown', type: 'web' };

  // React Native / Expo (mobile app)
  if (ua.includes('Expo') || ua.includes('ExpoClient') || ua.includes('ExponentConstants')) {
    const os =
      ua.includes('iOS') || ua.includes('iPhone') || ua.includes('iPad')
        ? 'iOS'
        : ua.includes('Android')
          ? 'Android'
          : 'Mobile';
    return { browser: 'Agentap', os, type: 'mobile' };
  }

  // curl (seed scripts, API calls)
  if (ua.startsWith('curl/')) {
    return { browser: 'API', os: 'CLI', type: 'web' };
  }

  let browser = 'Unknown';
  if (ua.includes('Edg/')) browser = 'Edge';
  else if (ua.includes('Chrome/')) browser = 'Chrome';
  else if (ua.includes('Firefox/')) browser = 'Firefox';
  else if (ua.includes('Safari/')) browser = 'Safari';

  let os = 'Unknown';
  if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('Mac OS')) os = 'macOS';
  else if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Linux')) os = 'Linux';

  const type = os === 'iOS' || os === 'Android' ? 'mobile' : 'web';
  return { browser, os, type };
}

function formatTimeAgo(timestamp: number | null): string {
  if (!timestamp) return 'Unknown';
  const seconds = Math.floor(Date.now() / 1000 - timestamp);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatLocation(
  city: string | null,
  region: string | null,
  country: string | null
): string {
  if (city && region) return `${city}, ${region}`;
  if (city) return city;
  if (country) return country;
  return 'Unknown location';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SessionsScreen() {
  const api = createApiClient(API_URL, API_HEADERS);

  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);

  // -----------------------------------------------------------------------
  // Data fetching
  // -----------------------------------------------------------------------

  const fetchSessions = useCallback(async () => {
    try {
      setError(null);
      const result = await api.getSessions();
      setSessions(result.sessions);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
    }
  }, []);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    await fetchSessions();
    setLoading(false);
  }, [fetchSessions]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchSessions();
    setRefreshing(false);
  }, [fetchSessions]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------

  const handleRevoke = useCallback((session: SessionInfo) => {
    const { browser, os } = parseUserAgent(session.userAgent);
    Alert.alert('Revoke Session', `Sign out the ${browser} on ${os} session?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          setRevokingId(session.id);
          try {
            await api.revokeSession(session.id);
            setSessions((prev) => prev.filter((s) => s.id !== session.id));
          } catch (err: unknown) {
            Alert.alert('Error', err instanceof Error ? err.message : 'Failed to revoke session');
          } finally {
            setRevokingId(null);
          }
        },
      },
    ]);
  }, []);

  const handleRevokeAll = useCallback(() => {
    Alert.alert(
      'Sign Out All Other Devices',
      'This will end all sessions except this device. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out All',
          style: 'destructive',
          onPress: async () => {
            setRevokingAll(true);
            try {
              await api.revokeOtherSessions();
              setSessions((prev) => prev.filter((s) => s.isCurrent));
            } catch (err: unknown) {
              Alert.alert(
                'Error',
                err instanceof Error ? err.message : 'Failed to revoke sessions'
              );
            } finally {
              setRevokingAll(false);
            }
          },
        },
      ]
    );
  }, []);

  // -----------------------------------------------------------------------
  // Render helpers
  // -----------------------------------------------------------------------

  const otherSessions = sessions.filter((s) => !s.isCurrent);

  const renderSession = (session: SessionInfo) => {
    const { browser, os, type } = parseUserAgent(session.userAgent);
    const location = formatLocation(session.city, session.region, session.country);
    const created = formatTimeAgo(session.createdAt);
    const lastActive = formatTimeAgo(session.updatedAt);
    const isRevoking = revokingId === session.id;

    return (
      <View key={session.id} style={styles.sessionCard}>
        <View style={styles.sessionRow}>
          {/* Icon */}
          <View style={styles.sessionIcon}>
            <Ionicons
              name={type === 'mobile' ? 'phone-portrait-outline' : 'desktop-outline'}
              size={22}
              color={session.isCurrent ? Colors.primary : Colors.textSecondary}
            />
          </View>

          {/* Details */}
          <View style={styles.sessionDetails}>
            <View style={styles.sessionTitleRow}>
              <Text style={styles.sessionTitle} numberOfLines={1}>
                {browser} on {os}
              </Text>
              {session.isCurrent && (
                <View style={styles.currentBadge}>
                  <Text style={styles.currentBadgeText}>This device</Text>
                </View>
              )}
            </View>

            <View style={styles.sessionMeta}>
              {session.ipAddress && (
                <View style={styles.metaItem}>
                  <Ionicons name="globe-outline" size={12} color={Colors.textMuted} />
                  <Text style={styles.metaText}>{session.ipAddress}</Text>
                </View>
              )}
              <View style={styles.metaItem}>
                <Ionicons name="location-outline" size={12} color={Colors.textMuted} />
                <Text style={styles.metaText}>{location}</Text>
              </View>
              <View style={styles.metaItem}>
                <Ionicons name="calendar-outline" size={12} color={Colors.textMuted} />
                <Text style={styles.metaText}>Created {created}</Text>
              </View>
              <View style={styles.metaItem}>
                <Ionicons name="time-outline" size={12} color={Colors.textMuted} />
                <Text style={styles.metaText}>Active {lastActive}</Text>
              </View>
            </View>
          </View>

          {/* Revoke button (not for current session) */}
          {!session.isCurrent && (
            <TouchableOpacity
              style={styles.revokeButton}
              onPress={() => handleRevoke(session)}
              disabled={isRevoking}
            >
              {isRevoking ? (
                <ActivityIndicator size="small" color={Colors.error} />
              ) : (
                <Ionicons name="log-out-outline" size={20} color={Colors.error} />
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  // -----------------------------------------------------------------------
  // Loading state
  // -----------------------------------------------------------------------

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Loading sessions...</Text>
      </View>
    );
  }

  // -----------------------------------------------------------------------
  // Error state
  // -----------------------------------------------------------------------

  if (error && sessions.length === 0) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Ionicons name="warning-outline" size={48} color={Colors.error} />
        <Text style={styles.errorTitle}>Something went wrong</Text>
        <Text style={styles.errorMessage}>{error}</Text>
        <TouchableOpacity
          style={[styles.button, styles.primaryButton, { marginTop: 16 }]}
          onPress={loadInitial}
        >
          <Ionicons name="refresh-outline" size={18} color="#fff" />
          <Text style={styles.primaryButtonText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // -----------------------------------------------------------------------
  // Main render
  // -----------------------------------------------------------------------

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={Colors.primary}
          colors={[Colors.primary]}
          progressBackgroundColor={Colors.backgroundTertiary}
        />
      }
    >
      {refreshing && (
        <View style={styles.refreshBar}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={styles.refreshText}>Refreshing…</Text>
        </View>
      )}
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <Ionicons name="shield-checkmark-outline" size={28} color={Colors.primary} />
        </View>
        <Text style={styles.headerTitle}>Active Sessions</Text>
        <Text style={styles.headerDescription}>
          Manage devices where you are currently signed in. If you see a session you don't
          recognize, revoke it immediately.
        </Text>
      </View>

      {/* Session list */}
      <View style={styles.sessionList}>{sessions.map(renderSession)}</View>

      {/* Revoke all button */}
      {otherSessions.length > 0 && (
        <TouchableOpacity
          style={[styles.button, styles.dangerButton, styles.revokeAllButton]}
          onPress={handleRevokeAll}
          disabled={revokingAll}
        >
          {revokingAll ? (
            <ActivityIndicator size="small" color={Colors.error} />
          ) : (
            <>
              <Ionicons name="log-out-outline" size={18} color={Colors.error} />
              <Text style={styles.dangerButtonText}>Sign Out All Other Devices</Text>
            </>
          )}
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

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
    marginHorizontal: -16,
    marginTop: -16,
    marginBottom: 8,
    paddingHorizontal: 16,
  },
  refreshText: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },

  // Header
  header: {
    alignItems: 'center',
    gap: 10,
    marginBottom: 24,
  },
  headerIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
  },
  headerDescription: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
    textAlign: 'center',
    paddingHorizontal: 8,
  },

  // Session list
  sessionList: {
    gap: 10,
  },

  // Session card
  sessionCard: {
    backgroundColor: 'rgba(10, 15, 26, 0.5)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    padding: 14,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sessionIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: Colors.backgroundTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionDetails: {
    flex: 1,
    gap: 4,
  },
  sessionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sessionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
    flexShrink: 1,
  },

  // Current device badge
  currentBadge: {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  currentBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.success,
  },

  // Meta info
  sessionMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  metaText: {
    fontSize: 12,
    color: Colors.textMuted,
  },

  // Revoke button (per session)
  revokeButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Revoke all
  revokeAllButton: {
    marginTop: 20,
  },

  // Loading
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: Colors.textSecondary,
  },

  // Error
  errorTitle: {
    marginTop: 12,
    fontSize: 17,
    fontWeight: '600',
    color: Colors.text,
  },
  errorMessage: {
    marginTop: 4,
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
  },

  // Shared button styles (matching two-factor.tsx)
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 16,
    gap: 10,
  },
  primaryButton: {
    backgroundColor: Colors.primary,
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  dangerButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  dangerButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.error,
  },
});
