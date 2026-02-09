/**
 * App color constants - matching portal and website theme
 */

export const Colors = {
  // Brand - Blue to Purple gradient colors
  primary: '#3b82f6', // blue-500
  primaryLight: '#60a5fa', // blue-400
  secondary: '#a855f7', // purple-500
  secondaryLight: '#c084fc', // purple-400

  // Background - matching portal dark theme
  background: '#030712', // gray-950
  backgroundSecondary: '#0a0f1a', // gray-900
  backgroundTertiary: '#111827', // gray-800

  // Text
  text: '#ffffff',
  textSecondary: '#9ca3af', // gray-400
  textMuted: '#6b7280', // gray-500

  // Status
  success: '#22c55e',
  warning: '#f59e0b',
  error: '#ef4444',
  info: '#3b82f6',

  // Agent colors
  claudeCode: '#f97316',
  codex: '#3b82f6',
  aider: '#a855f7',
  opencode: '#22c55e',

  // UI
  border: '#1f2937', // gray-700
  borderLight: 'rgba(255, 255, 255, 0.1)',
  card: '#0a0f1a', // gray-900
  cardHover: '#111827', // gray-800

  // Overlay
  overlay: 'rgba(0, 0, 0, 0.5)',

  // Gradients (for reference)
  gradientStart: '#3b82f6', // blue-500
  gradientEnd: '#a855f7', // purple-500
};

export const AgentColors: Record<string, string> = {
  'claude-code': Colors.claudeCode,
  codex: Colors.codex,
  aider: Colors.aider,
  opencode: Colors.opencode,
};
