/**
 * Link Machine screen - QR scan or code entry
 */

import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useMachinesStore, createApiClient } from '@agentap-dev/shared';
import { Colors } from '../constants/Colors';
import { API_URL, API_HEADERS } from '../constants/Config';

type Mode = 'choose' | 'scan' | 'code';

export default function ScanScreen() {
  const router = useRouter();
  const { addMachine } = useMachinesStore();
  const api = createApiClient(API_URL, API_HEADERS);

  const [mode, setMode] = useState<Mode>('choose');
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [code, setCode] = useState('');

  const linkWithCode = async (linkCode: string) => {
    setIsLinking(true);
    try {
      const { machine } = await api.linkMachine(linkCode);
      addMachine(machine);

      Alert.alert('Success', 'Machine linked successfully!', [
        { text: 'OK', onPress: () => router.replace('/(tabs)') },
      ]);
    } catch (error) {
      const message =
        error && typeof error === 'object' && 'message' in error
          ? (error as { message: string }).message
          : 'Failed to link machine. Check the code and try again.';
      Alert.alert('Error', message);
    } finally {
      setIsLinking(false);
    }
  };

  const handleBarCodeScanned = async ({ data }: { type: string; data: string }) => {
    if (scanned || isLinking) return;
    setScanned(true);

    let linkCode: string | null = null;

    // Try URL format: agentap://link?code=XXXXXX
    try {
      const url = new URL(data);
      if (url.protocol === 'agentap:') {
        linkCode = url.searchParams.get('code');
      }
    } catch {
      // Not a URL, try JSON format
    }

    // Try JSON format: { code, tunnel, name, v }
    if (!linkCode) {
      try {
        const parsed = JSON.parse(data);
        if (parsed.code) {
          linkCode = parsed.code;
        }
      } catch {
        // Not JSON either
      }
    }

    if (!linkCode) {
      Alert.alert('Invalid QR Code', 'This QR code is not a valid Agentap link.', [
        {
          text: 'Try Again',
          onPress: () => {
            setScanned(false);
          },
        },
        { text: 'Cancel', style: 'cancel', onPress: () => setMode('choose') },
      ]);
      return;
    }

    await linkWithCode(linkCode);
  };

  const handleCodeSubmit = () => {
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length < 4) {
      Alert.alert('Invalid Code', 'Please enter the full pairing code.');
      return;
    }
    linkWithCode(trimmed);
  };

  // Choose mode: two options
  if (mode === 'choose') {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.chooseContent}>
          <Text style={styles.chooseInstruction}>On your computer, run:</Text>
          <View style={styles.commandBlock}>
            <Text style={styles.commandText}>agentap link</Text>
          </View>
          <Text style={styles.chooseSubtext}>Then choose how to connect:</Text>

          {/* QR option */}
          <TouchableOpacity
            style={styles.optionCard}
            onPress={() => setMode('scan')}
            activeOpacity={0.7}
          >
            <View style={styles.optionIconContainer}>
              <Ionicons name="qr-code" size={28} color={Colors.primary} />
            </View>
            <View style={styles.optionInfo}>
              <Text style={styles.optionTitle}>Scan QR Code</Text>
              <Text style={styles.optionDescription}>
                Point your camera at the QR code displayed in terminal
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.textMuted} />
          </TouchableOpacity>

          {/* Code option */}
          <TouchableOpacity
            style={styles.optionCard}
            onPress={() => setMode('code')}
            activeOpacity={0.7}
          >
            <View style={styles.optionIconContainer}>
              <Ionicons name="keypad" size={28} color={Colors.primary} />
            </View>
            <View style={styles.optionInfo}>
              <Text style={styles.optionTitle}>Enter Code</Text>
              <Text style={styles.optionDescription}>Type the pairing code shown in terminal</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // Code entry mode
  if (mode === 'code') {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.codeContent}>
          <TouchableOpacity style={styles.backButton} onPress={() => setMode('choose')}>
            <Ionicons name="arrow-back" size={24} color={Colors.text} />
          </TouchableOpacity>

          <View style={styles.codeIconContainer}>
            <Ionicons name="keypad" size={40} color={Colors.primary} />
          </View>

          <Text style={styles.codeTitle}>Enter Pairing Code</Text>
          <Text style={styles.codeSubtext}>Enter the code displayed by the Agentap daemon</Text>

          <TextInput
            style={styles.codeInput}
            value={code}
            onChangeText={setCode}
            placeholder="XXXX-XXXX"
            placeholderTextColor={Colors.textMuted}
            maxLength={9}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            textAlign="center"
          />

          <TouchableOpacity
            style={styles.linkButtonWrapper}
            onPress={handleCodeSubmit}
            disabled={isLinking || code.trim().length < 4}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={[Colors.primary, Colors.secondary]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[
                styles.linkButton,
                (isLinking || code.trim().length < 4) && styles.linkButtonDisabled,
              ]}
            >
              {isLinking ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="link" size={20} color="#fff" />
                  <Text style={styles.linkButtonText}>Link Machine</Text>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // Scan mode: camera
  if (!permission) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <View style={styles.permissionContent}>
          <Ionicons name="camera-outline" size={64} color={Colors.textMuted} />
          <Text style={styles.permissionTitle}>Camera Access Required</Text>
          <Text style={styles.permissionText}>
            We need camera access to scan QR codes from your machines.
          </Text>
          <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
            <Text style={styles.permissionButtonText}>Grant Permission</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelButton} onPress={() => setMode('choose')}>
            <Text style={styles.cancelButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        barcodeScannerSettings={{
          barcodeTypes: ['qr'],
        }}
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
      />

      {/* Overlay */}
      <View style={styles.overlay}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => {
              setScanned(false);
              setMode('choose');
            }}
          >
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Scanner frame */}
        <View style={styles.scannerContainer}>
          <View style={styles.scannerFrame}>
            <View style={[styles.corner, styles.topLeft]} />
            <View style={[styles.corner, styles.topRight]} />
            <View style={[styles.corner, styles.bottomLeft]} />
            <View style={[styles.corner, styles.bottomRight]} />
          </View>
        </View>

        {/* Instructions */}
        <View style={styles.instructions}>
          {isLinking ? (
            <>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={styles.instructionText}>Linking machine...</Text>
            </>
          ) : (
            <>
              <Ionicons name="qr-code-outline" size={24} color="#fff" />
              <Text style={styles.instructionText}>
                Scan the QR code displayed by the Agentap daemon
              </Text>
              <TouchableOpacity onPress={() => setMode('code')}>
                <Text style={styles.switchModeText}>Or enter code manually</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  // Choose mode
  chooseContent: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    gap: 16,
  },
  chooseInstruction: {
    fontSize: 16,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  commandBlock: {
    backgroundColor: Colors.backgroundTertiary,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  commandText: {
    fontFamily: 'monospace',
    fontSize: 16,
    color: Colors.primary,
    fontWeight: '600',
  },
  chooseSubtext: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(10, 15, 26, 0.5)',
    padding: 20,
    borderRadius: 20,
    gap: 16,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  optionIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionInfo: {
    flex: 1,
  },
  optionTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: Colors.text,
  },
  optionDescription: {
    fontSize: 13,
    color: Colors.textMuted,
    marginTop: 4,
    lineHeight: 18,
  },
  // Code mode
  codeContent: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  backButton: {
    position: 'absolute',
    top: 16,
    left: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.backgroundTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  codeTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.text,
  },
  codeSubtext: {
    fontSize: 15,
    color: Colors.textMuted,
    textAlign: 'center',
    marginBottom: 16,
  },
  codeInput: {
    width: '80%',
    fontSize: 32,
    fontFamily: 'monospace',
    fontWeight: '700',
    color: Colors.text,
    backgroundColor: Colors.backgroundTertiary,
    paddingVertical: 20,
    paddingHorizontal: 24,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: Colors.borderLight,
    letterSpacing: 4,
  },
  linkButtonWrapper: {
    width: '80%',
    marginTop: 16,
  },
  linkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 16,
    gap: 10,
  },
  linkButtonDisabled: {
    opacity: 0.5,
  },
  linkButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
  },
  // Camera permission
  permissionContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  permissionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: Colors.text,
    marginTop: 16,
    marginBottom: 8,
  },
  permissionText: {
    fontSize: 16,
    color: Colors.textMuted,
    textAlign: 'center',
    marginBottom: 24,
  },
  permissionButton: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  permissionButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  cancelButton: {
    paddingHorizontal: 32,
    paddingVertical: 16,
  },
  cancelButtonText: {
    fontSize: 16,
    color: Colors.textMuted,
  },
  // Scanner overlay
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  header: {
    paddingTop: 16,
    paddingHorizontal: 16,
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scannerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scannerFrame: {
    width: 280,
    height: 280,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderColor: Colors.primary,
  },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 12,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 12,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 12,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 12,
  },
  instructions: {
    alignItems: 'center',
    padding: 32,
    gap: 8,
  },
  instructionText: {
    fontSize: 16,
    color: '#fff',
    textAlign: 'center',
  },
  switchModeText: {
    fontSize: 14,
    color: Colors.primary,
    textDecorationLine: 'underline',
    marginTop: 8,
  },
});
