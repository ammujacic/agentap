import type { ACPEventBase } from '../envelope';

export type GitOperation =
  | { kind: 'commit'; hash: string; message: string; filesChanged: number }
  | { kind: 'branch_create'; name: string; from: string }
  | { kind: 'branch_switch'; name: string }
  | { kind: 'pr_create'; number: number; title: string; url: string }
  | { kind: 'push'; remote: string; branch: string }
  | { kind: 'stash'; action: 'push' | 'pop' };

export interface GitOperationEvent extends ACPEventBase {
  type: 'git:operation';
  operation: GitOperation;
  toolCallId?: string;
}
