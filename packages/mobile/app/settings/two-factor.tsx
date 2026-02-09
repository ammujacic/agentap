/**
 * Two-factor authentication management screen
 */

import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore, createApiClient } from '@agentap-dev/shared';
import { API_URL, API_HEADERS } from '../../constants/Config';
import { Colors } from '../../constants/Colors';
import { storage } from '../../utils/storage';
import * as Clipboard from 'expo-clipboard';

type Step = 'idle' | 'password' | 'qrcode' | 'verify' | 'backup-codes';

export default function TwoFactorScreen() {
  const { user, setUser } = useAuthStore();
  const api = createApiClient(API_URL, API_HEADERS);
  const isEnabled = user?.twoFactorEnabled ?? false;

  const [step, setStep] = useState<Step>('idle');
  const [password, setPassword] = useState('');
  const [, setTotpUri] = useState('');
  const [secret, setSecret] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setStep('idle');
    setPassword('');
    setTotpUri('');
    setSecret('');
    setVerifyCode('');
    setBackupCodes([]);
    setError('');
  };

  const handleEnable = () => {
    reset();
    setStep('password');
  };

  const handlePasswordSubmit = useCallback(async () => {
    if (!password.trim()) {
      setError('Please enter your password');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const result = await api.getTotpUri(password);
      setTotpUri(result.totpURI);
      setSecret(result.secret);
      setStep('qrcode');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid password');
    } finally {
      setLoading(false);
    }
  }, [password]);

  const handleVerifyAndEnable = useCallback(async () => {
    if (!verifyCode.trim()) {
      setError('Please enter the verification code');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const result = await api.enableTwoFactor(password, verifyCode);
      setBackupCodes(result.backupCodes);
      // Update user
      if (user) {
        const updated = { ...user, twoFactorEnabled: true };
        await storage.setItem('user', JSON.stringify(updated));
        setUser(updated);
      }
      setStep('backup-codes');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setLoading(false);
    }
  }, [verifyCode, password, user]);

  const handleDisable = () => {
    Alert.alert(
      'Disable 2FA',
      'Are you sure you want to disable two-factor authentication? This will make your account less secure.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disable',
          style: 'destructive',
          onPress: () => {
            reset();
            setStep('password');
            // We'll handle disable in password submit when already enabled
          },
        },
      ]
    );
  };

  const handleDisableWithPassword = useCallback(async () => {
    if (!password.trim()) {
      setError('Please enter your password');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await api.disableTwoFactor(password);
      if (user) {
        const updated = { ...user, twoFactorEnabled: false };
        await storage.setItem('user', JSON.stringify(updated));
        setUser(updated);
      }
      reset();
      Alert.alert('Success', 'Two-factor authentication has been disabled.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid password');
    } finally {
      setLoading(false);
    }
  }, [password, user]);

  const handleViewBackupCodes = () => {
    reset();
    setStep('password');
  };

  const handleViewBackupCodesWithPassword = useCallback(async () => {
    if (!password.trim()) {
      setError('Please enter your password');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const result = await api.viewBackupCodes(password);
      setBackupCodes(result.backupCodes);
      setStep('backup-codes');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid password');
    } finally {
      setLoading(false);
    }
  }, [password]);

  const handleRegenerateBackupCodes = useCallback(async () => {
    Alert.alert(
      'Regenerate Backup Codes',
      'This will invalidate all existing backup codes. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Regenerate',
          onPress: async () => {
            reset();
            setStep('password');
          },
        },
      ]
    );
  }, []);

  const copyBackupCodes = async () => {
    await Clipboard.setStringAsync(backupCodes.join('\n'));
    Alert.alert('Copied', 'Backup codes copied to clipboard.');
  };

  // Password step
  if (step === 'password') {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="lock-closed" size={24} color={Colors.primary} />
            <Text style={styles.cardTitle}>Confirm Password</Text>
          </View>
          <Text style={styles.cardDescription}>Enter your password to continue.</Text>
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={Colors.textMuted}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoFocus
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}

          {isEnabled ? (
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.button, styles.secondaryButton, { flex: 1 }]}
                onPress={() => {
                  handleDisableWithPassword();
                }}
                disabled={loading}
              >
                <Text style={styles.secondaryButtonText}>Disable 2FA</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.primaryButton, { flex: 1 }]}
                onPress={() => {
                  handleViewBackupCodesWithPassword();
                }}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.primaryButtonText}>View Codes</Text>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.button, styles.primaryButton]}
              onPress={handlePasswordSubmit}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.primaryButtonText}>Continue</Text>
              )}
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.cancelButton} onPress={reset}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  // QR code / secret step
  if (step === 'qrcode') {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="qr-code" size={24} color={Colors.primary} />
            <Text style={styles.cardTitle}>Set Up Authenticator</Text>
          </View>
          <Text style={styles.cardDescription}>
            Add this account to your authenticator app using the secret key below.
          </Text>

          <View style={styles.secretContainer}>
            <Text style={styles.secretLabel}>Secret Key</Text>
            <TouchableOpacity
              style={styles.secretBox}
              onPress={async () => {
                await Clipboard.setStringAsync(secret);
                Alert.alert('Copied', 'Secret key copied to clipboard.');
              }}
            >
              <Text style={styles.secretText}>{secret}</Text>
              <Ionicons name="copy-outline" size={18} color={Colors.textMuted} />
            </TouchableOpacity>
          </View>

          <Text style={styles.cardDescription}>
            After adding the account, enter the 6-digit code to verify.
          </Text>

          <TextInput
            style={[styles.input, styles.codeInput]}
            placeholder="000000"
            placeholderTextColor={Colors.textMuted}
            value={verifyCode}
            onChangeText={setVerifyCode}
            keyboardType="number-pad"
            maxLength={6}
            textAlign="center"
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.button, styles.primaryButton]}
            onPress={handleVerifyAndEnable}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.primaryButtonText}>Verify & Enable</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelButton} onPress={reset}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  // Backup codes step
  if (step === 'backup-codes') {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="key" size={24} color={Colors.warning} />
            <Text style={styles.cardTitle}>Backup Codes</Text>
          </View>
          <Text style={styles.cardDescription}>
            Save these codes in a safe place. Each code can only be used once.
          </Text>

          <View style={styles.codesGrid}>
            {backupCodes.map((code, i) => (
              <View key={i} style={styles.codeItem}>
                <Text style={styles.codeText}>{code}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity
            style={[styles.button, styles.secondaryButton]}
            onPress={copyBackupCodes}
          >
            <Ionicons name="copy-outline" size={18} color={Colors.primary} />
            <Text style={styles.secondaryButtonText}>Copy All Codes</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.button, styles.primaryButton]} onPress={reset}>
            <Text style={styles.primaryButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  // Idle - show status and actions
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <View style={styles.statusHeader}>
          <View
            style={[styles.statusIcon, isEnabled ? styles.statusEnabled : styles.statusDisabled]}
          >
            <Ionicons
              name={isEnabled ? 'shield-checkmark' : 'shield-outline'}
              size={32}
              color={isEnabled ? Colors.success : Colors.textMuted}
            />
          </View>
          <Text style={styles.statusTitle}>
            {isEnabled ? 'Two-Factor Authentication Enabled' : 'Two-Factor Authentication'}
          </Text>
          <Text style={styles.cardDescription}>
            {isEnabled
              ? 'Your account is protected with an authenticator app.'
              : 'Add an extra layer of security to your account by requiring a verification code from an authenticator app.'}
          </Text>
        </View>

        {isEnabled ? (
          <>
            <TouchableOpacity
              style={[styles.button, styles.secondaryButton]}
              onPress={handleViewBackupCodes}
            >
              <Ionicons name="key-outline" size={18} color={Colors.primary} />
              <Text style={styles.secondaryButtonText}>View Backup Codes</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.secondaryButton]}
              onPress={handleRegenerateBackupCodes}
            >
              <Ionicons name="refresh-outline" size={18} color={Colors.primary} />
              <Text style={styles.secondaryButtonText}>Regenerate Backup Codes</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={handleDisable}>
              <Ionicons name="shield-outline" size={18} color={Colors.error} />
              <Text style={styles.dangerButtonText}>Disable 2FA</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={[styles.button, styles.primaryButton]} onPress={handleEnable}>
            <Ionicons name="shield-checkmark" size={18} color="#fff" />
            <Text style={styles.primaryButtonText}>Enable 2FA</Text>
          </TouchableOpacity>
        )}
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
    padding: 16,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: 'rgba(10, 15, 26, 0.5)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    padding: 20,
    gap: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.text,
  },
  cardDescription: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  statusHeader: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  statusIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusEnabled: {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
  },
  statusDisabled: {
    backgroundColor: Colors.backgroundTertiary,
  },
  statusTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.text,
    textAlign: 'center',
  },
  input: {
    backgroundColor: Colors.backgroundTertiary,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 15,
    color: Colors.text,
  },
  codeInput: {
    fontSize: 24,
    fontWeight: '600',
    letterSpacing: 8,
  },
  error: {
    fontSize: 14,
    color: Colors.error,
    textAlign: 'center',
  },
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
  secondaryButton: {
    backgroundColor: Colors.backgroundTertiary,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.primary,
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
  cancelButton: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  cancelText: {
    fontSize: 14,
    color: Colors.textMuted,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  secretContainer: {
    gap: 8,
  },
  secretLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textMuted,
    letterSpacing: 0.5,
  },
  secretBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.backgroundTertiary,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  secretText: {
    flex: 1,
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: Colors.text,
    letterSpacing: 1,
  },
  codesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  codeItem: {
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    minWidth: '45%',
    alignItems: 'center',
  },
  codeText: {
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: Colors.text,
    letterSpacing: 1,
  },
});
