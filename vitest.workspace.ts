import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/acp',
  'packages/shared',
  'packages/adapter-base',
  'packages/adapter-claude-code',
  'packages/adapter-opencode',
  'packages/daemon',
  'apps/api',
  'apps/website',
]);
