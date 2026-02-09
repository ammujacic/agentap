// jest.config.js - fix pnpm + RN 0.81 ESM compatibility
const preset = require('jest-expo/jest-preset');

module.exports = {
  ...preset,
  moduleNameMapper: {
    ...(preset.moduleNameMapper || {}),
    '^@agentap-dev/shared$': '<rootDir>/../shared/src/index.ts',
    '^@agentap-dev/shared/(.*)$': '<rootDir>/../shared/src/$1',
  },
  // Fix transformIgnorePatterns for pnpm's .pnpm directory structure
  // The .pnpm exception ensures babel can transform RN and Expo files
  // within pnpm's nested node_modules
  transformIgnorePatterns: [
    'node_modules/(?!\\.pnpm|((jest-)?react-native|@react-native(-community)?|@react-native/.*)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)',
  ],
  // Append our setup to the preset's setup files (preserves __DEV__ etc.)
  setupFiles: [...(preset.setupFiles || []), '<rootDir>/__tests__/setup.ts'],
  testPathIgnorePatterns: ['/node_modules/', '__tests__/setup\\.ts$'],
  collectCoverageFrom: [
    'app/**/*.{ts,tsx}',
    'components/**/*.{ts,tsx}',
    'hooks/**/*.{ts,tsx}',
    'utils/**/*.{ts,tsx}',
    'constants/**/*.{ts,tsx}',
    '!**/*.d.ts',
  ],
  coverageThreshold: {
    global: {
      lines: 80,
      functions: 80,
      branches: 75,
      statements: 80,
    },
  },
};
