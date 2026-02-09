/**
 * Settings screen - matching portal design
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Switch, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuthStore, usePreferencesStore, createApiClient } from '@agentap-dev/shared';
import type { UserPreferences } from '@agentap-dev/shared';
import { useAuth } from '../../components/AuthProvider';
import { Colors } from '../../constants/Colors';
import { API_URL, API_HEADERS } from '../../constants/Config';
import { storage } from '../../utils/storage';

export default function SettingsScreen() {
  const { user } = useAuthStore();
  const { signOut } = useAuth();
  const router = useRouter();
  const api = useMemo(() => createApiClient(API_URL, API_HEADERS), []);

  const preferences = usePreferencesStore((s) => s.preferences);
  const preferencesLoaded = usePreferencesStore((s) => s.isLoaded);
  const setPreferences = usePreferencesStore((s) => s.setPreferences);

  const [pushEnabled, setPushEnabled] = useState(true);
  const [approvalAlerts, setApprovalAlerts] = useState(true);

  useEffect(() => {
    (async () => {
      const push = await storage.getItem('settings.pushEnabled');
      const approvals = await storage.getItem('settings.approvalAlerts');
      if (push !== null) setPushEnabled(push === 'true');
      if (approvals !== null) setApprovalAlerts(approvals === 'true');
    })();
  }, []);

  // Load auto-approve preferences from server
  useEffect(() => {
    if (!preferencesLoaded) {
      api
        .getPreferences()
        .then(({ preferences: prefs }) => setPreferences(prefs))
        .catch(() => {});
    }
  }, [preferencesLoaded, api, setPreferences]);

  const togglePush = useCallback(async (value: boolean) => {
    setPushEnabled(value);
    await storage.setItem('settings.pushEnabled', String(value));
  }, []);

  const toggleApprovalAlerts = useCallback(async (value: boolean) => {
    setApprovalAlerts(value);
    await storage.setItem('settings.approvalAlerts', String(value));
  }, []);

  const toggleAutoApprove = useCallback(
    async (key: keyof UserPreferences, value: boolean) => {
      const prev = { ...preferences };
      const updated = { ...preferences, [key]: value };
      setPreferences(updated);
      try {
        await api.updatePreferences(updated);
      } catch {
        setPreferences(prev);
        Alert.alert('Error', 'Failed to update auto-approve settings');
      }
    },
    [preferences, setPreferences, api]
  );

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: signOut },
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Profile */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>ACCOUNT</Text>
        <View style={styles.profileCard}>
          <LinearGradient
            colors={[Colors.primary, Colors.secondary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.avatar}
          >
            <Text style={styles.avatarText}>
              {user?.name?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase()}
            </Text>
          </LinearGradient>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{user?.name || 'User'}</Text>
            <Text style={styles.profileEmail}>{user?.email}</Text>
          </View>
        </View>
      </View>

      {/* Voice Settings */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>VOICE</Text>
        <View style={styles.settingsGroup}>
          <View style={styles.settingRow}>
            <View style={styles.settingIconWrapper}>
              <Ionicons name="volume-high" size={18} color={Colors.textSecondary} />
            </View>
            <Text style={styles.settingLabel}>Text-to-Speech</Text>
            <Switch
              value={false}
              onValueChange={() => {}}
              trackColor={{ false: Colors.border, true: Colors.primary }}
              thumbColor="#fff"
            />
          </View>
          <View style={styles.settingRow}>
            <View style={styles.settingIconWrapper}>
              <Ionicons name="mic" size={18} color={Colors.textSecondary} />
            </View>
            <Text style={styles.settingLabel}>Speech-to-Text</Text>
            <Switch
              value={false}
              onValueChange={() => {}}
              trackColor={{ false: Colors.border, true: Colors.primary }}
              thumbColor="#fff"
            />
          </View>
        </View>
      </View>

      {/* Notifications */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>NOTIFICATIONS</Text>
        <View style={styles.settingsGroup}>
          <View style={styles.settingRow}>
            <View style={styles.settingIconWrapper}>
              <Ionicons name="notifications" size={18} color={Colors.textSecondary} />
            </View>
            <Text style={styles.settingLabel}>Push Notifications</Text>
            <Switch
              value={pushEnabled}
              onValueChange={togglePush}
              trackColor={{ false: Colors.border, true: Colors.primary }}
              thumbColor="#fff"
            />
          </View>
          <View style={styles.settingRow}>
            <View style={styles.settingIconWrapper}>
              <Ionicons name="alert-circle" size={18} color={Colors.textSecondary} />
            </View>
            <Text style={styles.settingLabel}>Approval Alerts</Text>
            <Switch
              value={approvalAlerts}
              onValueChange={toggleApprovalAlerts}
              trackColor={{ false: Colors.border, true: Colors.primary }}
              thumbColor="#fff"
            />
          </View>
        </View>
      </View>

      {/* Auto-Approve */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>AUTO-APPROVE</Text>
        <Text style={styles.sectionHint}>
          Automatically approve tool calls at these risk levels without manual review.
        </Text>
        <View style={styles.settingsGroup}>
          <View style={styles.settingRow}>
            <View
              style={[styles.settingIconWrapper, { backgroundColor: 'rgba(34, 197, 94, 0.12)' }]}
            >
              <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
            </View>
            <View style={styles.settingLabelGroup}>
              <Text style={styles.settingLabel}>Low Risk</Text>
              <Text style={styles.settingDescription}>Read operations, searches</Text>
            </View>
            <Switch
              value={preferences.autoApproveLow}
              onValueChange={(v) => toggleAutoApprove('autoApproveLow', v)}
              trackColor={{ false: Colors.border, true: Colors.success }}
              thumbColor="#fff"
            />
          </View>
          <View style={styles.settingRow}>
            <View
              style={[styles.settingIconWrapper, { backgroundColor: 'rgba(245, 158, 11, 0.12)' }]}
            >
              <Ionicons name="alert-circle" size={18} color={Colors.warning} />
            </View>
            <View style={styles.settingLabelGroup}>
              <Text style={styles.settingLabel}>Medium Risk</Text>
              <Text style={styles.settingDescription}>File edits, writes</Text>
            </View>
            <Switch
              value={preferences.autoApproveMedium}
              onValueChange={(v) => toggleAutoApprove('autoApproveMedium', v)}
              trackColor={{ false: Colors.border, true: Colors.warning }}
              thumbColor="#fff"
            />
          </View>
          <View style={styles.settingRow}>
            <View
              style={[styles.settingIconWrapper, { backgroundColor: 'rgba(239, 68, 68, 0.12)' }]}
            >
              <Ionicons name="warning" size={18} color={Colors.error} />
            </View>
            <View style={styles.settingLabelGroup}>
              <Text style={styles.settingLabel}>High Risk</Text>
              <Text style={styles.settingDescription}>Shell commands, installs</Text>
            </View>
            <Switch
              value={preferences.autoApproveHigh}
              onValueChange={(v) => toggleAutoApprove('autoApproveHigh', v)}
              trackColor={{ false: Colors.border, true: Colors.error }}
              thumbColor="#fff"
            />
          </View>
          <View style={[styles.settingRow, styles.lastRow]}>
            <View
              style={[styles.settingIconWrapper, { backgroundColor: 'rgba(239, 68, 68, 0.12)' }]}
            >
              <Ionicons name="skull" size={18} color={Colors.error} />
            </View>
            <View style={styles.settingLabelGroup}>
              <Text style={styles.settingLabel}>Critical Risk</Text>
              <Text style={styles.settingDescription}>Destructive operations</Text>
            </View>
            <Switch
              value={preferences.autoApproveCritical}
              onValueChange={(v) => toggleAutoApprove('autoApproveCritical', v)}
              trackColor={{ false: Colors.border, true: Colors.error }}
              thumbColor="#fff"
            />
          </View>
        </View>
      </View>

      {/* Security */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>SECURITY</Text>
        <View style={styles.settingsGroup}>
          <TouchableOpacity
            style={styles.settingRow}
            activeOpacity={0.7}
            onPress={() => router.push('/settings/two-factor')}
          >
            <View style={styles.settingIconWrapper}>
              <Ionicons name="shield-checkmark" size={18} color={Colors.textSecondary} />
            </View>
            <Text style={styles.settingLabel}>Two-Factor Authentication</Text>
            {user?.twoFactorEnabled ? (
              <View style={styles.enabledBadge}>
                <Text style={styles.enabledBadgeText}>On</Text>
              </View>
            ) : (
              <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.settingRow}
            activeOpacity={0.7}
            onPress={() => router.push('/settings/sessions')}
          >
            <View style={styles.settingIconWrapper}>
              <Ionicons name="phone-portrait" size={18} color={Colors.textSecondary} />
            </View>
            <Text style={styles.settingLabel}>Active Sessions</Text>
            <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.settingRow, styles.lastRow]}
            activeOpacity={0.7}
            onPress={() => router.push('/settings/accounts')}
          >
            <View style={styles.settingIconWrapper}>
              <Ionicons name="link" size={18} color={Colors.textSecondary} />
            </View>
            <Text style={styles.settingLabel}>Connected Accounts</Text>
            <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      {/* About */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>ABOUT</Text>
        <View style={styles.settingsGroup}>
          <TouchableOpacity style={styles.settingRow} activeOpacity={0.7}>
            <View style={styles.settingIconWrapper}>
              <Ionicons name="information-circle" size={18} color={Colors.textSecondary} />
            </View>
            <Text style={styles.settingLabel}>Version</Text>
            <Text style={styles.settingValue}>0.1.0</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.settingRow} activeOpacity={0.7}>
            <View style={styles.settingIconWrapper}>
              <Ionicons name="logo-github" size={18} color={Colors.textSecondary} />
            </View>
            <Text style={styles.settingLabel}>GitHub</Text>
            <Ionicons name="open-outline" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.settingRow, styles.lastRow]} activeOpacity={0.7}>
            <View style={styles.settingIconWrapper}>
              <Ionicons name="document-text" size={18} color={Colors.textSecondary} />
            </View>
            <Text style={styles.settingLabel}>Privacy Policy</Text>
            <Ionicons name="open-outline" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Logout */}
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} activeOpacity={0.7}>
        <Ionicons name="log-out" size={20} color={Colors.error} />
        <Text style={styles.logoutText}>Sign Out</Text>
      </TouchableOpacity>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Made with ❤️ for developers</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingBottom: 40,
  },
  section: {
    paddingTop: 24,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
    marginBottom: 10,
    letterSpacing: 1,
  },
  sectionHint: {
    fontSize: 13,
    color: Colors.textMuted,
    marginBottom: 10,
    lineHeight: 18,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(10, 15, 26, 0.5)',
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    gap: 16,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 17,
    fontWeight: '600',
    color: Colors.text,
  },
  profileEmail: {
    fontSize: 14,
    color: Colors.textMuted,
    marginTop: 3,
  },
  settingsGroup: {
    backgroundColor: 'rgba(10, 15, 26, 0.5)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  settingIconWrapper: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.backgroundTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingLabelGroup: {
    flex: 1,
  },
  settingLabel: {
    flex: 1,
    fontSize: 16,
    color: Colors.text,
  },
  settingDescription: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  settingValue: {
    fontSize: 14,
    color: Colors.textMuted,
  },
  enabledBadge: {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  enabledBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.success,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    margin: 16,
    marginTop: 32,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    gap: 10,
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.error,
  },
  footer: {
    alignItems: 'center',
    padding: 24,
  },
  footerText: {
    fontSize: 13,
    color: Colors.textMuted,
  },
});
