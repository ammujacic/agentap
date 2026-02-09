import type { ACPEventBase } from '../envelope';
import type { RiskLevel } from './tool';

export type ApprovalPreview =
  | { type: 'diff'; path: string; diff: string }
  | { type: 'command'; command: string; workingDir: string }
  | { type: 'description'; text: string };

export interface ApprovalRequestedEvent extends ACPEventBase {
  type: 'approval:requested';
  requestId: string;
  toolCallId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  description: string;
  riskLevel: RiskLevel;
  expiresAt: string;
  preview?: ApprovalPreview;
}

export interface ApprovalResolvedEvent extends ACPEventBase {
  type: 'approval:resolved';
  requestId: string;
  toolCallId: string;
  approved: boolean;
  resolvedBy: 'user' | 'policy' | 'timeout';
  reason?: string;
}
