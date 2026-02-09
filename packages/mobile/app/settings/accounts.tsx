/**
 * Connected accounts screen - view and manage linked OAuth providers
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
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { createApiClient } from '@agentap-dev/shared';
import type { ConnectedAccount } from '@agentap-dev/shared';
import { API_URL, API_HEADERS } from '../../constants/Config';
import { Colors } from '../../constants/Colors';

// ---------------------------------------------------------------------------
// Provider config
// ---------------------------------------------------------------------------

const PROVIDERS: Record<
  string,
  { label: string; icon: React.ComponentProps<typeof Ionicons>['name']; color: string }
> = {
  github: { label: 'GitHub', icon: 'logo-github', color: '#ffffff' },
  google: { label: 'Google', icon: 'logo-google', color: '#4285F4' },
  apple: { label: 'Apple', icon: 'logo-apple', color: '#ffffff' },
};

function formatDate(timestamp: number | null): string {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AccountsScreen() {
  const api = createApiClient(API_URL, API_HEADERS);

  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);

  // -----------------------------------------------------------------------
  // Data fetching
  // -----------------------------------------------------------------------

  const fetchAccounts = useCallback(async () => {
    try {
      setError(null);
      const result = await api.getConnectedAccounts();
      setAccounts(result.accounts);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load accounts');
    }
  }, []);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    await fetchAccounts();
    setLoading(false);
  }, [fetchAccounts]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAccounts();
    setRefreshing(false);
  }, [fetchAccounts]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------

  const handleConnect = useCallback((provider: string) => {
    const callbackURL = `${API_URL}/auth/callback/${provider}`;
    const url = `${API_URL}/auth/sign-in/social`;

    // Open in browser - Better Auth handles the OAuth flow
    const params = new URLSearchParams({
      provider,
      callbackURL,
    });
    Linking.openURL(`${url}?${params.toString()}`);
  }, []);

  const handleDisconnect = useCallback((account: ConnectedAccount) => {
    const providerInfo = PROVIDERS[account.provider];
    Alert.alert(
      'Disconnect Account',
      `Remove ${providerInfo?.label || account.provider} from your linked accounts?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            setDisconnectingId(account.provider);
            try {
              await api.disconnectAccount(account.provider);
              setAccounts((prev) =>
                prev.map((a) =>
                  a.provider === account.provider
                    ? { ...a, connected: false, accountId: null, createdAt: null }
                    : a
                )
              );
            } catch (err: unknown) {
              const message =
                err && typeof err === 'object' && 'error' in err
                  ? (err as { error: string }).error
                  : 'Failed to disconnect account';
              Alert.alert('Error', message);
            } finally {
              setDisconnectingId(null);
            }
          },
        },
      ]
    );
  }, []);

  // -----------------------------------------------------------------------
  // Render helpers
  // -----------------------------------------------------------------------

  const renderAccount = (account: ConnectedAccount) => {
    const providerInfo = PROVIDERS[account.provider] || {
      label: account.provider,
      icon: 'link-outline' as const,
      color: Colors.textSecondary,
    };
    const isDisconnecting = disconnectingId === account.provider;

    return (
      <View key={account.provider} style={styles.accountCard}>
        <View style={styles.accountRow}>
          {/* Icon */}
          <View style={styles.accountIcon}>
            <Ionicons name={providerInfo.icon} size={22} color={providerInfo.color} />
          </View>

          {/* Details */}
          <View style={styles.accountDetails}>
            <Text style={styles.accountTitle}>{providerInfo.label}</Text>
            {account.connected ? (
              <View style={styles.statusRow}>
                <View style={styles.connectedDot} />
                <Text style={styles.connectedText}>
                  Connected{account.createdAt ? ` · ${formatDate(account.createdAt)}` : ''}
                </Text>
              </View>
            ) : (
              <Text style={styles.notConnectedText}>Not connected</Text>
            )}
          </View>

          {/* Action */}
          {account.connected ? (
            <TouchableOpacity
              style={styles.disconnectButton}
              onPress={() => handleDisconnect(account)}
              disabled={isDisconnecting}
            >
              {isDisconnecting ? (
                <ActivityIndicator size="small" color={Colors.error} />
              ) : (
                <Text style={styles.disconnectButtonText}>Disconnect</Text>
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.connectButton}
              onPress={() => handleConnect(account.provider)}
            >
              <Text style={styles.connectButtonText}>Connect</Text>
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
        <Text style={styles.loadingText}>Loading accounts...</Text>
      </View>
    );
  }

  // -----------------------------------------------------------------------
  // Error state
  // -----------------------------------------------------------------------

  if (error && accounts.length === 0) {
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
          <Ionicons name="link-outline" size={28} color={Colors.primary} />
        </View>
        <Text style={styles.headerTitle}>Connected Accounts</Text>
        <Text style={styles.headerDescription}>
          Link third-party accounts for faster sign-in. You can connect or disconnect providers at
          any time.
        </Text>
      </View>

      {/* Account list */}
      <View style={styles.accountList}>{accounts.map(renderAccount)}</View>
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

  // Account list
  accountList: {
    gap: 10,
  },

  // Account card
  accountCard: {
    backgroundColor: 'rgba(10, 15, 26, 0.5)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    padding: 14,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  accountIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: Colors.backgroundTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountDetails: {
    flex: 1,
    gap: 2,
  },
  accountTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },

  // Status
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  connectedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.success,
  },
  connectedText: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  notConnectedText: {
    fontSize: 12,
    color: Colors.textMuted,
  },

  // Buttons
  connectButton: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: Colors.primary,
  },
  connectButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  disconnectButton: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  disconnectButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.error,
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

  // Shared button styles
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
});
