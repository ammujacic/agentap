const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');
const mobileNodeModules = path.resolve(projectRoot, 'node_modules');

const config = getDefaultConfig(projectRoot);

// Watch all files in the monorepo for hot reload
config.watchFolders = [monorepoRoot];

// Resolve modules from mobile's node_modules first
config.resolver.nodeModulesPaths = [mobileNodeModules, path.resolve(monorepoRoot, 'node_modules')];

// Map shared to source
config.resolver.extraNodeModules = {
  '@agentap-dev/shared': path.resolve(monorepoRoot, 'packages/shared/src'),
};

// Enable symlinks for pnpm
config.resolver.unstable_enableSymlinks = true;

// Prefer CJS over ESM
config.resolver.resolverMainFields = ['react-native', 'browser', 'main'];

// Custom resolver to force react/zustand from mobile's node_modules
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Force these modules to always resolve from mobile's node_modules
  const forcedModules = ['react', 'react-dom', 'react-native', 'zustand', 'zustand/middleware'];

  if (forcedModules.some((m) => moduleName === m || moduleName.startsWith(m + '/'))) {
    const modulePath = path.join(mobileNodeModules, moduleName);
    return {
      filePath: require.resolve(moduleName, { paths: [mobileNodeModules] }),
      type: 'sourceFile',
    };
  }

  // Use default resolution for everything else
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
