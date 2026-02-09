/**
 * User types for Agentap
 */

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  twoFactorEnabled?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SignInResponse {
  user?: User;
  token?: string;
  twoFactorRedirect?: boolean;
}

export interface TwoFactorTotpUri {
  totpURI: string;
  secret: string;
}

export interface TwoFactorBackupCodes {
  backupCodes: string[];
}

export interface OAuthAccount {
  provider: OAuthProvider;
  providerUserId: string;
  userId: string;
  createdAt: Date;
}

export type OAuthProvider = 'github' | 'google' | 'apple';

export interface Session {
  id: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface SessionInfo {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  expiresAt: number;
  isCurrent: boolean;
}

export interface ConnectedAccount {
  provider: OAuthProvider;
  connected: boolean;
  accountId: string | null;
  createdAt: number | null;
}

export interface Machine {
  id: string;
  userId: string;
  name: string;
  tunnelId: string;
  tunnelUrl: string | null;
  os: string | null;
  arch: string | null;
  agentsDetected: string[];
  isOnline: boolean;
  activeSessionCount: number;
  lastSeenAt: Date | null;
  createdAt: Date;
}

export interface Device {
  id: string;
  userId: string;
  name: string | null;
  type: DeviceType;
  pushToken: string | null;
  lastIp: string | null;
  lastSeenAt: Date | null;
  createdAt: Date;
}

export type DeviceType = 'ios' | 'android' | 'web';

export interface UserPreferences {
  autoApproveLow: boolean;
  autoApproveMedium: boolean;
  autoApproveHigh: boolean;
  autoApproveCritical: boolean;
}
