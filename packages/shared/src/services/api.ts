/**
 * API client for Agentap backend
 */

import type {
  User,
  Machine,
  Device,
  SignInResponse,
  TwoFactorTotpUri,
  TwoFactorBackupCodes,
  SessionInfo,
  ConnectedAccount,
  UserPreferences,
} from '../types/user';

export interface ApiClientOptions {
  baseUrl: string;
  getToken?: () => Promise<string | null>;
  defaultHeaders?: Record<string, string>;
}

export interface ApiError {
  error: string;
  message?: string;
  status: number;
}

export class ApiClient {
  private baseUrl: string;
  private getToken?: () => Promise<string | null>;
  private defaultHeaders: Record<string, string>;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl;
    this.getToken = options.getToken;
    this.defaultHeaders = options.defaultHeaders ?? {};
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...this.defaultHeaders,
      ...options.headers,
    };

    // Add auth token if available
    if (this.getToken) {
      const token = await this.getToken();
      if (token) {
        (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
      }
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw {
        error: error.error || 'Request failed',
        message: error.message,
        status: response.status,
      } as ApiError;
    }

    return response.json();
  }

  // ============================================================================
  // Auth
  // ============================================================================

  /**
   * Get OAuth authorization URL
   */
  getAuthUrl(provider: 'github' | 'google' | 'apple', redirect?: string): string {
    const url = new URL(`${this.baseUrl}/auth/${provider}`);
    if (redirect) {
      url.searchParams.set('redirect', redirect);
    }
    return url.toString();
  }

  /**
   * Sign in with email and password.
   * If 2FA is enabled, returns { twoFactorRedirect: true } instead of user data.
   */
  async signInWithEmail(email: string, password: string): Promise<SignInResponse> {
    return this.request('/auth/sign-in/email', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  /**
   * Sign up with email and password
   */
  async signUpWithEmail(
    email: string,
    password: string,
    name: string
  ): Promise<{ user: User; token: string }> {
    return this.request('/auth/sign-up/email', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    });
  }

  /**
   * Get current authenticated user
   */
  async getMe(): Promise<{ user: User }> {
    return this.request('/auth/me');
  }

  /**
   * Logout current user
   */
  async logout(): Promise<{ success: boolean }> {
    return this.request('/auth/logout', { method: 'POST' });
  }

  // ============================================================================
  // Two-Factor Authentication
  // ============================================================================

  /**
   * Get TOTP URI for QR code generation (requires password)
   */
  async getTotpUri(password: string): Promise<TwoFactorTotpUri> {
    return this.request('/auth/two-factor/get-totp-uri', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  }

  /**
   * Enable 2FA after verifying TOTP code
   */
  async enableTwoFactor(
    password: string,
    code?: string
  ): Promise<{ status: boolean; backupCodes: string[] }> {
    return this.request('/auth/two-factor/enable', {
      method: 'POST',
      body: JSON.stringify({ password, ...(code ? { code } : {}) }),
    });
  }

  /**
   * Disable 2FA (requires password)
   */
  async disableTwoFactor(password: string): Promise<{ status: boolean }> {
    return this.request('/auth/two-factor/disable', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  }

  /**
   * Verify TOTP code during sign-in
   */
  async verifyTotp(code: string, trustDevice?: boolean): Promise<SignInResponse> {
    return this.request('/auth/two-factor/verify-totp', {
      method: 'POST',
      body: JSON.stringify({ code, trustDevice }),
    });
  }

  /**
   * Verify backup code during sign-in
   */
  async verifyBackupCode(code: string): Promise<SignInResponse> {
    return this.request('/auth/two-factor/verify-backup-code', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  }

  /**
   * Generate new backup codes (invalidates old ones)
   */
  async generateBackupCodes(password: string): Promise<TwoFactorBackupCodes> {
    return this.request('/auth/two-factor/generate-backup-codes', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  }

  /**
   * View existing backup codes
   */
  async viewBackupCodes(password: string): Promise<TwoFactorBackupCodes> {
    return this.request('/auth/two-factor/view-backup-codes', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  }

  // ============================================================================
  // Machines
  // ============================================================================

  /**
   * Create a machine link request (called by daemon)
   */
  async createLinkRequest(data: {
    tunnelId: string;
    machineName: string;
    os?: string;
    arch?: string;
    agentsDetected?: string[];
  }): Promise<{ code: string; expiresAt: string }> {
    return this.request('/api/machines/link-request', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Link a machine to user account (called after QR scan)
   */
  async linkMachine(code: string): Promise<{ machine: Machine }> {
    return this.request('/api/machines/link', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  }

  /**
   * Get all machines for current user
   */
  async getMachines(): Promise<{ machines: Machine[] }> {
    return this.request('/api/machines');
  }

  /**
   * Get a specific machine
   */
  async getMachine(id: string): Promise<{ machine: Machine }> {
    return this.request(`/api/machines/${id}`);
  }

  /**
   * Delete (unlink) a machine
   */
  async deleteMachine(id: string): Promise<{ success: boolean }> {
    return this.request(`/api/machines/${id}`, { method: 'DELETE' });
  }

  /**
   * Send machine heartbeat (called by daemon)
   */
  async sendHeartbeat(
    machineId: string,
    data: { tunnelId: string; agentsDetected?: string[] }
  ): Promise<{ success: boolean }> {
    return this.request(`/api/machines/${machineId}/heartbeat`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ============================================================================
  // Settings - Sessions
  // ============================================================================

  /**
   * List all active sessions for the current user
   */
  async getSessions(): Promise<{ sessions: SessionInfo[] }> {
    return this.request('/api/settings/sessions');
  }

  /**
   * Revoke a specific session
   */
  async revokeSession(sessionId: string): Promise<{ success: boolean }> {
    return this.request('/api/settings/sessions/revoke', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    });
  }

  /**
   * Revoke all sessions except the current one
   */
  async revokeOtherSessions(): Promise<{ success: boolean }> {
    return this.request('/api/settings/sessions/revoke-others', {
      method: 'POST',
    });
  }

  // ============================================================================
  // Settings - Connected Accounts
  // ============================================================================

  /**
   * List connected OAuth accounts
   */
  async getConnectedAccounts(): Promise<{ accounts: ConnectedAccount[] }> {
    return this.request('/api/settings/accounts');
  }

  /**
   * Disconnect an OAuth account
   */
  async disconnectAccount(providerId: string): Promise<{ success: boolean }> {
    return this.request('/api/settings/accounts/disconnect', {
      method: 'POST',
      body: JSON.stringify({ providerId }),
    });
  }

  // ============================================================================
  // Settings - Account Deletion
  // ============================================================================

  /**
   * Delete the current user's account and all data
   */
  async deleteAccount(): Promise<{ success: boolean }> {
    return this.request('/api/settings/delete-account', {
      method: 'POST',
    });
  }

  // ============================================================================
  // Settings - Preferences
  // ============================================================================

  /**
   * Get user preferences (auto-approve settings)
   */
  async getPreferences(): Promise<{ preferences: UserPreferences }> {
    return this.request('/api/settings/preferences');
  }

  /**
   * Update user preferences (auto-approve settings)
   */
  async updatePreferences(
    preferences: Partial<UserPreferences>
  ): Promise<{ preferences: UserPreferences }> {
    return this.request('/api/settings/preferences', {
      method: 'PUT',
      body: JSON.stringify(preferences),
    });
  }

  // ============================================================================
  // Devices
  // ============================================================================

  /**
   * Get all devices for current user
   */
  async getDevices(): Promise<{ devices: Device[] }> {
    return this.request('/api/devices');
  }

  /**
   * Delete (revoke) a device
   */
  async deleteDevice(id: string): Promise<{ success: boolean }> {
    return this.request(`/api/devices/${id}`, { method: 'DELETE' });
  }
}

/**
 * Create API client with default configuration
 */
export function createApiClient(
  baseUrl: string = 'https://api.agentap.dev',
  defaultHeaders?: Record<string, string>
): ApiClient {
  return new ApiClient({ baseUrl, defaultHeaders });
}
