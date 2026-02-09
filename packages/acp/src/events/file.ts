import type { ACPEventBase } from '../envelope';

export interface FileChangeEvent extends ACPEventBase {
  type: 'file:change';
  path: string;
  changeType: 'created' | 'modified' | 'deleted';
  diff?: string;
  language?: string;
  linesAdded?: number;
  linesRemoved?: number;
  toolCallId?: string;
}

export interface FileChangeBatchEvent extends ACPEventBase {
  type: 'file:batch';
  changes: Array<{
    path: string;
    changeType: 'created' | 'modified' | 'deleted';
    diff?: string;
    linesAdded?: number;
    linesRemoved?: number;
  }>;
  description?: string;
  toolCallId?: string;
}

export interface FileChangeSummary {
  path: string;
  changeType: 'created' | 'modified' | 'deleted';
  linesAdded: number;
  linesRemoved: number;
}
